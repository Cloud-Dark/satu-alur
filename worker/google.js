/**
 * Google sign-in ("Masuk dengan Google").
 *
 *   GET  /api/auth/providers         { google, otp_email, demo_login } for the login page
 *   GET  /api/auth/google/start      302 to Google (state + PKCE kept in oauth_logins, nonce cookie)
 *   GET  /api/auth/google/callback   no Bearer token; checks state + cookie, exchanges the code,
 *                                    validates the id_token claims, finds or creates the user, then
 *                                    302 to /#/masuk?google=<one-time code>
 *   POST /api/auth/google/exchange   { code } -> { user, access_token } (the SPA's normal session)
 *   GET  /api/auth/google/nonce      Google Identity Services: single-use nonce (5 min, gis_nonces)
 *   POST /api/auth/google/credential { credential, nonce } -> { user, access_token }: verifies the
 *                                    GIS ID token (RS256 against Google's JWKS, aud/iss/exp, email
 *                                    verified, our nonce) and signs in exactly like the callback.
 *
 * Env: GOOGLE_CLIENT_ID (var), GOOGLE_CLIENT_SECRET (secret). Redirect URI:
 * `${PUBLIC_BASE_URL || request origin}/api/auth/google/callback`.
 * The session token never travels in a URL: the callback hands over a 2-minute single-use code.
 */
import {
  isGoogleConfigured, googleRedirectUri, googleAuthUrl, randomUrlToken, pkceChallenge, decodeJwtPayload,
  validateIdTokenClaims, GOOGLE_TOKEN_URL, GOOGLE_JWKS_URL, jwksMaxAge, importRsaJwk, verifyGoogleIdToken,
} from '../src/auth/google.js';
import { isStaffEmail, ipBucket } from '../src/customers/rules.js';
import { isDemoUser } from './demo.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const COOKIE = '__Host-g_nonce';
const cookie = (value, maxAge) => `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
const readCookie = (request) => {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,64})(?:;|$)`).exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
};
const redirect = (location, setCookie) => new Response(null, {
  status: 302,
  headers: { location, 'cache-control': 'no-store', ...(setCookie ? { 'set-cookie': setCookie } : {}) },
});
const appBase = (env, request) => String(env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');
const backToLogin = (env, request, query) => redirect(`${appBase(env, request)}/#/masuk?${query}`, cookie('', 0));
const nowIso = () => new Date().toISOString();
const NONCE_TTL_MS = 5 * 60 * 1000;

/**
 * Finds or creates the user for a verified Google profile. Returns { user } or { error } with a
 * user-facing message; shared by the redirect callback and the GIS credential route.
 */
async function userForGoogleProfile(env, profile) {
  if (isStaffEmail(profile.email)) return { error: 'Email ini tidak bisa dipakai untuk masuk.' };
  if (isDemoUser(profile)) return { error: 'Akun demo dibuka lewat tab "Akun demo".' };
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), profile.email, profile.name || profile.email.split('@')[0], nowIso()).run();
  const user = await env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE email = ?').bind(profile.email).first();
  const flag = await env.DB.prepare('SELECT suspended FROM user_flags WHERE user_id = ?').bind(user.id).first();
  if (flag?.suspended === 1) return { error: 'Akun ini sedang ditangguhkan. Hubungi tim Satu Alur.' };
  return { user };
}

/* Google's signing keys: module cache (per isolate) backed by the Cache API, kept for the
   max-age Google sends. An unknown kid forces one refetch (Google rotates keys). */
let jwks = { keys: new Map(), until: 0 };
async function loadJwks(force) {
  if (!force && jwks.until > Date.now() && jwks.keys.size) return jwks.keys;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  let res = null;
  if (!force && cache) { try { res = await cache.match(GOOGLE_JWKS_URL); } catch { res = null; } }
  if (!res) {
    res = await fetch(GOOGLE_JWKS_URL);
    if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
    if (cache) {
      const copy = new Response(res.clone().body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${jwksMaxAge(res.headers.get('cache-control'))}` } });
      try { await cache.put(GOOGLE_JWKS_URL, copy); } catch { /* best effort */ }
    }
  }
  const maxAge = jwksMaxAge(res.headers.get('cache-control'));
  const body = await res.json();
  const keys = new Map();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk?.kty === 'RSA' && typeof jwk.kid === 'string') keys.set(jwk.kid, await importRsaJwk(jwk));
  }
  jwks = { keys, until: Date.now() + maxAge * 1000 };
  return keys;
}
async function googleKey(kid) {
  const keys = await loadJwks(false);
  if (keys.has(kid)) return keys.get(kid);
  return (await loadJwks(true)).get(kid) || null;
}
/** Test hook: forget the cached Google keys. */
export function resetGoogleKeyCache() { jwks = { keys: new Map(), until: 0 }; }

/* Light per-IP limit for the GIS routes (per isolate): 30 requests / 10 minutes. */
const ipHits = new Map();
function ipLimited(request) {
  const ip = ipBucket(request.headers.get('CF-Connecting-IP')) || 'unknown';
  const slot = `${ip}:${Math.floor(Date.now() / 600_000)}`;
  const n = (ipHits.get(slot) || 0) + 1;
  if (ipHits.size > 5000) ipHits.clear();
  ipHits.set(slot, n);
  return n > 30;
}

export async function handleAuthProviders(request, env, deps) {
  const google = isGoogleConfigured(env);
  return deps.ok({
    google,
    // Public OAuth client id for Google Identity Services (button + One Tap) in the browser.
    ...(google ? { google_client_id: env.GOOGLE_CLIENT_ID } : {}),
    otp_email: env.DEMO_OTP !== 'true',
    demo_login: env.DEMO_LOGIN !== 'false',
  });
}

export async function handleGoogleStart(request, env, deps) {
  if (!isGoogleConfigured(env)) throw new deps.HttpError(503, 'Masuk dengan Google belum dikonfigurasi.');
  const state = randomUrlToken(24);
  const verifier = randomUrlToken(48);
  const nonce = randomUrlToken(24);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_logins WHERE expires_at < ?').bind(nowIso()),
    env.DB.prepare("INSERT INTO oauth_logins (id, kind, value, expires_at) VALUES (?, 'state', ?, ?)")
      .bind(state, JSON.stringify({ verifier, nonce }), new Date(Date.now() + STATE_TTL_MS).toISOString()),
  ]);
  const url = googleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID, redirectUri: googleRedirectUri(env, request.url), state, challenge: await pkceChallenge(verifier),
  });
  return redirect(url, cookie(nonce, STATE_TTL_MS / 1000));
}

export async function handleGoogleCallback(request, env, deps) {
  const url = new URL(request.url);
  const fail = (msg) => backToLogin(env, request, `google_error=${encodeURIComponent(msg)}`);
  if (!isGoogleConfigured(env)) return fail('Masuk dengan Google belum dikonfigurasi.');
  if (url.searchParams.get('error')) return fail('Masuk dengan Google dibatalkan.');
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(state) || !code || code.length > 2048) return fail('Permintaan masuk tidak valid. Coba lagi.');

  const row = await env.DB.prepare("SELECT value, expires_at FROM oauth_logins WHERE id = ? AND kind = 'state'").bind(state).first();
  await env.DB.prepare('DELETE FROM oauth_logins WHERE id = ?').bind(state).run(); // single use
  if (!row || row.expires_at < nowIso()) return fail('Sesi masuk sudah kedaluwarsa. Coba lagi.');
  let saved;
  try { saved = JSON.parse(row.value); } catch { return fail('Permintaan masuk tidak valid. Coba lagi.'); }
  // Login CSRF: the browser finishing the flow must be the one that started it.
  if (!saved?.nonce || readCookie(request) !== saved.nonce) return fail('Buka ulang halaman masuk lalu coba lagi.');

  let tokens;
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(env, request.url), grant_type: 'authorization_code', code_verifier: saved.verifier,
      }),
    });
    tokens = await res.json();
    if (!res.ok) throw new Error(tokens?.error_description || tokens?.error || `HTTP ${res.status}`);
  } catch (err) {
    console.error('Google token exchange failed', String(err?.message || err).slice(0, 200));
    return fail('Google menolak permintaan masuk. Coba lagi.');
  }

  let profile;
  try {
    profile = validateIdTokenClaims(decodeJwtPayload(tokens.id_token), { clientId: env.GOOGLE_CLIENT_ID });
  } catch (err) {
    return fail(err.message);
  }
  const { user, error } = await userForGoogleProfile(env, profile);
  if (error) return fail(error);

  const handoff = randomUrlToken(32);
  await env.DB.prepare("INSERT INTO oauth_logins (id, kind, value, expires_at) VALUES (?, 'handoff', ?, ?)")
    .bind(await deps.sha256Hex(handoff), user.id, new Date(Date.now() + HANDOFF_TTL_MS).toISOString()).run();
  return backToLogin(env, request, `google=${handoff}`);
}

export async function handleGoogleExchange(request, env, deps) {
  const body = await deps.readJson(request);
  const code = typeof body.code === 'string' ? body.code : '';
  const bad = new deps.HttpError(400, 'Kode masuk Google tidak valid atau sudah dipakai. Coba lagi.');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(code)) throw bad;
  const id = await deps.sha256Hex(code);
  const row = await env.DB.prepare("SELECT value, expires_at FROM oauth_logins WHERE id = ? AND kind = 'handoff'").bind(id).first();
  const del = await env.DB.prepare('DELETE FROM oauth_logins WHERE id = ?').bind(id).run();
  if (!row || row.expires_at < nowIso() || !del.meta || del.meta.changes !== 1) throw bad;
  const user = await env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(row.value).first();
  if (!user) throw bad;
  const accessToken = await deps.createSession(env, user.id);
  return deps.ok({ user, access_token: accessToken });
}

export async function handleGoogleNonce(request, env, deps) {
  if (!isGoogleConfigured(env)) throw new deps.HttpError(503, 'Masuk dengan Google belum dikonfigurasi.');
  if (ipLimited(request)) throw new deps.HttpError(429, 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
  const nonce = randomUrlToken(24);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM gis_nonces WHERE expires_at < ?').bind(nowIso()),
    env.DB.prepare('INSERT INTO gis_nonces (id, expires_at) VALUES (?, ?)')
      .bind(await deps.sha256Hex(nonce), new Date(Date.now() + NONCE_TTL_MS).toISOString()),
  ]);
  return deps.ok({ nonce, expires_in: NONCE_TTL_MS / 1000 });
}

export async function handleGoogleCredential(request, env, deps) {
  if (!isGoogleConfigured(env)) throw new deps.HttpError(503, 'Masuk dengan Google belum dikonfigurasi.');
  if (ipLimited(request)) throw new deps.HttpError(429, 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
  const body = await deps.readJson(request);
  const credential = typeof body.credential === 'string' ? body.credential : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  if (!credential || credential.length > 8192 || !/^[A-Za-z0-9_-]{20,64}$/.test(nonce)) {
    throw new deps.HttpError(400, 'Permintaan masuk Google tidak valid. Coba lagi.');
  }
  // Single use: the nonce row is deleted here whatever happens next, so a token can't be replayed.
  const del = await env.DB.prepare('DELETE FROM gis_nonces WHERE id = ? AND expires_at >= ?')
    .bind(await deps.sha256Hex(nonce), nowIso()).run();
  if (!del.meta || del.meta.changes !== 1) throw new deps.HttpError(400, 'Sesi masuk Google sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');

  let profile;
  try {
    profile = await verifyGoogleIdToken(credential, { clientId: env.GOOGLE_CLIENT_ID, nonce, getKey: googleKey });
  } catch (err) {
    if (/JWKS/.test(String(err?.message))) {
      console.error('Google JWKS fetch failed', String(err.message).slice(0, 200));
      throw new deps.HttpError(503, 'Tidak bisa menghubungi Google saat ini. Coba lagi.');
    }
    throw new deps.HttpError(401, err?.message || 'Token Google tidak valid.');
  }
  const { user, error } = await userForGoogleProfile(env, profile);
  if (error) throw new deps.HttpError(403, error);
  const accessToken = await deps.createSession(env, user.id);
  return deps.ok({ user, access_token: accessToken });
}

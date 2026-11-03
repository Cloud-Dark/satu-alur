/**
 * Google sign-in ("Masuk dengan Google").
 *
 *   GET  /api/auth/providers         { google, otp_email, demo_login } for the login page
 *   GET  /api/auth/google/start      302 to Google (state + PKCE kept in oauth_logins, nonce cookie)
 *   GET  /api/auth/google/callback   no Bearer token; checks state + cookie, exchanges the code,
 *                                    validates the id_token claims, finds or creates the user, then
 *                                    302 to /#/masuk?google=<one-time code>
 *   POST /api/auth/google/exchange   { code } -> { user, access_token } (the SPA's normal session)
 *
 * Env: GOOGLE_CLIENT_ID (var), GOOGLE_CLIENT_SECRET (secret). Redirect URI:
 * `${PUBLIC_BASE_URL || request origin}/api/auth/google/callback`.
 * The session token never travels in a URL: the callback hands over a 2-minute single-use code.
 */
import {
  isGoogleConfigured, googleRedirectUri, googleAuthUrl, randomUrlToken, pkceChallenge, decodeJwtPayload,
  validateIdTokenClaims, GOOGLE_TOKEN_URL,
} from '../src/auth/google.js';
import { isStaffEmail } from '../src/customers/rules.js';

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

export async function handleAuthProviders(request, env, deps) {
  return deps.ok({
    google: isGoogleConfigured(env),
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
  if (isStaffEmail(profile.email)) return fail('Email ini tidak bisa dipakai untuk masuk.');

  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), profile.email, profile.name || profile.email.split('@')[0], nowIso()).run();
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(profile.email).first();
  const flag = await env.DB.prepare('SELECT suspended FROM user_flags WHERE user_id = ?').bind(user.id).first();
  if (flag?.suspended === 1) return fail('Akun ini sedang ditangguhkan. Hubungi tim Satu Alur.');

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

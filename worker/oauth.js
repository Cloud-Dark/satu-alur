/**
 * Akses AI by login: OAuth 2.1 + PKCE for the remote MCP server (MCP authorization spec 2025-06-18).
 * The Worker is both the authorization server and the resource server (/mcp, worker/mcp-server.js),
 * so the owner only pastes <origin>/mcp into Claude and signs in; no token to copy.
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 (where to log in for /mcp)
 *   GET  /.well-known/oauth-authorization-server[/mcp] RFC 8414 (also /.well-known/openid-configuration)
 *   POST /oauth/register     RFC 7591 dynamic client registration (public clients, rate limited)
 *   GET  /oauth/authorize    validates the client, parks the request (oauth_requests, 10 min) and
 *                            302s to the SPA consent page /#/izin-ai?req=<opaque id>
 *   POST /oauth/token        authorization_code (+ PKCE S256) and refresh_token (rotated; reuse of an
 *                            old refresh token revokes the whole grant)
 *   POST /oauth/revoke       RFC 7009
 *
 * Session-auth API for the SPA (#/izin-ai and Pengaturan › Akses AI (MCP)):
 *   GET    /api/oauth/request?req=   what is being asked (client, redirect host, tools, account)
 *   POST   /api/oauth/decision       { req, approve } -> { redirect } (code, or error=access_denied)
 *   GET    /api/oauth/grants         connected apps of this account
 *   DELETE /api/oauth/grants/:id     "Putuskan": revoke the grant and all its tokens
 *
 * The parameters of an authorization request are only ever read from oauth_requests, never from the
 * SPA. Staff sessions, the shared demo accounts and suspended users cannot approve (same rule as the
 * manual tokens). Codes, request ids and tokens are stored as SHA-256 hashes only (migration 0023).
 */
import { ACCESS_PREFIX, TOOLS, b64url, cleanLabel, newToken, take, tokenDisplayPrefix } from './mcp-server.js';
import { SUSPENDED_MESSAGE } from '../src/customers/rules.js';

export const SCOPE = 'satu-alur.read';
const REFRESH_PREFIX = 'sa_ort_';
const REFRESH_RE = /^sa_ort_[A-Za-z0-9_-]{43}$/;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 60 * 24 * 3600 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECT_URIS = 10;
const MAX_URI = 2000;
const MAX_FORM = 16 * 1024;
export const OAUTH_LIMITS = { registerPerHour: 20, registerAllPerHour: 500, authorizePerHour: 120, tokenPerMinute: 60 };
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const REQ_RE = /^[A-Za-z0-9_-]{32,64}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const nowIso = () => new Date().toISOString();
const later = (ms) => new Date(Date.now() + ms).toISOString();
const randomId = (n = 32) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
async function s256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
const clientIp = (request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

// ------------------------------------------------------------------ responses

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '600',
};
function jsonOut(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff', ...CORS, ...extra },
  });
}
const oauthError = (error, description, status = 400, extra) => jsonOut({ error, error_description: description }, status, extra);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Errors that must not redirect (unknown client, bad redirect_uri): a small page for the owner. */
function errorPage(message, status = 400) {
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tidak bisa menghubungkan Claude · Satu Alur</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:#f6f7f9;color:#1d2433}main{max-width:480px;margin:auto;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:24px}h1{font-size:20px;margin:0 0 8px}a{color:#2456d6}</style>
</head><body><main><h1>Tidak bisa menghubungkan Claude</h1><p>${esc(message)}</p><p>Hapus connector Satu Alur di Claude lalu tambahkan lagi. <a href="/">Kembali ke Satu Alur</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-frame-options': 'DENY' },
  });
}
function redirectTo(location) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
/** redirect_uri with the given query parameters added (state echoed back unchanged). */
function withParams(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

// ------------------------------------------------------------------ metadata

export const resourceUrl = (origin) => `${origin}/mcp`;

export function protectedResourceMetadata(origin) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Satu Alur',
  };
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
    service_documentation: `${origin}/#/app/pengaturan?bagian=mcp`,
  };
}

const PR_PATHS = new Set(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']);
const AS_PATHS = new Set([
  '/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp',
  '/.well-known/openid-configuration', '/.well-known/openid-configuration/mcp',
]);

/** /.well-known/* -> a Response, or null for paths that are not ours (served from the assets). */
export function handleWellKnown(request, path) {
  if (!PR_PATHS.has(path) && !AS_PATHS.has(path)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return oauthError('invalid_request', 'Metode tidak didukung.', 405, { allow: 'GET, OPTIONS' });
  const origin = new URL(request.url).origin;
  const body = PR_PATHS.has(path) ? protectedResourceMetadata(origin) : authorizationServerMetadata(origin);
  return jsonOut(body, 200, { 'cache-control': 'public, max-age=300' });
}

// ------------------------------------------------------------------ redirect URIs

/** https anywhere, or http on a loopback host (desktop / CLI clients, RFC 8252). No fragment. */
export function redirectUriProblem(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > MAX_URI) return 'redirect_uri kosong atau terlalu panjang.';
  let u;
  try { u = new URL(uri); } catch { return `redirect_uri tidak valid: ${uri.slice(0, 100)}`; }
  if (u.hash || uri.includes('#')) return 'redirect_uri tidak boleh berisi fragmen (#).';
  if (u.username || u.password) return 'redirect_uri tidak boleh berisi kredensial.';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return null;
  return 'redirect_uri harus https://, atau http://localhost / http://127.0.0.1 untuk aplikasi desktop.';
}

/** Exact match; for loopback URIs the port may differ (RFC 8252 §7.3). */
export function redirectMatches(registered, given) {
  if (registered.includes(given)) return true;
  let g;
  try { g = new URL(given); } catch { return false; }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return u.protocol === 'http:' && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch { return false; }
  });
}

const parseUris = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };
async function loadClient(env, clientId) {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 100) return null;
  const row = await env.DB.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(clientId).first();
  return row ? { ...row, redirect_uris: parseUris(row.redirect_uris) } : null;
}

// ------------------------------------------------------------------ /oauth/register

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_FORM) return { tooLarge: true };
  const raw = await request.text();
  if (raw.length > MAX_FORM) return { tooLarge: true };
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) {
    try {
      const v = JSON.parse(raw || '{}');
      return { body: v && typeof v === 'object' && !Array.isArray(v) ? v : null };
    } catch { return { body: null }; }
  }
  return { body: Object.fromEntries(new URLSearchParams(raw)) };
}

async function register(request, env) {
  const ip = clientIp(request);
  if (!(await take(`oreg:${ip}`, OAUTH_LIMITS.registerPerHour, 3_600_000)) || !(await take('oreg:all', OAUTH_LIMITS.registerAllPerHour, 3_600_000))) {
    return oauthError('temporarily_unavailable', 'Terlalu banyak pendaftaran klien. Coba lagi nanti.', 429, { 'retry-after': '3600' });
  }
  const { body, tooLarge } = await readBody(request);
  if (tooLarge) return oauthError('invalid_client_metadata', 'Permintaan terlalu besar.', 413);
  if (!body) return oauthError('invalid_client_metadata', 'Body harus berupa objek JSON.');
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length) return oauthError('invalid_redirect_uri', 'redirect_uris wajib diisi (array).');
  if (uris.length > MAX_REDIRECT_URIS) return oauthError('invalid_redirect_uri', `Maksimal ${MAX_REDIRECT_URIS} redirect_uris.`);
  for (const u of uris) {
    const problem = redirectUriProblem(u);
    if (problem) return oauthError('invalid_redirect_uri', problem);
  }
  const method = body.token_endpoint_auth_method ?? 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
    return oauthError('invalid_client_metadata', 'token_endpoint_auth_method harus none, client_secret_post, atau client_secret_basic.');
  }
  const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grantTypes) || !grantTypes.length || grantTypes.some((g) => !['authorization_code', 'refresh_token'].includes(g))) {
    return oauthError('invalid_client_metadata', 'grant_types hanya boleh authorization_code dan refresh_token.');
  }
  const responseTypes = body.response_types ?? ['code'];
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== 'code')) {
    return oauthError('invalid_client_metadata', 'response_types hanya boleh code.');
  }
  let clientUri = null;
  if (typeof body.client_uri === 'string' && body.client_uri.length <= 300 && /^https:\/\//i.test(body.client_uri)) {
    try { clientUri = new URL(body.client_uri).toString(); } catch { clientUri = null; }
  }
  const name = cleanLabel(typeof body.client_name === 'string' ? body.client_name : '');
  const clientId = `sa_cl_${randomId(18)}`;
  const secret = method === 'none' ? null : `sa_cs_${randomId(32)}`;
  const issuedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO oauth_clients (client_id, client_name, redirect_uris, client_uri, token_endpoint_auth_method, secret_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(clientId, name, JSON.stringify(uris), clientUri, method, secret ? await s256(secret) : null, nowIso()).run();
  return jsonOut({
    client_id: clientId,
    client_id_issued_at: issuedAt,
    client_name: name,
    redirect_uris: uris,
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: method,
    scope: SCOPE,
    ...(clientUri ? { client_uri: clientUri } : {}),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  }, 201);
}

// ------------------------------------------------------------------ /oauth/authorize

const sameResource = (given, origin) => {
  const norm = (s) => String(s).replace(/\/+$/, '');
  return [resourceUrl(origin), origin].includes(norm(given));
};

async function authorize(request, env) {
  if (request.method !== 'GET') return errorPage('Metode tidak didukung.', 405);
  const url = new URL(request.url);
  const q = url.searchParams;
  if (!(await take(`oauz:${clientIp(request)}`, OAUTH_LIMITS.authorizePerHour, 3_600_000))) {
    return errorPage('Terlalu banyak permintaan. Coba lagi beberapa menit lagi.', 429);
  }
  const client = await loadClient(env, q.get('client_id'));
  if (!client) return errorPage('Aplikasi ini belum terdaftar di Satu Alur (client_id tidak dikenal).');
  let redirectUri = q.get('redirect_uri');
  if (!redirectUri && client.redirect_uris.length === 1) redirectUri = client.redirect_uris[0];
  if (!redirectUri || redirectUriProblem(redirectUri) || !redirectMatches(client.redirect_uris, redirectUri)) {
    return errorPage('Alamat kembali (redirect_uri) tidak cocok dengan yang didaftarkan aplikasi ini.');
  }
  const state = q.get('state') || '';
  const back = (error, description) => redirectTo(withParams(redirectUri, { error, error_description: description, state }));
  if (state.length > 1000) return back('invalid_request', 'state terlalu panjang.');
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Hanya response_type=code.');
  const challenge = q.get('code_challenge') || '';
  if (!challenge) return back('invalid_request', 'PKCE wajib: kirim code_challenge.');
  if ((q.get('code_challenge_method') || 'plain') !== 'S256') return back('invalid_request', 'code_challenge_method harus S256.');
  if (!CHALLENGE_RE.test(challenge)) return back('invalid_request', 'code_challenge tidak valid.');
  const resource = q.get('resource');
  if (resource && !sameResource(resource, url.origin)) return back('invalid_target', `resource harus ${resourceUrl(url.origin)}.`);
  const asked = (q.get('scope') || '').split(/\s+/).filter(Boolean);
  if (asked.length && !asked.includes(SCOPE) && asked.some((s) => s.startsWith('satu-alur.'))) return back('invalid_scope', `Scope yang tersedia: ${SCOPE}.`);

  const id = randomId(32);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO oauth_requests (id_hash, client_id, redirect_uri, code_challenge, scope, resource, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await s256(id), client.client_id, redirectUri, challenge, SCOPE, resource ? resourceUrl(url.origin) : null, state || null, now, later(REQUEST_TTL_MS)),
  ]);
  return redirectTo(`${url.origin}/#/izin-ai?req=${id}`);
}

// ------------------------------------------------------------------ /oauth/token

function clientCredentials(request, body) {
  const h = request.headers.get('authorization') || '';
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(h.trim());
  if (m) {
    try {
      const [id, secret] = atob(m[1]).split(':');
      return { clientId: decodeURIComponent(id || ''), secret: decodeURIComponent(secret || '') };
    } catch { return { clientId: '', secret: '' }; }
  }
  return { clientId: String(body.client_id || ''), secret: body.client_secret ? String(body.client_secret) : '' };
}

async function revokeGrant(env, grantId) {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, grantId),
    env.DB.prepare('UPDATE mcp_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL').bind(now, grantId),
    env.DB.prepare('DELETE FROM oauth_refresh_tokens WHERE grant_id = ?').bind(grantId),
  ]);
}

async function issueTokens(env, grant, deps) {
  const access = newToken(ACCESS_PREFIX);
  const refresh = newToken(REFRESH_PREFIX);
  const now = nowIso();
  await env.DB.batch([
    // Housekeeping: expired access tokens and refresh tokens of this grant.
    env.DB.prepare("DELETE FROM mcp_tokens WHERE grant_id = ? AND kind = 'oauth' AND expires_at < ?").bind(grant.id, now),
    env.DB.prepare('DELETE FROM oauth_refresh_tokens WHERE grant_id = ? AND expires_at < ?').bind(grant.id, now),
    env.DB.prepare("INSERT INTO mcp_tokens (owner_id, name, token_hash, prefix, created_at, kind, grant_id, expires_at) VALUES (?, ?, ?, ?, ?, 'oauth', ?, ?)")
      .bind(grant.owner_id, grant.client_name || 'Claude', await deps.sha256Hex(access), tokenDisplayPrefix(access), now, grant.id, later(ACCESS_TTL_S * 1000)),
    env.DB.prepare('INSERT INTO oauth_refresh_tokens (token_hash, grant_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await deps.sha256Hex(refresh), grant.id, now, later(REFRESH_TTL_MS)),
  ]);
  return jsonOut({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: grant.scope || SCOPE });
}

/** Account state that ends a grant: suspended or one of the shared demo accounts. */
async function ownerProblem(env, ownerId, deps) {
  const u = await env.DB.prepare('SELECT u.email, f.suspended FROM users u LEFT JOIN user_flags f ON f.user_id = u.id WHERE u.id = ?').bind(ownerId).first();
  if (!u) return 'Akun tidak ditemukan.';
  if (u.suspended === 1) return SUSPENDED_MESSAGE;
  if (deps.isDemoUser(u)) return 'Akun demo tidak bisa dipakai lewat Akses AI.';
  return null;
}

async function token(request, env, deps) {
  if (request.method !== 'POST') return oauthError('invalid_request', 'Gunakan POST.', 405, { allow: 'POST, OPTIONS' });
  if (!(await take(`otok:${clientIp(request)}`, OAUTH_LIMITS.tokenPerMinute, 60_000))) {
    return oauthError('slow_down', 'Terlalu banyak permintaan token. Coba lagi sebentar.', 429, { 'retry-after': '60' });
  }
  const { body, tooLarge } = await readBody(request);
  if (tooLarge) return oauthError('invalid_request', 'Permintaan terlalu besar.', 413);
  if (!body) return oauthError('invalid_request', 'Body tidak valid.');
  const { clientId, secret } = clientCredentials(request, body);
  const client = await loadClient(env, clientId);
  if (!client) return oauthError('invalid_client', 'client_id tidak dikenal.', 401);
  if (client.secret_hash && (!secret || (await s256(secret)) !== client.secret_hash)) {
    return oauthError('invalid_client', 'client_secret salah.', 401);
  }
  const now = nowIso();

  if (body.grant_type === 'authorization_code') {
    const code = String(body.code || '');
    const verifier = String(body.code_verifier || '');
    if (!code || code.length > 200) return oauthError('invalid_request', 'code wajib diisi.');
    if (!VERIFIER_RE.test(verifier)) return oauthError('invalid_request', 'code_verifier wajib (PKCE, 43-128 karakter).');
    const row = await env.DB.prepare(
      'SELECT c.*, g.revoked_at AS grant_revoked_at, g.client_name, g.scope AS grant_scope FROM oauth_codes c JOIN oauth_grants g ON g.id = c.grant_id WHERE c.code_hash = ?',
    ).bind(await deps.sha256Hex(code)).first();
    if (!row) return oauthError('invalid_grant', 'Kode otorisasi tidak valid.');
    if (row.client_id !== client.client_id) return oauthError('invalid_grant', 'Kode otorisasi bukan untuk klien ini.');
    if (row.used_at) {
      // A code presented twice: someone else may hold it. End everything issued from it.
      await revokeGrant(env, row.grant_id);
      return oauthError('invalid_grant', 'Kode otorisasi sudah dipakai.');
    }
    if (row.expires_at <= now) return oauthError('invalid_grant', 'Kode otorisasi sudah kedaluwarsa. Ulangi login dari Claude.');
    if (body.redirect_uri !== undefined && body.redirect_uri !== row.redirect_uri) return oauthError('invalid_grant', 'redirect_uri tidak cocok.');
    if ((await s256(verifier)) !== row.code_challenge) return oauthError('invalid_grant', 'code_verifier tidak cocok (PKCE).');
    if (row.grant_revoked_at) return oauthError('invalid_grant', 'Koneksi ini sudah diputuskan.');
    const used = await env.DB.prepare('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').bind(now, row.code_hash).run();
    if (!Number(used?.meta?.changes)) {
      await revokeGrant(env, row.grant_id);
      return oauthError('invalid_grant', 'Kode otorisasi sudah dipakai.');
    }
    const problem = await ownerProblem(env, row.owner_id, deps);
    if (problem) return oauthError('invalid_grant', problem);
    return issueTokens(env, { id: row.grant_id, owner_id: row.owner_id, client_name: row.client_name, scope: row.grant_scope }, deps);
  }

  if (body.grant_type === 'refresh_token') {
    const rt = String(body.refresh_token || '');
    if (!REFRESH_RE.test(rt)) return oauthError('invalid_grant', 'Refresh token tidak valid.');
    const row = await env.DB.prepare(
      `SELECT r.token_hash, r.grant_id, r.expires_at, r.used_at, g.owner_id, g.client_id, g.client_name, g.scope, g.revoked_at
         FROM oauth_refresh_tokens r JOIN oauth_grants g ON g.id = r.grant_id WHERE r.token_hash = ?`,
    ).bind(await deps.sha256Hex(rt)).first();
    if (!row || row.client_id !== client.client_id) return oauthError('invalid_grant', 'Refresh token tidak valid.');
    if (row.revoked_at) return oauthError('invalid_grant', 'Koneksi ini sudah diputuskan. Hubungkan ulang Claude untuk login lagi.');
    if (row.used_at) {
      // Rotation: an old refresh token came back, so it leaked. Revoke the whole family.
      await revokeGrant(env, row.grant_id);
      return oauthError('invalid_grant', 'Refresh token sudah pernah dipakai; koneksi diputuskan demi keamanan. Hubungkan ulang Claude.');
    }
    if (row.expires_at <= now) return oauthError('invalid_grant', 'Refresh token sudah kedaluwarsa. Hubungkan ulang Claude.');
    const used = await env.DB.prepare('UPDATE oauth_refresh_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now, row.token_hash).run();
    if (!Number(used?.meta?.changes)) {
      await revokeGrant(env, row.grant_id);
      return oauthError('invalid_grant', 'Refresh token sudah pernah dipakai; koneksi diputuskan demi keamanan.');
    }
    const problem = await ownerProblem(env, row.owner_id, deps);
    if (problem) return oauthError('invalid_grant', problem);
    return issueTokens(env, { id: row.grant_id, owner_id: row.owner_id, client_name: row.client_name, scope: row.scope }, deps);
  }

  return oauthError('unsupported_grant_type', 'grant_type harus authorization_code atau refresh_token.');
}

// ------------------------------------------------------------------ /oauth/revoke (RFC 7009)

async function revoke(request, env, deps) {
  if (request.method !== 'POST') return oauthError('invalid_request', 'Gunakan POST.', 405);
  const { body } = await readBody(request);
  const t = String(body?.token || '');
  if (!t) return oauthError('invalid_request', 'token wajib diisi.');
  const hash = await deps.sha256Hex(t);
  const rt = await env.DB.prepare('SELECT grant_id FROM oauth_refresh_tokens WHERE token_hash = ?').bind(hash).first();
  if (rt) await revokeGrant(env, rt.grant_id);
  else await env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE token_hash = ? AND kind = 'oauth' AND revoked_at IS NULL").bind(nowIso(), hash).run();
  return jsonOut({}, 200);
}

/** /oauth/* entry point. deps: { sha256Hex, isDemoUser }. */
export async function handleOAuth(request, env, path, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  switch (path) {
    case '/oauth/register':
      if (request.method !== 'POST') return oauthError('invalid_request', 'Gunakan POST.', 405);
      return register(request, env);
    case '/oauth/authorize': return authorize(request, env);
    case '/oauth/token': return token(request, env, deps);
    case '/oauth/revoke': return revoke(request, env, deps);
    default: return oauthError('invalid_request', 'Endpoint OAuth tidak ditemukan.', 404);
  }
}

// ------------------------------------------------------------------ /api/oauth/* (session auth)

/** Why this signed-in user cannot connect Claude, or null. */
function refusal(user, deps) {
  if (user.is_staff === 1) return 'Akun staf Satu Alur tidak bisa menghubungkan Claude. Masuk dengan akun usaha untuk memberi izin.';
  if (deps.isDemoUser(user)) return 'Akun demo tidak bisa dihubungkan ke Claude. Masuk dengan akun usaha Anda sendiri untuk memberi izin.';
  return null;
}

async function pendingRequest(env, req, deps) {
  if (typeof req !== 'string' || !REQ_RE.test(req)) throw new deps.HttpError(400, 'Permintaan izin tidak valid.');
  const row = await env.DB.prepare(
    `SELECT r.*, c.client_name, c.client_uri FROM oauth_requests r JOIN oauth_clients c ON c.client_id = r.client_id
      WHERE r.id_hash = ? AND r.expires_at > ?`,
  ).bind(await s256(req), nowIso()).first();
  if (!row) throw new deps.HttpError(404, 'Permintaan izin ini sudah kedaluwarsa atau sudah dijawab. Ulangi hubungkan dari Claude.');
  return row;
}

const hostOf = (uri) => { try { return new URL(uri).host; } catch { return ''; } };

/** GET /api/oauth/request?req= -> what the consent page shows. */
export async function handleOAuthRequestGet(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const req = new URL(request.url).searchParams.get('req');
  const row = await pendingRequest(env, req, deps);
  let company = null;
  try { company = (await env.DB.prepare('SELECT company FROM customer_accounts WHERE owner_id = ?').bind(user.id).first())?.company || null; } catch { /* optional */ }
  return deps.ok({
    client_name: row.client_name || 'Claude',
    client_uri: row.client_uri || null,
    redirect_host: hostOf(row.redirect_uri),
    scope: row.scope,
    read_only: true,
    tools: TOOLS.map((t) => ({ name: t.name, title: t.title, summary: t.consent || t.title })),
    account: { email: user.email, name: user.name || null, company },
    refused: refusal(user, deps),
    expires_at: row.expires_at,
  });
}

/** POST /api/oauth/decision { req, approve } -> { redirect }. */
export async function handleOAuthDecision(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const body = await deps.readJson(request, 4096);
  const approve = body.approve === true;
  const row = await pendingRequest(env, body.req, deps);
  const refused = approve ? refusal(user, deps) : null;
  if (refused) throw new deps.HttpError(403, refused);
  // Single use: whoever deletes the row answers it.
  const gone = await env.DB.prepare('DELETE FROM oauth_requests WHERE id_hash = ?').bind(row.id_hash).run();
  if (!Number(gone?.meta?.changes)) throw new deps.HttpError(404, 'Permintaan izin ini sudah dijawab.');
  const state = row.state || undefined;
  if (!approve) {
    return deps.ok({ approved: false, redirect: withParams(row.redirect_uri, { error: 'access_denied', error_description: 'Pemilik akun menolak akses.', state }) });
  }
  const now = nowIso();
  const g = await env.DB.prepare(
    'INSERT INTO oauth_grants (owner_id, client_id, client_name, redirect_uri, scope, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(user.id, row.client_id, row.client_name || 'Claude', row.redirect_uri, row.scope, now).run();
  const grantId = g?.results?.[0]?.id ?? g?.meta?.last_row_id;
  const code = randomId(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    env.DB.prepare('INSERT INTO oauth_codes (code_hash, grant_id, client_id, owner_id, redirect_uri, code_challenge, scope, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await deps.sha256Hex(code), grantId, row.client_id, user.id, row.redirect_uri, row.code_challenge, row.scope, row.resource, now, later(CODE_TTL_MS)),
    env.DB.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').bind(now, row.client_id),
  ]);
  return deps.ok({ approved: true, redirect: withParams(row.redirect_uri, { code, state }) });
}

/** GET /api/oauth/grants -> { items: [{ id, client_name, redirect_host, created_at, last_used_at }], demo }. */
export async function handleOAuthGrantList(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const demo = deps.isDemoUser(user);
  if (demo || user.is_staff === 1) return deps.ok({ items: [], demo });
  const { results } = await env.DB.prepare(
    'SELECT id, client_name, redirect_uri, created_at, last_used_at FROM oauth_grants WHERE owner_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 100',
  ).bind(user.id).all();
  return deps.ok({
    items: (results || []).map((r) => ({ id: r.id, client_name: r.client_name, redirect_host: hostOf(r.redirect_uri), created_at: r.created_at, last_used_at: r.last_used_at || null })),
    demo: false,
  });
}

/** DELETE /api/oauth/grants/:id — "Putuskan": the app's tokens stop working at once. */
export async function handleOAuthGrantRevoke(request, env, deps, params) {
  const { user } = await deps.authenticate(request, env);
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new deps.HttpError(400, 'ID koneksi tidak valid.');
  const g = await env.DB.prepare('SELECT id FROM oauth_grants WHERE id = ? AND owner_id = ? AND revoked_at IS NULL').bind(id, user.id).first();
  if (!g) throw new deps.HttpError(404, 'Koneksi tidak ditemukan atau sudah diputuskan.');
  await revokeGrant(env, id);
  return deps.ok({ id, revoked: true });
}

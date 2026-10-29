/**
 * Social Media - Meta connection (Facebook Page + linked Instagram) and media.
 *
 *   GET    /api/social/account          { configured, account: { page_name, ig_username, needs_reconnect } | null }
 *   DELETE /api/social/account
 *   POST   /api/social/oauth/start      { url }  (state signed with META_APP_SECRET, 10 min)
 *   GET    /api/social/oauth/callback   no Bearer token; trusts only the signed state; 302 back to the app
 *   GET    /api/social/oauth/pages?pick=   [{ id, name, ig_username }]
 *   POST   /api/social/oauth/pick       { pick, page_id }
 *   POST   /api/social/media            raw JPEG body -> { key }
 *   GET    /api/media/:key              public, unguessable R2 object (Meta fetches it)
 *
 * Page tokens never leave the worker and are never logged: they are stored
 * AES-GCM encrypted (TOKEN_KEY) and the picker cache entry is encrypted too.
 */
import { oauthUrl, exchangeCode, listPages, MetaError } from '../src/social/meta.js';
import { encryptToken, decryptToken, signState, verifyState } from '../src/social/crypto.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const PICK_TTL_S = 10 * 60;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const HEX32_RE = /^[0-9a-f]{32}$/;
const CACHE_HOST = 'https://social-cache.satu-alur.internal';

const isConfigured = (env) => Boolean(env.META_APP_ID && env.META_APP_SECRET && env.TOKEN_KEY && env.PUBLIC_BASE_URL);
const redirectUri = (env) => `${env.PUBLIC_BASE_URL}/api/social/oauth/callback`;
const appUrl = (env, query) => `${env.PUBLIC_BASE_URL || ''}/#/social-media?${query}`;
const redirect = (location) => new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
const redirectError = (env, message) => redirect(appUrl(env, `social_error=${encodeURIComponent(message)}`));

function randomHex(nBytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(nBytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function requireConfigured(env, HttpError) {
  if (!isConfigured(env)) throw new HttpError(503, 'Integrasi Meta belum dikonfigurasi.');
}

async function storePage(env, ownerId, page) {
  const tokenEnc = await encryptToken(page.token, env.TOKEN_KEY);
  await env.DB.prepare(
    `INSERT INTO social_accounts (owner_id, page_id, page_name, page_token_enc, ig_user_id, ig_username, needs_reconnect, connected_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(owner_id) DO UPDATE SET page_id = excluded.page_id, page_name = excluded.page_name,
       page_token_enc = excluded.page_token_enc, ig_user_id = excluded.ig_user_id, ig_username = excluded.ig_username,
       needs_reconnect = 0, connected_at = excluded.connected_at`,
  ).bind(ownerId, page.id, page.name ?? null, tokenEnc, page.igUserId ?? null, page.igUsername ?? null, new Date().toISOString()).run();
}

async function accountOf(env, ownerId) {
  const row = await env.DB.prepare('SELECT page_name, ig_username, needs_reconnect FROM social_accounts WHERE owner_id = ?')
    .bind(ownerId).first();
  return row ? { page_name: row.page_name, ig_username: row.ig_username, needs_reconnect: Boolean(row.needs_reconnect) } : null;
}

// ---------------------------------------------------------- picker cache
// Cache API (with a per-isolate fallback, since it is a no-op on *.workers.dev).
// ponytail: the in-memory fallback only works when callback and picker hit the same isolate; use KV/D1 if that bites.
const memPicks = new Map(); // id -> { exp, blob }
const pickUrl = (id) => `${CACHE_HOST}/pick/${id}`;
const hasCacheApi = () => typeof caches !== 'undefined' && caches?.default;

async function putPick(env, id, value) {
  const blob = await encryptToken(JSON.stringify(value), env.TOKEN_KEY);
  if (memPicks.size > 200) memPicks.delete(memPicks.keys().next().value);
  memPicks.set(id, { exp: Date.now() + PICK_TTL_S * 1000, blob });
  if (!hasCacheApi()) return;
  try {
    await caches.default.put(pickUrl(id), new Response(blob, { headers: { 'cache-control': `public, max-age=${PICK_TTL_S}` } }));
  } catch { /* best effort */ }
}

async function getPick(env, id) {
  if (typeof id !== 'string' || !HEX32_RE.test(id)) return null;
  let blob = null;
  const mem = memPicks.get(id);
  if (mem && mem.exp > Date.now()) blob = mem.blob;
  if (!blob && hasCacheApi()) {
    try {
      const hit = await caches.default.match(pickUrl(id));
      if (hit) blob = await hit.text();
    } catch { /* ignore */ }
  }
  if (!blob) return null;
  try {
    return JSON.parse(await decryptToken(blob, env.TOKEN_KEY));
  } catch {
    return null;
  }
}

async function dropPick(id) {
  memPicks.delete(id);
  if (hasCacheApi()) await caches.default.delete(pickUrl(id)).catch(() => {});
}

async function ownPick(env, id, userId, HttpError) {
  const pick = await getPick(env, id);
  if (!pick || pick.ownerId !== userId) throw new HttpError(404, 'Pilihan Halaman kedaluwarsa, hubungkan ulang.');
  return pick;
}

// ----------------------------------------------------------------- routes

export async function handleSocialAccount(request, env, { authenticate, ok }) {
  const { user } = await authenticate(request, env);
  return ok({ configured: isConfigured(env), account: await accountOf(env, user.id) });
}

export async function handleSocialDisconnect(request, env, { authenticate, ok }) {
  const { user } = await authenticate(request, env);
  await env.DB.prepare('DELETE FROM social_accounts WHERE owner_id = ?').bind(user.id).run();
  return ok(null);
}

export async function handleSocialOauthStart(request, env, { authenticate, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  requireConfigured(env, HttpError);
  const state = await signState({ ownerId: user.id, exp: Date.now() + STATE_TTL_MS }, env.META_APP_SECRET);
  return ok({ url: oauthUrl({ appId: env.META_APP_ID, redirectUri: redirectUri(env), state }) });
}

export async function handleSocialOauthCallback(request, env) {
  const q = new URL(request.url).searchParams;
  const code = q.get('code');
  if (q.get('error') || !code) return redirectError(env, 'Koneksi dibatalkan.');
  if (!isConfigured(env)) return redirectError(env, 'Integrasi Meta belum dikonfigurasi.');
  const st = await verifyState(q.get('state'), env.META_APP_SECRET);
  if (!st) return redirectError(env, 'Sesi koneksi kedaluwarsa, coba lagi.');

  let pages;
  try {
    const userToken = await exchangeCode(
      { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, redirectUri: redirectUri(env), code },
      fetch,
    );
    pages = await listPages(userToken, fetch);
  } catch (e) {
    if (!(e instanceof MetaError)) console.error('Meta OAuth failed', e?.name); // no message: it could echo request data
    return redirectError(env, `Gagal terhubung ke Meta: ${e instanceof MetaError ? e.message : 'kesalahan tak terduga'}`);
  }
  if (pages.length === 0) return redirectError(env, 'Gagal terhubung ke Meta: tidak ada Halaman Facebook yang diizinkan.');
  if (pages.length === 1) {
    await storePage(env, st.ownerId, pages[0]);
    return redirect(appUrl(env, 'social=connected'));
  }
  const pick = randomHex(16);
  await putPick(env, pick, { ownerId: st.ownerId, pages });
  return redirect(appUrl(env, `social_pick=${pick}`));
}

export async function handleSocialOauthPages(request, env, { authenticate, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  requireConfigured(env, HttpError);
  const { pages } = await ownPick(env, new URL(request.url).searchParams.get('pick'), user.id, HttpError);
  return ok(pages.map((p) => ({ id: p.id, name: p.name, ig_username: p.igUsername ?? null })));
}

export async function handleSocialOauthPick(request, env, { authenticate, readJson, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  requireConfigured(env, HttpError);
  const body = await readJson(request);
  const { pages } = await ownPick(env, body.pick, user.id, HttpError);
  const page = pages.find((p) => p.id === body.page_id);
  if (!page) throw new HttpError(400, 'Halaman tidak dikenal.');
  await storePage(env, user.id, page);
  await dropPick(body.pick);
  return ok({ configured: true, account: await accountOf(env, user.id) });
}

export async function handleSocialMediaUpload(request, env, { authenticate, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  if (!env.MEDIA) throw new HttpError(503, 'Penyimpanan media belum dikonfigurasi.');
  if (!/^image\/jpeg\b/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'Gambar harus JPEG.');
  if (Number(request.headers.get('content-length') || 0) > MAX_MEDIA_BYTES) throw new HttpError(413, 'Gambar maksimal 8 MB.');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > MAX_MEDIA_BYTES) throw new HttpError(413, 'Gambar maksimal 8 MB.');
  if (buf.byteLength < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new HttpError(400, 'Berkas bukan gambar JPEG.');
  const key = randomHex(16);
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { owner_id: user.id } });
  return ok({ key });
}

export async function handleMediaGet(request, env, params) {
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!HEX32_RE.test(params.key || '') || !env.MEDIA) return notFound();
  const obj = await env.MEDIA.get(params.key);
  if (!obj) return notFound();
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

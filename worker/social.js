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
 *   POST   /api/social/publish          { content_id, platforms[] } -> social_posts rows (published now)
 *   POST   /api/social/schedule         { content_id, platforms[], scheduled_at } -> social_posts rows
 *   DELETE /api/social/schedule/:id     cancels a still-scheduled row (409 once processed)
 *   cron   runCron(env)                 sweeps stuck rows, then publishes up to 25 due rows
 *
 * Page tokens never leave the worker and are never logged: they are stored
 * AES-GCM encrypted (TOKEN_KEY) and the picker cache entry is encrypted too.
 */
import { oauthUrl, exchangeCode, listPages, MetaError } from '../src/social/meta.js';
import { encryptToken, decryptToken, signState, verifyState } from '../src/social/crypto.js';
import { PLATFORMS, validateScheduleAt, igEligibility } from '../src/social/rules.js';
import { publishRow, runDue, sweepStuck } from '../src/social/runner.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const PICK_TTL_S = 10 * 60;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const HEX32_RE = /^[0-9a-f]{32}$/;
const CACHE_HOST = 'https://social-cache.satu-alur.internal';

const isConfigured = (env) => Boolean(env.META_APP_ID && env.META_APP_SECRET && env.TOKEN_KEY && env.PUBLIC_BASE_URL);
const redirectUri = (env) => `${env.PUBLIC_BASE_URL}/api/social/oauth/callback`;
const appUrl = (env, query) => `${env.PUBLIC_BASE_URL || ''}/#/social-media?${query}`;
// Binds the OAuth state to the browser that started it (login CSRF). One-shot: every callback clears it.
const NONCE_COOKIE = '__Host-social_nonce';
const nonceCookie = (value, maxAge) => `${NONCE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
function cookieNonce(request) {
  const m = new RegExp(`(?:^|;\\s*)${NONCE_COOKIE}=([0-9a-f]{32})(?:;|$)`).exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
}
// Only the callback redirects, so every redirect also clears the nonce cookie.
const redirect = (location) => new Response(null, {
  status: 302,
  headers: { location, 'cache-control': 'no-store', 'set-cookie': nonceCookie('', 0) },
});
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
  const nonce = randomHex(16);
  const state = await signState({ ownerId: user.id, exp: Date.now() + STATE_TTL_MS, nonce }, env.META_APP_SECRET);
  const res = ok({ url: oauthUrl({ appId: env.META_APP_ID, redirectUri: redirectUri(env), state }) });
  res.headers.append('set-cookie', nonceCookie(nonce, STATE_TTL_MS / 1000));
  return res;
}

export async function handleSocialOauthCallback(request, env) {
  const q = new URL(request.url).searchParams;
  const code = q.get('code');
  if (q.get('error') || !code) return redirectError(env, 'Koneksi dibatalkan.');
  if (!isConfigured(env)) return redirectError(env, 'Integrasi Meta belum dikonfigurasi.');
  const st = await verifyState(q.get('state'), env.META_APP_SECRET);
  if (!st || !st.nonce || cookieNonce(request) !== st.nonce) return redirectError(env, 'Sesi koneksi kedaluwarsa, coba lagi.');

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

// ------------------------------------------------------------- publishing

// D1 store for src/social/runner.js. Marks only apply to a row still 'publishing' (i.e. claimed by this run).
function d1Store(env) {
  const db = env.DB;
  return {
    async listDue(nowIso, limit) {
      const { results } = await db.prepare(
        "SELECT * FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT ?",
      ).bind(nowIso, limit).all();
      return results;
    },
    async claim(id, nowIso) {
      const r = await db.prepare("UPDATE social_posts SET status = 'publishing', claimed_at = ? WHERE id = ? AND status = 'scheduled'")
        .bind(nowIso, id).run();
      return r.meta.changes === 1;
    },
    async markPosted(id, { platform_post_id, permalink, published_at }) {
      await db.prepare(
        "UPDATE social_posts SET status = 'posted', platform_post_id = ?, permalink = ?, published_at = ?, error = NULL WHERE id = ? AND status = 'publishing'",
      ).bind(platform_post_id, permalink, published_at, id).run();
    },
    async requeue(id, error) {
      await db.prepare(
        "UPDATE social_posts SET status = 'scheduled', attempts = attempts + 1, error = ? WHERE id = ? AND status = 'publishing'",
      ).bind(error, id).run();
    },
    async markFailed(id, error) {
      await db.prepare("UPDATE social_posts SET status = 'failed', error = ? WHERE id = ? AND status = 'publishing'")
        .bind(error, id).run();
    },
    async flagReconnect(ownerId) {
      await db.prepare('UPDATE social_accounts SET needs_reconnect = 1 WHERE owner_id = ?').bind(ownerId).run();
    },
    async listStuck(beforeIso) {
      const { results } = await db.prepare("SELECT id FROM social_posts WHERE status = 'publishing' AND claimed_at < ?")
        .bind(beforeIso).all();
      return results;
    },
  };
}

function runnerDeps(env) {
  return {
    store: d1Store(env),
    async getAccount(ownerId) {
      const row = await env.DB.prepare('SELECT page_id, page_token_enc, ig_user_id FROM social_accounts WHERE owner_id = ?')
        .bind(ownerId).first();
      if (!row) return null;
      return { page_id: row.page_id, pageToken: await decryptToken(row.page_token_enc, env.TOKEN_KEY), ig_user_id: row.ig_user_id };
    },
    mediaUrl: (key) => `${env.PUBLIC_BASE_URL}/api/media/${key}`,
    fetchFn: fetch,
    now: Date.now,
  };
}

export async function runCron(env) {
  if (!isConfigured(env)) return;
  const deps = runnerDeps(env);
  await sweepStuck(deps);
  await runDue(deps, 25);
}

// Validates the request and inserts one social_posts row per platform.
async function createPosts(env, userId, body, scheduledAt, HttpError) {
  requireConfigured(env, HttpError);
  const platforms = [...new Set(Array.isArray(body.platforms) ? body.platforms : [])];
  if (platforms.length === 0 || !platforms.every((p) => PLATFORMS.includes(p))) {
    throw new HttpError(400, 'Pilih platform Facebook dan/atau Instagram.');
  }
  const contentId = Number(body.content_id);
  const content = Number.isInteger(contentId)
    ? await env.DB.prepare('SELECT body, image_key FROM social_contents WHERE id = ? AND owner_id = ?').bind(contentId, userId).first()
    : null;
  if (!content) throw new HttpError(404, 'Konten tidak ditemukan.');
  const account = await env.DB.prepare('SELECT page_id, ig_user_id FROM social_accounts WHERE owner_id = ?').bind(userId).first();
  if (!account) throw new HttpError(400, 'Hubungkan akun Facebook terlebih dahulu.');
  if (platforms.includes('instagram')) {
    if (!content.image_key) throw new HttpError(400, 'Instagram wajib memakai gambar.');
    if (!account.ig_user_id) throw new HttpError(400, 'Akun Instagram belum terhubung.');
    // Image size is unknown here (the browser checks the ratio); 1x1 passes it so only the caption rules apply.
    const ig = igEligibility({ hasImage: true, width: 1, height: 1, caption: content.body || '' });
    if (!ig.ok) throw new HttpError(400, ig.reason);
  }
  const insert = env.DB.prepare(
    'INSERT INTO social_posts (owner_id, content_id, platform, content, image_key, page_id, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  );
  const res = await env.DB.batch(platforms.map((p) =>
    insert.bind(userId, contentId, p, content.body || '', content.image_key ?? null, account.page_id, scheduledAt)));
  return res.map((r) => r.results[0]);
}

export async function handleSocialPublish(request, env, { authenticate, readJson, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  const body = await readJson(request);
  const rows = await createPosts(env, user.id, body, new Date().toISOString(), HttpError);
  const deps = runnerDeps(env);
  for (const row of rows) {
    try {
      await publishRow(row, deps);
    } catch (err) {
      console.error('Social publish row failed', err?.name); // the re-select below shows its real status
    }
  }
  const ids = rows.map((r) => r.id);
  const { results } = await env.DB.prepare(`SELECT * FROM social_posts WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .bind(...ids).all();
  return ok(results);
}

export async function handleSocialSchedule(request, env, { authenticate, readJson, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  const body = await readJson(request);
  const err = validateScheduleAt(body.scheduled_at, Date.now());
  if (err) throw new HttpError(400, err);
  return ok(await createPosts(env, user.id, body, new Date(body.scheduled_at).toISOString(), HttpError));
}

export async function handleSocialScheduleCancel(request, env, { authenticate, ok, HttpError }, params) {
  const { user } = await authenticate(request, env);
  if (!/^\d+$/.test(params.id || '')) throw new HttpError(404, 'Jadwal tidak ditemukan.');
  const r = await env.DB.prepare("UPDATE social_posts SET status = 'cancelled' WHERE id = ? AND owner_id = ? AND status = 'scheduled'")
    .bind(Number(params.id), user.id).run();
  if (r.meta.changes !== 1) throw new HttpError(409, 'Jadwal sudah diproses.');
  return ok(null);
}

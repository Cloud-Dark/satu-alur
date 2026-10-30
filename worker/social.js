/**
 * Social Media - Meta connection (Facebook Page + linked Instagram), Threads connection, and media.
 *
 *   GET    /api/social/account          { configured, threads_configured, account: { fb_connected, page_name, ig_username, ig_connected,
 *                                          needs_reconnect, threads_connected, threads_username, threads_needs_reconnect } | null }
 *   DELETE /api/social/account          disconnects Facebook (and Instagram) only; Threads stays
 *   POST   /api/social/threads/start    { url }  (state signed with THREADS_APP_SECRET, purpose 'threads', 10 min)
 *   GET    /api/social/threads/callback no Bearer token; signed state + nonce cookie; 302 back with social=threads_connected
 *   DELETE /api/social/threads          disconnects Threads only
 *   POST   /api/social/oauth/start      { url }  (state signed with META_APP_SECRET, 10 min)
 *   GET    /api/social/oauth/callback   no Bearer token; trusts only the signed state; 302 back to the app
 *   GET    /api/social/oauth/pages?pick=   [{ id, name, ig_username }]
 *   POST   /api/social/oauth/pick       { pick, page_id }
 *   POST   /api/social/media            raw JPEG body -> { key }  (connected business or admin only)
 *   GET    /api/media/:key              public, unguessable R2 object (Meta fetches it)
 *   POST   /api/social/publish          { content_id, platforms[] } -> social_posts rows (published now)
 *   POST   /api/social/schedule         { content_id, platforms[], scheduled_at } -> social_posts rows
 *   DELETE /api/social/schedule/:id     cancels a still-scheduled row (409 once processed)
 *   cron   runCron(env)                 refreshes Threads tokens expiring within 10 days (max 20), sweeps stuck rows,
 *                                       then publishes up to 15 due rows
 *
 * Page and Threads tokens never leave the worker and are never logged: they are stored
 * AES-GCM encrypted (TOKEN_KEY) and the multi-Page pick (social_oauth_picks) is encrypted too.
 * While DEMO_OTP is "true" anyone can sign in as any email, so Meta and Threads count as unconfigured and
 * nobody is admin. Shared DEMO_EMAILS accounts can never connect, upload or publish.
 */
import {
  oauthUrl, exchangeCode, listPages, MetaError, threadsOauthUrl, exchangeThreadsCode, threadsProfile, refreshThreadsToken,
} from '../src/social/meta.js';
import { encryptToken, decryptToken, signState, verifyState } from '../src/social/crypto.js';
import { PLATFORMS, validateScheduleAt, igEligibility, threadsEligibility } from '../src/social/rules.js';
import { publishRow, cronTick, refreshThreads } from '../src/social/runner.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const PICK_TTL_S = 10 * 60;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const HEX32_RE = /^[0-9a-f]{32}$/;
const DEMO_DENIED = 'Tidak tersedia di akun demo.';
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_AHEAD_MS = 10 * DAY_MS;
const REFRESH_BATCH = 20;

export const isConfigured = (env) => env.DEMO_OTP !== 'true'
  && Boolean(env.META_APP_ID && env.META_APP_SECRET && env.TOKEN_KEY && env.PUBLIC_BASE_URL);
export const isThreadsConfigured = (env) => env.DEMO_OTP !== 'true'
  && Boolean(env.THREADS_APP_ID && env.THREADS_APP_SECRET && env.TOKEN_KEY && env.PUBLIC_BASE_URL);
// Staff = a session created by POST /api/auth/staff-login (username + password); see worker/staff.js.
export const isAdminUser = (user) => user?.is_staff === 1;
const isDemoUser = (user, deps) => deps.DEMO_EMAILS.has(String(user.email || '').toLowerCase());
// Authenticates and rejects the shared demo accounts (one user per business, shared by every visitor).
export async function realUser(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemoUser(user, deps)) throw new deps.HttpError(403, DEMO_DENIED);
  return user;
}
const redirectUri = (env) => `${env.PUBLIC_BASE_URL}/api/social/oauth/callback`;
const threadsRedirectUri = (env) => `${env.PUBLIC_BASE_URL}/api/social/threads/callback`;
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
function requireThreadsConfigured(env, HttpError) {
  if (!isThreadsConfigured(env)) throw new HttpError(503, 'Integrasi Threads belum dikonfigurasi.');
}

// Each upsert only touches its own half of the row, so connecting one never changes the other.
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

async function storeThreads(env, ownerId, { id, username, token, expiresIn }) {
  const tokenEnc = await encryptToken(token, env.TOKEN_KEY);
  const expiresAt = new Date(Date.now() + (Number(expiresIn) || 60 * 24 * 60 * 60) * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO social_accounts (owner_id, threads_user_id, threads_username, threads_token_enc, threads_expires_at, threads_needs_reconnect)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(owner_id) DO UPDATE SET threads_user_id = excluded.threads_user_id, threads_username = excluded.threads_username,
       threads_token_enc = excluded.threads_token_enc, threads_expires_at = excluded.threads_expires_at, threads_needs_reconnect = 0`,
  ).bind(ownerId, String(id), username ?? null, tokenEnc, expiresAt).run();
}

// Clears one half of the row (no tokens left behind), then drops the row once both halves are gone.
async function clearHalf(env, ownerId, setSql) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE social_accounts SET ${setSql} WHERE owner_id = ?`).bind(ownerId),
    env.DB.prepare('DELETE FROM social_accounts WHERE owner_id = ? AND page_id IS NULL AND threads_user_id IS NULL').bind(ownerId),
  ]);
}

async function accountOf(env, ownerId) {
  const row = await env.DB.prepare(
    `SELECT page_id, page_name, ig_user_id, ig_username, needs_reconnect, threads_user_id, threads_username, threads_needs_reconnect
     FROM social_accounts WHERE owner_id = ?`,
  ).bind(ownerId).first();
  if (!row || (!row.page_id && !row.threads_user_id)) return null;
  return {
    fb_connected: Boolean(row.page_id), page_name: row.page_name, ig_username: row.ig_username, ig_connected: Boolean(row.page_id && row.ig_user_id),
    needs_reconnect: Boolean(row.needs_reconnect),
    threads_connected: Boolean(row.threads_user_id), threads_username: row.threads_username, threads_needs_reconnect: Boolean(row.threads_needs_reconnect),
  };
}

// ---------------------------------------------------------- picker (D1, encrypted, one-shot)

async function putPick(env, id, ownerId, pages) {
  const blob = await encryptToken(JSON.stringify(pages), env.TOKEN_KEY);
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM social_oauth_picks WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB.prepare('INSERT INTO social_oauth_picks (id, owner_id, blob, expires_at) VALUES (?, ?, ?, ?)')
      .bind(id, ownerId, blob, new Date(now.getTime() + PICK_TTL_S * 1000).toISOString()),
  ]);
}

async function getPick(env, id, ownerId) {
  if (typeof id !== 'string' || !HEX32_RE.test(id)) return null;
  const row = await env.DB.prepare('SELECT blob FROM social_oauth_picks WHERE id = ? AND owner_id = ? AND expires_at > ?')
    .bind(id, ownerId, new Date().toISOString()).first();
  if (!row) return null;
  try {
    return JSON.parse(await decryptToken(row.blob, env.TOKEN_KEY));
  } catch {
    return null;
  }
}

const dropPick = (env, id) => env.DB.prepare('DELETE FROM social_oauth_picks WHERE id = ?').bind(id).run();

async function ownPages(env, id, userId, HttpError) {
  const pages = await getPick(env, id, userId);
  if (!pages) throw new HttpError(404, 'Pilihan Halaman kedaluwarsa, hubungkan ulang.');
  return pages;
}

// ----------------------------------------------------------------- routes

export async function handleSocialAccount(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemoUser(user, deps)) return deps.ok({ configured: false, threads_configured: false, account: null });
  return deps.ok({ configured: isConfigured(env), threads_configured: isThreadsConfigured(env), account: await accountOf(env, user.id) });
}

export async function handleSocialDisconnect(request, env, { authenticate, ok }) {
  const { user } = await authenticate(request, env);
  await clearHalf(env, user.id,
    'page_id = NULL, page_name = NULL, page_token_enc = NULL, ig_user_id = NULL, ig_username = NULL, needs_reconnect = 0');
  return ok(null);
}

export async function handleThreadsDisconnect(request, env, { authenticate, ok }) {
  const { user } = await authenticate(request, env);
  await clearHalf(env, user.id,
    'threads_user_id = NULL, threads_username = NULL, threads_token_enc = NULL, threads_expires_at = NULL, threads_needs_reconnect = 0');
  return ok(null);
}

export async function handleSocialOauthStart(request, env, deps) {
  const { ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  requireConfigured(env, HttpError);
  const nonce = randomHex(16);
  const state = await signState({ ownerId: user.id, exp: Date.now() + STATE_TTL_MS, nonce, purpose: 'facebook' }, env.META_APP_SECRET);
  const res = ok({ url: oauthUrl({ appId: env.META_APP_ID, redirectUri: redirectUri(env), state }) });
  res.headers.append('set-cookie', nonceCookie(nonce, STATE_TTL_MS / 1000));
  return res;
}

export async function handleSocialOauthCallback(request, env) {
  const q = new URL(request.url).searchParams;
  const code = q.get('code');
  if (q.get('error') || !code) return redirectError(env, 'Koneksi dibatalkan.');
  if (!isConfigured(env)) return redirectError(env, 'Integrasi Meta belum dikonfigurasi.');
  const st = await verifyState(q.get('state'), env.META_APP_SECRET, Date.now(), 'facebook');
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
  await putPick(env, pick, st.ownerId, pages);
  return redirect(appUrl(env, `social_pick=${pick}`));
}

export async function handleThreadsStart(request, env, deps) {
  const { ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  requireThreadsConfigured(env, HttpError);
  const nonce = randomHex(16);
  const state = await signState({ ownerId: user.id, exp: Date.now() + STATE_TTL_MS, nonce, purpose: 'threads' }, env.THREADS_APP_SECRET);
  const res = ok({ url: threadsOauthUrl({ appId: env.THREADS_APP_ID, redirectUri: threadsRedirectUri(env), state }) });
  res.headers.append('set-cookie', nonceCookie(nonce, STATE_TTL_MS / 1000));
  return res;
}

export async function handleThreadsCallback(request, env) {
  const q = new URL(request.url).searchParams;
  const code = q.get('code');
  if (q.get('error') || !code) return redirectError(env, 'Koneksi dibatalkan.');
  if (!isThreadsConfigured(env)) return redirectError(env, 'Integrasi Threads belum dikonfigurasi.');
  const st = await verifyState(q.get('state'), env.THREADS_APP_SECRET, Date.now(), 'threads');
  if (!st || !st.nonce || cookieNonce(request) !== st.nonce) return redirectError(env, 'Sesi koneksi kedaluwarsa, coba lagi.');
  try {
    const { token, expiresIn } = await exchangeThreadsCode(
      { appId: env.THREADS_APP_ID, appSecret: env.THREADS_APP_SECRET, redirectUri: threadsRedirectUri(env), code },
      fetch,
    );
    const profile = await threadsProfile(token, fetch);
    if (!profile.id) throw new MetaError('profil Threads tidak terbaca');
    await storeThreads(env, st.ownerId, { ...profile, token, expiresIn });
  } catch (e) {
    if (!(e instanceof MetaError)) console.error('Threads OAuth failed', e?.name); // no message: it could echo request data
    return redirectError(env, `Gagal terhubung ke Threads: ${e instanceof MetaError ? e.message : 'kesalahan tak terduga'}`);
  }
  return redirect(appUrl(env, 'social=threads_connected'));
}

export async function handleSocialOauthPages(request, env, { authenticate, ok, HttpError }) {
  const { user } = await authenticate(request, env);
  requireConfigured(env, HttpError);
  const pages = await ownPages(env, new URL(request.url).searchParams.get('pick'), user.id, HttpError);
  return ok(pages.map((p) => ({ id: p.id, name: p.name, ig_username: p.igUsername ?? null })));
}

export async function handleSocialOauthPick(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  requireConfigured(env, HttpError);
  const body = await readJson(request);
  const pages = await ownPages(env, body.pick, user.id, HttpError);
  const page = pages.find((p) => p.id === body.page_id);
  if (!page) throw new HttpError(400, 'Halaman tidak dikenal.');
  await storePage(env, user.id, page);
  await dropPick(env, body.pick);
  return ok({ configured: true, threads_configured: isThreadsConfigured(env), account: await accountOf(env, user.id) });
}

export async function handleSocialMediaUpload(request, env, deps) {
  const { ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  const connected = (isConfigured(env) || isThreadsConfigured(env)) && (isAdminUser(user)
    || await env.DB.prepare('SELECT 1 FROM social_accounts WHERE owner_id = ?').bind(user.id).first());
  if (!connected) throw new HttpError(403, 'Hubungkan akun media sosial terlebih dahulu.');
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
    async listDue(nowIso, limit, platforms) {
      if (!platforms.length) return [];
      const { results } = await db.prepare(
        // Suspension cancels scheduled rows; this also skips one scheduled in a race with the suspend.
        `SELECT * FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= ?
           AND platform IN (${platforms.map(() => '?').join(',')})
           AND NOT EXISTS (SELECT 1 FROM user_flags f WHERE f.user_id = social_posts.owner_id AND f.suspended = 1)
         ORDER BY scheduled_at LIMIT ?`,
      ).bind(nowIso, ...platforms, limit).all();
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
    async flagReconnect(ownerId, platform) {
      const col = platform === 'threads' ? 'threads_needs_reconnect' : 'needs_reconnect';
      await db.prepare(`UPDATE social_accounts SET ${col} = 1 WHERE owner_id = ?`).bind(ownerId).run();
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
    // Decrypts only the token the row's platform needs: a bad Facebook token cannot fail a Threads post, or the reverse.
    async getAccount(ownerId, platform) {
      const row = await env.DB.prepare(
        'SELECT page_id, page_token_enc, ig_user_id, threads_user_id, threads_token_enc FROM social_accounts WHERE owner_id = ?',
      ).bind(ownerId).first();
      if (!row) return null;
      const th = platform === 'threads';
      const open = (blob, needed) => (blob && needed ? decryptToken(blob, env.TOKEN_KEY) : null);
      return {
        page_id: row.page_id, pageToken: await open(row.page_token_enc, !th), ig_user_id: row.ig_user_id,
        threads_user_id: row.threads_user_id, threadsToken: await open(row.threads_token_enc, th),
      };
    },
    mediaUrl: (key) => `${env.PUBLIC_BASE_URL}/api/media/${key}`,
    fetchFn: fetch,
    now: Date.now,
    enabled: { facebook: isConfigured(env), instagram: isConfigured(env), threads: isThreadsConfigured(env) },
  };
}

// D1 store for refreshThreads (src/social/runner.js). Writes match the old blob, so a reconnect made meanwhile is never overwritten.
function threadsRefreshStore(env, now) {
  const db = env.DB;
  return {
    async listRefreshable() {
      const { results } = await db.prepare(
        `SELECT owner_id, threads_token_enc, threads_expires_at FROM social_accounts
         WHERE threads_user_id IS NOT NULL AND threads_needs_reconnect = 0 AND threads_expires_at < ?
         ORDER BY threads_expires_at LIMIT ?`,
      ).bind(new Date(now + REFRESH_AHEAD_MS).toISOString(), REFRESH_BATCH).all();
      return results;
    },
    async saveToken(row, token, expiresAt) {
      await db.prepare('UPDATE social_accounts SET threads_token_enc = ?, threads_expires_at = ? WHERE owner_id = ? AND threads_token_enc = ?')
        .bind(await encryptToken(token, env.TOKEN_KEY), expiresAt, row.owner_id, row.threads_token_enc).run();
    },
    async flagThreads(row) {
      await db.prepare('UPDATE social_accounts SET threads_needs_reconnect = 1 WHERE owner_id = ? AND threads_token_enc = ?')
        .bind(row.owner_id, row.threads_token_enc).run();
    },
  };
}

export async function runCron(env) {
  if (!isConfigured(env) && !isThreadsConfigured(env)) return;
  const now = Date.now();
  // Long-lived Threads tokens last about 60 days; refresh them 10 days ahead.
  const refresh = isThreadsConfigured(env) ? () => refreshThreads({
    store: threadsRefreshStore(env, now),
    refresh: async (row) => refreshThreadsToken(await decryptToken(row.threads_token_enc, env.TOKEN_KEY), fetch),
    now: () => now,
  }) : null;
  await cronTick(runnerDeps(env), refresh);
}

// Validates the request and inserts one social_posts row per platform.
async function createPosts(env, userId, body, scheduledAt, HttpError) {
  const platforms = [...new Set(Array.isArray(body.platforms) ? body.platforms : [])];
  if (platforms.length === 0 || !platforms.every((p) => PLATFORMS.includes(p))) {
    throw new HttpError(400, 'Pilih platform Facebook, Instagram, dan/atau Threads.');
  }
  const threads = platforms.includes('threads');
  const meta = platforms.some((p) => p !== 'threads');
  if (meta) requireConfigured(env, HttpError);
  if (threads) requireThreadsConfigured(env, HttpError);
  const contentId = Number(body.content_id);
  const content = Number.isInteger(contentId)
    ? await env.DB.prepare('SELECT body, image_key FROM social_contents WHERE id = ? AND owner_id = ?').bind(contentId, userId).first()
    : null;
  if (!content) throw new HttpError(404, 'Konten tidak ditemukan.');
  // image_key is client-writable through /api/db: anything but an R2 key counts as no image.
  const imageKey = HEX32_RE.test(content.image_key || '') ? content.image_key : null;
  const account = await env.DB.prepare('SELECT page_id, ig_user_id, threads_user_id FROM social_accounts WHERE owner_id = ?')
    .bind(userId).first() || {};
  if (meta && !account.page_id) throw new HttpError(400, 'Hubungkan akun Facebook terlebih dahulu.');
  if (threads) {
    if (!account.threads_user_id) throw new HttpError(400, 'Akun Threads belum terhubung.');
    const th = threadsEligibility({ caption: content.body || '', hasImage: Boolean(imageKey) });
    if (!th.ok) throw new HttpError(400, th.reason);
  }
  if (platforms.includes('instagram')) {
    if (!imageKey) throw new HttpError(400, 'Instagram wajib memakai gambar.');
    if (!account.ig_user_id) throw new HttpError(400, 'Akun Instagram belum terhubung.');
    // Image size is unknown here (the browser checks the ratio); 1x1 passes it so only the caption rules apply.
    const ig = igEligibility({ hasImage: true, width: 1, height: 1, caption: content.body || '' });
    if (!ig.ok) throw new HttpError(400, ig.reason);
  }
  const insert = env.DB.prepare(
    'INSERT INTO social_posts (owner_id, content_id, platform, content, image_key, page_id, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  );
  const res = await env.DB.batch(platforms.map((p) =>
    insert.bind(userId, contentId, p, content.body || '', imageKey, p === 'threads' ? account.threads_user_id : account.page_id, scheduledAt)));
  return res.map((r) => r.results[0]);
}

export async function handleSocialPublish(request, env, routeDeps) {
  const { readJson, ok, HttpError } = routeDeps;
  const user = await realUser(request, env, routeDeps);
  const body = await readJson(request);
  const rows = await createPosts(env, user.id, body, new Date().toISOString(), HttpError);
  // Never requeue: the cron would post it later while the user may already be retrying by hand.
  const deps = { ...runnerDeps(env), requeue: false };
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

export async function handleSocialSchedule(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
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

/**
 * Social accounts through the business's OWN Repliz workspace (keys stored per business, worker/integrations.js).
 *
 *   GET    /api/social/repliz/status                  { configured, enabled, demo, platforms, capacity: { used, limit } | null }
 *   GET    /api/social/repliz/accounts                accounts in the business's workspace
 *   POST   /api/social/repliz/authorize               { platform, reconnect? } -> { url }; sets the signed state cookie
 *   GET    /api/social/repliz/callback/:platform      no Bearer token: an HTML page that reads ?code= or #access_token=
 *                                                     and POSTs it to /complete (the state cookie proves who started it)
 *   POST   /api/social/repliz/complete/:platform      { code } -> { connected: account } | { pick }
 *   GET    /api/social/repliz/picks/:id               pages / channels / organizations to choose from
 *   POST   /api/social/repliz/connect                 { pick, entity_id } -> { connected: account }
 *   DELETE /api/social/repliz/accounts/:id            removes the account from the workspace
 *   GET    /api/social/repliz/accounts/:id/boards     Pinterest boards
 *   POST   /api/social/repliz/schedule                { account_id, type, description, title?, medias, scheduleAt?, privacy?, board? }
 *   GET    /api/social/repliz/schedules               posts made from Satu Alur (pending ones refreshed from Repliz)
 *   DELETE /api/social/repliz/schedules/:id           cancels a post still pending
 *   POST   /api/social/repliz/media                   raw image/video body -> { url } (the workspace's storage)
 *
 * Every call uses the caller's own keys, so a business only ever reaches its own workspace. The connect state is
 * signed with TOKEN_KEY and names the owner, so the callback uses the right business's keys. Shared DEMO_EMAILS
 * accounts cannot connect or post. While DEMO_OTP is "true" the integration stays off (see integrationsEnabled).
 */
import { REPLIZ_PLATFORMS, PLATFORM_KEYS, validatePost, accountView, postLink } from '../src/repliz/rules.js';
import { signConnectState, verifyConnectState, derivedKeyB64, STATE_TTL_MS } from '../src/repliz/state.js';
import { encryptToken, decryptToken } from '../src/social/crypto.js';
import { createRepliz, ReplizError } from './repliz-client.js';
import { loadCredentials, integrationsEnabled, isDemo } from './integrations.js';

export { createRepliz, ReplizError };

const PICK_TTL_MS = 10 * 60 * 1000;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4' };
const STATE_COOKIE = '__Host-repliz_state';
const HEX32_RE = /^[0-9a-f]{32}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DEMO_DENIED = 'Tidak tersedia di akun demo.';
const NOT_CONNECTED = 'Hubungkan akun Repliz Anda terlebih dahulu di Media Sosial › Akun.';
const REFRESH_LIMIT = 10;

const baseUrl = (env, request) => (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');
export const callbackUrl = (env, request, platform) => `${baseUrl(env, request)}/api/social/repliz/callback/${platform}`;
const stateCookie = (value, maxAgeS) => `${STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeS}`;
function cookieState(request) {
  const m = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([A-Za-z0-9_.-]+)(?:;|$)`).exec(request.headers.get('cookie') || '');
  return m ? m[1] : null;
}
function randomHex(nBytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(nBytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function viaRepliz(deps, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ReplizError) throw new deps.HttpError(e.status, e.message);
    throw e;
  }
}
function validPlatform(platform, HttpError) {
  if (!PLATFORM_KEYS.includes(platform)) throw new HttpError(400, 'Platform tidak dikenal.');
  return REPLIZ_PLATFORMS[platform];
}
// The business's Repliz client, or a 409 telling it to connect Repliz first.
async function clientFor(env, deps, ownerId) {
  const cfg = await loadCredentials(env, ownerId, 'repliz');
  if (!cfg) throw new deps.HttpError(409, NOT_CONNECTED);
  return createRepliz(cfg, deps.fetchImpl);
}
async function realUser(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemo(user, deps)) throw new deps.HttpError(403, DEMO_DENIED);
  return user;
}
// A workspace account by id, or 404.
async function accountIn(rz, deps, id) {
  if (!ID_RE.test(String(id || ''))) throw new deps.HttpError(404, 'Akun tidak ditemukan.');
  try {
    return accountView(await rz.account(String(id)));
  } catch (e) {
    if (e instanceof ReplizError && e.status === 404) throw new deps.HttpError(404, 'Akun tidak ditemukan.');
    if (e instanceof ReplizError) throw new deps.HttpError(e.status, e.message);
    throw e;
  }
}
const label = (a) => (a.username ? `@${a.username.replace(/^@/, '')}` : a.name || '');

// ---------------------------------------------------------- picker (encrypted, one-shot, 10 min)

async function putPick(env, ownerId, data) {
  const id = randomHex(16);
  const blob = await encryptToken(JSON.stringify(data), await derivedKeyB64(env.TOKEN_KEY));
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM social_oauth_picks WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB.prepare('INSERT INTO social_oauth_picks (id, owner_id, blob, expires_at) VALUES (?, ?, ?, ?)')
      .bind(id, ownerId, blob, new Date(now.getTime() + PICK_TTL_MS).toISOString()),
  ]);
  return id;
}
async function getPick(env, id, ownerId) {
  if (!HEX32_RE.test(String(id || '')) || !env.TOKEN_KEY) return null;
  const row = await env.DB.prepare('SELECT blob FROM social_oauth_picks WHERE id = ? AND owner_id = ? AND expires_at > ?')
    .bind(id, ownerId, new Date().toISOString()).first();
  if (!row) return null;
  try {
    const data = JSON.parse(await decryptToken(row.blob, await derivedKeyB64(env.TOKEN_KEY)));
    return data?.kind === 'repliz' ? data : null;
  } catch {
    return null;
  }
}
const entityView = (e) => ({ id: String(e.id), name: String(e.name || e.username || e.id), username: String(e.username || ''), picture: typeof e.picture === 'string' && e.picture.startsWith('https://') ? e.picture : '' });
const connectedView = async (rz, accountId, platform) => ({ ...accountView(await rz.account(accountId), platform), needs_reconnect: false });

// ----------------------------------------------------------------- routes

export async function handleReplizStatus(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const platforms = PLATFORM_KEYS.map((key) => ({ key, label: REPLIZ_PLATFORMS[key].label, types: REPLIZ_PLATFORMS[key].types }));
  const demo = isDemo(user, deps);
  const out = { enabled: integrationsEnabled(env) && Boolean(env.TOKEN_KEY), demo, platforms, configured: false, capacity: null };
  const cfg = demo ? null : await loadCredentials(env, user.id, 'repliz');
  if (!cfg) return deps.ok(out);
  out.configured = true;
  try {
    const c = await createRepliz(cfg, deps.fetchImpl).count();
    if (c && Number.isFinite(Number(c.total))) out.capacity = { used: Number(c.total), limit: Number.isFinite(Number(c.limit)) ? Number(c.limit) : null };
  } catch (e) {
    if (e instanceof ReplizError) out.error = e.message;
  }
  return deps.ok(out);
}

export async function handleReplizAccounts(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (isDemo(user, deps)) return deps.ok([]);
  const rz = await clientFor(env, deps, user.id);
  const res = await viaRepliz(deps, () => rz.accounts());
  const docs = (Array.isArray(res?.docs) ? res.docs : []).filter((a) => PLATFORM_KEYS.includes(a?.type));
  return deps.ok(docs.map((a) => { const v = accountView(a); return { ...v, needs_reconnect: !v.connected }; }));
}

export async function handleReplizAuthorize(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  const rz = await clientFor(env, deps, user.id);
  const body = await readJson(request);
  const platform = String(body.platform || '');
  validPlatform(platform, HttpError);
  let reconnect = null;
  if (body.reconnect) {
    const a = await accountIn(rz, deps, body.reconnect);
    if (a.platform !== platform) throw new HttpError(404, 'Akun tidak ditemukan.');
    reconnect = a.id;
  }
  const res = await viaRepliz(deps, () => rz.authorize(platform, callbackUrl(env, request, platform)));
  if (!res?.url || !/^https:\/\//.test(res.url)) throw new HttpError(502, 'Alamat masuk platform tidak tersedia.');
  const state = await signConnectState({ ownerId: user.id, platform, reconnect, nonce: randomHex(8), exp: Date.now() + STATE_TTL_MS }, env.TOKEN_KEY);
  const out = ok({ url: res.url });
  out.headers.append('set-cookie', stateCookie(state, STATE_TTL_MS / 1000));
  return out;
}

// The page the social platform returns to. Facebook puts the token in the URL fragment, which never reaches
// the server, so this page reads both the query and the fragment and posts the code to /complete.
export function handleReplizCallback(request, env, params) {
  const platform = String(params.platform || '');
  const nonce = randomHex(16);
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Menghubungkan akun…</title>
<style>body{font-family:system-ui,sans-serif;background:#F6F1E7;color:#1B2420;display:grid;place-items:center;min-height:100vh;margin:0}p{font-size:16px}</style></head>
<body><p id="m">Menghubungkan akun…</p>
<script nonce="${nonce}">(function(){
var p=${JSON.stringify(PLATFORM_KEYS.includes(platform) ? platform : '')};
var q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.replace(/^#/,''));
var code=q.get('code')||h.get('access_token')||h.get('code');
history.replaceState(null,'',location.pathname);
function go(s){location.replace('/#/social-media?'+s)}
if(!p||!code){go('repliz_error='+encodeURIComponent('Koneksi dibatalkan.'));return}
fetch('/api/social/repliz/complete/'+p,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({code:code})})
.then(function(r){return r.json().catch(function(){return {}})})
.then(function(j){if(j&&j.data&&j.data.pick)go('repliz_pick='+j.data.pick);else if(j&&j.data&&j.data.connected)go('repliz=connected');else go('repliz_error='+encodeURIComponent((j&&j.error&&j.error.message)||'Koneksi gagal, coba lagi.'))})
.catch(function(){go('repliz_error='+encodeURIComponent('Koneksi gagal, coba lagi.'))});
})();</script></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}

// POST from the callback page. No Bearer token: the signed state cookie names the owner and the platform.
export async function handleReplizComplete(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const platform = String(params.platform || '');
  const p = validPlatform(platform, HttpError);
  if (!env.TOKEN_KEY) throw new HttpError(401, 'Sesi koneksi kedaluwarsa, coba lagi.');
  const st = await verifyConnectState(cookieState(request), env.TOKEN_KEY, platform);
  if (!st) throw new HttpError(401, 'Sesi koneksi kedaluwarsa, coba lagi.');
  const rz = await clientFor(env, deps, st.ownerId);
  const body = await readJson(request);
  const code = String(body.code || '');
  if (!code || code.length > 4096) throw new HttpError(400, 'Koneksi dibatalkan.');
  const done = (data) => {
    const res = ok(data);
    res.headers.append('set-cookie', stateCookie('', 0)); // one-shot
    return res;
  };
  if (p.flow === 'code') {
    const res = await viaRepliz(deps, () => rz.connect(platform, { code }, st.reconnect));
    if (!res?.accountId) throw new HttpError(502, 'Platform tidak mengembalikan akun.');
    return done({ connected: await viaRepliz(deps, () => connectedView(rz, String(res.accountId), platform)) });
  }
  const ex = await viaRepliz(deps, () => rz.exchange(platform, code));
  if (!ex?.token) throw new HttpError(502, 'Platform tidak mengembalikan izin akses.');
  const list = await viaRepliz(deps, () => rz.entities(platform, p.entity, ex.token));
  const entities = (Array.isArray(list?.docs) ? list.docs : []).filter((e) => e && e.id);
  if (!entities.length) throw new HttpError(404, `Tidak ada ${p.entityLabel} yang bisa dihubungkan.`);
  if (entities.length === 1) {
    const e = entities[0];
    const res = await viaRepliz(deps, () => rz.connect(platform, { [p.entityKey]: String(e.id), token: e.token || ex.token }, st.reconnect));
    if (!res?.accountId) throw new HttpError(502, 'Platform tidak mengembalikan akun.');
    return done({ connected: await viaRepliz(deps, () => connectedView(rz, String(res.accountId), platform)) });
  }
  const pick = await putPick(env, st.ownerId, {
    kind: 'repliz', platform, reconnect: st.reconnect, token: ex.token,
    entities: entities.map((e) => ({ ...entityView(e), token: typeof e.token === 'string' ? e.token : null })),
  });
  return done({ pick });
}

export async function handleReplizPick(request, env, deps, params) {
  const user = await realUser(request, env, deps);
  const data = await getPick(env, params.id, user.id);
  if (!data) throw new deps.HttpError(404, 'Pilihan kedaluwarsa, hubungkan ulang.');
  return deps.ok({ platform: data.platform, label: REPLIZ_PLATFORMS[data.platform].entityLabel, entities: data.entities.map(({ token, ...e }) => e) });
}

export async function handleReplizConnect(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  const rz = await clientFor(env, deps, user.id);
  const body = await readJson(request);
  const data = await getPick(env, body.pick, user.id);
  if (!data) throw new HttpError(404, 'Pilihan kedaluwarsa, hubungkan ulang.');
  const p = REPLIZ_PLATFORMS[data.platform];
  const e = data.entities.find((x) => x.id === String(body.entity_id));
  if (!e) throw new HttpError(400, `${p.entityLabel} tidak dikenal.`);
  const res = await viaRepliz(deps, () => rz.connect(data.platform, { [p.entityKey]: e.id, token: e.token || data.token }, data.reconnect));
  if (!res?.accountId) throw new HttpError(502, 'Platform tidak mengembalikan akun.');
  const connected = await viaRepliz(deps, () => connectedView(rz, String(res.accountId), data.platform));
  await env.DB.prepare('DELETE FROM social_oauth_picks WHERE id = ?').bind(body.pick).run();
  return ok({ connected });
}

export async function handleReplizDisconnect(request, env, deps, params) {
  const user = await realUser(request, env, deps);
  const rz = await clientFor(env, deps, user.id);
  const a = await accountIn(rz, deps, params.id);
  await viaRepliz(deps, () => rz.removeAccount(a.id));
  return deps.ok(null);
}

export async function handleReplizBoards(request, env, deps, params) {
  const user = await realUser(request, env, deps);
  const rz = await clientFor(env, deps, user.id);
  const a = await accountIn(rz, deps, params.id);
  if (a.platform !== 'pinterest') throw new deps.HttpError(400, 'Papan hanya ada di Pinterest.');
  const res = await viaRepliz(deps, () => rz.boards(a.id));
  return deps.ok((Array.isArray(res?.docs) ? res.docs : []).map((b) => ({ id: String(b.id), name: String(b.name || b.id), picture: typeof b.picture === 'string' ? b.picture : '' })));
}

export async function handleReplizSchedule(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  const rz = await clientFor(env, deps, user.id);
  const body = await readJson(request);
  const a = await accountIn(rz, deps, body.account_id);
  if (!a.connected) throw new HttpError(409, 'Sambungkan ulang akun ini di tab Akun terlebih dahulu.');
  const v = validatePost(a.platform, body);
  if (v.error) throw new HttpError(400, v.error);
  const res = await viaRepliz(deps, () => rz.createSchedule({ ...v.post, accountId: a.id }));
  if (!res?.scheduleId) throw new HttpError(502, 'Jadwal tidak tersimpan di platform.');
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO repliz_posts (owner_id, schedule_id, account_id, platform, account_label, type, preview, status, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING *`,
  ).bind(user.id, String(res.scheduleId), a.id, a.platform, label(a), v.post.type, (v.post.description || v.post.title || '').slice(0, 280),
    v.post.scheduleAt, now, now).first();
  return ok(postView(row));
}

function postView(r) {
  const username = r.account_label.startsWith('@') ? r.account_label.slice(1) : '';
  return {
    id: r.id, schedule_id: r.schedule_id, account_id: r.account_id, platform: r.platform, account_label: r.account_label, type: r.type,
    preview: r.preview, status: r.status, post_id: r.post_id || null, error: r.error || null, scheduled_at: r.scheduled_at, created_at: r.created_at,
    link: postLink(r.platform, r.post_id, username),
  };
}

export async function handleReplizSchedules(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const { results: rows } = await env.DB.prepare('SELECT * FROM repliz_posts WHERE owner_id = ? ORDER BY scheduled_at DESC LIMIT 50').bind(user.id).all();
  const cfg = rows.some((r) => ['pending', 'process'].includes(r.status)) ? await loadCredentials(env, user.id, 'repliz') : null;
  if (cfg) {
    const rz = createRepliz(cfg, deps.fetchImpl);
    let n = 0;
    for (const r of rows) {
      if (!['pending', 'process'].includes(r.status) || n >= REFRESH_LIMIT) continue;
      n += 1;
      try {
        const s = await rz.schedule(r.schedule_id);
        const status = ['pending', 'process', 'success', 'error'].includes(s?.status) ? s.status : r.status;
        const postId = s?.postId ? String(s.postId) : null;
        if (status !== r.status || postId !== (r.post_id || null)) {
          const error = status === 'error' ? 'Platform menolak unggahan ini. Periksa media dan teksnya.' : null;
          await env.DB.prepare('UPDATE repliz_posts SET status = ?, post_id = ?, error = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
            .bind(status, postId, error, new Date().toISOString(), r.id, user.id).run();
          Object.assign(r, { status, post_id: postId, error });
        }
      } catch { /* keep the last known status */ }
    }
  }
  return deps.ok(rows.map(postView));
}

export async function handleReplizScheduleCancel(request, env, deps, params) {
  const user = await realUser(request, env, deps);
  const row = await env.DB.prepare('SELECT * FROM repliz_posts WHERE id = ? AND owner_id = ?').bind(Number(params.id), user.id).first();
  if (!row) throw new deps.HttpError(404, 'Jadwal tidak ditemukan.');
  if (row.status !== 'pending') throw new deps.HttpError(409, 'Jadwal sudah diproses.');
  const rz = await clientFor(env, deps, user.id);
  try {
    await rz.removeSchedule(row.schedule_id);
  } catch (e) {
    if (!(e instanceof ReplizError && e.status === 404)) throw new deps.HttpError(e.status || 502, e.message);
  }
  await env.DB.prepare('DELETE FROM repliz_posts WHERE id = ? AND owner_id = ?').bind(row.id, user.id).run();
  return deps.ok(null);
}

export async function handleReplizMedia(request, env, deps) {
  const { ok, HttpError } = deps;
  const user = await realUser(request, env, deps);
  const rz = await clientFor(env, deps, user.id);
  const type = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = MEDIA_TYPES[type];
  if (!ext) throw new HttpError(415, 'Berkas harus JPG, PNG, atau MP4.');
  if (Number(request.headers.get('content-length') || 0) > MAX_MEDIA_BYTES) throw new HttpError(413, 'Berkas maksimal 50 MB.');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.byteLength) throw new HttpError(400, 'Berkas kosong.');
  if (buf.byteLength > MAX_MEDIA_BYTES) throw new HttpError(413, 'Berkas maksimal 50 MB.');
  const init = await viaRepliz(deps, () => rz.initFile({ filename: `satualur-${randomHex(6)}.${ext}`, size: buf.byteLength, mimetype: type }));
  if (!init?.id || !/^https:\/\//.test(init.upload || '') || !/^https:\/\//.test(init.url || '')) throw new HttpError(502, 'Penyimpanan media tidak siap.');
  const put = await (deps.fetchImpl || fetch)(init.upload, { method: 'PUT', headers: { 'content-type': type }, body: buf });
  if (!put.ok) throw new HttpError(502, 'Unggah media gagal. Coba lagi.');
  await viaRepliz(deps, () => rz.completeFile(init.id));
  return ok({ url: init.url, type: type.startsWith('video/') ? 'video' : 'image' });
}

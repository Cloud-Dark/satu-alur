/**
 * Office routes: influencer catalogue, service requests, and the admin inbox.
 * Helpers (authenticate, readJson, ok, HttpError) are injected by worker/index.js.
 */

import { isAdmin } from '../src/social/rules.js';
import { validateServiceRequest, validateInfluencer, REQUEST_STATUSES } from '../src/office/rules.js';

const INFLUENCER_PUBLIC = 'id, name, photo_key, niche, city, ig_followers, tiktok_followers, bio';
const INFLUENCER_FIELDS = ['name', 'photo_key', 'niche', 'city', 'ig_followers', 'tiktok_followers', 'bio', 'visible'];
const REQUEST_SELECT = `SELECT r.id, r.kind, r.influencer_id, i.name AS influencer_name, r.payload_json,
  r.status, r.admin_note, r.created_at, r.updated_at`;

// Validators throw plain Errors with the Indonesian text; turn them into 400s.
function validated(HttpError, fn) {
  try {
    return fn();
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

async function requireAdmin(request, env, { authenticate, HttpError }) {
  const { user } = await authenticate(request, env);
  if (!isAdmin(user.email, env.ADMIN_EMAILS)) throw new HttpError(403, 'Khusus tim Satu Alur.');
  return user;
}

function parseId(params, HttpError) {
  if (!/^\d+$/.test(params.id || '')) throw new HttpError(404, 'Data tidak ditemukan.');
  return Number(params.id);
}

function withPayload({ payload_json, ...rest }) {
  let payload = {};
  try { payload = JSON.parse(payload_json || '{}'); } catch { /* keep empty */ }
  return { ...rest, payload };
}

export async function handleInfluencers(request, env, { authenticate, ok }) {
  await authenticate(request, env);
  const { results } = await env.DB.prepare(`SELECT ${INFLUENCER_PUBLIC} FROM influencers WHERE visible = 1 ORDER BY name`).all();
  return ok(results);
}

export async function handleRequestCreate(request, env, deps) {
  const { authenticate, readJson, ok, HttpError } = deps;
  const { user } = await authenticate(request, env);
  const body = await readJson(request);
  const v = validated(HttpError, () => validateServiceRequest(body));
  if (v.kind === 'collab') {
    const inf = await env.DB.prepare('SELECT id FROM influencers WHERE id = ? AND visible = 1').bind(v.influencer_id).first();
    if (!inf) throw new HttpError(400, 'Influencer tidak tersedia.');
  }
  const r = await env.DB.prepare('INSERT INTO service_requests (owner_id, kind, influencer_id, payload_json) VALUES (?, ?, ?, ?)')
    .bind(user.id, v.kind, v.influencer_id, JSON.stringify(v.payload)).run();
  return ok({ id: r.meta.last_row_id });
}

export async function handleRequestList(request, env, { authenticate, ok }) {
  const { user } = await authenticate(request, env);
  const { results } = await env.DB.prepare(
    `${REQUEST_SELECT} FROM service_requests r LEFT JOIN influencers i ON i.id = r.influencer_id
     WHERE r.owner_id = ? ORDER BY r.created_at DESC, r.id DESC`,
  ).bind(user.id).all();
  return ok(results.map(withPayload));
}

export async function handleAdminInfluencers(request, env, deps) {
  await requireAdmin(request, env, deps);
  const { results } = await env.DB.prepare('SELECT * FROM influencers ORDER BY name').all();
  return deps.ok(results);
}

export async function handleAdminInfluencerCreate(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const body = await readJson(request);
  const v = validated(HttpError, () => validateInfluencer(body));
  const r = await env.DB.prepare(
    'INSERT INTO influencers (name, photo_key, niche, city, ig_followers, tiktok_followers, bio, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(v.name, v.photo_key, v.niche, v.city, v.ig_followers, v.tiktok_followers, v.bio, v.visible).run();
  return ok({ id: r.meta.last_row_id });
}

export async function handleAdminInfluencerUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const id = parseId(params, HttpError);
  const body = await readJson(request);
  const cur = await env.DB.prepare('SELECT * FROM influencers WHERE id = ?').bind(id).first();
  if (!cur) throw new HttpError(404, 'Data tidak ditemukan.');
  const merged = { ...cur };
  for (const f of INFLUENCER_FIELDS) if (body[f] !== undefined) merged[f] = body[f];
  const v = validated(HttpError, () => validateInfluencer(merged));
  await env.DB.prepare(
    'UPDATE influencers SET name = ?, photo_key = ?, niche = ?, city = ?, ig_followers = ?, tiktok_followers = ?, bio = ?, visible = ? WHERE id = ?',
  ).bind(v.name, v.photo_key, v.niche, v.city, v.ig_followers, v.tiktok_followers, v.bio, v.visible, id).run();
  return ok(null);
}

export async function handleAdminRequests(request, env, deps) {
  await requireAdmin(request, env, deps);
  const status = new URL(request.url).searchParams.get('status');
  if (status && !REQUEST_STATUSES.includes(status)) throw new deps.HttpError(400, 'Status tidak dikenal.');
  const { results } = await env.DB.prepare(
    `${REQUEST_SELECT}, r.owner_id, u.name AS business_name, u.email AS business_email
     FROM service_requests r
     LEFT JOIN influencers i ON i.id = r.influencer_id
     LEFT JOIN users u ON u.id = r.owner_id
     ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC, r.id DESC`,
  ).bind(...(status ? [status] : [])).all();
  return deps.ok(results.map(withPayload));
}

export async function handleAdminRequestUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const id = parseId(params, HttpError);
  const body = await readJson(request);
  const sets = [];
  const vals = [];
  if (body.status !== undefined) {
    if (!REQUEST_STATUSES.includes(body.status)) throw new HttpError(400, 'Status tidak dikenal.');
    sets.push('status = ?');
    vals.push(body.status);
  }
  if (body.admin_note !== undefined) {
    const note = body.admin_note === null ? '' : String(body.admin_note);
    if (note.length > 2000) throw new HttpError(400, 'Catatan maksimal 2000 karakter.');
    sets.push('admin_note = ?');
    vals.push(note);
  }
  if (!sets.length) throw new HttpError(400, 'Tidak ada perubahan.');
  const r = await env.DB.prepare(`UPDATE service_requests SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...vals, new Date().toISOString(), id).run();
  if (r.meta.changes !== 1) throw new HttpError(404, 'Data tidak ditemukan.');
  return ok(null);
}

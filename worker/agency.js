/**
 * Agensi influencer: campaigns run from collab requests (staff), and the business's read-only projection.
 * Helpers (authenticate, readJson, ok, HttpError) are injected by worker/index.js.
 */

import { requireAdmin } from './office.js';
import {
  validateCampaign, validateDeliverable, validatePayout, campaignProjection, CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_NOT_FOUND, REQUEST_NOT_FOUND, DELIVERABLE_NOT_FOUND, DUPLICATE_CAMPAIGN, COLLAB_ONLY, INFLUENCER_MISSING,
  INFLUENCER_HIDDEN, NOT_ASSIGNED, REMOVE_BLOCKED,
} from '../src/agency/rules.js';

const PAGE_SIZE = 50;
const CAMPAIGN_COLS = 'c.id, c.request_id, c.owner_id, c.title, c.brief, c.status, c.start_date, c.end_date, c.client_fee_idr, c.created_at, c.updated_at, c.updated_by';
const DELIVERABLE_COLS = 'id, campaign_id, influencer_id, kind, due_date, status, link, note, updated_at, updated_by';
const DELIVERABLE_ORDER = 'ORDER BY due_date IS NULL, due_date, id';

function validated(HttpError, fn) {
  try {
    return fn();
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
}

function idParam(value, HttpError, message) {
  if (!/^\d+$/.test(value || '')) throw new HttpError(404, message);
  return Number(value);
}

async function campaignOr404(env, id, HttpError) {
  const c = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLS}, u.name AS business_name, u.email AS business_email
     FROM campaigns c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?`,
  ).bind(id).first();
  if (!c) throw new HttpError(404, CAMPAIGN_NOT_FOUND);
  return c;
}

const influencersOf = (env, campaignId, cols) => env.DB.prepare(
  `SELECT ci.influencer_id, i.name, i.niche, i.city, i.photo_key${cols}
   FROM campaign_influencers ci JOIN influencers i ON i.id = ci.influencer_id
   WHERE ci.campaign_id = ? ORDER BY i.name, ci.influencer_id`,
).bind(campaignId).all();

// ------------------------------------------------------------------ staff

export async function handleAdminCampaignCreate(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const admin = await requireAdmin(request, env, deps);
  const body = await readJson(request);
  const rid = /^\d+$/.test(String(body.request_id ?? '')) ? Number(body.request_id) : null;
  const req = rid && await env.DB.prepare('SELECT id, owner_id, kind, influencer_id FROM service_requests WHERE id = ?').bind(rid).first();
  if (!req) throw new HttpError(404, REQUEST_NOT_FOUND);
  if (req.kind !== 'collab') throw new HttpError(400, COLLAB_ONLY);
  const v = validated(HttpError, () => validateCampaign(body));
  const now = new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      'INSERT INTO campaigns (request_id, owner_id, title, brief, status, start_date, end_date, client_fee_idr, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(req.id, req.owner_id, v.title, v.brief, v.status, v.start_date, v.end_date, v.client_fee_idr, now, now, admin.name),
    env.DB.prepare("UPDATE service_requests SET status = 'in_progress', updated_at = ? WHERE id = ?").bind(now, req.id),
  ];
  // The requested influencer comes along only while still visible in the catalogue.
  if (req.influencer_id) {
    stmts.push(env.DB.prepare(
      `INSERT INTO campaign_influencers (campaign_id, influencer_id, payout_idr)
       SELECT c.id, i.id, NULL FROM campaigns c JOIN influencers i ON i.id = ? AND i.visible = 1 WHERE c.request_id = ?`,
    ).bind(req.influencer_id, req.id));
  }
  let res;
  try {
    res = await env.DB.batch(stmts);
  } catch (err) {
    // UNIQUE(request_id): a second create (double-click, two staff) rolls the whole batch back.
    if (/UNIQUE/i.test(String(err?.message))) throw new HttpError(400, DUPLICATE_CAMPAIGN);
    throw err;
  }
  return ok({ id: res[0].meta.last_row_id });
}

export async function handleAdminCampaigns(request, env, deps) {
  await requireAdmin(request, env, deps);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  if (status && !Object.hasOwn(CAMPAIGN_STATUS_LABEL, status)) throw new deps.HttpError(400, 'Status tidak dikenal.');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const where = status ? 'WHERE c.status = ?' : '';
  const args = status ? [status] : [];
  const [count, { results }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM campaigns c ${where}`).bind(...args).first(),
    env.DB.prepare(
      `SELECT ${CAMPAIGN_COLS}, u.name AS business_name, u.email AS business_email
       FROM campaigns c LEFT JOIN users u ON u.id = c.owner_id ${where}
       ORDER BY c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?`,
    ).bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
  ]);
  return deps.ok({ items: results, total: count.n, page });
}

export async function handleAdminCampaignGet(request, env, deps, params) {
  await requireAdmin(request, env, deps);
  const id = idParam(params.id, deps.HttpError, CAMPAIGN_NOT_FOUND);
  const c = await campaignOr404(env, id, deps.HttpError);
  const [infs, dels] = await Promise.all([
    influencersOf(env, id, ', i.visible, ci.payout_idr'),
    env.DB.prepare(`SELECT ${DELIVERABLE_COLS} FROM campaign_deliverables WHERE campaign_id = ? ${DELIVERABLE_ORDER}`).bind(id).all(),
  ]);
  return deps.ok({ ...c, influencers: infs.results, deliverables: dels.results });
}

export async function handleAdminCampaignUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const admin = await requireAdmin(request, env, deps);
  const id = idParam(params.id, HttpError, CAMPAIGN_NOT_FOUND);
  const body = await readJson(request);
  const cur = await campaignOr404(env, id, HttpError);
  const merged = { ...cur };
  for (const f of ['title', 'brief', 'status', 'start_date', 'end_date', 'client_fee_idr']) if (body[f] !== undefined) merged[f] = body[f];
  const v = validated(HttpError, () => validateCampaign(merged));
  const r = await env.DB.prepare(
    'UPDATE campaigns SET title = ?, brief = ?, status = ?, start_date = ?, end_date = ?, client_fee_idr = ?, updated_at = ?, updated_by = ? WHERE id = ?',
  ).bind(v.title, v.brief, v.status, v.start_date, v.end_date, v.client_fee_idr, new Date().toISOString(), admin.name, id).run();
  if (!r.meta.changes) throw new HttpError(404, CAMPAIGN_NOT_FOUND);
  return ok(null);
}

// Adds an influencer (visible only) or, when already on the campaign, updates the payout (hidden ones stay editable).
export async function handleAdminCampaignInfluencer(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const id = idParam(params.id, HttpError, CAMPAIGN_NOT_FOUND);
  const body = await readJson(request);
  const v = validated(HttpError, () => validatePayout(body));
  await campaignOr404(env, id, HttpError);
  const upd = await env.DB.prepare('UPDATE campaign_influencers SET payout_idr = ? WHERE campaign_id = ? AND influencer_id = ?')
    .bind(v.payout_idr, id, v.influencer_id).run();
  if (upd.meta.changes) return ok(null);
  const inf = await env.DB.prepare('SELECT visible FROM influencers WHERE id = ?').bind(v.influencer_id).first();
  if (!inf) throw new HttpError(400, INFLUENCER_MISSING);
  // The visibility test sits inside the INSERT too, so hiding at the same moment can't slip through.
  const ins = await env.DB.prepare(
    `INSERT INTO campaign_influencers (campaign_id, influencer_id, payout_idr)
     SELECT ?, id, ? FROM influencers WHERE id = ? AND visible = 1
     ON CONFLICT(campaign_id, influencer_id) DO UPDATE SET payout_idr = excluded.payout_idr`,
  ).bind(id, v.payout_idr, v.influencer_id).run();
  if (!ins.meta.changes) throw new HttpError(400, INFLUENCER_HIDDEN);
  return ok(null);
}

export async function handleAdminCampaignInfluencerDelete(request, env, deps, params) {
  const { ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const id = idParam(params.id, HttpError, CAMPAIGN_NOT_FOUND);
  const iid = idParam(params.influencerId, HttpError, NOT_ASSIGNED);
  // One guarded statement: never leaves deliverables pointing at a removed influencer.
  const r = await env.DB.prepare(
    `DELETE FROM campaign_influencers WHERE campaign_id = ? AND influencer_id = ?
     AND NOT EXISTS (SELECT 1 FROM campaign_deliverables WHERE campaign_id = ? AND influencer_id = ?)`,
  ).bind(id, iid, id, iid).run();
  if (r.meta.changes) return ok(null);
  const still = await env.DB.prepare('SELECT 1 AS x FROM campaign_influencers WHERE campaign_id = ? AND influencer_id = ?').bind(id, iid).first();
  if (still) throw new HttpError(400, REMOVE_BLOCKED);
  await campaignOr404(env, id, HttpError);
  throw new HttpError(404, NOT_ASSIGNED);
}

export async function handleAdminDeliverableCreate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const admin = await requireAdmin(request, env, deps);
  const id = idParam(params.id, HttpError, CAMPAIGN_NOT_FOUND);
  const body = await readJson(request);
  const v = validated(HttpError, () => validateDeliverable(body));
  await campaignOr404(env, id, HttpError);
  const r = await env.DB.prepare(
    `INSERT INTO campaign_deliverables (campaign_id, influencer_id, kind, due_date, status, link, note, updated_at, updated_by)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM campaign_influencers WHERE campaign_id = ? AND influencer_id = ?)`,
  ).bind(id, v.influencer_id, v.kind, v.due_date, v.status, v.link, v.note, new Date().toISOString(), admin.name, id, v.influencer_id).run();
  if (!r.meta.changes) throw new HttpError(400, NOT_ASSIGNED);
  return ok({ id: r.meta.last_row_id });
}

export async function handleAdminDeliverableUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const admin = await requireAdmin(request, env, deps);
  const id = idParam(params.id, HttpError, DELIVERABLE_NOT_FOUND);
  const body = await readJson(request);
  const cur = await env.DB.prepare(`SELECT ${DELIVERABLE_COLS} FROM campaign_deliverables WHERE id = ?`).bind(id).first();
  if (!cur) throw new HttpError(404, DELIVERABLE_NOT_FOUND);
  const merged = { ...cur };
  for (const f of ['influencer_id', 'kind', 'due_date', 'status', 'link', 'note']) if (body[f] !== undefined) merged[f] = body[f];
  const v = validated(HttpError, () => validateDeliverable(merged));
  const r = await env.DB.prepare(
    `UPDATE campaign_deliverables SET influencer_id = ?, kind = ?, due_date = ?, status = ?, link = ?, note = ?, updated_at = ?, updated_by = ?
     WHERE id = ? AND EXISTS (SELECT 1 FROM campaign_influencers WHERE campaign_id = ? AND influencer_id = ?)`,
  ).bind(v.influencer_id, v.kind, v.due_date, v.status, v.link, v.note, new Date().toISOString(), admin.name, id, cur.campaign_id, v.influencer_id).run();
  if (!r.meta.changes) throw new HttpError(400, NOT_ASSIGNED);
  return ok(null);
}

export async function handleAdminDeliverableDelete(request, env, deps, params) {
  const { ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const id = idParam(params.id, HttpError, DELIVERABLE_NOT_FOUND);
  const r = await env.DB.prepare('DELETE FROM campaign_deliverables WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new HttpError(404, DELIVERABLE_NOT_FOUND);
  return ok(null);
}

// ------------------------------------------------------------------ business

// Owner-scoped through the request. A foreign request, a missing one and one without a campaign all give the same 404.
export async function handleRequestCampaign(request, env, deps, params) {
  const { authenticate, ok, HttpError } = deps;
  const { user } = await authenticate(request, env);
  const rid = idParam(params.id, HttpError, CAMPAIGN_NOT_FOUND);
  const c = await env.DB.prepare(
    `SELECT c.id, c.title, c.status, c.start_date, c.end_date FROM campaigns c
     JOIN service_requests r ON r.id = c.request_id WHERE r.id = ? AND r.owner_id = ?`,
  ).bind(rid, user.id).first();
  if (!c) throw new HttpError(404, CAMPAIGN_NOT_FOUND);
  const [infs, dels] = await Promise.all([
    influencersOf(env, c.id, ''),
    env.DB.prepare(`SELECT influencer_id, kind, due_date, status, link FROM campaign_deliverables WHERE campaign_id = ? ${DELIVERABLE_ORDER}`).bind(c.id).all(),
  ]);
  return ok(campaignProjection(c, infs.results, dels.results));
}

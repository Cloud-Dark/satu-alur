/**
 * Offer templates ("Template penawaran"): every signed-in business reads the
 * active ones; admins create, edit, (de)activate and delete them in Kantor.
 * Helpers (authenticate, readJson, ok, HttpError) are injected by worker/index.js.
 */

import { validateTemplate } from '../src/offer/templates.js';
import { requireAdmin } from './office.js';
import { audit } from './admin-system.js';

const COLS = 'id, name, category, description, fields_json, prompt_hint, default_terms, price_hint_min, price_hint_max, active, sort, created_by, updated_at';
const PAGE_MAX = 100;

export function toTemplate({ fields_json, ...rest }) {
  let fields = [];
  try { const v = JSON.parse(fields_json || '[]'); if (Array.isArray(v)) fields = v; } catch { /* keep empty */ }
  return { ...rest, active: rest.active ? 1 : 0, fields };
}

function validated(HttpError, input) {
  try {
    return validateTemplate(input);
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
}

function parseId(params, HttpError) {
  if (!/^\d+$/.test(params.id || '')) throw new HttpError(404, 'Template tidak ditemukan.');
  return Number(params.id);
}

const readOne = (env, id) => env.DB.prepare(`SELECT ${COLS} FROM offer_templates WHERE id = ?`).bind(id).first();

/** GET /api/offer-templates — active templates for the offer wizard. */
export async function handleTemplatesList(request, env, { authenticate, ok }) {
  await authenticate(request, env);
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM offer_templates WHERE active = 1 ORDER BY sort, id`).all();
  return ok((results || []).map(toTemplate));
}

/** GET /api/office/admin/offer-templates?page=&per=&q= — every template, paged. */
export async function handleAdminTemplates(request, env, deps) {
  await requireAdmin(request, env, deps);
  const url = new URL(request.url);
  const per = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('per')) || 20));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
  const where = q ? 'WHERE name LIKE ? OR description LIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const [rows, total] = await Promise.all([
    env.DB.prepare(`SELECT ${COLS} FROM offer_templates ${where} ORDER BY sort, id LIMIT ? OFFSET ?`).bind(...args, per, (page - 1) * per).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM offer_templates ${where}`).bind(...args).first(),
  ]);
  return deps.ok({ items: (rows.results || []).map(toTemplate), total: Number(total?.n) || 0, page, per });
}

export async function handleAdminTemplateCreate(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const v = validated(HttpError, await readJson(request));
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO offer_templates (name, category, description, fields_json, prompt_hint, default_terms, price_hint_min, price_hint_max, active, sort, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
  ).bind(v.name, v.category, v.description, JSON.stringify(v.fields), v.prompt_hint, v.default_terms, v.price_hint_min, v.price_hint_max, v.active, v.sort, user.email || user.name || '', now).first();
  await audit(env, user.email || user.name, 'offer_template.create', String(row.id), v.name);
  return ok(toTemplate(row));
}

/** PATCH: a full template, or just { active } to (de)activate. */
export async function handleAdminTemplateUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const id = parseId(params, HttpError);
  const cur = await readOne(env, id);
  if (!cur) throw new HttpError(404, 'Template tidak ditemukan.');
  const body = await readJson(request);
  const merged = { ...toTemplate(cur), ...body };
  const v = validated(HttpError, merged);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `UPDATE offer_templates SET name = ?, category = ?, description = ?, fields_json = ?, prompt_hint = ?, default_terms = ?, price_hint_min = ?, price_hint_max = ?, active = ?, sort = ?, updated_at = ?
     WHERE id = ? RETURNING ${COLS}`,
  ).bind(v.name, v.category, v.description, JSON.stringify(v.fields), v.prompt_hint, v.default_terms, v.price_hint_min, v.price_hint_max, v.active, v.sort, now, id).first();
  const action = Object.keys(body || {}).length === 1 && 'active' in body ? (v.active ? 'offer_template.activate' : 'offer_template.deactivate') : 'offer_template.update';
  await audit(env, user.email || user.name, action, String(id), v.name);
  return ok(toTemplate(row));
}

/** DELETE: offers keep their template_id/answers; the template just disappears from the picker. */
export async function handleAdminTemplateDelete(request, env, deps, params) {
  const { ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const id = parseId(params, HttpError);
  const cur = await readOne(env, id);
  if (!cur) throw new HttpError(404, 'Template tidak ditemukan.');
  await env.DB.prepare('DELETE FROM offer_templates WHERE id = ?').bind(id).run();
  await audit(env, user.email || user.name, 'offer_template.delete', String(id), cur.name);
  return ok({ id, deleted: true });
}

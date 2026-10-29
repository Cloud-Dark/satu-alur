/**
 * Editable site content: public read, staff-only write.
 * Helpers (authenticate, readJson, ok, HttpError) are injected by worker/index.js.
 */

import { SITE_KEYS, validateSiteContent } from '../src/site/content-rules.js';
import { requireAdmin } from './office.js';

function parseKey(params, HttpError) {
  if (!SITE_KEYS.includes(params.key)) throw new HttpError(404, 'Halaman tidak ditemukan.');
  return params.key;
}

async function readRow(env, key) {
  const row = await env.DB.prepare('SELECT value_json, updated_at, updated_by FROM site_content WHERE key = ?').bind(key).first();
  if (!row) return { key, value: null };
  let value = null
  try { value = JSON.parse(row.value_json) } catch { /* corrupt row: let the admin overwrite it */ }
  return { key, value, updated_at: row.updated_at, updated_by: row.updated_by };
}

export async function handleSiteGet(request, env, { ok, HttpError }, params) {
  const key = parseKey(params, HttpError);
  const res = ok(await readRow(env, key));
  res.headers.set('cache-control', 'public, max-age=60');
  return res;
}

export async function handleSitePut(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const key = parseKey(params, HttpError);
  const user = await requireAdmin(request, env, deps);
  const body = await readJson(request);
  let value;
  try {
    value = validateSiteContent(key, body?.value);
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
  await env.DB.prepare(
    `INSERT INTO site_content (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(key, JSON.stringify(value), new Date().toISOString(), user.name).run();
  return ok(await readRow(env, key));
}

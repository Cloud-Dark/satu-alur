/**
 * Business admin: subscription plans (public read of active plans, staff-only write).
 * Helpers (authenticate, readJson, ok, HttpError) are injected by worker/index.js.
 */

import { validatePlan, validateReorder } from '../src/business/plan-rules.js';
import { validatePaymentSettings, testGateway } from '../src/business/payment.js';
import { encryptToken, decryptToken } from '../src/social/crypto.js';
import { requireAdmin } from './office.js';

const FIELDS = ['slug', 'name', 'tagline', 'price_idr', 'period', 'period_label', 'recommended', 'badge', 'limits', 'features', 'cta_label', 'cta_kind', 'sort', 'active'];
const COLS = 'id, slug, name, tagline, price_idr, period, period_label, recommended, badge, limits_json, features_json, cta_label, cta_kind, sort, active, updated_at, updated_by';

function parseList(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

function toPlan({ limits_json, features_json, ...rest }) {
  return { ...rest, limits: parseList(limits_json), features: parseList(features_json) };
}

function validated(HttpError, fn) {
  try {
    return fn();
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
}

async function list(env, where) {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM subscription_plans ${where} ORDER BY sort, id`).all();
  return results.map(toPlan);
}

export async function handlePlansPublic(request, env, { ok }) {
  const res = ok(await list(env, 'WHERE active = 1'));
  res.headers.set('cache-control', 'public, max-age=60');
  return res;
}

export async function handleAdminPlans(request, env, deps) {
  await requireAdmin(request, env, deps);
  return deps.ok(await list(env, ''));
}

// A recommended plan clears the flag on every other plan in the same (transactional) batch.
async function write(env, HttpError, recommended, clearStmt, stmt) {
  try {
    await env.DB.batch(recommended ? [clearStmt, stmt] : [stmt]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err?.message))) throw new HttpError(400, 'Slug sudah dipakai.');
    throw err;
  }
}

const cols = (v) => [v.slug, v.name, v.tagline, v.price_idr, v.period, v.period_label, v.recommended, v.badge,
  JSON.stringify(v.limits), JSON.stringify(v.features), v.cta_label, v.cta_kind, v.sort, v.active];

export async function handleAdminPlanCreate(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const body = await readJson(request);
  const v = validated(HttpError, () => validatePlan(body));
  const now = new Date().toISOString();
  await write(env, HttpError, v.recommended,
    env.DB.prepare('UPDATE subscription_plans SET recommended = 0 WHERE slug != ?').bind(v.slug),
    env.DB.prepare(
      `INSERT INTO subscription_plans (slug, name, tagline, price_idr, period, period_label, recommended, badge, limits_json, features_json, cta_label, cta_kind, sort, active, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...cols(v), now, user.name));
  const row = await env.DB.prepare(`SELECT ${COLS} FROM subscription_plans WHERE slug = ?`).bind(v.slug).first();
  return ok(toPlan(row));
}

export async function handleAdminPlanReorder(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const body = await readJson(request);
  const { results } = await env.DB.prepare('SELECT id FROM subscription_plans').all();
  const ids = validated(HttpError, () => validateReorder(body.ids, results.map((r) => r.id)));
  const now = new Date().toISOString();
  await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE subscription_plans SET sort = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(i + 1, now, user.name, id)));
  return ok(await list(env, ''));
}

export async function handleAdminPlanUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  if (!/^\d+$/.test(params.id || '')) throw new HttpError(404, 'Paket tidak ditemukan.');
  const id = Number(params.id);
  const body = await readJson(request);
  const cur = await env.DB.prepare(`SELECT ${COLS} FROM subscription_plans WHERE id = ?`).bind(id).first();
  if (!cur) throw new HttpError(404, 'Paket tidak ditemukan.');
  const merged = toPlan(cur);
  for (const f of FIELDS) if (body[f] !== undefined) merged[f] = body[f];
  const v = validated(HttpError, () => validatePlan(merged));
  await write(env, HttpError, v.recommended,
    env.DB.prepare('UPDATE subscription_plans SET recommended = 0 WHERE id != ?').bind(id),
    env.DB.prepare(
      `UPDATE subscription_plans SET slug = ?, name = ?, tagline = ?, price_idr = ?, period = ?, period_label = ?, recommended = ?, badge = ?, limits_json = ?, features_json = ?, cta_label = ?, cta_kind = ?, sort = ?, active = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    ).bind(...cols(v), new Date().toISOString(), user.name, id));
  const row = await env.DB.prepare(`SELECT ${COLS} FROM subscription_plans WHERE id = ?`).bind(id).first();
  return ok(toPlan(row));
}

/* ---------------------------------------------------------------- Payment gateway (single row, id = 1) */

const PAY_COLS = 'provider, mode, client_key, server_key_enc, server_key_last4, webhook_token_enc, updated_at, updated_by';

// The only shape that leaves the server: flags + last4, never a key or its ciphertext.
function toPayment(row) {
  if (!row) return { provider: 'none', mode: 'sandbox', client_key: '', server_key_set: false, server_key_last4: '', webhook_token_set: false, updated_at: null, updated_by: null };
  return {
    provider: row.provider, mode: row.mode, client_key: row.client_key,
    server_key_set: Boolean(row.server_key_enc), server_key_last4: row.server_key_enc ? row.server_key_last4 : '',
    webhook_token_set: Boolean(row.webhook_token_enc), updated_at: row.updated_at, updated_by: row.updated_by,
  };
}

const readPayment = (env) => env.DB.prepare(`SELECT ${PAY_COLS} FROM payment_settings WHERE id = 1`).first();

// Crypto errors are logged by name only and surface as a generic 500.
async function crypt(HttpError, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('Payment secret crypto failed', err?.name);
    throw new HttpError(500, 'Gagal memproses kunci rahasia.');
  }
}

export async function handleAdminPaymentGet(request, env, deps) {
  await requireAdmin(request, env, deps);
  return deps.ok(toPayment(await readPayment(env)));
}

export async function handleAdminPaymentPut(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const body = await readJson(request);
  const v = validated(HttpError, () => validatePaymentSettings(body));
  if ((v.server_key || v.webhook_token) && !env.TOKEN_KEY) throw new HttpError(400, 'TOKEN_KEY belum diatur di server.');
  const cur = await readPayment(env);
  let serverEnc = v.clear_server_key ? null : cur?.server_key_enc ?? null;
  let last4 = v.clear_server_key ? '' : cur?.server_key_last4 ?? '';
  if (v.server_key) {
    serverEnc = await crypt(HttpError, () => encryptToken(v.server_key, env.TOKEN_KEY));
    last4 = v.server_key.slice(-4);
  }
  const hookEnc = v.webhook_token ? await crypt(HttpError, () => encryptToken(v.webhook_token, env.TOKEN_KEY)) : cur?.webhook_token_enc ?? null;
  await env.DB.prepare(
    `INSERT INTO payment_settings (id, ${PAY_COLS}) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, mode = excluded.mode, client_key = excluded.client_key,
       server_key_enc = excluded.server_key_enc, server_key_last4 = excluded.server_key_last4, webhook_token_enc = excluded.webhook_token_enc,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(v.provider, v.mode, v.client_key, serverEnc, last4, hookEnc, new Date().toISOString(), user.name).run();
  return ok(toPayment(await readPayment(env)));
}

// Always 200: a failed test is an answer for the user, not a server error.
export async function handleAdminPaymentTest(request, env, deps) {
  const { ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const row = await readPayment(env);
  if (!row?.server_key_enc) return ok({ ok: false, message: 'Server key belum diatur.' });
  if (!env.TOKEN_KEY) throw new HttpError(400, 'TOKEN_KEY belum diatur di server.');
  const serverKey = await crypt(HttpError, () => decryptToken(row.server_key_enc, env.TOKEN_KEY));
  return ok(await testGateway({ provider: row.provider, mode: row.mode, serverKey }, fetch));
}

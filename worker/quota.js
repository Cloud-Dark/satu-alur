/**
 * AI quotas, AI credit and vouchers. The numbers and rules live in src/quota/rules.js.
 * Helpers (authenticate, readJson, ok, HttpError, DEMO_EMAILS) are injected by worker/index.js.
 *
 * Enforcement: handleChat calls meter() before the model runs. One UPSERT counts the call only
 * while it is under the month's limit; past the limit one guarded UPDATE spends AI credit; with
 * neither left the call is refused with 402. A failed model start gives the call back (refund).
 */
import {
  FEATURE_KEYS, featureOf, limitFor, parseQuota, effectivePlan, quotaMessage, usageRows, periodOf, resetDate, todayWib,
  normalizeCode, generateCode, validateVoucher, redeemProblem, planAfterVoucher, VOUCHER_TYPES,
} from '../src/quota/rules.js';
import { requireAdmin } from './office.js';

const nowIso = () => new Date().toISOString();
// Before migration 0008 is applied these tables/columns don't exist; AI keeps working (logged) instead of breaking.
const missingSchema = (err) => /no such (table|column)/i.test(String(err?.message));

function validated(HttpError, fn) {
  try {
    return fn();
  } catch (err) {
    if (err?.validation) throw new HttpError(400, err.message);
    throw err;
  }
}

async function loadPlans(env) {
  const { results } = await env.DB.prepare('SELECT id, slug, name, quota_json FROM subscription_plans').all();
  return results.map(({ quota_json, ...p }) => ({ ...p, quota: parseQuota(quota_json) }));
}

async function planForUser(env, userId, today) {
  const [plans, account] = await Promise.all([
    loadPlans(env),
    env.DB.prepare('SELECT plan_id, status, period_end FROM customer_accounts WHERE owner_id = ?').bind(userId).first(),
  ]);
  return effectivePlan(account, plans, today);
}

/** Feature key from the X-Satualur-Feature header; anything else is a 400 (every AI call site sends one). */
export function featureFrom(request, HttpError) {
  const key = String(request.headers.get('x-satualur-feature') || '').trim();
  if (!FEATURE_KEYS.includes(key)) throw new HttpError(400, 'Fitur AI tidak dikenal.');
  return key;
}

/**
 * Counts one call of `feature` for `user`, or spends credit, or throws 402.
 * Returns { via, refund } — refund() gives the call back when the model never started.
 */
export async function meter(env, user, feature, { HttpError, DEMO_EMAILS }) {
  const period = periodOf();
  const demo = Boolean(DEMO_EMAILS?.has(user.email));
  let plan;
  try {
    ({ plan } = await planForUser(env, user.id, todayWib()));
  } catch (err) {
    if (missingSchema(err)) { console.error('Quota tables missing; AI not metered'); return { via: 'off', refund: async () => {} }; }
    throw err;
  }
  const limit = demo ? null : limitFor(plan.quota, feature);
  const key = [user.id, feature, period];
  const giveBack = () => env.DB.prepare('UPDATE usage_counters SET count = MAX(count - 1, 0) WHERE user_id = ? AND feature = ? AND period = ?').bind(...key).run();

  if (limit === null) {
    await env.DB.prepare(
      `INSERT INTO usage_counters (user_id, feature, period, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, feature, period) DO UPDATE SET count = count + 1`,
    ).bind(...key).run();
    return { via: demo ? 'demo' : 'unlimited', refund: giveBack };
  }
  if (limit > 0) {
    // Counts only while under the limit: no row back means the month's quota is used up.
    const row = await env.DB.prepare(
      `INSERT INTO usage_counters (user_id, feature, period, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, feature, period) DO UPDATE SET count = count + 1 WHERE usage_counters.count < ?
       RETURNING count`,
    ).bind(...key, limit).first();
    if (row) return { via: 'quota', refund: giveBack };
  }

  const price = featureOf(feature).price_idr;
  const now = nowIso();
  const spent = await env.DB.prepare(
    'UPDATE ai_credits SET balance_idr = balance_idr - ?, updated_at = ? WHERE user_id = ? AND balance_idr >= ? RETURNING balance_idr',
  ).bind(price, now, user.id, price).first();
  if (!spent) throw new HttpError(402, quotaMessage(feature));
  await env.DB.prepare('INSERT INTO ai_credit_entries (user_id, amount_idr, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, -price, feature, period, now).run();
  return {
    via: 'credit',
    refund: () => env.DB.batch([
      env.DB.prepare('UPDATE ai_credits SET balance_idr = balance_idr + ?, updated_at = ? WHERE user_id = ?').bind(price, nowIso(), user.id),
      env.DB.prepare('INSERT INTO ai_credit_entries (user_id, amount_idr, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(user.id, price, 'refund', feature, nowIso()),
    ]),
  };
}

async function usageOf(env, userId, period) {
  const [{ results }, credit] = await Promise.all([
    env.DB.prepare('SELECT feature, count FROM usage_counters WHERE user_id = ? AND period = ?').bind(userId, period).all(),
    env.DB.prepare('SELECT balance_idr FROM ai_credits WHERE user_id = ?').bind(userId).first(),
  ]);
  return { counts: Object.fromEntries(results.map((r) => [r.feature, r.count])), credit_idr: credit?.balance_idr || 0 };
}

async function planSummary(env, user, DEMO_EMAILS) {
  const today = todayWib();
  const period = periodOf();
  const [{ plan, period_end, lapsed }, { counts, credit_idr }] = await Promise.all([planForUser(env, user.id, today), usageOf(env, user.id, period)]);
  const demo = Boolean(DEMO_EMAILS?.has(user.email));
  return {
    plan: { id: plan.id, slug: plan.slug, name: plan.name },
    period_end, lapsed: Boolean(lapsed), period, resets_on: resetDate(period), demo,
    usage: usageRows(demo ? Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) : plan.quota, counts),
    credit_idr,
  };
}

/** GET /api/me/plan — plan, this month's usage per feature, AI credit balance. */
export async function handleMyPlan(request, env, { authenticate, ok, DEMO_EMAILS }) {
  const { user } = await authenticate(request, env);
  return ok(await planSummary(env, user, DEMO_EMAILS));
}

/** POST /api/vouchers/redeem { code } — one batch: count, record, apply plan and/or credit. */
export async function handleVoucherRedeem(request, env, deps) {
  const { authenticate, readJson, ok, HttpError, DEMO_EMAILS } = deps;
  const { user } = await authenticate(request, env);
  if (user.is_staff === 1) throw new HttpError(403, 'Voucher hanya untuk akun usaha.');
  const code = normalizeCode((await readJson(request)).code);
  if (!code) throw new HttpError(400, 'Masukkan kode voucher.');
  const today = todayWib();
  const voucher = await env.DB.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
  const already = voucher
    ? await env.DB.prepare('SELECT 1 AS x FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?').bind(voucher.id, user.id).first()
    : null;
  const problem = redeemProblem(voucher, { today, alreadyRedeemed: Boolean(already) });
  if (problem) throw new HttpError(problem === 'Kode voucher tidak ditemukan.' ? 404 : 400, problem);

  const now = nowIso();
  // Every step after the first runs only if the previous one changed a row (changes() = 1), so a
  // voucher that ran out between the read and this batch applies nothing.
  const stmts = [
    env.DB.prepare(
      `UPDATE vouchers SET redeemed_count = redeemed_count + 1
        WHERE id = ? AND active = 1 AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
          AND (expires_on IS NULL OR expires_on >= ?)`,
    ).bind(voucher.id, today),
    env.DB.prepare('INSERT INTO voucher_redemptions (voucher_id, user_id, redeemed_at) SELECT ?, ?, ? WHERE changes() = 1')
      .bind(voucher.id, user.id, now),
  ];
  let planOut = null;
  if (voucher.type !== 'credit') {
    const current = await env.DB.prepare('SELECT plan_id, status, period_end FROM customer_accounts WHERE owner_id = ?').bind(user.id).first();
    planOut = planAfterVoucher(current, voucher, today);
    stmts.push(env.DB.prepare(
      `INSERT INTO customer_accounts (owner_id, plan_id, status, period_end, updated_at, updated_by)
       SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1
       ON CONFLICT(owner_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, period_end = excluded.period_end,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(user.id, planOut.plan_id, planOut.status, planOut.period_end, now, `voucher ${voucher.code}`));
  }
  if (voucher.type !== 'plan') {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO ai_credits (user_id, balance_idr, updated_at) SELECT ?, ?, ? WHERE changes() = 1
         ON CONFLICT(user_id) DO UPDATE SET balance_idr = balance_idr + excluded.balance_idr, updated_at = excluded.updated_at`,
      ).bind(user.id, voucher.credit_idr, now),
      env.DB.prepare('INSERT INTO ai_credit_entries (user_id, amount_idr, reason, ref, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1')
        .bind(user.id, voucher.credit_idr, 'voucher', voucher.code, now),
    );
  }
  let results;
  try {
    results = await env.DB.batch(stmts);
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err?.message))) throw new HttpError(400, 'Anda sudah menukar voucher ini.');
    throw err;
  }
  if (!results[0]?.meta?.changes) throw new HttpError(409, 'Voucher baru saja habis atau berubah. Coba lagi.');
  return ok({ ...(await planSummary(env, user, DEMO_EMAILS)), redeemed: { code: voucher.code, type: voucher.type, credit_idr: voucher.credit_idr, plan_days: voucher.plan_days } });
}

/* ---------------------------------------------------------------- Staff: vouchers */

const VOUCHER_SELECT = `SELECT v.id, v.code, v.type, v.plan_id, p.name AS plan_name, v.plan_days, v.credit_idr, v.max_redemptions,
  v.redeemed_count, v.expires_on, v.active, v.note, v.created_by, v.created_at
  FROM vouchers v LEFT JOIN subscription_plans p ON p.id = v.plan_id`;

const parseId = (params, HttpError) => {
  if (!/^\d+$/.test(params.id || '')) throw new HttpError(404, 'Voucher tidak ditemukan.');
  return Number(params.id);
};

export async function handleAdminVouchers(request, env, deps) {
  await requireAdmin(request, env, deps);
  const { results } = await env.DB.prepare(`${VOUCHER_SELECT} ORDER BY v.created_at DESC, v.id DESC`).all();
  return deps.ok(results);
}

export async function handleAdminVoucherCreate(request, env, deps) {
  const { readJson, ok, HttpError } = deps;
  const user = await requireAdmin(request, env, deps);
  const body = await readJson(request);
  const { results } = await env.DB.prepare('SELECT id FROM subscription_plans').all();
  const v = validated(HttpError, () => validateVoucher(body, results.map((r) => r.id)));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  // A blank code gets a generated one; retry a couple of times on the (unlikely) clash.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = v.code || generateCode(rand);
    try {
      const r = await env.DB.prepare(
        `INSERT INTO vouchers (code, type, plan_id, plan_days, credit_idr, max_redemptions, expires_on, active, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(code, v.type, v.plan_id, v.plan_days, v.credit_idr, v.max_redemptions, v.expires_on, v.active, v.note, user.name, nowIso()).run();
      return ok(await env.DB.prepare(`${VOUCHER_SELECT} WHERE v.id = ?`).bind(r.meta.last_row_id).first());
    } catch (err) {
      if (!/UNIQUE/i.test(String(err?.message))) throw err;
      if (v.code) throw new HttpError(400, 'Kode voucher sudah dipakai.');
    }
  }
  throw new HttpError(500, 'Gagal membuat kode voucher. Coba lagi.');
}

/** PATCH: active, note, expires_on, max_redemptions. Type and value stay fixed once people may hold the code. */
export async function handleAdminVoucherUpdate(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps;
  await requireAdmin(request, env, deps);
  const id = parseId(params, HttpError);
  const body = await readJson(request);
  const cur = await env.DB.prepare('SELECT * FROM vouchers WHERE id = ?').bind(id).first();
  if (!cur) throw new HttpError(404, 'Voucher tidak ditemukan.');
  const merged = { ...cur };
  for (const f of ['active', 'note', 'expires_on', 'max_redemptions']) if (body[f] !== undefined) merged[f] = body[f];
  const v = validated(HttpError, () => validateVoucher(merged, [cur.plan_id].filter((x) => x !== null)));
  if (v.max_redemptions !== null && v.max_redemptions < cur.redeemed_count) {
    throw new HttpError(400, `Batas penukaran tidak boleh di bawah ${cur.redeemed_count} (sudah ditukar).`);
  }
  await env.DB.prepare('UPDATE vouchers SET active = ?, note = ?, expires_on = ?, max_redemptions = ? WHERE id = ?')
    .bind(v.active, v.note, v.expires_on, v.max_redemptions, id).run();
  return ok(await env.DB.prepare(`${VOUCHER_SELECT} WHERE v.id = ?`).bind(id).first());
}

/** Recent redemptions (all vouchers, or ?voucher_id=), with who redeemed so staff can follow up. */
export async function handleAdminRedemptions(request, env, deps) {
  await requireAdmin(request, env, deps);
  const vid = new URL(request.url).searchParams.get('voucher_id');
  const where = /^\d+$/.test(vid || '') ? 'WHERE r.voucher_id = ?' : '';
  const stmt = env.DB.prepare(
    `SELECT r.voucher_id, v.code, v.type, r.user_id, u.email, u.name, COALESCE(a.company, '') AS company, COALESCE(a.phone, '') AS phone, r.redeemed_at
       FROM voucher_redemptions r JOIN vouchers v ON v.id = r.voucher_id JOIN users u ON u.id = r.user_id
       LEFT JOIN customer_accounts a ON a.owner_id = r.user_id
      ${where} ORDER BY r.redeemed_at DESC LIMIT 200`,
  );
  const { results } = await (where ? stmt.bind(Number(vid)) : stmt).all();
  return deps.ok(results);
}

/* ---------------------------------------------------------------- Staff: one customer's AI usage */

export async function handleAdminCustomerQuota(request, env, deps, params) {
  const { ok, HttpError, DEMO_EMAILS } = deps;
  await requireAdmin(request, env, deps);
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(params.userId || '').first();
  if (!user) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  const { results } = await env.DB.prepare(
    'SELECT amount_idr, reason, ref, created_at FROM ai_credit_entries WHERE user_id = ? ORDER BY id DESC LIMIT 20',
  ).bind(user.id).all();
  return ok({ ...(await planSummary(env, user, DEMO_EMAILS)), entries: results });
}

/** POST { amount_idr, note } — staff top-up (positive) or correction (negative, never below 0). */
export async function handleAdminCustomerCredit(request, env, deps, params) {
  const { readJson, ok, HttpError, DEMO_EMAILS } = deps;
  const staff = await requireAdmin(request, env, deps);
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(params.userId || '').first();
  if (!user) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  const body = await readJson(request);
  const amount = Number(body.amount_idr);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10_000_000) throw new HttpError(400, 'Jumlah saldo harus bilangan bulat bukan nol, maksimal Rp10.000.000.');
  const note = String(body.note ?? '').trim().slice(0, 200);
  const now = nowIso();
  // A top-up creates the row if needed; a correction only lowers an existing balance and never below 0.
  const change = amount > 0
    ? env.DB.prepare(
      `INSERT INTO ai_credits (user_id, balance_idr, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET balance_idr = balance_idr + excluded.balance_idr, updated_at = excluded.updated_at`,
    ).bind(user.id, amount, now)
    : env.DB.prepare('UPDATE ai_credits SET balance_idr = balance_idr + ?, updated_at = ? WHERE user_id = ? AND balance_idr + ? >= 0')
      .bind(amount, now, user.id, amount);
  const [upd] = await env.DB.batch([
    change,
    env.DB.prepare('INSERT INTO ai_credit_entries (user_id, amount_idr, reason, ref, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(user.id, amount, 'staff', `${staff.name}${note ? `: ${note}` : ''}`, now),
  ]);
  if (!upd?.meta?.changes) throw new HttpError(400, 'Saldo tidak cukup untuk dikurangi sebanyak itu.');
  return ok(await planSummary(env, user, DEMO_EMAILS));
}

export { VOUCHER_TYPES };

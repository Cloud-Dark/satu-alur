// AI quota, credit and voucher rules (src/quota/rules.js) plus the Worker's metering and
// redemption against a scripted fake D1. The real SQL was run on `wrangler dev --local`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import {
  FEATURES, FREE_QUOTA, limitFor, validateQuota, effectivePlan, decide, periodOf, resetDate, todayWib, addDays,
  validateVoucher, redeemProblem, planAfterVoucher, generateCode, normalizeCode, usageRows, voucherValue,
} from '../src/quota/rules.js'
import { featureFrom, meter, handleVoucherRedeem } from '../worker/quota.js'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fails = (fn, re) => assert.throws(fn, (e) => e.validation === true && re.test(e.message))

/* ------------------------------------------------------------------ rules */

test('limitFor: absent key falls back to Free, null/-1 mean unlimited, negatives clamp', () => {
  assert.equal(limitFor({}, 'offer'), FREE_QUOTA.offer)
  assert.equal(limitFor({ offer: null }, 'offer'), null)
  assert.equal(limitFor({ offer: -1 }, 'offer'), null)
  assert.equal(limitFor({ offer: 0 }, 'offer'), 0)
  assert.equal(limitFor({ offer: 25 }, 'offer'), 25)
  assert.ok(FREE_QUOTA.advisor < FREE_QUOTA.offer, 'advisor (most expensive) gets fewer trial tries')
})

test('validateQuota: known features, ints >= 0 or empty for unlimited', () => {
  assert.deepEqual(validateQuota({ offer: '12', report: '', advisor: -1 }), { offer: 12, report: null, advisor: null })
  fails(() => validateQuota({ nope: 1 }), /tidak dikenal/)
  fails(() => validateQuota({ offer: 1.5 }), /Kuota Penawaran AI/)
  fails(() => validateQuota([1]), /Format kuota/)
})

test('effectivePlan: active plan in period; lapsed, cancelled, past_due or none fall back to Free', () => {
  const plans = [{ id: 1, slug: 'free', quota: FREE_QUOTA }, { id: 3, slug: 'pro', quota: { offer: null } }]
  const today = '2026-10-30'
  assert.equal(effectivePlan({ plan_id: 3, status: 'active', period_end: '2026-11-29' }, plans, today).plan.slug, 'pro')
  assert.equal(effectivePlan({ plan_id: 3, status: 'trial', period_end: null }, plans, today).plan.slug, 'pro')
  const lapsed = effectivePlan({ plan_id: 3, status: 'active', period_end: '2026-10-29' }, plans, today)
  assert.equal(lapsed.plan.slug, 'free'); assert.equal(lapsed.lapsed, true)
  assert.equal(effectivePlan({ plan_id: 3, status: 'cancelled', period_end: null }, plans, today).plan.slug, 'free')
  assert.equal(effectivePlan({ plan_id: 3, status: 'past_due', period_end: null }, plans, today).plan.slug, 'free')
  assert.equal(effectivePlan(null, plans, today).plan.slug, 'free')
  assert.deepEqual(effectivePlan(null, [], today).plan.quota, FREE_QUOTA, 'no plans table rows: built-in Free')
})

test('decide: quota first, then credit, else refused; demo and unlimited never refused', () => {
  assert.deepEqual(decide({ used: 9, limit: 10, balance: 0, price: 1000 }), { allow: true, via: 'quota' })
  assert.deepEqual(decide({ used: 10, limit: 10, balance: 1000, price: 1000 }), { allow: true, via: 'credit' })
  assert.deepEqual(decide({ used: 10, limit: 10, balance: 999, price: 1000 }), { allow: false, via: null })
  assert.deepEqual(decide({ used: 999, limit: 10, balance: 0, price: 1000, demo: true }), { allow: true, via: 'demo' })
  assert.deepEqual(decide({ used: 999, limit: null, balance: 0, price: 1000 }), { allow: true, via: 'unlimited' })
})

test('periods follow Jakarta time and reset on the 1st', () => {
  assert.equal(periodOf(new Date('2026-10-31T16:59:00Z')), '2026-10')
  assert.equal(periodOf(new Date('2026-10-31T17:00:00Z')), '2026-11', '00:00 WIB on 1 Nov starts a new period')
  assert.equal(todayWib(new Date('2026-10-31T17:00:00Z')), '2026-11-01')
  assert.equal(resetDate('2026-10'), '2026-11-01')
  assert.equal(resetDate('2026-12'), '2027-01-01')
  assert.equal(addDays('2026-12-15', 30), '2027-01-14')
})

test('usageRows: one row per feature with used/limit/left', () => {
  const rows = usageRows({ offer: 10, report: null }, { offer: 12, report: 3 })
  assert.equal(rows.length, FEATURES.length)
  const offer = rows.find((r) => r.key === 'offer')
  assert.equal(offer.left, 0)
  assert.equal(rows.find((r) => r.key === 'report').left, null)
})

test('validateVoucher: per-type fields, caps and code format', () => {
  const plans = [1, 2, 3]
  assert.deepEqual(validateVoucher({ type: 'credit', credit_idr: '50000', code: ' satu-ai ', max_redemptions: '' }, plans),
    { code: 'SATU-AI', type: 'credit', plan_id: null, plan_days: null, credit_idr: 50000, max_redemptions: null, expires_on: null, note: '', active: 1 })
  const b = validateVoucher({ type: 'bundle', plan_id: 3, plan_days: 30, credit_idr: 25000, expires_on: '2026-12-31' }, plans)
  assert.equal(b.plan_id, 3); assert.equal(b.credit_idr, 25000)
  assert.equal(validateVoucher({ type: 'plan', plan_id: 2, plan_days: 14, credit_idr: 99 }, plans).credit_idr, 0, 'plan vouchers carry no credit')
  fails(() => validateVoucher({ type: 'gift' }, plans), /Jenis voucher/)
  fails(() => validateVoucher({ type: 'plan', plan_id: 9, plan_days: 30 }, plans), /Pilih paket/)
  fails(() => validateVoucher({ type: 'plan', plan_id: 3, plan_days: 0 }, plans), /Durasi paket/)
  fails(() => validateVoucher({ type: 'credit', credit_idr: 900000 }, plans), /Saldo AI/)
  fails(() => validateVoucher({ type: 'credit', credit_idr: 5000, code: 'a b!' }, plans), /Kode/)
  fails(() => validateVoucher({ type: 'credit', credit_idr: 5000, max_redemptions: 0 }, plans), /Batas penukaran/)
})

test('redeemProblem: unknown, already redeemed, inactive, expired, used up', () => {
  const v = { active: 1, expires_on: '2026-10-31', max_redemptions: 2, redeemed_count: 1 }
  const today = '2026-10-31'
  assert.equal(redeemProblem(v, { today }), null, 'the expiry day itself is still valid')
  assert.equal(redeemProblem(null, { today }), 'Kode voucher tidak ditemukan.')
  assert.equal(redeemProblem(v, { today, alreadyRedeemed: true }), 'Anda sudah menukar voucher ini.')
  assert.equal(redeemProblem({ ...v, active: 0 }, { today }), 'Voucher ini sudah tidak aktif.')
  assert.equal(redeemProblem(v, { today: '2026-11-01' }), 'Voucher ini sudah kedaluwarsa.')
  assert.equal(redeemProblem({ ...v, redeemed_count: 2 }, { today }), 'Kuota penukaran voucher ini sudah habis.')
  assert.equal(redeemProblem({ ...v, max_redemptions: null, redeemed_count: 500 }, { today }), null)
})

test('planAfterVoucher: same running plan extends from its end; otherwise starts today', () => {
  const v = { plan_id: 3, plan_days: 30 }
  assert.deepEqual(planAfterVoucher({ plan_id: 3, status: 'active', period_end: '2026-11-10' }, v, '2026-10-30'), { plan_id: 3, status: 'active', period_end: '2026-12-10' })
  assert.equal(planAfterVoucher({ plan_id: 2, status: 'active', period_end: '2026-11-10' }, v, '2026-10-30').period_end, '2026-11-29')
  assert.equal(planAfterVoucher({ plan_id: 3, status: 'cancelled', period_end: '2026-11-10' }, v, '2026-10-30').period_end, '2026-11-29')
  assert.equal(planAfterVoucher(null, v, '2026-10-30').period_end, '2026-11-29')
})

test('generateCode / normalizeCode / voucherValue', () => {
  const code = generateCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37))
  assert.match(code, /^SATU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  assert.equal(normalizeCode('  satu-ai 50k '), 'SATU-AI50K')
  assert.equal(voucherValue({ type: 'bundle', plan_id: 3, plan_days: 30, credit_idr: 25000 }, () => 'Pro'), 'Pro 30 hari + saldo AI Rp25.000')
})

test('every AI call site names its metered feature', async () => {
  const files = (await readdir(new URL('../src/ai/', import.meta.url))).filter((f) => f.endsWith('.js'))
  let sites = 0
  for (const f of files) {
    const src = await readFile(new URL(`../src/ai/${f}`, import.meta.url), 'utf8')
    for (const m of src.matchAll(/completions\.create\(\{([\s\S]*?)\}\)/g)) {
      sites++
      assert.match(m[1], /\bfeature\b/, `${f}: completions.create without feature`)
    }
  }
  assert.ok(sites >= 6, `found ${sites} call sites`)
})

/* ----------------------------------------------------------------- worker */

// Scripted fake D1: `firsts` answers .first() calls in order (by SQL match), batches are logged.
function fakeEnv({ plans = [{ id: 1, slug: 'free', name: 'Free', quota_json: '{"offer":2}' }], account = null, upsertRow = { count: 1 }, credit = null, batchChanges = 1, voucher = null, already = null } = {}) {
  const log = { runs: [], batches: [] }
  const stmt = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this },
    async first() {
      log.runs.push(this)
      if (/FROM customer_accounts/.test(sql)) return account
      if (/INSERT INTO usage_counters/.test(sql)) return upsertRow
      if (/UPDATE ai_credits/.test(sql)) return credit
      if (/FROM vouchers WHERE code/.test(sql)) return voucher
      if (/FROM voucher_redemptions/.test(sql)) return already
      return null
    },
    async all() { return { results: /FROM subscription_plans/.test(sql) ? plans : [] } },
    async run() { log.runs.push(this); return { meta: { changes: 1 } } },
  })
  const env = { DB: { prepare: stmt, async batch(s) { log.batches.push(s); return s.map(() => ({ meta: { changes: batchChanges } })) } } }
  return { env, log }
}
const deps = { HttpError, DEMO_EMAILS: new Set(['demo-ac@satualur.id']) }
const user = { id: 'u1', email: 'a@usaha.id' }

test('featureFrom: only known feature keys pass', () => {
  const req = (v) => ({ headers: new Headers(v === undefined ? {} : { 'x-satualur-feature': v }) })
  assert.equal(featureFrom(req('offer'), HttpError), 'offer')
  assert.throws(() => featureFrom(req(), HttpError), (e) => e.status === 400)
  assert.throws(() => featureFrom(req('gratis'), HttpError), (e) => e.status === 400)
})

test('meter: under the limit counts with a guarded UPSERT', async () => {
  const { env, log } = fakeEnv()
  const r = await meter(env, user, 'offer', deps)
  assert.equal(r.via, 'quota')
  const up = log.runs.find((s) => /INSERT INTO usage_counters/.test(s.sql))
  assert.match(up.sql, /WHERE usage_counters\.count < \?/)
  assert.equal(up.args.at(-1), 2, 'limit from the Free plan quota_json')
})

test('meter: quota used up spends credit; refund puts it back', async () => {
  const { env, log } = fakeEnv({ upsertRow: null, credit: { balance_idr: 4000 } })
  const r = await meter(env, user, 'offer', deps)
  assert.equal(r.via, 'credit')
  assert.ok(log.runs.some((s) => /INSERT INTO ai_credit_entries/.test(s.sql) && s.args[1] === -1000))
  await r.refund()
  assert.match(log.batches[0][0].sql, /balance_idr = balance_idr \+ \?/)
})

test('meter: no quota and no credit → 402 with the friendly message', async () => {
  const { env } = fakeEnv({ upsertRow: null, credit: null })
  await assert.rejects(meter(env, user, 'advisor', deps), (e) => e.status === 402 && /Penasihat AI/.test(e.message))
})

test('meter: a zero limit skips counting and goes straight to credit', async () => {
  const { env, log } = fakeEnv({ plans: [{ id: 1, slug: 'free', name: 'Free', quota_json: '{"offer":0}' }], credit: null })
  await assert.rejects(meter(env, user, 'offer', deps), (e) => e.status === 402)
  assert.ok(!log.runs.some((s) => /INSERT INTO usage_counters/.test(s.sql)))
})

test('meter: demo accounts are never refused but still counted (no WHERE guard)', async () => {
  const { env, log } = fakeEnv({ upsertRow: null })
  const r = await meter(env, { id: 'd', email: 'demo-ac@satualur.id' }, 'offer', deps)
  assert.equal(r.via, 'demo')
  const up = log.runs.find((s) => /INSERT INTO usage_counters/.test(s.sql))
  assert.doesNotMatch(up.sql, /WHERE/)
})

test('meter: before migration 0008 (no quota_json) AI keeps working, unmetered', async () => {
  const env = { DB: { prepare: () => ({ bind() { return this }, async all() { throw new Error('D1_ERROR: no such column: quota_json') }, async first() { return null } }) } }
  const r = await meter(env, user, 'offer', deps)
  assert.equal(r.via, 'off')
})

const redeemDeps = (body) => ({ authenticate: async () => ({ user }), readJson: async () => body, ok: (x) => x, HttpError, DEMO_EMAILS: new Set() })
const V = { id: 7, code: 'SATU-COMBO', type: 'bundle', plan_id: 2, plan_days: 30, credit_idr: 25000, max_redemptions: 10, redeemed_count: 1, expires_on: null, active: 1 }

test('redeem: one batch, every write after the first guarded by changes() = 1', async () => {
  const { env, log } = fakeEnv({ voucher: V })
  await handleVoucherRedeem({}, env, redeemDeps({ code: 'satu-combo' }))
  const [cnt, rec, acct, credit, entry] = log.batches[0]
  assert.match(cnt.sql, /redeemed_count < max_redemptions/)
  for (const s of [rec, acct, credit, entry]) assert.match(s.sql, /WHERE changes\(\) = 1/)
  assert.match(acct.sql, /INSERT INTO customer_accounts/)
  assert.equal(acct.args[1], 2); assert.equal(acct.args[2], 'active')
  assert.equal(credit.args[1], 25000)
})

test('redeem: plan-only and credit-only vouchers write only their part', async () => {
  const p = fakeEnv({ voucher: { ...V, type: 'plan', credit_idr: 0 } })
  await handleVoucherRedeem({}, p.env, redeemDeps({ code: 'x' }))
  assert.equal(p.log.batches[0].length, 3)
  const c = fakeEnv({ voucher: { ...V, type: 'credit', plan_id: null } })
  await handleVoucherRedeem({}, c.env, redeemDeps({ code: 'x' }))
  assert.equal(c.log.batches[0].length, 4)
  assert.ok(!c.log.batches[0].some((s) => /customer_accounts/.test(s.sql)))
})

test('redeem: refusals and a lost race', async () => {
  await assert.rejects(handleVoucherRedeem({}, fakeEnv().env, redeemDeps({ code: 'NOPE' })), (e) => e.status === 404)
  await assert.rejects(handleVoucherRedeem({}, fakeEnv({ voucher: V, already: { x: 1 } }).env, redeemDeps({ code: 'SATU-COMBO' })),
    (e) => e.status === 400 && e.message === 'Anda sudah menukar voucher ini.')
  await assert.rejects(handleVoucherRedeem({}, fakeEnv({ voucher: V, batchChanges: 0 }).env, redeemDeps({ code: 'SATU-COMBO' })), (e) => e.status === 409)
  await assert.rejects(handleVoucherRedeem({}, fakeEnv().env, redeemDeps({ code: '  ' })), (e) => e.status === 400)
  const staff = { ...redeemDeps({ code: 'SATU-COMBO' }), authenticate: async () => ({ user: { ...user, is_staff: 1 } }) }
  await assert.rejects(handleVoucherRedeem({}, fakeEnv({ voucher: V }).env, staff), (e) => e.status === 403)
})

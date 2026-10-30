/**
 * AI quota, AI credit and vouchers — client for /api/me/plan, /api/vouchers/redeem and the staff
 * /api/office/admin/vouchers routes. Rules and numbers: src/quota/rules.js (shared with the Worker).
 * Demo mode (mock cloud): everything lives in localStorage `satualur_quota_demo_v1` as
 * { usage: { [userId]: { [period]: { [feature]: n } } }, credits: { [userId]: n }, entries: [], vouchers: [], redemptions: [], next: 1 };
 * plans come from src/business/api.js and each user's plan from the customers demo store, like the Worker.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { isDemoEmail } from '../auth/demo-accounts.js'
import { adminListPlans } from '../business/api.js'
import {
  featureOf, limitFor, effectivePlan, decide, quotaMessage, usageRows, periodOf, resetDate, todayWib, FEATURE_KEYS,
  normalizeCode, generateCode, validateVoucher, redeemProblem, planAfterVoucher,
} from './rules.js'
import { QuotaError } from './errors.js'

export { QuotaError, isQuotaError, announceQuota, QUOTA_EVENT } from './errors.js'

const DEMO_KEY = 'satualur_quota_demo_v1'
const CUSTOMERS_KEY = 'satualur_customers_demo_v1'
const token = () => { try { return localStorage.getItem('satualur_token') } catch { return null } }

async function call(path, { method = 'GET', body, cache } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(cache ? { cache } : {}),
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Jaringan bermasalah. Periksa koneksi lalu coba lagi.')
  }
  let json = null
  try { json = await res.json() } catch { /* not JSON */ }
  if (!res.ok || json?.error) throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { status: res.status })
  return json?.data
}

/* ------------------------------------------------------------------ Demo store */

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const loadStore = () => ({ usage: {}, credits: {}, entries: [], vouchers: [], redemptions: [], next: 1, ...read(DEMO_KEY, {}) })
const saveStore = (db) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)) } catch { /* storage full */ } }
const sessionUser = async () => (await getCloud().auth.getSession())?.data?.user || null
const mockPlans = async () => (await adminListPlans().catch(() => [])).map((p) => ({ ...p, quota: p.quota || {} }))
const mockAccount = (userId) => (read(CUSTOMERS_KEY, {}).accounts || {})[userId] || null

function saveAccount(userId, patch, who) {
  const db = read(CUSTOMERS_KEY, {})
  const cur = (db.accounts || {})[userId] || { company: '', phone: '', notes: '' }
  db.accounts = { ...(db.accounts || {}), [userId]: { ...cur, ...patch, updated_at: new Date().toISOString(), updated_by: who } }
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(db))
}

async function mockSummary(user) {
  const db = loadStore()
  const period = periodOf()
  const { plan, period_end, lapsed } = effectivePlan(mockAccount(user.id), await mockPlans(), todayWib())
  const demo = isDemoEmail(user.email)
  const counts = db.usage[user.id]?.[period] || {}
  return {
    plan: { id: plan.id, slug: plan.slug, name: plan.name }, period_end, lapsed: Boolean(lapsed), period, resets_on: resetDate(period), demo,
    usage: usageRows(demo ? Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])) : plan.quota, counts),
    credit_idr: db.credits[user.id] || 0,
  }
}

/** Demo-mode twin of worker/quota.js meter(): counts the call or spends credit, else throws QuotaError. */
export async function mockMeter(feature) {
  if (!featureOf(feature)) throw new Error('Fitur AI tidak dikenal.')
  // The app never calls AI signed out (the Worker answers 401); unit tests do, so they meter as 'anon' on Free.
  const user = (await sessionUser()) || { id: 'anon', email: '' }
  const db = loadStore()
  const period = periodOf()
  const { plan } = effectivePlan(mockAccount(user.id), await mockPlans(), todayWib())
  const used = db.usage[user.id]?.[period]?.[feature] || 0
  const price = featureOf(feature).price_idr
  const d = decide({ used, limit: limitFor(plan.quota, feature), balance: db.credits[user.id] || 0, price, demo: isDemoEmail(user.email) })
  if (!d.allow) throw new QuotaError(quotaMessage(feature), feature)
  if (d.via === 'credit') {
    db.credits[user.id] = (db.credits[user.id] || 0) - price
    db.entries.push({ user_id: user.id, amount_idr: -price, reason: feature, ref: period, created_at: new Date().toISOString() })
  } else {
    db.usage[user.id] = { ...(db.usage[user.id] || {}), [period]: { ...(db.usage[user.id]?.[period] || {}), [feature]: used + 1 } }
  }
  saveStore(db)
  return d.via
}

/* ------------------------------------------------------------------ Business user */

/** { plan, period_end, period, resets_on, demo, usage: [{ key, label, used, limit, left }], credit_idr } */
export async function getMyPlan() {
  if (isUsingMockCloud()) {
    const user = await sessionUser()
    if (!user) throw new Error('Belum masuk.')
    return mockSummary(user)
  }
  try {
    return await call('/api/me/plan', { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Gagal memuat paket. ${e.message}`)
  }
}

/** Redeems a code; returns the new summary plus { redeemed }. Throws the Indonesian reason. */
export async function redeemVoucher(code) {
  if (!isUsingMockCloud()) return call('/api/vouchers/redeem', { method: 'POST', body: { code } })
  const user = await sessionUser()
  if (!user) throw new Error('Belum masuk.')
  const c = normalizeCode(code)
  if (!c) throw new Error('Masukkan kode voucher.')
  const db = loadStore()
  const today = todayWib()
  const v = db.vouchers.find((x) => x.code === c) || null
  const problem = redeemProblem(v, { today, alreadyRedeemed: Boolean(v && db.redemptions.some((r) => r.voucher_id === v.id && r.user_id === user.id)) })
  if (problem) throw new Error(problem)
  const now = new Date().toISOString()
  v.redeemed_count += 1
  db.redemptions.push({ voucher_id: v.id, user_id: user.id, redeemed_at: now })
  if (v.type !== 'plan') {
    db.credits[user.id] = (db.credits[user.id] || 0) + v.credit_idr
    db.entries.push({ user_id: user.id, amount_idr: v.credit_idr, reason: 'voucher', ref: v.code, created_at: now })
  }
  saveStore(db)
  if (v.type !== 'credit') saveAccount(user.id, planAfterVoucher(mockAccount(user.id), v, today), `voucher ${v.code}`)
  return { ...(await mockSummary(user)), redeemed: { code: v.code, type: v.type, credit_idr: v.credit_idr, plan_days: v.plan_days } }
}

/* ------------------------------------------------------------------ Staff */

const withPlanName = (plans) => (v) => ({ ...v, plan_name: plans.find((p) => p.id === v.plan_id)?.name ?? null })

export async function adminListVouchers() {
  if (isUsingMockCloud()) {
    const plans = await mockPlans()
    return loadStore().vouchers.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id).map(withPlanName(plans))
  }
  try {
    return (await call('/api/office/admin/vouchers', { cache: 'no-store' })) || []
  } catch (e) {
    throw new Error(`Gagal memuat voucher. ${e.message}`)
  }
}

export async function adminCreateVoucher(body) {
  if (!isUsingMockCloud()) return call('/api/office/admin/vouchers', { method: 'POST', body })
  const plans = await mockPlans()
  const v = validateVoucher(body, plans.map((p) => p.id))
  const db = loadStore()
  const code = v.code || generateCode((n) => crypto.getRandomValues(new Uint8Array(n)))
  if (db.vouchers.some((x) => x.code === code)) throw new Error('Kode voucher sudah dipakai.')
  const row = { id: db.next++, ...v, code, redeemed_count: 0, created_by: (await sessionUser())?.name || 'demo', created_at: new Date().toISOString() }
  db.vouchers.push(row)
  saveStore(db)
  return withPlanName(plans)(row)
}

/** patch: { active, note, expires_on, max_redemptions } */
export async function adminUpdateVoucher(id, patch) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/vouchers/${id}`, { method: 'PATCH', body: patch })
  const db = loadStore()
  const cur = db.vouchers.find((x) => x.id === id)
  if (!cur) throw new Error('Voucher tidak ditemukan.')
  const merged = { ...cur }
  for (const f of ['active', 'note', 'expires_on', 'max_redemptions']) if (patch[f] !== undefined) merged[f] = patch[f]
  const v = validateVoucher(merged, [cur.plan_id].filter((x) => x !== null))
  if (v.max_redemptions !== null && v.max_redemptions < cur.redeemed_count) throw new Error(`Batas penukaran tidak boleh di bawah ${cur.redeemed_count} (sudah ditukar).`)
  Object.assign(cur, { active: v.active, note: v.note, expires_on: v.expires_on, max_redemptions: v.max_redemptions })
  saveStore(db)
  return withPlanName(await mockPlans())(cur)
}

/** Recent redemptions with who redeemed (email, name, company, phone). */
export async function adminListRedemptions(voucherId) {
  if (isUsingMockCloud()) {
    const db = loadStore()
    const users = read('satualur_mock_v1', {}).users || []
    const accounts = read(CUSTOMERS_KEY, {}).accounts || {}
    return db.redemptions
      .filter((r) => voucherId === undefined || r.voucher_id === voucherId)
      .sort((a, b) => String(b.redeemed_at).localeCompare(String(a.redeemed_at)))
      .map((r) => {
        const v = db.vouchers.find((x) => x.id === r.voucher_id) || {}
        const u = users.find((x) => x.id === r.user_id) || {}
        return { ...r, code: v.code, type: v.type, email: u.email || '', name: u.name || '', company: accounts[r.user_id]?.company || '', phone: accounts[r.user_id]?.phone || '' }
      })
  }
  try {
    return (await call(`/api/office/admin/vouchers/redemptions${voucherId !== undefined ? `?voucher_id=${voucherId}` : ''}`, { cache: 'no-store' })) || []
  } catch (e) {
    throw new Error(`Gagal memuat penukaran. ${e.message}`)
  }
}

/** One customer's plan, usage and credit (+ last credit entries) for the customers page. */
export async function adminCustomerQuota(userId) {
  if (isUsingMockCloud()) {
    const u = (read('satualur_mock_v1', {}).users || []).find((x) => x.id === userId)
    if (!u) throw new Error('Pengguna tidak ditemukan.')
    const entries = loadStore().entries.filter((e) => e.user_id === userId).slice(-20).reverse()
    return { ...(await mockSummary(u)), entries }
  }
  return call(`/api/office/admin/customers/${encodeURIComponent(userId)}/quota`, { cache: 'no-store' })
}

export async function adminGrantCredit(userId, amount_idr, note = '') {
  if (!isUsingMockCloud()) return call(`/api/office/admin/customers/${encodeURIComponent(userId)}/credit`, { method: 'POST', body: { amount_idr, note } })
  if (!Number.isInteger(amount_idr) || amount_idr === 0 || Math.abs(amount_idr) > 10_000_000) throw new Error('Jumlah saldo harus bilangan bulat bukan nol, maksimal Rp10.000.000.')
  const db = loadStore()
  const next = (db.credits[userId] || 0) + amount_idr
  if (next < 0) throw new Error('Saldo tidak cukup untuk dikurangi sebanyak itu.')
  db.credits[userId] = next
  const who = (await sessionUser())?.name || 'demo'
  db.entries.push({ user_id: userId, amount_idr, reason: 'staff', ref: `${who}${note ? `: ${note}` : ''}`, created_at: new Date().toISOString() })
  saveStore(db)
  return adminCustomerQuota(userId)
}

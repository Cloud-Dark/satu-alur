/**
 * Subscription plans — client for /api/plans (public read) and /api/office/admin/plans (staff).
 * In demo mode (mock cloud) plans live in localStorage `satualur_business_demo_v1` as { next, plans: [] }.
 * Test seams (demo mode): `satualur_business_fail` = '1' makes reads fail; `satualur_business_delay` = ms delays admin reads.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { validatePlan, validateReorder } from './plan-rules.js'
import { validatePaymentSettings, testGateway } from './payment.js'

const DEMO_KEY = 'satualur_business_demo_v1'
const FAIL_KEY = 'satualur_business_fail'
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

const loadDemo = () => {
  try {
    const d = JSON.parse(localStorage.getItem(DEMO_KEY))
    if (d && Array.isArray(d.plans)) return d
  } catch { /* corrupt: start empty */ }
  return { next: 1, plans: [] }
}
const bySort = (a, b) => a.sort - b.sort || a.id - b.id

/** Active plans in order, or null on any error (the landing keeps its built-in cards). */
export async function getPlans() {
  try {
    if (isUsingMockCloud()) {
      if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('demo: gagal dimuat')
      return loadDemo().plans.filter((p) => p.active).sort(bySort)
    }
    const rows = await call('/api/plans')
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}

/** All plans, inactive included. Throws a readable error on failure. */
export async function adminListPlans() {
  if (isUsingMockCloud()) {
    const wait = Number(localStorage.getItem('satualur_business_delay')) || 0
    if (wait) await new Promise((r) => setTimeout(r, wait))
    if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('Gagal memuat paket. Coba lagi.')
    return loadDemo().plans.sort(bySort)
  }
  try {
    return (await call('/api/office/admin/plans', { cache: 'no-store' })) || []
  } catch (e) {
    throw new Error(`Gagal memuat paket. ${e.message}`)
  }
}

// The public list is cached for 60 s; refresh this browser's copy so the landing shows the change.
const refreshPublic = () => { fetch('/api/plans', { cache: 'reload' }).catch(() => {}) }

async function mockWrite(patch, id) {
  const db = loadDemo()
  const cur = id === undefined ? null : db.plans.find((p) => p.id === id)
  if (id !== undefined && !cur) throw new Error('Paket tidak ditemukan.')
  const v = validatePlan({ ...(cur || {}), ...patch })
  if (db.plans.some((p) => p.slug === v.slug && p.id !== id)) throw new Error('Slug sudah dipakai.')
  const who = (await getCloud().auth.getSession())?.data?.user?.name || 'demo'
  const row = { ...v, id: cur ? cur.id : db.next, updated_at: new Date().toISOString(), updated_by: who }
  if (v.recommended) db.plans.forEach((p) => { if (p.id !== row.id) p.recommended = 0 })
  if (cur) db.plans[db.plans.indexOf(cur)] = row
  else { db.plans.push(row); db.next += 1 }
  localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  return row
}

/** Create a plan; returns the saved plan. */
export async function adminCreatePlan(plan) {
  if (isUsingMockCloud()) return mockWrite(plan)
  const row = await call('/api/office/admin/plans', { method: 'POST', body: plan })
  refreshPublic()
  return row
}

/** Rewrite `sort` as 1..n following `ids` (every plan id once) in one write. */
export async function adminReorderPlans(ids) {
  if (isUsingMockCloud()) {
    const db = loadDemo()
    validateReorder(ids, db.plans.map((p) => p.id))
    db.plans.forEach((p) => { p.sort = ids.indexOf(p.id) + 1 })
    localStorage.setItem(DEMO_KEY, JSON.stringify(db))
    return db.plans.sort(bySort)
  }
  const rows = await call('/api/office/admin/plans/reorder', { method: 'POST', body: { ids } })
  refreshPublic()
  return rows
}

/* Payment gateway. The demo store never keeps a secret: only "set", last4, and whether the key contained "salah". */
const NO_PAYMENT = { provider: 'none', mode: 'sandbox', client_key: '', server_key_set: false, server_key_last4: '', webhook_token_set: false, updated_at: null, updated_by: null }
const publicPayment = ({ key_wrong, ...rest } = {}) => ({ ...NO_PAYMENT, ...rest })

/** Stored settings (flags + last4, never a key). Throws a readable error on failure. */
export async function adminGetPayment() {
  if (isUsingMockCloud()) {
    if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('Gagal memuat pengaturan pembayaran. Coba lagi.')
    return publicPayment(loadDemo().payment)
  }
  try {
    return await call('/api/office/admin/payment', { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Gagal memuat pengaturan pembayaran. ${e.message}`)
  }
}

/** Save; blank secrets keep the stored ones, `clear_server_key: true` removes the server key. */
export async function adminSavePayment(body) {
  if (!isUsingMockCloud()) return call('/api/office/admin/payment', { method: 'PUT', body })
  const v = validatePaymentSettings(body)
  const db = loadDemo()
  const cur = db.payment || {}
  const keep = !v.clear_server_key && cur.server_key_set
  db.payment = {
    provider: v.provider, mode: v.mode, client_key: v.client_key,
    server_key_set: Boolean(v.server_key) || Boolean(keep),
    server_key_last4: v.server_key ? v.server_key.slice(-4) : keep ? cur.server_key_last4 : '',
    key_wrong: v.server_key ? v.server_key.includes('salah') : Boolean(keep && cur.key_wrong),
    webhook_token_set: Boolean(v.webhook_token) || Boolean(cur.webhook_token_set),
    updated_at: new Date().toISOString(),
    updated_by: (await getCloud().auth.getSession())?.data?.user?.name || 'demo',
  }
  localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  return publicPayment(db.payment)
}

/** Test the stored settings against the provider; returns { ok, message }. */
export async function adminTestPayment() {
  if (!isUsingMockCloud()) return call('/api/office/admin/payment/test', { method: 'POST' })
  const p = loadDemo().payment || {}
  // Fake provider answer after ~600 ms: 401 when the saved key contained "salah".
  const fake = async () => { await new Promise((r) => setTimeout(r, 600)); return { status: p.key_wrong ? 401 : p.provider === 'xendit' ? 200 : 404 } }
  return testGateway({ provider: p.provider, mode: p.mode, serverKey: p.server_key_set ? 'demo' : '' }, fake)
}

/** Patch any fields of a plan (also how a plan is deactivated: `active: 0`; reordering goes through adminReorderPlans). */
export async function adminUpdatePlan(id, patch) {
  if (isUsingMockCloud()) return mockWrite(patch, id)
  const row = await call(`/api/office/admin/plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
  refreshPublic()
  return row
}

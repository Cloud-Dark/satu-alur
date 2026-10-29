/**
 * Customers admin (staff) — client for /api/office/admin/customers.
 * Demo mode (mock cloud): business users come from the mock cloud's users table (localStorage `satualur_mock_v1`);
 * plan/status rows live in `satualur_customers_demo_v1` as { accounts: { [userId]: row } }.
 * Test seams (demo mode): `satualur_customers_fail` = '1' makes reads fail; `satualur_customers_delay` = ms delays the list.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { isDemoEmail } from '../auth/demo-accounts.js'
import { validateCustomer, STAFF_EMAIL_SUFFIX } from './rules.js'
import { adminListPlans } from '../business/api.js'

export const PAGE_SIZE = 50
const DEMO_KEY = 'satualur_customers_demo_v1'
const FAIL_KEY = 'satualur_customers_fail'
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

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback }
}
const loadAccounts = () => read(DEMO_KEY, {}).accounts || {}
const mockUsers = () => (read('satualur_mock_v1', {}).users || []).filter((u) => !String(u.email).endsWith(STAFF_EMAIL_SUFFIX))

async function withPlans(rows) {
  const plans = await adminListPlans().catch(() => [])
  return rows.map((u) => {
    const a = loadAccounts()[u.id] || {}
    return {
      id: u.id, email: u.email, name: u.name, created_at: u.created_at, demo: isDemoEmail(u.email),
      plan_id: a.plan_id ?? null, plan_name: plans.find((p) => p.id === a.plan_id)?.name ?? null, status: a.status ?? null,
      period_end: a.period_end ?? null, company: a.company ?? '', phone: a.phone ?? '', notes: a.notes ?? '',
      updated_at: a.updated_at ?? null, updated_by: a.updated_by ?? null,
    }
  })
}

/** { items, total, page } — 50 per page, newest first. Throws a readable error. */
export async function adminListCustomers({ q = '', page = 1 } = {}) {
  if (isUsingMockCloud()) {
    const wait = Number(localStorage.getItem('satualur_customers_delay')) || 0
    if (wait) await new Promise((r) => setTimeout(r, wait))
    if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('Gagal memuat pelanggan. Coba lagi.')
    const needle = q.trim().toLowerCase()
    const accounts = loadAccounts()
    const hit = (u) => !needle || [u.email, u.name, accounts[u.id]?.company].some((s) => String(s || '').toLowerCase().includes(needle))
    const all = mockUsers().filter(hit).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    return { items: await withPlans(all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)), total: all.length, page }
  }
  try {
    return await call(`/api/office/admin/customers?q=${encodeURIComponent(q)}&page=${page}`, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Gagal memuat pelanggan. ${e.message}`)
  }
}

/** One customer, fresh from the server (shows who changed it last). */
export async function adminGetCustomer(id) {
  if (isUsingMockCloud()) {
    if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('Gagal memuat pelanggan. Coba lagi.')
    const u = mockUsers().find((x) => x.id === id)
    if (!u) throw new Error('Pelanggan tidak ditemukan.')
    return (await withPlans([u]))[0]
  }
  try {
    return await call(`/api/office/admin/customers/${encodeURIComponent(id)}`, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Gagal memuat pelanggan. ${e.message}`)
  }
}

/** Upsert plan, status and notes; returns the saved customer. */
export async function adminSaveCustomer(id, body) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/customers/${encodeURIComponent(id)}`, { method: 'PUT', body })
  const v = validateCustomer(body)
  const u = mockUsers().find((x) => x.id === id)
  if (!u) throw new Error('Pelanggan tidak ditemukan.')
  if (v.plan_id !== null && !(await adminListPlans()).some((p) => p.id === v.plan_id)) throw new Error('Paket tidak ditemukan.')
  const db = read(DEMO_KEY, {})
  const who = (await getCloud().auth.getSession())?.data?.user?.name || 'demo'
  db.accounts = { ...(db.accounts || {}), [id]: { ...v, updated_at: new Date().toISOString(), updated_by: who } }
  localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  return (await withPlans([u]))[0]
}

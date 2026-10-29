/**
 * Customers admin (staff) — client for /api/office/admin/customers.
 * Demo mode (mock cloud): business users come from the mock cloud's users table (localStorage `satualur_mock_v1`);
 * plan/status rows live in `satualur_customers_demo_v1` as { accounts: { [userId]: row } }; user flags
 * (Pengguna) live there too as { flags: { [userId]: { suspended, reason, revoked_at, updated_at, updated_by } } },
 * and src/mock/mock-cloud.js reads them to refuse suspended logins.
 * Test seams (demo mode): `satualur_customers_fail` = '1' makes reads fail; `satualur_customers_delay` = ms delays the list.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { isDemoEmail } from '../auth/demo-accounts.js'
import {
  validateCustomer, validateSuspendReason, STAFF_EMAIL_SUFFIX,
  validateContact, validateContactUpdate, isHoneypot, contactRateLimited, CONTACT_OK_MESSAGE, CONTACT_LIMIT_MESSAGE,
} from './rules.js'
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

// Mock list: same search (fields), order and paging as the Worker.
async function mockPage({ q, page }, fields, failMessage) {
  const wait = Number(localStorage.getItem('satualur_customers_delay')) || 0
  if (wait) await new Promise((r) => setTimeout(r, wait))
  if (localStorage.getItem(FAIL_KEY) === '1') throw new Error(failMessage)
  const needle = q.trim().toLowerCase()
  const hit = (u) => !needle || fields(u).some((s) => String(s || '').toLowerCase().includes(needle))
  const all = mockUsers().filter(hit).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return { rows: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: all.length, page }
}

/** { items, total, page } — 50 per page, newest first. Throws a readable error. */
export async function adminListCustomers({ q = '', page = 1 } = {}) {
  if (isUsingMockCloud()) {
    const accounts = loadAccounts()
    const { rows, total } = await mockPage({ q, page }, (u) => [u.email, u.name, accounts[u.id]?.company], 'Gagal memuat pelanggan. Coba lagi.')
    return { items: await withPlans(rows), total, page }
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
    const u = mockUsers().find((x) => x.id === id) // mockUsers() already drops staff
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

/* ------------------------------------------------------------------ Pengguna */

const loadFlags = () => read(DEMO_KEY, {}).flags || {}
async function saveFlag(id, change) {
  const u = mockUsers().find((x) => x.id === id) // mockUsers() drops staff, like the Worker's 400
  if (!u) throw new Error('Pengguna tidak ditemukan.')
  const db = read(DEMO_KEY, {})
  const who = (await getCloud().auth.getSession())?.data?.user?.name || 'demo'
  db.flags = { ...(db.flags || {}), [id]: { ...(db.flags?.[id] || {}), ...change, updated_at: new Date().toISOString(), updated_by: who } }
  localStorage.setItem(DEMO_KEY, JSON.stringify(db))
}

/** { items: [{ id, email, name, created_at, active_sessions, suspended, reason, last_session_at, demo }], total, page } */
export async function adminListUsers({ q = '', page = 1 } = {}) {
  if (isUsingMockCloud()) {
    const { rows, total } = await mockPage({ q, page }, (u) => [u.email, u.name], 'Gagal memuat pengguna. Coba lagi.')
    const flags = loadFlags()
    // ponytail: mock sessions live in each page's memory, so the mock can't count them; always 0 here.
    const items = rows.map((u) => ({
      id: u.id, email: u.email, name: u.name, created_at: u.created_at, active_sessions: 0, last_session_at: null,
      suspended: flags[u.id]?.suspended === 1, reason: flags[u.id]?.reason || '', demo: isDemoEmail(u.email),
    }))
    return { items, total, page }
  }
  try {
    return await call(`/api/office/admin/users?q=${encodeURIComponent(q)}&page=${page}`, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Gagal memuat pengguna. ${e.message}`)
  }
}

const userPath = (id, action) => `/api/office/admin/users/${encodeURIComponent(id)}/${action}`

/** Suspends the user (reason required, ≤ 300) and ends all their sessions. */
export async function adminSuspendUser(id, reason) {
  const clean = validateSuspendReason({ reason })
  if (!isUsingMockCloud()) return call(userPath(id, 'suspend'), { method: 'POST', body: { reason: clean } })
  const now = new Date().toISOString()
  await saveFlag(id, { suspended: 1, reason: clean, revoked_at: now })
}

export async function adminRestoreUser(id) {
  if (!isUsingMockCloud()) return call(userPath(id, 'restore'), { method: 'POST' })
  await saveFlag(id, { suspended: 0 })
}

export async function adminRevokeUserSessions(id) {
  if (!isUsingMockCloud()) return call(userPath(id, 'revoke-sessions'), { method: 'POST' })
  await saveFlag(id, { revoked_at: new Date().toISOString() })
}

/* ------------------------------------------------------------------ Contact Us */
// Demo mode keeps messages in DEMO_KEY as { contact: [row], contact_hits: [ms] }; the rate limit is per browser (one fixed "ip").

/** Public form → CONTACT_OK_MESSAGE. Honeypot hits succeed without storing. */
export async function sendContact(body) {
  if (!isUsingMockCloud()) return (await call('/api/contact', { method: 'POST', body })).message
  if (isHoneypot(body)) return CONTACT_OK_MESSAGE
  const v = validateContact(body)
  const db = read(DEMO_KEY, {})
  const now = Date.now()
  const hits = (db.contact_hits || []).filter((t) => t > now - 3600 * 1000)
  if (contactRateLimited(hits.length)) throw new Error(CONTACT_LIMIT_MESSAGE)
  const rows = db.contact || []
  const id = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1
  db.contact = [...rows, { id, ...v, status: 'new', staff_note: '', created_at: new Date(now).toISOString(), updated_at: null, updated_by: null }]
  db.contact_hits = [...hits, now]
  localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  return CONTACT_OK_MESSAGE
}

/** { items, total, page } — status: new | read | replied | archived | all; 50 per page, newest first. */
export async function adminListContact({ status = 'new', page = 1 } = {}) {
  if (isUsingMockCloud()) {
    const wait = Number(localStorage.getItem('satualur_customers_delay')) || 0
    if (wait) await new Promise((r) => setTimeout(r, wait))
    if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('Gagal memuat pesan. Coba lagi.')
    const all = (read(DEMO_KEY, {}).contact || []).filter((r) => status === 'all' || r.status === status)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    return { items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: all.length, page }
  }
  try {
    return await call(`/api/office/admin/contact?status=${encodeURIComponent(status)}&page=${page}`, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Gagal memuat pesan. ${e.message}`)
  }
}

/** Number of unread (new) messages, for the badge. */
export async function adminContactCounts() {
  if (isUsingMockCloud()) return { new: (read(DEMO_KEY, {}).contact || []).filter((r) => r.status === 'new').length }
  return call('/api/office/admin/contact/counts', { cache: 'no-store' })
}

/** PATCH { status?, staff_note? }; returns the saved message. */
export async function adminUpdateContact(id, body) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/contact/${encodeURIComponent(id)}`, { method: 'PATCH', body })
  const v = validateContactUpdate(body)
  const db = read(DEMO_KEY, {})
  const row = (db.contact || []).find((r) => r.id === id)
  if (!row) throw new Error('Pesan tidak ditemukan.')
  Object.assign(row, v, { updated_at: new Date().toISOString(), updated_by: (await getCloud().auth.getSession())?.data?.user?.name || 'demo' })
  localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  return row
}

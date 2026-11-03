/**
 * Offer templates client: /api/offer-templates (businesses, active only) and
 * /api/office/admin/offer-templates (admins). In demo mode (mock cloud) the list
 * lives in localStorage `satualur_offer_templates_v1`, seeded with the defaults.
 */
import { isUsingMockCloud } from '../cloud.js'
import { DEFAULT_TEMPLATES, validateTemplate } from './templates.js'

const DEMO_KEY = 'satualur_offer_templates_v1'
const token = () => { try { return localStorage.getItem('satualur_token') } catch { return null } }

async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
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

const bySort = (a, b) => (a.sort - b.sort) || (a.id - b.id)

function loadDemo() {
  try {
    const d = JSON.parse(localStorage.getItem(DEMO_KEY))
    if (d && Array.isArray(d.items)) return d
  } catch { /* corrupt: reseed */ }
  const now = new Date().toISOString()
  const items = DEFAULT_TEMPLATES.map((t, i) => ({ ...validateTemplate(t), id: i + 1, created_by: 'bawaan', updated_at: now }))
  const d = { next: items.length + 1, items }
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)) } catch { /* storage full */ }
  return d
}
const saveDemo = (d) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)) } catch { /* storage full */ } }

/** Active templates for the offer wizard (empty list on any error). */
export async function listTemplates() {
  try {
    if (isUsingMockCloud()) return loadDemo().items.filter((t) => t.active).sort(bySort)
    const rows = await call('/api/offer-templates')
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

/** Admin list, paged: { items, total, page, per }. */
export async function adminListTemplates({ page = 1, per = 20, q = '' } = {}) {
  if (isUsingMockCloud()) {
    const needle = q.trim().toLowerCase()
    const all = loadDemo().items.filter((t) => !needle || `${t.name} ${t.description}`.toLowerCase().includes(needle)).sort(bySort)
    return { items: all.slice((page - 1) * per, page * per), total: all.length, page, per }
  }
  const qs = new URLSearchParams({ page: String(page), per: String(per), ...(q.trim() ? { q: q.trim() } : {}) })
  return call(`/api/office/admin/offer-templates?${qs}`)
}

export async function adminCreateTemplate(input) {
  if (!isUsingMockCloud()) return call('/api/office/admin/offer-templates', { method: 'POST', body: input })
  const d = loadDemo()
  const row = { ...validateTemplate(input), id: d.next, created_by: 'demo', updated_at: new Date().toISOString() }
  d.items.push(row); d.next += 1
  saveDemo(d)
  return row
}

export async function adminUpdateTemplate(id, patch) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/offer-templates/${id}`, { method: 'PATCH', body: patch })
  const d = loadDemo()
  const i = d.items.findIndex((t) => t.id === id)
  if (i === -1) throw new Error('Template tidak ditemukan.')
  const row = { ...d.items[i], ...validateTemplate({ ...d.items[i], ...patch }), updated_at: new Date().toISOString() }
  d.items[i] = row
  saveDemo(d)
  return row
}

export async function adminDeleteTemplate(id) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/offer-templates/${id}`, { method: 'DELETE' })
  const d = loadDemo()
  d.items = d.items.filter((t) => t.id !== id)
  saveDemo(d)
  return { id, deleted: true }
}

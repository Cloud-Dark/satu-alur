/**
 * Editable site content — client for /api/site/:key (public read) and
 * /api/office/admin/site/:key (staff write). In demo mode (mock cloud) rows live
 * in localStorage `satualur_site_demo_v1` as { [key]: { value, updated_at, updated_by } }.
 * Test seam: localStorage `satualur_site_fail` = '1' makes getSite fail (demo mode).
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { validateSiteContent } from './content-rules.js'

const DEMO_KEY = 'satualur_site_demo_v1'
const FAIL_KEY = 'satualur_site_fail'
const token = () => { try { return localStorage.getItem('satualur_token') } catch { return null } }

async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
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

const loadDemo = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {} } catch { return {} } }

/** { key, value | null, updated_at, updated_by }, or null on any error (callers keep their defaults). */
export async function getSite(key) {
  try {
    if (isUsingMockCloud()) {
      if (localStorage.getItem(FAIL_KEY) === '1') throw new Error('demo: gagal dimuat')
      const row = loadDemo()[key]
      return { key, value: row?.value ?? null, updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null }
    }
    return (await call(`/api/site/${encodeURIComponent(key)}`)) ?? null
  } catch {
    return null
  }
}

/** Throws a readable error on failure. */
export async function saveSite(key, value) {
  if (isUsingMockCloud()) {
    const clean = validateSiteContent(key, value)
    const who = (await getCloud().auth.getSession())?.data?.user?.name || 'demo'
    const all = loadDemo()
    all[key] = { value: clean, updated_at: new Date().toISOString(), updated_by: who }
    localStorage.setItem(DEMO_KEY, JSON.stringify(all))
    return { key, ...all[key] }
  }
  return call(`/api/office/admin/site/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } })
}

/**
 * Pencari prospek — client for /api/leads/*. In mock mode (local dev) the
 * routes are stubbed locally with the same fictional data the Worker gives
 * demo accounts (src/leads/demo.js), labelled "Data contoh (akun demo)" by the
 * UI. Never throws on HTTP errors without a readable Indonesian message.
 */
import { isUsingMockCloud } from '../cloud.js'
import { demoGeocode, demoSearch } from './demo.js'
import { t } from '../i18n/index.js'

const TOKEN_KEY = 'satualur_token'
const token = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

async function call(path, { method = 'GET', body, signal } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error(t('leads.api.network'))
  }
  let json = null
  try { json = await res.json() } catch { /* not JSON */ }
  if (!res.ok || json?.error) throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { status: res.status })
  return json?.data
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Dibatalkan', 'AbortError')) }, { once: true })
})

export async function getSources({ signal } = {}) {
  if (isUsingMockCloud()) return { osm: true, google: false, demo: true, max_radius_km: 40, searches_per_hour: 20 }
  try { return await call('/api/leads/sources', { signal }) } catch (e) {
    if (e.name === 'AbortError') throw e
    return { osm: true, google: false }
  }
}

export async function geocode(q, { signal } = {}) {
  const query = String(q || '').trim()
  if (isUsingMockCloud()) {
    await wait(250, signal)
    return demoGeocode(query)
  }
  return (await call(`/api/leads/geocode?${new URLSearchParams({ q: query })}`, { signal })) || []
}

export async function searchLeads({ lat, lon, radiusKm, keywords, source = 'osm', signal }) {
  if (isUsingMockCloud()) {
    await wait(700, signal)
    return demoSearch({ lat, lon, radiusKm, keywords })
  }
  return call('/api/leads/search', { method: 'POST', body: { lat, lon, radius_km: radiusKm, keywords, source }, signal })
}

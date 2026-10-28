/**
 * Pencari prospek — client for /api/leads/*. In demo mode (mock cloud) the
 * routes are stubbed locally: a deterministic sample around the chosen point,
 * labelled "Data contoh (mode demo)" by the UI. Never throws on HTTP errors
 * without a readable Indonesian message.
 */
import { isUsingMockCloud } from '../cloud.js'
import { validateKeywords, inIndonesia, roundSearch } from './osm.js'
import { sampleLeads } from './scoring.js'

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
    throw new Error('Jaringan bermasalah. Periksa koneksi lalu coba lagi.')
  }
  let json = null
  try { json = await res.json() } catch { /* not JSON */ }
  if (!res.ok || json?.error) throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { status: res.status })
  return json?.data
}

/* Demo-mode places (offline geocoder). */
const DEMO_PLACES = [
  ['Bekasi, Jawa Barat', -6.2383, 106.9756], ['Jakarta Selatan, DKI Jakarta', -6.2615, 106.8106], ['Jakarta Pusat, DKI Jakarta', -6.1865, 106.8341],
  ['Depok, Jawa Barat', -6.4025, 106.7942], ['Tangerang, Banten', -6.1783, 106.6319], ['Bogor, Jawa Barat', -6.5971, 106.806],
  ['Bandung, Jawa Barat', -6.9175, 107.6191], ['Semarang, Jawa Tengah', -6.9667, 110.4167], ['Yogyakarta, DI Yogyakarta', -7.7956, 110.3695],
  ['Surabaya, Jawa Timur', -7.2575, 112.7521], ['Malang, Jawa Timur', -7.9666, 112.6326], ['Denpasar, Bali', -8.6705, 115.2126],
  ['Medan, Sumatera Utara', 3.5952, 98.6722], ['Makassar, Sulawesi Selatan', -5.1477, 119.4327], ['Balikpapan, Kalimantan Timur', -1.2379, 116.8529],
]

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
    const k = query.toLowerCase()
    return DEMO_PLACES.filter(([label]) => label.toLowerCase().includes(k)).slice(0, 6)
      .map(([label, lat, lon]) => ({ label: `${label}, Indonesia`, lat, lon, type: 'city', demo: true }))
  }
  return (await call(`/api/leads/geocode?${new URLSearchParams({ q: query })}`, { signal })) || []
}

export async function searchLeads({ lat, lon, radiusKm, keywords, source = 'osm', signal }) {
  if (isUsingMockCloud()) {
    const { keywords: kw, error } = validateKeywords(keywords)
    if (error) throw new Error(error)
    if (!inIndonesia(lat, lon)) throw new Error('Pencarian prospek saat ini hanya untuk wilayah Indonesia.')
    await wait(700, signal)
    const r = roundSearch({ lat, lon, radiusKm, keywords: kw })
    return {
      source: 'demo',
      attribution: 'Data contoh (mode demo)',
      center: { lat: r.lat, lon: r.lon },
      radius_km: r.radiusKm,
      keywords: r.keywords,
      truncated: false,
      cached: false,
      fetched_at: new Date().toISOString(),
      results: sampleLeads({ lat: r.lat, lon: r.lon, radiusKm: r.radiusKm, keywords: r.keywords }),
    }
  }
  return call('/api/leads/search', { method: 'POST', body: { lat, lon, radius_km: radiusKm, keywords, source }, signal })
}

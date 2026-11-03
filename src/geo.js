// Geocoding for petugas addresses and request locations, through the lead
// finder's geocoder (/api/leads/geocode: OpenStreetMap Nominatim, cached and
// rate-limited on the server; demo accounts get the offline gazetteer).
// Must never throw: callers treat null as "no location".
import { geocode as lookup } from './leads/api.js'

const cache = new Map()

/** "Kota Bekasi, Jawa Barat, Indonesia" → "Kota Bekasi" */
export const zoneOf = (label) => String(label || '').split(',')[0].replace(/\s*\(contoh\)\s*$/, '').trim() || null

export async function geocode(address) {
  const q = String(address || '').replace(/\s+/g, ' ').trim()
  if (q.length < 3) return null
  if (cache.has(q)) return cache.get(q)
  let result = null
  try {
    const hits = await lookup(q)
    const hit = Array.isArray(hits) ? hits[0] : null
    if (hit && Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lon))) {
      result = { lat: Number(hit.lat), lng: Number(hit.lon), zone: zoneOf(hit.label) }
    }
  } catch { result = null }
  cache.set(q, result)
  return result
}

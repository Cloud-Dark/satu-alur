/**
 * Pencari prospek for demo accounts: an offline gazetteer and fictional
 * businesses around the chosen point. Shared by the Worker (demo sessions on
 * the live site) and the mock cloud (local dev), so demo accounts never reach
 * OpenStreetMap, Nominatim or Google.
 */
import { validateKeywords, inIndonesia, roundSearch, MAX_RADIUS_KM } from './osm.js'
import { sampleLeads } from './scoring.js'

export const DEMO_ATTRIBUTION = 'Data contoh (akun demo)'

/** [label, lat, lon, aliases] — city centres, good enough to drop a pin. */
export const DEMO_GAZETTEER = [
  ['Jakarta Pusat, DKI Jakarta', -6.1865, 106.8341, 'jakarta monas menteng tanah abang'],
  ['Jakarta Selatan, DKI Jakarta', -6.2615, 106.8106, 'jakarta jaksel kebayoran blok m senayan'],
  ['Jakarta Barat, DKI Jakarta', -6.1674, 106.7637, 'jakarta jakbar grogol kebon jeruk'],
  ['Jakarta Timur, DKI Jakarta', -6.225, 106.9004, 'jakarta jaktim cakung rawamangun'],
  ['Jakarta Utara, DKI Jakarta', -6.1384, 106.8636, 'jakarta jakut kelapa gading sunter'],
  ['Bekasi, Jawa Barat', -6.2383, 106.9756, 'bekasi barat bekasi timur summarecon'],
  ['Depok, Jawa Barat', -6.4025, 106.7942, 'depok margonda'],
  ['Tangerang, Banten', -6.1783, 106.6319, 'tangerang'],
  ['Tangerang Selatan, Banten', -6.2886, 106.7179, 'tangsel bsd serpong bintaro'],
  ['Bogor, Jawa Barat', -6.5971, 106.806, 'bogor'],
  ['Bandung, Jawa Barat', -6.9175, 107.6191, 'bandung dago'],
  ['Cirebon, Jawa Barat', -6.732, 108.5523, 'cirebon'],
  ['Semarang, Jawa Tengah', -6.9667, 110.4167, 'semarang simpang lima'],
  ['Solo (Surakarta), Jawa Tengah', -7.5755, 110.8243, 'solo surakarta'],
  ['Yogyakarta, DI Yogyakarta', -7.7956, 110.3695, 'yogyakarta jogja jogjakarta malioboro'],
  ['Surabaya, Jawa Timur', -7.2575, 112.7521, 'surabaya'],
  ['Sidoarjo, Jawa Timur', -7.4478, 112.7183, 'sidoarjo'],
  ['Malang, Jawa Timur', -7.9666, 112.6326, 'malang'],
  ['Denpasar, Bali', -8.6705, 115.2126, 'denpasar bali kuta'],
  ['Medan, Sumatera Utara', 3.5952, 98.6722, 'medan'],
  ['Palembang, Sumatera Selatan', -2.9761, 104.7754, 'palembang'],
  ['Pekanbaru, Riau', 0.5071, 101.4478, 'pekanbaru'],
  ['Padang, Sumatera Barat', -0.9471, 100.4172, 'padang'],
  ['Batam, Kepulauan Riau', 1.0456, 104.0305, 'batam'],
  ['Bandar Lampung, Lampung', -5.3971, 105.2668, 'lampung bandar lampung'],
  ['Makassar, Sulawesi Selatan', -5.1477, 119.4327, 'makassar'],
  ['Manado, Sulawesi Utara', 1.4748, 124.8421, 'manado'],
  ['Balikpapan, Kalimantan Timur', -1.2379, 116.8529, 'balikpapan'],
  ['Samarinda, Kalimantan Timur', -0.5022, 117.1536, 'samarinda'],
  ['Pontianak, Kalimantan Barat', -0.0263, 109.3425, 'pontianak'],
  ['Banjarmasin, Kalimantan Selatan', -3.3186, 114.5944, 'banjarmasin'],
  ['Mataram, Nusa Tenggara Barat', -8.5833, 116.1167, 'mataram lombok'],
  ['Kupang, Nusa Tenggara Timur', -10.1772, 123.607, 'kupang'],
  ['Jayapura, Papua', -2.5916, 140.669, 'jayapura'],
]

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Offline address search: matches labels and aliases, best match first. */
export function demoGeocode(q) {
  const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  return DEMO_GAZETTEER
    .map(([label, lat, lon, aliases]) => {
      const hay = fold(`${label} ${aliases}`)
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
      return { label: `${label}, Indonesia (contoh)`, lat, lon, type: 'city', demo: true, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map(({ score, ...r }) => r)
}

/**
 * Builds the same response shape as POST /api/leads/search, from fictional
 * businesses. Throws Error with an Indonesian message on invalid input.
 */
export function demoSearch({ lat, lon, radiusKm, keywords, seed = '' }) {
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('Titik pencarian tidak valid.')
  if (!inIndonesia(la, lo)) throw new Error('Pencarian prospek saat ini hanya untuk wilayah Indonesia.')
  const { keywords: kw, error } = validateKeywords(keywords)
  if (error) throw new Error(error)
  const r = roundSearch({ lat: la, lon: lo, radiusKm: Math.min(Number(radiusKm) || 5, MAX_RADIUS_KM), keywords: kw })
  return {
    source: 'demo',
    via: 'demo',
    demo: true,
    attribution: DEMO_ATTRIBUTION,
    center: { lat: r.lat, lon: r.lon },
    radius_km: r.radiusKm,
    keywords: r.keywords,
    truncated: false,
    cached: false,
    fetched_at: new Date().toISOString(),
    results: sampleLeads({ lat: r.lat, lon: r.lon, radiusKm: r.radiusKm, keywords: r.keywords, seed }).map((x) => ({ ...x, demo: true })),
  }
}

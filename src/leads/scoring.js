/**
 * Pencari prospek — scoring, value estimates and the demo sample set.
 * Pure functions (no DOM, no network); unit tested in tests/leads.test.mjs.
 *
 * Score       = relevance (0–100) × proximity (0.4–1) × data completeness (0.6–1)
 * Potensi     = the user's real average job value for the suggested service
 *               (from their own D1 history), else their overall average, else
 *               the estimate they typed in.
 * Nilai harapan = potensi × conversion assumption (default 10%, user editable).
 */
import { specForKeyword, offsetPoint, haversineKm, dedupeLeads, categoryFromTags, MAX_RESULTS } from './osm.js'

export const DEFAULT_CONVERSION = 0.1
export const MIN_CONVERSION = 0.01
export const MAX_CONVERSION = 0.5

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const serviceKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/* ----------------------------------------------------------- Scoring */

/** 1.0 at the centre, falling linearly to 0.4 at the edge of the radius. */
export function proximityFactor(distanceKm, radiusKm) {
  const r = Number(radiusKm) > 0 ? Number(radiusKm) : 1
  const d = Math.max(0, Number(distanceKm) || 0)
  return Math.round(clamp(1 - 0.6 * (d / r), 0.4, 1) * 1000) / 1000
}

/** 0.6 with no contact data; +0.15 phone, +0.15 website, +0.10 address. */
export function completenessFactor({ phone, website, address } = {}) {
  return Math.round((0.6 + (phone ? 0.15 : 0) + (website ? 0.15 : 0) + (address ? 0.1 : 0)) * 1000) / 1000
}

export function scoreLead({ relevance, distance_km: distanceKm, phone, website, address }, radiusKm) {
  const rel = clamp(Math.round(Number(relevance) || 0), 0, 100)
  const proximity = proximityFactor(distanceKm, radiusKm)
  const completeness = completenessFactor({ phone, website, address })
  return { score: Math.round(rel * proximity * completeness), relevance: rel, proximity, completeness }
}

/* ------------------------------------------------- Service history */

/**
 * Average job value per service type from the user's own flow data
 * (model from loadFlow / buildModel). A job's value is its booked revenue
 * (ledger 'pendapatan') when posted, otherwise the approved offer price.
 * Returns [{ name, key, count, avg, total, booked }] sorted by count.
 */
export function serviceStats(model) {
  const by = new Map()
  for (const r of model?.requests || []) {
    const name = String(r.service_type || '').trim()
    if (!name) continue
    let value = 0
    let booked = false
    for (const o of model.offersOf(r.id)) {
      for (const a of model.assignmentsOf(o.id)) {
        for (const c of model.completionsOf(a.id)) {
          for (const l of model.ledgerOf(c.id)) {
            if (l.category === 'pendapatan') { value += Number(l.amount) || 0; booked = true }
          }
        }
      }
    }
    if (!booked) {
      const approved = model.offersOf(r.id).filter((o) => o.status === 'approved')
      value = approved.length ? Math.max(...approved.map((o) => Number(o.validated_price) || 0)) : 0
    }
    if (!(value > 0)) continue
    const k = serviceKey(name)
    const cur = by.get(k) || { name, key: k, count: 0, total: 0, booked: 0 }
    cur.count += 1
    cur.total += value
    if (booked) cur.booked += 1
    by.set(k, cur)
  }
  return [...by.values()]
    .map((s) => ({ ...s, avg: Math.round(s.total / s.count) }))
    .sort((a, b) => b.count - a.count || b.total - a.total)
}

/** All service names the user has ever recorded (even without a price yet). */
export function serviceNames(model) {
  const seen = new Map()
  for (const r of model?.requests || []) {
    const name = String(r.service_type || '').trim()
    if (!name) continue
    const k = serviceKey(name)
    const cur = seen.get(k) || { name, count: 0 }
    cur.count += 1
    seen.set(k, cur)
  }
  return [...seen.values()].sort((a, b) => b.count - a.count).map((s) => s.name)
}

export function overallAverage(stats) {
  const n = stats.reduce((s, x) => s + x.count, 0)
  return n ? Math.round(stats.reduce((s, x) => s + x.total, 0) / n) : 0
}

/**
 * Value estimate for one lead. basis: 'layanan' (avg of that service),
 * 'umum' (overall avg), 'perkiraan' (user-entered), or null (no basis).
 */
export function estimateValue({ service, stats = [], fallbackAvg = 0, conversion = DEFAULT_CONVERSION }) {
  const conv = clamp(Number(conversion) || DEFAULT_CONVERSION, MIN_CONVERSION, MAX_CONVERSION)
  const hit = service ? stats.find((s) => s.key === serviceKey(service)) : null
  let potential = 0
  let basis = null
  let note = ''
  if (hit) {
    potential = hit.avg
    basis = 'layanan'
    note = `Rata-rata ${hit.count} pekerjaan ${hit.name} Anda`
  } else if (stats.length) {
    potential = overallAverage(stats)
    basis = 'umum'
    note = `Rata-rata semua pekerjaan Anda (${stats.reduce((s, x) => s + x.count, 0)} pekerjaan)`
  } else if (Number(fallbackAvg) > 0) {
    potential = Math.round(Number(fallbackAvg))
    basis = 'perkiraan'
    note = 'Perkiraan yang Anda isi (belum ada riwayat)'
  }
  if (!basis) return { potential: 0, expected: 0, conversion: conv, basis: null, note: 'Belum ada riwayat nilai pekerjaan. Isi perkiraan nilai rata-rata.' }
  return { potential, expected: Math.round(potential * conv), conversion: conv, basis, note }
}

/* -------------------------------------------- Heuristic relevance */

/** Which service words tend to fit which kind of business (for the no-AI fallback). */
const AFFINITY = {
  hotel: /ac|pendingin|clean|bersih|laundry|cuci|pest|hama|rayap|listrik|kolam|kaca|sofa|karpet|kasur|fm|fasilitas/,
  restoran: /pest|hama|kecoa|tikus|duct|exhaust|ac|pendingin|clean|bersih|listrik|grease|dapur|gas/,
  kost: /ac|pendingin|laundry|cuci|clean|bersih|pest|hama|listrik|cat|dinding|renovasi|pompa/,
  rumah_sakit: /clean|bersih|ac|pendingin|pest|hama|laundry|disinfek|steril|listrik|fm|fasilitas/,
  klinik: /clean|bersih|ac|pendingin|pest|hama|disinfek|steril|listrik/,
  apotek: /ac|pendingin|clean|bersih|pest|listrik/,
  sekolah: /ac|pendingin|clean|bersih|cat|dinding|pest|hama|listrik|taman/,
  kampus: /ac|pendingin|clean|bersih|cat|dinding|pest|hama|listrik|taman|fm|fasilitas/,
  pabrik: /listrik|panel|genset|ac|pendingin|pest|hama|clean|bersih|industri|dinding|cat|atap|fm|fasilitas/,
  gudang: /pest|hama|rayap|tikus|listrik|clean|bersih|cat|atap|lantai/,
  mall: /clean|bersih|ac|pendingin|kaca|pest|hama|fm|fasilitas|listrik|eskalator/,
  pasar: /clean|bersih|pest|hama|listrik/,
  supermarket: /ac|pendingin|freezer|clean|bersih|pest|hama|listrik/,
  kantor: /ac|pendingin|clean|bersih|kebersihan|pest|hama|listrik|kaca|fm|fasilitas|cat/,
  apartemen: /ac|pendingin|clean|bersih|kaca|pest|hama|kolam|listrik|fm|fasilitas/,
  bank: /ac|pendingin|clean|bersih|listrik|fm/,
  ibadah: /ac|pendingin|clean|bersih|karpet|listrik|cat/,
  bengkel: /listrik|clean|bersih|cat|pest/,
  salon: /ac|pendingin|clean|bersih|listrik/,
  gym: /ac|pendingin|clean|bersih|kolam|listrik/,
  laundry: /listrik|mesin|clean|pest/,
}

/** Spec key for a lead: from the keyword it matched, else from its tags. */
export function leadKind(lead) {
  for (const k of lead.matched || []) {
    const s = specForKeyword(k)
    if (s) return s.key
  }
  const t = lead.tags || {}
  if (t.tourism) return 'hotel'
  if (/restaurant|fast_food|cafe|food_court/.test(t.amenity || '')) return 'restoran'
  if (t.amenity === 'hospital') return 'rumah_sakit'
  if (/clinic|doctors|dentist/.test(t.amenity || '')) return 'klinik'
  if (/school|kindergarten/.test(t.amenity || '')) return 'sekolah'
  if (/university|college/.test(t.amenity || '')) return 'kampus'
  if (t.office) return 'kantor'
  if (t.industrial || t.man_made === 'works') return 'pabrik'
  if (t.shop === 'mall' || t.shop === 'department_store') return 'mall'
  return null
}

/**
 * Fallback relevance when the AI is unavailable or skipped a lead.
 * 45 for matching the user's own criteria, +30 when one of the user's
 * services fits that kind of business, +5 when a phone number is known.
 */
export function heuristicRank(lead, services = []) {
  const kind = leadKind(lead)
  const re = kind ? AFFINITY[kind] : null
  const fits = re ? services.filter((s) => re.test(serviceKey(s))) : []
  const suggested = fits[0] || services[0] || ''
  const relevance = clamp(45 + (fits.length ? 30 : 0) + (lead.phone ? 5 : 0), 0, 100)
  const reason = fits.length
    ? `Kategori ${String(lead.category || 'usaha').toLowerCase()} umumnya cocok dengan layanan ${suggested} Anda.`
    : services.length
      ? 'Sesuai kriteria pencarian; kecocokan dengan layanan Anda belum jelas.'
      : 'Sesuai kriteria pencarian Anda.'
  return { relevance, reason, suggested_service: suggested, keep: true, duplicate_of: '', basis: 'heuristik' }
}

/* ------------------------------------------------------ AI merge */

/** Matches the model's service name back to one of the user's services. */
export function matchService(name, services) {
  const k = serviceKey(name)
  if (!k) return ''
  const exact = services.find((s) => serviceKey(s) === k)
  if (exact) return exact
  return services.find((s) => serviceKey(s).includes(k) || k.includes(serviceKey(s))) || ''
}

/**
 * Applies the AI verdicts to the leads. Leads the AI did not return (or when
 * the AI failed) keep the heuristic verdict; `basis` tells the UI which.
 */
export function mergeRanking(leads, aiItems, services) {
  const byId = new Map()
  for (const it of Array.isArray(aiItems) ? aiItems : []) {
    if (it && typeof it.id === 'string') byId.set(it.id.trim(), it)
  }
  return leads.map((lead, i) => {
    const base = heuristicRank(lead, services)
    const ai = byId.get(`L${i + 1}`)
    if (!ai) return { ...lead, ai: base }
    const relevance = Math.max(0, Math.min(100, Math.round(Number(ai.relevance))))
    const dupIdx = /^L\d+$/.test(String(ai.duplicate_of || '')) ? Number(String(ai.duplicate_of).slice(1)) - 1 : -1
    return {
      ...lead,
      ai: {
        relevance: Number.isFinite(relevance) ? relevance : base.relevance,
        reason: String(ai.reason || '').trim().slice(0, 240) || base.reason,
        suggested_service: matchService(ai.suggested_service, services) || base.suggested_service,
        keep: ai.keep !== false && !(dupIdx >= 0 && dupIdx !== i && dupIdx < leads.length),
        duplicate_of: dupIdx >= 0 && dupIdx !== i && leads[dupIdx] ? leads[dupIdx].id : '',
        basis: 'ai',
      },
    }
  })
}

/* ------------------------------------------------------------ Sorting */

export const SORTS = [
  { value: 'score', label: 'Skor' },
  { value: 'distance', label: 'Jarak' },
  { value: 'value', label: 'Nilai' },
]

export function sortLeads(rows, by = 'score') {
  const list = [...rows]
  if (by === 'distance') return list.sort((a, b) => a.distance_km - b.distance_km || b.score - a.score)
  if (by === 'value') return list.sort((a, b) => (b.estimate?.expected || 0) - (a.estimate?.expected || 0) || b.score - a.score)
  return list.sort((a, b) => b.score - a.score || a.distance_km - b.distance_km)
}

/* ------------------------------------------------------ Demo sample */

/** Small deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seedText) {
  let h = 1779033703 ^ String(seedText).length
  for (let i = 0; i < String(seedText).length; i++) {
    h = Math.imul(h ^ String(seedText).charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SAMPLE_NAMES = {
  hotel: [['Hotel Melati Indah', 'tourism', 'hotel'], ['Wisma Sentosa', 'tourism', 'guest_house'], ['Hotel Cahaya Kota', 'tourism', 'hotel'], ['Penginapan Asri', 'tourism', 'guest_house'], ['Hotel Taman Sari', 'tourism', 'hotel']],
  restoran: [['Rumah Makan Sederhana Rasa', 'amenity', 'restaurant'], ['Kafe Teduh', 'amenity', 'cafe'], ['Resto Sambal Ijo', 'amenity', 'restaurant'], ['Bakso Pak Kumis', 'amenity', 'fast_food'], ['Warung Nasi Bu Tini', 'amenity', 'restaurant']],
  kost: [['Kost Putri Anggrek', 'building', 'dormitory'], ['Kost Exclusive Damai', 'building', 'dormitory'], ['Asrama Mahasiswa Harapan', 'amenity', 'dormitory'], ['Kos Pak Haji Darto', 'building', 'dormitory']],
  rumah_sakit: [['RS Mitra Sehat', 'amenity', 'hospital'], ['RSIA Bunda Kasih', 'amenity', 'hospital'], ['RS Umum Harapan', 'amenity', 'hospital']],
  klinik: [['Klinik Pratama Sehat', 'amenity', 'clinic'], ['Klinik Gigi Senyum', 'amenity', 'dentist'], ['Puskesmas Kecamatan', 'amenity', 'clinic']],
  sekolah: [['SD Negeri 3', 'amenity', 'school'], ['SMP Tunas Bangsa', 'amenity', 'school'], ['TK Pelangi', 'amenity', 'kindergarten']],
  kampus: [['Politeknik Nusantara', 'amenity', 'college'], ['Universitas Mandiri', 'amenity', 'university']],
  pabrik: [['PT Sinar Plastik Abadi', 'man_made', 'works'], ['PT Karya Tekstil', 'man_made', 'works'], ['Pabrik Roti Lezat', 'building', 'industrial']],
  gudang: [['Gudang Logistik Sentral', 'building', 'warehouse'], ['Pergudangan Mega Jaya', 'building', 'warehouse']],
  mall: [['Plaza Kota', 'shop', 'mall'], ['Mal Metropolitan', 'shop', 'mall']],
  kantor: [['Gedung Graha Mandiri', 'office', 'company'], ['Kantor Kecamatan', 'office', 'government'], ['PT Solusi Digital', 'office', 'company']],
  apartemen: [['Apartemen Green Residence', 'building', 'apartments'], ['Tower Taman Kota', 'building', 'apartments']],
  supermarket: [['Swalayan Sumber Rejeki', 'shop', 'supermarket'], ['Minimarket Berkah', 'shop', 'convenience']],
}

/**
 * Deterministic sample around a point for demo mode (no network). The UI
 * labels these "Data contoh (mode demo)". Phone numbers use a 0000 block so
 * they are obviously not real.
 */
export function sampleLeads({ lat, lon, radiusKm, keywords }) {
  const origin = { lat, lon }
  const rand = seededRandom(`${lat.toFixed(3)}|${lon.toFixed(3)}|${[...keywords].sort().join(',')}`)
  const rows = []
  let n = 0
  for (const kw of [...keywords].sort()) {
    const spec = specForKeyword(kw)
    const pool = (spec && SAMPLE_NAMES[spec.key]) || [1, 2, 3].map((i) => [`${kw.replace(/(^|\s)\S/g, (c) => c.toUpperCase())} ${['Jaya', 'Makmur', 'Sentosa'][i - 1]}`, 'shop', 'yes'])
    for (const [name, k, v] of pool) {
      n += 1
      const p = offsetPoint(origin, Math.max(0.15, rand() * radiusKm * 0.95), rand() * 360)
      const hasPhone = rand() < 0.6
      const hasWeb = rand() < 0.35
      rows.push({
        id: `demo:${n}`,
        source: 'demo',
        source_id: `demo/${n}`,
        name,
        category: categoryFromTags({ [k]: v }, spec?.label || 'Usaha'),
        tags: { [k]: v },
        lat: Math.round(p.lat * 1e6) / 1e6,
        lon: Math.round(p.lon * 1e6) / 1e6,
        address: rand() < 0.7 ? `Jl. Contoh No. ${1 + Math.floor(rand() * 120)}` : '',
        phone: hasPhone ? `+62812000000${String(10 + n).slice(-2)}` : '',
        website: hasWeb ? `https://contoh-${n}.example` : '',
        distance_km: 0,
        matched: [kw],
      })
    }
  }
  for (const r of rows) r.distance_km = Math.round(haversineKm(origin, r) * 100) / 100
  return dedupeLeads(rows.sort((a, b) => a.distance_km - b.distance_km)).slice(0, MAX_RESULTS)
}

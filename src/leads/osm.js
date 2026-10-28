/**
 * Pencari prospek — pure helpers shared by the Worker (worker/leads.js) and
 * the browser (mock mode, scoring). No DOM, no fetch: unit tested in
 * tests/leads.test.mjs.
 *
 * Data source: OpenStreetMap via the Overpass API. Indonesian keywords are
 * mapped to OSM tags; anything unknown becomes a case-insensitive name match.
 * The regexes below are written so they behave the same in Overpass (POSIX
 * ERE) and in JavaScript (no \b, no POSIX classes, no lookarounds).
 */

export const MAX_KEYWORDS = 8
export const MAX_KEYWORD_LEN = 40
export const MIN_RADIUS_KM = 0.5
export const MAX_RADIUS_KM = 40
export const DEFAULT_RADIUS_KM = 5
export const MAX_RESULTS = 150
export const OVERPASS_TIMEOUT_S = 25

/** Indonesia bounding box (with a small margin). Searches outside are refused. */
export const ID_BOUNDS = { minLat: -11.5, maxLat: 6.5, minLon: 94.5, maxLon: 141.5 }

/**
 * Keyword catalogue. `aliases` are matched against the user's keyword after
 * normalisation; `filters` are [osmKey, valueRegex | null] pairs (null = any
 * value); `name` is an optional extra name regex for things OSM tags poorly
 * in Indonesia.
 */
export const KEYWORD_SPECS = [
  { key: 'hotel', label: 'Hotel & penginapan', aliases: ['hotel', 'penginapan', 'losmen', 'wisma', 'hostel', 'motel', 'guest house', 'guesthouse', 'homestay', 'resort', 'villa'],
    filters: [['tourism', '^(hotel|guest_house|hostel|motel|chalet|apartment)$']] },
  { key: 'restoran', label: 'Restoran & kafe', aliases: ['restoran', 'restaurant', 'resto', 'rumah makan', 'warung makan', 'tempat makan', 'kafe', 'cafe', 'kedai kopi', 'coffee shop', 'kuliner', 'cepat saji'],
    filters: [['amenity', '^(restaurant|fast_food|cafe|food_court)$']] },
  { key: 'kost', label: 'Kost & asrama', aliases: ['kost', 'kos', 'kos-kosan', 'kosan', 'rumah kost', 'asrama', 'indekos', 'kontrakan'],
    filters: [['building', '^dormitory$'], ['amenity', '^dormitory$']],
    name: '(^|[^a-z])(kost|kos|kosan|indekos|asrama)([^a-z]|$)' },
  { key: 'rumah_sakit', label: 'Rumah sakit', aliases: ['rumah sakit', 'rs', 'rsud', 'rsia', 'hospital'],
    filters: [['amenity', '^hospital$'], ['healthcare', '^hospital$']] },
  { key: 'klinik', label: 'Klinik & puskesmas', aliases: ['klinik', 'puskesmas', 'praktik dokter', 'dokter', 'klinik gigi', 'dokter gigi', 'laboratorium', 'clinic'],
    filters: [['amenity', '^(clinic|doctors|dentist)$'], ['healthcare', '^(clinic|doctor|dentist|laboratory|centre)$']] },
  { key: 'apotek', label: 'Apotek', aliases: ['apotek', 'apotik', 'farmasi', 'pharmacy'],
    filters: [['amenity', '^pharmacy$'], ['healthcare', '^pharmacy$']] },
  { key: 'sekolah', label: 'Sekolah', aliases: ['sekolah', 'sd', 'smp', 'sma', 'smk', 'madrasah', 'pesantren', 'tk', 'paud', 'school'],
    filters: [['amenity', '^(school|kindergarten)$']] },
  { key: 'kampus', label: 'Kampus', aliases: ['kampus', 'universitas', 'politeknik', 'akademi', 'sekolah tinggi', 'institut', 'university', 'college'],
    filters: [['amenity', '^(university|college)$']] },
  { key: 'pabrik', label: 'Pabrik & industri', aliases: ['pabrik', 'industri', 'manufaktur', 'kawasan industri', 'factory', 'konveksi'],
    filters: [['man_made', '^works$'], ['industrial', null], ['building', '^(industrial|factory|manufacture)$'], ['landuse', '^industrial$']],
    name: '(^|[^a-z])(pabrik|factory|industri)' },
  { key: 'gudang', label: 'Gudang & logistik', aliases: ['gudang', 'warehouse', 'logistik', 'pergudangan', 'ekspedisi', 'distribusi'],
    filters: [['building', '^warehouse$'], ['industrial', '^(warehouse|logistics|depot)$'], ['office', '^logistics$']],
    name: '(^|[^a-z])(gudang|warehouse|logistik|pergudangan)' },
  { key: 'mall', label: 'Mal & pusat belanja', aliases: ['mall', 'mal', 'plaza', 'pusat belanja', 'pusat perbelanjaan', 'department store', 'itc'],
    filters: [['shop', '^(mall|department_store)$']] },
  { key: 'pasar', label: 'Pasar', aliases: ['pasar', 'pasar tradisional', 'market'],
    filters: [['amenity', '^marketplace$']] },
  { key: 'supermarket', label: 'Supermarket & minimarket', aliases: ['supermarket', 'minimarket', 'swalayan', 'toserba', 'hypermarket', 'toko kelontong'],
    filters: [['shop', '^(supermarket|convenience|wholesale)$']] },
  { key: 'kantor', label: 'Perkantoran', aliases: ['perkantoran', 'kantor', 'office', 'gedung kantor', 'perusahaan', 'coworking'],
    filters: [['office', null], ['building', '^office$']] },
  { key: 'apartemen', label: 'Apartemen & perumahan', aliases: ['apartemen', 'apartment', 'rusun', 'rusunami', 'condominium', 'kondominium'],
    filters: [['building', '^(apartments|residential)$'], ['landuse', '^residential$']], requireName: true,
    name: '(^|[^a-z])(apartemen|apartment|residence|rusun|tower)' },
  { key: 'bank', label: 'Bank', aliases: ['bank', 'atm', 'koperasi'],
    filters: [['amenity', '^bank$']] },
  { key: 'spbu', label: 'SPBU', aliases: ['spbu', 'pom bensin', 'pom', 'pertamina', 'fuel'],
    filters: [['amenity', '^fuel$']] },
  { key: 'ibadah', label: 'Tempat ibadah', aliases: ['masjid', 'musala', 'mushola', 'gereja', 'pura', 'vihara', 'klenteng', 'tempat ibadah'],
    filters: [['amenity', '^place_of_worship$']] },
  { key: 'bengkel', label: 'Bengkel', aliases: ['bengkel', 'bengkel mobil', 'bengkel motor', 'dealer', 'showroom', 'cuci mobil', 'car wash'],
    filters: [['shop', '^(car_repair|motorcycle_repair|car|motorcycle|tyres)$'], ['amenity', '^car_wash$']] },
  { key: 'salon', label: 'Salon & kecantikan', aliases: ['salon', 'barbershop', 'pangkas rambut', 'spa', 'kecantikan', 'klinik kecantikan'],
    filters: [['shop', '^(hairdresser|beauty|cosmetics)$'], ['leisure', '^spa$']] },
  { key: 'gym', label: 'Pusat kebugaran', aliases: ['gym', 'fitness', 'pusat kebugaran', 'kolam renang', 'gor', 'lapangan futsal'],
    filters: [['leisure', '^(fitness_centre|sports_centre|swimming_pool)$']] },
  { key: 'laundry', label: 'Laundry', aliases: ['laundry', 'binatu', 'dry cleaning'],
    filters: [['shop', '^(laundry|dry_cleaning)$']],
    name: '(^|[^a-z])(laundry|binatu)' },
  { key: 'toko', label: 'Toko', aliases: ['toko', 'shop', 'store', 'retail'],
    filters: [['shop', null]] },
]

/** Chips shown in the UI (subset of the catalogue, most useful for B2B jasa). */
export const PRESET_CHIPS = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'restoran', label: 'Restoran' },
  { value: 'kost', label: 'Kost' },
  { value: 'rumah sakit', label: 'Rumah sakit' },
  { value: 'klinik', label: 'Klinik' },
  { value: 'sekolah', label: 'Sekolah' },
  { value: 'perkantoran', label: 'Perkantoran' },
  { value: 'pabrik', label: 'Pabrik' },
  { value: 'gudang', label: 'Gudang' },
  { value: 'mall', label: 'Mal' },
  { value: 'apartemen', label: 'Apartemen' },
  { value: 'supermarket', label: 'Minimarket' },
]

/** Generic words dropped from free text before it becomes a name search. */
const STOP_WORDS = new Set(['toko', 'warung', 'usaha', 'tempat', 'jasa', 'kedai', 'pt', 'cv', 'ud', 'di', 'dan', 'yang', 'the', 'shop', 'store'])

/** Lower-case, collapse whitespace, strip characters we never accept. */
export function normalizeKeyword(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s&'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEYWORD_LEN)
}

/** Validates the keyword list from a request. Returns { keywords, error }. */
export function validateKeywords(list) {
  if (!Array.isArray(list) || list.length === 0) return { keywords: [], error: 'Isi minimal satu kriteria (kata kunci).' }
  if (list.length > MAX_KEYWORDS) return { keywords: [], error: `Maksimal ${MAX_KEYWORDS} kriteria per pencarian.` }
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.length > MAX_KEYWORD_LEN * 2) return { keywords: [], error: 'Kriteria tidak valid.' }
    const k = normalizeKeyword(raw)
    if (k.length < 2) return { keywords: [], error: 'Setiap kriteria minimal 2 huruf.' }
    if (!out.includes(k)) out.push(k)
  }
  return { keywords: out, error: null }
}

/** Escapes a literal for use inside a regex (Overpass ERE and JS alike). */
export function escapeRegex(s) {
  return String(s).replace(/[\\^$.*+?()[\]{}|"]/g, '\\$&')
}

/** Finds the catalogue entry for one normalised keyword (exact alias, then alias prefix). */
export function specForKeyword(keyword) {
  const k = normalizeKeyword(keyword)
  if (!k) return null
  const exact = KEYWORD_SPECS.find((s) => s.key === k.replace(/\s+/g, '_') || s.aliases.includes(k))
  if (exact) return exact
  // "hotel bintang 3", "restoran padang": the first word decides when it is a known alias.
  const first = k.split(' ')[0]
  if (first !== k && first !== 'toko') {
    const byFirst = KEYWORD_SPECS.find((s) => s.aliases.includes(first))
    if (byFirst) return byFirst
  }
  return null
}

/**
 * Maps keywords to Overpass matchers.
 * Returns [{ keyword, spec|null, filters: [[k, re|null]], name: regex|null, label }].
 * Unknown keywords become a name regex built from their non-generic words.
 */
export function resolveKeywords(keywords) {
  return keywords.map((raw) => {
    const keyword = normalizeKeyword(raw)
    const spec = specForKeyword(keyword)
    if (spec) return { keyword, spec, filters: spec.filters, name: spec.name || null, requireName: Boolean(spec.requireName), label: spec.label }
    const words = keyword.split(' ').filter((w) => w && !STOP_WORDS.has(w))
    const phrase = (words.length ? words : keyword.split(' ')).join(' ')
    // normalizeKeyword already removed every regex metacharacter except '.', which only widens the match.
    return { keyword, spec: null, filters: [], name: phrase, requireName: true, label: capitalize(keyword) }
  })
}

const capitalize = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1)

/** Rounds the search so nearby identical searches share one cache entry (~110 m grid). */
export function roundSearch({ lat, lon, radiusKm, keywords }) {
  return {
    lat: Math.round(Number(lat) * 1000) / 1000,
    lon: Math.round(Number(lon) * 1000) / 1000,
    radiusKm: Math.round(Number(radiusKm) * 2) / 2,
    keywords: [...keywords].map(normalizeKeyword).filter(Boolean).sort(),
  }
}

export function cacheKeyOf(search, source = 'osm') {
  const r = roundSearch(search)
  return `${source}|${r.lat.toFixed(3)}|${r.lon.toFixed(3)}|${r.radiusKm}|${r.keywords.join(',')}`
}

/** Builds the Overpass QL query. `limit` caps the raw output before distance sorting. */
export function buildOverpassQuery({ lat, lon, radiusKm, keywords, limit = 200 }) {
  const meters = Math.round(Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, radiusKm)) * 1000)
  const around = `(around:${meters},${Number(lat).toFixed(5)},${Number(lon).toFixed(5)})`
  const stmts = new Set()
  for (const m of resolveKeywords(keywords)) {
    for (const [k, re] of m.filters) {
      const tag = re ? `["${k}"~"${re}"]` : `["${k}"]`
      const nameRe = m.requireName && m.name ? `["name"~"${m.name}",i]` : '["name"]'
      stmts.add(`nwr${tag}${nameRe}${around};`)
    }
    if (m.name) stmts.add(`nwr["name"~"${m.name}",i]${around};`)
  }
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];\n(\n  ${[...stmts].join('\n  ')}\n);\nout center tags ${Math.max(1, Math.min(500, limit))};`
}

/** Which resolved matchers does an element satisfy? */
export function matchedKeywords(tags, resolved) {
  const name = String(tags?.name || '')
  const hits = []
  for (const m of resolved) {
    const byTag = m.filters.some(([k, re]) => tags[k] != null && (re ? new RegExp(re).test(String(tags[k])) : true))
    const byName = m.name ? new RegExp(m.name, 'i').test(name) : false
    if ((byTag && (!m.requireName || !m.name || byName)) || byName) hits.push(m.keyword)
  }
  return hits
}

/* ----------------------------------------------------------- Geometry */

const toRad = (d) => (d * Math.PI) / 180

/** Great-circle distance in km (haversine, mean Earth radius 6371 km). */
export function haversineKm(a, b) {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Point at `km` from `origin` along `bearingDeg` (used by the demo sample). */
export function offsetPoint(origin, km, bearingDeg) {
  const R = 6371
  const d = km / R
  const br = toRad(bearingDeg)
  const lat1 = toRad(origin.lat)
  const lon1 = toRad(origin.lon)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180 }
}

export function inIndonesia(lat, lon) {
  return lat >= ID_BOUNDS.minLat && lat <= ID_BOUNDS.maxLat && lon >= ID_BOUNDS.minLon && lon <= ID_BOUNDS.maxLon
}

/* --------------------------------------------------------- Normalise */

const VALUE_LABELS = {
  tourism: { hotel: 'Hotel', guest_house: 'Penginapan', hostel: 'Hostel', motel: 'Motel', chalet: 'Vila', apartment: 'Apartemen sewa' },
  amenity: {
    restaurant: 'Restoran', fast_food: 'Cepat saji', cafe: 'Kafe', food_court: 'Pujasera', hospital: 'Rumah sakit', clinic: 'Klinik',
    doctors: 'Praktik dokter', dentist: 'Dokter gigi', pharmacy: 'Apotek', school: 'Sekolah', kindergarten: 'TK / PAUD',
    university: 'Universitas', college: 'Kampus', marketplace: 'Pasar', bank: 'Bank', fuel: 'SPBU', place_of_worship: 'Tempat ibadah',
    dormitory: 'Asrama', car_wash: 'Cuci mobil',
  },
  healthcare: { hospital: 'Rumah sakit', clinic: 'Klinik', doctor: 'Praktik dokter', dentist: 'Dokter gigi', laboratory: 'Laboratorium', pharmacy: 'Apotek', centre: 'Pusat kesehatan' },
  shop: {
    mall: 'Mal', department_store: 'Department store', supermarket: 'Supermarket', convenience: 'Minimarket', wholesale: 'Grosir',
    laundry: 'Laundry', dry_cleaning: 'Dry cleaning', car_repair: 'Bengkel mobil', motorcycle_repair: 'Bengkel motor', car: 'Dealer mobil',
    motorcycle: 'Dealer motor', tyres: 'Toko ban', hairdresser: 'Salon', beauty: 'Salon kecantikan', cosmetics: 'Toko kosmetik',
  },
  leisure: { fitness_centre: 'Pusat kebugaran', sports_centre: 'Gelanggang olahraga', swimming_pool: 'Kolam renang', spa: 'Spa' },
  building: { dormitory: 'Asrama / kost', warehouse: 'Gudang', industrial: 'Bangunan industri', factory: 'Pabrik', office: 'Gedung kantor', apartments: 'Apartemen', residential: 'Hunian' },
  industrial: { warehouse: 'Gudang', logistics: 'Logistik', depot: 'Depo' },
  office: { company: 'Kantor perusahaan', government: 'Kantor pemerintah', logistics: 'Kantor logistik', ngo: 'Kantor organisasi', coworking: 'Coworking' },
}
const KEY_LABELS = { office: 'Kantor', industrial: 'Industri', man_made: 'Pabrik', landuse: 'Kawasan', shop: 'Toko', craft: 'Usaha kerajinan', healthcare: 'Layanan kesehatan', tourism: 'Pariwisata' }
const CATEGORY_ORDER = ['tourism', 'amenity', 'healthcare', 'shop', 'leisure', 'office', 'industrial', 'building', 'man_made', 'craft', 'landuse']

/** Human (Indonesian) category label from OSM tags. */
export function categoryFromTags(tags = {}, fallback = 'Usaha') {
  for (const k of CATEGORY_ORDER) {
    const v = tags[k]
    if (v == null || (v === 'yes' && k === 'building')) continue
    const label = VALUE_LABELS[k]?.[v]
    if (label) return label
    if (k === 'man_made' && v === 'works') return 'Pabrik'
    if (k === 'landuse' && v === 'industrial') return 'Kawasan industri'
    if (k === 'landuse' && v === 'residential') return 'Perumahan'
    if (k === 'office' || k === 'industrial' || k === 'craft') return `${KEY_LABELS[k]}${v && v !== 'yes' ? ` (${String(v).replace(/_/g, ' ')})` : ''}`
    if (k === 'shop') return v === 'yes' ? 'Toko' : `Toko (${String(v).replace(/_/g, ' ')})`
  }
  return fallback
}

const KEEP_TAGS = ['amenity', 'shop', 'tourism', 'office', 'craft', 'healthcare', 'industrial', 'building', 'man_made', 'leisure', 'landuse',
  'cuisine', 'stars', 'rooms', 'beds', 'capacity', 'operator', 'brand', 'opening_hours', 'building:levels', 'operator:type', 'level']

const firstOf = (v) => String(v || '').split(/[;,]/)[0].trim()

export function cleanPhone(v) {
  const p = firstOf(v).replace(/[^\d+]/g, '')
  return p.length >= 6 && p.length <= 16 ? p : ''
}

export function cleanWebsite(v) {
  let w = firstOf(v)
  if (!w) return ''
  if (!/^https?:\/\//i.test(w)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(w)) return ''
    w = `https://${w}`
  }
  try {
    const u = new URL(w)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : ''
  } catch { return '' }
}

export function addressFromTags(t = {}) {
  if (t['addr:full']) return String(t['addr:full']).slice(0, 200)
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ')
  const parts = [street, t['addr:hamlet'], t['addr:village'], t['addr:suburb'] || t['addr:subdistrict'], t['addr:district'], t['addr:city'] || t['addr:regency'], t['addr:postcode']]
  return [...new Set(parts.filter(Boolean).map((s) => String(s).trim()))].join(', ').slice(0, 200)
}

/** Overpass element -> lead result (or null when unusable). */
export function normalizeElement(elm, origin, resolved = []) {
  const tags = elm?.tags || {}
  const name = String(tags.name || tags['name:id'] || tags.brand || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  const lat = Number(elm?.lat ?? elm?.center?.lat)
  const lon = Number(elm?.lon ?? elm?.center?.lon)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const keep = {}
  for (const k of KEEP_TAGS) if (tags[k] != null) keep[k] = String(tags[k]).slice(0, 80)
  const matched = matchedKeywords(tags, resolved)
  const fallback = resolved.find((m) => matched.includes(m.keyword))?.label || 'Usaha'
  return {
    id: `osm:${elm.type}/${elm.id}`,
    source: 'osm',
    source_id: `${elm.type}/${elm.id}`,
    name,
    category: categoryFromTags(tags, fallback),
    tags: keep,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    address: addressFromTags(tags),
    phone: cleanPhone(tags.phone || tags['contact:phone'] || tags['contact:mobile'] || tags.mobile || tags['contact:whatsapp']),
    website: cleanWebsite(tags.website || tags['contact:website'] || tags.url),
    distance_km: Math.round(haversineKm(origin, { lat, lon }) * 100) / 100,
    matched,
  }
}

export const nameKey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const completenessCount = (r) => (r.phone ? 1 : 0) + (r.website ? 1 : 0) + (r.address ? 1 : 0)

/**
 * Drops obvious duplicates (same normalised name within 250 m — OSM often has
 * both a building outline and a point for one business). Keeps the richer one.
 */
export function dedupeLeads(rows, { withinKm = 0.25 } = {}) {
  const kept = []
  for (const r of rows) {
    const k = nameKey(r.name)
    const dup = kept.findIndex((x) => nameKey(x.name) === k && haversineKm(x, r) <= withinKm)
    if (dup === -1) { kept.push(r); continue }
    if (completenessCount(r) > completenessCount(kept[dup])) kept[dup] = { ...r, matched: [...new Set([...kept[dup].matched || [], ...r.matched || []])] }
  }
  return kept
}

/** Full pipeline for an Overpass JSON payload. */
export function leadsFromOverpass(payload, { origin, radiusKm, keywords, max = MAX_RESULTS }) {
  const resolved = resolveKeywords(keywords)
  const rows = (payload?.elements || [])
    .map((e) => normalizeElement(e, origin, resolved))
    .filter((r) => r && r.distance_km <= radiusKm + 0.05)
    .sort((a, b) => a.distance_km - b.distance_km)
  return dedupeLeads(rows).slice(0, max)
}

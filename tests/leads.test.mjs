// Pencari prospek: pure helpers (keyword -> OSM mapping, Overpass query,
// normalisation, distance, scoring, value estimate). Run: node --test tests/leads.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  specForKeyword, resolveKeywords, validateKeywords, buildOverpassQuery, matchedKeywords, haversineKm, offsetPoint,
  normalizeElement, leadsFromOverpass, dedupeLeads, categoryFromTags, cleanPhone, cleanWebsite, roundSearch, cacheKeyOf, inIndonesia,
} from '../src/leads/osm.js'
import {
  proximityFactor, completenessFactor, scoreLead, estimateValue, serviceStats, heuristicRank, sortLeads, sampleLeads, seededRandom,
} from '../src/leads/scoring.js'
import { buildModel } from '../src/stages/data.js'
import { mergeRanking, matchService } from '../src/leads/scoring.js'

const BEKASI = { lat: -6.2383, lon: 106.9756 }

test('Indonesian keywords map to OSM tags', () => {
  assert.equal(specForKeyword('hotel').key, 'hotel')
  assert.equal(specForKeyword('Penginapan').key, 'hotel')
  assert.equal(specForKeyword('rumah makan').key, 'restoran')
  assert.equal(specForKeyword('restoran padang').key, 'restoran') // first word decides
  assert.equal(specForKeyword('kost').key, 'kost')
  assert.equal(specForKeyword('rumah sakit').key, 'rumah_sakit')
  assert.equal(specForKeyword('klinik').key, 'klinik')
  assert.equal(specForKeyword('sekolah').key, 'sekolah')
  assert.equal(specForKeyword('pabrik').key, 'pabrik')
  assert.equal(specForKeyword('gudang').key, 'gudang')
  assert.equal(specForKeyword('mall').key, 'mall')
  assert.equal(specForKeyword('perkantoran').key, 'kantor')
  assert.equal(specForKeyword('toko pentol'), null)
  const hotel = resolveKeywords(['hotel'])[0]
  assert.deepEqual(hotel.filters[0], ['tourism', '^(hotel|guest_house|hostel|motel|chalet|apartment)$'])
  const rest = resolveKeywords(['restoran'])[0]
  assert.ok(new RegExp(rest.filters[0][1]).test('fast_food'))
  assert.ok(new RegExp(rest.filters[0][1]).test('cafe'))
})

test('free text becomes a name regex without generic words', () => {
  const [m] = resolveKeywords(['toko pentol'])
  assert.equal(m.spec, null)
  assert.equal(m.name, 'pentol')
  assert.equal(m.requireName, true)
  const [m2] = resolveKeywords(['Percetakan Digital'])
  assert.equal(m2.name, 'percetakan digital')
})

test('keyword validation is strict', () => {
  assert.ok(validateKeywords([]).error)
  assert.ok(validateKeywords('hotel').error)
  assert.ok(validateKeywords(['a']).error)
  assert.ok(validateKeywords(Array.from({ length: 9 }, (_, i) => `kata${i}`)).error)
  assert.ok(validateKeywords([123]).error)
  const ok = validateKeywords(['Hotel', 'hotel', ' Restoran  ', 'toko "pentol"<script>'])
  assert.equal(ok.error, null)
  assert.deepEqual(ok.keywords, ['hotel', 'restoran', 'toko pentol script'])
})

test('Overpass query uses around(), timeout ≤ 25 and a result cap', () => {
  const q = buildOverpassQuery({ ...BEKASI, radiusKm: 5, keywords: ['hotel', 'restoran', 'kost', 'toko pentol'], limit: 200 })
  assert.match(q, /^\[out:json\]\[timeout:25\];/)
  assert.match(q, /nwr\["tourism"~"\^\(hotel\|guest_house/)
  assert.match(q, /\(around:5000,-6\.23830,106\.97560\);/)
  assert.match(q, /nwr\["name"~"pentol",i\]\(around/)
  assert.match(q, /nwr\["building"~"\^dormitory\$"\]\["name"\]/)
  assert.match(q, /out center tags 200;$/)
  assert.ok(!q.includes('undefined'))
  // radius clamped to 40 km
  assert.match(buildOverpassQuery({ ...BEKASI, radiusKm: 99, keywords: ['hotel'] }), /around:40000,/)
})

test('kost name regex matches real names but not unrelated words', () => {
  const [m] = resolveKeywords(['kost'])
  const re = new RegExp(m.name, 'i')
  assert.ok(re.test('Kost Putri Melati'))
  assert.ok(re.test('Rumah Kos Bu Ani'))
  assert.ok(re.test('Kosan 99'))
  assert.ok(!re.test('Kosmetik Cantik'))
  assert.ok(!re.test('Kostum Pesta'))
})

test('matchedKeywords links elements back to the criteria', () => {
  const r = resolveKeywords(['hotel', 'restoran', 'toko pentol'])
  assert.deepEqual(matchedKeywords({ tourism: 'hotel', name: 'Hotel A' }, r), ['hotel'])
  assert.deepEqual(matchedKeywords({ amenity: 'cafe', name: 'Kopi Kita' }, r), ['restoran'])
  assert.deepEqual(matchedKeywords({ shop: 'yes', name: 'Pentol Mas Joko' }, r), ['toko pentol'])
  assert.deepEqual(matchedKeywords({ amenity: 'bank', name: 'Bank X' }, r), [])
})

test('haversine distance', () => {
  assert.equal(haversineKm(BEKASI, BEKASI), 0)
  // Jakarta (Monas) -> Bekasi city centre is roughly 18 km
  const d = haversineKm({ lat: -6.1754, lon: 106.8272 }, BEKASI)
  assert.ok(d > 16 && d < 19, `got ${d}`)
  const p = offsetPoint(BEKASI, 3, 90)
  assert.ok(Math.abs(haversineKm(BEKASI, p) - 3) < 0.01)
  assert.ok(inIndonesia(BEKASI.lat, BEKASI.lon))
  assert.ok(!inIndonesia(51.5, -0.12))
})

test('normalizeElement builds a clean lead', () => {
  const r = resolveKeywords(['hotel'])
  const lead = normalizeElement({
    type: 'way', id: 42, center: { lat: -6.24, lon: 106.98 },
    tags: { name: ' Hotel  Sentosa ', tourism: 'hotel', 'addr:street': 'Jl. Ahmad Yani', 'addr:housenumber': '5', 'addr:city': 'Bekasi', phone: '+62 21 888 1234; +62 812 1', website: 'hotelsentosa.co.id', stars: '3' },
  }, BEKASI, r)
  assert.equal(lead.id, 'osm:way/42')
  assert.equal(lead.name, 'Hotel Sentosa')
  assert.equal(lead.category, 'Hotel')
  assert.equal(lead.address, 'Jl. Ahmad Yani 5, Bekasi')
  assert.equal(lead.phone, '+62218881234')
  assert.equal(lead.website, 'https://hotelsentosa.co.id/')
  assert.equal(lead.tags.stars, '3')
  assert.deepEqual(lead.matched, ['hotel'])
  assert.ok(lead.distance_km > 0 && lead.distance_km < 1)
  assert.equal(normalizeElement({ type: 'node', id: 1, lat: 1, lon: 1, tags: {} }, BEKASI, r), null)
})

test('cleaners reject junk', () => {
  assert.equal(cleanPhone('call me'), '')
  assert.equal(cleanWebsite('javascript:alert(1)'), '')
  assert.equal(cleanWebsite('not a site'), '')
  assert.equal(cleanWebsite('http://a.id'), 'http://a.id/')
  assert.equal(categoryFromTags({ office: 'company' }), 'Kantor perusahaan')
  assert.equal(categoryFromTags({ shop: 'bakery' }), 'Toko (bakery)')
  assert.equal(categoryFromTags({ building: 'yes' }, 'Usaha'), 'Usaha')
})

test('leadsFromOverpass filters by radius, sorts by distance and dedupes', () => {
  const near = offsetPoint(BEKASI, 0.5, 10)
  const far = offsetPoint(BEKASI, 9, 10)
  const payload = { elements: [
    { type: 'node', id: 1, lat: far.lat, lon: far.lon, tags: { name: 'Hotel Jauh', tourism: 'hotel' } },
    { type: 'node', id: 2, lat: near.lat, lon: near.lon, tags: { name: 'Hotel Dekat', tourism: 'hotel' } },
    { type: 'way', id: 3, center: { lat: near.lat + 0.0005, lon: near.lon }, tags: { name: 'hotel dekat', tourism: 'hotel', phone: '0218881234' } },
    { type: 'node', id: 4, lat: near.lat, lon: near.lon, tags: { tourism: 'hotel' } },
  ] }
  const out = leadsFromOverpass(payload, { origin: BEKASI, radiusKm: 5, keywords: ['hotel'] })
  assert.equal(out.length, 1)
  assert.equal(out[0].phone, '0218881234') // richer duplicate kept
  assert.equal(dedupeLeads([]).length, 0)
})

test('cache key rounds the search', () => {
  const a = cacheKeyOf({ lat: -6.23831, lon: 106.97561, radiusKm: 5.1, keywords: ['restoran', 'Hotel'] })
  const b = cacheKeyOf({ lat: -6.23829, lon: 106.97559, radiusKm: 4.9, keywords: ['hotel', 'restoran'] })
  assert.equal(a, b)
  assert.equal(roundSearch({ lat: -6.2383, lon: 106.9756, radiusKm: 5, keywords: ['b', 'a'] }).keywords.join(), 'a,b')
})

test('score = relevance x proximity x completeness', () => {
  assert.equal(proximityFactor(0, 5), 1)
  assert.equal(proximityFactor(5, 5), 0.4)
  assert.equal(proximityFactor(2.5, 5), 0.7)
  assert.equal(proximityFactor(50, 5), 0.4)
  assert.equal(completenessFactor({}), 0.6)
  assert.equal(completenessFactor({ phone: 'x', website: 'y', address: 'z' }), 1)
  const s = scoreLead({ relevance: 80, distance_km: 2.5, phone: '1', website: '', address: 'a' }, 5)
  assert.equal(s.proximity, 0.7)
  assert.equal(s.completeness, 0.85)
  assert.equal(s.score, Math.round(80 * 0.7 * 0.85))
  assert.equal(scoreLead({ relevance: 150, distance_km: 0, phone: 1, website: 1, address: 1 }, 5).score, 100)
})

function flowFixture() {
  return buildModel({
    requests: [
      { id: 1, service_type: 'Service AC', customer_name: 'A' },
      { id: 2, service_type: 'service ac', customer_name: 'B' },
      { id: 3, service_type: 'Pest Control', customer_name: 'C' },
      { id: 4, service_type: 'Cuci Sofa', customer_name: 'D' },
    ],
    offers: [
      { id: 10, request_id: 1, status: 'approved', validated_price: 1000000 },
      { id: 11, request_id: 2, status: 'approved', validated_price: 2000000 },
      { id: 12, request_id: 3, status: 'approved', validated_price: 4000000 },
      { id: 13, request_id: 4, status: 'draft', validated_price: 900000 },
    ],
    assignments: [{ id: 20, offer_id: 12 }],
    completions: [{ id: 30, assignment_id: 20 }],
    ledger_entries: [{ id: 40, completion_id: 30, category: 'pendapatan', amount: 4500000 }, { id: 41, completion_id: 30, category: 'biaya_bahan', amount: 500000 }],
  })
}

test('serviceStats uses booked revenue, then approved offers', () => {
  const st = serviceStats(flowFixture())
  assert.equal(st.length, 2) // draft-only service has no value yet
  const ac = st.find((s) => s.key === 'service ac')
  assert.equal(ac.count, 2)
  assert.equal(ac.avg, 1500000)
  const pest = st.find((s) => s.key === 'pest control')
  assert.equal(pest.avg, 4500000) // ledger revenue beats offer price
  assert.equal(pest.booked, 1)
})

test('estimateValue is transparent about its basis', () => {
  const st = serviceStats(flowFixture())
  const a = estimateValue({ service: 'Service AC', stats: st, conversion: 0.1 })
  assert.equal(a.basis, 'layanan')
  assert.equal(a.potential, 1500000)
  assert.equal(a.expected, 150000)
  const b = estimateValue({ service: 'Cat Dinding', stats: st, conversion: 0.1 })
  assert.equal(b.basis, 'umum')
  assert.equal(b.potential, Math.round((1000000 + 2000000 + 4500000) / 3))
  const c = estimateValue({ service: 'X', stats: [], fallbackAvg: 2000000, conversion: 0.2 })
  assert.equal(c.basis, 'perkiraan')
  assert.equal(c.expected, 400000)
  const d = estimateValue({ service: 'X', stats: [] })
  assert.equal(d.basis, null)
  assert.equal(d.expected, 0)
  assert.equal(estimateValue({ service: 'X', stats: [], fallbackAvg: 100, conversion: 9 }).conversion, 0.5) // clamped
})

test('heuristic relevance prefers services that fit the business kind', () => {
  const lead = { name: 'Resto A', category: 'Restoran', matched: ['restoran'], tags: { amenity: 'restaurant' }, phone: '1' }
  const h = heuristicRank(lead, ['Cuci Sofa', 'Pest Control'])
  assert.equal(h.suggested_service, 'Pest Control')
  assert.equal(h.relevance, 80)
  const h2 = heuristicRank({ ...lead, phone: '' }, ['Desain Logo'])
  assert.equal(h2.relevance, 45)
  assert.equal(h2.suggested_service, 'Desain Logo')
})

test('AI ranking merge: ids, service matching, duplicates, fallback', () => {
  const leads = [
    { id: 'osm:node/1', name: 'Hotel A', category: 'Hotel', matched: ['hotel'], tags: {} },
    { id: 'osm:node/2', name: 'Hotel A Annex', category: 'Hotel', matched: ['hotel'], tags: {} },
    { id: 'osm:node/3', name: 'Taman', category: 'Usaha', matched: ['hotel'], tags: {} },
  ]
  const out = mergeRanking(leads, [
    { id: 'L1', keep: true, relevance: 91, reason: 'Hotel butuh AC.', suggested_service: 'service ac', duplicate_of: '' },
    { id: 'L2', keep: true, relevance: 60, reason: 'Sama.', suggested_service: 'Layanan Fiktif', duplicate_of: 'L1' },
    { id: 'Contoh id', keep: true, relevance: 1, reason: 'x', suggested_service: '', duplicate_of: '' },
  ], ['Service AC', 'Pest Control'])
  assert.equal(out[0].ai.basis, 'ai')
  assert.equal(out[0].ai.suggested_service, 'Service AC')
  assert.equal(out[1].ai.keep, false)
  assert.equal(out[1].ai.duplicate_of, 'osm:node/1')
  assert.equal(out[1].ai.suggested_service, 'Service AC') // unknown -> heuristic suggestion
  assert.equal(out[2].ai.basis, 'heuristik')
  assert.equal(matchService('ac', ['Service AC']), 'Service AC')
  assert.equal(matchService('', ['Service AC']), '')
})

test('sorting and the deterministic demo sample', () => {
  const rows = [
    { id: 'a', score: 50, distance_km: 3, estimate: { expected: 10 } },
    { id: 'b', score: 70, distance_km: 5, estimate: { expected: 5 } },
    { id: 'c', score: 60, distance_km: 1, estimate: { expected: 20 } },
  ]
  assert.deepEqual(sortLeads(rows, 'score').map((r) => r.id), ['b', 'c', 'a'])
  assert.deepEqual(sortLeads(rows, 'distance').map((r) => r.id), ['c', 'a', 'b'])
  assert.deepEqual(sortLeads(rows, 'value').map((r) => r.id), ['c', 'a', 'b'])
  const r1 = seededRandom('x')
  const r2 = seededRandom('x')
  assert.equal(r1(), r2())
  const s1 = sampleLeads({ ...BEKASI, radiusKm: 5, keywords: ['hotel', 'restoran'] })
  const s2 = sampleLeads({ ...BEKASI, radiusKm: 5, keywords: ['restoran', 'hotel'] })
  assert.deepEqual(s1, s2)
  assert.ok(s1.length >= 8)
  assert.ok(s1.every((l) => l.source === 'demo' && l.distance_km <= 5 && l.category))
})

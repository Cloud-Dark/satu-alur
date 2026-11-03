// Demo accounts are fully demo: the lead finder answers them with fictional
// businesses and an offline gazetteer, and never reaches OpenStreetMap,
// Nominatim or Google.
import './helpers/setup.mjs'
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const { demoSearch, demoGeocode, DEMO_GAZETTEER } = await import('../src/leads/demo.js')
const { haversineKm } = await import('../src/leads/osm.js')
const { isDemoUser, DEMO_EMAILS } = await import('../worker/demo.js')
const { DEMO_ACCOUNTS } = await import('../src/auth/demo-accounts.js')
const { handleLeadSearch, handleLeadGeocode, handleLeadSources } = await import('../worker/leads.js')

const BEKASI = { lat: -6.2383, lon: 106.9756 }

test('demoSearch: deterministic per account, different between accounts', () => {
  const a1 = demoSearch({ ...BEKASI, radiusKm: 5, keywords: ['hotel', 'restoran'], seed: 'owner-a' })
  const a2 = demoSearch({ ...BEKASI, radiusKm: 5, keywords: ['restoran', 'hotel'], seed: 'owner-a' })
  const b = demoSearch({ ...BEKASI, radiusKm: 5, keywords: ['hotel', 'restoran'], seed: 'owner-b' })
  const strip = (r) => r.results.map(({ id, name, lat, lon, phone, address }) => ({ id, name, lat, lon, phone, address }))
  assert.deepEqual(strip(a1), strip(a2))
  assert.notDeepEqual(strip(a1), strip(b))
  assert.equal(a1.source, 'demo')
  assert.equal(a1.demo, true)
  assert.match(a1.attribution, /akun demo/)
})

test('demoSearch: results stay inside the radius and match the chosen categories', () => {
  const res = demoSearch({ ...BEKASI, radiusKm: 3, keywords: ['klinik', 'gudang', 'toko pentol'], seed: 'x' })
  assert.ok(res.results.length >= 6)
  for (const r of res.results) {
    assert.ok(haversineKm(BEKASI, r) <= 3 + 0.05, `${r.name} within radius`)
    assert.ok(r.matched.every((k) => res.keywords.includes(k)), `${r.name} matches a chosen keyword`)
    assert.equal(r.demo, true)
    assert.equal(r.source, 'demo')
  }
})

test('demoSearch: contact data is obviously fake', () => {
  const res = demoSearch({ ...BEKASI, radiusKm: 10, keywords: ['hotel', 'restoran', 'kantor', 'pabrik'], seed: 'phones' })
  const phones = res.results.map((r) => r.phone).filter(Boolean)
  assert.ok(phones.length > 0)
  assert.ok(phones.every((p) => /^0812-0000-\d{4}$/.test(p)), phones.join(', '))
  assert.ok(res.results.filter((r) => r.address).every((r) => r.address.endsWith('(contoh)')))
  assert.ok(res.results.filter((r) => r.website).every((r) => /\.example$/.test(r.website)))
})

test('demoSearch: rejects points outside Indonesia and bad keywords', () => {
  assert.throws(() => demoSearch({ lat: 51.5, lon: -0.12, radiusKm: 5, keywords: ['hotel'] }), /Indonesia/)
  assert.throws(() => demoSearch({ ...BEKASI, radiusKm: 5, keywords: [] }))
})

test('demoGeocode: offline gazetteer with aliases', () => {
  assert.match(demoGeocode('bekasi')[0].label, /^Bekasi/)
  assert.match(demoGeocode('Jogja')[0].label, /^Yogyakarta/)
  assert.match(demoGeocode('bsd serpong')[0].label, /^Tangerang Selatan/)
  assert.deepEqual(demoGeocode('x'), [])
  assert.ok(demoGeocode('jakarta').length >= 5 && demoGeocode('jakarta').length <= 6)
  assert.ok(demoGeocode('surabaya').every((r) => r.demo === true && /\(contoh\)$/.test(r.label)))
  for (const [, lat, lon] of DEMO_GAZETTEER) assert.ok(lat > -11.5 && lat < 6.5 && lon > 94.5 && lon < 141.5)
})

test('isDemoUser: the nine demo accounts, case-insensitive and null-safe', () => {
  assert.deepEqual([...DEMO_EMAILS].sort(), DEMO_ACCOUNTS.map((a) => a.email).sort())
  assert.equal(isDemoUser({ email: 'Demo-AC@SatuAlur.id' }), true)
  assert.equal(isDemoUser({ email: 'owner@usaha.id' }), false)
  assert.equal(isDemoUser(null), false)
  assert.equal(isDemoUser({}), false)
})

/* ------------------------------------------------ Worker routes, no network */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const realFetch = globalThis.fetch
let fetchCalls = 0
afterEach(() => { globalThis.fetch = realFetch })
function blockNetwork() {
  fetchCalls = 0
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('network must not be used') }
}
const deps = (email) => ({
  authenticate: async () => ({ user: { id: `user-${email}`, email } }),
  readJson: async (req) => req.json(),
  ok: (data) => ({ data }),
  HttpError,
})
const post = (body) => new Request('https://x.test/api/leads/search', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

test('lead routes never reach external sources for demo accounts', async () => {
  blockNetwork()
  const d = deps('demo-ac@satualur.id')
  const env = { GOOGLE_PLACES_API_KEY: 'set' }
  const search = await handleLeadSearch(post({ ...BEKASI, radius_km: 5, keywords: ['hotel'] }), env, d)
  assert.equal(search.data.source, 'demo')
  assert.ok(search.data.results.length > 0 && search.data.results.every((r) => r.demo))
  const geo = await handleLeadGeocode(new Request('https://x.test/api/leads/geocode?q=Bandung'), env, d)
  assert.match(geo.data[0].label, /^Bandung/)
  const src = await handleLeadSources(new Request('https://x.test/api/leads/sources'), env, d)
  assert.equal(src.data.demo, true)
  assert.equal(src.data.google, false)
  assert.equal(fetchCalls, 0)
})

test('live accounts still use the real sources (no demo data)', async () => {
  blockNetwork()
  const d = deps('owner@usaha.id')
  const geo = handleLeadGeocode(new Request('https://x.test/api/leads/geocode?q=Bandung%20Kota'), {}, d)
  await assert.rejects(geo, (e) => e instanceof HttpError && e.status === 502)
  assert.ok(fetchCalls >= 1, 'live geocode goes to the network')
  const src = await handleLeadSources(new Request('https://x.test/api/leads/sources'), {}, d)
  assert.equal(src.data.demo, undefined)
})

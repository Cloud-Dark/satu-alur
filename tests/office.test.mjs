import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateServiceRequest, validateInfluencer, publicInfluencer } from '../src/office/rules.js'

const base = { name: 'A', niche: 'n', city: 'c' }

test('validateInfluencer cleans staff-only fields and enforces their limits', () => {
  const r = validateInfluencer({ ...base, handle_ig: ' @aulia ', handle_tiktok: '@@tt', contact_phone: ' 0812 ', contact_email: 'a@b.id',
    rates: [{ deliverable: ' Reel ', price_idr: 500000 }, { deliverable: '', price_idr: '' }], internal_notes: ' catatan ' })
  assert.equal(r.handle_ig, 'aulia')
  assert.equal(r.handle_tiktok, 'tt')
  assert.equal(r.handle_youtube, '')
  assert.equal(r.contact_phone, '0812')
  assert.deepEqual(r.rates, [{ deliverable: 'Reel', price_idr: 500000 }])
  assert.equal(r.internal_notes, 'catatan')
  assert.deepEqual(validateInfluencer(base).rates, [])
  assert.throws(() => validateInfluencer({ ...base, contact_email: 'bukan-email' }), /Email tidak valid/)
  const row = { deliverable: 'x', price_idr: 1 }
  assert.equal(validateInfluencer({ ...base, rates: Array(8).fill(row) }).rates.length, 8)
  assert.throws(() => validateInfluencer({ ...base, rates: Array(9).fill(row) }), /Maksimal 8 tarif/)
  assert.throws(() => validateInfluencer({ ...base, rates: [{ deliverable: 'x', price_idr: -1 }] }), /Harga tarif/)
  assert.throws(() => validateInfluencer({ ...base, rates: [{ deliverable: 'x', price_idr: 1.5 }] }), /Harga tarif/)
  assert.throws(() => validateInfluencer({ ...base, rates: [{ deliverable: 'x', price_idr: 1000000001 }] }), /Harga tarif/)
  assert.throws(() => validateInfluencer({ ...base, rates: 'x' }), { message: 'Format tarif tidak valid.' })
  assert.throws(() => validateInfluencer({ ...base, handle_ig: 'x'.repeat(61) }), /maksimal 60/)
  assert.throws(() => validateInfluencer({ ...base, contact_phone: 'x'.repeat(31) }), /maksimal 30/)
  assert.throws(() => validateInfluencer({ ...base, internal_notes: 'x'.repeat(2001) }), /maksimal 2000/)
})

test('publicInfluencer returns exactly the catalogue keys, never staff-only ones', () => {
  const row = { id: 1, ...validateInfluencer({ ...base, handle_ig: 'a', contact_phone: '08', contact_email: 'a@b.id', rates: [{ deliverable: 'x', price_idr: 5 }], internal_notes: 'n' }), created_at: 't' }
  assert.deepEqual(Object.keys(publicInfluencer(row)), ['id', 'name', 'photo_key', 'niche', 'city', 'ig_followers', 'tiktok_followers', 'bio'])
})

test('valid collab and ads requests pass', () => {
  const c = validateServiceRequest({ kind: 'collab', influencer_id: 3, payload: { campaign: 'Promo AC', budget_range: '1-5jt', timing: 'Bulan depan' } })
  assert.equal(c.kind, 'collab')
  assert.equal(c.influencer_id, 3)
  const a = validateServiceRequest({ kind: 'ads', payload: { service: 'Cuci AC', daily_budget: 50000, duration_days: 7, goal: 'leads' } })
  assert.equal(a.influencer_id, null)
  assert.equal(a.payload.goal, 'leads')
})

test('ads with unknown goal throws', () => {
  assert.throws(() => validateServiceRequest({ kind: 'ads', payload: { service: 'x', goal: 'viral' } }), /Tujuan iklan tidak dikenal\./)
})

test('collab without campaign throws', () => {
  assert.throws(() => validateServiceRequest({ kind: 'collab', influencer_id: 1, payload: { budget_range: 'a', timing: 'b' } }), /Ceritakan kampanye Anda\./)
})

test('ads budget and duration bounds', () => {
  assert.throws(() => validateServiceRequest({ kind: 'ads', payload: { service: 'x', daily_budget: 5 } }), /Budget harian/)
  assert.throws(() => validateServiceRequest({ kind: 'ads', payload: { service: 'x', duration_days: 91 } }), /Durasi/)
})

test('validateInfluencer requires niche and city, checks counts, photo_key, visible', () => {
  assert.throws(() => validateInfluencer({ name: 'A' }), /Niche wajib diisi\./)
  assert.throws(() => validateInfluencer({ name: 'A', niche: 'n' }), /Kota wajib diisi\./)
  assert.throws(() => validateInfluencer({ name: 'A', niche: 'n', city: 'c', ig_followers: -1 }), /Jumlah pengikut/)
  assert.throws(() => validateInfluencer({ name: 'A', niche: 'n', city: 'c', photo_key: 'zz' }), /Foto/)
  const r = validateInfluencer({ name: 'A', niche: 'n', city: 'c', ig_followers: 10, visible: 0 })
  assert.equal(r.visible, 0)
  assert.equal(r.ig_followers, 10)
  assert.equal(r.tiktok_followers, 0)
})

test('short text fields are capped at 200 characters', () => {
  const long = 'x'.repeat(201)
  const collab = (p) => validateServiceRequest({ kind: 'collab', influencer_id: 1, payload: { campaign: 'c', budget_range: 'b', timing: 't', ...p } })
  const ads = (p) => validateServiceRequest({ kind: 'ads', payload: { service: 's', ...p } })
  assert.throws(() => collab({ budget_range: long }), { message: 'Kisaran budget maksimal 200 karakter.' })
  assert.throws(() => collab({ timing: long }), { message: 'Waktu pelaksanaan maksimal 200 karakter.' })
  assert.throws(() => ads({ service: long }), { message: 'Layanan maksimal 200 karakter.' })
  assert.throws(() => ads({ location: long }), { message: 'Lokasi maksimal 200 karakter.' })
  assert.throws(() => validateInfluencer({ name: long, niche: 'n', city: 'c' }), { message: 'Nama maksimal 200 karakter.' })
  assert.throws(() => validateInfluencer({ name: 'n', niche: long, city: 'c' }), { message: 'Niche maksimal 200 karakter.' })
  assert.throws(() => validateInfluencer({ name: 'n', niche: 'n', city: long }), { message: 'Kota maksimal 200 karakter.' })
  assert.equal(collab({ timing: 'x'.repeat(200) }).payload.timing.length, 200)
})

test('validation errors are tagged so the worker maps only them to 400', () => {
  assert.throws(() => validateServiceRequest({ kind: 'nope' }), (e) => e.validation === true)
  assert.throws(() => validateInfluencer({}), (e) => e.validation === true)
})

test('worker admin = a session from the staff username/password login only', async () => {
  const { isAdminUser } = await import('../worker/social.js')
  assert.equal(isAdminUser({ email: 'budi@staff.satualur.internal', is_staff: 1 }), true)
  assert.equal(isAdminUser({ email: 'budi@staff.satualur.internal', is_staff: 0 }), false) // OTP login with the same email
  assert.equal(isAdminUser({ email: 'x@y.z' }), false)
  assert.equal(isAdminUser(null), false)
})

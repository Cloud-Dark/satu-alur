import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateServiceRequest, validateInfluencer } from '../src/office/rules.js'

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

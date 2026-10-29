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

// Unit tests: src/domain/rules.js (offer validation + status transitions). FR-011, FR-012.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

const { validateOffer, OfferRules, canTransition, OfferTransitions } = await import('../src/domain/rules.js')

const ok = { scope: 'Cuci 3 unit AC split 1 PK', price: 450000, terms: 'Bayar setelah selesai, garansi 7 hari.' }

test('validateOffer: valid offer passes', () => {
  assert.deepEqual(validateOffer(ok), { valid: true, errors: [] })
})

test('validateOffer: empty proposal', () => {
  const r = validateOffer(null)
  assert.equal(r.valid, false)
  assert.deepEqual(r.errors, ['Proposal AI kosong.'])
})

test('validateOffer: price boundaries are inclusive', () => {
  assert.equal(validateOffer({ ...ok, price: OfferRules.minPrice }).valid, true)
  assert.equal(validateOffer({ ...ok, price: OfferRules.maxPrice }).valid, true)
  assert.equal(validateOffer({ ...ok, price: OfferRules.minPrice - 1 }).valid, false)
  assert.equal(validateOffer({ ...ok, price: OfferRules.maxPrice + 1 }).valid, false)
})

test('validateOffer: price as numeric string accepted, text rejected', () => {
  assert.equal(validateOffer({ ...ok, price: '450000' }).valid, true)
  const r = validateOffer({ ...ok, price: 'Rp450.000' })
  assert.equal(r.valid, false)
  assert.match(r.errors[0], /^Harga harus antara Rp10\.000 dan Rp1\.000\.000\.000\.$/)
})

test('validateOffer: scope and terms need 10 non-blank characters', () => {
  const r = validateOffer({ ...ok, scope: '   pendek   ', terms: '123456789' })
  assert.equal(r.valid, false)
  assert.equal(r.errors.length, 2)
  assert.match(r.errors[0], /Ruang lingkup/)
  assert.match(r.errors[1], /Ketentuan/)
  assert.equal(validateOffer({ ...ok, scope: '1234567890', terms: '1234567890' }).valid, true)
})

test('validateOffer: collects all errors at once', () => {
  const r = validateOffer({ scope: '', price: 0, terms: '' })
  assert.equal(r.errors.length, 3)
})

test('canTransition follows OfferTransitions', () => {
  assert.equal(canTransition('draft', 'pending_approval', OfferTransitions), true)
  assert.equal(canTransition('draft', 'approved', OfferTransitions), false)
  assert.equal(canTransition('pending_approval', 'approved', OfferTransitions), true)
  assert.equal(canTransition('pending_approval', 'rejected', OfferTransitions), true)
  assert.equal(canTransition('approved', 'draft', OfferTransitions), true)
  assert.equal(canTransition('rejected', 'approved', OfferTransitions), false)
  assert.equal(canTransition('unknown', 'draft', OfferTransitions), false)
})

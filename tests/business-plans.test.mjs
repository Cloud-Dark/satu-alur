import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePlan, validateReorder, formatPrice, PERIODS } from '../src/business/plan-rules.js'

const base = { slug: 'ukm', name: 'UKM', tagline: 'Untuk tim', price_idr: 349000, period: 'month', cta_label: 'Pilih', cta_kind: 'signup' }

test('formatPrice: id-ID thousands, default period suffixes', () => {
  assert.deepEqual(formatPrice({ price_idr: 349000, period: 'month' }), { price: 'Rp349.000', period: 'per bulan' })
  assert.deepEqual(formatPrice({ price_idr: 1200000, period: 'year' }), { price: 'Rp1.200.000', period: 'per tahun' })
  assert.deepEqual(formatPrice({ price_idr: 50000, period: 'once' }), { price: 'Rp50.000', period: 'sekali bayar' })
  assert.deepEqual(formatPrice({ price_idr: 50000, period: 'custom' }), { price: 'Rp50.000', period: '' })
})

test('formatPrice: null is Kustom, 0 is Rp0, period_label replaces the suffix', () => {
  assert.equal(formatPrice({ price_idr: null, period: 'custom' }).price, 'Kustom')
  assert.deepEqual(formatPrice({ price_idr: 0, period: 'month', period_label: 'Gratis 3 bulan' }), { price: 'Rp0', period: 'Gratis 3 bulan' })
  assert.equal(PERIODS.join(), 'month,year,once,custom')
})

test('validatePlan: accepts a good plan and fills defaults', () => {
  const p = validatePlan(base)
  assert.equal(p.slug, 'ukm')
  assert.equal(p.price_idr, 349000)
  assert.equal(p.recommended, 0)
  assert.equal(p.active, 1)
  assert.deepEqual(p.limits, [])
  assert.deepEqual(p.features, [])
  assert.equal(validatePlan({ ...base, price_idr: null }).price_idr, null)
})

test('validatePlan: slug, name, price, period, cta', () => {
  assert.throws(() => validatePlan({ ...base, slug: 'Bad Slug' }), /Slug/)
  assert.throws(() => validatePlan({ ...base, slug: 'a' }), /Slug/)
  assert.throws(() => validatePlan({ ...base, name: '' }), /Nama paket wajib/)
  assert.throws(() => validatePlan({ ...base, name: 'x'.repeat(61) }), /maksimal 60/)
  assert.throws(() => validatePlan({ ...base, price_idr: -1 }), /Harga/)
  assert.throws(() => validatePlan({ ...base, price_idr: 1.5 }), /Harga/)
  assert.throws(() => validatePlan({ ...base, price_idr: 1000000001 }), /Harga/)
  assert.throws(() => validatePlan({ ...base, period: 'week' }), /Periode/)
  assert.throws(() => validatePlan({ ...base, cta_kind: 'x' }), /Tombol/)
})

test('validatePlan: at most 6 limits and 12 features, with length caps', () => {
  const limit = (i) => ({ label: `L${i}`, value: 'v' })
  assert.equal(validatePlan({ ...base, limits: [1, 2, 3, 4, 5, 6].map(limit) }).limits.length, 6)
  assert.throws(() => validatePlan({ ...base, limits: [1, 2, 3, 4, 5, 6, 7].map(limit) }), /Maksimal 6 batas/)
  assert.throws(() => validatePlan({ ...base, limits: [{ label: 'x'.repeat(31), value: 'v' }] }), /maksimal 30/)
  const f = (n) => Array.from({ length: n }, (_, i) => `Fitur ${i}`)
  assert.equal(validatePlan({ ...base, features: f(12) }).features.length, 12)
  assert.throws(() => validatePlan({ ...base, features: f(13) }), /Maksimal 12 fitur/)
  assert.throws(() => validatePlan({ ...base, features: ['x'.repeat(101)] }), /maksimal 100/)
})

test('validatePlan: blank features and half-empty limit rows are dropped; non-arrays are refused', () => {
  const p = validatePlan({ ...base, features: ['A', '  ', ''], limits: [{ label: 'L', value: 'v' }, { label: '', value: 'x' }, { label: 'y', value: '' }] })
  assert.deepEqual(p.features, ['A'])
  assert.deepEqual(p.limits, [{ label: 'L', value: 'v' }])
  assert.throws(() => validatePlan({ ...base, limits: 'x' }), /Format batasan tidak valid\./)
  assert.throws(() => validatePlan({ ...base, features: {} }), /Format fitur tidak valid\./)
  assert.equal(validatePlan({ ...base, limits: undefined }).limits.length, 0)
})

test('validateReorder: needs every existing id exactly once', () => {
  assert.deepEqual(validateReorder([3, 1, 2], [1, 2, 3]), [3, 1, 2])
  assert.throws(() => validateReorder([1, 1, 2], [1, 2, 3]), /Urutan paket tidak valid/)
  assert.throws(() => validateReorder([1, 2], [1, 2, 3]), /semua paket/)
  assert.throws(() => validateReorder('x', [1]), /tidak valid/)
  assert.throws(() => validateReorder([1, 4], [1, 2]), /semua paket/)
})

test('validatePlan: tags every failure as a validation error', () => {
  try { validatePlan({ ...base, slug: '!' }) } catch (e) { assert.equal(e.validation, true); return }
  assert.fail('should throw')
})

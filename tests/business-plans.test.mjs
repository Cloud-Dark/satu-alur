import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import './helpers/setup.mjs'
import { validatePlan, validateReorder, formatPrice, PERIODS, ENTERPRISE_PLAN, priceFromText } from '../src/business/plan-rules.js'
import { FEATURES as QUOTA_FEATURES, limitFor } from '../src/quota/rules.js'
import { PRICING_TIERS } from '../src/landing/pricing.js'
import { isLongPrice } from '../src/business/plan-card.js'
import { handlePlansPublic } from '../worker/business.js'
import { makeD1 } from './helpers/d1-sqlite.mjs'

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

/* ------------------------------------------------------------- Enterprise */

// Pro as seeded by scripts/seed-office.mjs: the highest paket before Enterprise.
const PRO_QUOTA = { offer: null, report: null, leads: 100, radar: null, advisor: 500, social: null, income: null }

test('Enterprise: Rp3.512.172 per bulan, contact CTA, passes validatePlan unchanged', () => {
  assert.deepEqual(formatPrice(ENTERPRISE_PLAN), { price: 'Rp3.512.172', period: 'per bulan' })
  assert.equal(ENTERPRISE_PLAN.period, 'month')
  assert.equal(ENTERPRISE_PLAN.slug, 'enterprise')
  assert.equal(ENTERPRISE_PLAN.cta_kind, 'contact')
  assert.equal(ENTERPRISE_PLAN.cta_label, 'Hubungi kami')
  const v = validatePlan(ENTERPRISE_PLAN)
  for (const k of ['slug', 'name', 'tagline', 'price_idr', 'period', 'period_label', 'badge', 'limits', 'features', 'quota', 'cta_label', 'cta_kind', 'sort']) {
    assert.deepEqual(v[k], ENTERPRISE_PLAN[k], k)
  }
})

test('Enterprise: NDA and SLA on top of every Pro feature, AI quota at least Pro', () => {
  const f = ENTERPRISE_PLAN.features.join(' | ')
  assert.match(f, /Semua fitur Pro/)
  assert.match(f, /NDA: perjanjian kerahasiaan/)
  assert.match(f, /SLA uptime layanan 99,9%/)
  assert.match(f, /SLA respons dukungan/)
  for (const { key } of QUOTA_FEATURES) {
    const ent = limitFor(ENTERPRISE_PLAN.quota, key)
    const pro = limitFor(PRO_QUOTA, key)
    assert.ok(ent === null || (pro !== null && ent > pro), `${key}: Enterprise ${ent} vs Pro ${pro}`)
  }
})

test('priceFromText: built-in card prices, thousands separators included', () => {
  assert.equal(priceFromText('Rp0'), 0)
  assert.equal(priceFromText('Rp349rb'), 349000)
  assert.equal(priceFromText('Rp3.512.172'), 3512172)
  assert.equal(priceFromText('Kustom'), null)
})

test('landing built-in Enterprise card: same price, NDA + SLA, contact CTA, imports with its quota', () => {
  const t = PRICING_TIERS.find((x) => x.id === 'enterprise')
  assert.equal(t.price, 'Rp3.512.172')
  assert.equal(t.period, 'per bulan')
  assert.equal(t.cta.href, null)
  assert.equal(t.cta.label, 'Hubungi kami')
  assert.ok(t.features.some((x) => x.startsWith('NDA')) && t.features.some((x) => x.startsWith('SLA')))
  assert.deepEqual(t.quota, ENTERPRISE_PLAN.quota)
  assert.equal(priceFromText(t.price), ENTERPRISE_PLAN.price_idr)
  assert.equal(isLongPrice(t.price), true)
  assert.equal(isLongPrice('Rp349.000'), false)
})

test('migration 0020 adds the Enterprise row exactly as ENTERPRISE_PLAN, last in order, public via /api/plans', async (t) => {
  const { DatabaseSync } = await import('node:sqlite').catch(() => ({}))
  if (!DatabaseSync) { t.skip('needs node:sqlite'); return }
  const D1 = await makeD1()
  const res = await handlePlansPublic(null, { DB: D1 }, { ok: (data) => new Response(JSON.stringify({ data })) })
  const plans = (await res.json()).data
  const ent = plans.find((p) => p.slug === 'enterprise')
  assert.ok(ent, 'enterprise plan exists after migrations')
  assert.equal(plans.at(-1).slug, 'enterprise')
  for (const k of ['name', 'tagline', 'price_idr', 'period', 'period_label', 'recommended', 'badge', 'limits', 'features', 'quota', 'cta_label', 'cta_kind']) {
    assert.deepEqual(ent[k], ENTERPRISE_PLAN[k], k)
  }
  assert.equal(ent.active, 1)
  // Re-running is a no-op (INSERT OR IGNORE on the unique slug), so a hand-edited 'enterprise' row survives.
  D1.raw.exec("UPDATE subscription_plans SET name = 'Enterprise (staf)' WHERE slug = 'enterprise'")
  D1.raw.exec(await readFile(new URL('../migrations/0020_enterprise_plan.sql', import.meta.url), 'utf8'))
  const rows = D1.raw.prepare("SELECT name FROM subscription_plans WHERE slug = 'enterprise'").all()
  assert.deepEqual(rows.map((r) => r.name), ['Enterprise (staf)'])
})

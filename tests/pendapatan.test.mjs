// Unit tests: src/business/vas-engine.js and src/business/waste-engine.js.
// Numbers are hand-computed from tests/helpers/fixtures.mjs (reference day:
// 15 Oct 2026). Revenue in the fixture is 2.0M + 3.0M + 1.0M + 1.5M = 7.5M
// across 5 completions, so the average job is 1.5M.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'
import { rawFlow, NOW } from './helpers/fixtures.mjs'

const V = await import('../src/business/vas-engine.js')
const W = await import('../src/business/waste-engine.js')
const { buildModel } = await import('../src/stages/data.js')

const model = buildModel(rawFlow())
const now = NOW.getTime()
const kinds = (list) => list.map((o) => o.kind)

/* ------------------------------------------------------------------ VAS */

test('discoverOpportunities ranks findings by monthly potential', () => {
  const opps = V.discoverOpportunities(model, { now })
  assert.deepEqual(kinds(opps), ['bundling', 'garansi', 'langganan', 'tertahan'])
  assert.deepEqual(opps.map((o) => o.potential), [205000, 90000, 80000, 15000])
  for (let i = 1; i < opps.length; i++) assert.ok(opps[i - 1].potential >= opps[i].potential)
})

test('each opportunity carries a Rupiah price, a confidence and its evidence', () => {
  for (const o of V.discoverOpportunities(model, { now })) {
    assert.ok(o.price >= 0, `${o.kind} price`)
    assert.ok(o.confidence > 0 && o.confidence <= 0.95, `${o.kind} confidence`)
    assert.ok(o.basis.length > 0, `${o.kind} basis`)
    assert.ok(o.owner.length > 0, `${o.kind} owner`)
  }
})

test('bundling rule names the most requested uncovered service', () => {
  const bundling = V.discoverOpportunities(model, { now }).find((o) => o.kind === 'bundling')
  assert.match(bundling.title, /Servis AC/)
  assert.equal(bundling.jobsPerMonth, 6)
})

test('an active catalog item covers its service type and removes that bundle rule', () => {
  const catalog = [{ name: 'Kontrak AC', status: 'active', price: 450000, cost: 120000, attach_to: 'Servis AC', attach_rate: 30 }]
  const opps = V.discoverOpportunities(model, { catalog, now })
  const bundling = opps.find((o) => o.kind === 'bundling')
  assert.match(bundling.title, /Cuci sofa/)
})

test('thin-margin catalog items raise their own rule', () => {
  const catalog = [{ name: 'Poles marmer', status: 'active', price: 85000, cost: 70000, attach_to: null, attach_rate: 15 }]
  const opps = V.discoverOpportunities(model, { catalog, now })
  const thin = opps.find((o) => o.kind === 'marginkatalog')
  assert.ok(thin, 'expected a marginkatalog opportunity')
  assert.match(thin.basis, /Poles marmer/)
})

test('itemEconomics and attachRate read a whole percent as a fraction', () => {
  assert.deepEqual(V.itemEconomics({ price: 100000, cost: 40000 }), { price: 100000, cost: 40000, margin: 60000, marginPct: 60 })
  assert.equal(V.attachRate({ attach_rate: 30 }), 0.3)
  assert.equal(V.attachRate({ attach_rate: 0.4 }), 0.4)
  assert.equal(V.attachRate({}), 0.25)
})

test('catalogPotential sums margin × attach rate of active items only', () => {
  const items = [
    { status: 'active', price: 100000, cost: 40000, attach_rate: 50 },
    { status: 'active', price: 200000, cost: 200000, attach_rate: 100 },
    { status: 'draft', price: 900000, cost: 0, attach_rate: 100 },
  ]
  assert.deepEqual(V.catalogPotential(items), { active: 2, monthly: 30000 })
})

test('vasRevenueShare only counts revenue rows tagged with a vas_item_id', () => {
  const ledger = [
    { category: 'pendapatan', amount: 1000000 },
    { category: 'pendapatan', amount: 500000, vas_item_id: 8001 },
    { category: 'biaya_bahan', amount: 200000 },
  ]
  const share = V.vasRevenueShare(ledger, [])
  assert.equal(share.revenue, 1500000)
  assert.equal(share.vas, 500000)
  assert.equal(Math.round(share.share), 33)
})

/* ---------------------------------------------------------------- Waste */

const ENTRIES = [
  { stream: 'waktu', monthly_loss: 480000, saved: 120000, status: 'progress' },
  { stream: 'pengerjaan_ulang', monthly_loss: 600000, saved: 240000, status: 'progress' },
  { stream: 'pengerjaan_ulang', monthly_loss: 240000, saved: 240000, status: 'done' },
  { stream: 'perjalanan', monthly_loss: 360000, saved: 0, status: 'open' },
]

test('computeWaste totals loss, savings and the share of revenue still leaking', () => {
  const w = W.computeWaste(ENTRIES, 7500000)
  assert.equal(w.loss, 1680000)
  assert.equal(w.saved, 600000)
  assert.equal(w.remaining, 1080000)
  assert.equal(Math.round(w.pct), 36)
  assert.equal(Math.round(w.lossShare * 10) / 10, 14.4)
  assert.equal(w.open, 3)
  assert.equal(w.done, 1)
})

test('every stream is reported, even the ones with no findings', () => {
  const w = W.computeWaste(ENTRIES, 7500000)
  assert.equal(w.streams.length, 5)
  assert.deepEqual(w.streams.map((s) => s.key), W.WASTE_STREAMS.map((s) => s.key))
  const bahan = w.streams.find((s) => s.key === 'bahan')
  assert.equal(bahan.loss, 0)
  assert.equal(bahan.pct, 0)
})

test('savings are capped at the recorded loss for a stream', () => {
  const w = W.computeWaste([{ stream: 'bahan', monthly_loss: 100000, saved: 500000 }], 0)
  const bahan = w.streams.find((s) => s.key === 'bahan')
  assert.equal(bahan.saved, 100000)
  assert.equal(bahan.remaining, 0)
})

test('winnable is what open findings could still release', () => {
  const w = W.computeWaste(ENTRIES, 7500000)
  assert.equal(w.winnable, 360000 + 360000 + 360000)
})

test('benchmarkVerdict compares the remaining loss with revenue', () => {
  const w = W.computeWaste(ENTRIES, 7500000)
  const perjalanan = w.streams.find((s) => s.key === 'perjalanan')
  // 360.000 / 7.500.000 = 4,8% against a 6% benchmark
  assert.equal(W.benchmarkVerdict(perjalanan, 7500000).tone, 'warn')
  assert.equal(W.benchmarkVerdict({ ...perjalanan, remaining: 0 }, 7500000).tone, 'ok')
  assert.equal(W.benchmarkVerdict({ ...perjalanan, remaining: 900000 }, 7500000).tone, 'danger')
  assert.equal(W.benchmarkVerdict(perjalanan, 0).tone, 'neutral')
})

test('closurePlan orders the biggest remaining leaks and skips clean streams', () => {
  const w = W.computeWaste(ENTRIES, 7500000)
  const plan = W.closurePlan(w)
  // All three leaks tie at 360.000, so the stream order breaks the tie.
  assert.deepEqual(plan.map((p) => p.stream), ['waktu', 'perjalanan', 'pengerjaan_ulang'])
  for (const p of plan) assert.ok(p.action.length > 10)
})

test('a fully closed set reports 100% waste-free', () => {
  const w = W.computeWaste([{ stream: 'bahan', monthly_loss: 200000, saved: 200000, status: 'done' }], 7500000)
  assert.equal(w.remaining, 0)
  assert.equal(w.pct, 100)
  assert.equal(W.closurePlan(w).length, 0)
})

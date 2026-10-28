// Unit tests: src/ai/radar-engine.js (Radar peluang — deterministic opportunity detection).
import { test } from 'node:test'
import assert from 'node:assert/strict'

const E = await import('../src/ai/radar-engine.js')

const NOW = new Date('2026-10-28T10:00:00Z')
const DAY = 86400000
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString()

/**
 * Builds raw tables from compact job specs:
 * { c: customer, s: service, d: days ago, p: price, st: 'job' | 'draft' | 'rejected' | 'new', offerAge?, phone? }
 */
function flow(specs) {
  const t = { requests: [], offers: [], assignments: [], completions: [], ledger_entries: [] }
  let id = 1
  for (const x of specs) {
    const rid = id++
    t.requests.push({ id: rid, customer_name: x.c, service_type: x.s, phone: x.phone || null, location: x.loc || 'Bekasi', description: x.desc || '', created_at: ago(x.d) })
    if (x.st === 'new') continue
    const oid = id++
    const status = x.st === 'job' || !x.st ? 'approved' : x.st
    t.offers.push({ id: oid, request_id: rid, validated_price: x.p, ai_proposal_json: { price: x.p }, status, created_at: ago(x.offerAge ?? x.d) })
    if (status !== 'approved') continue
    const aid = id++
    t.assignments.push({ id: aid, offer_id: oid, status: 'done', created_at: ago(x.d) })
    const cid = id++
    t.completions.push({ id: cid, assignment_id: aid, status: 'done', completed_at: ago(x.d), created_at: ago(x.d) })
    t.ledger_entries.push({ id: id++, completion_id: cid, amount: x.p, category: 'pendapatan', posted_at: ago(x.d), created_at: ago(x.d) })
    t.ledger_entries.push({ id: id++, completion_id: cid, amount: Math.round(x.p * 0.3), category: 'biaya_tenaga', posted_at: ago(x.d), created_at: ago(x.d) })
  }
  return t
}
const run = (specs) => E.buildRadar(flow(specs), { now: NOW })
const ofType = (r, type) => r.opportunities.filter((o) => o.type === type)

test('empty account: no opportunities, no invented numbers', () => {
  const r = E.buildRadar({ requests: [], offers: [], assignments: [], completions: [], ledger: [] }, { now: NOW })
  assert.equal(r.hasData, false)
  assert.equal(r.opportunities.length, 0)
  assert.deepEqual({ count: r.summary.count, value: r.summary.value, high: r.summary.high }, { count: 0, value: 0, high: 0 })
  assert.equal(r.stats.overall.n, 0)
  assert.equal(r.stats.overall.rate, null)
  assert.equal(r.stats.overall.enough, false)
})

test('accepts the loadFlow model shape (ledger) as well as raw tables (ledger_entries)', () => {
  const raw = flow([{ c: 'A', s: 'Cuci AC', d: 10, p: 300000 }])
  const model = { ...raw, ledger: raw.ledger_entries }
  delete model.ledger_entries
  const a = E.prepare(raw, NOW)
  const b = E.prepare(model, NOW)
  assert.equal(a.facts[0].revenue, 300000)
  assert.equal(b.facts[0].revenue, 300000)
})

test('due: own cadence from the customer history, value from their own average', () => {
  const r = run([
    { c: 'Ibu Sari', s: 'Cuci AC', d: 275, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 185, p: 320000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 95, p: 340000 },
  ])
  const due = ofType(r, 'due')
  assert.equal(due.length, 1)
  const o = due[0]
  assert.equal(o.customer.name, 'Ibu Sari')
  assert.equal(o.service, 'Cuci AC')
  assert.equal(o.facts.source, 'customer')
  assert.equal(Math.round(o.facts.intervalDays), 90)
  assert.equal(o.value, 320000) // mean of 300k, 320k, 340k
  assert.equal(o.evidence.length, 3)
  assert.ok(o.evidence.every((e) => e.requestId != null && e.amount > 0))
  assert.ok(o.score >= 0 && o.score <= 100)
  assert.equal(ofType(r, 'churn').length, 0)
})

test('due is not raised when the customer already asked again for that service', () => {
  const r = run([
    { c: 'Ibu Sari', s: 'Cuci AC', d: 275, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 185, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 95, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 2, p: 300000, st: 'new' },
  ])
  assert.equal(ofType(r, 'due').length, 0)
})

test('churn: regular customer silent for more than 1.5x the usual interval', () => {
  const r = run([
    { c: 'Kedai Kopi', s: 'Cuci AC', d: 170, p: 500000 },
    { c: 'Kedai Kopi', s: 'Isi freon', d: 140, p: 500000 },
    { c: 'Kedai Kopi', s: 'Cuci AC', d: 110, p: 500000 },
    { c: 'Kedai Kopi', s: 'Perbaikan', d: 80, p: 500000 },
  ])
  const churn = ofType(r, 'churn')
  assert.equal(churn.length, 1)
  assert.equal(Math.round(churn[0].facts.usualDays), 30)
  assert.ok(churn[0].facts.ratio > 1.5)
  assert.match(churn[0].why, /±30 hari/)
  assert.equal(ofType(r, 'due').filter((o) => o.customer.name === 'Kedai Kopi').length, 0, 'churn suppresses due cards')
})

test('pending: stale draft offers and unoffered requests, with a link to the offer', () => {
  const r = run([
    { c: 'PT Maju', s: 'Deep cleaning', d: 12, p: 2500000, st: 'draft' },
    { c: 'PT Baru', s: 'Deep cleaning', d: 1, p: 900000, st: 'draft' }, // too fresh
    { c: 'Toko Lama', s: 'Cuci AC', d: 200, p: 400000, st: 'draft' }, // stale > 90 days
    { c: 'Bapak Andi', s: 'Cuci AC', d: 5, st: 'new' },
  ])
  const pend = ofType(r, 'pending')
  assert.deepEqual(pend.map((o) => o.title).sort(), ['Bapak Andi', 'PT Maju'])
  const draft = pend.find((o) => o.title === 'PT Maju')
  assert.equal(draft.value, 2500000)
  assert.equal(draft.nav.stage, 'offer')
  assert.ok(draft.nav.params.offerId != null)
  const fresh = pend.find((o) => o.title === 'Bapak Andi')
  assert.ok(fresh.nav.params.requestId != null)
})

test('reapproach: rejected offer followed by a purchase of something else', () => {
  const r = run([
    { c: 'Ibu Rina', s: 'Pasang AC baru', d: 120, p: 3500000, st: 'rejected' },
    { c: 'Ibu Rina', s: 'Cuci AC', d: 40, p: 300000 },
  ])
  const re = ofType(r, 'reapproach')
  assert.equal(re.length, 1)
  assert.equal(re[0].service, 'Pasang AC baru')
  assert.equal(re[0].value, 3500000)
  assert.equal(re[0].nav.stage, 'request')
  assert.equal(re[0].nav.params.prefill.customer_name, 'Ibu Rina')
  assert.equal(re[0].nav.params.prefill.service_type, 'Pasang AC baru')
})

test('upsell: frequent non-contract customer, annual value from their own average', () => {
  const r = run([
    { c: 'Studio Foto', s: 'Cuci AC', d: 150, p: 400000 },
    { c: 'Studio Foto', s: 'Cuci AC', d: 100, p: 400000 },
    { c: 'Studio Foto', s: 'Cuci AC', d: 50, p: 400000 },
  ])
  const up = ofType(r, 'upsell')
  assert.equal(up.length, 1)
  // 3 jobs in 180 days -> ±6.08 per year × Rp400.000
  assert.equal(up[0].value, Math.round(400000 * 3 * (365 / 180)))
  assert.equal(up[0].prediction, null, 'no contract services in the account -> no historical basis')
  const chance = up[0].factors.find((f) => f.key === 'chance')
  assert.equal(chance.neutral, true)
  assert.equal(chance.value, 0.5)
})

test('contract customers are not offered a contract, but a stopped contract is churn', () => {
  const specs = []
  for (let m = 12; m >= 3; m--) specs.push({ c: 'Hotel Melati', s: 'Kontrak laundry linen', d: m * 30, p: 8000000 })
  const r = run(specs)
  assert.equal(ofType(r, 'upsell').length, 0)
  assert.equal(ofType(r, 'due').length, 0)
  const churn = ofType(r, 'churn')
  assert.equal(churn.length, 1)
  assert.equal(churn[0].facts.routine, true)
  assert.equal(churn[0].value, 8000000)
})

test('walk-in aggregates never become customer opportunities', () => {
  const specs = []
  for (let w = 20; w >= 2; w--) specs.push({ c: 'Pelanggan walk-in — Outlet A', s: 'Rekap kiloan', d: w * 7, p: 2000000 })
  const r = run(specs)
  assert.equal(r.opportunities.filter((o) => o.customer).length, 0)
  assert.equal(r.counts.customers, 0)
})

test('cross-sell from co-purchases in the account', () => {
  const specs = []
  for (let i = 0; i < 6; i++) {
    specs.push({ c: `Pelanggan ${i}`, s: 'Cuci AC', d: 300 - i, p: 300000 })
    specs.push({ c: `Pelanggan ${i}`, s: 'Isi freon', d: 250 - i, p: 450000 })
  }
  for (let i = 6; i < 10; i++) specs.push({ c: `Pelanggan ${i}`, s: 'Pasang AC', d: 280, p: 2500000 })
  specs.push({ c: 'Ibu Baru', s: 'Cuci AC', d: 20, p: 300000 })
  const r = run(specs)
  const pair = r.pairs.find((p) => p.aName === 'Cuci AC' && p.bName === 'Isi freon')
  assert.ok(pair, 'pair detected')
  assert.equal(pair.both, 6)
  assert.equal(pair.aCount, 7)
  const cross = ofType(r, 'cross')
  assert.equal(cross.length, 1)
  assert.equal(cross[0].customer.name, 'Ibu Baru')
  assert.equal(cross[0].service, 'Isi freon')
  assert.equal(cross[0].value, 450000)
  assert.equal(cross[0].prediction.k, 6)
  assert.equal(cross[0].prediction.n, 7)
})

test('seasonal: last year window uplift from the account history', () => {
  const specs = []
  // 14 months of steady demand for two services, plus extra pest work in Nov 2025–Mar 2026.
  for (let d = 420; d >= 5; d -= 6) {
    specs.push({ c: `A${d}`, s: 'Cat interior', d, p: 1000000 })
    specs.push({ c: `B${d}`, s: 'Pest control', d: d + 1, p: 800000 })
  }
  for (let d = 360; d >= 215; d -= 5) specs.push({ c: `C${d}`, s: 'Pest control', d, p: 800000 }) // ±27 Oct 2025 → 27 Mar 2026
  const r = run(specs)
  const season = ofType(r, 'season').find((o) => o.season.id === 'hujan')
  assert.ok(season, 'rainy season card')
  assert.equal(season.season.source, 'history')
  assert.equal(season.inPipeline, false)
  const pest = season.facts.uplift.find((s) => s.name === 'Pest control')
  assert.ok(pest.uplift > 0.15, `uplift ${pest.uplift}`)
  assert.ok(!season.facts.uplift.some((s) => s.name === 'Cat interior'))
  assert.equal(r.summary.value, r.opportunities.filter((o) => o.inPipeline).reduce((s, o) => s + o.value, 0))
})

test('scoreOf: weighted, renormalised when a factor has no data', () => {
  const { score, factors } = E.scoreOf([
    { key: 'a', value: 1, weight: 0.3 },
    { key: 'b', value: 0.5, weight: 0.2 },
    { key: 'c', value: null, weight: 0.5 },
  ])
  assert.equal(score, Math.round(100 * (0.3 * 1 + 0.2 * 0.5) / 0.5))
  assert.equal(factors[2].contribution, null)
  assert.ok(Math.abs(factors[0].contribution + factors[1].contribution - score) < 0.5)
  assert.equal(E.tierOf(E.RULES.highScore).key, 'high')
  assert.equal(E.tierOf(E.RULES.midScore).key, 'mid')
  assert.equal(E.tierOf(10).key, 'low')
})

test('rate/wilson: small samples are flagged, interval contains the rate', () => {
  const small = E.rate(3, 4, 'x')
  assert.equal(small.enough, false)
  const big = E.rate(45, 50, 'x')
  assert.equal(big.enough, true)
  assert.ok(big.lo < 0.9 && big.hi > 0.9 && big.lo >= 0 && big.hi <= 1)
  assert.equal(E.wilson(0, 0), null)
})

test('keys are deterministic and change after a new purchase', () => {
  const base = [
    { c: 'Ibu Sari', s: 'Cuci AC', d: 275, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 185, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 95, p: 300000 },
  ]
  const k1 = ofType(run(base), 'due')[0].key
  const k2 = ofType(run(base), 'due')[0].key
  assert.equal(k1, k2)
  assert.match(k1, /^due:[0-9a-f]{8}$/)
  const later = E.buildRadar(flow([...base, { c: 'Ibu Sari', s: 'Cuci AC', d: 5, p: 300000 }]), { now: new Date(NOW.getTime() + 85 * DAY) })
  const k3 = ofType(later, 'due')[0]?.key
  assert.ok(k3 && k3 !== k1)
})

test('applyStates: done/dismissed hide, snoozed hides until the date', () => {
  const list = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]
  const states = [
    { opp_key: 'a', status: 'done', created_at: '2026-10-01' },
    { opp_key: 'b', status: 'snoozed', until: ago(-10), created_at: '2026-10-01' },
    { opp_key: 'c', status: 'snoozed', until: ago(1), created_at: '2026-10-01' }, // expired
  ]
  const { visible, hidden } = E.applyStates(list, states, NOW)
  assert.deepEqual(visible.map((o) => o.key), ['c', 'd'])
  assert.deepEqual(hidden.map((o) => o.key), ['a', 'b'])
  assert.equal(hidden[0].state.status, 'done')
})

test('thisWeek: only items due within 7 days with a meaningful score', () => {
  const list = [
    { key: 'a', actBy: ago(0), score: 80 },
    { key: 'b', actBy: ago(-5), score: 60 },
    { key: 'c', actBy: ago(-20), score: 90 },
    { key: 'd', actBy: null, score: 90 },
    { key: 'e', actBy: ago(0), score: 10 },
  ]
  assert.deepEqual(E.thisWeek(list, NOW).map((o) => o.key), ['a', 'b'])
})

test('opportunityContext: grounded text with evidence, no undefined', () => {
  const r = run([
    { c: 'Ibu Sari', s: 'Cuci AC', d: 275, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 185, p: 300000 },
    { c: 'Ibu Sari', s: 'Cuci AC', d: 95, p: 300000 },
  ])
  const txt = E.opportunityContext(ofType(r, 'due')[0])
  assert.match(txt, /Pelanggan: Ibu Sari/)
  assert.match(txt, /Bukti dari riwayat:/)
  assert.match(txt, /Rp\s?300\.000/)
  assert.doesNotMatch(txt, /undefined|NaN|null/)
})

test('every opportunity is explainable: factors, evidence or calendar note, bounded score', () => {
  const specs = []
  for (let i = 0; i < 30; i++) specs.push({ c: `P${i % 7}`, s: ['Cuci AC', 'Isi freon', 'Perbaikan'][i % 3], d: 10 + i * 11, p: 250000 + (i % 5) * 100000, st: i % 9 === 0 ? 'rejected' : 'job' })
  specs.push({ c: 'P1', s: 'Cuci AC', d: 6, p: 300000, st: 'draft' })
  const r = run(specs)
  assert.ok(r.opportunities.length > 0)
  for (const o of r.opportunities) {
    assert.ok(E.OPP_TYPES[o.type], o.type)
    assert.ok(Number.isInteger(o.score) && o.score >= 0 && o.score <= 100)
    assert.ok(o.factors.length >= 2)
    assert.ok(o.why && !/undefined|NaN/.test(o.why), o.why)
    assert.ok(o.type === 'season' || o.evidence.length > 0)
    assert.ok(Number.isFinite(o.value) && o.value >= 0)
  }
})

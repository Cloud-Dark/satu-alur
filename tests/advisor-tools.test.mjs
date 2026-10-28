// Unit tests: src/ai/advisor-tools.js (growth calculator + business snapshot fed by a
// synthetic buildModel()). Numbers are hand-computed from tests/helpers/fixtures.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'
import { rawFlow, NOW } from './helpers/fixtures.mjs'

const T = await import('../src/ai/advisor-tools.js')
const { buildModel } = await import('../src/stages/data.js')

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const flat = (s) => s.replace(/\s/g, ' ') // Intl uses NBSP between "Rp" and digits

/* ----------------------------------------------------------- formatting */

test('rp / pct / pctPlain / fmtJobs format id-ID', () => {
  assert.equal(flat(T.rp(2500000)), 'Rp 2.500.000')
  assert.equal(flat(T.rp('abc')), 'Rp 0')
  assert.equal(T.pct(12.345), '+12,3%')
  assert.equal(T.pct(-5), '−5%')
  assert.equal(T.pct(0), '0%')
  assert.equal(T.pct(null), '—')
  assert.equal(T.pct(Infinity), '—')
  assert.equal(T.pctPlain(26.824), '26,8%')
  assert.equal(T.fmtJobs(0.456), '0,46')
  assert.equal(T.fmtJobs(4.56), '4,6')
  assert.equal(T.fmtJobs(45.6), '46')
  assert.equal(T.fmtJobs(null), '—')
})

/* ------------------------------------------------------- growth target */

test('growthTier boundaries (1–2% UKM, 5–10% enterprise)', () => {
  assert.equal(T.growthTier(0).tone, 'neutral')
  assert.equal(T.growthTier(NaN).tone, 'neutral')
  assert.equal(T.growthTier(1).tone, 'ok')
  assert.equal(T.growthTier(2).tone, 'ok')
  assert.equal(T.growthTier(2.5).tone, 'brand')
  assert.equal(T.growthTier(5).tone, 'warn')
  assert.equal(T.growthTier(10).tone, 'warn')
  assert.equal(T.growthTier(10.5).tone, 'danger')
  assert.match(T.growthTier(2).label, /1–2% per bulan/)
})

test('growthProjection: compound monthly growth with job counts', () => {
  const p = T.growthProjection({ base: 10000000, pct: 2, avgJob: 500000 })
  assert.equal(p.series.length, 13)
  assert.equal(p.series[0].revenue, 10000000)
  close(p.series[12].revenue, 10000000 * 1.02 ** 12)
  assert.deepEqual(p.rows.map((r) => r.month), [3, 6, 12])
  close(p.rows[0].revenue, 10000000 * 1.02 ** 3)
  close(p.rows[0].delta, 10000000 * (1.02 ** 3 - 1))
  close(p.rows[2].jobs, (10000000 * 1.02 ** 12) / 500000)
  close(p.annualPct, (1.02 ** 12 - 1) * 100)
  assert.equal(T.pctPlain(p.annualPct), '26,8%')
  close(p.nextMonthExtraJobs, 0.4) // 2% of 10 jt = 200 rb = 0,4 pekerjaan
  assert.equal(p.baseJobs, 20)
  let cum = 0
  for (let m = 1; m <= 12; m++) cum += 10000000 * (1.02 ** m - 1)
  close(p.cumulativeExtra, cum, 1e-3)
})

test('growthProjection: no average job -> job fields are null; bad input -> zeros', () => {
  const p = T.growthProjection({ base: 1000000, pct: 5 })
  assert.equal(p.baseJobs, null)
  assert.equal(p.rows[0].jobs, null)
  assert.equal(p.nextMonthExtraJobs, null)
  const z = T.growthProjection({ base: -5, pct: 'x' })
  assert.equal(z.base, 0)
  assert.equal(z.pct, 0)
  assert.equal(z.annualPct, 0)
  assert.deepEqual(T.growthProjection({ base: 1, pct: 1, horizon: 6 }).rows.map((r) => r.month), [3, 6])
})

test('projectionToContext quotes the calculator numbers', () => {
  const txt = flat(T.projectionToContext(T.growthProjection({ base: 10000000, pct: 2, avgJob: 500000 })))
  assert.match(txt, /^\[KALKULATOR TARGET — kalkulator/)
  assert.match(txt, /Target pertumbuhan: 2% per bulan \(setara 26,8% per tahun\); pendapatan dasar Rp 10\.000\.000 per bulan; rata-rata nilai pekerjaan Rp 500\.000/)
  assert.match(txt, /Bulan depan saja: tambahan Rp 200\.000 atau ±0,4 pekerjaan\./)
  const none = T.projectionToContext(T.growthProjection({ base: 0, pct: 2 }), { source: 'pertanyaan' })
  assert.match(none, /pendapatan dasar belum ada/)
  assert.match(none, /pertanyaan/)
})

test('parseTargetPct finds "2%", "1,5 persen"; ignores out of range', () => {
  assert.equal(T.parseTargetPct('Bagaimana naik 2% bulan depan?'), 2)
  assert.equal(T.parseTargetPct('target 1,5 persen'), 1.5)
  assert.equal(T.parseTargetPct('tumbuh 10.25 %'), 10.25)
  assert.equal(T.parseTargetPct('naik 0%'), null)
  assert.equal(T.parseTargetPct('naik 150%'), null)
  assert.equal(T.parseTargetPct('naik dua kali'), null)
  assert.deepEqual(T.GROWTH_PRESETS, [1, 2, 5, 10])
})

/* ------------------------------------------------------------- snapshot */

const flow = buildModel(rawFlow())
const s = T.buildSnapshot(flow, NOW)

test('buildSnapshot: months window (5 full + current partial)', () => {
  assert.equal(s.months.length, 6)
  assert.deepEqual(s.months.map((x) => x.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  assert.equal(s.current.partial, true)
  assert.equal(s.lastFull.key, '2026-09')
  assert.equal(s.lastFull.revenue, 4000000)
  assert.equal(s.lastFull.cost, 300000)
  assert.equal(s.lastFull.jobs, 2)
  assert.equal(s.prevFull.revenue, 2000000)
  assert.equal(s.momGrowth, 100)
  assert.equal(s.current.revenue, 1500000)
  assert.equal(s.cmgr, null) // only 1 month span between first revenue month and last full month
})

test('buildSnapshot: rolling 30-day windows and run rate', () => {
  assert.equal(s.last30.revenue, 2500000) // 20 Sep + 5 Oct
  assert.equal(s.prev30.revenue, 3000000) // 12 Sep
  close(s.growth30, ((2500000 - 3000000) / 3000000) * 100)
  close(s.runRate, (1500000 / 15) * 31)
})

test('buildSnapshot: totals, average job, margin, base', () => {
  assert.deepEqual(s.all, { revenue: 7500000, cost: 800000, profit: 6700000 })
  assert.equal(s.allJobs, 4)
  assert.equal(s.avgJob, 1875000)
  close(s.margin, (6700000 / 7500000) * 100)
  assert.equal(s.base.revenue, 4000000)
  assert.match(s.base.label, /^bulan lalu \(September 2026\)$/)
})

test('buildSnapshot: funnel conversion', () => {
  const c = s.conversion
  assert.equal(c.requests, 10)
  close(c.requestToOffer, 90)
  close(c.offerApproved, (7 / 9) * 100)
  close(c.approvedToAssigned, (6 / 7) * 100)
  close(c.assignedToDone, (5 / 6) * 100)
  close(c.doneToBooked, 80)
  close(s.avgOffer, (2000000 + 3000000 + 1000000 + 800000 + 600000 + 700000 + 1500000) / 7)
})

test('buildSnapshot: pending work matches data.js queues', () => {
  assert.deepEqual(s.pending, {
    requestsWithoutOffer: 1, draftOffers: 1, draftValue: 5000000,
    approvedWithoutAssignment: 1, activeAssignments: 1, completionsWithoutLedger: 1,
  })
})

test('buildSnapshot: service mix, demand, cost mix, repeat customers', () => {
  assert.equal(s.services[0].name, 'Servis AC')
  assert.equal(s.services[0].revenue, 6500000)
  close(s.services[0].share, (6.5 / 7.5) * 100)
  assert.deepEqual(s.demand[0], { name: 'Servis AC', requests: 6 })
  assert.deepEqual(s.costMix.map((x) => x.category), ['biaya_tenaga', 'biaya_bahan'])
  assert.equal(s.costMix[0].label, 'Biaya tenaga kerja')
  assert.deepEqual(s.repeat, { customers: 8, returning: 1 }) // 'PT Maju' and 'pt  maju ' are one customer
})

test('buildSnapshot: top customers group the same customer across spellings', () => {
  assert.equal(s.customers[0].name.toLowerCase().trim(), 'pt maju')
  assert.equal(s.customers[0].revenue, 6500000)
})

test('buildSnapshot: empty account says "belum ada data"', () => {
  const e = T.buildSnapshot(buildModel({}), NOW)
  assert.equal(e.hasData, false)
  assert.equal(e.hasLedger, false)
  assert.equal(e.base.revenue, 0)
  assert.equal(e.momGrowth, null)
  const ctx = T.snapshotToContext(e)
  assert.match(ctx, /belum ada data/)
  assert.equal(ctx.split('\n').length, 3)
})

test('buildSnapshot: base falls back to 30 days, then to total', () => {
  const lastWeek = new Date(NOW.getTime() - 3 * 86400000).toISOString()
  const recent = buildModel({ ledger_entries: [{ id: 1, completion_id: 1, category: 'pendapatan', amount: 900000, posted_at: lastWeek }] })
  const r = T.buildSnapshot(recent, NOW)
  assert.equal(r.base.label, '30 hari terakhir')
  const old = buildModel({ ledger_entries: [{ id: 1, completion_id: 1, category: 'pendapatan', amount: 900000, posted_at: '2025-01-01T00:00:00Z' }] })
  assert.equal(T.buildSnapshot(old, NOW).base.label, 'total tercatat')
})

test('buildSnapshot: entries with invalid dates are ignored', () => {
  const x = buildModel({ ledger_entries: [{ id: 1, category: 'pendapatan', amount: 1, posted_at: 'bukan tanggal' }] })
  assert.equal(T.buildSnapshot(x, NOW).hasLedger, false)
})

test('snapshotToContext: grounding text carries the real numbers', () => {
  const ctx = flat(T.snapshotToContext(s))
  assert.match(ctx, /^\[DATA BISNIS PENGGUNA/)
  assert.match(ctx, /Tanggal hari ini: 15 Oktober 2026/)
  assert.match(ctx, /Jumlah data: 10 permintaan, 9 penawaran, 6 penugasan, 5 penyelesaian, 6 jurnal\./)
  assert.match(ctx, /- September 2026: Rp 4\.000\.000 \/ Rp 300\.000 \/ Rp 3\.700\.000 \/ 2 pekerjaan; pendapatan \+100% vs bulan sebelumnya/)
  assert.match(ctx, /- Oktober 2026 \(berjalan\)/)
  assert.doesNotMatch(ctx, /Mei 2026/) // months without entries are skipped
  assert.match(ctx, /Pertumbuhan bulan ke bulan \(Agustus 2026 ke September 2026\): \+100%/)
  assert.match(ctx, /Rata-rata nilai pekerjaan: Rp 1\.875\.000 \(4 pekerjaan terbukukan\)/)
  assert.match(ctx, /Pekerjaan tertunda: 1 permintaan belum ditawar, 1 draf penawaran senilai Rp 5\.000\.000/)
  assert.match(ctx, /Pelanggan berulang: 1 dari 8 pelanggan/)
})

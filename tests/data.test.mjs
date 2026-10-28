// Unit tests: src/stages/data.js (joined flow model, work queues, totals, helpers). FR-013..FR-017.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureEvents } from './helpers/setup.mjs'
import { rawFlow } from './helpers/fixtures.mjs'

const D = await import('../src/stages/data.js')
const m = D.buildModel(rawFlow())

test('buildModel: empty input is safe', () => {
  const e = D.buildModel({})
  assert.deepEqual([e.requests, e.offers, e.assignments, e.completions, e.ledger].map((x) => x.length), [0, 0, 0, 0, 0])
  assert.equal(e.request(1), null)
  assert.deepEqual(e.offersOf(1), [])
  assert.equal(e.requestOfLedger(null), null)
  assert.deepEqual(e.draftOffers(), [])
})

test('buildModel: lookups tolerate number/string ids', () => {
  assert.equal(m.request('1').customer_name, 'PT Maju')
  assert.equal(m.offer(11).request_id, 1)
  assert.equal(m.offersOf('3').length, 1)
  const mixed = D.buildModel({ requests: [{ id: '7' }], offers: [{ id: 1, request_id: 7 }] })
  assert.equal(mixed.offersOf(7).length, 1)
  assert.equal(mixed.requestOfOffer(mixed.offers[0]).id, '7')
})

test('buildModel: walks up the chain from ledger to request', () => {
  const l = m.ledger.find((x) => x.id === 46)
  assert.equal(m.requestOfLedger(l).id, 10)
  const c = m.completion(33)
  assert.equal(m.assignmentOfCompletion(c).id, 23)
  assert.equal(m.offerOfCompletion(c).id, 13)
  assert.equal(m.requestOfCompletion(c).customer_name, 'Bu Sari')
  assert.equal(m.requestOfAssignment(m.assignment(24)).id, 4)
})

test('requestStage: one key per stage', () => {
  const stage = (id) => m.requestStage(m.request(id))
  assert.deepEqual(stage(1), { key: 'booked', label: 'Terbukukan', tone: 'ok' })
  assert.equal(stage(9).key, 'done')
  assert.equal(stage(4).key, 'assigned')
  assert.equal(stage(5).key, 'offered')
  assert.equal(stage(6).key, 'draft')
  assert.deepEqual(stage(7), { key: 'rejected', label: 'Ditolak', tone: 'danger' })
  assert.deepEqual(stage(8), { key: 'new', label: 'Baru', tone: 'neutral' })
})

test('requestStage: one rejected + one draft offer is still a draft', () => {
  const x = D.buildModel({ requests: [{ id: 1 }], offers: [{ id: 1, request_id: 1, status: 'rejected' }, { id: 2, request_id: 1, status: 'draft' }] })
  assert.equal(x.requestStage(x.requests[0]).key, 'draft')
})

test('work queues ("Perlu tindakan")', () => {
  assert.deepEqual(m.requestsWithoutOffer().map((r) => r.id), [8])
  // rejected offers are not drafts (fixed in 03707b0; spec A2)
  assert.deepEqual(m.draftOffers().map((o) => o.id), [16])
  assert.deepEqual(m.approvedWithoutAssignment().map((o) => o.id), [15])
  assert.deepEqual(m.activeAssignments().map((a) => a.id), [24])
  assert.deepEqual(m.completionsWithoutLedger().map((c) => c.id), [39])
})

test('draftOffers counts pending_approval', () => {
  const x = D.buildModel({ offers: [{ id: 1, status: 'pending_approval' }, { id: 2, status: 'approved' }, { id: 3 }] })
  assert.deepEqual(x.draftOffers().map((o) => o.id), [1, 3])
})

test('totals: pendapatan is revenue, every other category is cost', () => {
  assert.deepEqual(D.totals(m.ledger), { revenue: 7500000, cost: 800000, profit: 6700000 })
  assert.deepEqual(D.totals([]), { revenue: 0, cost: 0, profit: 0 })
  assert.deepEqual(D.totals([{ category: 'pendapatan', amount: '1000' }, { category: 'biaya_lain', amount: 'abc' }]), { revenue: 1000, cost: 0, profit: 1000 })
})

test('isRevenue / ledgerDate / categoryLabel', () => {
  assert.equal(D.isRevenue({ category: 'pendapatan' }), true)
  assert.equal(D.isRevenue({ category: 'biaya_tenaga' }), false)
  assert.equal(D.ledgerDate({ posted_at: 'a', created_at: 'b' }), 'a')
  assert.equal(D.ledgerDate({ created_at: 'b' }), 'b')
  assert.equal(D.categoryLabel('biaya_bahan'), 'Biaya bahan / material')
  assert.equal(D.categoryLabel('biaya_marketing'), 'biaya marketing')
  assert.equal(D.categoryLabel(null), '—')
  assert.equal(D.LEDGER_CATEGORIES.length, 5)
})

test('customerKey: case, outer and inner whitespace are ignored', () => {
  assert.equal(D.customerKey({ customer_name: 'PT Maju' }), D.customerKey({ customer_name: 'pt  maju ' }))
  assert.equal(D.customerKey({ customer_name: '   ' }), 'x')
  assert.equal(D.customerKey(null), 'x')
})

test('customerLabel falls back', () => {
  assert.equal(D.customerLabel({ customer_name: 'A' }), 'A')
  assert.equal(D.customerLabel(null), 'Pelanggan tidak dikenal')
})

test('localDate uses local calendar date (not UTC) — spec A5', () => {
  const prev = process.env.TZ
  try {
    process.env.TZ = 'Asia/Jakarta'
    // 1 Sep 2026 00:30 WIB is still 31 Aug in UTC
    assert.equal(D.localDate('2026-08-31T17:30:00Z'), '2026-09-01')
    assert.equal(new Date('2026-08-31T17:30:00Z').toISOString().slice(0, 10), '2026-08-31')
    assert.equal(D.localDate(new Date(2026, 0, 5)), '2026-01-05')
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
})

test('notifyDataChanged dispatches satualur:data-changed', () => {
  const cap = captureEvents('satualur:data-changed')
  D.notifyDataChanged()
  cap.stop()
  assert.equal(cap.events.length, 1)
})

test('TABLES lists the five flow tables', () => {
  assert.deepEqual(D.TABLES, ['requests', 'offers', 'assignments', 'completions', 'ledger_entries'])
})

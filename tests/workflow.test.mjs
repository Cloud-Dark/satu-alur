// Unit tests: src/domain/workflow.js (one row per job, request -> bookkeeping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rawFlow, NOW } from './helpers/fixtures.mjs'

const D = await import('../src/stages/data.js')
const W = await import('../src/domain/workflow.js')
const m = D.buildModel(rawFlow())
const rows = W.workflowRows(m, { now: NOW.getTime() })
const row = (id) => rows.find((r) => r.id === id)

test('one row per request', () => {
  assert.equal(rows.length, m.requests.length)
})

test('position follows the furthest step of each job', () => {
  assert.deepEqual([1, 9, 4, 5, 6, 7, 8].map((id) => row(id).key), ['booked', 'completed', 'working', 'approved', 'draft', 'rejected', 'new'])
  assert.deepEqual([1, 9, 4, 5, 6, 8].map((id) => row(id).step), [4, 3, 2, 1, 1, 0])
  assert.equal(row(1).done, true)
  assert.equal(row(4).worker, 'Tim A')
  assert.equal(row(5).price, 600000)
})

test('next action opens the right stage with the right id', () => {
  assert.deepEqual(row(8).next, { label: 'Buat penawaran', stage: 'offer', params: { requestId: 8 } })
  assert.deepEqual(row(6).next, { label: 'Tinjau penawaran', stage: 'offer', params: { offerId: 16 } })
  assert.equal(row(7).next.params.requestId, 7)
  assert.deepEqual(row(5).next, { label: 'Tugaskan petugas', stage: 'assign', params: { offerId: 15 } })
  assert.deepEqual(row(4).next, { label: 'Tandai selesai', stage: 'complete', params: { assignmentId: 24 } })
  assert.deepEqual(row(9).next, { label: 'Bukukan', stage: 'bookkeeping', params: { completionId: 39 } })
  assert.equal(row(1).next.stage, 'invoice')
  assert.equal(row(1).next.optional, true)
})

test('a request with a rejected and an approved offer follows the approved one', () => {
  const x = D.buildModel({
    requests: [{ id: 1 }],
    offers: [{ id: 1, request_id: 1, status: 'approved', created_at: '2026-01-01' }, { id: 2, request_id: 1, status: 'rejected', created_at: '2026-02-01' }],
  })
  const [r] = W.workflowRows(x)
  assert.equal(r.key, 'approved')
  assert.equal(r.offer.id, 1)
  assert.equal(r.offers, 2)
})

test('invoices: linked by completion, cancelled ones ignored', () => {
  const withInv = W.workflowRows(m, { invoices: [{ id: 1, completion_id: 31, status: 'batal' }, { id: 2, completion_id: 31, status: 'lunas', created_at: '2026-10-01' }] })
  const r = withInv.find((x) => x.id === 1)
  assert.equal(r.invoice.id, 2)
  assert.equal(r.next.label, 'Lihat invoice')
  const none = W.workflowRows(m, { invoices: [{ id: 1, completion_id: 31, status: 'batal' }] }).find((x) => x.id === 1)
  assert.equal(none.invoice, null)
})

test('filter counts add up and search matches customer, service and number', () => {
  const c = W.filterCounts(rows)
  assert.equal(c.all, rows.length)
  assert.equal(c.request + c.offer + c.assign + c.work + c.book + c.done, rows.length)
  assert.equal(c.offer, 2)
  assert.ok(W.matchesQuery(row(3), 'sari'))
  assert.ok(W.matchesQuery(row(3), '#3'))
  assert.ok(W.matchesQuery(row(3), 'cuci'))
  assert.ok(!W.matchesQuery(row(3), 'hotel'))
})

test('timeline marks done, current and todo steps', () => {
  const states = (id) => W.timeline(row(id)).items.map((i) => i.state)
  assert.deepEqual(states(1), ['done', 'done', 'done', 'done', 'done'])
  assert.deepEqual(states(8), ['done', 'current', 'todo', 'todo', 'todo'])
  assert.deepEqual(states(5), ['done', 'done', 'current', 'todo', 'todo'])
  assert.deepEqual(states(4), ['done', 'done', 'done', 'current', 'todo'])
  assert.deepEqual(states(9), ['done', 'done', 'done', 'done', 'current'])
  assert.deepEqual(states(6), ['done', 'current', 'todo', 'todo', 'todo'])
  const t = W.timeline(row(1)).items[4]
  assert.equal(t.revenue, 2000000)
  assert.equal(t.cost, 500000)
})

// Money and flow rules: positive ledger amounts, one revenue entry per
// completion, one completion per assignment, no unfiltered update/delete.
// The mock mirrors worker/index.js, so these also pin the Worker's contract.
import './helpers/setup.mjs'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { createMockWorkBuddyCloud } = await import('../src/mock/mock-cloud.js')
const { LEDGER_CATEGORIES } = await import('../src/stages/data.js')

// The mock seeds demo rows on creation; ids from 900000 up never collide with them.
let db
let nextId = 900000
const fresh = () => ++nextId
let cid
beforeEach(() => {
  db = createMockWorkBuddyCloud().database
  cid = fresh()
})

const ledger = (row) => db.from('ledger_entries').insert({ completion_id: cid, status: 'posted', ...row })

test('ledger: zero and negative amounts are rejected', async () => {
  for (const amount of [0, -1000000, 'abc']) {
    const { error } = await ledger({ category: 'biaya_bahan', amount })
    assert.match(error?.message || '', /lebih dari nol/, `amount ${amount}`)
  }
})

test('ledger: unknown category is rejected', async () => {
  const { error } = await ledger({ category: 'bonus', amount: 1000 })
  assert.match(error?.message || '', /Kategori/)
})

test('ledger: revenue can be posted once per completion, costs many times', async () => {
  assert.equal((await ledger({ category: 'pendapatan', amount: 1000000 })).error, null)
  const dup = await ledger({ category: 'pendapatan', amount: 1000000 })
  assert.match(dup.error?.message || '', /sudah diposting/)
  assert.equal((await ledger({ category: 'biaya_tenaga', amount: 200000 })).error, null)
  assert.equal((await ledger({ category: 'biaya_tenaga', amount: 50000 })).error, null)
  assert.equal((await ledger({ category: 'pendapatan', amount: 500000, completion_id: fresh() })).error, null)
})

test('ledger: duplicate revenue inside one batch is rejected', async () => {
  const { error } = await db.from('ledger_entries').insert([
    { completion_id: cid, category: 'pendapatan', amount: 1 },
    { completion_id: cid, category: 'pendapatan', amount: 1 },
  ])
  assert.match(error?.message || '', /sudah diposting/)
})

test('completions: an assignment can be completed once', async () => {
  const aid = fresh()
  const first = await db.from('completions').insert({ assignment_id: aid, status: 'done' })
  assert.equal(first.error, null)
  const again = await db.from('completions').insert({ assignment_id: aid, status: 'done' })
  assert.match(again.error?.message || '', /sudah ditandai selesai/)
})

test('update and delete without a filter are refused', async () => {
  const aid = fresh()
  await db.from('completions').insert({ assignment_id: aid, status: 'done' })
  const before = (await db.from('completions').select('*')).data.length
  const upd = await db.from('completions').update({ status: 'x' })
  assert.match(upd.error?.message || '', /Filter diperlukan/)
  const del = await db.from('completions').delete()
  assert.match(del.error?.message || '', /Filter diperlukan/)
  const { data } = await db.from('completions').select('*')
  assert.equal(data.length, before)
  assert.ok(data.every((c) => c.status !== 'x'))
})

test('worker, mock and UI agree on ledger categories', async () => {
  const ui = LEDGER_CATEGORIES.map((c) => c.value).sort()
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  const mock = await readFile(new URL('../src/mock/mock-cloud.js', import.meta.url), 'utf8')
  const list = (src, re) => [...src.match(re)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(list(worker, /LEDGER_CATEGORY_SET = new Set\(\[([^\]]+)\]/), ui)
  assert.deepEqual(list(mock, /const LEDGER_CATEGORIES = \[([^\]]+)\]/), ui)
  assert.match(worker, /await assertFlowRules\(env, table, rows, uid, \{ action: 'insert' \}\)/)
})

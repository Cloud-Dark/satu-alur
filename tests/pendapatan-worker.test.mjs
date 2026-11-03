// Worker contract for the two Pendapatan tables: the columns /api/db accepts,
// and the rules handleDb enforces on top of the D1 CHECK constraints.
// Uses a scripted fake D1 — the real SQL is exercised by `npm run db:migrate:local`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

const { TABLES, assertFlowRules } = await import('../worker/index.js')

function fakeEnv({ count = 0, current = null } = {}) {
  const stmt = (sql) => ({
    sql,
    args: [],
    bind(...a) { this.args = a; return this },
    async first() { return /COUNT\(\*\)/.test(sql) ? { n: count } : current },
  })
  return { DB: { prepare: stmt } }
}

const rejects = (p, status, pattern) => assert.rejects(p, (e) => {
  assert.equal(e.status, status)
  assert.match(e.message, pattern)
  return true
})

/* -------------------------------------------------------------- Contract */

test('both tables are whitelisted with every column the stages write', () => {
  assert.ok(TABLES.vas_items, 'vas_items missing from TABLES')
  for (const col of ['name', 'category', 'price', 'cost', 'attach_to', 'attach_rate', 'description', 'status', 'created_at', 'updated_at']) {
    assert.ok(TABLES.vas_items.columns.includes(col), `vas_items.${col}`)
  }
  assert.ok(TABLES.waste_entries, 'waste_entries missing from TABLES')
  for (const col of ['stream', 'title', 'detail', 'monthly_loss', 'saved', 'action', 'owner', 'status', 'created_at', 'updated_at']) {
    assert.ok(TABLES.waste_entries.columns.includes(col), `waste_entries.${col}`)
  }
  assert.ok(TABLES.ledger_entries.columns.includes('vas_item_id'), 'ledger_entries.vas_item_id')
  assert.equal(TABLES.ledger_entries.fks.vas_item_id, 'vas_items')
})

/* ----------------------------------------------------------------- VAS */

test('inserting a VAS row normalises it in place', async () => {
  const row = { name: '  Perawatan   AC ', price: 'Rp 450.000', cost: '', attach_rate: '30', category: 'perawatan', status: 'active' }
  await assertFlowRules(fakeEnv(), 'vas_items', [row], 'u1', { action: 'insert' })
  assert.equal(row.name, 'Perawatan AC')
  assert.equal(row.price, 450000)
  assert.equal(row.cost, 0)
  assert.equal(row.attach_rate, 30)
})

test('a bad VAS row is a 400, not a 500', async () => {
  await rejects(
    assertFlowRules(fakeEnv(), 'vas_items', [{ name: 'A', price: 1000 }], 'u1', { action: 'insert' }),
    400, /minimal 2 karakter/,
  )
  await rejects(
    assertFlowRules(fakeEnv(), 'vas_items', [{ name: 'Cuci karpet', price: 1000, category: 'ajaib' }], 'u1', { action: 'insert' }),
    400, /Kategori/,
  )
})

test('the per-owner catalog ceiling is enforced before writing', async () => {
  await rejects(
    assertFlowRules(fakeEnv({ count: 500 }), 'vas_items', [{ name: 'Item baru', price: 1000 }], 'u1', { action: 'insert' }),
    400, /Batas 500 item katalog/,
  )
})

/* --------------------------------------------------------------- Waste */

test('a waste insert defaults saved to 0 and keeps the row', async () => {
  const row = { stream: 'perjalanan', title: 'Rute tidak diurutkan', monthly_loss: '900000' }
  await assertFlowRules(fakeEnv(), 'waste_entries', [row], 'u1', { action: 'insert' })
  assert.equal(row.monthly_loss, 900000)
  assert.equal(row.saved, 0)
  assert.equal(row.status, 'open')
})

test('an insert with saved above the loss is refused', async () => {
  await rejects(
    assertFlowRules(fakeEnv(), 'waste_entries', [{ stream: 'waktu', title: 'Menunggu bahan', monthly_loss: 100000, saved: 200000 }], 'u1', { action: 'insert' }),
    400, /melebihi kerugian/,
  )
})

test('closing a finding writes the whole loss into saved', async () => {
  const current = { id: 1, owner_id: 'u1', stream: 'bahan', title: 'Dosis berlebih', monthly_loss: 180000, saved: 0, status: 'progress' }
  const changes = { status: 'done' }
  await assertFlowRules(fakeEnv({ current }), 'waste_entries', [changes], 'u1', { action: 'update', filters: [{ op: 'eq', col: 'id', val: 1 }] })
  assert.equal(changes.saved, 180000)
  assert.equal(changes.status, 'done')
})

test('lowering the loss of a done finding lowers saved with it', async () => {
  const current = { id: 1, owner_id: 'u1', stream: 'waktu', title: 'Menunggu', monthly_loss: 500000, saved: 500000, status: 'done' }
  const changes = { monthly_loss: 300000 }
  await assertFlowRules(fakeEnv({ current }), 'waste_entries', [changes], 'u1', { action: 'update', filters: [{ op: 'eq', col: 'id', val: 1 }] })
  assert.equal(changes.saved, 300000)
})

test('an update that would break saved <= loss is refused', async () => {
  const current = { id: 1, owner_id: 'u1', stream: 'waktu', title: 'Menunggu', monthly_loss: 500000, saved: 400000, status: 'progress' }
  await rejects(
    assertFlowRules(fakeEnv({ current }), 'waste_entries', [{ monthly_loss: 100000 }], 'u1', { action: 'update', filters: [{ op: 'eq', col: 'id', val: 1 }] }),
    400, /melebihi kerugian/,
  )
})

test('a partial update is not forced to re-declare every column', async () => {
  const current = { id: 1, owner_id: 'u1', stream: 'waktu', title: 'Menunggu', monthly_loss: 500000, saved: 0, status: 'open' }
  const changes = { owner: 'Tim Operasional' }
  await assertFlowRules(fakeEnv({ current }), 'waste_entries', [changes], 'u1', { action: 'update', filters: [{ op: 'eq', col: 'id', val: 1 }] })
  assert.deepEqual(Object.keys(changes), ['owner'])
})

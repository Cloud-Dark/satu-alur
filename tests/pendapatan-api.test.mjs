// Exercise the real Worker and migrations with SQLite, without external services.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import worker from '../worker/index.js'

test('Pendapatan API: migrated SQL, updates, ownership and invariants', async (t) => {
  const { DatabaseSync } = await import('node:sqlite').catch(() => ({}))
  if (!DatabaseSync) return t.skip('SQLite integration requires Node 22.13+')
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(await readFile(new URL(name, dir), 'utf8'))
  }
  const prepare = (sql) => ({
    args: [],
    bind(...args) { this.args = args; return this },
    async first() { return sqlite.prepare(sql).get(...this.args) ?? null },
    async run() { return { results: sqlite.prepare(sql).all(...this.args) } },
  })
  const env = { DB: {
    prepare,
    async batch(stmts) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const stmt of stmts) results.push(await stmt.run())
        sqlite.exec('COMMIT')
        return results
      } catch (err) { sqlite.exec('ROLLBACK'); throw err }
    },
  } }
  for (const uid of ['alice', 'bob']) {
    sqlite.prepare('INSERT INTO users(id, email) VALUES (?, ?)').run(uid, `${uid}@example.com`)
    sqlite.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(createHash('sha256').update(uid.repeat(8)).digest('hex'), uid, '2099-01-01T00:00:00Z')
  }
  async function call(uid, body, expected = 200) {
    const response = await worker.fetch(new Request('https://local.test/api/db', {
      method: 'POST', headers: { authorization: `Bearer ${uid.repeat(8)}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env)
    const result = await response.json()
    assert.equal(response.status, expected, JSON.stringify(result))
    return result.data
  }
  const filter = (id) => [{ op: 'eq', col: 'id', val: id }]
  const [item] = await call('alice', { table: 'vas_items', action: 'insert', values: { name: 'Perawatan AC', price: 'Rp 450.000' } })
  const [updated] = await call('alice', { table: 'vas_items', action: 'update', filters: filter(item.id), changes: { cost: 100000 } })
  assert.equal(updated.cost, 100000)
  assert.ok(updated.updated_at)
  assert.deepEqual(await call('bob', { table: 'vas_items', action: 'select' }), [])
  assert.deepEqual(await call('bob', { table: 'vas_items', action: 'update', filters: filter(item.id), changes: { price: 1 } }), [])
  const [request] = await call('alice', { table: 'requests', action: 'insert', values: { customer_name: 'Pelanggan', service_type: 'AC' } })
  const [offer] = await call('alice', { table: 'offers', action: 'insert', values: { request_id: request.id } })
  const [assignment] = await call('alice', { table: 'assignments', action: 'insert', values: { offer_id: offer.id } })
  const [completion] = await call('alice', { table: 'completions', action: 'insert', values: { assignment_id: assignment.id } })
  await call('bob', { table: 'ledger_entries', action: 'insert', values: { vas_item_id: item.id, category: 'pendapatan', amount: 5000 } }, 400)
  const [posting] = await call('alice', { table: 'ledger_entries', action: 'insert', values: { completion_id: completion.id, vas_item_id: item.id, category: 'pendapatan', amount: 5000 } })
  assert.equal(posting.vas_item_id, item.id)

  const [finding] = await call('alice', { table: 'waste_entries', action: 'insert', values: { title: 'Bahan terbuang', stream: 'bahan', monthly_loss: 100000 } })
  const [closed] = await call('alice', { table: 'waste_entries', action: 'update', filters: filter(finding.id), changes: { status: 'done' } })
  assert.equal(closed.saved, 100000)
  assert.equal(closed.status, 'done')
  const [revised] = await call('alice', { table: 'waste_entries', action: 'update', filters: filter(finding.id), changes: { monthly_loss: 80000 } })
  assert.equal(revised.saved, 80000)
  await call('alice', { table: 'waste_entries', action: 'update', filters: filter(finding.id), changes: { saved: 0 } }, 400)
  await call('alice', { table: 'waste_entries', action: 'update', filters: [{ op: 'eq', col: 'stream', val: 'bahan' }], changes: { status: 'done' } }, 400)
  assert.deepEqual(await call('bob', { table: 'waste_entries', action: 'select' }), [])
  assert.deepEqual(await call('bob', { table: 'waste_entries', action: 'delete', filters: filter(finding.id) }), [])
  assert.throws(() => sqlite.prepare('UPDATE waste_entries SET saved = 0 WHERE id = ?').run(finding.id), /CHECK constraint/)
  await call('alice', { table: 'vas_items', action: 'insert', values: { name: 'Invalid cost', price: 100, cost: '-50' } }, 400)
})

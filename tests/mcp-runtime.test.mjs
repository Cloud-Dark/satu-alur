// Verify D1 batch semantics in workerd, including last_insert_rowid and WITHOUT ROWID.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('workerd/D1 migration writes, repeat sync, dry run and isolated rollback', { skip: process.env.MCP_RUNTIME_TEST !== '1', timeout: 60000 }, async (t) => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../worker/index.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser' })
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2025-09-01',
    d1Databases: ['DB'],
    bindings: { MCP_ENCRYPTION_KEY: 'runtime-test-key-only-32-characters' },
  }))
  t.after(() => runtime.dispose())
  const db = await runtime.getD1Database('DB')
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, dir), 'utf8')
    // shortcut: these migrations have no triggers or semicolons in literals; use a SQL parser if that changes.
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean)
    await db.batch(statements.map((s) => db.prepare(s)))
  }
  await db.prepare('INSERT INTO users(id, email) VALUES (?, ?)').bind('alice', 'alice@example.com').run()
  await db.prepare("INSERT INTO user_flags(user_id, plan, updated_at) VALUES ('alice', 'enterprise', '2026-11-02')").run()
  const token = 'runtime-test-token'
  await db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(createHash('sha256').update(token).digest('hex'), 'alice', '2099-01-01T00:00:00Z').run()
  async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await runtime.dispatchFetch(`https://local.test/api/mcp/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = await response.json()
    assert.ok(response.ok, JSON.stringify(json))
    return json.data
  }
  const conn = await call('connectors', { name: 'Runtime file import', type: 'file', enabled: true, config: { format: 'csv' } })
  await call(`connectors/${conn.id}/mappings`, { entity: 'workers', mode: 'upsert', externalIdField: 'id', fields: [{ source: 'name', target: 'name' }] }, 'PUT')
  const existing = await call(`connectors/${conn.id}/sync`, { entity: 'workers', rows: [{ id: 'old', name: 'Existing' }] })
  assert.equal(existing.stats.inserted, 1)
  const mig = await call('migrations', { name: 'Runtime migration', connectorId: conn.id, phases: ['master'] })
  const body = { rowsByEntity: { workers: [{ id: 'old', name: 'Updated existing' }, { id: 'new', name: 'New worker' }] } }
  await call(`migrations/${mig.id}/run`, { ...body, dryRun: true })
  assert.equal((await call(`migrations/${mig.id}`)).status, 'draft')
  const run = await call(`migrations/${mig.id}/run`, body)
  assert.equal(run.stats.inserted, 1)
  assert.equal(run.stats.updated, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mcp_migration_rows').first()).n, 1)
  const rollback = await call(`migrations/${mig.id}/rollback`, {})
  assert.deepEqual(rollback, { rolledBack: true, removedRows: 1, retainedRows: 0 })
  const { results } = await db.prepare('SELECT name FROM workers').all()
  assert.deepEqual(results.map((r) => r.name), ['Updated existing'])
})

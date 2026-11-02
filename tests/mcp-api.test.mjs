// Real Worker routes, all SQL migrations, and transactional SQLite. No remote ERP.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import './helpers/setup.mjs'
import worker from '../worker/index.js'
import { sealSecrets, openSecrets } from '../worker/mcp.js'

async function setup(t) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  t.after(() => sqlite.close())
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(await readFile(new URL(name, dir), 'utf8'))
  const prepare = (sql) => ({
    args: [],
    bind(...args) { this.args = args; return this },
    async first() { return sqlite.prepare(sql).get(...this.args) ?? null },
    async all() { return { results: sqlite.prepare(sql).all(...this.args) } },
    async run() {
      const results = sqlite.prepare(sql).all(...this.args)
      return { results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }
    },
  })
  const env = { MCP_ENCRYPTION_KEY: 'test-only-encryption-key-32-bytes', DB: {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (err) { sqlite.exec('ROLLBACK'); throw err }
    },
  } }
  for (const id of ['alice', 'bob', 'sole']) {
    sqlite.prepare('INSERT INTO users(id, email) VALUES (?, ?)').run(id, `${id}@example.com`)
    sqlite.prepare('INSERT INTO user_flags(user_id, plan, updated_at) VALUES (?, ?, ?)').run(id, id === 'sole' ? 'sole' : 'enterprise', '2026-11-02T00:00:00Z')
    sqlite.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(createHash('sha256').update(id.repeat(8)).digest('hex'), id, '2099-01-01T00:00:00Z')
  }
  async function call(path, { method = 'GET', body, uid = 'alice', status = 200, headers = {}, raw } = {}) {
    const response = await worker.fetch(new Request(`https://local.test/api/mcp/${path}`, {
      method, headers: { authorization: `Bearer ${uid.repeat(8)}`, 'content-type': 'application/json', ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }), env)
    const result = await response.json()
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`)
    return status < 400 ? result.data : result.error
  }
  const connector = (extra = {}) => call('connectors', { method: 'POST', status: 201, body: { name: `Import ${Math.random()}`, type: 'file', enabled: true, config: { format: 'csv' }, ...extra } })
  async function mapping(id, entity = 'workers', mode = 'upsert') {
    const fields = entity === 'requests' ? [{ source: 'name', target: 'customer_name' }, { constant: 'AC', target: 'service_type' }] : [{ source: 'name', target: 'name' }]
    return call(`connectors/${id}/mappings`, { method: 'PUT', body: { entity, mode, externalIdField: 'id', fields } })
  }
  async function migration(id) {
    return call('migrations', { method: 'POST', status: 201, body: { name: 'Migrate workers', connectorId: id, phases: ['master'] } })
  }
  return { sqlite, env, call, connector, mapping, migration }
}

test('connector payloads flatten config, encrypt credentials, redact secrets and preserve PATCH state', async (t) => {
  const { sqlite, env, call, connector } = await setup(t)
  const secret = 'private-key-日本語'
  const rest = await connector({ type: 'rest', name: 'REST ERP', config: { endpoint: { baseUrl: 'https://erp.example.com/api' }, auth: { type: 'apikey', apiKey: secret } } })
  assert.equal(rest.config.endpoint.baseUrl, 'https://erp.example.com/api')
  assert.ok(!JSON.stringify(rest).includes(secret))
  const stored = sqlite.prepare('SELECT config_json, secrets_json FROM mcp_connectors WHERE id = ?').get(rest.id)
  assert.ok(!stored.config_json.includes(secret))
  assert.ok(stored.secrets_json.startsWith('v1:'))
  assert.deepEqual(await openSecrets(env, stored.secrets_json), { apiKey: secret })
  const patched = await call(`connectors/${rest.id}`, { method: 'PATCH', body: { name: 'Renamed' } })
  assert.equal(patched.enabled, true)
  assert.equal(patched.config.endpoint.baseUrl, rest.config.endpoint.baseUrl)
  await call(`connectors/${rest.id}`, { method: 'PATCH', body: { type: 'file' }, status: 400 })
  const hook = await connector({ type: 'webhook', name: 'Events', secret: '012345678901234567890' })
  assert.equal((await call(`connectors/${hook.id}`, { method: 'PATCH', body: { enabled: false } })).enabled, false)
  await call(`connectors/${rest.id}`, { uid: 'bob', status: 404 })
  await call('connectors', { uid: 'sole', status: 403 })
  await call(`connectors/${rest.id}`, { method: 'PATCH', body: { config: { auth: { type: 'basic', username: 'operator' } } }, status: 400 })
  const incomplete = await sealSecrets(env, { token: 'wrong-type' })
  sqlite.prepare('UPDATE mcp_connectors SET secrets_json = ? WHERE id = ?').run(incomplete.value, rest.id)
  await call(`connectors/${rest.id}/test`, { method: 'POST', body: {}, status: 503 })
  delete env.MCP_ENCRYPTION_KEY
  await connector() // File imports need no credentials or key.
  await call('connectors', { method: 'POST', body: { name: 'No encryption', type: 'rest', endpoint: { baseUrl: 'https://erp.example.com' }, apiKey: secret }, status: 503 })
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_connectors WHERE name = 'No encryption'").get().n, 0)
  await call(`connectors/${rest.id}/test`, { method: 'POST', body: {}, status: 503 })
  await assert.rejects(openSecrets({}, 'plain:eyJhcGlLZXkiOiJzZWNyZXQifQ=='), /Simpan ulang/)
  await assert.rejects(sealSecrets({ MCP_ENCRYPTION_KEY: 'short' }, { apiKey: secret }), /MCP_ENCRYPTION_KEY/)
})

test('migration dry runs are read-only; rollback isolates insert-only and upsert runs', async (t) => {
  const { sqlite, call, connector, mapping, migration } = await setup(t)
  const conn = await connector()
  await mapping(conn.id)
  await call(`connectors/${conn.id}/sync`, { method: 'POST', body: { entity: 'workers', rows: [{ id: 'existing', name: 'Existing worker' }] } })
  const first = await migration(conn.id)
  const before = sqlite.prepare('SELECT * FROM mcp_migrations WHERE id = ?').get(first.id)
  const preview = await call(`migrations/${first.id}/run`, { method: 'POST', body: { dryRun: true, rowsByEntity: { workers: [{ id: 'preview', name: 'Preview worker' }] } } })
  assert.equal(preview.stats.inserted, 1)
  assert.deepEqual(sqlite.prepare('SELECT * FROM mcp_migrations WHERE id = ?').get(first.id), before)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workers').get().n, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mcp_migration_rows').get().n, 0)
  await call(`migrations/${first.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: [{ id: 'existing', name: 'Updated existing' }, { id: 'a', name: 'From first' }] } } })
  await call(`migrations/${first.id}/run`, { method: 'POST', body: { phaseIndex: 0, rowsByEntity: { workers: [] } }, status: 409 })
  await mapping(conn.id, 'workers', 'insert')
  const second = await migration(conn.id)
  await call(`migrations/${second.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: [{ name: 'From second' }] } } })
  const rollback = await call(`migrations/${first.id}/rollback`, { method: 'POST' })
  assert.deepEqual(rollback, { rolledBack: true, removedRows: 1, retainedRows: 0 })
  assert.deepEqual(sqlite.prepare('SELECT name FROM workers ORDER BY id').all().map((r) => r.name), ['Updated existing', 'From second'])
  assert.equal((await call(`migrations/${second.id}/rollback`, { method: 'POST' })).removedRows, 1)
  assert.equal((await call(`migrations/${second.id}/rollback`, { method: 'POST' })).removedRows, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workers').get().n, 1)
  assert.equal((await call(`migrations/${first.id}`)).stats.inserted, 1, 'rollback preserves audit counters')
})

test('rollback preserves edited and linked rows; ownership and phase locks apply', async (t) => {
  const { sqlite, call, connector, mapping, migration } = await setup(t)
  const conn = await connector()
  await mapping(conn.id)
  const mig = await migration(conn.id)
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: [{ id: 'a', name: 'Original' }, { id: 'b', name: 'Linked worker' }] } } })
  const [a, b] = sqlite.prepare('SELECT id FROM workers ORDER BY id').all()
  sqlite.prepare('UPDATE workers SET lat = 1 WHERE id = ?').run(a.id)
  sqlite.exec("INSERT INTO requests(owner_id, customer_name, service_type) VALUES ('alice', 'Customer', 'AC'); INSERT INTO offers(owner_id, request_id) VALUES ('alice', 1); INSERT INTO assignments(owner_id, offer_id) VALUES ('alice', 1)")
  sqlite.prepare('INSERT INTO assignment_workers(owner_id, assignment_id, worker_id) VALUES (?, ?, ?)').run('alice', 1, b.id)
  await call(`migrations/${mig.id}/rollback`, { uid: 'bob', method: 'POST', status: 404 })
  sqlite.prepare('UPDATE mcp_migrations SET locked = 1 WHERE id = ?').run(mig.id)
  await call(`migrations/${mig.id}/rollback`, { method: 'POST', status: 409 })
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: {}, status: 409 })
  sqlite.prepare('UPDATE mcp_migrations SET locked = 0 WHERE id = ?').run(mig.id)
  assert.deepEqual(await call(`migrations/${mig.id}/rollback`, { method: 'POST' }), { rolledBack: false, removedRows: 0, retainedRows: 2 })
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workers').get().n, 2)
})

test('bad JSON, row limits, unsupported foreign keys and disabled connectors fail safely', async (t) => {
  const { sqlite, call, connector, mapping, migration } = await setup(t)
  const conn = await connector()
  await mapping(conn.id)
  await call(`connectors/${conn.id}/sync`, { method: 'POST', raw: '{', status: 400 })
  await call(`connectors/${conn.id}/sync`, { method: 'POST', body: { rows: {} }, status: 400 })
  await call(`connectors/${conn.id}/sync`, { method: 'POST', body: { rows: Array(501).fill({ name: 'Too many' }) }, status: 400 })
  await call(`connectors/${conn.id}/mappings`, { method: 'PUT', body: { entity: 'offers', fields: [{ source: 'id', target: 'request_id' }] }, status: 400 })
  const mig = await migration(conn.id)
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: {} } }, status: 400 })
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: Array(501).fill({ name: 'Too many' }) } }, status: 400 })
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: {}, status: 400 })
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: { phaseIndex: 'x' }, status: 400 })
  await call(`connectors/${conn.id}`, { method: 'PATCH', body: { enabled: false } })
  await call(`migrations/${mig.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: [{ name: 'No' }] } }, status: 400 })
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workers').get().n, 0)
  assert.equal(sqlite.prepare('SELECT locked FROM mcp_migrations WHERE id = ?').get(mig.id).locked, 0)
})

test('row/ref/journal writes are atomic on failure', async (t) => {
  const { sqlite, call, connector, mapping, migration } = await setup(t)
  const conn = await connector()
  await mapping(conn.id)
  const mig = await migration(conn.id)
  sqlite.exec("CREATE TRIGGER reject_ref BEFORE INSERT ON mcp_external_refs BEGIN SELECT RAISE(ABORT, 'reference failure'); END")
  const run = await call(`migrations/${mig.id}/run`, { method: 'POST', body: { rowsByEntity: { workers: [{ id: 'a', name: 'Must roll back' }] } } })
  assert.equal(run.stats.failed, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workers').get().n, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mcp_migration_rows').get().n, 0)
})

test('signed webhooks enforce body limits, mapping direction and current owner entitlement', async (t) => {
  const { sqlite, call, connector, mapping } = await setup(t)
  const secret = 'signed-webhook-secret-32-chars'
  const hook = await connector({ type: 'webhook', secret })
  await mapping(hook.id)
  const send = (body, status = 200, signature) => {
    const raw = JSON.stringify(body)
    return call(`webhook/${hook.id}`, { method: 'POST', raw, status, headers: { 'x-mcp-signature': signature ?? `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` } })
  }
  await send({ entity: 'workers', rows: [{ id: 'a', name: 'Webhook worker' }] }, 401, 'sha256=invalid')
  assert.equal((await send({ entity: 'workers', rows: [{ id: 'a', name: 'Webhook worker' }] })).written, 1)
  assert.equal((await send({ entity: 'workers', data: [{ id: 'a', name: 'Updated webhook worker' }] })).written, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workers').get().n, 1)
  await send({ entity: 'workers', rows: Array(501).fill({ name: 'Overflow' }) }, 400)
  await send({ entity: 'workers', rows: [{ name: 'x'.repeat(270000) }] }, 413)
  sqlite.prepare("UPDATE user_flags SET plan = 'sole' WHERE user_id = 'alice'").run()
  await send({ entity: 'workers', rows: [{ id: 'b', name: 'Denied' }] }, 403)
  sqlite.prepare("UPDATE user_flags SET plan = 'enterprise', suspended = 1 WHERE user_id = 'alice'").run()
  await send({ entity: 'workers', rows: [{ id: 'b', name: 'Denied' }] }, 403)
})

test('the browser HTTP client sends usable Basic/Bearer credentials and PATCH keeps enabled', { timeout: 15000 }, async (t) => {
  const { env } = await setup(t)
  const { createServer } = await import('vite')
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_USE_MOCK': '"false"', 'import.meta.env.DEV': 'false' } })
  t.after(() => server.close())
  localStorage.setItem('satualur_token', 'alice'.repeat(8))
  t.after(() => localStorage.removeItem('satualur_token'))
  t.mock.method(globalThis, 'fetch', (path, options) => worker.fetch(new Request(`https://local.test${path}`, options), env))
  const client = await server.ssrLoadModule('/src/mcp/connector.js')
  for (const [type, key] of [['basic', 'password'], ['oauth2', 'token']]) {
    const connector = await client.createConnector({ type: 'rest', name: `${type} integration`, enabled: true, endpoint: { baseUrl: 'https://erp.example.com' }, auth: { type, username: 'operator', [key]: 'client-secret' } })
    assert.equal(connector.config.auth.type, type)
    assert.ok(!JSON.stringify(connector).includes('client-secret'))
    assert.equal((await client.updateConnector(connector.id, { name: `Renamed ${type}` })).enabled, true)
  }
})

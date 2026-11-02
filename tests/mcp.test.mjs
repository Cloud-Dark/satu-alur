// Unit tests: src/mcp/rules.js (validation, transforms, external ids) and the
// Worker's row pipeline (worker/mcp.js transformRow). These are the rules the
// Pengaturan form, the Worker and the D1 CHECK constraints all share, so a
// regression here would silently let bad rows through.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const R = await import('../src/mcp/rules.js')
const { transformRow } = await import('../worker/mcp.js')

const throwsValidation = (fn, pattern) => {
  try {
    fn()
  } catch (err) {
    assert.equal(err.validation, true, `expected validation error, got: ${err.message}`)
    if (pattern) assert.match(err.message, pattern)
    return
  }
  assert.fail('expected the call to throw')
}

/* ------------------------------------------------------------- Connectors */

test('validateConnector accepts a complete REST connector and separates secrets', () => {
  const out = R.validateConnector({
    type: 'rest',
    name: 'Odoo Production',
    enabled: true,
    endpoint: { baseUrl: 'https://erp.contoh.id/api/v1' },
    auth: { type: 'apikey', apiKey: 'rahasia-123', headerName: 'X-Api-Key' },
    sync: { strategy: 'scheduled', schedule: '0 2 * * *', batchSize: 250 },
  })

  assert.equal(out.type, 'rest')
  assert.equal(out.name, 'Odoo Production')
  assert.equal(out.enabled, true)
  assert.equal(out.config.endpoint.baseUrl, 'https://erp.contoh.id/api/v1')
  assert.equal(out.config.auth.type, 'apikey')
  assert.equal(out.secrets.apiKey, 'rahasia-123')
  // The secret must not survive in the public config.
  assert.equal(out.config.apiKey, undefined)
  assert.equal(out.config.auth.apiKey, undefined)
  assert.equal(out.config.sync.batchSize, 250)
})

test('validateConnector rejects an invalid URL', () => {
  throwsValidation(
    () => R.validateConnector({ type: 'rest', name: 'XX', endpoint: { baseUrl: 'erp.local' }, auth: { apiKey: 'k' } }),
    /URL endpoint harus valid/,
  )
})

test('validateConnector requires credentials on create', () => {
  throwsValidation(
    () => R.validateConnector({ type: 'rest', name: 'XX', endpoint: { baseUrl: 'https://a.id' } }),
    /Kredensial konektor wajib diisi/,
  )
})

test('validateConnector accepts an update that keeps stored secrets', () => {
  const out = R.validateConnector(
    { type: 'rest', name: 'XX', endpoint: { baseUrl: 'https://a.id' } },
    { existing: { hasSecrets: true } },
  )
  assert.deepEqual(out.secrets, {})
})

test('validateConnector enforces the database port range', () => {
  throwsValidation(
    () => R.validateConnector({
      type: 'database',
      name: 'Legacy DB',
      connection: { driver: 'mysql', host: 'db.local', database: 'erp', username: 'ro', password: 'p', port: 99999 },
    }),
    /Port database harus antara 1 dan 65535/,
  )
})

test('validateConnector marks database connections read-only by default', () => {
  const out = R.validateConnector({
    type: 'database',
    name: 'Legacy DB',
    connection: { driver: 'mysql', host: 'db.local', database: 'erp', username: 'ro', password: 'p', port: 3306 },
  })
  assert.equal(out.config.connection.readOnly, true)
  assert.equal(out.config.connection.ssl, true)
})

test('validateConnector requires a 16-character webhook secret', () => {
  throwsValidation(
    () => R.validateConnector({ type: 'webhook', name: 'Hook', secret: 'pendek' }),
    /Secret webhook minimal 16 karakter/,
  )
})

test('validateConnector requires a cron expression for scheduled sync', () => {
  throwsValidation(
    () => R.validateConnector({
      type: 'file', name: 'CSV', format: 'csv', sync: { strategy: 'scheduled' },
    }),
    /Jadwal wajib diisi/,
  )
})

test('redactConnector never returns secrets', () => {
  const view = R.redactConnector({
    id: 'conn_1',
    name: 'Odoo',
    type: 'rest',
    config: { endpoint: { baseUrl: 'https://a.id' }, auth: { type: 'apikey', apiKey: 'raw-secret' } },
    has_secrets: true,
    enabled: 1,
    status: 'active',
    created_at: 'x',
    updated_at: 'y',
  })
  const json = JSON.stringify(view)
  assert.ok(!json.includes('apiKey'))
  assert.ok(!json.includes('password'))
  assert.equal(view.hasSecrets, true)
  assert.equal(view.enabled, true)
})

/* --------------------------------------------------------------- Mappings */

test('validateMapping rejects a missing required column', () => {
  throwsValidation(
    () => R.validateMapping({
      entity: 'requests',
      fields: [{ source: 'nama', target: 'customer_name' }],
    }),
    /Kolom wajib belum dipetakan: service_type/,
  )
})

test('validateMapping rejects an unknown target column', () => {
  throwsValidation(
    () => R.validateMapping({
      entity: 'requests',
      fields: [
        { source: 'nama', target: 'customer_name' },
        { source: 'x', target: 'kolom_ajaib' },
      ],
    }),
    /Kolom target tidak dikenal/,
  )
})

test('validateMapping rejects duplicate targets and unknown transforms', () => {
  throwsValidation(
    () => R.validateMapping({
      entity: 'workers',
      fields: [
        { source: 'a', target: 'name' },
        { source: 'b', target: 'name' },
      ],
    }),
    /duplikat/,
  )
  throwsValidation(
    () => R.validateMapping({
      entity: 'workers',
      fields: [{ source: 'a', target: 'name', transform: 'sihir' }],
    }),
    /Transformasi tidak dikenal/,
  )
})

test('validateMapping normalises a complete mapping', () => {
  const out = R.validateMapping({
    entity: 'requests',
    fields: [
      { source: 'nama', target: 'customer_name', transform: 'trim' },
      { source: 'layanan', target: 'service_type' },
      { source: 'tanggal', target: 'requested_at', transform: 'date:ISO8601' },
    ],
    externalIdField: 'id',
    mode: 'upsert',
  })
  assert.equal(out.entity, 'requests')
  assert.equal(out.fields.length, 3)
  assert.deepEqual(out.fields[0].transform, ['trim'])
  assert.equal(out.fields[0].required, true)
  assert.equal(out.fields[2].required, false)
  assert.equal(out.mode, 'upsert')
})

/* ------------------------------------------------------------- Transforms */

test('number transform reads Indonesian formatting', () => {
  assert.equal(R.TRANSFORMS.number('Rp 1.500.000'), 1500000)
  assert.equal(R.TRANSFORMS.number('1.500.000,50'), 1500000.5)
  assert.equal(R.TRANSFORMS.number('1500,50'), 1500.5)
  assert.equal(R.TRANSFORMS.number('1500000'), 1500000)
  assert.equal(R.TRANSFORMS.number(''), null)
})

test('phone_id normalises Indonesian numbers to 62…', () => {
  assert.equal(R.TRANSFORMS.phone_id('0812-3456-7890'), '6281234567890')
  assert.equal(R.TRANSFORMS.phone_id('+62 812 3456 7890'), '6281234567890')
  assert.equal(R.TRANSFORMS.phone_id('6281234567890'), '6281234567890')
  assert.equal(R.TRANSFORMS.phone_id(''), null)
})

test('map, concat and json transforms behave', () => {
  assert.equal(R.TRANSFORMS.map('SRV-001', { 'SRV-001': 'AC Cleaning' }), 'AC Cleaning')
  assert.equal(R.TRANSFORMS.map('SRV-999', { 'SRV-001': 'AC Cleaning' }), 'SRV-999')
  assert.equal(R.TRANSFORMS.concat(['Jl. Sudirman', 'Jakarta'], ', '), 'Jl. Sudirman, Jakarta')
  assert.equal(R.TRANSFORMS.json({ skills: ['ac'] }), '{"skills":["ac"]}')
})

test('applyTransforms chains without failing on unknown keys', () => {
  assert.equal(R.applyTransforms('  John   Doe ', ['trim', 'uppercase', 'nope']), 'JOHN DOE')
})

/* ------------------------------------------------------------ External id */

test('externalIdFor prefers the named field', () => {
  const mapping = { externalIdField: 'kode', fields: [] }
  assert.equal(R.externalIdFor('workers', { kode: 'EMP-7' }, mapping), 'EMP-7')
})

test('externalIdFor falls back to a stable hash of the natural key', () => {
  const mapping = {
    fields: [
      { source: 'nama', target: 'name' },
      { source: 'telepon', target: 'phone' },
    ],
  }
  const a = R.externalIdFor('workers', { nama: 'Budi', telepon: '0811' }, mapping)
  const b = R.externalIdFor('workers', { nama: '  budi ', telepon: '0811' }, mapping)
  const c = R.externalIdFor('workers', { nama: 'Siti', telepon: '0811' }, mapping)
  assert.match(a, /^k:[0-9a-f]{8}$/)
  assert.equal(a, b, 'case and whitespace must not change the key')
  assert.notEqual(a, c)
})

/* --------------------------------------------------------- Row transform */

test('transformRow coerces numbers and dates', () => {
  const mapping = {
    fields: [
      { source: 'nama', target: 'customer_name', transform: ['trim'] },
      { source: 'layanan', target: 'service_type', transform: [] },
      { source: 'tanggal', target: 'requested_at', transform: ['date:ISO8601'] },
    ],
  }
  const { values, errors } = transformRow('requests', { nama: ' PT Maju ', layanan: 'AC Cleaning', tanggal: '2026-11-01' }, mapping)
  assert.deepEqual(errors, [])
  assert.equal(values.customer_name, 'PT Maju')
  assert.equal(values.service_type, 'AC Cleaning')
  assert.equal(values.requested_at, '2026-11-01T00:00:00.000Z')
})

test('transformRow reports an empty required field that is mapped', () => {
  // validateMapping guarantees every required column is mapped, so the row
  // pipeline only has to reject an empty value on a field it actually sees.
  const mapping = {
    fields: [
      { source: 'nama', target: 'customer_name', transform: [] },
      { source: 'layanan', target: 'service_type', transform: [] },
    ],
  }
  const { errors, values } = transformRow('requests', { nama: 'PT Maju', layanan: '   ' }, mapping)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /service_type: wajib diisi/)
  assert.equal(values.customer_name, 'PT Maju')
  assert.equal(values.service_type, undefined)
})

test('transformRow rejects an unknown enum value instead of writing it', () => {
  const mapping = {
    fields: [
      { source: 'nama', target: 'customer_name', transform: [] },
      { source: 'layanan', target: 'service_type', transform: [] },
      { source: 'status', target: 'status', transform: [] },
    ],
  }
  const { errors } = transformRow('requests', { nama: 'A', layanan: 'AC', status: 'selesai' }, mapping)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /status: nilai "selesai" tidak dikenal/)
})

test('transformRow rounds money to whole Rupiah', () => {
  const mapping = {
    fields: [
      { source: 'nama', target: 'name', transform: [] },
      { source: 'harga', target: 'price', transform: ['money'] },
    ],
  }
  const { values, errors } = transformRow('vas_items', { nama: 'AC Cleaning', harga: 'Rp 250.000' }, mapping)
  assert.deepEqual(errors, [])
  assert.equal(values.price, 250000)
})

test('transformRow keeps a valid text value that contains a colon', () => {
  const mapping = {
    fields: [
      { source: 'nama', target: 'customer_name', transform: [] },
      { source: 'layanan', target: 'service_type', transform: [] },
      { source: 'catatan', target: 'description', transform: [] },
    ],
  }
  const { values, errors } = transformRow('requests', {
    nama: 'A', layanan: 'AC', catatan: 'Jadwal: besok pagi',
  }, mapping)
  assert.deepEqual(errors, [])
  assert.equal(values.description, 'Jadwal: besok pagi')
})

/* ------------------------------------------------------------- Migration */

test('validateMigration builds the supported phases and keeps them ordered', () => {
  const out = R.validateMigration({ name: 'Migrasi Q4', strategy: 'parallel' })
  assert.equal(out.phases.length, 2)
  assert.deepEqual(out.phases.map((p) => p.key), ['master', 'open_transactions'])
  assert.ok(out.phases.every((p) => p.status === 'pending'))
})

test('validateMigration rejects a short name and an unknown strategy', () => {
  throwsValidation(() => R.validateMigration({ name: 'ab' }), /minimal 3 karakter/)
  throwsValidation(() => R.validateMigration({ name: 'Migrasi', strategy: 'teleport' }), /Strategi migrasi tidak dikenal/)
})

/* ---------------------------------------------------------------- Schema */

test('schemaFor exposes required flags and enum values', () => {
  const requests = R.schemaFor('requests')
  assert.equal(requests.label, 'Permintaan')
  const status = requests.columns.find((c) => c.name === 'status')
  assert.equal(status.type, 'enum')
  assert.ok(status.values.includes('approved'))
  assert.equal(requests.columns.find((c) => c.name === 'customer_name').required, true)
  assert.equal(R.schemaFor('tidak_ada'), null)
})

test('importable entities exclude FK-dependent tables', () => {
  assert.deepEqual(R.IMPORTABLE_ENTITIES, ['requests', 'workers', 'vas_items', 'waste_entries'])
})

test('connector config never exposes nested or irrelevant credentials', () => {
  const out = R.validateConnector({ type: 'file', name: 'CSV', config: { auth: { apiKey: 'never-store', password: 'never-store' }, connection: { password: 'never-store' } } })
  assert.ok(!JSON.stringify(out.config).includes('never-store'))
  for (const baseUrl of ['http://erp.example.com', 'https://user:password@erp.example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://erp.local']) {
    throwsValidation(() => R.validateConnector({ type: 'rest', name: 'ERP', endpoint: { baseUrl }, apiKey: 'key' }), /URL endpoint harus valid/)
  }
})

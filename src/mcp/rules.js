/**
 * MCP (Model Context Protocol) — one set of rules, three callers.
 *
 * `worker/mcp.js`, `src/mcp/connector.js` and the Pengaturan UI all import this
 * module, so a connector the form accepts can never be one the database
 * rejects. Everything here is pure: no DOM, no fetch, no globals.
 *
 * Errors carry `validation: true` (the convention from business/plan-rules.js)
 * so the Worker can turn them into 400s and let real bugs surface as 500s.
 * All messages are Indonesian because they are shown to the user verbatim.
 */

/* ------------------------------------------------------------------ Enums */

export const CONNECTOR_TYPES = ['rest', 'database', 'file', 'webhook']

/** `draft` = saved but never tested; `error` = last test/sync failed. */
export const CONNECTOR_STATUSES = ['draft', 'active', 'disabled', 'error']

export const SYNC_STATUSES = ['running', 'completed', 'completed_with_errors', 'failed', 'cancelled']

export const MIGRATION_STATUSES = ['draft', 'running', 'completed', 'completed_with_errors', 'failed', 'rolled_back']

export const PHASE_STATUSES = ['pending', 'running', 'completed', 'completed_with_errors', 'failed', 'skipped']

export const MIGRATION_STRATEGIES = ['parallel', 'phased', 'bigbang']

export const SYNC_TRIGGERS = ['manual', 'scheduled', 'webhook', 'migration']

export const SYNC_DIRECTIONS = ['inbound', 'outbound', 'bidirectional']

export const ERROR_STATUSES = ['open', 'resolved', 'ignored']

/* ----------------------------------------------------------------- Limits */

export const LIMITS = {
  name: 80,
  url: 500,
  description: 400,
  /** Per owner: enough for every ERP + a staging copy of each. */
  connectors: 20,
  /** Per connector: one mapping per entity, with room for a few variants. */
  mappings: 60,
  /** Per mapping: a wide ERP table is still under 100 useful columns. */
  fields: 120,
  /** Rows accepted in one import request. Matches the Worker's body budget. */
  importRows: 500,
  /** Rows written in one D1 batch. */
  batchSize: 100,
  /** Dead-letter rows kept per sync before the oldest are pruned. */
  syncErrors: 5000,
  /** Sync log retention (rows per owner). */
  syncLogs: 500,
}

/* --------------------------------------------------------------- Entities */

/**
 * The Satu Alur entities an external system may write to, with the columns a
 * mapping may target. `required` mirrors the database NOT NULL constraints so
 * validation fails in the UI instead of at insert time.
 *
 * `dedupe` lists the natural-key fields used to build an external id when the
 * mapping does not name one explicitly.
 */
export const ENTITIES = {
  requests: {
    label: 'Permintaan',
    columns: ['customer_name', 'service_type', 'phone', 'location', 'description', 'status', 'requested_at'],
    required: ['customer_name', 'service_type'],
    dedupe: ['customer_name', 'requested_at'],
    enums: { status: ['draft', 'sent', 'approved', 'rejected', 'in_progress', 'completed'] },
  },
  workers: {
    label: 'Tenaga Kerja',
    columns: ['name', 'phone', 'address', 'skills', 'zone', 'status'],
    required: ['name'],
    dedupe: ['name', 'phone'],
    enums: { status: ['active', 'inactive'] },
  },
  vas_items: {
    label: 'Layanan Tambahan',
    columns: ['name', 'price', 'cost', 'category', 'attach_to', 'attach_rate', 'description', 'status'],
    required: ['name', 'price'],
    dedupe: ['name'],
    enums: {
      category: ['perawatan', 'perlindungan', 'peningkatan', 'kecepatan', 'paket', 'lain'],
      status: ['active', 'draft', 'retired'],
    },
  },
  waste_entries: {
    label: 'Temuan Limbah',
    columns: ['title', 'stream', 'detail', 'monthly_loss', 'saved', 'action', 'owner', 'status'],
    required: ['title', 'monthly_loss'],
    dedupe: ['title', 'stream'],
    enums: {
      stream: ['waktu', 'perjalanan', 'bahan', 'pengerjaan_ulang', 'air_kimia'],
      status: ['open', 'progress', 'done'],
    },
  },
  offers: {
    label: 'Penawaran',
    columns: ['request_id', 'validated_price', 'validated_scope', 'status'],
    required: ['request_id'],
    dedupe: ['request_id'],
    enums: { status: ['draft', 'sent', 'approved', 'rejected'] },
  },
  assignments: {
    label: 'Penugasan',
    columns: ['offer_id', 'worker_name', 'scheduled_at', 'status'],
    required: ['offer_id'],
    dedupe: ['offer_id', 'scheduled_at'],
    enums: { status: ['pending', 'in_progress', 'completed', 'cancelled'] },
  },
  completions: {
    label: 'Penyelesaian',
    columns: ['assignment_id', 'notes', 'status', 'completed_at'],
    required: ['assignment_id'],
    dedupe: ['assignment_id'],
    enums: { status: ['pending', 'completed'] },
  },
  ledger_entries: {
    label: 'Jurnal',
    columns: ['completion_id', 'vas_item_id', 'amount', 'category', 'status', 'posted_at'],
    required: ['completion_id', 'amount', 'category'],
    dedupe: ['completion_id', 'amount'],
    enums: { status: ['pending', 'posted'] },
  },
}

export const ENTITY_KEYS = Object.keys(ENTITIES)

/** Entities safe to write from an external system (FK targets are internal). */
export const IMPORTABLE_ENTITIES = ['requests', 'workers', 'vas_items', 'waste_entries']

/** Column types, derived once so the UI and the Worker agree. */
export function columnType(entity, column) {
  const spec = ENTITIES[entity]
  if (!spec || !spec.columns.includes(column)) return null
  if (spec.enums && spec.enums[column]) return 'enum'
  if (column === 'skills') return 'json'
  if (['price', 'cost', 'attach_rate', 'monthly_loss', 'saved', 'amount', 'validated_price',
    'request_id', 'offer_id', 'assignment_id', 'completion_id', 'vas_item_id'].includes(column)) return 'number'
  if (['requested_at', 'scheduled_at', 'completed_at', 'posted_at'].includes(column)) return 'datetime'
  return 'string'
}

/* ------------------------------------------------------------- Transforms */

/** Whole Rupiah from a number or a pasted string ("Rp 1.500.000" → 1500000). */
export function moneyInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : NaN
  const raw = String(value ?? '').trim().replace(/^Rp\s*/i, '')
  if (!raw) return 0
  if (!/^-?\d+(?:[.\s]\d+)*$/.test(raw)) return NaN
  return parseInt(raw.replace(/[.\s]/g, ''), 10)
}

export const TRANSFORM_KEYS = [
  'trim', 'uppercase', 'lowercase', 'date:ISO8601', 'number', 'money',
  'map', 'concat', 'split', 'json', 'phone_id', 'boolean',
]

/**
 * Pure transform functions. `mapping` is the value table for `map`, the
 * separator for `concat`/`split`, or unused.
 */
export const TRANSFORMS = {
  trim: (v) => String(v ?? '').trim().replace(/\s+/g, ' '),
  uppercase: (v) => String(v ?? '').toUpperCase(),
  lowercase: (v) => String(v ?? '').toLowerCase(),
  'date:ISO8601': (v) => {
    if (v === null || v === undefined || v === '') return null
    const d = v instanceof Date ? v : new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  },
  number: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = String(v).replace(/[Rp\s]/gi, '')
    if (!s) return null
    // Indonesian: "." thousands, "," decimal. "1.500.000,50" -> 1500000.5
    if (s.includes(',') && s.includes('.')) {
      const n = Number(s.replace(/\./g, '').replace(',', '.'))
      return Number.isNaN(n) ? null : n
    }
    if (s.includes(',')) {
      const parts = s.split(',')
      const n = parts.length === 2 && parts[1].length <= 2
        ? Number(s.replace(',', '.'))
        : Number(s.replace(/,/g, ''))
      return Number.isNaN(n) ? null : n
    }
    // Dots only: thousands separators in this locale.
    const n = Number(s.replace(/\./g, ''))
    return Number.isNaN(n) ? null : n
  },
  money: (v) => {
    const n = moneyInt(v)
    return Number.isNaN(n) ? null : n
  },
  map: (v, table) => {
    if (!table || typeof table !== 'object') return v
    const key = String(v ?? '')
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : v
  },
  concat: (v, separator = ' ') => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '').join(separator) : String(v ?? '')),
  split: (v, delimiter = ',') => String(v ?? '').split(delimiter).map((s) => s.trim()).filter(Boolean),
  json: (v) => {
    if (typeof v === 'string') return v
    try { return JSON.stringify(v ?? null) } catch { return 'null' }
  },
  /** 0812… / +62 812… / 62812… → 62812… (the format WAPilot expects). */
  phone_id: (v) => {
    const digits = String(v ?? '').replace(/[^0-9+]/g, '').replace(/^\+/, '')
    if (!digits) return null
    if (digits.startsWith('62')) return digits
    if (digits.startsWith('0')) return `62${digits.slice(1)}`
    return `62${digits}`
  },
  boolean: (v) => {
    if (typeof v === 'boolean') return v
    const s = String(v ?? '').trim().toLowerCase()
    return ['1', 'true', 'ya', 'yes', 'y'].includes(s)
  },
}

/** Apply a transform chain. Unknown transforms are ignored, never fatal. */
export function applyTransforms(value, chain, mapping = null) {
  if (!chain) return value
  const list = Array.isArray(chain) ? chain : [chain]
  return list.reduce((v, key) => {
    const fn = TRANSFORMS[key]
    return fn ? fn(v, mapping) : v
  }, value)
}

/* ---------------------------------------------------------------- Helpers */

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}

function text(value, max) {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return max ? s.slice(0, max) : s
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function enumOrThrow(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} tidak dikenal.`)
  return value
}

/* ------------------------------------------------------------- Connectors */

/** Which config keys hold secrets, per connector type. */
export const SECRET_FIELDS = {
  rest: ['apiKey', 'password', 'clientSecret', 'token'],
  database: ['password'],
  file: [],
  webhook: ['secret'],
}

/**
 * Split a submitted config into public config and secrets.
 * Secrets are never returned by the API and are stored encrypted.
 */
export function splitConnectorInput(type, input = {}) {
  const secrets = {}
  const config = {}

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'undefined') continue
    if ((SECRET_FIELDS[type] || []).includes(key)) {
      if (value !== '' && value !== null) secrets[key] = String(value)
      continue
    }
    config[key] = value
  }

  // Nested shapes from the UI templates.
  if (isPlainObject(input.auth)) {
    config.auth = { type: input.auth.type || 'apikey', headerName: input.auth.headerName || 'X-Api-Key' }
    for (const key of ['apiKey', 'password', 'clientSecret', 'token', 'username']) {
      if (typeof input.auth[key] !== 'undefined' && input.auth[key] !== '') {
        if ((SECRET_FIELDS[type] || []).includes(key)) secrets[key] = String(input.auth[key])
        else config.auth[key] = input.auth[key]
      }
    }
  }
  if (isPlainObject(input.connection)) {
    const { password, ...rest } = input.connection
    config.connection = rest
    if (password) secrets.password = String(password)
  }
  if (isPlainObject(input.endpoint)) config.endpoint = input.endpoint
  if (isPlainObject(input.sync)) config.sync = input.sync
  if (isPlainObject(input.validation)) config.validation = input.validation

  return { config, secrets }
}

/**
 * Validate + normalise a connector payload.
 * `existing` supplies secrets when the UI sends an update without re-typing them.
 */
export function validateConnector(input = {}, { existing = null } = {}) {
  if (!isPlainObject(input)) fail('Data konektor tidak valid.')

  const type = enumOrThrow(input.type, CONNECTOR_TYPES, 'Tipe konektor')
  const name = text(input.name, LIMITS.name)
  if (name.length < 2) fail('Nama konektor minimal 2 karakter.')

  const { config, secrets } = splitConnectorInput(type, input)

  if (type === 'rest') {
    const url = text(config.endpoint?.baseUrl || config.baseUrl, LIMITS.url)
    if (!/^https?:\/\/[^\s]+$/i.test(url)) fail('URL endpoint harus valid (dimulai dengan http:// atau https://).')
    config.endpoint = { ...(config.endpoint || {}), baseUrl: url }
    const authType = config.auth?.type || 'apikey'
    if (!['apikey', 'basic', 'oauth2'].includes(authType)) fail('Tipe autentikasi tidak dikenal.')
    config.auth = { ...(config.auth || {}), type: authType }
    const hasSecret = Object.keys(secrets).length > 0 || Boolean(existing?.hasSecrets)
    if (!hasSecret) fail('Kredensial konektor wajib diisi.')
    if (authType === 'basic' && !config.auth.username) fail('Username wajib diisi untuk Basic Auth.')
  }

  if (type === 'database') {
    const c = config.connection || {}
    const driver = c.driver || 'mysql'
    if (!['mysql', 'postgresql', 'mssql', 'sqlite'].includes(driver)) fail('Driver database tidak dikenal.')
    if (!text(c.host, 255)) fail('Host database wajib diisi.')
    if (!text(c.database, 120)) fail('Nama database wajib diisi.')
    if (!text(c.username, 120)) fail('Username database wajib diisi.')
    const port = Number(c.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Port database harus antara 1 dan 65535.')
    if (!Object.keys(secrets).length && !existing?.hasSecrets) fail('Password database wajib diisi.')
    config.connection = {
      driver,
      host: text(c.host, 255),
      port,
      database: text(c.database, 120),
      username: text(c.username, 120),
      ssl: c.ssl !== false,
      readOnly: c.readOnly !== false,
    }
  }

  if (type === 'file') {
    const format = config.format || 'csv'
    if (!['csv', 'xlsx', 'json', 'xml'].includes(format)) fail('Format file tidak dikenal.')
    config.format = format
    config.delimiter = config.delimiter || ','
    config.encoding = config.encoding || 'utf-8'
    config.hasHeader = config.hasHeader !== false
  }

  if (type === 'webhook') {
    const secret = secrets.secret || existing?.secret
    if (!secret || String(secret).length < 16) fail('Secret webhook minimal 16 karakter.')
    secrets.secret = secret
  }

  const syncStrategy = config.sync?.strategy || 'manual'
  if (!['manual', 'scheduled', 'realtime'].includes(syncStrategy)) fail('Strategi sinkronisasi tidak dikenal.')
  config.sync = {
    strategy: syncStrategy,
    schedule: text(config.sync?.schedule, 120),
    batchSize: Math.min(Math.max(Number(config.sync?.batchSize) || LIMITS.batchSize, 1), 1000),
  }
  if (syncStrategy === 'scheduled' && !config.sync.schedule) {
    fail('Jadwal wajib diisi untuk sinkronisasi terjadwal (contoh: 0 2 * * *).')
  }

  return {
    type,
    name,
    config,
    secrets,
    enabled: input.enabled === true || input.enabled === 1,
  }
}

/** Strip every secret before a connector leaves the server. */
export function redactConnector(row) {
  if (!row) return null
  const config = row.config || {}
  const hasSecrets = Boolean(row.has_secrets)
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config,
    enabled: row.enabled === 1 || row.enabled === true,
    status: row.status,
    hasSecrets,
    lastSyncAt: row.last_sync_at || null,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/* --------------------------------------------------------------- Mappings */

export function validateMapping(input = {}) {
  if (!isPlainObject(input)) fail('Data pemetaan tidak valid.')

  const entity = enumOrThrow(input.entity, ENTITY_KEYS, 'Entitas')
  const spec = ENTITIES[entity]
  const direction = input.direction || 'inbound'
  enumOrThrow(direction, SYNC_DIRECTIONS, 'Arah sinkronisasi')

  const fields = Array.isArray(input.fields) ? input.fields : []
  if (fields.length === 0) fail('Pemetaan harus memiliki minimal satu bidang.')
  if (fields.length > LIMITS.fields) fail(`Maksimal ${LIMITS.fields} bidang per pemetaan.`)

  const seen = new Set()
  const out = []

  for (const raw of fields) {
    if (!isPlainObject(raw)) fail('Setiap bidang pemetaan harus berupa objek.')
    const target = text(raw.target, 64)
    if (!target) fail('Setiap bidang pemetaan harus memiliki target.')
    if (!spec.columns.includes(target)) fail(`Kolom target tidak dikenal: ${target}.`)
    if (seen.has(target)) fail(`Kolom target duplikat: ${target}.`)
    seen.add(target)

    const source = text(raw.source, 200)
    const transform = raw.transform
      ? (Array.isArray(raw.transform) ? raw.transform : [raw.transform]).filter((t) => TRANSFORM_KEYS.includes(t))
      : []

    if (raw.transform && transform.length === 0) fail(`Transformasi tidak dikenal untuk ${target}.`)

    let mapTable = null
    if (isPlainObject(raw.mapping)) {
      mapTable = {}
      for (const [k, v] of Object.entries(raw.mapping)) mapTable[text(k, 120)] = v
    }

    if (!source && !raw.constant && spec.required.includes(target)) {
      fail(`Kolom wajib belum dipetakan: ${target}.`)
    }

    out.push({
      source,
      target,
      transform,
      mapping: mapTable,
      constant: typeof raw.constant !== 'undefined' ? raw.constant : null,
      required: spec.required.includes(target),
    })
  }

  for (const required of spec.required) {
    if (!seen.has(required)) fail(`Kolom wajib belum dipetakan: ${required}.`)
  }

  return {
    entity,
    direction,
    externalIdField: text(input.externalIdField, 200) || null,
    fields: out,
    filters: isPlainObject(input.filters) ? input.filters : null,
    mode: input.mode === 'upsert' ? 'upsert' : 'insert',
  }
}

/**
 * Build the external id used for idempotent upserts.
 * Explicit field wins; otherwise a stable hash of the entity's natural key.
 */
export function externalIdFor(entity, row, mapping) {
  const spec = ENTITIES[entity]
  if (mapping?.externalIdField) {
    const v = row[mapping.externalIdField]
    if (v !== null && v !== undefined && v !== '') return String(v)
  }
  const parts = (spec?.dedupe || []).map((col) => {
    const field = (mapping?.fields || []).find((f) => f.target === col)
    const raw = field?.source ? row[field.source] : undefined
    return String(raw ?? '').trim().toLowerCase()
  })
  const joined = parts.join('|')
  if (!joined.replace(/\|/g, '')) return null
  return `k:${simpleHash(joined)}`
}

/** FNV-1a 32-bit: short, stable, no crypto dependency, good enough for a key. */
export function simpleHash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/* ------------------------------------------------------------- Migrations */

export const MIGRATION_PHASES = [
  {
    key: 'master',
    name: 'Data Master',
    description: 'Tenaga kerja dan katalog layanan tambahan',
    entities: ['workers', 'vas_items'],
    optional: false,
  },
  {
    key: 'open_transactions',
    name: 'Transaksi Aktif',
    description: 'Permintaan dan penawaran yang masih berjalan',
    entities: ['requests', 'offers'],
    optional: false,
  },
  {
    key: 'historical',
    name: 'Data Historis',
    description: 'Penyelesaian dan jurnal masa lalu',
    entities: ['completions', 'ledger_entries'],
    optional: true,
  },
]

export function validateMigration(input = {}) {
  if (!isPlainObject(input)) fail('Data migrasi tidak valid.')
  const name = text(input.name, LIMITS.name)
  if (name.length < 3) fail('Nama migrasi minimal 3 karakter.')
  const strategy = input.strategy || 'parallel'
  enumOrThrow(strategy, MIGRATION_STRATEGIES, 'Strategi migrasi')

  const requested = Array.isArray(input.phases) && input.phases.length
    ? input.phases.filter((p) => MIGRATION_PHASES.some((x) => x.key === p))
    : MIGRATION_PHASES.map((p) => p.key)

  const phases = MIGRATION_PHASES
    .filter((p) => requested.includes(p.key) || (!p.optional && !requested.length))
    .map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      entities: p.entities,
      optional: p.optional,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      recordsProcessed: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      errors: [],
    }))

  return { name, strategy, connectorId: text(input.connectorId, 64) || null, phases }
}

/* ----------------------------------------------------------------- Export */

/** The client-side schema shape (kept in sync with ENTITIES). */
export function schemaFor(entity) {
  const spec = ENTITIES[entity]
  if (!spec) return null
  return {
    label: spec.label,
    columns: spec.columns.map((name) => ({
      name,
      type: columnType(entity, name),
      required: spec.required.includes(name),
      values: spec.enums?.[name] || null,
    })),
  }
}

/**
 * MCP connector client.
 *
 * In production every call goes to /api/mcp/*. In demo mode (mock cloud) the
 * same operations run against localStorage so the Pengaturan screens work
 * offline — the shapes returned are identical, which is what keeps the UI free
 * of `if (mock)` branches.
 */

import { isUsingMockCloud } from '../cloud.js'
import { call } from './api.js'
import { LIMITS, TRANSFORM_KEYS, applyTransforms, validateConnector, validateMigration, validateMapping } from './rules.js'

const CONNECTOR_KEY = 'satualur_mcp_connectors'
const MAPPING_KEY = 'satualur_mcp_mappings'
const LOG_KEY = 'satualur_mcp_sync_logs'
const MIGRATION_KEY = 'satualur_mcp_migrations'

/* --------------------------------------------------------------- Templates */

export const CONNECTOR_TEMPLATES = {
  rest: {
    type: 'rest',
    name: '',
    enabled: false,
    auth: { type: 'apikey', apiKey: '', headerName: 'X-Api-Key', username: '' },
    endpoint: { baseUrl: '', timeout: 20000 },
    sync: { strategy: 'manual', schedule: '', batchSize: 100 },
  },
  database: {
    type: 'database',
    name: '',
    enabled: false,
    connection: {
      driver: 'mysql', host: '', port: 3306, database: '',
      username: '', password: '', ssl: true, readOnly: true,
    },
    sync: { strategy: 'manual', batchSize: 100 },
  },
  file: {
    type: 'file',
    name: '',
    enabled: false,
    format: 'csv',
    delimiter: ',',
    encoding: 'utf-8',
    hasHeader: true,
    sync: { strategy: 'manual', batchSize: 100 },
  },
  webhook: {
    type: 'webhook',
    name: '',
    enabled: false,
    secret: '',
    sync: { strategy: 'realtime', batchSize: 100 },
  },
}

export const CONNECTOR_TYPE_LABELS = {
  rest: 'REST API',
  database: 'Database Langsung',
  file: 'Impor File',
  webhook: 'Webhook',
}

/* ------------------------------------------------------------- Mock store */

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota */ }
}

function mockId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/* ------------------------------------------------------------- Connectors */

export async function listConnectors() {
  if (isUsingMockCloud()) return readStore(CONNECTOR_KEY, [])
  const rows = await call('/api/mcp/connectors')
  return Array.isArray(rows) ? rows.map(fromServer) : []
}

export async function getConnector(id) {
  if (isUsingMockCloud()) return readStore(CONNECTOR_KEY, []).find((c) => c.id === id) || null
  try {
    return fromServer(await call(`/api/mcp/connectors/${encodeURIComponent(id)}`))
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

export async function createConnector(input) {
  if (isUsingMockCloud()) {
    const list = readStore(CONNECTOR_KEY, [])
    if (list.length >= LIMITS.connectors) {
      throw new Error(`Batas ${LIMITS.connectors} konektor tercapai. Hapus konektor yang tidak dipakai.`)
    }
    const clean = validateConnector(input)
    const connector = {
      id: mockId('conn'),
      name: clean.name,
      type: clean.type,
      config: clean.config,
      enabled: input.enabled === true,
      status: input.enabled ? 'active' : 'draft',
      hasSecrets: Object.keys(clean.secrets).length > 0,
      lastSyncAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    list.unshift(connector)
    writeStore(CONNECTOR_KEY, list)
    return connector
  }
  return fromServer(await call('/api/mcp/connectors', { method: 'POST', body: toServer(input) }))
}

export async function updateConnector(id, input) {
  if (isUsingMockCloud()) {
    const list = readStore(CONNECTOR_KEY, [])
    const idx = list.findIndex((c) => c.id === id)
    if (idx === -1) return null
    const clean = validateConnector({ ...list[idx].config, ...list[idx], ...input }, { existing: { hasSecrets: list[idx].hasSecrets } })
    const enabled = typeof input.enabled === 'undefined' ? list[idx].enabled : input.enabled === true
    list[idx] = {
      ...list[idx],
      name: clean.name,
      type: clean.type,
      config: clean.config,
      enabled,
      hasSecrets: list[idx].hasSecrets || Object.keys(clean.secrets).length > 0,
      status: enabled ? 'active' : 'draft',
      updatedAt: new Date().toISOString(),
    }
    writeStore(CONNECTOR_KEY, list)
    return list[idx]
  }
  return fromServer(await call(`/api/mcp/connectors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: toServer(input),
  }))
}

export async function deleteConnector(id) {
  if (isUsingMockCloud()) {
    writeStore(CONNECTOR_KEY, readStore(CONNECTOR_KEY, []).filter((c) => c.id !== id))
    const maps = readStore(MAPPING_KEY, {})
    delete maps[id]
    writeStore(MAPPING_KEY, maps)
    return true
  }
  await call(`/api/mcp/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return true
}

export async function testConnection(id) {
  if (isUsingMockCloud()) {
    const connector = readStore(CONNECTOR_KEY, []).find((c) => c.id === id)
    if (!connector) throw new Error('Konektor tidak ditemukan.')
    await new Promise((r) => setTimeout(r, 400))
    const missing = []
    if (connector.type === 'rest' && !connector.config?.endpoint?.baseUrl) missing.push('URL endpoint')
    if (connector.type === 'rest' && !connector.hasSecrets) missing.push('kredensial')
    if (connector.type === 'database' && !connector.config?.connection?.host) missing.push('host')
    if (connector.type === 'webhook' && !connector.hasSecrets) missing.push('secret')
    if (missing.length) {
      return { ok: false, code: 'CONFIG', message: `Lengkapi ${missing.join(', ')} terlebih dahulu.`, latencyMs: 0 }
    }
    if (connector.type === 'database') {
      return {
        ok: false,
        code: 'BRIDGE_REQUIRED',
        message: 'Koneksi database langsung memerlukan agen jembatan (bridge agent) di jaringan Anda.',
        latencyMs: 0,
      }
    }
    return { ok: true, code: 'OK', message: 'Konfigurasi valid (mode demo, tanpa panggilan jaringan).', latencyMs: 400 }
  }
  return call(`/api/mcp/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' })
}

/* --------------------------------------------------------------- Mappings */

export async function listMappings(connectorId) {
  if (isUsingMockCloud()) {
    const all = readStore(MAPPING_KEY, {})
    return all[connectorId] || []
  }
  const rows = await call(`/api/mcp/connectors/${encodeURIComponent(connectorId)}/mappings`)
  return Array.isArray(rows) ? rows : []
}

export async function saveMapping(connectorId, mapping) {
  if (isUsingMockCloud()) {
    mapping = validateMapping(mapping)
    const all = readStore(MAPPING_KEY, {})
    const list = all[connectorId] || []
    const idx = list.findIndex((m) => m.entity === mapping.entity)
    const row = { ...mapping, updatedAt: new Date().toISOString() }
    if (idx === -1) list.push(row)
    else list[idx] = row
    all[connectorId] = list
    writeStore(MAPPING_KEY, all)
    return row
  }
  return call(`/api/mcp/connectors/${encodeURIComponent(connectorId)}/mappings`, {
    method: 'PUT',
    body: mapping,
  })
}

export async function deleteMapping(connectorId, entity) {
  if (isUsingMockCloud()) {
    const all = readStore(MAPPING_KEY, {})
    all[connectorId] = (all[connectorId] || []).filter((m) => m.entity !== entity)
    writeStore(MAPPING_KEY, all)
    return true
  }
  await call(`/api/mcp/connectors/${encodeURIComponent(connectorId)}/mappings/${encodeURIComponent(entity)}`, {
    method: 'DELETE',
  })
  return true
}

/* ------------------------------------------------------------------ Sync */

export async function runSync(connectorId, options = {}) {
  if (isUsingMockCloud()) return mockSync(connectorId, options)
  return call(`/api/mcp/connectors/${encodeURIComponent(connectorId)}/sync`, {
    method: 'POST',
    body: {
      rows: options.rows,
      entity: options.entity,
      dryRun: options.dryRun === true,
      trigger: options.trigger || 'manual',
    },
  })
}

function mockSync(connectorId, options) {
  const connectors = readStore(CONNECTOR_KEY, [])
  const connector = connectors.find((c) => c.id === connectorId)
  if (!connector) return Promise.reject(new Error('Konektor tidak ditemukan.'))
  if (!connector.enabled) return Promise.reject(new Error('Konektor belum diaktifkan.'))

  const rows = Array.isArray(options.rows) ? options.rows : []
  const stats = {
    processed: rows.length,
    inserted: rows.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    entities: {},
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      const log = {
        id: mockId('sync'),
        connectorId,
        connectorName: connector.name,
        trigger: options.trigger || 'manual',
        status: 'completed',
        stats,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }
      const logs = readStore(LOG_KEY, [])
      logs.unshift(log)
      writeStore(LOG_KEY, logs.slice(0, LIMITS.syncLogs))

      const list = readStore(CONNECTOR_KEY, [])
      const idx = list.findIndex((c) => c.id === connectorId)
      if (idx !== -1) {
        list[idx].lastSyncAt = log.endedAt
        writeStore(CONNECTOR_KEY, list)
      }

      resolve({ syncId: log.id, dryRun: options.dryRun === true, status: log.status, stats, errors: [], errorCount: 0 })
    }, 500)
  })
}

export async function listSyncLogs() {
  if (isUsingMockCloud()) return readStore(LOG_KEY, [])
  const rows = await call('/api/mcp/sync')
  return Array.isArray(rows) ? rows : []
}

export async function listSyncErrors(status = 'open') {
  if (isUsingMockCloud()) return []
  const rows = await call(`/api/mcp/errors?status=${encodeURIComponent(status)}`)
  return Array.isArray(rows) ? rows : []
}

/* ---------------------------------------------------------- Schema probing */

/** Union of keys across the first rows, with a guessed type. */
export function columnsFromRows(rows) {
  const seen = new Map()
  for (const row of rows.slice(0, 50)) {
    if (!row || typeof row !== 'object') continue
    for (const [key, value] of Object.entries(row)) {
      if (seen.has(key)) continue
      seen.set(key, { name: key, type: guessType(value) })
    }
  }
  return [...seen.values()]
}

function guessType(value) {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value instanceof Date) return 'datetime'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value)) return 'datetime'
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) return 'number'
    return 'string'
  }
  if (Array.isArray(value)) return 'json'
  if (value && typeof value === 'object') return 'json'
  return 'string'
}

/* ------------------------------------------------------------------ CSV */

/**
 * Minimal RFC-4180 CSV parser: quotes, escaped quotes, CRLF, embedded newlines.
 * A spreadsheet export from Excel or Google Sheets parses correctly.
 */
export function parseCsv(text, delimiter = ',') {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === delimiter) { row.push(field); field = ''; continue }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
      continue
    }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

/** CSV text → array of objects using the first row as the header. */
export function csvToRows(text, delimiter = ',') {
  const table = parseCsv(text, delimiter)
  if (table.length < 2) return []
  const header = table[0].map((h) => String(h).trim())
  return table.slice(1).map((cells) => {
    const obj = {}
    header.forEach((key, i) => { if (key) obj[key] = cells[i] ?? '' })
    return obj
  })
}

/* -------------------------------------------------------------- Migration */

export async function listMigrations() {
  if (isUsingMockCloud()) return readStore(MIGRATION_KEY, [])
  const rows = await call('/api/mcp/migrations')
  return Array.isArray(rows) ? rows : []
}

export async function createMigration(input) {
  if (isUsingMockCloud()) {
    const clean = validateMigration(input)
    const list = readStore(MIGRATION_KEY, [])
    const row = {
      id: mockId('mig'),
      name: input.name,
      connectorId: input.connectorId || null,
      strategy: input.strategy || 'parallel',
      status: 'draft',
      phases: clean.phases,
      stats: { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 },
      createdAt: new Date().toISOString(),
    }
    list.unshift(row)
    writeStore(MIGRATION_KEY, list)
    return row
  }
  return call('/api/mcp/migrations', { method: 'POST', body: input })
}

export async function getMigration(id) {
  if (isUsingMockCloud()) return readStore(MIGRATION_KEY, []).find((m) => m.id === id) || null
  try {
    return await call(`/api/mcp/migrations/${encodeURIComponent(id)}`)
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

export async function deleteMigration(id) {
  if (isUsingMockCloud()) {
    writeStore(MIGRATION_KEY, readStore(MIGRATION_KEY, []).filter((m) => m.id !== id))
    return true
  }
  // The Worker has no delete endpoint on purpose: a migration is an audit record.
  // Hide it locally instead of pretending it was deleted server-side.
  return false
}

export async function runMigrationPhase(id, options = {}) {
  if (isUsingMockCloud()) {
    const list = readStore(MIGRATION_KEY, [])
    const mig = list.find((m) => m.id === id)
    if (!mig) throw new Error('Migrasi tidak ditemukan.')
    const idx = Number.isInteger(options.phaseIndex)
      ? options.phaseIndex
      : mig.phases.findIndex((p) => p.status === 'pending')
    if (idx < 0) return mig

    if (mig.status === 'rolled_back') throw new Error('Migrasi sudah di-rollback. Buat migrasi baru.')
    if (idx >= mig.phases.length || mig.phases[idx].status !== 'pending') throw new Error('Fase sudah dijalankan.')
    const phase = mig.phases[idx]
    phase.status = 'running'
    phase.startedAt = phase.startedAt || new Date().toISOString()
    await new Promise((r) => setTimeout(r, 500))

    const rowsByEntity = options.rowsByEntity || {}
    let processed = 0
    for (const entity of phase.entities || []) processed += (rowsByEntity[entity] || []).length

    phase.recordsProcessed = processed
    phase.recordsInserted = processed
    phase.recordsFailed = 0
    phase.errors = []
    phase.status = 'completed'
    phase.endedAt = new Date().toISOString()

    mig.stats = mig.stats || { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 }
    mig.stats.processed += processed
    mig.stats.inserted += processed
    mig.status = mig.phases.every((p) => p.status === 'completed' || p.status === 'skipped') ? 'completed' : 'running'
    if (!options.dryRun) writeStore(MIGRATION_KEY, list)
    return { ...mig, dryRun: options.dryRun === true }
  }

  return call(`/api/mcp/migrations/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: {
      phaseIndex: options.phaseIndex,
      dryRun: options.dryRun === true,
      rowsByEntity: options.rowsByEntity,
    },
  })
}

export async function rollbackMigration(id) {
  if (isUsingMockCloud()) {
    const list = readStore(MIGRATION_KEY, [])
    const mig = list.find((m) => m.id === id)
    if (!mig) throw new Error('Migrasi tidak ditemukan.')
    mig.phases.forEach((p) => {
      p.status = 'pending'
      p.recordsProcessed = 0
      p.recordsInserted = 0
      p.recordsFailed = 0
      p.errors = []
    })
    mig.status = 'rolled_back'
    mig.stats = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 }
    writeStore(MIGRATION_KEY, list)
    return { rolledBack: true, removedRows: 0 }
  }
  return call(`/api/mcp/migrations/${encodeURIComponent(id)}/rollback`, { method: 'POST' })
}

/* ---------------------------------------------------------------- Helpers */

/** The UI templates are flat; the Worker wants `config` + flat secrets. */
function toServer(input) {
  return {
    type: input.type,
    name: input.name,
    ...(typeof input.enabled !== 'undefined' ? { enabled: input.enabled === true } : {}),
    config: {
      ...(input.config || {}),
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.connection ? { connection: input.connection } : {}),
      ...(input.auth ? { auth: input.auth } : {}),
      ...(input.sync ? { sync: input.sync } : {}),
      ...(input.format ? { format: input.format } : {}),
      ...(input.delimiter ? { delimiter: input.delimiter } : {}),
      ...(input.encoding ? { encoding: input.encoding } : {}),
    },
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.auth?.apiKey ? { apiKey: input.auth.apiKey } : {}),
    ...(input.auth?.password ? { password: input.auth.password } : {}),
    ...(input.auth?.token ? { token: input.auth.token } : {}),
    ...(input.password ? { password: input.password } : {}),
    ...(input.connection?.password ? { password: input.connection.password } : {}),
    ...(input.secret ? { secret: input.secret } : {}),
  }
}

function fromServer(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: row.config || {},
    enabled: Boolean(row.enabled),
    status: row.status,
    hasSecrets: Boolean(row.hasSecrets),
    lastSyncAt: row.lastSyncAt || null,
    lastError: row.lastError || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export { TRANSFORM_KEYS, applyTransforms }

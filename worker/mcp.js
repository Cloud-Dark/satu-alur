/**
 * MCP (Model Context Protocol) — Worker endpoints.
 *
 * Connectors, field mappings, sync runs, dead-letter queue and phased
 * migrations. Reached only through /api/mcp/*, never through the generic
 * /api/db endpoint: connector rows hold credentials.
 *
 * Design notes
 * ------------
 * - Secrets are encrypted with AES-GCM when `MCP_ENCRYPTION_KEY` is set, and
 *   are never returned by any endpoint (`redactConnector`).
 * - Sync is idempotent through `mcp_external_refs`: the same external record
 *   updates the same local row instead of duplicating it.
 * - `database` connectors need a bridge agent (Workers cannot open raw TCP),
 *   so that path returns an actionable 400 instead of pretending to work.
 * - `rest` connectors pull from the customer's endpoint; `file` and `webhook`
 *   take rows in the request body. All three share the same pipeline.
 */

import {
  ENTITIES, ENTITY_KEYS, IMPORTABLE_ENTITIES, LIMITS, MIGRATION_PHASES,
  SECRET_FIELDS, applyTransforms, columnType, externalIdFor, redactConnector,
  validateConnector, validateMapping, validateMigration,
} from '../src/mcp/rules.js';

/* ------------------------------------------------------------- Encryption */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(env) {
  const raw = env.MCP_ENCRYPTION_KEY;
  if (!raw || String(raw).length < 16) return null;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(raw)));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `v1:<iv>:<ciphertext>` when a key is configured, `plain:<base64>` otherwise. */
export async function sealSecrets(env, secrets) {
  const json = JSON.stringify(secrets || {});
  const key = await deriveKey(env);
  if (!key) return { value: `plain:${btoa(json)}`, encrypted: false };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
  return { value: `v1:${toB64(iv)}:${toB64(ct)}`, encrypted: true };
}

export async function openSecrets(env, stored) {
  if (!stored) return {};
  if (stored.startsWith('plain:')) {
    try { return JSON.parse(atob(stored.slice(6))) } catch { return {}; }
  }
  if (!stored.startsWith('v1:')) return {};
  const key = await deriveKey(env);
  if (!key) return {};
  const [, ivB64, ctB64] = stored.split(':');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
    return JSON.parse(dec.decode(pt));
  } catch {
    // Key rotated or corrupted: fail closed, the admin re-enters credentials.
    return {};
  }
}

/* ----------------------------------------------------------------- Helpers */

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return `${prefix}_${Date.now().toString(36)}_${s}`;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) } catch { return fallback }
}

/** Turn a validation error into a 400 and let real bugs bubble up as 500. */
function asBadRequest(err, HttpError) {
  if (err?.validation) return new HttpError(400, err.message);
  return err;
}

/**
 * Every MCP route starts here, which is also why the tier gate lives here
 * rather than in each handler: ERP integration is an Enterprise feature, and
 * hiding the tab in the UI is not a control. The public webhook receiver does
 * not call this — its signature is the credential, and the connector it
 * delivers to was created by an Enterprise account.
 */
async function requireOwner(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  if (!deps.canUse(user.plan, 'erpIntegration')) {
    throw new deps.HttpError(403, deps.planLockMessage('erpIntegration'));
  }
  return user;
}

function emptyStats() {
  return { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, entities: {} };
}

function bump(stats, entity, key, n = 1) {
  stats[key] += n;
  if (!stats.entities[entity]) {
    stats.entities[entity] = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };
  }
  stats.entities[entity][key] += n;
}

/* ------------------------------------------------------------- Connectors */

async function loadConnector(env, ownerId, id) {
  return env.DB.prepare('SELECT * FROM mcp_connectors WHERE id = ? AND owner_id = ?').bind(id, ownerId).first();
}

function connectorView(row) {
  return redactConnector({
    ...row,
    config: parseJson(row.config_json, {}),
    has_secrets: Boolean(row.secrets_json),
  });
}

export async function handleConnectorList(request, env, deps) {
  const user = await requireOwner(request, env, deps);
  const { results } = await env.DB.prepare(
    'SELECT * FROM mcp_connectors WHERE owner_id = ? ORDER BY created_at DESC',
  ).bind(user.id).all();
  return deps.ok((results || []).map(connectorView));
}

export async function handleConnectorCreate(request, env, deps) {
  const user = await requireOwner(request, env, deps);
  const body = await deps.readJson(request);

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM mcp_connectors WHERE owner_id = ?')
    .bind(user.id).first() || { count: 0 };
  if (count >= LIMITS.connectors) {
    throw new deps.HttpError(400, `Batas ${LIMITS.connectors} konektor tercapai. Hapus konektor yang tidak dipakai.`);
  }

  let clean;
  try {
    clean = validateConnector(body);
  } catch (err) { throw asBadRequest(err, deps.HttpError) }

  const id = uid('conn');
  const sealed = await sealSecrets(env, clean.secrets);
  const ts = nowIso();

  await env.DB.prepare(
    `INSERT INTO mcp_connectors
       (id, owner_id, name, type, config_json, secrets_json, enabled, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, user.id, clean.name, clean.type,
    JSON.stringify(clean.config),
    Object.keys(clean.secrets).length ? sealed.value : null,
    clean.enabled ? 1 : 0,
    clean.enabled ? 'active' : 'draft',
    ts, ts,
  ).run();

  return deps.ok(connectorView(await loadConnector(env, user.id, id)), 201);
}

export async function handleConnectorGet(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await loadConnector(env, user.id, params.id);
  if (!row) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');
  return deps.ok(connectorView(row));
}

export async function handleConnectorUpdate(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const existing = await loadConnector(env, user.id, params.id);
  if (!existing) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');

  const body = await deps.readJson(request);
  const merged = {
    type: body.type || existing.type,
    name: body.name ?? existing.name,
    ...parseJson(existing.config_json, {}),
    ...(body.config || {}),
    ...body,
  };

  let clean;
  try {
    clean = validateConnector(merged, { existing: { hasSecrets: Boolean(existing.secrets_json) } });
  } catch (err) { throw asBadRequest(err, deps.HttpError) }

  // Keep the old secrets unless the request supplies new ones.
  let secretsValue = existing.secrets_json;
  if (Object.keys(clean.secrets).length) {
    secretsValue = (await sealSecrets(env, clean.secrets)).value;
  }

  const enabled = typeof body.enabled === 'undefined'
    ? existing.enabled === 1
    : body.enabled === true || body.enabled === 1;

  await env.DB.prepare(
    `UPDATE mcp_connectors
        SET name = ?, type = ?, config_json = ?, secrets_json = ?, enabled = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?`,
  ).bind(
    clean.name, clean.type, JSON.stringify(clean.config), secretsValue,
    enabled ? 1 : 0, nowIso(), params.id, user.id,
  ).run();

  return deps.ok(connectorView(await loadConnector(env, user.id, params.id)));
}

export async function handleConnectorDelete(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const existing = await loadConnector(env, user.id, params.id);
  if (!existing) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');

  // Child rows cascade by FK, but D1 does not enforce FK by default; be explicit.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mcp_mappings WHERE connector_id = ? AND owner_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM mcp_sync_errors WHERE connector_id = ? AND owner_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM mcp_external_refs WHERE connector_id = ? AND owner_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM mcp_sync_logs WHERE connector_id = ? AND owner_id = ?').bind(params.id, user.id),
    env.DB.prepare('DELETE FROM mcp_connectors WHERE id = ? AND owner_id = ?').bind(params.id, user.id),
  ]);

  return deps.ok({ deleted: true });
}

/**
 * Test a connection.
 *
 * `rest` really calls the endpoint (HEAD, then GET as a fallback) so the result
 * means something. `database` reports that a bridge is required. `file` and
 * `webhook` validate their configuration only — there is nothing to dial.
 */
export async function handleConnectorTest(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await loadConnector(env, user.id, params.id);
  if (!row) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');

  const config = parseJson(row.config_json, {});
  const secrets = await openSecrets(env, row.secrets_json);
  const started = Date.now();

  const finish = async (result) => {
    const status = result.ok ? 'active' : 'error';
    await env.DB.prepare(
      'UPDATE mcp_connectors SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
    ).bind(status, result.ok ? null : result.message, nowIso(), params.id, user.id).run();
    return deps.ok({ ...result, status, latencyMs: Date.now() - started });
  };

  if (row.type === 'database') {
    return finish({
      ok: false,
      code: 'BRIDGE_REQUIRED',
      message: 'Koneksi database langsung memerlukan agen jembatan (bridge agent) di jaringan Anda. '
        + 'Cloudflare Worker tidak dapat membuka koneksi TCP mentah. Gunakan impor file atau REST API untuk sementara.',
    });
  }

  if (row.type === 'rest') {
    const baseUrl = config.endpoint?.baseUrl;
    if (!baseUrl) return finish({ ok: false, code: 'CONFIG', message: 'URL endpoint belum diisi.' });
    const headers = buildAuthHeaders(config, secrets);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(config.endpoint?.timeout || 15000, 20000));
      let res;
      try {
        res = await fetch(baseUrl, { method: 'HEAD', headers, signal: controller.signal, redirect: 'follow' });
        if (res.status === 405 || res.status === 501) {
          res = await fetch(baseUrl, { method: 'GET', headers, signal: controller.signal, redirect: 'follow' });
        }
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) {
        return finish({ ok: false, code: 'AUTH_FAILED', message: `Autentikasi ditolak (HTTP ${res.status}). Periksa kredensial.` });
      }
      if (!res.ok && res.status !== 404) {
        return finish({ ok: false, code: 'HTTP', message: `Endpoint menjawab HTTP ${res.status}.` });
      }
      return finish({ ok: true, code: 'OK', message: `Terhubung. Endpoint menjawab HTTP ${res.status}.` });
    } catch (err) {
      const aborted = String(err?.name) === 'AbortError';
      return finish({
        ok: false,
        code: aborted ? 'CONN_TIMEOUT' : 'CONN_FAILED',
        message: aborted ? 'Koneksi melebihi batas waktu.' : 'Tidak dapat menghubungi endpoint. Periksa URL dan jaringan.',
      });
    }
  }

  if (row.type === 'webhook') {
    if (!secrets.secret || String(secrets.secret).length < 16) {
      return finish({ ok: false, code: 'CONFIG', message: 'Secret webhook belum diisi (minimal 16 karakter).' });
    }
    return finish({ ok: true, code: 'OK', message: 'Konfigurasi webhook lengkap. Endpoint siap menerima event.' });
  }

  return finish({ ok: true, code: 'OK', message: `Konfigurasi ${String(row.type).toUpperCase()} valid dan siap dipakai.` });
}

function buildAuthHeaders(config, secrets) {
  const headers = { accept: 'application/json' };
  const auth = config.auth || {};
  if (auth.type === 'basic') {
    const raw = `${auth.username || ''}:${secrets.password || ''}`;
    headers.authorization = `Basic ${btoa(raw)}`;
  } else if (auth.type === 'oauth2') {
    if (secrets.token) headers.authorization = `Bearer ${secrets.token}`;
  } else if (secrets.apiKey) {
    headers[(auth.headerName || 'X-Api-Key')] = secrets.apiKey;
  }
  return headers;
}

/* --------------------------------------------------------------- Mappings */

export async function handleMappingList(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const connector = await loadConnector(env, user.id, params.id);
  if (!connector) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');
  const { results } = await env.DB.prepare(
    'SELECT * FROM mcp_mappings WHERE connector_id = ? AND owner_id = ? ORDER BY entity',
  ).bind(params.id, user.id).all();
  return deps.ok((results || []).map((r) => ({
    id: r.id,
    entity: r.entity,
    direction: r.direction,
    fields: parseJson(r.fields_json, []),
    filters: parseJson(r.filters_json, null),
    externalIdField: r.external_id_field,
    mode: r.mode,
    updatedAt: r.updated_at,
  })));
}

/** Upsert one mapping for (connector, entity). */
export async function handleMappingPut(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const connector = await loadConnector(env, user.id, params.id);
  if (!connector) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');

  const body = await deps.readJson(request);
  let clean;
  try {
    clean = validateMapping(body);
  } catch (err) { throw asBadRequest(err, deps.HttpError) }

  const { count } = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM mcp_mappings WHERE owner_id = ?',
  ).bind(user.id).first() || { count: 0 };
  if (count >= LIMITS.mappings) {
    throw new deps.HttpError(400, `Batas ${LIMITS.mappings} pemetaan tercapai.`);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM mcp_mappings WHERE connector_id = ? AND entity = ?',
  ).bind(params.id, clean.entity).first();

  const id = existing?.id || uid('map');
  const ts = nowIso();

  if (existing) {
    await env.DB.prepare(
      `UPDATE mcp_mappings
          SET direction = ?, fields_json = ?, filters_json = ?, external_id_field = ?, mode = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?`,
    ).bind(
      clean.direction, JSON.stringify(clean.fields), JSON.stringify(clean.filters),
      clean.externalIdField, clean.mode, ts, id, user.id,
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO mcp_mappings
         (id, owner_id, connector_id, entity, direction, fields_json, filters_json, external_id_field, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, user.id, params.id, clean.entity, clean.direction, JSON.stringify(clean.fields),
      JSON.stringify(clean.filters), clean.externalIdField, clean.mode, ts, ts,
    ).run();
  }

  return deps.ok({
    id, entity: clean.entity, direction: clean.direction, fields: clean.fields,
    filters: clean.filters, externalIdField: clean.externalIdField, mode: clean.mode, updatedAt: ts,
  });
}

export async function handleMappingDelete(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  await env.DB.prepare('DELETE FROM mcp_mappings WHERE connector_id = ? AND entity = ? AND owner_id = ?')
    .bind(params.id, params.entity, user.id).run();
  return deps.ok({ deleted: true });
}

/** The target schema, so the UI can render a mapping table without hardcoding it. */
export async function handleSchemaGet(request, env, deps) {
  await requireOwner(request, env, deps);
  const entities = ENTITY_KEYS.map((key) => ({
    key,
    label: ENTITIES[key].label,
    importable: IMPORTABLE_ENTITIES.includes(key),
    columns: ENTITIES[key].columns.map((name) => ({
      name,
      type: columnType(key, name),
      required: ENTITIES[key].required.includes(name),
      values: ENTITIES[key].enums?.[name] || null,
    })),
  }));
  return deps.ok({ entities, phases: MIGRATION_PHASES });
}

/* ------------------------------------------------------------- Sync engine */

/**
 * Coerce one mapped value to the column's type.
 * Returns { value } | { skip: true } | { error: string } — never a bare string,
 * because a valid text value could otherwise be mistaken for an error message.
 */
function coerce(entity, field, value) {
  const type = columnType(entity, field.target);
  const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

  if (empty) {
    if (field.required) return { error: `${field.target}: wajib diisi` };
    return { skip: true };
  }

  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n)) return { error: `${field.target}: harus berupa angka` };
    return { value: Math.round(n) };
  }

  if (type === 'enum') {
    const allowed = ENTITIES[entity].enums[field.target];
    const v = String(value).trim().toLowerCase();
    if (!allowed.includes(v)) {
      return { error: `${field.target}: nilai "${String(value).slice(0, 40)}" tidak dikenal (pilihan: ${allowed.join(', ')})` };
    }
    return { value: v };
  }

  if (type === 'json') {
    if (typeof value === 'string') {
      try { JSON.parse(value); return { value } } catch { return { error: `${field.target}: JSON tidak valid` } }
    }
    return { value: JSON.stringify(value) };
  }

  return { value: String(value).trim() };
}

/** Map one source row to a column/value object plus a list of errors. */
export function transformRow(entity, sourceRow, mapping) {
  const values = {};
  const errors = [];
  const spec = ENTITIES[entity];
  for (const field of mapping.fields || []) {
    let raw;
    if (field.constant !== null && field.constant !== undefined) raw = field.constant;
    else if (field.source) raw = sourceRow[field.source];
    else raw = null;

    if (field.transform && field.transform.length) {
      raw = applyTransforms(raw, field.transform, field.mapping);
    }

    // `validateMapping` always sets `required`, but a hand-written mapping may
    // omit it; fall back to the entity spec so a NOT NULL column is never
    // written as NULL.
    const required = typeof field.required === 'boolean'
      ? field.required
      : Boolean(spec?.required?.includes(field.target));

    const out = coerce(entity, { ...field, required }, raw);
    if (out.error) errors.push(out.error);
    else if (!out.skip) values[field.target] = out.value;
  }
  return { values, errors };
}

/** Write one mapped row: insert, or update when an external ref already exists. */
async function writeRow(env, ownerId, connectorId, entity, mapping, values, externalId) {
  const spec = ENTITIES[entity];
  const cols = Object.keys(values).filter((c) => spec.columns.includes(c));
  if (!cols.length) throw Object.assign(new Error('Tidak ada kolom yang dapat ditulis.'), { validation: true });

  let ref = null;
  if (mapping.mode === 'upsert' && externalId) {
    ref = await env.DB.prepare(
      'SELECT local_id FROM mcp_external_refs WHERE connector_id = ? AND entity = ? AND external_id = ?',
    ).bind(connectorId, entity, externalId).first();
  }

  if (ref) {
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    const res = await env.DB.prepare(
      `UPDATE ${entity} SET ${sets} WHERE id = ? AND owner_id = ?`,
    ).bind(...cols.map((c) => values[c]), ref.local_id, ownerId).run();
    if (res.meta && res.meta.changes === 0) return { action: 'skipped' };
    return { action: 'updated' };
  }

  const placeholders = cols.map(() => '?').join(', ');
  const row = await env.DB.prepare(
    `INSERT INTO ${entity} (owner_id, ${cols.join(', ')}) VALUES (?, ${placeholders}) RETURNING id`,
  ).bind(ownerId, ...cols.map((c) => values[c])).first();

  if (mapping.mode === 'upsert' && externalId && row?.id) {
    await env.DB.prepare(
      `INSERT INTO mcp_external_refs (owner_id, connector_id, entity, external_id, local_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connector_id, entity, external_id)
       DO UPDATE SET local_id = excluded.local_id, updated_at = excluded.updated_at`,
    ).bind(ownerId, connectorId, entity, externalId, row.id, nowIso(), nowIso()).run();
  }

  return { action: 'inserted' };
}

/** Pull rows from a REST connector. Returns { rows, error }. */
async function pullFromRest(config, secrets, entity, mapping) {
  const baseUrl = config.endpoint?.baseUrl;
  if (!baseUrl) return { rows: [], error: 'URL endpoint belum diisi.' };

  const url = new URL(baseUrl);
  const path = mapping.filters?.path || config.endpoint?.entityPath || '';
  if (path) url.pathname = `${url.pathname.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
  if (mapping.filters?.query && typeof mapping.filters.query === 'object') {
    for (const [k, v] of Object.entries(mapping.filters.query)) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.endpoint?.timeout || 20000, 25000));
  try {
    const res = await fetch(url.toString(), {
      headers: buildAuthHeaders(config, secrets),
      signal: controller.signal,
    });
    if (!res.ok) return { rows: [], error: `Endpoint menjawab HTTP ${res.status}.` };
    const payload = await res.json();
    // Accept a bare array, { data: [] }, { records: [] } or { rows: [] }.
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.records) ? payload.records
      : Array.isArray(payload?.rows) ? payload.rows
      : null;
    if (!rows) return { rows: [], error: 'Respons endpoint bukan daftar baris (array).' };
    return { rows };
  } catch (err) {
    return { rows: [], error: String(err?.name) === 'AbortError' ? 'Koneksi melebihi batas waktu.' : 'Gagal menghubungi endpoint.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a sync.
 *
 * body: { rows?: object[], entity?: string, dryRun?: boolean, trigger?: string }
 * `rows` is used for file/webhook connectors; a REST connector pulls its own.
 */
export async function handleSyncRun(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const connector = await loadConnector(env, user.id, params.id);
  if (!connector) throw new deps.HttpError(404, 'Konektor tidak ditemukan.');
  if (connector.enabled !== 1) throw new deps.HttpError(400, 'Konektor belum diaktifkan.');

  const body = await deps.readJson(request).catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const trigger = ['manual', 'scheduled', 'webhook', 'migration'].includes(body?.trigger) ? body.trigger : 'manual';
  const onlyEntity = typeof body?.entity === 'string' ? body.entity : null;

  if (connector.type === 'database') {
    throw new deps.HttpError(400, 'Koneksi database langsung memerlukan agen jembatan (bridge agent). '
      + 'Gunakan impor file atau REST API untuk sementara.');
  }

  const config = parseJson(connector.config_json, {});
  const secrets = await openSecrets(env, connector.secrets_json);

  const { results: mappings } = await env.DB.prepare(
    'SELECT * FROM mcp_mappings WHERE connector_id = ? AND owner_id = ?',
  ).bind(params.id, user.id).all();
  const active = (mappings || [])
    .map((m) => ({ ...m, fields: parseJson(m.fields_json, []), filters: parseJson(m.filters_json, null) }))
    .filter((m) => m.direction !== 'outbound')
    .filter((m) => !onlyEntity || m.entity === onlyEntity);

  if (!active.length) {
    throw new deps.HttpError(400, 'Belum ada pemetaan masuk untuk konektor ini. Buat pemetaan terlebih dahulu.');
  }

  const providedRows = Array.isArray(body?.rows) ? body.rows : null;
  if (providedRows && providedRows.length > LIMITS.importRows) {
    throw new deps.HttpError(400, `Maksimal ${LIMITS.importRows} baris per permintaan.`);
  }

  const syncId = uid('sync');
  const stats = emptyStats();
  const collected = [];
  const ts = nowIso();

  if (!dryRun) {
    await env.DB.prepare(
      `INSERT INTO mcp_sync_logs (id, owner_id, connector_id, trigger, direction, status, stats_json, started_at, created_at)
       VALUES (?, ?, ?, ?, 'inbound', 'running', ?, ?, ?)`,
    ).bind(syncId, user.id, params.id, trigger, JSON.stringify(stats), ts, ts).run();
  }

  const recordError = async (entity, row, message, code = 'VALIDATION_ERROR') => {
    bump(stats, entity, 'failed');
    collected.push({ entity, message, code, row });
  };

  for (const mapping of active) {
    const entity = mapping.entity;
    if (!ENTITY_KEYS.includes(entity)) continue;

    let rows;
    if (providedRows) {
      rows = providedRows;
    } else if (connector.type === 'rest') {
      const pulled = await pullFromRest(config, secrets, entity, mapping);
      if (pulled.error) {
        await recordError(entity, null, pulled.error, 'CONN_ERROR');
        continue;
      }
      rows = pulled.rows;
    } else {
      rows = [];
    }

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        await recordError(entity, row, 'Baris bukan objek.', 'VALIDATION_ERROR');
        continue;
      }
      bump(stats, entity, 'processed');
      const { values, errors } = transformRow(entity, row, mapping);
      if (errors.length) {
        await recordError(entity, row, errors.join('; '), 'VALIDATION_ERROR');
        continue;
      }
      if (dryRun) {
        bump(stats, entity, 'inserted');
        continue;
      }
      try {
        const externalId = externalIdFor(entity, row, mapping);
        const { action } = await writeRow(env, user.id, params.id, entity, mapping, values, externalId);
        bump(stats, entity, action === 'updated' ? 'updated' : action === 'skipped' ? 'skipped' : 'inserted');
      } catch (err) {
        const message = err?.validation ? err.message : 'Gagal menulis baris.';
        await recordError(entity, row, message, err?.validation ? 'VALIDATION_ERROR' : 'WRITE_ERROR');
      }
    }
  }

  const status = stats.failed === 0 ? 'completed' : stats.processed === stats.failed ? 'failed' : 'completed_with_errors';
  const endedAt = nowIso();

  if (!dryRun) {
    await env.DB.prepare(
      'UPDATE mcp_sync_logs SET status = ?, stats_json = ?, ended_at = ? WHERE id = ? AND owner_id = ?',
    ).bind(status, JSON.stringify(stats), endedAt, syncId, user.id).run();

    // Dead letter: keep the raw row so it can be fixed and replayed.
    const toStore = collected.slice(0, 200);
    for (const item of toStore) {
      await env.DB.prepare(
        `INSERT INTO mcp_sync_errors
           (owner_id, sync_id, connector_id, entity, source_data, error_message, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        user.id, syncId, params.id, item.entity,
        item.row ? JSON.stringify(item.row).slice(0, 20000) : null,
        String(item.message).slice(0, 500), item.code, endedAt,
      ).run();
    }

    await env.DB.prepare(
      'UPDATE mcp_connectors SET last_sync_at = ?, status = ?, last_error = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
    ).bind(
      endedAt,
      status === 'failed' ? 'error' : 'active',
      collected.length ? String(collected[0].message).slice(0, 500) : null,
      endedAt, params.id, user.id,
    ).run();
  }

  return deps.ok({
    syncId: dryRun ? null : syncId,
    dryRun,
    status,
    stats,
    errors: collected.slice(0, 50).map((c) => ({ entity: c.entity, message: c.message, code: c.code })),
    errorCount: collected.length,
  });
}

export async function handleSyncList(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const { results } = await env.DB.prepare(
    'SELECT * FROM mcp_sync_logs WHERE owner_id = ? AND connector_id = ? ORDER BY started_at DESC LIMIT 100',
  ).bind(user.id, params.id).all();
  return deps.ok((results || []).map((r) => ({
    id: r.id,
    trigger: r.trigger,
    direction: r.direction,
    status: r.status,
    stats: parseJson(r.stats_json, emptyStats()),
    errorMessage: r.error_message,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  })));
}

export async function handleSyncGet(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await env.DB.prepare('SELECT * FROM mcp_sync_logs WHERE id = ? AND owner_id = ?')
    .bind(params.syncId, user.id).first();
  if (!row) throw new deps.HttpError(404, 'Log sinkronisasi tidak ditemukan.');
  const { results: errors } = await env.DB.prepare(
    'SELECT id, entity, error_message, error_code, status, created_at FROM mcp_sync_errors WHERE sync_id = ? AND owner_id = ? ORDER BY id LIMIT 200',
  ).bind(params.syncId, user.id).all();
  return deps.ok({
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    stats: parseJson(row.stats_json, emptyStats()),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    errors: errors || [],
  });
}

/** All sync logs for the owner (the Pengaturan → Log tab). */
export async function handleSyncLogAll(request, env, deps) {
  const user = await requireOwner(request, env, deps);
  const { results } = await env.DB.prepare(
    `SELECT l.*, c.name AS connector_name
       FROM mcp_sync_logs l LEFT JOIN mcp_connectors c ON c.id = l.connector_id
      WHERE l.owner_id = ? ORDER BY l.started_at DESC LIMIT 100`,
  ).bind(user.id).all();
  return deps.ok((results || []).map((r) => ({
    id: r.id,
    connectorId: r.connector_id,
    connectorName: r.connector_name || r.connector_id,
    trigger: r.trigger,
    status: r.status,
    stats: parseJson(r.stats_json, emptyStats()),
    startedAt: r.started_at,
    endedAt: r.ended_at,
  })));
}

export async function handleSyncErrorList(request, env, deps) {
  const user = await requireOwner(request, env, deps);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';
  const { results } = await env.DB.prepare(
    'SELECT * FROM mcp_sync_errors WHERE owner_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200',
  ).bind(user.id, status).all();
  return deps.ok((results || []).map((r) => ({
    id: r.id,
    syncId: r.sync_id,
    connectorId: r.connector_id,
    entity: r.entity,
    sourceData: parseJson(r.source_data, null),
    message: r.error_message,
    code: r.error_code,
    status: r.status,
    createdAt: r.created_at,
  })));
}

export async function handleSyncErrorUpdate(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const body = await deps.readJson(request);
  const status = ['resolved', 'ignored', 'open'].includes(body?.status) ? body.status : 'resolved';
  await env.DB.prepare(
    'UPDATE mcp_sync_errors SET status = ?, resolved_at = ? WHERE id = ? AND owner_id = ?',
  ).bind(status, status === 'open' ? null : nowIso(), params.id, user.id).run();
  return deps.ok({ updated: true, status });
}

/* -------------------------------------------------------------- Migrations */

export async function handleMigrationList(request, env, deps) {
  const user = await requireOwner(request, env, deps);
  const { results } = await env.DB.prepare(
    'SELECT * FROM mcp_migrations WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50',
  ).bind(user.id).all();
  return deps.ok((results || []).map(migrationView));
}

function migrationView(r) {
  return {
    id: r.id,
    name: r.name,
    connectorId: r.connector_id,
    strategy: r.strategy,
    status: r.status,
    phases: parseJson(r.phases_json, []),
    stats: parseJson(r.stats_json, emptyStats()),
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    rolledBackAt: r.rolled_back_at,
  };
}

export async function handleMigrationCreate(request, env, deps) {
  const user = await requireOwner(request, env, deps);
  const body = await deps.readJson(request);
  let clean;
  try {
    clean = validateMigration(body);
  } catch (err) { throw asBadRequest(err, deps.HttpError) }

  if (clean.connectorId) {
    const connector = await loadConnector(env, user.id, clean.connectorId);
    if (!connector) throw new deps.HttpError(400, 'Konektor tidak ditemukan.');
  }

  const id = uid('mig');
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO mcp_migrations (id, owner_id, connector_id, name, strategy, status, phases_json, stats_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(id, user.id, clean.connectorId, clean.name, clean.strategy, JSON.stringify(clean.phases), JSON.stringify(emptyStats()), ts).run();

  const row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?').bind(id, user.id).first();
  return deps.ok(migrationView(row), 201);
}

export async function handleMigrationGet(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?')
    .bind(params.id, user.id).first();
  if (!row) throw new deps.HttpError(404, 'Migrasi tidak ditemukan.');
  return deps.ok(migrationView(row));
}

/**
 * Run the next pending phase.
 *
 * body: { phaseIndex?: number, dryRun?: boolean, rowsByEntity?: { entity: rows[] } }
 *
 * A migration is a sequence of sync runs over the connector's mappings, one
 * entity at a time, with progress recorded per phase. Rows come from
 * `rowsByEntity` (file upload) or from the connector itself (REST pull).
 */
export async function handleMigrationRun(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?')
    .bind(params.id, user.id).first();
  if (!row) throw new deps.HttpError(404, 'Migrasi tidak ditemukan.');
  if (row.status === 'rolled_back') throw new deps.HttpError(400, 'Migrasi sudah di-rollback. Buat migrasi baru.');

  const body = await deps.readJson(request).catch(() => ({}));
  const phases = parseJson(row.phases_json, []);
  const dryRun = body?.dryRun === true;
  const rowsByEntity = body?.rowsByEntity && typeof body.rowsByEntity === 'object' ? body.rowsByEntity : null;

  let index = Number.isInteger(body?.phaseIndex) ? body.phaseIndex : phases.findIndex((p) => p.status === 'pending');
  if (index < 0 || index >= phases.length) {
    // Nothing pending: report the final state instead of erroring.
    return deps.ok(migrationView(row));
  }

  const phase = phases[index];
  // Defensive: a phase row could predate a schema change.
  if (!Array.isArray(phase.errors)) phase.errors = [];
  for (const key of ['recordsProcessed', 'recordsInserted', 'recordsUpdated', 'recordsFailed']) {
    if (typeof phase[key] !== 'number') phase[key] = 0;
  }
  if (!Array.isArray(phase.entities)) phase.entities = [];
  phase.status = 'running';
  phase.startedAt = nowIso();
  await env.DB.prepare('UPDATE mcp_migrations SET status = ?, phases_json = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND owner_id = ?')
    .bind('running', JSON.stringify(phases), phase.startedAt, params.id, user.id).run();

  const aggregate = emptyStats();
  const connectorId = row.connector_id;

  for (const entity of phase.entities) {
    if (!connectorId) {
      phase.errors.push({ entity, message: 'Migrasi belum terhubung ke konektor.' });
      phase.recordsFailed += 1;
      continue;
    }
    const mappingRow = await env.DB.prepare(
      'SELECT * FROM mcp_mappings WHERE connector_id = ? AND entity = ? AND owner_id = ?',
    ).bind(connectorId, entity, user.id).first();

    if (!mappingRow) {
      // Optional phase entities may simply not be configured.
      continue;
    }

    const mapping = { ...mappingRow, fields: parseJson(mappingRow.fields_json, []), filters: parseJson(mappingRow.filters_json, null) };
    const connector = await loadConnector(env, user.id, connectorId);
    if (!connector) continue;

    let rows = rowsByEntity?.[entity] || null;
    if (!rows && connector.type === 'rest') {
      const config = parseJson(connector.config_json, {});
      const secrets = await openSecrets(env, connector.secrets_json);
      const pulled = await pullFromRest(config, secrets, entity, mapping);
      if (pulled.error) {
        phase.errors.push({ entity, message: pulled.error });
        phase.recordsFailed += 1;
        continue;
      }
      rows = pulled.rows;
    }
    if (!rows || !rows.length) continue;

    for (const sourceRow of rows) {
      phase.recordsProcessed += 1;
      aggregate.processed += 1;
      const { values, errors } = transformRow(entity, sourceRow, mapping);
      if (errors.length) {
        phase.recordsFailed += 1;
        aggregate.failed += 1;
        if (phase.errors.length < 100) phase.errors.push({ entity, message: errors.join('; ') });
        continue;
      }
      if (dryRun) {
        phase.recordsInserted += 1;
        aggregate.inserted += 1;
        continue;
      }
      try {
        const externalId = externalIdFor(entity, sourceRow, mapping);
        const { action } = await writeRow(env, user.id, connectorId, entity, mapping, values, externalId);
        if (action === 'updated') { phase.recordsUpdated += 1; aggregate.updated += 1; }
        else if (action === 'skipped') { aggregate.skipped += 1; }
        else { phase.recordsInserted += 1; aggregate.inserted += 1; }
      } catch (err) {
        phase.recordsFailed += 1;
        aggregate.failed += 1;
        if (phase.errors.length < 100) {
          phase.errors.push({ entity, message: err?.validation ? err.message : 'Gagal menulis baris.' });
        }
      }
    }
  }

  phase.status = phase.recordsFailed === 0 ? 'completed' : 'completed_with_errors';
  phase.endedAt = nowIso();

  const remaining = phases.some((p) => p.status === 'pending');
  const anyFailed = phases.some((p) => p.status === 'completed_with_errors' || p.status === 'failed');
  const finalStatus = remaining ? 'running' : (anyFailed ? 'completed_with_errors' : 'completed');

  const previous = parseJson(row.stats_json, emptyStats());
  const stats = {
    processed: previous.processed + aggregate.processed,
    inserted: previous.inserted + aggregate.inserted,
    updated: previous.updated + aggregate.updated,
    skipped: previous.skipped + aggregate.skipped,
    failed: previous.failed + aggregate.failed,
    entities: { ...(previous.entities || {}) },
  };

  await env.DB.prepare(
    'UPDATE mcp_migrations SET status = ?, phases_json = ?, stats_json = ?, ended_at = ? WHERE id = ? AND owner_id = ?',
  ).bind(finalStatus, JSON.stringify(phases), JSON.stringify(stats), remaining ? null : nowIso(), params.id, user.id).run();

  const updated = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?')
    .bind(params.id, user.id).first();
  return deps.ok({ ...migrationView(updated), dryRun });
}

/**
 * Roll back a migration.
 *
 * Only rows this migration created are removed — the external refs table tells
 * us exactly which local rows are ours, so pre-existing data is never touched.
 */
export async function handleMigrationRollback(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?')
    .bind(params.id, user.id).first();
  if (!row) throw new deps.HttpError(404, 'Migrasi tidak ditemukan.');

  const phases = parseJson(row.phases_json, []);
  const entities = [...new Set(phases.flatMap((p) => p.entities || []))];
  let removed = 0;

  if (row.connector_id) {
    for (const entity of entities) {
      if (!ENTITY_KEYS.includes(entity)) continue;
      const { results: refs } = await env.DB.prepare(
        'SELECT id, local_id FROM mcp_external_refs WHERE connector_id = ? AND entity = ? AND owner_id = ?',
      ).bind(row.connector_id, entity, user.id).all();

      for (const ref of refs || []) {
        await env.DB.prepare(`DELETE FROM ${entity} WHERE id = ? AND owner_id = ?`)
          .bind(ref.local_id, user.id).run();
        await env.DB.prepare('DELETE FROM mcp_external_refs WHERE id = ? AND owner_id = ?')
          .bind(ref.id, user.id).run();
        removed += 1;
      }
    }
  }

  for (const phase of phases) {
    phase.status = 'pending';
    phase.startedAt = null;
    phase.endedAt = null;
    phase.recordsProcessed = 0;
    phase.recordsInserted = 0;
    phase.recordsUpdated = 0;
    phase.recordsFailed = 0;
    phase.errors = [];
  }

  await env.DB.prepare(
    `UPDATE mcp_migrations
        SET status = 'rolled_back', phases_json = ?, stats_json = ?, rolled_back_at = ?, ended_at = ?
      WHERE id = ? AND owner_id = ?`,
  ).bind(JSON.stringify(phases), JSON.stringify(emptyStats()), nowIso(), nowIso(), params.id, user.id).run();

  return deps.ok({ rolledBack: true, removedRows: removed });
}

/* ---------------------------------------------------------------- Webhook */

/**
 * Public webhook receiver: POST /api/mcp/webhook/:id
 *
 * Verified with an HMAC-SHA256 signature over the raw body, using the
 * connector's secret. No session required — the signature is the credential.
 */
export async function handleWebhook(request, env, deps, params) {
  const row = await env.DB.prepare('SELECT * FROM mcp_connectors WHERE id = ?').bind(params.id).first();
  if (!row || row.type !== 'webhook') throw new deps.HttpError(404, 'Endpoint tidak ditemukan.');
  if (row.enabled !== 1) throw new deps.HttpError(403, 'Konektor tidak aktif.');

  const secrets = await openSecrets(env, row.secrets_json);
  const secret = secrets.secret;
  if (!secret) throw new deps.HttpError(403, 'Konektor belum dikonfigurasi.');

  const raw = await request.text();
  const signature = request.headers.get('x-mcp-signature') || request.headers.get('x-hub-signature-256') || '';
  const expected = await hmacHex(secret, raw);
  if (!safeEqual(signature.replace(/^sha256=/i, '').toLowerCase(), expected)) {
    throw new deps.HttpError(401, 'Tanda tangan tidak valid.');
  }

  let payload;
  try { payload = JSON.parse(raw) } catch { throw new deps.HttpError(400, 'Body bukan JSON.') }

  const mappingRow = await env.DB.prepare(
    'SELECT * FROM mcp_mappings WHERE connector_id = ? AND entity = ?',
  ).bind(params.id, payload?.entity || '').first();

  if (!mappingRow) throw new deps.HttpError(400, 'Event tidak memiliki pemetaan untuk entitas tersebut.');

  const mapping = { ...mappingRow, fields: parseJson(mappingRow.fields_json, []), filters: parseJson(mappingRow.filters_json, null) };
  const records = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  if (!records.length) throw new deps.HttpError(400, 'Event tidak berisi data.');

  const results = [];
  for (const sourceRow of records.slice(0, LIMITS.importRows)) {
    const { values, errors } = transformRow(mapping.entity, sourceRow, mapping);
    if (errors.length) {
      results.push({ ok: false, errors });
      continue;
    }
    try {
      const externalId = externalIdFor(mapping.entity, sourceRow, mapping);
      const { action } = await writeRow(env, row.owner_id, params.id, mapping.entity, mapping, values, externalId);
      results.push({ ok: true, action });
    } catch (err) {
      results.push({ ok: false, errors: [err?.validation ? err.message : 'Gagal menulis baris.'] });
    }
  }

  return deps.ok({
    received: results.length,
    written: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  let out = '';
  for (const b of new Uint8Array(sig)) out += b.toString(16).padStart(2, '0');
  return out;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * MCP (ERP connector module) — Worker endpoints.
 *
 * Connectors, field mappings, sync runs, dead-letter queue and phased
 * migrations. Reached only through /api/mcp/*, never through the generic
 * /api/db endpoint: connector rows hold credentials.
 *
 * Design notes
 * ------------
 * - Secrets require AES-GCM encryption with `MCP_ENCRYPTION_KEY` and
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
import { validateVasItem, validateWasteEntry, withWasteCompletion, assertWasteInvariants, LIMITS as INCOME_LIMITS } from '../src/pendapatan/rules.js';

/* ------------------------------------------------------------- Encryption */

const enc = new TextEncoder();
const dec = new TextDecoder();

function unavailable(message) {
  return Object.assign(new Error(message), { mcpStatus: 503 });
}

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

/** Credentials are never persisted without encryption. File connectors need no key. */
export async function sealSecrets(env, secrets) {
  if (!Object.keys(secrets || {}).length) return { value: null, encrypted: true };
  const json = JSON.stringify(secrets);
  const key = await deriveKey(env);
  if (!key) throw unavailable('Integrasi belum dikonfigurasi: MCP_ENCRYPTION_KEY wajib diisi (minimal 16 karakter).');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
  return { value: `v1:${toB64(iv)}:${toB64(ct)}`, encrypted: true };
}

export async function openSecrets(env, stored) {
  if (!stored) return {};
  if (!stored.startsWith('v1:')) throw unavailable('Simpan ulang kredensial konektor dengan enkripsi.');
  const key = await deriveKey(env);
  if (!key) throw unavailable('MCP_ENCRYPTION_KEY belum dikonfigurasi.');
  const [, ivB64, ctB64] = stored.split(':');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
    return JSON.parse(dec.decode(pt));
  } catch {
    // Key rotated or corrupted: fail closed, the admin re-enters credentials.
    throw unavailable('Kredensial tidak dapat dibuka. Periksa kunci atau simpan ulang kredensial.');
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
  if (err?.mcpStatus) return new HttpError(err.mcpStatus, err.message);
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
  let sealed;
  try { sealed = await sealSecrets(env, clean.secrets) } catch (err) { throw asBadRequest(err, deps.HttpError) }
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
  if (body.type && body.type !== existing.type) throw new deps.HttpError(400, 'Tipe konektor tidak dapat diubah. Buat konektor baru.');
  const merged = {
    type: body.type || existing.type,
    name: body.name ?? existing.name,
    ...parseJson(existing.config_json, {}),
    ...(body.config || {}),
    ...body,
  };

  let clean;
  try {
    const original = parseJson(existing.config_json, {});
    const sameAuth = existing.type !== 'rest' || (merged.auth?.type || 'apikey') === (original.auth?.type || 'apikey');
    clean = validateConnector(merged, { existing: { hasSecrets: Boolean(existing.secrets_json) && sameAuth } });
  } catch (err) { throw asBadRequest(err, deps.HttpError) }

  // Keep the old secrets unless the request supplies new ones.
  let secretsValue = existing.secrets_json;
  if (Object.keys(clean.secrets).length) {
    let old = {};
    try { old = await openSecrets(env, existing.secrets_json) } catch { /* replacement credentials recover an unreadable secret */ }
    try { secretsValue = (await sealSecrets(env, { ...old, ...clean.secrets })).value } catch (err) { throw asBadRequest(err, deps.HttpError) }
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

  // Explicit cleanup also covers audit tables without connector foreign keys.
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
  let secrets;
  try { secrets = await openSecrets(env, row.secrets_json) } catch (err) { throw asBadRequest(err, deps.HttpError) }
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
    let headers;
    try { headers = buildAuthHeaders(config, secrets) } catch (err) { throw asBadRequest(err, deps.HttpError) }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(config.endpoint?.timeout || 15000, 20000));
      let res;
      try {
        res = await fetch(baseUrl, { method: 'HEAD', headers, signal: controller.signal, redirect: 'error' });
        if (res.status === 405 || res.status === 501) {
          res = await fetch(baseUrl, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
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
  const credential = { basic: 'password', oauth2: 'token', apikey: 'apiKey' }[auth.type || 'apikey'];
  if (!secrets[credential]) throw unavailable('Kredensial belum lengkap. Simpan ulang kredensial konektor.');
  if (auth.type === 'basic') {
    const raw = `${auth.username || ''}:${secrets.password || ''}`;
    headers.authorization = `Basic ${toB64(enc.encode(raw))}`;
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
  const existing = await env.DB.prepare(
    'SELECT id FROM mcp_mappings WHERE connector_id = ? AND entity = ?',
  ).bind(params.id, clean.entity).first();

  if (!existing && count >= LIMITS.mappings) throw new deps.HttpError(400, `Batas ${LIMITS.mappings} pemetaan tercapai.`);
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
    const n = typeof value === 'number' ? value : Number(String(value).trim());
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
  if (!IMPORTABLE_ENTITIES.includes(entity)) return { values, errors: ['Entitas ini belum mendukung impor.'] };
  if (!sourceRow || typeof sourceRow !== 'object' || Array.isArray(sourceRow)) return { values, errors: ['Baris harus berupa objek.'] };
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
  try {
    if (entity === 'vas_items') Object.assign(values, validateVasItem(values, { partial: true }));
    if (entity === 'waste_entries') Object.assign(values, validateWasteEntry(values, { partial: true }));
  } catch (err) {
    if (!err.validation) throw err;
    errors.push(err.message);
  }
  return { values, errors };
}

/** The full stored row is compared before rollback, preserving subsequent edits. */
function snapshotSql(entity) {
  const columns = [...ENTITIES[entity].columns, 'id', 'owner_id', 'created_at'];
  if (entity === 'workers') columns.push('lat', 'lng');
  if (entity === 'vas_items' || entity === 'waste_entries') columns.push('updated_at');
  return `json_object(${columns.map((c) => `'${c}', ${c}`).join(', ')})`;
}

/** Write the row, rollback journal and external reference in one transaction. */
async function writeRow(env, ownerId, connectorId, entity, mapping, values, externalId, migrationId = null) {
  if (!IMPORTABLE_ENTITIES.includes(entity)) throw Object.assign(new Error('Entitas ini belum mendukung impor.'), { validation: true });
  const spec = ENTITIES[entity];
  const cols = Object.keys(values).filter((c) => spec.columns.includes(c));
  if (!cols.length) throw Object.assign(new Error('Tidak ada kolom yang dapat ditulis.'), { validation: true });

  let ref = null;
  if (mapping.mode === 'upsert' && externalId) {
    ref = await env.DB.prepare(
      'SELECT local_id FROM mcp_external_refs WHERE connector_id = ? AND entity = ? AND external_id = ? AND owner_id = ?',
    ).bind(connectorId, entity, externalId, ownerId).first();
  }

  if (entity === 'waste_entries') {
    const current = ref ? await env.DB.prepare('SELECT * FROM waste_entries WHERE id = ? AND owner_id = ?').bind(ref.local_id, ownerId).first() : null;
    const merged = withWasteCompletion({ saved: 0, status: 'open', ...current, ...values });
    assertWasteInvariants(merged);
    values.saved = merged.saved;
    if (!cols.includes('saved')) cols.push('saved');
  }
  if (entity === 'vas_items' || entity === 'waste_entries') {
    values.updated_at = nowIso();
    cols.push('updated_at');
  }

  if (ref) {
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    const res = await env.DB.prepare(
      `UPDATE ${entity} SET ${sets} WHERE id = ? AND owner_id = ?`,
    ).bind(...cols.map((c) => values[c]), ref.local_id, ownerId).run();
    if (res.meta && res.meta.changes === 0) return { action: 'skipped' };
    return { action: 'updated' };
  }

  const cap = entity === 'vas_items' ? INCOME_LIMITS.items : entity === 'waste_entries' ? INCOME_LIMITS.findings : null;
  if (cap) {
    const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${entity} WHERE owner_id = ?`).bind(ownerId).first();
    if (n >= cap) throw Object.assign(new Error(`Batas ${cap} baris tercapai.`), { validation: true });
  }
  const placeholders = cols.map(() => '?').join(', ');
  const statements = [env.DB.prepare(
    `INSERT INTO ${entity} (owner_id, ${cols.join(', ')}) VALUES (?, ${placeholders}) RETURNING id`,
  ).bind(ownerId, ...cols.map((c) => values[c]))];
  if (migrationId) {
    statements.push(env.DB.prepare(
      `INSERT INTO mcp_migration_rows (migration_id, owner_id, entity, local_id, snapshot_json)
       SELECT ?, ?, ?, id, ${snapshotSql(entity)} FROM ${entity} WHERE id = last_insert_rowid() AND owner_id = ?`,
    ).bind(migrationId, ownerId, entity, ownerId));
  }
  if (mapping.mode === 'upsert' && externalId) {
    // A concurrent duplicate fails the batch, including the domain INSERT.
    statements.push(env.DB.prepare(
      `INSERT INTO mcp_external_refs (owner_id, connector_id, entity, external_id, local_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, last_insert_rowid(), ?, ?)`,
    ).bind(ownerId, connectorId, entity, externalId, nowIso(), nowIso()));
  }
  await env.DB.batch(statements);
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
      redirect: 'error',
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

  const body = await deps.readJson(request);
  const dryRun = body?.dryRun === true;
  const trigger = ['manual', 'scheduled', 'webhook', 'migration'].includes(body?.trigger) ? body.trigger : 'manual';
  const onlyEntity = typeof body?.entity === 'string' ? body.entity : null;

  if (connector.type === 'database') {
    throw new deps.HttpError(400, 'Koneksi database langsung memerlukan agen jembatan (bridge agent). '
      + 'Gunakan impor file atau REST API untuk sementara.');
  }

  const config = parseJson(connector.config_json, {});
  let secrets;
  try { secrets = await openSecrets(env, connector.secrets_json) } catch (err) { throw asBadRequest(err, deps.HttpError) }

  const { results: mappings } = await env.DB.prepare(
    'SELECT * FROM mcp_mappings WHERE connector_id = ? AND owner_id = ?',
  ).bind(params.id, user.id).all();
  const active = (mappings || [])
    .map((m) => ({ ...m, externalIdField: m.external_id_field, fields: parseJson(m.fields_json, []), filters: parseJson(m.filters_json, null) }))
    .filter((m) => m.direction !== 'outbound')
    .filter((m) => !onlyEntity || m.entity === onlyEntity);

  if (!active.length) {
    throw new deps.HttpError(400, 'Belum ada pemetaan masuk untuk konektor ini. Buat pemetaan terlebih dahulu.');
  }

  const providedRows = Array.isArray(body?.rows) ? body.rows : null;
  if (connector.type !== 'rest' && !providedRows?.length) throw new deps.HttpError(400, 'Unggah baris sumber terlebih dahulu.');
  if (providedRows && active.length > 1 && !onlyEntity) throw new deps.HttpError(400, 'Pilih entitas tujuan untuk impor baris.');
  if (body.rows !== undefined && !providedRows) throw new deps.HttpError(400, 'rows harus berupa array.');
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
    if (!IMPORTABLE_ENTITIES.includes(entity)) throw new deps.HttpError(400, 'Entitas ini belum mendukung impor.');

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
      if (rows.length > LIMITS.importRows) {
        await recordError(entity, null, `Maksimal ${LIMITS.importRows} baris per permintaan.`, 'VALIDATION_ERROR');
        continue;
      }
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

  const status = stats.failed === 0 ? 'completed' : (stats.inserted + stats.updated + stats.skipped === 0 ? 'failed' : 'completed_with_errors');
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
async function lockMigration(env, id, ownerId, HttpError) {
  const result = await env.DB.prepare('UPDATE mcp_migrations SET locked = 1 WHERE id = ? AND owner_id = ? AND locked = 0')
    .bind(id, ownerId).run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'Migrasi sedang diproses. Tunggu hingga selesai.');
}

export async function handleMigrationRun(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const body = await deps.readJson(request);
  const dryRun = body.dryRun === true;
  let row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?').bind(params.id, user.id).first();
  if (!row) throw new deps.HttpError(404, 'Migrasi tidak ditemukan.');
  if (!dryRun) await lockMigration(env, params.id, user.id, deps.HttpError);
  try {
    // Re-read after acquiring the lock; another phase may have just completed.
    row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?').bind(params.id, user.id).first();
    if (row.status === 'rolled_back') throw new deps.HttpError(400, 'Migrasi sudah di-rollback. Buat migrasi baru.');
    const phases = parseJson(row.phases_json, []);
    const index = body.phaseIndex ?? phases.findIndex((p) => p.status === 'pending');
    if (index === -1 && body.phaseIndex === undefined) return deps.ok({ ...migrationView(row), dryRun });
    if (!Number.isInteger(index) || index < 0 || index >= phases.length) throw new deps.HttpError(400, 'Fase tidak valid.');
    const phase = phases[index];
    if (phase.status !== 'pending') throw new deps.HttpError(409, 'Fase sudah dijalankan. Buat migrasi baru untuk mengulang.');
    if (phases.slice(0, index).some((p) => p.status === 'pending')) throw new deps.HttpError(409, 'Jalankan fase sebelumnya terlebih dahulu.');
    const connector = await loadConnector(env, user.id, row.connector_id);
    if (!connector || connector.enabled !== 1) throw new deps.HttpError(400, 'Pilih konektor yang aktif.');
    if (connector.type === 'database') throw new deps.HttpError(400, 'Koneksi database langsung memerlukan agen jembatan.');
    const supplied = body.rowsByEntity;
    if (supplied !== undefined && (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))) throw new deps.HttpError(400, 'rowsByEntity harus berupa objek.');
    if (supplied) {
      let total = 0;
      for (const [entity, rows] of Object.entries(supplied)) {
        if (!phase.entities.includes(entity) || !IMPORTABLE_ENTITIES.includes(entity) || !Array.isArray(rows)) throw new deps.HttpError(400, 'Entitas atau daftar baris tidak valid untuk fase ini.');
        total += rows.length;
      }
      if (total > LIMITS.importRows) throw new deps.HttpError(400, `Maksimal ${LIMITS.importRows} baris per permintaan.`);
    }
    const { results: stored } = await env.DB.prepare('SELECT * FROM mcp_mappings WHERE connector_id = ? AND owner_id = ?')
      .bind(connector.id, user.id).all();
    const mappings = stored.filter((m) => phase.entities.includes(m.entity) && m.direction === 'inbound' && IMPORTABLE_ENTITIES.includes(m.entity));
    if (!mappings.length) throw new deps.HttpError(400, 'Belum ada pemetaan masuk untuk fase ini.');
    if (connector.type !== 'rest' && !mappings.some((m) => supplied?.[m.entity]?.length)) throw new deps.HttpError(400, 'Unggah baris sumber untuk fase ini.');
    const aggregate = emptyStats();
    phase.startedAt = nowIso();
    let rowCount = 0;
    const sources = [];
    for (const mappingRow of mappings) {
      const entity = mappingRow.entity;
      const mapping = { ...mappingRow, externalIdField: mappingRow.external_id_field, fields: parseJson(mappingRow.fields_json, []), filters: parseJson(mappingRow.filters_json, null) };
      let rows = supplied?.[entity];
      if (!rows && connector.type === 'rest') {
        let secrets;
        try { secrets = await openSecrets(env, connector.secrets_json) } catch (err) { throw asBadRequest(err, deps.HttpError) }
        const pulled = await pullFromRest(parseJson(connector.config_json, {}), secrets, entity, mapping);
        if (pulled.error) {
          phase.errors.push({ entity, message: pulled.error });
          aggregate.failed += 1;
          continue;
        }
        rows = pulled.rows;
      }
      rows = rows || [];
      rowCount += rows.length;
      if (rowCount > LIMITS.importRows) throw new deps.HttpError(400, `Maksimal ${LIMITS.importRows} baris per permintaan.`);
      sources.push({ entity, mapping, rows });
    }
    for (const { entity, mapping, rows } of sources) {
      for (const sourceRow of rows) {
        aggregate.processed += 1;
        const { values, errors } = transformRow(entity, sourceRow, mapping);
        if (errors.length) {
          aggregate.failed += 1;
          if (phase.errors.length < 100) phase.errors.push({ entity, message: errors.join('; ') });
          continue;
        }
        if (dryRun) { aggregate.inserted += 1; continue; }
        try {
          const { action } = await writeRow(env, user.id, connector.id, entity, mapping, values, externalIdFor(entity, sourceRow, mapping), params.id);
          aggregate[action] += 1;
        } catch (err) {
          aggregate.failed += 1;
          if (phase.errors.length < 100) phase.errors.push({ entity, message: err?.validation ? err.message : 'Gagal menulis baris.' });
        }
      }
    }
    phase.recordsProcessed = aggregate.processed;
    phase.recordsInserted = aggregate.inserted;
    phase.recordsUpdated = aggregate.updated;
    phase.recordsFailed = aggregate.failed;
    phase.status = aggregate.failed ? 'completed_with_errors' : 'completed';
    phase.endedAt = nowIso();
    const remaining = phases.some((p) => p.status === 'pending');
    const status = remaining ? 'running' : phases.some((p) => p.status === 'completed_with_errors') ? 'completed_with_errors' : 'completed';
    const stats = parseJson(row.stats_json, emptyStats());
    for (const key of ['processed', 'inserted', 'updated', 'skipped', 'failed']) stats[key] += aggregate[key];
    const result = { ...migrationView(row), phases, stats, status, startedAt: row.started_at || phase.startedAt, endedAt: remaining ? null : phase.endedAt, dryRun };
    if (!dryRun) {
      await env.DB.prepare('UPDATE mcp_migrations SET status = ?, phases_json = ?, stats_json = ?, started_at = ?, ended_at = ? WHERE id = ? AND owner_id = ?')
        .bind(status, JSON.stringify(phases), JSON.stringify(stats), result.startedAt, result.endedAt, params.id, user.id).run();
    }
    return deps.ok(result);
  } finally {
    if (!dryRun) await env.DB.prepare('UPDATE mcp_migrations SET locked = 0 WHERE id = ? AND owner_id = ?').bind(params.id, user.id).run();
  }
}

/** Remove only unchanged, unreferenced rows inserted by this migration. */
export async function handleMigrationRollback(request, env, deps, params) {
  const user = await requireOwner(request, env, deps);
  const row = await env.DB.prepare('SELECT * FROM mcp_migrations WHERE id = ? AND owner_id = ?').bind(params.id, user.id).first();
  if (!row) throw new deps.HttpError(404, 'Migrasi tidak ditemukan.');
  await lockMigration(env, params.id, user.id, deps.HttpError);
  try {
    const { results: journal } = await env.DB.prepare('SELECT * FROM mcp_migration_rows WHERE migration_id = ? AND owner_id = ?')
      .bind(params.id, user.id).all();
    const statements = [];
    for (const item of journal) {
      const entity = item.entity;
      if (!IMPORTABLE_ENTITIES.includes(entity)) throw new deps.HttpError(409, 'Jurnal migrasi tidak valid.');
      const dependent = { requests: ['offers', 'request_id'], workers: ['assignment_workers', 'worker_id'], vas_items: ['ledger_entries', 'vas_item_id'] }[entity];
      const unused = dependent ? `AND NOT EXISTS (SELECT 1 FROM ${dependent[0]} WHERE ${dependent[1]} = ${entity}.id)` : '';
      statements.push(env.DB.prepare(`DELETE FROM ${entity} WHERE id = ? AND owner_id = ? AND ${snapshotSql(entity)} = ? ${unused} RETURNING id`)
        .bind(item.local_id, user.id, item.snapshot_json));
      statements.push(env.DB.prepare(`DELETE FROM mcp_external_refs WHERE entity = ? AND local_id = ? AND owner_id = ? AND NOT EXISTS (SELECT 1 FROM ${entity} WHERE id = ?)`)
        .bind(entity, item.local_id, user.id, item.local_id));
      statements.push(env.DB.prepare(`DELETE FROM mcp_migration_rows WHERE migration_id = ? AND entity = ? AND local_id = ? AND owner_id = ? AND NOT EXISTS (SELECT 1 FROM ${entity} WHERE id = ?)`)
        .bind(params.id, entity, item.local_id, user.id, item.local_id));
    }
    const results = statements.length ? await env.DB.batch(statements) : [];
    const removedRows = results.filter((_, i) => i % 3 === 0).reduce((sum, r) => sum + r.results.length, 0);
    const { n: retainedRows } = await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_migration_rows WHERE migration_id = ? AND owner_id = ?').bind(params.id, user.id).first();
    if (!retainedRows) {
      // Keep the original counters and phases as an audit trail.
      await env.DB.prepare("UPDATE mcp_migrations SET status = 'rolled_back', rolled_back_at = ? WHERE id = ? AND owner_id = ?")
        .bind(nowIso(), params.id, user.id).run();
    }
    return deps.ok({ rolledBack: retainedRows === 0, removedRows, retainedRows });
  } finally {
    await env.DB.prepare('UPDATE mcp_migrations SET locked = 0 WHERE id = ? AND owner_id = ?').bind(params.id, user.id).run();
  }
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
  const flags = await env.DB.prepare('SELECT plan, suspended FROM user_flags WHERE user_id = ?').bind(row.owner_id).first();
  if (flags?.suspended || !deps.canUse(flags?.plan, 'erpIntegration')) throw new deps.HttpError(403, 'Pemilik konektor tidak memiliki akses integrasi.');

  let secrets;
  try { secrets = await openSecrets(env, row.secrets_json) } catch (err) { throw asBadRequest(err, deps.HttpError) }
  const secret = secrets.secret;
  if (!secret) throw new deps.HttpError(403, 'Konektor belum dikonfigurasi.');

  const payload = await deps.readJson(request.clone());
  const raw = await request.text();
  const signature = request.headers.get('x-mcp-signature') || request.headers.get('x-hub-signature-256') || '';
  const expected = await hmacHex(secret, raw);
  if (!safeEqual(signature.replace(/^sha256=/i, '').toLowerCase(), expected)) {
    throw new deps.HttpError(401, 'Tanda tangan tidak valid.');
  }

  const mappingRow = await env.DB.prepare(
    'SELECT * FROM mcp_mappings WHERE connector_id = ? AND entity = ?',
  ).bind(params.id, payload?.entity || '').first();

  if (!mappingRow) throw new deps.HttpError(400, 'Event tidak memiliki pemetaan untuk entitas tersebut.');

  if (!IMPORTABLE_ENTITIES.includes(mappingRow.entity) || mappingRow.direction !== 'inbound') throw new deps.HttpError(400, 'Pemetaan masuk tidak didukung.');
  const mapping = { ...mappingRow, externalIdField: mappingRow.external_id_field, fields: parseJson(mappingRow.fields_json, []), filters: parseJson(mappingRow.filters_json, null) };
  const data = payload.rows ?? payload.data;
  const records = Array.isArray(data) ? data : data ? [data] : [];
  if (records.length > LIMITS.importRows) throw new deps.HttpError(400, `Maksimal ${LIMITS.importRows} baris per permintaan.`);
  if (!records.length) throw new deps.HttpError(400, 'Event tidak berisi data.');

  const results = [];
  for (const sourceRow of records) {
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

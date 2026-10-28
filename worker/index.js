/**
 * Satu Alur - Cloudflare Worker.
 *
 * Serves /api/* (auth, generic DB query endpoint on D1, LLM streaming via
 * Workers AI). Every other request falls through to the static assets binding.
 *
 * Response envelope: { data, error, count? }, error = { message }.
 */

// ---------------------------------------------------------------- constants

const MAX_BODY_BYTES = 256 * 1024; // auth + db
const MAX_CHAT_BODY_BYTES = 512 * 1024;

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_WINDOW = 5; // per email per OTP_TTL_MS
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_INSERT_ROWS = 100;
const MAX_IN_VALUES = 100;
const MAX_FILTERS = 20;
const MAX_LIMIT = 1000;

const LLM_MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct (fast)', disabled: false },
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', name: 'Llama 3.1 8B Instruct (fast)', disabled: false },
];
const MAX_CHAT_MESSAGES = 50;
const MAX_CHAT_CHARS = 100000;
const MAX_TOKENS_CAP = 4096;
const CHAT_ROLES = new Set(['system', 'user', 'assistant']);

const JSON_HINT =
  'Respond with ONLY a single valid JSON object. No markdown code fences, no commentary, no text before or after the JSON.';

// Whitelisted tables -> columns. `json` columns are stored as TEXT JSON.
const TABLES = {
  requests: {
    columns: ['id', 'owner_id', 'customer_name', 'service_type', 'phone', 'location', 'description', 'status', 'created_at'],
  },
  offers: {
    columns: ['id', 'owner_id', 'request_id', 'ai_proposal_json', 'validated_price', 'validated_scope', 'status', 'created_at'],
    json: ['ai_proposal_json'],
    fks: { request_id: 'requests' },
  },
  assignments: {
    columns: ['id', 'owner_id', 'offer_id', 'worker_name', 'scheduled_at', 'status', 'created_at'],
    fks: { offer_id: 'offers' },
  },
  completions: {
    columns: ['id', 'owner_id', 'assignment_id', 'notes', 'photos_path', 'status', 'completed_at', 'created_at'],
    json: ['photos_path'],
    fks: { assignment_id: 'assignments' },
  },
  ledger_entries: {
    columns: ['id', 'owner_id', 'completion_id', 'amount', 'category', 'status', 'posted_at', 'created_at'],
    fks: { completion_id: 'completions' },
  },
  reports: {
    columns: ['id', 'owner_id', 'period_start', 'period_end', 'summary_json', 'explanation_html', 'status', 'created_at'],
    json: ['summary_json'],
  },
};
// Columns the client may never set directly.
const PROTECTED_COLUMNS = new Set(['id', 'owner_id']);

const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'match']);
const SQL_CMP = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

// ------------------------------------------------------------------ helpers

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
const ok = (data, extra) => json({ data, error: null, ...(extra || {}) });
const fail = (status, message) => json({ data: null, error: { message } }, status);

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'Permintaan terlalu besar.');
  if (!request.body) throw new HttpError(400, 'Body JSON diperlukan.');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new HttpError(413, 'Permintaan terlalu besar.');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, 'Body bukan JSON yang valid.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Body harus berupa objek JSON.');
  }
  return parsed;
}

const enc = new TextEncoder();

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
function randomHex(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return toHex(a);
}
function randomOtp() {
  // Uniform 6-digit code without modulo bias.
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 900000) * 900000;
  do crypto.getRandomValues(a); while (a[0] >= limit);
  return String(100000 + (a[0] % 900000));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

const nowIso = () => new Date().toISOString();

// --------------------------------------------------------------------- auth

async function authenticate(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9._~-]{16,200})$/.exec(h);
  if (!m) throw new HttpError(401, 'Belum masuk.');
  const tokenHash = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, nowIso())
    .first();
  if (!row) throw new HttpError(401, 'Sesi tidak valid atau sudah berakhir.');
  return { user: row, tokenHash };
}

async function handleSendOtp(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'Email tidak valid.');

  const now = Date.now();
  // Opportunistic cleanup of expired rows.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM otp_codes WHERE expires_at < ?').bind(nowIso()),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
  ]);

  // Simple per-email throttle: max N live codes per TTL window.
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?')
    .bind(email, new Date(now - OTP_TTL_MS).toISOString())
    .first();
  if (recent && recent.n >= OTP_MAX_SENDS_PER_WINDOW) {
    throw new HttpError(429, 'Terlalu banyak permintaan kode. Coba lagi nanti.');
  }

  const code = randomOtp();
  const id = crypto.randomUUID();
  const codeHash = await sha256Hex(`${id}:${code}`);

  const [, existing] = await env.DB.batch([
    env.DB.prepare('INSERT INTO otp_codes (id, email, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)').bind(
      id,
      email,
      codeHash,
      new Date(now + OTP_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    ),
    env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email),
  ]);
  const isExistingUser = (existing.results || []).length > 0;

  // TODO(email-provider): deliver `code` to `email` here (e.g. Resend, MailChannels,
  // Cloudflare Email Service) via env.EMAIL_API_KEY. Until a provider exists the
  // code is only exposed in the response when DEMO_OTP === "true".
  const data = { verificationId: id, isExistingUser };
  if (env.DEMO_OTP === 'true') data.demoCode = code;
  return ok(data);
}

async function handleVerifyOtp(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const verificationId = typeof body.verificationId === 'string' ? body.verificationId : '';
  const token = typeof body.token === 'string' ? body.token.trim() : String(body.token ?? '').trim();
  const bad = new HttpError(400, 'Kode OTP salah atau sudah kadaluarsa.');
  if (!email || !verificationId || verificationId.length > 64 || !/^\d{6}$/.test(token)) throw bad;

  const rec = await env.DB.prepare('SELECT id, email, code_hash, attempts, expires_at FROM otp_codes WHERE id = ?')
    .bind(verificationId)
    .first();
  if (!rec || rec.email !== email || rec.expires_at <= nowIso() || rec.attempts >= OTP_MAX_ATTEMPTS) throw bad;

  // Count the attempt before comparing so parallel guesses cannot exceed the cap.
  const upd = await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ?')
    .bind(verificationId, OTP_MAX_ATTEMPTS)
    .run();
  if (!upd.meta || upd.meta.changes !== 1) throw bad;

  const given = await sha256Hex(`${verificationId}:${token}`);
  if (!safeEqual(given, rec.code_hash)) throw bad;

  // Single use.
  const del = await env.DB.prepare('DELETE FROM otp_codes WHERE id = ?').bind(verificationId).run();
  if (!del.meta || del.meta.changes !== 1) throw bad; // lost a race with a parallel verify

  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), email, email.split('@')[0], nowIso())
    .run();
  const user = await env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE email = ?').bind(email).first();
  if (!user) throw new Error('user missing after upsert');

  const accessToken = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(accessToken), user.id, new Date(Date.now() + SESSION_TTL_MS).toISOString(), nowIso())
    .run();

  return ok({ user, access_token: accessToken });
}

async function handleSession(request, env) {
  const { user } = await authenticate(request, env);
  return ok({ user });
}

async function handleSignout(request, env) {
  const { tokenHash } = await authenticate(request, env);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  return ok(null);
}

// ----------------------------------------------------------------- DB proxy

function bad(msg) {
  return new HttpError(400, msg);
}

function isScalar(v) {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}
function bindable(v, what) {
  if (!isScalar(v)) throw bad(`Nilai tidak valid untuk ${what}.`);
  if (typeof v === 'number' && !Number.isFinite(v)) throw bad(`Nilai tidak valid untuk ${what}.`);
  if (typeof v === 'string' && v.length > 20000) throw bad(`Nilai terlalu panjang untuk ${what}.`);
  return typeof v === 'boolean' ? (v ? 1 : 0) : v;
}

function checkColumn(spec, col, { allowJson = true } = {}) {
  if (typeof col !== 'string' || !spec.columns.includes(col)) throw bad(`Kolom tidak dikenal: ${String(col).slice(0, 40)}`);
  if (!allowJson && spec.json?.includes(col)) throw bad(`Kolom tidak dapat difilter: ${col}`);
  return col;
}

// Builds " AND ..." fragments (all start with AND) + params for client filters.
function buildWhere(spec, filters) {
  if (filters === undefined || filters === null) filters = [];
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) throw bad('Filter tidak valid.');
  const parts = [];
  const params = [];
  const addEq = (col, val, negate) => {
    checkColumn(spec, col, { allowJson: false });
    if (val === null) parts.push(`${col} IS ${negate ? 'NOT ' : ''}NULL`);
    else {
      parts.push(`${col} ${negate ? '!=' : '='} ?`);
      params.push(bindable(val, col));
    }
  };
  for (const f of filters) {
    if (!f || typeof f !== 'object' || !FILTER_OPS.has(f.op)) throw bad(`Operator tidak didukung: ${String(f?.op).slice(0, 20)}`);
    const { op } = f;
    if (op === 'match') {
      if (!f.val || typeof f.val !== 'object' || Array.isArray(f.val)) throw bad('Filter match tidak valid.');
      const entries = Object.entries(f.val);
      if (entries.length > MAX_FILTERS) throw bad('Filter match terlalu banyak.');
      for (const [k, v] of entries) addEq(k, v, false);
    } else if (op === 'eq' || op === 'neq') {
      addEq(f.col, f.val, op === 'neq');
    } else if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      checkColumn(spec, f.col, { allowJson: false });
      if (f.val === null || !isScalar(f.val)) throw bad(`Nilai tidak valid untuk ${f.col}.`);
      parts.push(`${f.col} ${SQL_CMP[op]} ?`);
      params.push(bindable(f.val, f.col));
    } else if (op === 'like' || op === 'ilike') {
      checkColumn(spec, f.col, { allowJson: false });
      if (typeof f.val !== 'string' || f.val.length > 200) throw bad(`Pola tidak valid untuk ${f.col}.`);
      // Note: SQLite LIKE is ASCII case-insensitive; `like` and `ilike` therefore behave alike for ASCII.
      parts.push(op === 'like' ? `${f.col} LIKE ? ESCAPE '\\'` : `LOWER(${f.col}) LIKE LOWER(?) ESCAPE '\\'`);
      params.push(f.val);
    } else if (op === 'is') {
      checkColumn(spec, f.col, { allowJson: false });
      if (f.val === null) parts.push(`${f.col} IS NULL`);
      else if (f.val === true || f.val === false) {
        parts.push(`${f.col} IS ?`);
        params.push(f.val ? 1 : 0);
      } else throw bad(`Nilai 'is' tidak valid untuk ${f.col}.`);
    } else if (op === 'in') {
      checkColumn(spec, f.col, { allowJson: false });
      if (!Array.isArray(f.val) || f.val.length > MAX_IN_VALUES) throw bad(`Nilai 'in' tidak valid untuk ${f.col}.`);
      const vals = f.val.filter((v) => v !== null).map((v) => bindable(v, f.col));
      if (vals.length === 0) parts.push('1 = 0');
      else {
        parts.push(`${f.col} IN (${vals.map(() => '?').join(', ')})`);
        params.push(...vals);
      }
    }
  }
  return { sql: parts.map((p) => ` AND ${p}`).join(''), params };
}

function parseSelectColumns(spec, columns) {
  if (columns === undefined || columns === null || columns === '*') return '*';
  if (typeof columns !== 'string' || columns.length > 500) throw bad('Kolom tidak valid.');
  const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0) throw bad('Kolom tidak valid.');
  if (cols.includes('*')) return '*';
  return [...new Set(cols.map((c) => checkColumn(spec, c)))].join(', ');
}

function serializeRow(spec, row, { forWrite }) {
  const out = {};
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('Baris data tidak valid.');
  for (const [k, v] of Object.entries(row)) {
    checkColumn(spec, k);
    if (PROTECTED_COLUMNS.has(k)) {
      if (forWrite === 'update') throw bad(`Kolom tidak boleh diubah: ${k}`);
      continue; // insert: ignore client id/owner_id
    }
    if (spec.json?.includes(k)) out[k] = v === null || v === undefined ? null : JSON.stringify(v);
    else if (v === undefined) continue;
    else out[k] = bindable(v, k);
    if (out[k] !== null && typeof out[k] === 'string' && out[k].length > 200000) throw bad(`Nilai terlalu panjang untuk ${k}.`);
  }
  return out;
}

function parseRow(spec, row) {
  if (!spec.json) return row;
  for (const c of spec.json) {
    if (c in row && typeof row[c] === 'string') {
      try {
        row[c] = JSON.parse(row[c]);
      } catch {
        /* leave as string */
      }
    }
  }
  return row;
}

// Referenced rows must belong to the same user (no cross-tenant linking).
async function assertFkOwnership(env, spec, rows, userId) {
  if (!spec.fks) return;
  for (const [col, refTable] of Object.entries(spec.fks)) {
    const ids = [...new Set(rows.map((r) => r[col]).filter((v) => v !== undefined && v !== null))];
    for (const id of ids) {
      const hit = await env.DB.prepare(`SELECT 1 AS x FROM ${refTable} WHERE id = ? AND owner_id = ?`).bind(id, userId).first();
      if (!hit) throw bad(`Referensi ${col} tidak ditemukan.`);
    }
  }
}

function mapDbError(err) {
  const m = String(err && err.message);
  if (/constraint/i.test(m)) return new HttpError(400, 'Data tidak valid atau melanggar batasan.');
  return err;
}

async function handleDb(request, env) {
  const { user } = await authenticate(request, env);
  const body = await readJson(request);

  const table = body.table;
  if (typeof table !== 'string' || !Object.hasOwn(TABLES, table)) throw bad('Tabel tidak dikenal.');
  const spec = TABLES[table];
  const action = body.action;
  const uid = user.id;

  if (action === 'insert') {
    const values = Array.isArray(body.values) ? body.values : body.values ? [body.values] : [];
    if (values.length === 0 || values.length > MAX_INSERT_ROWS) throw bad('Values tidak valid.');
    const rows = values.map((v) => serializeRow(spec, v, { forWrite: 'insert' }));
    await assertFkOwnership(env, spec, rows, uid);
    const stmts = rows.map((r) => {
      const cols = ['owner_id', ...Object.keys(r)];
      return env.DB.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING *`,
      ).bind(uid, ...Object.values(r));
    });
    let results;
    try {
      results = await env.DB.batch(stmts);
    } catch (e) {
      throw mapDbError(e);
    }
    const data = results.flatMap((r) => r.results || []).map((r) => parseRow(spec, r));
    return ok(data);
  }

  if (action === 'update' || action === 'delete') {
    const { sql: whereSql, params } = buildWhere(spec, body.filters);
    if (!whereSql) throw bad('Filter diperlukan untuk update/delete.');
    let stmt;
    if (action === 'update') {
      if (!body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)) throw bad('Changes tidak valid.');
      const ch = serializeRow(spec, body.changes, { forWrite: 'update' });
      const keys = Object.keys(ch);
      if (keys.length === 0) throw bad('Changes kosong.');
      await assertFkOwnership(env, spec, [ch], uid);
      stmt = env.DB.prepare(
        `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE owner_id = ?${whereSql} RETURNING *`,
      ).bind(...Object.values(ch), uid, ...params);
    } else {
      stmt = env.DB.prepare(`DELETE FROM ${table} WHERE owner_id = ?${whereSql} RETURNING *`).bind(uid, ...params);
    }
    let res;
    try {
      res = await stmt.run();
    } catch (e) {
      throw mapDbError(e);
    }
    return ok((res.results || []).map((r) => parseRow(spec, r)));
  }

  if (action === 'select') {
    const cols = parseSelectColumns(spec, body.columns);
    const { sql: whereSql, params } = buildWhere(spec, body.filters);
    const base = `FROM ${table} WHERE owner_id = ?${whereSql}`;
    const baseParams = [uid, ...params];

    let orderSql = '';
    if (body.order !== undefined && body.order !== null) {
      if (typeof body.order !== 'object' || Array.isArray(body.order)) throw bad('Order tidak valid.');
      checkColumn(spec, body.order.col, { allowJson: false });
      orderSql = ` ORDER BY ${body.order.col} ${body.order.asc === false ? 'DESC' : 'ASC'}, id ${body.order.asc === false ? 'DESC' : 'ASC'}`;
    }

    // range then limit, like the mock (slice(range) then slice(0, limit)).
    let offset = 0;
    let limit = null;
    if (body.range !== undefined && body.range !== null) {
      const r = body.range;
      if (!Array.isArray(r) || r.length !== 2 || !Number.isInteger(r[0]) || !Number.isInteger(r[1]) || r[0] < 0 || r[1] < r[0]) {
        throw bad('Range tidak valid.');
      }
      offset = r[0];
      limit = r[1] - r[0] + 1;
    }
    if (body.limit !== undefined && body.limit !== null) {
      if (!Number.isInteger(body.limit) || body.limit < 0) throw bad('Limit tidak valid.');
      limit = limit === null ? body.limit : Math.min(limit, body.limit);
    }
    // Falsy limit (0) behaves as "no limit" in the mock (`if (_limit)`); keep that.
    if (limit === 0) limit = null;
    const wantsOne = body.single === true || body.maybeSingle === true;
    if (wantsOne) limit = limit === null ? 2 : Math.min(limit, 2);
    if (limit === null || limit > MAX_LIMIT) limit = Math.min(limit ?? MAX_LIMIT, MAX_LIMIT);

    const wantCount = body.count === true || body.head === true;

    const stmts = [];
    if (wantCount) stmts.push(env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...baseParams));
    if (body.head !== true) {
      stmts.push(
        env.DB.prepare(`SELECT ${cols} ${base}${orderSql} LIMIT ? OFFSET ?`).bind(...baseParams, limit, offset),
      );
    }
    const results = await env.DB.batch(stmts);
    const count = wantCount ? results[0].results[0].n : undefined;

    if (body.head === true) return json({ data: null, error: null, count });
    const rows = (results[wantCount ? 1 : 0].results || []).map((r) => parseRow(spec, r));
    const extra = wantCount && body.single !== true && body.maybeSingle !== true ? { count } : undefined;

    if (body.single === true) {
      if (rows.length !== 1) return json({ data: null, error: { message: 'Tidak ditemukan.' } });
      return ok(rows[0]);
    }
    if (body.maybeSingle === true) return ok(rows[0] ?? null);
    return ok(rows, extra);
  }

  throw bad('Action tidak dikenal.');
}

// ---------------------------------------------------------------------- LLM

async function handleModels(request, env) {
  await authenticate(request, env);
  return ok(LLM_MODELS.map((m) => ({ ...m })));
}

function sse(obj) {
  return enc.encode(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`);
}

// Translate Workers AI SSE (`data: {"response":"..."}` or OpenAI-style
// `data: {"choices":[{"delta":{"content":".."}}]}`) to the contract's shape.
function translateStream(aiStream) {
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const finish = (controller) => {
    if (finished) return;
    finished = true;
    controller.enqueue(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    controller.enqueue(sse('[DONE]'));
  };
  const handleLine = (line, controller) => {
    line = line.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') return finish(controller);
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }
    let text = '';
    if (typeof obj.response === 'string') text = obj.response;
    else if (obj.choices && obj.choices[0]) {
      const c = obj.choices[0];
      text = (c.delta && typeof c.delta.content === 'string' && c.delta.content) || (typeof c.text === 'string' ? c.text : '');
    }
    if (text) controller.enqueue(sse({ choices: [{ delta: { content: text }, finish_reason: null }] }));
  };

  return aiStream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, i), controller);
          buffer = buffer.slice(i + 1);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) handleLine(buffer, controller);
        finish(controller);
      },
    }),
  );
}

async function handleChat(request, env) {
  await authenticate(request, env);
  const body = await readJson(request, MAX_CHAT_BODY_BYTES);

  if (typeof body.model !== 'string' || !LLM_MODELS.some((m) => m.id === body.model && !m.disabled)) {
    throw bad('Model tidak didukung.');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_CHAT_MESSAGES) {
    throw bad('Messages tidak valid.');
  }
  let chars = 0;
  const messages = body.messages.map((m) => {
    if (!m || typeof m !== 'object' || !CHAT_ROLES.has(m.role) || typeof m.content !== 'string') throw bad('Messages tidak valid.');
    chars += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (chars > MAX_CHAT_CHARS) throw bad('Messages terlalu panjang.');

  const params = { messages, stream: true };
  if (body.temperature !== undefined && body.temperature !== null) {
    if (typeof body.temperature !== 'number' || !(body.temperature >= 0 && body.temperature <= 2)) throw bad('Temperature tidak valid.');
    params.temperature = body.temperature;
  }
  if (body.max_tokens !== undefined && body.max_tokens !== null) {
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) throw bad('max_tokens tidak valid.');
    params.max_tokens = Math.min(body.max_tokens, MAX_TOKENS_CAP);
  }
  const rf = body.response_format;
  if (rf !== undefined && rf !== null && (typeof rf !== 'object' || Array.isArray(rf))) throw bad('response_format tidak valid.');
  if (rf && rf.type === 'json_schema') {
    const schema = rf.json_schema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || JSON.stringify(schema).length > 8000) {
      throw bad('json_schema tidak valid.');
    }
    return structuredChat(env, body.model, params, schema);
  }
  if (rf && rf.type === 'json_object') {
    // Workers AI JSON mode does not support streaming, so steer via a system hint.
    params.messages = [{ role: 'system', content: JSON_HINT }, ...messages];
  }

  let aiStream;
  try {
    aiStream = await env.AI.run(body.model, params);
  } catch (e) {
    console.error('AI.run failed', e);
    return fail(502, 'Layanan AI tidak tersedia.');
  }
  if (!(aiStream instanceof ReadableStream)) {
    // Non-stream fallback: wrap whole response.
    const text = typeof aiStream?.response === 'string' ? aiStream.response : '';
    const out = new ReadableStream({
      start(c) {
        if (text) c.enqueue(sse({ choices: [{ delta: { content: text }, finish_reason: null }] }));
        c.enqueue(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
        c.enqueue(sse('[DONE]'));
        c.close();
      },
    });
    return sseResponse(out);
  }
  return sseResponse(translateStream(aiStream));
}

// JSON mode (schema-constrained output) cannot stream on Workers AI. Run it
// without streaming, then replay the JSON to the client as SSE chunks so the UI
// keeps its typing effect. Falls back to a hinted streaming call when the model
// cannot satisfy JSON mode.
async function structuredChat(env, model, params, schema) {
  const { stream: _stream, ...rest } = params;
  let text = '';
  try {
    const out = await env.AI.run(model, { ...rest, response_format: { type: 'json_schema', json_schema: schema } });
    const r = out?.response;
    text = typeof r === 'string' ? r : r && typeof r === 'object' ? JSON.stringify(r, null, 2) : '';
  } catch (e) {
    console.warn('JSON mode failed, falling back to hinted stream', e);
  }
  if (!text) {
    let aiStream;
    try {
      aiStream = await env.AI.run(model, { ...params, messages: [{ role: 'system', content: JSON_HINT }, ...params.messages] });
    } catch (e) {
      console.error('AI.run failed', e);
      return fail(502, 'Layanan AI tidak tersedia.');
    }
    if (aiStream instanceof ReadableStream) return sseResponse(translateStream(aiStream));
    text = typeof aiStream?.response === 'string' ? aiStream.response : '';
  }
  const out = new ReadableStream({
    async start(c) {
      const STEP = 24;
      for (let i = 0; i < text.length; i += STEP) {
        c.enqueue(sse({ choices: [{ delta: { content: text.slice(i, i + STEP) }, finish_reason: null }] }));
        await new Promise((r) => setTimeout(r, 12));
      }
      c.enqueue(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
      c.enqueue(sse('[DONE]'));
      c.close();
    },
  });
  return sseResponse(out);
}

function sseResponse(stream) {
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff',
    },
  });
}

// ------------------------------------------------------------------- router

const ROUTES = {
  'POST /api/auth/send-otp': handleSendOtp,
  'POST /api/auth/verify-otp': handleVerifyOtp,
  'GET /api/auth/session': handleSession,
  'POST /api/auth/signout': handleSignout,
  'POST /api/db': handleDb,
  'GET /api/llm/models': handleModels,
  'POST /api/llm/chat': handleChat,
};

async function handleApi(request, env, path) {
  const handler = ROUTES[`${request.method} ${path}`];
  if (handler) return handler(request, env);
  const pathKnown = Object.keys(ROUTES).some((k) => k.slice(k.indexOf(' ') + 1) === path);
  if (pathKnown) return fail(405, 'Method tidak diizinkan.');
  return fail(404, 'Endpoint tidak ditemukan.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (path === '/api' || path.startsWith('/api/')) {
      try {
        return await handleApi(request, env, path);
      } catch (err) {
        if (err instanceof HttpError) return fail(err.status, err.message);
        console.error('Unhandled error', err); // logs only; never returned to client
        return fail(500, 'Terjadi kesalahan pada server.');
      }
    }
    return env.ASSETS.fetch(request);
  },
};

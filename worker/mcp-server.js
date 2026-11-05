/**
 * Akses AI (MCP): a remote Model Context Protocol server so the business owner can connect Claude
 * (claude.ai custom connector, Claude Desktop, Claude Code) to their own Satu Alur account.
 *
 * Not the ERP connectors of worker/mcp.js (those are called "MCP" for historical reasons).
 *
 * Transport: MCP Streamable HTTP without SSE and without sessions (stateless).
 *   POST /mcp            Authorization: Bearer sa_mcp_…
 *   POST /mcp/<token>    token in the path (claude.ai custom connectors only take a URL)
 *   GET / DELETE         405 (no server-initiated stream, no session to end)
 *   OPTIONS              CORS preflight
 * Body: one JSON-RPC 2.0 message or a batch (array). Requests get application/json responses;
 * notifications and responses only get 202 Accepted.
 *
 * Auth: per-account tokens in mcp_tokens (migration 0022). Only the SHA-256 is stored; the plain
 * token is shown once by POST /api/mcp-tokens. Revoked tokens, suspended users and the shared demo
 * accounts are refused. Every query is scoped to the token's owner_id.
 *
 * Tools are read-only and reuse the app's pure domain code: buildModel (src/domain/model.js),
 * workflowRows / matchesQuery / timeline (src/domain/workflow.js) and Waguri's customer matching
 * (src/waguri/answers.js), so Claude sees the same positions and next steps as the Alur kerja page.
 *
 * Helpers are injected by worker/index.js (authenticate, readJson, ok, HttpError, isDemoUser, sha256Hex).
 */
import { buildModel, totals, ledgerDate, categoryLabel, isRevenue } from '../src/domain/model.js';
import { workflowRows, matchesQuery, timeline, filterCounts, FILTERS, offerPrice } from '../src/domain/workflow.js';
import { findCustomers, stageOf, idr } from '../src/waguri/answers.js';
import { progressLabel } from '../src/domain/progress.js';
import { planLabel, normalizePlan } from '../src/business/plan-access.js';
import { SUSPENDED_MESSAGE } from '../src/customers/rules.js';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];
export const SERVER_INFO = { name: 'satu-alur', title: 'Satu Alur', version: '1.0.0' };
export const TOKEN_PREFIX = 'sa_mcp_';
const TOKEN_RE = /^sa_mcp_[A-Za-z0-9_-]{43}$/;
// OAuth access tokens (worker/oauth.js) share the mcp_tokens table (kind 'oauth', 1-hour expiry).
export const ACCESS_PREFIX = 'sa_oat_';
const ACCESS_RE = /^sa_oat_[A-Za-z0-9_-]{43}$/;
export const MAX_TOKENS_PER_ACCOUNT = 10;
const LABEL_MAX = 60;
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 20;
const ROW_CAP = 5000;
export const LIMITS = { perMinute: 60, perHour: 1000 };
const TOUCH_MS = 5 * 60 * 1000; // last_used_at is written at most every 5 minutes (D1 write budget)
const WIB_MS = 7 * 3600 * 1000;

const INSTRUCTIONS = [
  'Server ini membaca data usaha jasa di Satu Alur (hanya baca, satu akun).',
  'Alur kerja tiap pekerjaan: Permintaan → Penawaran → Penugasan → Penyelesaian → Pembukuan (lalu invoice).',
  'Pakai progres_pelanggan untuk pertanyaan "pekerjaan PT X sudah sampai mana?", cari_pekerjaan untuk daftar/filter pekerjaan,',
  'detail_pekerjaan untuk rincian satu pekerjaan (pakai id dari hasil lain), ringkasan_keuangan untuk pendapatan/biaya/laba,',
  'daftar_invoice untuk tagihan (status "terkirim" = belum lunas), dan info_akun untuk gambaran akun.',
  'Jawab dalam bahasa pengguna (biasanya Indonesia), tulis uang dalam Rupiah, dan jangan mengarang angka di luar hasil tool.',
].join(' ');

// ------------------------------------------------------------------ token helpers

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** New plain token: prefix ("sa_mcp_" by default) + 32 random bytes (base64url, 43 chars). */
export function newToken(prefix = TOKEN_PREFIX) {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return prefix + b64url(a);
}
export { b64url };
export const tokenDisplayPrefix = (token) => String(token).slice(0, TOKEN_PREFIX.length + 4);
export const isAccessTokenShape = (token) => ACCESS_RE.test(String(token || ''));
export const isTokenShape = (token) => TOKEN_RE.test(String(token || ''));

export function cleanLabel(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || 'Claude').slice(0, LABEL_MAX);
}

const nowIso = () => new Date().toISOString();
const publicToken = (r) => ({
  id: r.id, name: r.name, prefix: r.prefix, created_at: r.created_at, last_used_at: r.last_used_at || null,
});

// ------------------------------------------------------- /api/mcp-tokens (session auth)

function refuseNonOwner(user, HttpError, isDemoUser) {
  if (isDemoUser(user)) throw new HttpError(403, 'Akun demo tidak bisa membuat token Akses AI. Masuk dengan akun usaha Anda sendiri untuk menghubungkan Claude.');
  if (user.is_staff === 1) throw new HttpError(403, 'Akun staf tidak memakai Akses AI.');
}

/** GET /api/mcp-tokens -> { items, demo, max } (active tokens only, newest first). */
export async function handleMcpTokenList(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  const demo = deps.isDemoUser(user);
  if (demo || user.is_staff === 1) return deps.ok({ items: [], demo, max: MAX_TOKENS_PER_ACCOUNT });
  const { results } = await env.DB.prepare(
    "SELECT id, name, prefix, created_at, last_used_at FROM mcp_tokens WHERE owner_id = ? AND kind = 'manual' AND revoked_at IS NULL ORDER BY created_at DESC, id DESC",
  ).bind(user.id).all();
  return deps.ok({ items: (results || []).map(publicToken), demo: false, max: MAX_TOKENS_PER_ACCOUNT });
}

/** POST /api/mcp-tokens { name } -> { token, item }. The plain token is returned only here. */
export async function handleMcpTokenCreate(request, env, deps) {
  const { user } = await deps.authenticate(request, env);
  refuseNonOwner(user, deps.HttpError, deps.isDemoUser);
  let body = {};
  try { body = await deps.readJson(request, 4096); } catch (err) { if (err?.status === 413) throw err; body = {}; }
  const name = cleanLabel(body?.name);
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE owner_id = ? AND kind = 'manual' AND revoked_at IS NULL").bind(user.id).first();
  if (Number(active?.n) >= MAX_TOKENS_PER_ACCOUNT) {
    throw new deps.HttpError(409, `Maksimal ${MAX_TOKENS_PER_ACCOUNT} token aktif. Cabut token yang tidak dipakai lagi dulu.`);
  }
  const token = newToken();
  const prefix = tokenDisplayPrefix(token);
  const createdAt = nowIso();
  const res = await env.DB.prepare(
    'INSERT INTO mcp_tokens (owner_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id, name, prefix, created_at, last_used_at',
  ).bind(user.id, name, await deps.sha256Hex(token), prefix, createdAt).run();
  const row = res?.results?.[0] || { id: res?.meta?.last_row_id, name, prefix, created_at: createdAt, last_used_at: null };
  return deps.ok({ token, item: publicToken(row) }, 201);
}

/** DELETE /api/mcp-tokens/:id — revoke (kept for the audit trail, never usable again). */
export async function handleMcpTokenRevoke(request, env, deps, params) {
  const { user } = await deps.authenticate(request, env);
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new deps.HttpError(400, 'ID token tidak valid.');
  const r = await env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND owner_id = ? AND kind = 'manual' AND revoked_at IS NULL")
    .bind(nowIso(), id, user.id).run();
  if (!Number(r?.meta?.changes)) throw new deps.HttpError(404, 'Token tidak ditemukan atau sudah dicabut.');
  return deps.ok({ id, revoked: true });
}

// ------------------------------------------------------------------ rate limit (best effort)

const CACHE_HOST = 'https://mcp-rl.satualur.internal';
const mem = new Map();
const hasCacheApi = () => typeof caches !== 'undefined' && caches?.default;

export async function take(bucket, max, windowMs, now = Date.now()) {
  const slot = Math.floor(now / windowMs);
  const key = `${bucket}:${windowMs}:${slot}`;
  let n = mem.get(key) || 0;
  const url = `${CACHE_HOST}/rl?k=${encodeURIComponent(key)}`;
  if (hasCacheApi()) {
    try {
      const hit = await caches.default.match(url);
      if (hit) n = Math.max(n, Number(await hit.text()) || 0);
    } catch { /* best effort */ }
  }
  if (n >= max) return false;
  n += 1;
  if (mem.size > 5000) mem.clear();
  mem.set(key, n);
  if (hasCacheApi()) {
    try { await caches.default.put(url, new Response(String(n), { headers: { 'cache-control': `public, max-age=${Math.ceil(windowMs / 1000)}` } })); } catch { /* best effort */ }
  }
  return true;
}
export const _resetLimits = () => mem.clear();

// ------------------------------------------------------------------ HTTP layer

const ALLOWED_ORIGIN_HOSTS = [/^(.+\.)?claude\.ai$/, /^(.+\.)?claude\.com$/, /^(.+\.)?anthropic\.com$/, /^localhost$/, /^127\.0\.0\.1$/];

/**
 * Loose Origin check (DNS-rebinding guidance of the spec). No Origin (server-side clients such as
 * claude.ai's connector backend, Claude Code, mcp-remote) is fine; a browser Origin must be this
 * site, Claude/Anthropic, or localhost (MCP Inspector). Auth is a bearer token, never a cookie.
 */
export function originAllowed(origin, selfOrigin) {
  if (!origin || origin === 'null') return !origin;
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.origin === selfOrigin) return true;
  return ALLOWED_ORIGIN_HOSTS.some((re) => re.test(u.hostname));
}

function corsHeaders(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
    'access-control-expose-headers': 'mcp-protocol-version, www-authenticate',
    'access-control-max-age': '600',
    vary: 'origin',
  } : {};
}

function respond(body, status, extra = {}) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra };
  if (body === null) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

class McpAuthError extends Error {
  constructor(status, message, presented = false) { super(message); this.status = status; this.presented = presented; }
}

/**
 * Resolves the token to its account, or throws McpAuthError. The Authorization header carries a
 * manual token (sa_mcp_…) or an OAuth access token (sa_oat_…); /mcp/<token> only takes manual
 * tokens (OAuth tokens never go in a URL).
 */
async function authenticateToken(request, env, pathToken, sha256Hex) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  const token = m ? m[1] : pathToken;
  if (!token) throw new McpAuthError(401, 'Perlu login: hubungkan Claude lewat OAuth (cukup URL /mcp), atau kirim "Authorization: Bearer <token>".');
  const oauth = Boolean(m) && isAccessTokenShape(token);
  if (!oauth && !isTokenShape(token)) throw new McpAuthError(401, 'Token Akses AI tidak valid.', true);
  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.owner_id, t.name AS token_name, t.revoked_at, t.last_used_at, t.kind, t.expires_at,
            t.grant_id, g.revoked_at AS grant_revoked_at, g.last_used_at AS grant_last_used_at, g.client_name,
            u.email, u.name, u.created_at, f.suspended, COALESCE(f.plan, 'sole') AS plan
       FROM mcp_tokens t JOIN users u ON u.id = t.owner_id
       LEFT JOIN oauth_grants g ON g.id = t.grant_id
       LEFT JOIN user_flags f ON f.user_id = u.id
      WHERE t.token_hash = ?`,
  ).bind(await sha256Hex(token)).first();
  if (!row || (row.kind === 'oauth') !== oauth) throw new McpAuthError(401, 'Token Akses AI tidak valid.', true);
  if (oauth) {
    if (!row.grant_id || row.grant_revoked_at || row.revoked_at) throw new McpAuthError(401, 'Koneksi ini sudah diputuskan. Hubungkan ulang Claude untuk login lagi.', true);
    if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) throw new McpAuthError(401, 'Token akses sudah kedaluwarsa.', true);
  } else if (row.revoked_at) {
    throw new McpAuthError(401, 'Token Akses AI ini sudah dicabut. Buat token baru di Pengaturan › Akses AI (MCP).', true);
  }
  if (row.suspended === 1) throw new McpAuthError(403, SUSPENDED_MESSAGE);
  return row;
}

async function touchToken(env, acct) {
  const lastSeen = acct.kind === 'oauth' ? acct.grant_last_used_at : acct.last_used_at;
  const last = Date.parse(lastSeen || '');
  if (Number.isFinite(last) && Date.now() - last < TOUCH_MS) return;
  const now = nowIso();
  try {
    if (acct.kind === 'oauth') await env.DB.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?').bind(now, acct.grant_id).run();
    else await env.DB.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').bind(now, acct.token_id).run();
  } catch { /* best effort */ }
}

/** RFC 9728 pointer so clients can discover the authorization server and start OAuth. */
export const resourceMetadataUrl = (origin) => `${origin}/.well-known/oauth-protected-resource`;

/**
 * Entry point for /mcp and /mcp/<token> (any method). `path` is the normalized pathname.
 * deps: { sha256Hex, isDemoUser }.
 */
export async function handleMcp(request, env, path, deps) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (!originAllowed(origin, url.origin)) return respond(rpcError(null, -32600, 'Origin tidak diizinkan.'), 403);
  const cors = corsHeaders(origin);

  const parts = path.split('/').filter(Boolean); // ['mcp'] or ['mcp', token]
  if (parts.length > 2) return respond(rpcError(null, -32600, 'Endpoint MCP tidak ditemukan.'), 404, cors);
  const pathToken = parts[1] ? decodeURIComponent(parts[1]) : null;

  if (request.method === 'OPTIONS') return respond(null, 204, cors);
  if (request.method !== 'POST') {
    // Stateless server: no SSE stream to open (GET) and no session to end (DELETE).
    return respond(rpcError(null, -32000, 'Metode HTTP tidak didukung. Kirim JSON-RPC dengan POST.'), 405, { ...cors, allow: 'POST, OPTIONS' });
  }

  const wwwAuth = (presented) => ({
    'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl(url.origin)}"${presented ? ', error="invalid_token"' : ''}`,
  });
  let acct;
  try {
    acct = await authenticateToken(request, env, pathToken, deps.sha256Hex);
    if (deps.isDemoUser({ email: acct.email })) throw new McpAuthError(403, 'Akun demo tidak bisa dipakai lewat Akses AI.');
  } catch (err) {
    if (!(err instanceof McpAuthError)) throw err;
    return respond(rpcError(null, -32001, err.message), err.status, { ...cors, ...(err.status === 401 ? wwwAuth(err.presented) : {}) });
  }

  if (!(await take(`m:${acct.token_id}`, LIMITS.perMinute, 60_000)) || !(await take(`h:${acct.token_id}`, LIMITS.perHour, 3_600_000))) {
    return respond(rpcError(null, -32002, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.'), 429, { ...cors, 'retry-after': '60' });
  }

  const pv = request.headers.get('mcp-protocol-version');
  if (pv && !PROTOCOL_VERSIONS.includes(pv)) {
    return respond(rpcError(null, -32600, `Versi protokol MCP tidak didukung: ${pv}. Didukung: ${PROTOCOL_VERSIONS.join(', ')}.`), 400, cors);
  }

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return respond(rpcError(null, -32600, 'Permintaan terlalu besar.'), 413, cors);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return respond(rpcError(null, -32600, 'Permintaan terlalu besar.'), 413, cors);
  let msg;
  try { msg = JSON.parse(raw); } catch { return respond(rpcError(null, -32700, 'Parse error: body bukan JSON yang valid.'), 400, cors); }

  await touchToken(env, acct);
  const ctx = { env, acct, cache: {} };
  const outHeaders = { ...cors, 'mcp-protocol-version': pv || LATEST_PROTOCOL };

  if (Array.isArray(msg)) {
    if (!msg.length) return respond(rpcError(null, -32600, 'Invalid Request: batch kosong.'), 400, outHeaders);
    if (msg.length > MAX_BATCH) return respond(rpcError(null, -32600, `Invalid Request: maksimal ${MAX_BATCH} pesan per batch.`), 400, outHeaders);
    const out = [];
    for (const m of msg) {
      const r = await dispatch(m, ctx);
      if (r) out.push(r);
    }
    return out.length ? respond(out, 200, outHeaders) : respond(null, 202, outHeaders);
  }
  const r = await dispatch(msg, ctx);
  return r ? respond(r, 200, outHeaders) : respond(null, 202, outHeaders);
}

/** One JSON-RPC message -> response object, or null for notifications / client responses. */
async function dispatch(m, ctx) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.jsonrpc !== '2.0') {
    return rpcError(m && typeof m === 'object' && !Array.isArray(m) && validId(m.id) ? m.id : null, -32600, 'Invalid Request.');
  }
  const isRequest = typeof m.method === 'string' && 'id' in m;
  if (!isRequest) {
    if (typeof m.method === 'string') return null; // notification (notifications/initialized, cancelled, …)
    if ('result' in m || 'error' in m) return null; // a response to a server request (we send none)
    return rpcError(validId(m.id) ? m.id : null, -32600, 'Invalid Request.');
  }
  if (!validId(m.id)) return rpcError(null, -32600, 'Invalid Request: id harus string atau angka.');
  const params = m.params === undefined ? {} : m.params;
  if (!params || typeof params !== 'object') return rpcError(m.id, -32602, 'Invalid params.');
  try {
    switch (m.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return rpcResult(m.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return rpcResult(m.id, {});
      case 'tools/list':
        return rpcResult(m.id, { tools: TOOLS.map(({ run, consent, ...def }) => def) });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return rpcError(m.id, -32602, `Tool tidak dikenal: ${String(params.name ?? '')}`);
        const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
        if (typeof args !== 'object' || Array.isArray(args)) return rpcError(m.id, -32602, 'arguments harus berupa objek.');
        return rpcResult(m.id, await callTool(tool, args, ctx));
      }
      default:
        return rpcError(m.id, -32601, `Method not found: ${m.method}`);
    }
  } catch (err) {
    console.error('mcp dispatch failed', err);
    return rpcError(m.id, -32603, 'Internal error.');
  }
}
const validId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

class ToolInputError extends Error {}

async function callTool(tool, args, ctx) {
  try {
    const clean = validateArgs(tool.inputSchema, args);
    const { text, data } = await tool.run(clean, ctx);
    return { content: [{ type: 'text', text }], ...(data !== undefined ? { structuredContent: data } : {}), isError: false };
  } catch (err) {
    if (err instanceof ToolInputError) return { content: [{ type: 'text', text: err.message }], isError: true };
    console.error(`mcp tool ${tool.name} failed`, err);
    return { content: [{ type: 'text', text: 'Terjadi kesalahan saat membaca data Satu Alur. Coba lagi sebentar lagi.' }], isError: true };
  }
}

/** Minimal JSON Schema check for the flat schemas below (string / integer / enum, bounds clamped). */
function validateArgs(schema, args) {
  const out = {};
  for (const req of schema.required || []) {
    if (args[req] === undefined || args[req] === null || args[req] === '') throw new ToolInputError(`Argumen "${req}" wajib diisi.`);
  }
  for (const [k, spec] of Object.entries(schema.properties || {})) {
    let v = args[k];
    if (v === undefined || v === null || v === '') continue;
    if (spec.type === 'string') {
      if (typeof v !== 'string') throw new ToolInputError(`Argumen "${k}" harus berupa teks.`);
      v = v.trim().slice(0, spec.maxLength || 200);
      if (spec.enum && !spec.enum.includes(v)) throw new ToolInputError(`Argumen "${k}" harus salah satu dari: ${spec.enum.join(', ')}.`);
    } else if (spec.type === 'integer') {
      const n = typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isInteger(n)) throw new ToolInputError(`Argumen "${k}" harus bilangan bulat.`);
      v = Math.min(spec.maximum ?? n, Math.max(spec.minimum ?? n, n));
    }
    out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ data (owner-scoped)

const parseJson = (v) => {
  if (v == null || typeof v === 'object') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
};

async function rowsOf(env, sql, ...args) {
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results || [];
}

/** Loads the flow tables of one account (memoized per HTTP request) and builds the Alur kerja rows. */
async function loadFlow(ctx) {
  if (ctx.cache.flow) return ctx.cache.flow;
  const { env, acct } = ctx;
  const id = acct.owner_id;
  const q = (table) => rowsOf(env, `SELECT * FROM ${table} WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ${ROW_CAP}`, id);
  const [requests, offers, assignments, completions, ledger, invoices] = await Promise.all(
    ['requests', 'offers', 'assignments', 'completions', 'ledger_entries', 'invoices'].map(q),
  );
  for (const o of offers) { o.ai_proposal_json = parseJson(o.ai_proposal_json); o.template_answers_json = parseJson(o.template_answers_json); }
  for (const c of completions) c.photos_path = parseJson(c.photos_path);
  const model = buildModel({ requests, offers, assignments, completions, ledger_entries: ledger });
  const rows = workflowRows(model, { invoices });
  ctx.cache.flow = { model, rows, invoices };
  return ctx.cache.flow;
}

// ------------------------------------------------------------------ formatting

const wib = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t + WIB_MS).toISOString() : null;
};
/** YYYY-MM-DD in WIB. */
export const fmtDate = (iso) => wib(iso)?.slice(0, 10) || null;
/** YYYY-MM-DD HH:MM WIB. */
const fmtDateTime = (iso) => { const w = wib(iso); return w ? `${w.slice(0, 10)} ${w.slice(11, 16)} WIB` : null; };
const monthKey = (iso) => wib(iso)?.slice(0, 7) || '';
const todayWib = (now = Date.now()) => new Date(now + WIB_MS).toISOString().slice(0, 10);
const rp = (n) => idr(n);
const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const POSISI = FILTERS.filter((f) => f.value !== 'all');
const posisiLabel = (v) => POSISI.find((f) => f.value === v)?.label || v;

function jobSummary(r) {
  return {
    id: r.id,
    pelanggan: r.customer,
    layanan: r.service || null,
    lokasi: r.location || null,
    tahap: stageOf(r),
    posisi: r.filter,
    status: r.status.label,
    langkah_berikutnya: r.next ? `${r.next.label}${r.next.optional ? ' (opsional)' : ''}` : null,
    petugas: r.worker || null,
    harga_penawaran: r.price,
    invoice: r.invoice ? { nomor: r.invoice.number, status: r.invoice.status, total: Number(r.invoice.total) || 0 } : null,
    diperbarui: fmtDate(r.updatedAt),
  };
}

function jobLine(j) {
  const what = [j.layanan, j.lokasi].filter(Boolean).join(', ');
  const bits = [
    `#${j.id} ${j.pelanggan}${what ? ` — ${what}` : ''}`,
    `tahap ${j.tahap}: ${lower1(j.status)}`,
    j.langkah_berikutnya ? `berikutnya: ${lower1(j.langkah_berikutnya)}` : null,
    j.petugas ? `petugas ${j.petugas}` : null,
    j.harga_penawaran ? `penawaran ${rp(j.harga_penawaran)}` : null,
    j.invoice ? `invoice ${j.invoice.nomor} (${j.invoice.status})` : null,
    j.diperbarui ? `diperbarui ${j.diperbarui}` : null,
  ].filter(Boolean);
  return `• ${bits.join(' · ')}`;
}

const byUpdated = (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || Number(b.id) - Number(a.id);

// ------------------------------------------------------------------ tools

const LIMIT_PROP = { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Jumlah baris maksimal (bawaan 20, maks 100). / Max rows (default 20, max 100).' };
const ANN = (title) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

async function cariPekerjaan({ q = '', posisi, limit = 20 }, ctx) {
  const { rows } = await loadFlow(ctx);
  const counts = filterCounts(rows);
  const hits = rows.filter((r) => (!posisi || r.filter === posisi) && matchesQuery(r, q)).sort(byUpdated);
  const jobs = hits.slice(0, limit).map(jobSummary);
  const scope = [q ? `kata kunci "${q}"` : null, posisi ? `posisi "${posisiLabel(posisi)}"` : null].filter(Boolean).join(', ');
  const countLine = POSISI.map((f) => `${f.label} ${counts[f.value] || 0}`).join(', ');
  const head = hits.length
    ? `${hits.length} pekerjaan${scope ? ` untuk ${scope}` : ''}${hits.length > jobs.length ? ` (${jobs.length} terbaru ditampilkan)` : ''}:`
    : `Tidak ada pekerjaan${scope ? ` untuk ${scope}` : ''}.`;
  const text = [head, ...jobs.map(jobLine), '', `Semua pekerjaan (${counts.all}): ${countLine}.`].join('\n');
  return {
    text,
    data: {
      total_cocok: hits.length,
      ditampilkan: jobs.length,
      jumlah_per_posisi: Object.fromEntries(POSISI.map((f) => [f.value, counts[f.value] || 0])),
      pekerjaan: jobs,
    },
  };
}

function jobDates(r) {
  return {
    permintaan: fmtDate(r.request?.created_at),
    penawaran: fmtDate(r.offer?.created_at),
    dijadwalkan: fmtDateTime(r.assignment?.scheduled_at),
    selesai: fmtDate(r.completion?.completed_at || r.completion?.created_at),
    dibukukan: r.ledger.length ? fmtDate(r.ledger.map((l) => String(ledgerDate(l) || '')).sort()[0]) : null,
  };
}

async function progresPelanggan({ nama }, ctx) {
  const { rows } = await loadFlow(ctx);
  if (!rows.length) return { text: 'Belum ada pekerjaan yang tercatat di akun ini.', data: { pelanggan: [] } };
  const found = findCustomers(rows, nama);
  if (!found.length) {
    const names = [...new Set(rows.slice().sort(byUpdated).map((r) => r.customer))].slice(0, 15);
    return {
      text: `Tidak ada pelanggan yang cocok dengan "${nama}". Pelanggan terbaru: ${names.join(', ')}.`,
      data: { pelanggan: [], saran: names },
    };
  }
  const top = found[0].score;
  const groups = found.filter((g) => g.score === top).slice(0, 5);
  const others = found.filter((g) => g.score !== top).slice(0, 5).map((g) => g.name);
  const out = groups.map((g) => {
    const jobs = g.rows.slice().sort((a, b) => Number(a.done) - Number(b.done) || byUpdated(a, b));
    return {
      nama: g.name,
      jumlah_pekerjaan: jobs.length,
      pekerjaan: jobs.slice(0, 20).map((r) => ({ ...jobSummary(r), tanggal: jobDates(r) })),
    };
  });
  const lines = [];
  if (groups.length > 1) lines.push(`${groups.length} pelanggan cocok dengan "${nama}":`);
  for (const g of out) {
    lines.push(`${g.nama} — ${g.jumlah_pekerjaan} pekerjaan${g.jumlah_pekerjaan > g.pekerjaan.length ? ` (${g.pekerjaan.length} ditampilkan)` : ''}:`);
    for (const j of g.pekerjaan) {
      const d = j.tanggal;
      const dates = [d.permintaan && `permintaan ${d.permintaan}`, d.dijadwalkan && `jadwal ${d.dijadwalkan}`, d.selesai && `selesai ${d.selesai}`]
        .filter(Boolean).join(', ');
      lines.push(`${jobLine(j)}${dates ? ` · ${dates}` : ''}`);
    }
  }
  if (others.length) lines.push(`Mungkin juga: ${others.join(', ')}.`);
  return { text: lines.join('\n'), data: { pelanggan: out, mirip: others } };
}

const OFFER_STATUS = { approved: 'disetujui', rejected: 'ditolak', draft: 'draf' };

async function detailPekerjaan({ id }, ctx) {
  const { rows } = await loadFlow(ctx);
  const r = rows.find((x) => Number(x.id) === Number(id));
  if (!r) throw new ToolInputError(`Pekerjaan #${id} tidak ditemukan di akun ini. Pakai cari_pekerjaan atau progres_pelanggan untuk melihat id yang ada.`);
  const tl = timeline(r);
  const p = r.offer?.ai_proposal_json || {};
  const offer = r.offer ? {
    id: r.offer.id,
    status: OFFER_STATUS[r.offer.status] || 'draf',
    harga: offerPrice(r.offer),
    lingkup: r.offer.validated_scope || p.scope || null,
    syarat: p.terms || null,
    catatan: p.notes || null,
    tanggal: fmtDate(r.offer.created_at),
  } : null;
  const a = r.assignment;
  const assignment = a ? {
    id: a.id, petugas: a.worker_name || null, jadwal: fmtDateTime(a.scheduled_at), status: a.status,
    progres: progressLabel(a.progress), catatan_progres: a.progress_note || null,
  } : null;
  const completion = r.completion ? { id: r.completion.id, catatan: r.completion.notes || null, selesai: fmtDate(r.completion.completed_at || r.completion.created_at), status: r.completion.status } : null;
  const ledger = r.ledger.map((l) => ({ kategori: categoryLabel(l.category), jenis: isRevenue(l) ? 'pendapatan' : 'biaya', jumlah: Number(l.amount) || 0, tanggal: fmtDate(ledgerDate(l)) }));
  const sum = totals(r.ledger);
  let invoice = null;
  if (r.invoice) {
    const items = await rowsOf(ctx.env, 'SELECT description, qty, unit_price, amount FROM invoice_items WHERE invoice_id = ? AND owner_id = ? ORDER BY position, id LIMIT 100', r.invoice.id, ctx.acct.owner_id);
    invoice = {
      nomor: r.invoice.number, status: r.invoice.status, terbit: r.invoice.issue_date, jatuh_tempo: r.invoice.due_date || null,
      subtotal: Number(r.invoice.subtotal) || 0, diskon: Number(r.invoice.discount) || 0, ppn: Number(r.invoice.tax_amount) || 0, total: Number(r.invoice.total) || 0,
      dibayar: fmtDate(r.invoice.paid_at),
      item: items.map((i) => ({ uraian: i.description, qty: Number(i.qty), harga: Number(i.unit_price) || 0, jumlah: Number(i.amount) || 0 })),
    };
  }
  const req = r.request;
  const steps = tl.items.map((it) => ({ tahap: it.label, keadaan: it.state, tanggal: fmtDate(it.date), catatan: it.note }));
  const mark = { done: '✓', current: '→', todo: '·' };
  const lines = [
    `Pekerjaan #${r.id} — ${r.customer}${r.service ? `, ${r.service}` : ''}${r.location ? ` (${r.location})` : ''}`,
    `Status: ${r.status.label}. Tahap: ${stageOf(r)}.${r.next ? ` Langkah berikutnya: ${lower1(r.next.label)}${r.next.optional ? ' (opsional)' : ''}.` : ''}`,
    req.description ? `Permintaan: ${String(req.description).slice(0, 400)}` : null,
    [req.phone && `Telp ${req.phone}`, req.email && `Email ${req.email}`].filter(Boolean).join(' · ') || null,
    '',
    'Linimasa:',
    ...steps.map((s) => `${mark[s.keadaan] || '·'} ${s.tahap}${s.tanggal ? ` (${s.tanggal})` : ''}: ${s.catatan}`),
    offer ? `\nPenawaran #${offer.id} (${offer.status}): ${offer.harga ? rp(offer.harga) : 'harga belum ada'}${offer.lingkup ? `\nLingkup: ${String(offer.lingkup).slice(0, 600)}` : ''}${offer.syarat ? `\nSyarat: ${String(offer.syarat).slice(0, 400)}` : ''}` : null,
    assignment ? `Penugasan: petugas ${assignment.petugas || '—'}${assignment.jadwal ? `, jadwal ${assignment.jadwal}` : ''}, progres ${lower1(assignment.progres)}${assignment.catatan_progres ? ` (${assignment.catatan_progres})` : ''}.` : null,
    completion ? `Penyelesaian ${completion.selesai || ''}: ${completion.catatan || 'tanpa catatan'}.` : null,
    ledger.length ? `Pembukuan: ${ledger.map((l) => `${l.kategori} ${rp(l.jumlah)}`).join(', ')} → laba ${rp(sum.profit)}.` : null,
    invoice ? `Invoice ${invoice.nomor} (${invoice.status}): total ${rp(invoice.total)}${invoice.jatuh_tempo ? `, jatuh tempo ${invoice.jatuh_tempo}` : ''}${invoice.dibayar ? `, dibayar ${invoice.dibayar}` : ''}.` : null,
  ].filter((x) => x !== null);
  return {
    text: lines.join('\n'),
    data: {
      ...jobSummary(r),
      permintaan: { tanggal: fmtDate(req.created_at), deskripsi: req.description || null, telepon: req.phone || null, email: req.email || null },
      linimasa: steps,
      penawaran: offer,
      penugasan: assignment,
      penyelesaian: completion,
      pembukuan: { baris: ledger, pendapatan: sum.revenue, biaya: sum.cost, laba: sum.profit },
      invoice_detail: invoice,
    },
  };
}

const PERIODS = {
  bulan_ini: 'Bulan ini',
  bulan_lalu: 'Bulan lalu',
  tahun_ini: 'Tahun ini',
  semua: 'Semua waktu',
};

/** Ledger filter for a period, by WIB calendar (the business is in Indonesia). */
export function periodFilter(periode, now = Date.now()) {
  const today = todayWib(now);
  const ym = today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  if (periode === 'bulan_ini') return { label: `${PERIODS[periode]} (${ym})`, test: (iso) => monthKey(iso) === ym };
  if (periode === 'bulan_lalu') return { label: `${PERIODS[periode]} (${prev})`, test: (iso) => monthKey(iso) === prev };
  if (periode === 'tahun_ini') return { label: `${PERIODS[periode]} (${y})`, test: (iso) => monthKey(iso).startsWith(`${y}-`) };
  return { label: PERIODS.semua, test: () => true };
}

async function ringkasanKeuangan({ periode = 'bulan_ini' }, ctx) {
  const { model, invoices } = await loadFlow(ctx);
  const p = periodFilter(periode);
  const entries = model.ledger.filter((l) => p.test(ledgerDate(l)));
  const t = totals(entries);
  const byCat = {};
  for (const l of entries) if (!isRevenue(l)) byCat[categoryLabel(l.category)] = (byCat[categoryLabel(l.category)] || 0) + (Number(l.amount) || 0);
  const unbooked = model.completionsWithoutLedger();
  const unbookedValue = unbooked.reduce((s, c) => s + (offerPrice(model.offerOfCompletion(c)) || 0), 0);
  const today = todayWib();
  const sent = invoices.filter((i) => i.status === 'terkirim');
  const overdue = sent.filter((i) => i.due_date && i.due_date < today);
  const sum = (xs) => xs.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const drafts = invoices.filter((i) => i.status === 'draft');
  const margin = t.revenue > 0 ? Math.round((t.profit / t.revenue) * 100) : null;
  const lines = [
    `${p.label}: pendapatan ${rp(t.revenue)}, biaya ${rp(t.cost)}, laba ${rp(t.profit)}${margin !== null ? ` (margin ${margin}%)` : ''}. Dari ${entries.length} catatan buku besar.`,
    Object.keys(byCat).length ? `Rincian biaya: ${Object.entries(byCat).map(([k, v]) => `${k} ${rp(v)}`).join(', ')}.` : null,
    unbooked.length ? `${unbooked.length} pekerjaan selesai belum dibukukan (nilai penawaran ±${rp(unbookedValue)}), belum termasuk di angka di atas.` : 'Semua pekerjaan selesai sudah dibukukan.',
    sent.length ? `${sent.length} invoice terkirim belum lunas, total ${rp(sum(sent))}${overdue.length ? `; ${overdue.length} lewat jatuh tempo (${rp(sum(overdue))})` : ''}.` : 'Tidak ada invoice terkirim yang belum lunas.',
    drafts.length ? `${drafts.length} invoice masih draf (${rp(sum(drafts))}).` : null,
  ].filter(Boolean);
  return {
    text: lines.join('\n'),
    data: {
      periode, label: p.label,
      pendapatan: t.revenue, biaya: t.cost, laba: t.profit, margin_persen: margin,
      rincian_biaya: byCat,
      jumlah_catatan: entries.length,
      belum_dibukukan: { jumlah: unbooked.length, nilai_penawaran: unbookedValue },
      invoice_belum_lunas: { jumlah: sent.length, total: sum(sent), lewat_jatuh_tempo: overdue.length, total_lewat_jatuh_tempo: sum(overdue) },
      invoice_draf: { jumlah: drafts.length, total: sum(drafts) },
    },
  };
}

const INVOICE_STATUS = ['draft', 'terkirim', 'lunas', 'batal'];

async function daftarInvoice({ status, limit = 20 }, ctx) {
  const { env, acct } = ctx;
  const where = status ? 'owner_id = ? AND status = ?' : 'owner_id = ?';
  const args = status ? [acct.owner_id, status] : [acct.owner_id];
  const [list, groups] = await Promise.all([
    rowsOf(env, `SELECT id, number, customer_name, request_id, total, issue_date, due_date, status, paid_at FROM invoices WHERE ${where} ORDER BY issue_date DESC, id DESC LIMIT ${Number(limit)}`, ...args),
    rowsOf(env, 'SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM invoices WHERE owner_id = ? GROUP BY status', acct.owner_id),
  ]);
  const today = todayWib();
  const items = list.map((i) => ({
    nomor: i.number, pelanggan: i.customer_name, pekerjaan_id: i.request_id ?? null, total: Number(i.total) || 0,
    terbit: i.issue_date, jatuh_tempo: i.due_date || null, status: i.status, dibayar: fmtDate(i.paid_at),
    lewat_jatuh_tempo: i.status === 'terkirim' && Boolean(i.due_date) && i.due_date < today,
  }));
  const per = Object.fromEntries(INVOICE_STATUS.map((s) => [s, { jumlah: 0, total: 0 }]));
  for (const g of groups) if (per[g.status]) per[g.status] = { jumlah: Number(g.n) || 0, total: Number(g.total) || 0 };
  const matching = status ? per[status].jumlah : Object.values(per).reduce((s, x) => s + x.jumlah, 0);
  const head = matching
    ? `${matching} invoice${status ? ` berstatus ${status}` : ''}${matching > items.length ? ` (${items.length} terbaru ditampilkan)` : ''}:`
    : `Tidak ada invoice${status ? ` berstatus ${status}` : ''}.`;
  const lines = [
    head,
    ...items.map((i) => `• ${i.nomor} — ${i.pelanggan}: ${rp(i.total)} · ${i.status}${i.jatuh_tempo ? ` · jatuh tempo ${i.jatuh_tempo}` : ''}${i.lewat_jatuh_tempo ? ' (LEWAT JATUH TEMPO)' : ''}${i.dibayar ? ` · dibayar ${i.dibayar}` : ''}`),
    '',
    `Ringkasan: ${INVOICE_STATUS.map((s) => `${s} ${per[s].jumlah} (${rp(per[s].total)})`).join(', ')}. Belum lunas = terkirim.`,
  ];
  return { text: lines.join('\n'), data: { total_cocok: matching, ditampilkan: items.length, per_status: per, invoice: items } };
}

async function infoAkun(_args, ctx) {
  const { env, acct } = ctx;
  const [company, sub, workers] = await Promise.all([
    env.DB.prepare('SELECT company FROM customer_accounts WHERE owner_id = ?').bind(acct.owner_id).first().catch(() => null),
    env.DB.prepare('SELECT p.name FROM customer_accounts c JOIN subscription_plans p ON p.id = c.plan_id WHERE c.owner_id = ?').bind(acct.owner_id).first().catch(() => null),
    env.DB.prepare("SELECT COUNT(*) AS n FROM workers WHERE owner_id = ? AND status = 'active'").bind(acct.owner_id).first(),
  ]);
  const { rows, model, invoices } = await loadFlow(ctx);
  const counts = filterCounts(rows);
  const name = company?.company || acct.name || acct.email;
  const plan = normalizePlan(acct.plan);
  const data = {
    nama_usaha: name,
    email: acct.email,
    skala_akun: planLabel(plan),
    paket: sub?.name || null,
    terdaftar: fmtDate(acct.created_at),
    token: acct.token_name || null,
    jumlah: {
      pekerjaan: counts.all,
      pekerjaan_berjalan: rows.filter((r) => !r.done).length,
      penawaran: model.offers.length,
      petugas_aktif: Number(workers?.n) || 0,
      catatan_buku_besar: model.ledger.length,
      invoice: invoices.length,
    },
    jumlah_per_posisi: Object.fromEntries(POSISI.map((f) => [f.value, counts[f.value] || 0])),
  };
  const j = data.jumlah;
  const text = [
    `Akun: ${name} (${acct.email}). Skala akun: ${data.skala_akun}${data.paket ? `, paket ${data.paket}` : ''}. Terdaftar ${data.terdaftar || '—'}.`,
    `${j.pekerjaan} pekerjaan (${j.pekerjaan_berjalan} masih berjalan), ${j.penawaran} penawaran, ${j.petugas_aktif} petugas aktif, ${j.catatan_buku_besar} catatan buku besar, ${j.invoice} invoice.`,
    `Per posisi: ${POSISI.map((f) => `${f.label} ${data.jumlah_per_posisi[f.value]}`).join(', ')}.`,
    data.token ? `Terhubung lewat ${acct.kind === 'oauth' ? `login (${data.token})` : `token "${data.token}"`} (hanya baca).` : null,
  ].filter(Boolean).join('\n');
  return { text, data };
}

export const TOOLS = [
  {
    name: 'cari_pekerjaan',
    title: 'Cari pekerjaan',
    description: 'Cari dan saring pekerjaan (satu baris per permintaan pelanggan) beserta posisinya di alur kerja, status, dan langkah berikutnya. '
      + 'Search/filter jobs (one per customer request) with their workflow position, status and next step. '
      + 'posisi: request = belum ada penawaran, offer = penawaran draf/ditolak, assign = disetujui belum ditugaskan, work = sedang dikerjakan, book = selesai belum dibukukan, done = selesai & dibukukan.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 100, description: 'Kata kunci: nama pelanggan, layanan, lokasi, petugas, atau nomor pekerjaan. / Keyword (customer, service, location, worker, job id).' },
        posisi: { type: 'string', enum: POSISI.map((f) => f.value), description: 'Saring menurut posisi di alur kerja. / Filter by workflow position.' },
        limit: LIMIT_PROP,
      },
      additionalProperties: false,
    },
    annotations: ANN('Cari pekerjaan'),
    consent: 'Daftar pekerjaan dan posisinya di alur kerja',
    run: cariPekerjaan,
  },
  {
    name: 'progres_pelanggan',
    title: 'Progres pelanggan',
    description: 'Jawab "pekerjaan untuk pelanggan X sudah sampai mana?": cocokkan nama pelanggan (toleran salah ketik, tanpa PT/CV) lalu tampilkan tiap pekerjaannya dengan tahap, status, langkah berikutnya, tanggal, harga penawaran, dan petugas. '
      + 'Progress of a customer\'s jobs by (fuzzy) customer name.',
    inputSchema: {
      type: 'object',
      properties: { nama: { type: 'string', maxLength: 100, description: 'Nama pelanggan, misalnya "PT Maju Jaya" atau "maju". / Customer name.' } },
      required: ['nama'],
      additionalProperties: false,
    },
    annotations: ANN('Progres pelanggan'),
    consent: 'Progres pekerjaan per pelanggan',
    run: progresPelanggan,
  },
  {
    name: 'detail_pekerjaan',
    title: 'Detail pekerjaan',
    description: 'Rincian lengkap satu pekerjaan menurut id (nomor permintaan): linimasa 5 tahap, lingkup/harga/syarat penawaran, penugasan & progres, catatan penyelesaian, baris pembukuan, dan invoice. '
      + 'Full detail and timeline of one job by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', minimum: 1, description: 'Id pekerjaan (nomor permintaan, mis. 12 untuk #12). / Job (request) id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: ANN('Detail pekerjaan'),
    consent: 'Rincian satu pekerjaan: penawaran, penugasan, penyelesaian, pembukuan, invoice',
    run: detailPekerjaan,
  },
  {
    name: 'ringkasan_keuangan',
    title: 'Ringkasan keuangan',
    description: 'Pendapatan, biaya, dan laba dari buku besar untuk satu periode (kalender WIB), plus pekerjaan selesai yang belum dibukukan dan invoice yang belum lunas. '
      + 'Revenue, cost and profit for a period, plus unbooked jobs and unpaid invoices.',
    inputSchema: {
      type: 'object',
      properties: { periode: { type: 'string', enum: Object.keys(PERIODS), default: 'bulan_ini', description: 'bulan_ini (bawaan), bulan_lalu, tahun_ini, atau semua. / Period (default this month).' } },
      additionalProperties: false,
    },
    annotations: ANN('Ringkasan keuangan'),
    consent: 'Pendapatan, biaya, dan laba',
    run: ringkasanKeuangan,
  },
  {
    name: 'daftar_invoice',
    title: 'Daftar invoice',
    description: 'Daftar invoice terbaru: nomor, pelanggan, total, jatuh tempo, status, dan tanda lewat jatuh tempo. Status "terkirim" berarti belum lunas. '
      + 'List invoices (status "terkirim" = sent but unpaid).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: INVOICE_STATUS, description: 'Saring menurut status: draft, terkirim (belum lunas), lunas, batal. / Filter by status.' },
        limit: LIMIT_PROP,
      },
      additionalProperties: false,
    },
    annotations: ANN('Daftar invoice'),
    consent: 'Daftar invoice dan statusnya',
    run: daftarInvoice,
  },
  {
    name: 'info_akun',
    title: 'Info akun',
    description: 'Nama usaha, skala akun/paket, dan jumlah data (pekerjaan, penawaran, petugas, pembukuan, invoice). Account overview.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ANN('Info akun'),
    consent: 'Nama usaha, paket, dan jumlah data',
    run: infoAkun,
  },
];

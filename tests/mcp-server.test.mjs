// Akses AI (MCP server, worker/mcp-server.js): token API + JSON-RPC over Streamable HTTP, run through
// the real Worker on SQLite with every migration applied (tests/helpers/d1-sqlite.mjs).
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const HOST = 'https://satu-alur.example.dev'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const sessionOf = (uid) => `${uid}-session-token-0123456789`

async function setup(t) {
  let makeD1
  try { ({ makeD1 } = await import('./helpers/d1-sqlite.mjs')); await import('node:sqlite') } catch { t.skip('SQLite integration requires Node 22.13+'); return null }
  const DB = await makeD1()
  t.after(() => DB.raw.close())
  const sql = DB.raw
  const users = [
    ['alice', 'alice@usaha.id', 'CV Alice Teknik'],
    ['bob', 'bob@usaha.id', 'Bob Cleaning'],
    ['demo', 'demo-ac@satualur.id', 'Demo AC'],
    ['susp', 'susp@usaha.id', 'Suspended'],
  ]
  for (const [id, email, name] of users) {
    sql.prepare('INSERT INTO users(id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, name, '2026-01-02T00:00:00Z')
    sql.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(sessionOf(id)), id, '2099-01-01T00:00:00Z')
  }
  sql.prepare("INSERT INTO user_flags(user_id, suspended, plan, updated_at) VALUES ('alice', 0, 'ukm', '2026-01-01')").run()

  // Alice: three jobs at different positions. Dates are "now" so bulan_ini picks them up.
  const now = new Date().toISOString()
  const ins = (q, ...a) => Number(sql.prepare(q).run(...a).lastInsertRowid)
  const r1 = ins("INSERT INTO requests(owner_id, customer_name, service_type, location, phone, status, created_at) VALUES ('alice', 'PT Maju Jaya', 'Servis AC', 'Bekasi', '0812-1', 'new', ?)", now)
  const o1 = ins("INSERT INTO offers(owner_id, request_id, ai_proposal_json, validated_price, validated_scope, status, created_at) VALUES ('alice', ?, ?, 1500000, 'Cuci 3 unit AC', 'approved', ?)", r1, JSON.stringify({ price: 1500000, terms: 'Garansi 30 hari' }), now)
  const a1 = ins("INSERT INTO assignments(owner_id, offer_id, worker_name, scheduled_at, status, progress, created_at) VALUES ('alice', ?, 'Budi', ?, 'done', 'selesai', ?)", o1, now, now)
  const c1 = ins("INSERT INTO completions(owner_id, assignment_id, notes, status, completed_at, created_at) VALUES ('alice', ?, 'Semua unit dingin', 'done', ?, ?)", a1, now, now)
  ins("INSERT INTO ledger_entries(owner_id, completion_id, amount, category, status, posted_at, created_at) VALUES ('alice', ?, 1500000, 'pendapatan', 'posted', ?, ?)", c1, now, now)
  ins("INSERT INTO ledger_entries(owner_id, completion_id, amount, category, status, posted_at, created_at) VALUES ('alice', ?, 400000, 'biaya_tenaga', 'posted', ?, ?)", c1, now, now)
  const inv = ins("INSERT INTO invoices(owner_id, completion_id, request_id, number, customer_name, issue_date, due_date, subtotal, tax_rate, tax_amount, total, status, created_at) VALUES ('alice', ?, ?, 'INV-2026-0001', 'PT Maju Jaya', '2026-01-05', '2026-01-19', 1500000, 0, 0, 1500000, 'terkirim', ?)", c1, r1, now)
  ins("INSERT INTO invoice_items(owner_id, invoice_id, description, qty, unit_price, amount) VALUES ('alice', ?, 'Cuci AC', 3, 500000, 1500000)", inv)
  const r2 = ins("INSERT INTO requests(owner_id, customer_name, service_type, status, created_at) VALUES ('alice', 'Toko Sinar', 'Pasang AC', 'new', ?)", now)
  const o2 = ins("INSERT INTO offers(owner_id, request_id, validated_price, status, created_at) VALUES ('alice', ?, 800000, 'approved', ?)", r2, now)
  ins("INSERT INTO assignments(owner_id, offer_id, worker_name, status, progress, created_at) VALUES ('alice', ?, 'Sari', 'assigned', 'dikerjakan', ?)", o2, now)
  const r3 = ins("INSERT INTO requests(owner_id, customer_name, service_type, status, created_at) VALUES ('alice', 'Ibu Ratna', 'Bongkar AC', 'new', ?)", now)
  ins("INSERT INTO workers(owner_id, name, status) VALUES ('alice', 'Budi', 'active')")

  // Bob: one job with a name that would match Alice's search terms too.
  const rb = ins("INSERT INTO requests(owner_id, customer_name, service_type, status, created_at) VALUES ('bob', 'PT Maju Rahasia', 'Cleaning', 'new', ?)", now)
  const ob = ins("INSERT INTO offers(owner_id, request_id, validated_price, status, created_at) VALUES ('bob', ?, 9000000, 'approved', ?)", rb, now)
  const ab = ins("INSERT INTO assignments(owner_id, offer_id, worker_name, status, created_at) VALUES ('bob', ?, 'Rahasia', 'done', ?)", ob, now)
  const cb = ins("INSERT INTO completions(owner_id, assignment_id, status, created_at) VALUES ('bob', ?, 'done', ?)", ab, now)
  ins("INSERT INTO invoices(owner_id, completion_id, request_id, number, customer_name, issue_date, subtotal, tax_rate, tax_amount, total, status, created_at) VALUES ('bob', ?, ?, 'INV-2026-0001', 'PT Maju Rahasia', '2026-01-05', 9000000, 0, 0, 9000000, 'terkirim', ?)", cb, rb, now)

  const env = { DB, DEMO_OTP: 'false' }
  const { default: worker } = await import('../worker/index.js')
  const { _resetLimits } = await import('../worker/mcp-server.js')
  _resetLimits()
  const fetchW = (path, init = {}) => worker.fetch(new Request(`${HOST}${path}`, init), env)
  const api = async (uid, method, path, body, expected = 200) => {
    const res = await fetchW(path, { method, headers: { authorization: `Bearer ${sessionOf(uid)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    assert.equal(res.status, expected, text)
    return JSON.parse(text)
  }
  const rpc = async (token, body, { expected = 200, path = '/mcp', headers = {} } = {}) => {
    const res = await fetchW(path, {
      method: 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    assert.equal(res.status, expected, text)
    return { res, body: text ? JSON.parse(text) : null }
  }
  let nextId = 1
  const call = async (token, name, args, opts) => (await rpc(token, { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, opts)).body
  return { env, sql, api, rpc, call, fetchW, ids: { r1, r2, r3, rb } }
}

test('mcp tokens: create shows the token once, list shows only the prefix, revoke', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const { api, sql } = ctx
  assert.deepEqual((await api('alice', 'GET', '/api/mcp-tokens')).data.items, [])
  const created = (await api('alice', 'POST', '/api/mcp-tokens', { name: '  Claude   Desktop ' }, 201)).data
  assert.match(created.token, /^sa_mcp_[A-Za-z0-9_-]{43}$/)
  assert.equal(created.item.name, 'Claude Desktop')
  assert.equal(created.item.prefix, created.token.slice(0, 11))
  const stored = sql.prepare('SELECT * FROM mcp_tokens').all()
  assert.equal(stored.length, 1)
  assert.equal(stored[0].token_hash, sha(created.token), 'only the SHA-256 is stored')
  assert.ok(!JSON.stringify(stored).includes(created.token))
  const list = (await api('alice', 'GET', '/api/mcp-tokens')).data
  assert.equal(list.items.length, 1)
  assert.ok(!JSON.stringify(list).includes(created.token), 'list never returns the token')
  assert.deepEqual(Object.keys(list.items[0]).sort(), ['created_at', 'id', 'last_used_at', 'name', 'prefix'])
  // Default label, and bob cannot see or revoke alice's token
  assert.equal((await api('alice', 'POST', '/api/mcp-tokens', {}, 201)).data.item.name, 'Claude')
  assert.equal((await api('bob', 'GET', '/api/mcp-tokens')).data.items.length, 0)
  await api('bob', 'DELETE', `/api/mcp-tokens/${created.item.id}`, undefined, 404)
  await api('alice', 'DELETE', `/api/mcp-tokens/${created.item.id}`)
  await api('alice', 'DELETE', `/api/mcp-tokens/${created.item.id}`, undefined, 404)
  assert.equal((await api('alice', 'GET', '/api/mcp-tokens')).data.items.length, 1)
  await api('alice', 'DELETE', '/api/mcp-tokens/abc', undefined, 400)
  // Signed-out, demo and cap
  const res = await ctx.fetchW('/api/mcp-tokens')
  assert.equal(res.status, 401)
  const demo = await api('demo', 'POST', '/api/mcp-tokens', { name: 'x' }, 403)
  assert.match(demo.error.message, /Akun demo/)
  assert.equal((await api('demo', 'GET', '/api/mcp-tokens')).data.demo, true)
  for (let i = 0; i < 9; i++) await api('alice', 'POST', '/api/mcp-tokens', { name: `t${i}` }, 201)
  await api('alice', 'POST', '/api/mcp-tokens', { name: 'too many' }, 409)
})

test('mcp: initialize, initialized notification, ping, tools/list, version negotiation', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const token = (await ctx.api('alice', 'POST', '/api/mcp-tokens', { name: 'Claude' }, 201)).data.token
  const init = await ctx.rpc(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  assert.match(init.res.headers.get('content-type'), /application\/json/)
  const r = init.body.result
  assert.equal(r.protocolVersion, '2025-06-18')
  assert.deepEqual(r.serverInfo.name, 'satu-alur')
  assert.ok(r.capabilities.tools)
  assert.match(r.instructions, /progres_pelanggan/)
  for (const v of ['2025-03-26', '2024-11-05']) {
    assert.equal((await ctx.rpc(token, { jsonrpc: '2.0', id: 'x', method: 'initialize', params: { protocolVersion: v } })).body.result.protocolVersion, v)
  }
  assert.equal((await ctx.rpc(token, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).body.result.protocolVersion, '2025-06-18')
  const note = await ctx.rpc(token, { jsonrpc: '2.0', method: 'notifications/initialized' }, { expected: 202 })
  assert.equal(note.body, null)
  assert.deepEqual((await ctx.rpc(token, { jsonrpc: '2.0', id: 3, method: 'ping' })).body, { jsonrpc: '2.0', id: 3, result: {} })
  const tools = (await ctx.rpc(token, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, { headers: { 'mcp-protocol-version': '2025-06-18' } })).body.result.tools
  assert.deepEqual(tools.map((x) => x.name), ['cari_pekerjaan', 'progres_pelanggan', 'detail_pekerjaan', 'ringkasan_keuangan', 'daftar_invoice', 'info_akun'])
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object')
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.ok(tool.description.length > 40)
    assert.ok(!('run' in tool))
  }
  await ctx.rpc(token, { jsonrpc: '2.0', id: 5, method: 'ping' }, { expected: 400, headers: { 'mcp-protocol-version': '2030-01-01' } })
  // last_used_at stamped
  assert.ok(ctx.sql.prepare('SELECT last_used_at FROM mcp_tokens').get().last_used_at)
})

test('mcp: protocol errors — unknown method, bad JSON, invalid request, unknown tool, batch, GET/DELETE/OPTIONS', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const token = (await ctx.api('alice', 'POST', '/api/mcp-tokens', {}, 201)).data.token
  const unknown = (await ctx.rpc(token, { jsonrpc: '2.0', id: 9, method: 'resources/list' })).body
  assert.equal(unknown.error.code, -32601)
  assert.equal(unknown.id, 9)
  assert.equal((await ctx.rpc(token, '{nope', { expected: 400 })).body.error.code, -32700)
  assert.equal((await ctx.rpc(token, { id: 1, method: 'ping' })).body.error.code, -32600, 'jsonrpc 2.0 required')
  assert.equal((await ctx.rpc(token, [], { expected: 400 })).body.error.code, -32600)
  assert.equal((await ctx.rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'hapus_semua' } })).body.error.code, -32602)

  const batch = (await ctx.rpc(token, [
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'info_akun', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'nope' },
  ])).body
  assert.equal(batch.length, 3, 'no response for the notification')
  assert.deepEqual(batch.map((x) => x.id), [1, 2, 3])
  assert.match(batch[1].result.content[0].text, /CV Alice Teknik|alice/)
  assert.equal(batch[2].error.code, -32601)
  await ctx.rpc(token, [{ jsonrpc: '2.0', method: 'notifications/initialized' }], { expected: 202 })

  const get = await ctx.fetchW('/mcp', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(get.status, 405)
  assert.equal((await ctx.fetchW('/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status, 405)
  const pre = await ctx.fetchW('/mcp', { method: 'OPTIONS', headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://claude.ai')
  await ctx.rpc(token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { expected: 403, headers: { origin: 'https://evil.example' } })
  await ctx.rpc(token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { origin: HOST } })
  // Tool argument errors are tool results (isError), not protocol errors
  const bad = (await ctx.call(token, 'cari_pekerjaan', { posisi: 'kemana' })).result
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /posisi/)
  const missing = (await ctx.call(token, 'progres_pelanggan', {})).result
  assert.equal(missing.isError, true)
})

test('mcp: auth — no token, garbage, revoked, path token, suspended, demo, rate limit', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
  const none = await ctx.rpc(null, ping, { expected: 401 })
  assert.match(none.res.headers.get('www-authenticate'), /Bearer/)
  await ctx.rpc('sa_mcp_' + 'x'.repeat(43), ping, { expected: 401 })
  await ctx.rpc('not-a-token', ping, { expected: 401 })
  // a session token is not an MCP token
  await ctx.rpc(sessionOf('alice'), ping, { expected: 401 })

  const { token, item } = (await ctx.api('alice', 'POST', '/api/mcp-tokens', {}, 201)).data
  // token in the path (claude.ai custom connector URL)
  assert.deepEqual((await ctx.rpc(null, ping, { path: `/mcp/${token}` })).body.result, {})
  assert.equal((await ctx.rpc(null, ping, { path: `/mcp/${token}/` })).body.result !== undefined, true, 'trailing slash')
  await ctx.rpc(null, ping, { path: `/mcp/${token}/extra`, expected: 404 })
  await ctx.rpc(null, ping, { path: '/mcp/sa_mcp_wrong', expected: 401 })

  await ctx.api('alice', 'DELETE', `/api/mcp-tokens/${item.id}`)
  const revoked = await ctx.rpc(token, ping, { expected: 401 })
  assert.match(revoked.body.error.message, /dicabut/)
  await ctx.rpc(null, ping, { path: `/mcp/${token}`, expected: 401 })

  // suspended after the token was made
  const t2 = (await ctx.api('susp', 'POST', '/api/mcp-tokens', {}, 201)).data.token
  await ctx.rpc(t2, ping)
  ctx.sql.prepare("INSERT INTO user_flags(user_id, suspended, updated_at) VALUES ('susp', 1, '2026-01-01')").run()
  await ctx.rpc(t2, ping, { expected: 403 })

  // a demo-account token (e.g. inserted before the rule) is refused
  const demoToken = 'sa_mcp_' + 'D'.repeat(43)
  ctx.sql.prepare("INSERT INTO mcp_tokens(owner_id, token_hash, prefix) VALUES ('demo', ?, 'sa_mcp_DDDD')").run(sha(demoToken))
  await ctx.rpc(demoToken, ping, { expected: 403 })

  // rate limit per token (60 / minute)
  const t3 = (await ctx.api('bob', 'POST', '/api/mcp-tokens', {}, 201)).data.token
  const { _resetLimits, LIMITS } = await import('../worker/mcp-server.js')
  _resetLimits()
  for (let i = 0; i < LIMITS.perMinute; i++) await ctx.rpc(t3, ping)
  const limited = await ctx.rpc(t3, ping, { expected: 429 })
  assert.ok(limited.res.headers.get('retry-after'))
  _resetLimits()
})

test('mcp tools: each tool answers from the token account only', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const alice = (await ctx.api('alice', 'POST', '/api/mcp-tokens', {}, 201)).data.token
  const bob = (await ctx.api('bob', 'POST', '/api/mcp-tokens', {}, 201)).data.token
  const res = async (token, name, args) => {
    const r = (await ctx.call(token, name, args)).result
    assert.equal(r.isError, false, r.content?.[0]?.text)
    assert.equal(r.content[0].type, 'text')
    return r
  }

  // cari_pekerjaan
  const all = await res(alice, 'cari_pekerjaan', {})
  assert.equal(all.structuredContent.total_cocok, 3)
  assert.ok(!all.content[0].text.includes('Rahasia'), 'never bob\'s data')
  assert.deepEqual(all.structuredContent.jumlah_per_posisi, { request: 1, offer: 0, assign: 0, work: 1, book: 0, done: 1 })
  const work = await res(alice, 'cari_pekerjaan', { posisi: 'work' })
  assert.equal(work.structuredContent.pekerjaan.length, 1)
  assert.equal(work.structuredContent.pekerjaan[0].pelanggan, 'Toko Sinar')
  assert.equal(work.structuredContent.pekerjaan[0].petugas, 'Sari')
  assert.equal(work.structuredContent.pekerjaan[0].langkah_berikutnya, 'Tandai selesai')
  const q = await res(alice, 'cari_pekerjaan', { q: 'maju', limit: 1 })
  assert.equal(q.structuredContent.pekerjaan[0].id, ctx.ids.r1)
  assert.match(q.content[0].text, /Rp1\.500\.000/)
  assert.equal((await res(alice, 'cari_pekerjaan', { limit: 1000 })).structuredContent.ditampilkan, 3, 'limit clamped to 100')
  const bobAll = await res(bob, 'cari_pekerjaan', { q: 'maju' })
  assert.equal(bobAll.structuredContent.total_cocok, 1)
  assert.equal(bobAll.structuredContent.pekerjaan[0].pelanggan, 'PT Maju Rahasia')

  // progres_pelanggan (fuzzy: typo, no legal form)
  const prog = await res(alice, 'progres_pelanggan', { nama: 'maju jya' })
  assert.equal(prog.structuredContent.pelanggan.length, 1)
  const job = prog.structuredContent.pelanggan[0].pekerjaan[0]
  assert.equal(job.tahap, 'Pembukuan')
  assert.equal(job.harga_penawaran, 1500000)
  assert.equal(job.petugas, 'Budi')
  assert.ok(job.tanggal.permintaan && job.tanggal.selesai)
  assert.match(prog.content[0].text, /PT Maju Jaya/)
  assert.ok(!prog.content[0].text.includes('Rahasia'))
  const none = await res(alice, 'progres_pelanggan', { nama: 'Zeta Corp' })
  assert.equal(none.structuredContent.pelanggan.length, 0)
  assert.match(none.content[0].text, /Tidak ada pelanggan/)
  assert.equal((await res(alice, 'progres_pelanggan', { nama: 'rahasia' })).structuredContent.pelanggan.length, 0)

  // detail_pekerjaan
  const det = await res(alice, 'detail_pekerjaan', { id: ctx.ids.r1 })
  const d = det.structuredContent
  assert.equal(d.penawaran.harga, 1500000)
  assert.equal(d.penawaran.lingkup, 'Cuci 3 unit AC')
  assert.equal(d.penawaran.syarat, 'Garansi 30 hari')
  assert.equal(d.penugasan.petugas, 'Budi')
  assert.equal(d.penyelesaian.catatan, 'Semua unit dingin')
  assert.deepEqual([d.pembukuan.pendapatan, d.pembukuan.biaya, d.pembukuan.laba], [1500000, 400000, 1100000])
  assert.equal(d.invoice_detail.nomor, 'INV-2026-0001')
  assert.equal(d.invoice_detail.item[0].uraian, 'Cuci AC')
  assert.equal(d.linimasa.length, 5)
  assert.ok(d.linimasa.every((s) => s.keadaan === 'done'))
  assert.match(det.content[0].text, /Linimasa/)
  const notMine = (await ctx.call(alice, 'detail_pekerjaan', { id: ctx.ids.rb })).result
  assert.equal(notMine.isError, true, 'bob\'s job is not found with alice\'s token')
  assert.equal((await res(alice, 'detail_pekerjaan', { id: String(ctx.ids.r3) })).structuredContent.tahap, 'Penawaran')

  // ringkasan_keuangan
  const fin = await res(alice, 'ringkasan_keuangan', {})
  assert.deepEqual([fin.structuredContent.pendapatan, fin.structuredContent.biaya, fin.structuredContent.laba], [1500000, 400000, 1100000])
  assert.equal(fin.structuredContent.invoice_belum_lunas.total, 1500000, 'bob\'s 9.000.000 never counted')
  assert.equal(fin.structuredContent.invoice_belum_lunas.lewat_jatuh_tempo, 1)
  assert.match(fin.content[0].text, /laba Rp1\.100\.000/)
  assert.equal((await res(alice, 'ringkasan_keuangan', { periode: 'bulan_lalu' })).structuredContent.pendapatan, 0)
  assert.equal((await res(alice, 'ringkasan_keuangan', { periode: 'semua' })).structuredContent.laba, 1100000)

  // daftar_invoice
  const invs = await res(alice, 'daftar_invoice', { status: 'terkirim' })
  assert.equal(invs.structuredContent.invoice.length, 1)
  assert.equal(invs.structuredContent.invoice[0].lewat_jatuh_tempo, true)
  assert.match(invs.content[0].text, /INV-2026-0001 — PT Maju Jaya: Rp1\.500\.000/)
  assert.equal((await res(alice, 'daftar_invoice', { status: 'lunas' })).structuredContent.invoice.length, 0)
  assert.equal((await res(bob, 'daftar_invoice', {})).structuredContent.invoice[0].pelanggan, 'PT Maju Rahasia')

  // info_akun
  const info = await res(alice, 'info_akun', {})
  assert.equal(info.structuredContent.nama_usaha, 'CV Alice Teknik')
  assert.equal(info.structuredContent.skala_akun, 'UKM')
  assert.equal(info.structuredContent.jumlah.pekerjaan, 3)
  assert.equal(info.structuredContent.jumlah.petugas_aktif, 1)
  assert.equal((await res(bob, 'info_akun', {})).structuredContent.jumlah.pekerjaan, 1)
})

test('mcp: period filter uses the WIB calendar', async () => {
  const { periodFilter, fmtDate } = await import('../worker/mcp-server.js')
  const now = Date.parse('2026-01-31T18:00:00Z') // 1 Feb 01:00 WIB
  assert.equal(fmtDate('2026-01-31T18:00:00Z'), '2026-02-01')
  assert.ok(periodFilter('bulan_ini', now).test('2026-01-31T17:30:00Z'))
  assert.ok(!periodFilter('bulan_ini', now).test('2026-01-31T16:30:00Z'))
  assert.ok(periodFilter('bulan_lalu', now).test('2026-01-10T00:00:00Z'))
  assert.ok(periodFilter('bulan_lalu', Date.parse('2026-01-10T00:00:00Z')).test('2025-12-10T00:00:00Z'))
  assert.ok(periodFilter('tahun_ini', now).test('2026-06-01T00:00:00Z'))
  assert.ok(periodFilter('semua', now).test('2001-01-01T00:00:00Z'))
})

test('akses AI UI: connection snippets and the ?bagian= deep link', async () => {
  const S = await import('../src/ai-access/snippets.js')
  const tok = 'sa_mcp_' + 'a'.repeat(43)
  assert.equal(S.connectorUrl('https://app.id/', tok), `https://app.id/mcp/${tok}`)
  assert.equal(S.claudeCodeCommand('https://app.id', tok), `claude mcp add --transport http satu-alur https://app.id/mcp --header "Authorization: Bearer ${tok}"`)
  assert.deepEqual(JSON.parse(S.desktopConfig('https://app.id', tok)), { mcpServers: { 'satu-alur': { command: 'npx', args: ['-y', 'mcp-remote', `https://app.id/mcp/${tok}`] } } })
  const { tabFromHash } = await import('../src/stages/settings.js')
  assert.equal(tabFromHash('#/app/pengaturan?bagian=mcp'), 'ai-access')
  assert.equal(tabFromHash('#/app/pengaturan?bagian=konektor'), 'mcp')
  assert.equal(tabFromHash('#/app/pengaturan'), null)
  assert.equal(tabFromHash('#/app/pengaturan?bagian=x'), null)
  const { parseAppRoute } = await import('../src/ui/routes.js')
  assert.equal(parseAppRoute('#/app/pengaturan?bagian=mcp').settings, true)
})

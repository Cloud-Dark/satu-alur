// Unit tests: src/http-cloud.js — parseSSE stream parser and the /api client
// (request shape, error mapping, token handling) with a stubbed fetch. FR-001..FR-003, FR-032.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { captureEvents } from './helpers/setup.mjs'

const { parseSSE, createHttpCloud } = await import('../src/http-cloud.js')

const enc = new TextEncoder()
function streamOf(parts) {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p))
      c.close()
    },
  })
}
async function collect(parts) {
  const out = []
  for await (const chunk of parseSSE(streamOf(parts))) out.push(chunk)
  return out
}
const delta = (t) => JSON.stringify({ choices: [{ delta: { content: t } }] })

/* -------------------------------------------------------------- parseSSE */

test('parseSSE: yields JSON chunks and stops at [DONE]', async () => {
  const out = await collect([`data: ${delta('Ha')}\n\n`, `data: ${delta('lo')}\n\n`, 'data: [DONE]\n\n', `data: ${delta('X')}\n\n`])
  assert.deepEqual(out.map((c) => c.choices[0].delta.content), ['Ha', 'lo'])
})

test('parseSSE: lines split across network chunks and CRLF', async () => {
  const line = `data: ${delta('utuh')}\r\n\r\n`
  const out = await collect([line.slice(0, 7), line.slice(7, 20), line.slice(20)])
  assert.equal(out.length, 1)
  assert.equal(out[0].choices[0].delta.content, 'utuh')
})

test('parseSSE: multi-byte UTF-8 split across chunks', async () => {
  const bytes = enc.encode(`data: ${delta('Rp — é')}\n\n`)
  const cut = bytes.indexOf(0xe2) + 1 // inside the em dash
  const s = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, cut)); c.enqueue(bytes.slice(cut)); c.close() } })
  const out = []
  for await (const ch of parseSSE(s)) out.push(ch)
  assert.equal(out[0].choices[0].delta.content, 'Rp — é')
})

test('parseSSE: ignores comments, blank and invalid lines; handles last line without newline', async () => {
  const out = await collect([': keep-alive\n', 'event: message\n', 'data: {bukan json}\n', 'data:\n', `data:${delta('a')}\n`, `data: ${delta('b')}`])
  assert.deepEqual(out.map((c) => c.choices[0].delta.content), ['a', 'b'])
})

test('parseSSE: error chunk throws with its message', async () => {
  await assert.rejects(collect([`data: ${delta('a')}\n`, 'data: {"error":{"message":"Layanan AI tidak tersedia"}}\n']), /Layanan AI tidak tersedia/)
  await assert.rejects(collect(['data: {"error":"kuota"}\n']), /kuota/)
})

/* ------------------------------------------------------- client + fetch stub */

let calls
let replies
const realFetch = globalThis.fetch
beforeEach(() => {
  calls = []
  replies = []
  localStorage.clear()
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const r = replies.shift() || { status: 200, json: { data: [] } }
    if (r.throw) throw r.throw
    return new Response(r.raw ?? JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
})
afterEach(() => { globalThis.fetch = realFetch })

test('database builder: one POST /api/db with the query shape', async () => {
  const cloud = createHttpCloud()
  replies.push({ status: 200, json: { data: [{ id: 1 }], count: 1 } })
  const res = await cloud.database.from('requests').select('*', { count: 'exact' }).eq('status', 'draft').gt('id', 5).in('id', [6, 7]).order('id', { ascending: false }).limit(10)
  assert.deepEqual(res, { data: [{ id: 1 }], count: 1, error: null })
  assert.equal(calls[0].url, '/api/db')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(calls[0].body, {
    table: 'requests', action: 'select', columns: '*', count: 'exact',
    filters: [{ op: 'eq', col: 'status', val: 'draft' }, { op: 'gt', col: 'id', val: 5 }, { op: 'in', col: 'id', val: [6, 7] }],
    order: { col: 'id', asc: false }, limit: 10,
  })
})

test('database builder: insert/update/delete + match; writes emit satualur:db-write', async () => {
  const cloud = createHttpCloud()
  const cap = captureEvents('satualur:db-write')
  replies.push({ status: 200, json: { data: [{ id: 9 }] } }, { status: 200, json: { data: [] } }, { status: 400, json: { error: { message: 'Kolom tidak dikenal: x' } } })
  await cloud.database.from('offers').insert({ request_id: 1 }).select()
  await cloud.database.from('offers').update({ status: 'approved' }).match({ id: 9, request_id: 1 })
  const bad = await cloud.database.from('offers').delete().eq('id', 9)
  await new Promise((r) => setTimeout(r, 0))
  cap.stop()
  assert.deepEqual(calls[0].body.values, [{ request_id: 1 }])
  assert.equal(calls[0].body.action, 'insert')
  assert.deepEqual(calls[1].body.filters, [{ op: 'eq', col: 'id', val: 9 }, { op: 'eq', col: 'request_id', val: 1 }])
  assert.equal(calls[2].body.action, 'delete')
  assert.deepEqual(bad, { data: null, error: { message: 'Kolom tidak dikenal: x', status: 400 } })
  assert.equal(cap.events.length, 2, 'failed write does not emit')
  assert.equal(cap.events[0].detail.table, 'offers')
})

test('database builder: .or() is rejected', () => {
  assert.throws(() => createHttpCloud().database.from('requests').or('a'), /tidak didukung/)
})

test('request(): never throws; maps network errors and non-JSON bodies', async () => {
  const cloud = createHttpCloud()
  replies.push({ throw: new TypeError('Failed to fetch') }, { status: 503, raw: 'Service Unavailable' }, { status: 503, json: { error: { message: 'Batas penulisan harian database tercapai.' } } })
  assert.deepEqual(await cloud.database.from('requests').select(), { data: null, error: { message: 'Failed to fetch' } })
  assert.deepEqual(await cloud.database.from('requests').select(), { data: null, error: { message: 'HTTP 503', status: 503 } })
  const q = await cloud.database.from('requests').select()
  assert.match(q.error.message, /Batas penulisan harian/)
})

test('auth: sendOtp validates email and exposes demoCode as mock-otp-sent', async () => {
  const cloud = createHttpCloud()
  await assert.rejects(cloud.auth.sendOtp({ email: 'bukan-email' }), /Email tidak valid/)
  const cap = captureEvents('mock-otp-sent')
  replies.push({ status: 200, json: { data: { verificationId: 'v1', isExistingUser: false, demoCode: '123456' } } })
  const r = await cloud.auth.sendOtp({ email: 'a@b.id' })
  cap.stop()
  assert.deepEqual(r, { data: { verificationId: 'v1', isExistingUser: false }, error: null })
  assert.deepEqual(cap.events[0].detail, { email: 'a@b.id', code: '123456' })
  assert.deepEqual(calls[0].body, { email: 'a@b.id' })
})

test('auth: verifyOtp stores the token, sends Bearer, signOut clears it', async () => {
  const cloud = createHttpCloud()
  const events = []
  cloud.auth.onAuthStateChange((e) => events.push(e))
  replies.push({ status: 200, json: { data: { user: { id: 'u1' }, access_token: 'tok123' } } })
  await cloud.auth.verifyOtp({ email: 'a@b.id', verificationId: 'v1', token: '123456' })
  assert.equal(localStorage.getItem('satualur_token'), 'tok123')
  replies.push({ status: 200, json: { data: [] } })
  await cloud.database.from('requests').select()
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok123')
  replies.push({ status: 200, json: { data: null } })
  await cloud.auth.signOut()
  assert.equal(calls[2].url, '/api/auth/signout')
  assert.equal(localStorage.getItem('satualur_token'), null)
  assert.deepEqual(events, ['SIGNED_IN', 'SIGNED_OUT'])
})

test('auth: wrong OTP throws the server message', async () => {
  const cloud = createHttpCloud()
  replies.push({ status: 400, json: { error: { message: 'Kode salah.' } } })
  await assert.rejects(cloud.auth.verifyOtp({ email: 'a@b.id', verificationId: 'v', token: '000000' }), /Kode salah/)
  assert.equal(localStorage.getItem('satualur_token'), null)
})

test('auth: a 403 "ditangguhkan" on any call signs out locally and leaves the notice for the login page', async () => {
  const cloud = createHttpCloud()
  const seen = []
  cloud.auth.onAuthStateChange((ev, s) => seen.push([ev, s]))
  sessionStorage.clear()
  localStorage.setItem('satualur_token', 'tok')
  replies.push({ status: 403, json: { error: { message: 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.' } } })
  const r = await cloud.database.from('requests').select('*')
  assert.equal(r.error.status, 403)
  assert.equal(localStorage.getItem('satualur_token'), null)
  assert.deepEqual(seen, [['SIGNED_OUT', null]])
  assert.equal(sessionStorage.getItem('satualur_auth_notice'), 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.')
  // any other 403 (e.g. not staff) keeps the session
  localStorage.setItem('satualur_token', 'tok')
  replies.push({ status: 403, json: { error: { message: 'Khusus tim Satu Alur.' } } })
  await cloud.database.from('requests').select('*')
  assert.equal(localStorage.getItem('satualur_token'), 'tok')
  assert.equal(seen.length, 1)
})

test('signOutIfSuspended: the shared helper the customers and social clients call on their errors', async () => {
  const { signOutIfSuspended } = await import('../src/http-cloud.js')
  const cloud = createHttpCloud()
  const seen = []
  cloud.auth.onAuthStateChange((ev) => seen.push(ev))
  sessionStorage.clear()
  localStorage.setItem('satualur_token', 'tok')
  signOutIfSuspended(403, 'Khusus tim Satu Alur.')
  signOutIfSuspended(401, 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.')
  assert.equal(localStorage.getItem('satualur_token'), 'tok')
  assert.deepEqual(seen, [])
  signOutIfSuspended(403, 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.')
  assert.equal(localStorage.getItem('satualur_token'), null)
  assert.deepEqual(seen, ['SIGNED_OUT'])
  assert.equal(sessionStorage.getItem('satualur_auth_notice'), 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.')
  signOutIfSuspended(403, 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.') // no token left: nothing more
  assert.deepEqual(seen, ['SIGNED_OUT'])
})

test('auth: getSession without token makes no request; 401 drops a stale token', async () => {
  const cloud = createHttpCloud()
  const none = await cloud.auth.getSession()
  assert.equal(none.data, null)
  assert.equal(calls.length, 0)
  localStorage.setItem('satualur_token', 'old')
  replies.push({ status: 401, json: { error: { message: 'Sesi berakhir.' } } })
  const r = await cloud.auth.getSession()
  assert.equal(r.error.status, 401)
  assert.equal(localStorage.getItem('satualur_token'), null)
})

test('auth: demoLogin posts the email and stores the token', async () => {
  const cloud = createHttpCloud()
  replies.push({ status: 200, json: { data: { user: { id: 'd' }, access_token: 'demo-tok' } } })
  await cloud.auth.demoLogin({ email: 'demo-ac@satualur.id' })
  assert.equal(calls[0].url, '/api/auth/demo-login')
  assert.equal(localStorage.getItem('satualur_token'), 'demo-tok')
  replies.push({ status: 403, json: { error: { message: 'Mode demo tidak aktif.' } } })
  await assert.rejects(cloud.auth.demoLogin({ email: 'demo-ac@satualur.id' }), /Mode demo tidak aktif/)
})

test('llm.chat: non-OK response throws the API message; OK streams SSE', async () => {
  const cloud = createHttpCloud()
  replies.push({ status: 502, json: { error: { message: 'Layanan AI tidak tersedia.' } } })
  const it = cloud.llm.chat.completions.create({ model: 'm', messages: [] })
  await assert.rejects(it.next(), /Layanan AI tidak tersedia/)
  replies.push({ status: 200, raw: `data: ${delta('ok')}\n\ndata: [DONE]\n\n` })
  const out = []
  for await (const c of cloud.llm.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })) out.push(c)
  assert.equal(out[0].choices[0].delta.content, 'ok')
  assert.deepEqual(calls[1].body, { model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
})

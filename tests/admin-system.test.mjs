// Admin & system: email building blocks, SMTP/Resend clients, AI provider streams,
// Google claim checks, admin rules, and the real Worker routes on SQLite.
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const { encodeHeaderWord, dotStuff, buildMessage, parseReplies, b64, parseAddress } = await import('../src/email/mime.js')
const { sendSmtp, SmtpError, secureForPort } = await import('../src/email/smtp.js')
const { sendResend, EmailError, RESEND_URL } = await import('../src/email/resend.js')
const { otpEmail, offerEmailDraft } = await import('../src/email/templates.js')
const { encryptToken, decryptToken } = await import('../src/social/crypto.js')
const { anthropicRequest, openAiRequest, anthropicToAppStream, openAiToAppStream, providerErrorMessage } = await import('../src/ai-providers/providers.js')
const { validateIdTokenClaims, googleRedirectUri, googleAuthUrl, pkceChallenge, decodeJwtPayload } = await import('../src/auth/google.js')
const { isEmailAdmin, normalizeSetting, withDefaults, validateEmailIntegration, validateAiIntegration, cleanBaseUrl } = await import('../src/admin/rules.js')
const { isAdminUser } = await import('../worker/social.js')

// ------------------------------------------------------------------- MIME

test('mime: RFC 2047 only for non-ASCII headers, address formatting', () => {
  assert.equal(encodeHeaderWord('Kode masuk 123'), 'Kode masuk 123')
  assert.equal(encodeHeaderWord('Penawaran — AC'), `=?UTF-8?B?${b64('Penawaran — AC')}?=`)
  assert.equal(encodeHeaderWord('a\r\nBcc: x@y.z'), 'a Bcc: x@y.z') // no header injection
  assert.deepEqual(parseAddress('Satu Alur <noreply@apipedia.id>'), { name: 'Satu Alur', email: 'noreply@apipedia.id' })
  assert.deepEqual(parseAddress('x@y.id'), { name: null, email: 'x@y.id' })
})

test('mime: dot-stuffing and CRLF normalisation', () => {
  assert.equal(dotStuff('a\n.b\n..c\n.'), 'a\r\n..b\r\n...c\r\n..')
})

test('mime: multipart message with base64 parts wrapped at 76 columns', () => {
  const msg = buildMessage({
    from: 'a@b.id', fromName: 'Toko Ü', to: 'c@d.id', subject: 'Halo', text: 'x'.repeat(200), html: '<p>hi</p>',
    date: new Date(Date.UTC(2026, 10, 3)), boundary: 'BB', messageId: 'id@b.id',
  })
  assert.match(msg, /^From: =\?UTF-8\?B\?.+\?= <a@b\.id>\r\n/)
  assert.match(msg, /Content-Type: multipart\/alternative; boundary="BB"/)
  assert.match(msg, /Date: Tue, 03 Nov 2026 00:00:00 \+0000/)
  assert.ok(msg.split('\r\n').every((l) => l.length <= 998))
  assert.ok(msg.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).every((l) => l.length <= 76))
  assert.ok(msg.endsWith('--BB--\r\n'))
})

test('mime: SMTP reply parser handles multi-line and partial replies', () => {
  const a = parseReplies('250-mx.example\r\n250-AUTH PLAIN LOGIN\r\n250 STARTTLS\r\n220 ready\r\n250-part')
  assert.equal(a.replies.length, 2)
  assert.deepEqual(a.replies[0], { code: 250, lines: ['mx.example', 'AUTH PLAIN LOGIN', 'STARTTLS'] })
  assert.equal(a.rest, '250-part')
  const b = parseReplies(`${a.rest}\r\n250 done\r\n`)
  assert.deepEqual(b.replies[0], { code: 250, lines: ['part', 'done'] })
})

// ------------------------------------------------------------------- SMTP

function fakeSmtp(script) {
  const sent = []
  const enc = new TextEncoder()
  let pending = []
  let wake = null
  const push = (text) => { pending.push(enc.encode(text)); wake?.(); wake = null }
  const socket = {
    readable: { getReader: () => ({
      read: async () => {
        while (!pending.length) await new Promise((r) => { wake = r })
        return { value: pending.shift(), done: false }
      },
      releaseLock() {},
    }) },
    writable: { getWriter: () => ({
      write: async (bytes) => {
        const line = new TextDecoder().decode(bytes)
        sent.push(line)
        const reply = script(line)
        if (reply) push(reply)
      },
      releaseLock() {},
    }) },
    startTls() { sent.push('<TLS>'); return socket },
    close: async () => {},
  }
  const connect = (addr, opts) => { sent.push(`CONNECT ${addr.hostname}:${addr.port} ${opts.secureTransport}`); setTimeout(() => push('220 mx ready\r\n')); return socket }
  return { connect, sent }
}

test('smtp: implicit TLS, AUTH PLAIN, dot-stuffed DATA, QUIT', async () => {
  const { connect, sent } = fakeSmtp((line) => {
    if (line.startsWith('EHLO')) return '250-mx\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000\r\n'
    if (line.startsWith('AUTH PLAIN')) return '235 ok\r\n'
    if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) return '250 ok\r\n'
    if (line === 'DATA\r\n') return '354 go\r\n'
    if (line.endsWith('\r\n.\r\n')) return '250 queued as X\r\n'
    return null
  })
  const r = await sendSmtp({ host: 'smtp.example.com', port: 465, user: 'u', pass: 'p', from: 'a@b.id', to: 'c@d.id', subject: 'S', text: '.dot line' }, { connect })
  assert.equal(r.accepted, true)
  assert.equal(sent[0], 'CONNECT smtp.example.com:465 on')
  assert.ok(sent.includes(`AUTH PLAIN ${b64('\u0000u\u0000p')}\r\n`))
  assert.ok(sent.some((l) => l.includes('Subject: S') && l.endsWith('\r\n.\r\n')))
  assert.equal(sent.at(-1), 'QUIT\r\n')
})

test('smtp: STARTTLS upgrade then AUTH LOGIN; rejected login gives a friendly error', async () => {
  const { connect, sent } = fakeSmtp((line) => {
    if (line.startsWith('EHLO')) return '250-mx\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n'
    if (line === 'STARTTLS\r\n') return '220 go ahead\r\n'
    if (line === 'AUTH LOGIN\r\n') return '334 VXNlcm5hbWU6\r\n'
    if (line === `${b64('u')}\r\n`) return '334 UGFzc3dvcmQ6\r\n'
    return '535 5.7.8 bad credentials\r\n'
  })
  await assert.rejects(
    sendSmtp({ host: 'smtp.example.com', port: 587, user: 'u', pass: 'wrong', from: 'a@b.id', to: 'c@d.id', subject: 'S', text: 't' }, { connect }),
    (e) => e instanceof SmtpError && /Login SMTP ditolak/.test(e.message) && e.code === 535,
  )
  assert.equal(sent[0], 'CONNECT smtp.example.com:587 starttls')
  assert.ok(sent.includes('<TLS>'))
  assert.equal(secureForPort(2465), 'tls')
  assert.equal(secureForPort(2587), 'starttls')
})

// ----------------------------------------------------------------- Resend

test('resend: posts the message with a Bearer key and maps errors', async () => {
  const calls = []
  const ok = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }) }
  const r = await sendResend({ apiKey: 'k', from: 'A <a@b.id>', to: 'c@d.id', subject: 'S', html: '<p>h</p>', text: 't' }, ok)
  assert.equal(r.id, 'em_1')
  assert.equal(calls[0].url, RESEND_URL)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k')
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ['c@d.id'])
  const fail = (status, body) => async () => new Response(JSON.stringify(body), { status })
  await assert.rejects(sendResend({ apiKey: 'k', from: 'a@b.id', to: 'x', subject: 's', text: 't' }, fail(422, { message: 'Invalid `to`' })), (e) => e instanceof EmailError && e.status === 400)
  await assert.rejects(sendResend({ apiKey: 'k', from: 'a@b.id', to: 'x@y.id', subject: 's', text: 't' }, fail(401, {})), (e) => e.status === 502)
  await assert.rejects(sendResend({ apiKey: '', from: 'a@b.id', to: 'x@y.id', subject: 's', text: 't' }), (e) => e.status === 503)
})

test('templates: OTP email carries the code in both parts and escapes HTML', () => {
  const m = otpEmail({ code: '123456' })
  assert.match(m.subject, /123456/)
  assert.match(m.text, /123456/)
  assert.match(m.html, /1 2 3 4 5 6/)
  const d = offerEmailDraft({ customer: 'Budi <b>', service: 'Servis AC', price: 450000, scope: 'Cuci AC', businessName: 'CV Sejuk' })
  assert.match(d.body, /Rp450\.000/)
  assert.match(d.subject, /Servis AC/)
})

// ----------------------------------------------------------------- crypto

test('crypto: AES-GCM round trip with a 32-byte key; wrong key fails', async () => {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  const blob = await encryptToken('rahasia-smtp', key)
  assert.notEqual(blob, 'rahasia-smtp')
  assert.equal(await decryptToken(blob, key), 'rahasia-smtp')
  await assert.rejects(decryptToken(blob, other))
})

// ------------------------------------------------------------ AI providers

async function collect(stream) {
  const reader = stream.getReader()
  let out = ''
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += new TextDecoder().decode(value) }
  return out
}
const sseSource = (text) => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() } })

test('ai: Anthropic SSE becomes the app stream (text deltas, stop, error)', async () => {
  const src = [
    'event: message_start', 'data: {"type":"message_start"}', '',
    'event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hal"}}', '',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"o"}}', '',
    'data: {"type":"message_stop"}', '',
  ].join('\n')
  const out = await collect(sseSource(src).pipeThrough(anthropicToAppStream()))
  const chunks = out.split('\n\n').filter(Boolean).map((l) => l.slice(6))
  assert.deepEqual(chunks.slice(0, 2).map((c) => JSON.parse(c).choices[0].delta.content), ['Hal', 'o'])
  assert.equal(JSON.parse(chunks[2]).choices[0].finish_reason, 'stop')
  assert.equal(chunks[3], '[DONE]')
  assert.equal(chunks.length, 4)
  const err = await collect(sseSource('data: {"type":"error","error":{"message":"overloaded"}}\n').pipeThrough(anthropicToAppStream()))
  assert.match(err, /"error":\{"message":"overloaded"\}/)
})

test('ai: OpenAI-compatible SSE passes content through', async () => {
  const src = 'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata: [DONE]\n\n'
  const out = await collect(sseSource(src).pipeThrough(openAiToAppStream()))
  assert.equal((out.match(/"content":"[AB]"/g) || []).length, 2)
  assert.equal((out.match(/\[DONE\]/g) || []).length, 1)
})

test('ai: request builders (system merge, JSON instruction, headers)', () => {
  const a = anthropicRequest({
    baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-x', json: true, schema: { type: 'object' },
    messages: [{ role: 'system', content: 'Anda agen.' }, { role: 'assistant', content: 'hai' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
  })
  const body = JSON.parse(a.init.body)
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(a.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(a.init.headers['x-api-key'], 'k')
  assert.match(body.system, /Anda agen\.[\s\S]*JSON schema/)
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(body.messages[2].content, 'a\n\nb')
  const o = openAiRequest({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt', messages: [{ role: 'user', content: 'x' }] })
  assert.equal(o.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(o.init.headers.Authorization, 'Bearer k')
  assert.match(providerErrorMessage(401), /API key AI ditolak/)
})

// ------------------------------------------------------------------ Google

test('google: id_token claims, redirect URI and PKCE URL', async () => {
  const now = Date.UTC(2026, 10, 3)
  const ok = { iss: 'https://accounts.google.com', aud: 'cid', exp: now / 1000 + 300, iat: now / 1000, email: 'Budi@Gmail.com', email_verified: true, name: 'Budi', sub: '1' }
  assert.deepEqual(validateIdTokenClaims(ok, { clientId: 'cid', now }), { email: 'budi@gmail.com', name: 'Budi', sub: '1' })
  assert.throws(() => validateIdTokenClaims({ ...ok, aud: 'other' }, { clientId: 'cid', now }), /bukan untuk aplikasi ini/)
  assert.throws(() => validateIdTokenClaims({ ...ok, iss: 'https://evil' }, { clientId: 'cid', now }), /Penerbit/)
  assert.throws(() => validateIdTokenClaims({ ...ok, exp: now / 1000 - 1 }, { clientId: 'cid', now }), /kedaluwarsa/)
  assert.throws(() => validateIdTokenClaims({ ...ok, email_verified: false }, { clientId: 'cid', now }), /belum terverifikasi/)
  assert.equal(googleRedirectUri({}, 'https://satu-alur.apipedia.workers.dev/api/auth/google/start'), 'https://satu-alur.apipedia.workers.dev/api/auth/google/callback')
  assert.equal(googleRedirectUri({ PUBLIC_BASE_URL: 'https://satualur.id/' }, 'https://x.dev/a'), 'https://satualur.id/api/auth/google/callback')
  const url = new URL(googleAuthUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 's', challenge: await pkceChallenge('v') }))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('scope'), 'openid email profile')
  const jwt = `x.${Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')}.y`
  assert.deepEqual(decodeJwtPayload(jwt), { a: 1 })
})

// ------------------------------------------------------------------ rules

test('admin rules: email admins only while OTP really goes to the inbox', () => {
  const env = { ADMIN_EMAILS: 'Apipedia22@gmail.com, boss@x.id', DEMO_OTP: 'false' }
  assert.equal(isEmailAdmin('apipedia22@gmail.com', env), true)
  assert.equal(isEmailAdmin('someone@x.id', env), false)
  assert.equal(isEmailAdmin('apipedia22@gmail.com', { ...env, DEMO_OTP: 'true' }), false)
  assert.equal(isEmailAdmin('boss@x.id', env, new Set(['boss@x.id'])), false)
  assert.equal(isAdminUser({ email: 'a@b.c', admin_email: 1 }), true)
  assert.equal(isAdminUser({ email: 'a@b.c', admin_email: 0 }), false)
  assert.equal(isAdminUser({ email: 's@staff.satualur.internal', is_staff: 1 }), true)
})

test('admin rules: settings and integration validation', () => {
  assert.deepEqual(withDefaults({}).email.allow_custom_smtp, true)
  assert.equal(normalizeSetting('email', { offer_daily_cap: 9999 }).offer_daily_cap, 200)
  assert.throws(() => normalizeSetting('nope', {}), /tidak dikenal/)
  assert.deepEqual(validateEmailIntegration({ email_mode: 'platform' }), { email_mode: 'platform' })
  const smtp = validateEmailIntegration({ email_mode: 'smtp', smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_user: 'me', smtp_from_email: 'me@x.id', smtp_pass: 'p' })
  assert.equal(smtp.smtp_secure, 'starttls')
  assert.throws(() => validateEmailIntegration({ email_mode: 'smtp', smtp_host: 'localhost', smtp_port: 465, smtp_user: 'u', smtp_from_email: 'a@b.id' }), /Host SMTP/)
  assert.throws(() => validateEmailIntegration({ email_mode: 'smtp', smtp_host: 'smtp.x.id', smtp_port: 25, smtp_user: 'u', smtp_from_email: 'a@b.id' }), /Port SMTP/)
  assert.equal(cleanBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
  assert.throws(() => cleanBaseUrl('http://api.x.id'), /https/)
  assert.throws(() => cleanBaseUrl('https://10.0.0.1'), /domain publik/)
  assert.equal(validateAiIntegration({ ai_mode: 'anthropic', ai_model: 'claude-x', ai_key: 'k' }).ai_base_url, 'https://api.anthropic.com')
  assert.throws(() => validateAiIntegration({ ai_mode: 'openai', ai_base_url: 'https://x.id', ai_model: '' }), /model/)
})

// ------------------------------------------------------- Worker on SQLite

async function sqliteEnv(t, extra = {}) {
  const { DatabaseSync } = await import('node:sqlite').catch(() => ({}))
  if (!DatabaseSync) { t.skip('SQLite integration requires Node 22.13+'); return null }
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(await readFile(new URL(name, dir), 'utf8'))
  const reads = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)
  const prepare = (sql) => ({
    args: [],
    bind(...args) { this.args = args; return this },
    async first() { return sqlite.prepare(sql).get(...this.args) ?? null },
    async all() { return { results: sqlite.prepare(sql).all(...this.args) } },
    async run() {
      if (reads(sql)) return { results: sqlite.prepare(sql).all(...this.args), meta: {} }
      const r = sqlite.prepare(sql).run(...this.args)
      return { results: [], meta: { changes: Number(r.changes) } }
    },
  })
  const env = {
    DB: {
      prepare,
      async batch(stmts) {
        sqlite.exec('BEGIN')
        try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec('COMMIT'); return out } catch (err) { sqlite.exec('ROLLBACK'); throw err }
      },
    },
    DEMO_OTP: 'false', RESEND_API_KEY: 're_test', ADMIN_EMAILS: 'alice@example.com',
    TOKEN_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString('base64'),
    AI: { run: async () => { throw new Error('built-in AI must not run in this test') } },
    ...extra,
  }
  for (const uid of ['alice', 'bob']) {
    sqlite.prepare('INSERT INTO users(id, email, name, created_at) VALUES (?, ?, ?, ?)').run(uid, `${uid}@example.com`, uid, '2026-11-01T00:00:00Z')
    sqlite.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(createHash('sha256').update(uid.repeat(8)).digest('hex'), uid, '2099-01-01T00:00:00Z')
  }
  return { env, sqlite }
}

function caller(worker, env) {
  return async (uid, method, path, body, expected = 200) => {
    const res = await worker.fetch(new Request(`https://satu-alur.apipedia.workers.dev${path}`, {
      method, headers: { ...(uid ? { authorization: `Bearer ${uid.repeat(8)}` } : {}), 'content-type': 'application/json', 'X-Satualur-Feature': 'offer' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env)
    const text = await res.text()
    assert.equal(res.status, expected, text)
    try { return JSON.parse(text).data } catch { return text }
  }
}

function stubFetch(t, handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init) }
  t.after(() => { globalThis.fetch = original })
  return calls
}

test('worker: OTP is emailed (no code in the response) unless DEMO_OTP is on', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const calls = stubFetch(t, async () => new Response(JSON.stringify({ id: 'em' }), { status: 200 }))
  const call = caller(worker, ctx.env)
  const data = await call(null, 'POST', '/api/auth/send-otp', { email: 'new@x.id' })
  assert.equal(data.demoCode, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.resend.com/emails')
  const sent = JSON.parse(calls[0].init.body)
  assert.deepEqual(sent.to, ['new@x.id'])
  assert.match(sent.text, /\d{6}/)
  assert.equal(ctx.sqlite.prepare("SELECT status FROM email_log WHERE kind = 'otp'").get().status, 'sent')

  const demo = await caller(worker, { ...ctx.env, DEMO_OTP: 'true' })(null, 'POST', '/api/auth/send-otp', { email: 'demo@x.id' })
  assert.match(demo.demoCode, /^\d{6}$/)
  assert.equal(calls.length, 1) // no email in demo mode
})

test('worker: ADMIN_EMAILS user opens Kantor, normal user does not; settings round-trip', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  const session = await call('alice', 'GET', '/api/auth/session')
  assert.equal(session.is_admin, true)
  assert.equal(session.admin_via, 'email')
  assert.equal(session.user.admin_email, undefined)
  assert.equal((await call('bob', 'GET', '/api/auth/session')).is_admin, false)
  await call('bob', 'GET', '/api/office/admin/system', undefined, 403)
  const sys = await call('alice', 'GET', '/api/office/admin/system')
  assert.equal(sys.status.email.resend, true)
  assert.equal(sys.status.login.google_redirect_uri, 'https://satu-alur.apipedia.workers.dev/api/auth/google/callback')
  await call('alice', 'PUT', '/api/office/admin/system/email', { value: { allow_custom_smtp: false } })
  assert.equal((await call('bob', 'GET', '/api/integrations')).options.custom_smtp_allowed, false)
  await call('bob', 'PUT', '/api/integrations/email', { email_mode: 'smtp', smtp_host: 'smtp.x.id', smtp_port: 465, smtp_user: 'u', smtp_from_email: 'b@x.id', smtp_pass: 'p' }, 403)
  // DEMO_OTP on: anyone could claim the address, so no email admin.
  await caller(worker, { ...ctx.env, DEMO_OTP: 'true' })('alice', 'GET', '/api/office/admin/system', undefined, 403)
  const users = await call('alice', 'GET', '/api/office/admin/users?q=&page=1')
  assert.ok(users.items.every((u) => 'tier' in u && 'credit_idr' in u))
  await call('alice', 'PUT', '/api/office/admin/users/bob/tier', { plan: 'enterprise' })
  assert.equal((await call('alice', 'GET', '/api/office/admin/users/bob/detail')).tier, 'enterprise')
  const summary = await call('alice', 'GET', '/api/office/admin/summary')
  assert.equal(summary.users, 2)
})

test('worker: own AI provider is encrypted, used for chat, and skips the Satu Alur quota', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  await call('bob', 'PUT', '/api/integrations/ai', { ai_mode: 'openai', ai_base_url: 'https://api.example-ai.com/v1', ai_model: 'gpt-x', ai_key: 'sk-secret-123' })
  const row = ctx.sqlite.prepare('SELECT ai_key_enc FROM business_integrations WHERE owner_id = ?').get('bob')
  assert.ok(row.ai_key_enc && !row.ai_key_enc.includes('sk-secret-123'))
  const view = await call('bob', 'GET', '/api/integrations')
  assert.equal(view.ai.has_key, true)
  assert.equal(JSON.stringify(view).includes('sk-secret'), false)
  const models = await call('bob', 'GET', '/api/llm/models')
  assert.equal(models[0].id, 'gpt-x')
  const calls = stubFetch(t, async () => new Response('data: {"choices":[{"delta":{"content":"Halo"}}]}\n\ndata: [DONE]\n\n', { status: 200 }))
  const out = await call('bob', 'POST', '/api/llm/chat', { model: 'gpt-x', messages: [{ role: 'user', content: 'hai' }] })
  assert.match(out, /Halo/)
  assert.equal(calls[0].url, 'https://api.example-ai.com/v1/chat/completions')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-secret-123')
  const usage = ctx.sqlite.prepare('SELECT feature, count FROM usage_counters WHERE user_id = ?').all('bob')
  assert.deepEqual(usage.map((u) => [u.feature, u.count]), [['byo_offer', 1]])
  // Without TOKEN_KEY the custom provider is off and the built-in engine is used again.
  const noKey = await caller(worker, { ...ctx.env, TOKEN_KEY: '' })('bob', 'GET', '/api/llm/models')
  assert.match(noKey[0].id, /^@cf\//)
})

test('worker: Google hand-off code is single use and creates a session', async (t) => {
  const ctx = await sqliteEnv(t, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' })
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  assert.deepEqual(await call(null, 'GET', '/api/auth/providers'), { google: true, google_client_id: 'cid', otp_email: true, demo_login: true })
  const code = 'abcdefghijklmnopqrstuvwxyz0123456789'
  ctx.sqlite.prepare("INSERT INTO oauth_logins (id, kind, value, expires_at) VALUES (?, 'handoff', 'bob', '2099-01-01T00:00:00Z')")
    .run(createHash('sha256').update(code).digest('hex'))
  const res = await call(null, 'POST', '/api/auth/google/exchange', { code })
  assert.equal(res.user.email, 'bob@example.com')
  assert.match(res.access_token, /^[0-9a-f]{64}$/)
  assert.ok(ctx.sqlite.prepare('SELECT last_login_at FROM users WHERE id = ?').get('bob').last_login_at)
  await call(null, 'POST', '/api/auth/google/exchange', { code }, 400)
  const start = await worker.fetch(new Request('https://satu-alur.apipedia.workers.dev/api/auth/google/start'), ctx.env)
  assert.equal(start.status, 302)
  const loc = new URL(start.headers.get('location'))
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://satu-alur.apipedia.workers.dev/api/auth/google/callback')
  assert.match(start.headers.get('set-cookie'), /__Host-g_nonce=/)
})

// ------------------------------------------------------ demo vs live, admin access

test('isDemoUser: the nine shared demo accounts only, case-insensitive', async () => {
  const { isDemoUser, DEMO_EMAILS } = await import('../worker/demo.js')
  assert.equal(DEMO_EMAILS.size, 9)
  assert.equal(isDemoUser({ email: 'Demo-AC@SatuAlur.id' }), true)
  assert.equal(isDemoUser({ email: 'bob@example.com' }), false)
  assert.equal(isDemoUser(null), false)
})

function addUser(sqlite, uid, email) {
  sqlite.prepare('INSERT INTO users(id, email, name, created_at) VALUES (?, ?, ?, ?)').run(uid, email, uid, '2026-11-01T00:00:00Z')
  sqlite.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(createHash('sha256').update(uid.repeat(8)).digest('hex'), uid, '2099-01-01T00:00:00Z')
}

test('worker: demo accounts get simulated AI (no Workers AI, no provider, no quota); live accounts get the real engine', async (t) => {
  let aiCalls = 0
  const ctx = await sqliteEnv(t, {
    AI: { run: async () => { aiCalls++; return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":"Nyata"}\n\ndata: [DONE]\n\n')); c.close() } }) } },
  })
  if (!ctx) return
  addUser(ctx.sqlite, 'demo', 'demo-ac@satualur.id')
  const { default: worker } = await import('../worker/index.js')
  const fetchCalls = stubFetch(t, async () => { throw new Error('no network for demo') })
  const call = caller(worker, ctx.env)
  const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  const offer = await call('demo', 'POST', '/api/llm/chat', {
    model, messages: [{ role: 'system', content: 'Anda agen penawaran.' }, { role: 'user', content: 'Permintaan jasa: Servis AC, lokasi Bekasi' }],
    response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { scope: { type: 'string' }, price: { type: 'number' } } } },
  })
  const joined = (sse) => sse.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices?.[0]?.delta?.content || '').join('')
  const text = joined(offer)
  assert.ok(JSON.parse(text).price > 0, text.slice(0, 200))
  assert.match(offer, /data: \[DONE\]/)
  const advice = await call('demo', 'POST', '/api/llm/chat', { model, messages: [{ role: 'system', content: '[agent:keuangan] Data: Pendapatan bulan ini: Rp10.000.000' }, { role: 'user', content: 'Bagaimana naik 2%?' }] })
  assert.match(joined(advice), /Jawaban contoh/)
  assert.equal(aiCalls, 0)
  assert.equal(fetchCalls.length, 0)
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM usage_counters WHERE user_id = 'demo'").get().n, 0)
  // Demo can't change integrations and sees the read-only flag.
  assert.equal((await call('demo', 'GET', '/api/integrations')).options.demo, true)
  await call('demo', 'PUT', '/api/integrations/ai', { ai_mode: 'openai', ai_base_url: 'https://api.x.com/v1', ai_model: 'm', ai_key: 'k' }, 403)
  const mail = await call('demo', 'POST', '/api/email/send', { kind: 'offer', to: 'pelanggan@x.id', subject: 'S', body: 'B' })
  assert.equal(mail.simulated, true)

  // Live account: the built-in model really runs and the call is metered.
  const live = await call('bob', 'POST', '/api/llm/chat', { model, messages: [{ role: 'user', content: 'hai' }] })
  assert.match(live, /Nyata/)
  assert.equal(aiCalls, 1)
  assert.equal(ctx.sqlite.prepare("SELECT count FROM usage_counters WHERE user_id = 'bob' AND feature = 'offer'").get().count, 1)
})

test('worker: admin access list — add, use, remove, never the last, audited', async (t) => {
  const ctx = await sqliteEnv(t, { ADMIN_EMAILS: 'alice@example.com' })
  if (!ctx) return
  addUser(ctx.sqlite, 'carol', 'carol@example.com')
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  const list = await call('alice', 'GET', '/api/office/admin/system/admins')
  assert.deepEqual(list.admins.map((a) => a.email), ['apipedia22@gmail.com']) // seeded by the migration
  assert.deepEqual(list.bootstrap, ['alice@example.com'])
  await call('carol', 'GET', '/api/office/admin/system', undefined, 403)
  await call('alice', 'POST', '/api/office/admin/system/admins', { email: 'Carol@Example.com' })
  await call('alice', 'POST', '/api/office/admin/system/admins', { email: 'carol@example.com' }, 409)
  await call('alice', 'POST', '/api/office/admin/system/admins', { email: 'demo-ac@satualur.id' }, 400)
  assert.equal((await call('carol', 'GET', '/api/auth/session')).admin_via, 'email')
  await call('carol', 'GET', '/api/office/admin/system')
  // DEMO_OTP on: listed admins don't count either.
  await caller(worker, { ...ctx.env, DEMO_OTP: 'true' })('carol', 'GET', '/api/office/admin/system', undefined, 403)
  await call('carol', 'DELETE', '/api/office/admin/system/admins/apipedia22%40gmail.com')
  await call('alice', 'DELETE', '/api/office/admin/system/admins/carol%40example.com', undefined, 400) // last listed admin
  await call('carol', 'GET', '/api/office/admin/system') // still admin (listed)
  const actions = ctx.sqlite.prepare('SELECT action, target FROM admin_audit ORDER BY id').all().map((r) => `${r.action}:${r.target}`)
  assert.deepEqual(actions, ['admin.add:carol@example.com', 'admin.remove:apipedia22@gmail.com'])
})

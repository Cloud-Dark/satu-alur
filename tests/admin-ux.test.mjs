// Admin SMTP transport, office paging, profile menu rules and the map picker helpers.
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parsePage, pageOf, OFFICE_PAGE_SIZE } = await import('../src/office/paging.js')
const { validatePlatformTransport, publicTransport } = await import('../src/admin/rules.js')
const { encryptToken, decryptToken } = await import('../src/social/crypto.js')
const { cleanProfileName, profileMenuItems } = await import('../src/auth/profile-rules.js')
const { pickedFields, pickLocation } = await import('../src/leads/pick.js')
const { sendEmail, TRANSPORT_KEY } = await import('../worker/email.js')

const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

test('parsePage: defaults, clamping and the paged flag', () => {
  assert.deepEqual(parsePage(new URLSearchParams('')), { page: 1, limit: OFFICE_PAGE_SIZE, offset: 0, paged: false })
  assert.deepEqual(parsePage(new URLSearchParams('page=3')), { page: 3, limit: 20, offset: 40, paged: true })
  assert.equal(parsePage(new URLSearchParams('page=-4')).page, 1)
  assert.equal(parsePage(new URLSearchParams('page=2&size=1000')).limit, 100)
  assert.equal(parsePage(new URLSearchParams('page=2&size=1')).limit, 5)
})

test('pageOf: slices like the server and reports the total', () => {
  const rows = Array.from({ length: 47 }, (_, i) => i)
  assert.deepEqual(pageOf(rows, { page: 3 }), { items: rows.slice(40, 47), total: 47, page: 3, size: 20 })
  assert.equal(pageOf(rows, { page: 9 }).items.length, 0)
})

test('platform transport: resend needs nothing, smtp is validated', () => {
  assert.deepEqual(validatePlatformTransport({ mode: 'resend', host: 'x' }), { mode: 'resend' })
  const v = validatePlatformTransport({ mode: 'smtp', host: 'smtp.resend.com', port: 587, user: 'resend', pass: 'secret', from_email: 'noreply@apipedia.id', from_name: 'Satu <Alur>', reply_to: 'CS@apipedia.id' })
  assert.equal(v.secure, 'starttls')
  assert.equal(v.from_name, 'Satu Alur')
  assert.equal(v.reply_to, 'cs@apipedia.id')
  assert.throws(() => validatePlatformTransport({ mode: 'smtp', host: 'localhost', port: 465, user: 'a', from_email: 'a@b.co' }), /publik|tidak valid/)
  assert.throws(() => validatePlatformTransport({ mode: 'smtp', host: 'smtp.x.id', port: 25, user: 'a', from_email: 'a@b.co' }), /Port SMTP/)
  assert.throws(() => validatePlatformTransport({ mode: 'smtp', host: 'smtp.x.id', port: 465, user: 'a', from_email: 'a@b.co', reply_to: 'nope' }), /reply-to/)
})

test('publicTransport never exposes the encrypted password', () => {
  const shown = publicTransport({ mode: 'smtp', host: 'smtp.x.id', pass_enc: 'abc.def', pass_last4: 'cret' })
  assert.equal(shown.pass_enc, undefined)
  assert.equal(shown.pass_saved, true)
  assert.equal(shown.pass_last4, 'cret')
  assert.deepEqual(publicTransport(null), { mode: 'resend' })
})

test('SMTP password encryption round-trips with TOKEN_KEY', async () => {
  const blob = await encryptToken('rahasia-123', TEST_KEY)
  assert.notEqual(blob, 'rahasia-123')
  assert.equal(await decryptToken(blob, TEST_KEY), 'rahasia-123')
  await assert.rejects(decryptToken(blob, Buffer.alloc(32, 9).toString('base64')))
})

function fakeDb(rows) {
  const log = []
  const db = {
    log,
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...a) { args = a; return stmt },
        async first() {
          if (/FROM system_settings WHERE key = \?/.test(sql)) return rows.transport ? { value_json: JSON.stringify(rows.transport) } : null
          return null
        },
        async all() {
          if (/FROM system_settings/.test(sql)) return { results: [] }
          return { results: [] }
        },
        async run() { if (/INSERT INTO email_log/.test(sql)) log.push(args); return { meta: { changes: 1 } } },
      }
      return stmt
    },
  }
  return db
}

test('platform SMTP failure falls back to Resend and logs both attempts', async () => {
  const transport = { mode: 'smtp', host: 'smtp.example.id', port: 465, secure: 'tls', user: 'u', from_email: 'noreply@example.id', pass_enc: await encryptToken('pw', TEST_KEY), pass_last4: 'pw' }
  const db = fakeDb({ transport })
  const env = { DB: db, TOKEN_KEY: TEST_KEY, RESEND_API_KEY: 're_test', EMAIL_FROM: 'Satu Alur <noreply@apipedia.id>' }
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 'x' }), { status: 200 }) }
  try {
    class HttpError extends Error { constructor(s, m) { super(m); this.status = s } }
    // node has no cloudflare:sockets, so the SMTP attempt fails like an unreachable server would
    const r = await sendEmail(env, { HttpError }, { kind: 'otp', to: 'a@b.co', subject: 'Kode', html: '<p>1</p>', text: '1', useBusiness: false })
    assert.equal(r.provider, 'resend')
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /resend/)
    const providers = db.log.map((a) => `${a[4]}:${a[5]}`)
    assert.deepEqual(providers, ['platform_smtp:failed', 'resend:sent'])
  } finally { globalThis.fetch = realFetch }
})

test('forceResend skips the platform SMTP', async () => {
  const transport = { mode: 'smtp', host: 'smtp.example.id', port: 465, user: 'u', from_email: 'noreply@example.id', pass_enc: await encryptToken('pw', TEST_KEY) }
  const db = fakeDb({ transport })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 200 })
  try {
    const r = await sendEmail({ DB: db, TOKEN_KEY: TEST_KEY, RESEND_API_KEY: 're_test' }, { HttpError: Error }, { kind: 'admin_test', to: 'a@b.co', subject: 's', html: 'h', text: 't', useBusiness: false, forceResend: true })
    assert.equal(r.provider, 'resend')
    assert.deepEqual(db.log.map((a) => a[4]), ['resend'])
  } finally { globalThis.fetch = realFetch }
  assert.equal(TRANSPORT_KEY, 'email_transport')
})

test('cleanProfileName: trims and validates', () => {
  assert.equal(cleanProfileName('  Budi   Santoso <b> '), 'Budi Santoso b')
  assert.throws(() => cleanProfileName(' a '), /minimal/)
  assert.throws(() => cleanProfileName('x'.repeat(61)), /maksimal/)
})

test('profile menu items per account type', () => {
  assert.deepEqual(profileMenuItems({}), { items: ['profile', 'plan', 'settings', 'theme', 'signout'], badge: 'Live', canEditProfile: true })
  assert.equal(profileMenuItems({ demo: true }).badge, 'Demo')
  assert.equal(profileMenuItems({ demo: true }).canEditProfile, false)
  const admin = profileMenuItems({ isAdmin: true, adminVia: 'email' })
  assert.equal(admin.badge, 'Admin')
  assert.ok(admin.items.includes('office') && !admin.items.includes('back'))
  assert.ok(profileMenuItems({ isAdmin: true, adminVia: 'email', inOffice: true }).items.includes('back'))
  const staff = profileMenuItems({ isAdmin: true, adminVia: 'staff', inOffice: true })
  assert.deepEqual(staff.items, ['theme', 'signout'])
  assert.equal(staff.badge, 'Staf')
})

test('map picker: fields from a picked business', () => {
  const f = pickedFields({ name: 'Hotel Bumi', address: 'Jl. Ahmad Yani 10', phone: '021-555 123', lat: -6.2, lon: 106.9 }, 'Bekasi Barat, Bekasi, Jawa Barat, Indonesia')
  assert.deepEqual(f, { customer_name: 'Hotel Bumi', location: 'Jl. Ahmad Yani 10, Bekasi Barat, Bekasi, Jawa Barat', phone: '021-555 123', email: '', website: '', description: '', lat: -6.2, lng: 106.9 })
  assert.equal(pickedFields({ name: 'X', phone: 'call me' }, '').phone, '')
  assert.equal(pickLocation({ address: '' }, 'Bandung, Indonesia (contoh)'), 'Bandung')
  assert.equal(pickLocation({ address: 'Jl. Riau 5, Bandung' }, 'Bandung'), 'Jl. Riau 5, Bandung')
})

// ------------------------------------------------------------ platform AI provider

const { parseOpenAiModels, parseAnthropicModels, modelsRequest, listUnsupported } = await import('../src/ai-providers/models.js')
const { validatePlatformAi, publicPlatformAi } = await import('../src/admin/rules.js')
const { readFile, readdir } = await import('node:fs/promises')
const { createHash } = await import('node:crypto')

test('model lists: OpenAI-compatible and Anthropic pages are parsed', () => {
  assert.deepEqual(parseOpenAiModels({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }, { id: 'gpt-4o-mini' }, { id: 'bad id!' }] }).map((m) => m.id), ['gpt-4.1', 'gpt-4o-mini'])
  assert.deepEqual(parseOpenAiModels({ models: ['llama3', 'qwen'] }).map((m) => m.id), ['llama3', 'qwen'])
  const page = parseAnthropicModels({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }], has_more: true, last_id: 'claude-sonnet-4-5' })
  assert.deepEqual(page, { models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (claude-sonnet-4-5)' }], hasMore: true, lastId: 'claude-sonnet-4-5' })
  const a = modelsRequest({ mode: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', afterId: 'x' })
  assert.equal(a.url, 'https://api.anthropic.com/v1/models?limit=100&after_id=x')
  assert.equal(a.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(modelsRequest({ mode: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }).init.headers.Authorization, 'Bearer k')
  assert.ok(listUnsupported(404) && listUnsupported(405) && !listUnsupported(401))
})

test('platform AI settings: validation and public view', () => {
  assert.deepEqual(validatePlatformAi({ mode: 'workers', base_url: 'x' }), { mode: 'workers' })
  assert.equal(validatePlatformAi({ mode: 'anthropic', model: 'claude-x', api_key: 'k' }).base_url, 'https://api.anthropic.com')
  assert.throws(() => validatePlatformAi({ mode: 'openai', api_key: 'k' }), /model/)
  assert.ok(validatePlatformAi({ mode: 'openai', api_key: 'k' }, { requireModel: false }))
  assert.throws(() => validatePlatformAi({ mode: 'openai', model: 'm', base_url: 'http://x.com' }), /https/)
  assert.throws(() => validatePlatformAi({ mode: 'openai', model: 'm', max_tokens: 5 }), /16/)
  const shown = publicPlatformAi({ mode: 'openai', model: 'm', key_enc: 'a.b', key_last4: 'wxyz' })
  assert.equal(shown.key_enc, undefined)
  assert.equal(shown.key_saved, true)
})

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
  let aiCalls = 0
  const env = {
    DB: { prepare, async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out } },
    DEMO_OTP: 'false', RESEND_API_KEY: 're_test', ADMIN_EMAILS: 'alice@example.com', TOKEN_KEY: TEST_KEY,
    AI: { run: async () => { aiCalls++; return { response: 'Dari Workers AI' } } },
    ...extra,
  }
  for (const uid of ['alice', 'bob']) {
    sqlite.prepare('INSERT INTO users(id, email, name, created_at) VALUES (?, ?, ?, ?)').run(uid, `${uid}@example.com`, uid, '2026-11-01T00:00:00Z')
    sqlite.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(createHash('sha256').update(uid.repeat(8)).digest('hex'), uid, '2099-01-01T00:00:00Z')
  }
  return { env, sqlite, aiCalls: () => aiCalls }
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

test('worker: admin sets the platform AI provider; key encrypted; model list paged; chat uses it', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  const calls = stubFetch(t, async (url) => {
    if (url.includes('/v1/models')) {
      const after = new URL(url).searchParams.get('after_id')
      return new Response(JSON.stringify(after
        ? { data: [{ id: 'claude-haiku-4-5', display_name: 'Haiku' }], has_more: false, last_id: 'claude-haiku-4-5' }
        : { data: [{ id: 'claude-sonnet-4-5', display_name: 'Sonnet' }], has_more: true, last_id: 'claude-sonnet-4-5' }), { status: 200 })
    }
    if (url.endsWith('/v1/messages')) {
      return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Halo platform"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n', { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
  await call('bob', 'POST', '/api/office/admin/system/ai-provider/models', { mode: 'anthropic', api_key: 'sk-ant' }, 403)
  const list = await call('alice', 'POST', '/api/office/admin/system/ai-provider/models', { mode: 'anthropic', api_key: 'sk-ant-secret' })
  assert.deepEqual(list.models.map((m) => m.id), ['claude-sonnet-4-5', 'claude-haiku-4-5'])
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-secret')
  await call('alice', 'PUT', '/api/office/admin/system/ai-provider', { mode: 'anthropic', model: 'claude-sonnet-4-5', api_key: 'sk-ant-secret', max_tokens: 512 })
  const row = ctx.sqlite.prepare("SELECT value_json FROM system_settings WHERE key = 'ai_provider'").get()
  assert.ok(!row.value_json.includes('sk-ant-secret'))
  const sys = await call('alice', 'GET', '/api/office/admin/system')
  assert.equal(sys.status.ai.provider.model, 'claude-sonnet-4-5')
  assert.equal(sys.status.ai.provider.key_last4, 'cret')
  assert.equal(JSON.stringify(sys).includes('key_enc'), false)
  // Saved key is reused when the form leaves it empty.
  const again = await call('alice', 'POST', '/api/office/admin/system/ai-provider/models', { mode: 'anthropic', api_key: '' })
  assert.equal(again.models.length, 2)
  // Live business on "Bawaan": the platform provider answers, the call is metered like Workers AI.
  assert.equal((await call('bob', 'GET', '/api/llm/models'))[0].id, 'claude-sonnet-4-5')
  const out = await call('bob', 'POST', '/api/llm/chat', { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hai' }] })
  assert.match(out, /Halo platform/)
  assert.equal(ctx.aiCalls(), 0)
  assert.deepEqual(ctx.sqlite.prepare("SELECT feature, count FROM usage_counters WHERE user_id = 'bob'").all().map((u) => [u.feature, u.count]), [['offer', 1]])
  const audit = ctx.sqlite.prepare("SELECT action, target FROM admin_audit WHERE target = 'ai_provider'").all()
  assert.equal(audit.length, 1)
})

test('worker: platform AI failure falls back to Workers AI and is logged', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  const value = { mode: 'openai', base_url: 'https://api.down.example/v1', model: 'gpt-x', key_enc: await encryptToken('sk-1', TEST_KEY), key_last4: 'sk-1' }
  ctx.sqlite.prepare("INSERT INTO system_settings (key, value_json, updated_at, updated_by) VALUES ('ai_provider', ?, '2026-11-03', 'alice')").run(JSON.stringify(value))
  stubFetch(t, async () => new Response('{"error":{"message":"overloaded"}}', { status: 529 }))
  const out = await call('bob', 'POST', '/api/llm/chat', { model: 'gpt-x', messages: [{ role: 'user', content: 'hai' }] })
  assert.match(out, /Dari Workers AI/)
  assert.equal(ctx.aiCalls(), 1)
  const ev = ctx.sqlite.prepare("SELECT actor, target FROM admin_audit WHERE action = 'ai.fallback'").all()
  assert.deepEqual(ev.map((e) => [e.actor, e.target]), [['sistem', 'openai:gpt-x']])
  assert.equal(ctx.sqlite.prepare("SELECT count FROM usage_counters WHERE user_id = 'bob' AND feature = 'offer'").get().count, 1)
  const act = await call('alice', 'GET', '/api/office/admin/activity?page=1')
  assert.equal(act.ai_events.length, 1)
})

test('worker: business lists its own provider models and tests unsaved values', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  const calls = stubFetch(t, async (url) => {
    if (url.endsWith('/models')) return new Response('not here', { status: 404 })
    return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
  })
  const list = await call('bob', 'POST', '/api/integrations/ai/models', { ai_mode: 'openai', ai_base_url: 'https://api.local-llm.id/v1', ai_key: 'k1' })
  assert.deepEqual(list, { supported: false, models: [] })
  const r = await call('bob', 'POST', '/api/integrations/ai/test', { ai_mode: 'openai', ai_base_url: 'https://api.local-llm.id/v1', ai_model: 'qwen', ai_key: 'k1' })
  assert.equal(r.reply, 'OK')
  assert.equal(calls.at(-1).url, 'https://api.local-llm.id/v1/chat/completions')
  await call('bob', 'POST', '/api/integrations/ai/models', { ai_mode: 'openai', ai_base_url: 'https://api.local-llm.id/v1', ai_key: '' }, 400)
})

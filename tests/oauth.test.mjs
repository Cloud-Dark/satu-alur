// Akses AI by login (worker/oauth.js): OAuth 2.1 + PKCE metadata, dynamic client registration,
// authorize -> consent -> code -> token, refresh rotation, and /mcp with OAuth access tokens.
// Runs the real Worker on SQLite with every migration applied (tests/helpers/d1-sqlite.mjs).
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

const HOST = 'https://satu-alur.example.dev'
const CB = 'https://claude.ai/api/mcp/auth_callback'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const b64url = (buf) => Buffer.from(buf).toString('base64url')
const sessionOf = (uid) => `${uid}-session-token-0123456789`
const pkce = () => {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

async function setup(t) {
  let makeD1
  try { ({ makeD1 } = await import('./helpers/d1-sqlite.mjs')); await import('node:sqlite') } catch { t.skip('SQLite integration requires Node 22.13+'); return null }
  const DB = await makeD1()
  t.after(() => DB.raw.close())
  const sql = DB.raw
  const users = [
    ['alice', 'alice@usaha.id', 'CV Alice Teknik', 0],
    ['bob', 'bob@usaha.id', 'Bob Cleaning', 0],
    ['demo', 'demo-ac@satualur.id', 'Demo AC', 0],
    ['staff', 'staff@staff.satualur.internal', 'Staf', 1],
    ['susp', 'susp@usaha.id', 'Suspended', 0],
  ]
  for (const [id, email, name, staff] of users) {
    sql.prepare('INSERT INTO users(id, email, name, created_at) VALUES (?, ?, ?, ?)').run(id, email, name, '2026-01-02T00:00:00Z')
    sql.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, is_staff) VALUES (?, ?, ?, ?)').run(sha(sessionOf(id)), id, '2099-01-01T00:00:00Z', staff)
  }
  const now = new Date().toISOString()
  sql.prepare("INSERT INTO requests(owner_id, customer_name, service_type, status, created_at) VALUES ('alice', 'PT Maju Jaya', 'Servis AC', 'new', ?)").run(now)
  sql.prepare("INSERT INTO requests(owner_id, customer_name, service_type, status, created_at) VALUES ('bob', 'PT Rahasia Bob', 'Cleaning', 'new', ?)").run(now)

  const env = { DB, DEMO_OTP: 'false' }
  const { default: worker } = await import('../worker/index.js')
  const { _resetLimits } = await import('../worker/mcp-server.js')
  _resetLimits()
  const fetchW = (path, init = {}) => worker.fetch(new Request(path.startsWith('http') ? path : `${HOST}${path}`, init), env)
  const api = async (uid, method, path, body, expected = 200) => {
    const res = await fetchW(path, { method, headers: { authorization: `Bearer ${sessionOf(uid)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    assert.equal(res.status, expected, text)
    return JSON.parse(text)
  }
  const register = async (meta, expected = 201) => {
    const res = await fetchW('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) })
    const body = await res.json()
    assert.equal(res.status, expected, JSON.stringify(body))
    return body
  }
  const authorizeUrl = (client, { challenge, state = 'st-123', redirect = CB, extra = {} } = {}) => {
    const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'satu-alur.read', resource: `${HOST}/mcp`, ...extra })
    return `/oauth/authorize?${q}`
  }
  /** authorize -> the req id of the consent page. */
  const authorize = async (client, opts) => {
    const res = await fetchW(authorizeUrl(client, opts), { redirect: 'manual' })
    assert.equal(res.status, 302, await res.text())
    const loc = res.headers.get('location')
    const m = /^https:\/\/satu-alur\.example\.dev\/#\/izin-ai\?req=([A-Za-z0-9_-]+)$/.exec(loc)
    assert.ok(m, loc)
    return m[1]
  }
  const tokenReq = async (params, { expected = 200, json = false } = {}) => {
    const res = await fetchW('/oauth/token', json
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) }
      : { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() })
    const body = await res.json()
    assert.equal(res.status, expected, JSON.stringify(body))
    assert.equal(res.headers.get('cache-control'), 'no-store')
    return body
  }
  /** Full login: register, authorize, approve as uid, return { client, code, verifier }. */
  const connect = async (uid = 'alice', clientMeta = { client_name: 'Claude', redirect_uris: [CB] }) => {
    const client = await register(clientMeta)
    const { verifier, challenge } = pkce()
    const req = await authorize(client, { challenge, redirect: clientMeta.redirect_uris[0] })
    const dec = (await api(uid, 'POST', '/api/oauth/decision', { req, approve: true })).data
    const back = new URL(dec.redirect)
    return { client, verifier, code: back.searchParams.get('code'), back }
  }
  const exchange = (client, code, verifier, expected) => tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: CB }, { expected })
  const rpc = async (token, body, expected = 200) => {
    const res = await fetchW('/mcp', { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) })
    const text = await res.text()
    assert.equal(res.status, expected, text)
    return { res, body: text ? JSON.parse(text) : null }
  }
  const tool = async (token, name, args = {}, expected = 200) => (await rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, expected)).body
  return { sql, env, fetchW, api, register, authorize, authorizeUrl, tokenReq, connect, exchange, rpc, tool }
}

test('oauth metadata: protected resource + authorization server (+ aliases, CORS)', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const res = await ctx.fetchW(p)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(await res.json(), {
      resource: `${HOST}/mcp`, authorization_servers: [HOST], scopes_supported: ['satu-alur.read'], bearer_methods_supported: ['header'], resource_name: 'Satu Alur',
    })
  }
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/.well-known/oauth-authorization-server/mcp']) {
    const res = await ctx.fetchW(p)
    assert.equal(res.status, 200, p)
    const m = await res.json()
    assert.equal(m.issuer, HOST)
    assert.equal(m.authorization_endpoint, `${HOST}/oauth/authorize`)
    assert.equal(m.token_endpoint, `${HOST}/oauth/token`)
    assert.equal(m.registration_endpoint, `${HOST}/oauth/register`)
    assert.equal(m.revocation_endpoint, `${HOST}/oauth/revoke`)
    assert.deepEqual(m.response_types_supported, ['code'])
    assert.deepEqual(m.grant_types_supported, ['authorization_code', 'refresh_token'])
    assert.deepEqual(m.code_challenge_methods_supported, ['S256'])
    assert.ok(m.token_endpoint_auth_methods_supported.includes('none'))
    assert.deepEqual(m.scopes_supported, ['satu-alur.read'])
  }
  const pre = await ctx.fetchW('/oauth/token', { method: 'OPTIONS', headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), '*')
})

test('oauth register: good and bad redirect URIs', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const c = await ctx.register({ client_name: 'Claude', redirect_uris: [CB, 'http://localhost:33418/callback', 'http://127.0.0.1/cb'] })
  assert.match(c.client_id, /^sa_cl_/)
  assert.equal(c.token_endpoint_auth_method, 'none')
  assert.equal(c.client_secret, undefined, 'public client: no secret')
  assert.deepEqual(c.grant_types, ['authorization_code', 'refresh_token'])
  const row = ctx.sql.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(c.client_id)
  assert.equal(row.client_name, 'Claude')
  for (const bad of [[], ['http://evil.example/cb'], ['javascript:alert(1)'], ['https://claude.ai/cb#frag'], ['not a url'], ['ftp://x.y/z'], ['https://u:p@claude.ai/cb']]) {
    const r = await ctx.register({ client_name: 'X', redirect_uris: bad }, 400)
    assert.equal(r.error, 'invalid_redirect_uri', JSON.stringify(bad))
  }
  assert.equal((await ctx.register({ client_name: 'X' }, 400)).error, 'invalid_redirect_uri')
  assert.equal((await ctx.register({ redirect_uris: [CB], grant_types: ['client_credentials'] }, 400)).error, 'invalid_client_metadata')
  assert.equal((await ctx.register({ redirect_uris: [CB], token_endpoint_auth_method: 'private_key_jwt' }, 400)).error, 'invalid_client_metadata')
  // A confidential client gets a secret, stored hashed only
  const conf = await ctx.register({ redirect_uris: [CB], token_endpoint_auth_method: 'client_secret_post' })
  assert.match(conf.client_secret, /^sa_cs_/)
  assert.ok(!JSON.stringify(ctx.sql.prepare('SELECT * FROM oauth_clients').all()).includes(conf.client_secret))
  // Rate limit per IP
  const { OAUTH_LIMITS } = await import('../worker/oauth.js')
  const { _resetLimits } = await import('../worker/mcp-server.js')
  _resetLimits()
  let last
  for (let i = 0; i <= OAUTH_LIMITS.registerPerHour; i++) {
    last = await ctx.fetchW('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify({ redirect_uris: [CB] }) })
  }
  assert.equal(last.status, 429)
})

test('oauth authorize: validation, then redirect to the consent page with a server-side request', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const client = await ctx.register({ client_name: 'Claude', redirect_uris: [CB, 'http://localhost:33418/callback'] })
  const { challenge } = pkce()
  // Unknown client / wrong redirect_uri: an error page, never a redirect
  for (const url of [
    ctx.authorizeUrl({ client_id: 'sa_cl_nope' }, { challenge }),
    ctx.authorizeUrl(client, { challenge, redirect: 'https://evil.example/cb' }),
  ]) {
    const res = await ctx.fetchW(url, { redirect: 'manual' })
    assert.equal(res.status, 400)
    assert.match(res.headers.get('content-type'), /text\/html/)
    assert.equal(res.headers.get('location'), null)
  }
  // Errors after the redirect_uri is trusted go back to the client with state
  const bad = async (extra, error) => {
    const res = await ctx.fetchW(ctx.authorizeUrl(client, { challenge, extra }), { redirect: 'manual' })
    assert.equal(res.status, 302)
    const loc = new URL(res.headers.get('location'))
    assert.equal(loc.origin + loc.pathname, CB)
    assert.equal(loc.searchParams.get('error'), error, JSON.stringify(extra))
    assert.equal(loc.searchParams.get('state'), 'st-123')
  }
  await bad({ code_challenge_method: 'plain' }, 'invalid_request')
  await bad({ code_challenge: '' }, 'invalid_request')
  await bad({ response_type: 'token' }, 'unsupported_response_type')
  await bad({ resource: 'https://other.example/mcp' }, 'invalid_target')
  // Good request: parked server-side, only the hash of the opaque id stored
  const req = await ctx.authorize(client, { challenge })
  const rows = ctx.sql.prepare('SELECT * FROM oauth_requests').all()
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].id_hash, req)
  assert.equal(rows[0].code_challenge, challenge)
  assert.equal(rows[0].redirect_uri, CB)
  // Loopback redirect with another port is accepted (RFC 8252)
  await ctx.authorize(client, { challenge, redirect: 'http://localhost:51234/callback' })
  // The consent page reads the request with the user's session
  const info = (await ctx.api('alice', 'GET', `/api/oauth/request?req=${req}`)).data
  assert.equal(info.client_name, 'Claude')
  assert.equal(info.redirect_host, 'claude.ai')
  assert.equal(info.read_only, true)
  assert.equal(info.tools.length, 6)
  assert.ok(info.tools.every((x) => x.name && x.title && x.summary))
  assert.equal(info.account.email, 'alice@usaha.id')
  assert.equal(info.refused, null)
  await ctx.api('alice', 'GET', '/api/oauth/request?req=nope', undefined, 400)
  await ctx.api('alice', 'GET', `/api/oauth/request?req=${'x'.repeat(43)}`, undefined, 404)
  const anon = await ctx.fetchW(`/api/oauth/request?req=${req}`)
  assert.equal(anon.status, 401)
  // Expired request
  ctx.sql.prepare("UPDATE oauth_requests SET expires_at = '2000-01-01T00:00:00Z'").run()
  await ctx.api('alice', 'GET', `/api/oauth/request?req=${req}`, undefined, 404)
})

test('oauth decision: approve gives a code, deny gives access_denied; single use', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const client = await ctx.register({ client_name: 'Claude', redirect_uris: [CB] })
  const { challenge } = pkce()
  const req = await ctx.authorize(client, { challenge, state: 'abc' })
  const ok = (await ctx.api('alice', 'POST', '/api/oauth/decision', { req, approve: true })).data
  const u = new URL(ok.redirect)
  assert.equal(u.origin + u.pathname, CB)
  assert.match(u.searchParams.get('code'), /^[A-Za-z0-9_-]{43}$/)
  assert.equal(u.searchParams.get('state'), 'abc')
  const codes = ctx.sql.prepare('SELECT * FROM oauth_codes').all()
  assert.equal(codes.length, 1)
  assert.equal(codes[0].code_hash, sha(u.searchParams.get('code')), 'only the code hash is stored')
  assert.equal(codes[0].owner_id, 'alice')
  // Answered: cannot be answered again
  await ctx.api('alice', 'POST', '/api/oauth/decision', { req, approve: true }, 404)
  // Deny
  const req2 = await ctx.authorize(client, { challenge, state: 'xyz' })
  const no = (await ctx.api('alice', 'POST', '/api/oauth/decision', { req: req2, approve: false })).data
  const d = new URL(no.redirect)
  assert.equal(d.searchParams.get('error'), 'access_denied')
  assert.equal(d.searchParams.get('state'), 'xyz')
  assert.equal(d.searchParams.get('code'), null)
  assert.equal(ctx.sql.prepare('SELECT COUNT(*) AS n FROM oauth_grants').get().n, 1)
})

test('oauth token: PKCE, code reuse, expiry, client binding', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  // Wrong verifier
  let c = await ctx.connect()
  const wrong = await ctx.exchange(c.client, c.code, pkce().verifier, 400)
  assert.equal(wrong.error, 'invalid_grant')
  // Missing verifier
  assert.equal((await ctx.tokenReq({ grant_type: 'authorization_code', code: c.code, client_id: c.client.client_id }, { expected: 400 })).error, 'invalid_request')
  // Another client cannot redeem it
  const other = await ctx.register({ redirect_uris: [CB] })
  assert.equal((await ctx.exchange(other, c.code, c.verifier, 400)).error, 'invalid_grant')
  assert.equal((await ctx.tokenReq({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, client_id: 'sa_cl_unknown' }, { expected: 401 })).error, 'invalid_client')
  // Correct verifier (JSON body also accepted)
  const tok = await ctx.tokenReq({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, client_id: c.client.client_id, redirect_uri: CB }, { json: true })
  assert.match(tok.access_token, /^sa_oat_[A-Za-z0-9_-]{43}$/)
  assert.match(tok.refresh_token, /^sa_ort_[A-Za-z0-9_-]{43}$/)
  assert.equal(tok.token_type, 'Bearer')
  assert.equal(tok.expires_in, 3600)
  assert.equal(tok.scope, 'satu-alur.read')
  const stored = JSON.stringify([ctx.sql.prepare('SELECT * FROM mcp_tokens').all(), ctx.sql.prepare('SELECT * FROM oauth_refresh_tokens').all()])
  assert.ok(!stored.includes(tok.access_token) && !stored.includes(tok.refresh_token), 'only hashes stored')
  assert.ok(stored.includes(sha(tok.access_token)))
  // The token works on /mcp
  assert.equal((await ctx.tool(tok.access_token, 'info_akun')).result.structuredContent.email, 'alice@usaha.id')
  // Code reuse: rejected, and the grant is revoked (the token it produced stops working)
  assert.equal((await ctx.exchange(c.client, c.code, c.verifier, 400)).error, 'invalid_grant')
  await ctx.rpc(tok.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, 401)
  // Expired code
  c = await ctx.connect()
  ctx.sql.prepare("UPDATE oauth_codes SET expires_at = '2000-01-01T00:00:00Z' WHERE used_at IS NULL").run()
  assert.equal((await ctx.exchange(c.client, c.code, c.verifier, 400)).error, 'invalid_grant')
  // Wrong redirect_uri
  c = await ctx.connect()
  assert.equal((await ctx.tokenReq({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, client_id: c.client.client_id, redirect_uri: 'https://claude.ai/other' }, { expected: 400 })).error, 'invalid_grant')
  assert.equal((await ctx.tokenReq({ grant_type: 'password', client_id: c.client.client_id }, { expected: 400 })).error, 'unsupported_grant_type')
  // Confidential client must send its secret
  const conf = await ctx.register({ redirect_uris: [CB], token_endpoint_auth_method: 'client_secret_post' })
  const { verifier, challenge } = pkce()
  const req = await ctx.authorize(conf, { challenge })
  const code = new URL((await ctx.api('alice', 'POST', '/api/oauth/decision', { req, approve: true })).data.redirect).searchParams.get('code')
  assert.equal((await ctx.tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: conf.client_id }, { expected: 401 })).error, 'invalid_client')
  const ok = await ctx.tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: conf.client_id, client_secret: conf.client_secret })
  assert.ok(ok.access_token)
})

test('oauth refresh: rotation, reuse detection revokes the family, expiry of access tokens', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const c = await ctx.connect()
  const t1 = await ctx.exchange(c.client, c.code, c.verifier)
  const refresh = (rt, expected) => ctx.tokenReq({ grant_type: 'refresh_token', refresh_token: rt, client_id: c.client.client_id }, { expected })
  const t2 = await refresh(t1.refresh_token)
  assert.notEqual(t2.refresh_token, t1.refresh_token, 'refresh tokens rotate')
  assert.notEqual(t2.access_token, t1.access_token)
  await ctx.tool(t2.access_token, 'info_akun')
  // Another client cannot use it
  const other = await ctx.register({ redirect_uris: [CB] })
  assert.equal((await ctx.tokenReq({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: other.client_id }, { expected: 400 })).error, 'invalid_grant')
  // Expired access token -> 401 invalid_token, refresh still works
  ctx.sql.prepare("UPDATE mcp_tokens SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash = ?").run(sha(t2.access_token))
  const exp = await ctx.rpc(t2.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, 401)
  assert.match(exp.res.headers.get('www-authenticate'), /error="invalid_token"/)
  const t3 = await refresh(t2.refresh_token)
  await ctx.tool(t3.access_token, 'info_akun')
  // Reuse of the old refresh token: rejected and the whole grant is revoked
  assert.equal((await refresh(t1.refresh_token, 400)).error, 'invalid_grant')
  await ctx.rpc(t3.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, 401)
  assert.equal((await refresh(t3.refresh_token, 400)).error, 'invalid_grant')
  assert.ok(ctx.sql.prepare('SELECT revoked_at FROM oauth_grants').get().revoked_at)
  assert.equal((await ctx.api('alice', 'GET', '/api/oauth/grants')).data.items.length, 0)
})

test('mcp with OAuth: 401 with resource_metadata, isolation, connected apps, Putuskan', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  // No token: 401 + WWW-Authenticate pointing at the protected resource metadata (no error code)
  const none = await ctx.rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 401)
  assert.equal(none.res.headers.get('www-authenticate'), `Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource"`)
  const junk = await ctx.rpc('sa_oat_' + 'x'.repeat(43), { jsonrpc: '2.0', id: 1, method: 'ping' }, 401)
  assert.equal(junk.res.headers.get('www-authenticate'), `Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource", error="invalid_token"`)
  // Alice and Bob each connect; each sees only their own data
  const a = await ctx.connect('alice')
  const ta = await ctx.exchange(a.client, a.code, a.verifier)
  const b = await ctx.connect('bob', { client_name: 'Claude Code', redirect_uris: ['http://localhost:4000/callback'] })
  const tb = await ctx.tokenReq({ grant_type: 'authorization_code', code: b.code, code_verifier: b.verifier, client_id: b.client.client_id })
  const ja = JSON.stringify(await ctx.tool(ta.access_token, 'cari_pekerjaan', {}))
  const jb = JSON.stringify(await ctx.tool(tb.access_token, 'cari_pekerjaan', {}))
  assert.ok(ja.includes('PT Maju Jaya') && !ja.includes('Rahasia'))
  assert.ok(jb.includes('PT Rahasia Bob') && !jb.includes('Maju Jaya'))
  const info = (await ctx.tool(ta.access_token, 'info_akun')).result
  assert.match(info.content[0].text, /Terhubung lewat login \(Claude\)/)
  // OAuth access tokens never work in the URL form
  const res = await ctx.fetchW(`/mcp/${ta.access_token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
  assert.equal(res.status, 401)
  // Manual tokens still work next to OAuth, and the manual list does not show OAuth tokens
  const manual = (await ctx.api('alice', 'POST', '/api/mcp-tokens', { name: 'Manual' }, 201)).data.token
  await ctx.tool(manual, 'info_akun')
  const mlist = (await ctx.api('alice', 'GET', '/api/mcp-tokens')).data.items
  assert.deepEqual(mlist.map((x) => x.name), ['Manual'])
  // Connected apps: listed per account, last_used_at stamped by /mcp
  const grants = (await ctx.api('alice', 'GET', '/api/oauth/grants')).data.items
  assert.equal(grants.length, 1)
  assert.equal(grants[0].client_name, 'Claude')
  assert.equal(grants[0].redirect_host, 'claude.ai')
  assert.ok(grants[0].created_at && grants[0].last_used_at)
  assert.deepEqual(Object.keys(grants[0]).sort(), ['client_name', 'created_at', 'id', 'last_used_at', 'redirect_host'])
  // Bob cannot see or revoke Alice's grant
  assert.equal((await ctx.api('bob', 'GET', '/api/oauth/grants')).data.items[0].client_name, 'Claude Code')
  await ctx.api('bob', 'DELETE', `/api/oauth/grants/${grants[0].id}`, undefined, 404)
  // Putuskan: tokens stop at once, refresh fails too
  await ctx.api('alice', 'DELETE', `/api/oauth/grants/${grants[0].id}`)
  await ctx.rpc(ta.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, 401)
  assert.equal((await ctx.tokenReq({ grant_type: 'refresh_token', refresh_token: ta.refresh_token, client_id: a.client.client_id }, { expected: 400 })).error, 'invalid_grant')
  assert.equal((await ctx.api('alice', 'GET', '/api/oauth/grants')).data.items.length, 0)
  await ctx.api('alice', 'DELETE', `/api/oauth/grants/${grants[0].id}`, undefined, 404)
  // Bob is unaffected; RFC 7009 revoke of his refresh token ends his grant
  await ctx.tool(tb.access_token, 'info_akun')
  const rv = await ctx.fetchW('/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tb.refresh_token, client_id: b.client.client_id }).toString() })
  assert.equal(rv.status, 200)
  await ctx.rpc(tb.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, 401)
})

test('oauth: demo, staff and suspended accounts cannot connect', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const client = await ctx.register({ client_name: 'Claude', redirect_uris: [CB] })
  const { challenge } = pkce()
  for (const uid of ['demo', 'staff']) {
    const req = await ctx.authorize(client, { challenge })
    const info = (await ctx.api(uid, 'GET', `/api/oauth/request?req=${req}`)).data
    assert.match(info.refused, uid === 'demo' ? /Akun demo/ : /staf/)
    const r = await ctx.api(uid, 'POST', '/api/oauth/decision', { req, approve: true }, 403)
    assert.match(r.error.message, uid === 'demo' ? /Akun demo/ : /staf/)
    // They can still say no, which returns the user to Claude
    const no = (await ctx.api(uid, 'POST', '/api/oauth/decision', { req, approve: false })).data
    assert.equal(new URL(no.redirect).searchParams.get('error'), 'access_denied')
    assert.equal((await ctx.api(uid, 'GET', '/api/oauth/grants')).data.items.length, 0)
  }
  assert.equal(ctx.sql.prepare('SELECT COUNT(*) AS n FROM oauth_grants').get().n, 0)
  // Suspended: the session itself is refused
  ctx.sql.prepare("INSERT INTO user_flags(user_id, suspended, updated_at) VALUES ('susp', 1, '2026-01-01')").run()
  const req = await ctx.authorize(client, { challenge })
  await ctx.api('susp', 'POST', '/api/oauth/decision', { req, approve: true }, 403)
  // Suspended after connecting: /mcp refuses and refresh fails
  const c = await ctx.connect('alice')
  const tok = await ctx.exchange(c.client, c.code, c.verifier)
  ctx.sql.prepare("INSERT INTO user_flags(user_id, suspended, updated_at) VALUES ('alice', 1, '2026-01-01')").run()
  await ctx.rpc(tok.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' }, 403)
  assert.equal((await ctx.tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: c.client.client_id }, { expected: 400 })).error, 'invalid_grant')
})

test('oauth paths: SPA and other .well-known paths still go to the assets', async (t) => {
  const ctx = await setup(t)
  if (!ctx) return
  const seen = []
  ctx.env.ASSETS = { fetch: (req) => { seen.push(new URL(req.url).pathname); return new Response('spa') } }
  for (const p of ['/', '/index.html', '/.well-known/security.txt', '/oauthx']) {
    const res = await ctx.fetchW(p)
    assert.equal(await res.text(), 'spa', p)
  }
  assert.deepEqual(seen, ['/', '/index.html', '/.well-known/security.txt', '/oauthx'])
  const nf = await ctx.fetchW('/oauth/nope')
  assert.equal(nf.status, 404)
})

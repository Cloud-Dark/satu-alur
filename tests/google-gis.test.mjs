// Google Identity Services: ID token verification (RS256 + claims + nonce), JWKS caching rules,
// and the Worker's nonce/credential routes on SQLite.
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const { verifyGoogleIdToken, parseJwt, jwksMaxAge, importRsaJwk, GOOGLE_JWKS_URL } = await import('../src/auth/google.js')

const CLIENT = 'cid.apps.googleusercontent.com'
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

async function keyPair(kid) {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  )
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid, alg: 'RS256', use: 'sig' }
  return { kid, privateKey: kp.privateKey, jwk }
}

async function sign(key, claims, header = {}) {
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header })
  const body = enc(claims)
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key.privateKey, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`
}

const now = Date.UTC(2026, 10, 3, 12)
const claims = (extra = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', email: 'Budi@Example.com', email_verified: true,
  name: 'Budi', nonce: 'n'.repeat(32), iat: now / 1000 - 10, exp: now / 1000 + 3600, ...extra,
})

const A = await keyPair('kid-a')
const B = await keyPair('kid-b')
const keyFor = async (kid) => (kid === A.kid ? importRsaJwk(A.jwk) : null)
const verify = (jwt, opts = {}) => verifyGoogleIdToken(jwt, { clientId: CLIENT, nonce: 'n'.repeat(32), getKey: keyFor, now, ...opts })

test('gis: a valid Google ID token yields the lower-cased verified email', async () => {
  const profile = await verify(await sign(A, claims()))
  assert.deepEqual(profile, { email: 'budi@example.com', name: 'Budi', sub: '1234' })
  assert.equal(parseJwt('not.a.jwt!'), null)
})

test('gis: wrong audience, issuer, expiry, unverified email and nonce are refused', async () => {
  await assert.rejects(verify(await sign(A, claims({ aud: 'other' }))), /bukan untuk aplikasi ini/)
  await assert.rejects(verify(await sign(A, claims({ iss: 'https://evil.example' }))), /Penerbit/)
  await assert.rejects(verify(await sign(A, claims({ exp: now / 1000 - 1 }))), /kedaluwarsa/)
  await assert.rejects(verify(await sign(A, claims({ exp: undefined }))), /kedaluwarsa/)
  await assert.rejects(verify(await sign(A, claims({ email_verified: false }))), /belum terverifikasi/)
  await assert.rejects(verify(await sign(A, claims({ nonce: 'x'.repeat(32) }))), /tidak cocok/)
  await assert.rejects(verify(await sign(A, claims()), { nonce: '' }), /tidak cocok/)
})

test('gis: bad signature, unknown key and non-RS256 tokens are refused', async () => {
  const good = await sign(A, claims())
  const [h, p] = good.split('.')
  const forged = `${h}.${enc({ ...claims(), email: 'admin@example.com' })}.${good.split('.')[2]}`
  await assert.rejects(verify(forged), /Tanda tangan/)
  // Signed by B but claims to be A's key id: signature check fails.
  await assert.rejects(verify(await sign(B, claims(), { kid: A.kid })), /Tanda tangan/)
  await assert.rejects(verify(await sign(B, claims())), /tidak dikenal/)
  await assert.rejects(verify(`${enc({ alg: 'none', kid: A.kid })}.${p}.`), /tidak valid/)
  await assert.rejects(verify(`${enc({ alg: 'HS256', kid: A.kid })}.${p}.${good.split('.')[2]}`), /tidak valid/)
})

test('gis: JWKS cache time follows Cache-Control within 5 min … 24 h', () => {
  assert.equal(jwksMaxAge('public, max-age=21600, must-revalidate'), 21600)
  assert.equal(jwksMaxAge('max-age=10'), 300)
  assert.equal(jwksMaxAge('max-age=999999'), 86400)
  assert.equal(jwksMaxAge(null), 3600)
})

// ------------------------------------------------------------------ Worker routes

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
    DEMO_OTP: 'false', GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'sec',
    AI: { run: async () => { throw new Error('AI must not run') } },
    ...extra,
  }
  return { sqlite, env }
}

async function call(worker, env, method, path, body, { expected = 200, ip = '203.0.113.7' } = {}) {
  const res = await worker.fetch(new Request(`https://satu-alur.apipedia.workers.dev${path}`, {
    method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env)
  const text = await res.text()
  assert.equal(res.status, expected, text)
  return JSON.parse(text).data
}

function stubJwks(t, keys) {
  const original = globalThis.fetch
  let hits = 0
  globalThis.fetch = async (url) => {
    if (String(url) === GOOGLE_JWKS_URL) {
      hits += 1
      return new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=20000' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  t.after(() => { globalThis.fetch = original })
  return () => hits
}

test('worker: GIS nonce → credential signs in, creates the user once, nonce is single use', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const { resetGoogleKeyCache } = await import('../worker/google.js')
  resetGoogleKeyCache()
  const jwksHits = stubJwks(t, [A.jwk])

  const providers = await call(worker, ctx.env, 'GET', '/api/auth/providers')
  assert.equal(providers.google, true)
  assert.equal(providers.google_client_id, CLIENT)

  const { nonce } = await call(worker, ctx.env, 'GET', '/api/auth/google/nonce')
  assert.match(nonce, /^[A-Za-z0-9_-]{32}$/)
  const token = await sign(A, claims({ nonce, iat: Date.now() / 1000 - 5, exp: Date.now() / 1000 + 3600 }))
  const res = await call(worker, ctx.env, 'POST', '/api/auth/google/credential', { credential: token, nonce })
  assert.equal(res.user.email, 'budi@example.com')
  assert.match(res.access_token, /^[0-9a-f]{64}$/)
  assert.ok(ctx.sqlite.prepare('SELECT last_login_at FROM users WHERE email = ?').get('budi@example.com').last_login_at)

  // Replay with the same nonce: refused (row already deleted).
  await call(worker, ctx.env, 'POST', '/api/auth/google/credential', { credential: token, nonce }, { expected: 400 })

  // Second login for the same address reuses the user; keys come from the module cache.
  const n2 = (await call(worker, ctx.env, 'GET', '/api/auth/google/nonce')).nonce
  const again = await call(worker, ctx.env, 'POST', '/api/auth/google/credential', {
    credential: await sign(A, claims({ nonce: n2, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600 })), nonce: n2,
  })
  assert.equal(again.user.id, res.user.id)
  assert.equal(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('budi@example.com').n, 1)
  assert.equal(jwksHits(), 1)
})

test('worker: GIS refuses a token for another nonce, staff/demo emails and unconfigured Google', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const { resetGoogleKeyCache } = await import('../worker/google.js')
  resetGoogleKeyCache()
  stubJwks(t, [A.jwk])
  const live = (extra) => claims({ iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600, ...extra })

  const n1 = (await call(worker, ctx.env, 'GET', '/api/auth/google/nonce', undefined, { ip: '198.51.100.1' })).nonce
  await call(worker, ctx.env, 'POST', '/api/auth/google/credential',
    { credential: await sign(A, live({ nonce: 'z'.repeat(32) })), nonce: n1 }, { expected: 401, ip: '198.51.100.1' })

  const n2 = (await call(worker, ctx.env, 'GET', '/api/auth/google/nonce', undefined, { ip: '198.51.100.1' })).nonce
  await call(worker, ctx.env, 'POST', '/api/auth/google/credential',
    { credential: await sign(A, live({ nonce: n2, email: 'demo-ac@satualur.id' })), nonce: n2 }, { expected: 403, ip: '198.51.100.1' })

  const n3 = (await call(worker, ctx.env, 'GET', '/api/auth/google/nonce', undefined, { ip: '198.51.100.1' })).nonce
  await call(worker, ctx.env, 'POST', '/api/auth/google/credential',
    { credential: await sign(A, live({ nonce: n3, email: 'x@staff.satualur.internal' })), nonce: n3 }, { expected: 403, ip: '198.51.100.1' })

  // An expired nonce row is not accepted either.
  ctx.sqlite.prepare("INSERT INTO gis_nonces (id, expires_at) VALUES (?, '2000-01-01T00:00:00Z')")
    .run(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('o'.repeat(32)))).toString('hex'))
  await call(worker, ctx.env, 'POST', '/api/auth/google/credential',
    { credential: await sign(A, live({ nonce: 'o'.repeat(32) })), nonce: 'o'.repeat(32) }, { expected: 400, ip: '198.51.100.1' })

  const off = { ...ctx.env, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }
  const p = await call(worker, off, 'GET', '/api/auth/providers')
  assert.equal(p.google, false)
  assert.equal(p.google_client_id, undefined)
  await call(worker, off, 'GET', '/api/auth/google/nonce', undefined, { expected: 503 })
})

test('worker: GIS routes are rate-limited per IP', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  for (let i = 0; i < 30; i++) await call(worker, ctx.env, 'GET', '/api/auth/google/nonce', undefined, { ip: '192.0.2.44' })
  await call(worker, ctx.env, 'GET', '/api/auth/google/nonce', undefined, { expected: 429, ip: '192.0.2.44' })
})

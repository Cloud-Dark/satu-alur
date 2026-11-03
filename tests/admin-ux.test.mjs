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
  assert.deepEqual(f, { customer_name: 'Hotel Bumi', location: 'Jl. Ahmad Yani 10, Bekasi Barat, Bekasi, Jawa Barat', phone: '021-555 123', lat: -6.2, lng: 106.9 })
  assert.equal(pickedFields({ name: 'X', phone: 'call me' }, '').phone, '')
  assert.equal(pickLocation({ address: '' }, 'Bandung, Indonesia (contoh)'), 'Bandung')
  assert.equal(pickLocation({ address: 'Jl. Riau 5, Bandung' }, 'Bandung'), 'Jl. Riau 5, Bandung')
})

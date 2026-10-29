import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePaymentSettings, testGateway } from '../src/business/payment.js'

const stub = (status, calls = []) => async (url, init) => { calls.push({ url, init }); return new Response('{}', { status }) }
const basic = (k) => `Basic ${btoa(`${k}:`)}`

test('testGateway: Midtrans sandbox URL + Basic auth; 404 means connected', async () => {
  const calls = []
  const r = await testGateway({ provider: 'midtrans', mode: 'sandbox', serverKey: 'SB-Mid-server-abc' }, stub(404, calls))
  assert.deepEqual(r, { ok: true, message: 'Terhubung ke Midtrans (sandbox).' })
  assert.equal(calls[0].url, 'https://api.sandbox.midtrans.com/v2/satualur-ping/status')
  assert.equal(calls[0].init.headers.Authorization, basic('SB-Mid-server-abc'))
})

test('testGateway: Midtrans production URL; 401 is rejected', async () => {
  const calls = []
  const r = await testGateway({ provider: 'midtrans', mode: 'production', serverKey: 'k' }, stub(401, calls))
  assert.deepEqual(r, { ok: false, message: 'Server key ditolak Midtrans.' })
  assert.equal(calls[0].url, 'https://api.midtrans.com/v2/satualur-ping/status')
})

test('testGateway: Xendit 200 connected, 401/403 rejected', async () => {
  const calls = []
  assert.deepEqual(await testGateway({ provider: 'xendit', mode: 'sandbox', serverKey: 'xnd_x' }, stub(200, calls)), { ok: true, message: 'Terhubung ke Xendit.' })
  assert.equal(calls[0].url, 'https://api.xendit.co/balance')
  assert.equal(calls[0].init.headers.Authorization, basic('xnd_x'))
  for (const s of [401, 403]) {
    assert.deepEqual(await testGateway({ provider: 'xendit', mode: 'sandbox', serverKey: 'x' }, stub(s)), { ok: false, message: 'Server key ditolak Xendit.' })
  }
})

test('testGateway: network error and timeout give "Tidak dapat menghubungi"', async () => {
  const boom = async () => { throw new TypeError('fetch failed') }
  assert.deepEqual(await testGateway({ provider: 'midtrans', mode: 'sandbox', serverKey: 'k' }, boom), { ok: false, message: 'Tidak dapat menghubungi Midtrans.' })
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  const r = await testGateway({ provider: 'xendit', mode: 'sandbox', serverKey: 'k' }, hang, { timeoutMs: 20 })
  assert.deepEqual(r, { ok: false, message: 'Tidak dapat menghubungi Xendit.' })
})

test('testGateway: provider none and a missing key never call fetch', async () => {
  const never = async () => { throw new Error('called') }
  assert.deepEqual(await testGateway({ provider: 'none', mode: 'sandbox', serverKey: 'k' }, never), { ok: false, message: 'Pilih penyedia pembayaran terlebih dahulu.' })
  assert.deepEqual(await testGateway({ provider: 'midtrans', mode: 'sandbox', serverKey: '' }, never), { ok: false, message: 'Server key belum diatur.' })
})

test('validatePaymentSettings: enums, trims, and 200-char limits', () => {
  const v = validatePaymentSettings({ provider: 'midtrans', mode: 'sandbox', client_key: ' SB-Mid-client ', server_key: ' s ', webhook_token: '' })
  assert.deepEqual(v, { provider: 'midtrans', mode: 'sandbox', client_key: 'SB-Mid-client', server_key: 's', webhook_token: '', clear_server_key: false })
  assert.equal(validatePaymentSettings({ provider: 'xendit', mode: 'production', clear_server_key: true }).clear_server_key, true)
  assert.throws(() => validatePaymentSettings({ provider: 'stripe', mode: 'sandbox' }), /Penyedia pembayaran tidak valid/)
  assert.throws(() => validatePaymentSettings({ provider: 'none', mode: 'live' }), /Mode tidak valid/)
  for (const k of ['client_key', 'server_key', 'webhook_token']) {
    assert.ok(validatePaymentSettings({ provider: 'none', mode: 'sandbox', [k]: 'a'.repeat(200) }))
    assert.throws(() => validatePaymentSettings({ provider: 'none', mode: 'sandbox', [k]: 'a'.repeat(201) }), (e) => e.validation && /maksimal 200 karakter/.test(e.message))
  }
})

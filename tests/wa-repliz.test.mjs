// Per-business integrations: WhatsApp (WAPilot / WAConsole) and Repliz. Pure rules, the provider clients against a
// fake fetch, and the Worker routes against real SQL (node:sqlite with every migration applied).
import './helpers/setup.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeD1 } from './helpers/d1-sqlite.mjs'
import { normalizePhone, maskPhone, capProblem, offerMessage, followUpMessage, validateText, WA_LIMITS, dayWib } from '../src/wa/rules.js'
import { validatePost, accountView, postLink, safeCallbackMessage, REPLIZ_PLATFORMS } from '../src/repliz/rules.js'
import { validateCredentials, INTEGRATIONS } from '../src/integrations/rules.js'
import { signConnectState, verifyConnectState } from '../src/repliz/state.js'
import { createWapilot, wapilotView } from '../worker/wa/wapilot.js'
import { createWaconsole, waconsoleView } from '../worker/wa/waconsole.js'
import { WaError, providerReady, sendText, status as providerStatus, verify, platformConfig, __resetStatusCache } from '../worker/wa/index.js'
import { handleWaSend, handleWaStatus, handleWaProvider } from '../worker/whatsapp.js'
import { handleIntegrationList, handleIntegrationPut, handleIntegrationDelete, loadCredentials, integrationsEnabled } from '../worker/integrations.js'
import { createRepliz, ReplizError, replizProblem } from '../worker/repliz-client.js'
import {
  handleReplizStatus, handleReplizSchedule, handleReplizSchedules, handleReplizComplete, handleReplizPick, handleReplizConnect,
  handleReplizAccounts, handleReplizAuthorize, handleReplizDisconnect, handleReplizCallback,
} from '../worker/repliz.js'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const ok = (data) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
const data = async (res) => (await res.json()).data
const DEMO = 'demo-ac@satualur.id'
const owner = { id: 'ua', email: 'a@usaha.id', name: 'Usaha A' }
const other = { id: 'ub', email: 'b@usaha.id', name: 'Usaha B' }
const demoUser = { id: 'ud', email: DEMO, name: 'Demo' }
const deps = (user, body, fetchImpl) => ({
  authenticate: async () => ({ user }), readJson: async () => body, ok, HttpError, DEMO_EMAILS: new Set([DEMO]), fetchImpl,
})
const rejects = (p, status, re) => assert.rejects(p, (e) => e.status === status && (!re || re.test(e.message)))
const TOKEN_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const ENV = { TOKEN_KEY, DEMO_OTP: 'false', PUBLIC_BASE_URL: 'https://app.example' }

// fetch fake: routes [method, urlRegex, response]; records calls (JSON bodies parsed).
function fakeFetch(routes) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null })
    const r = routes.find(([m, re]) => m === (init.method || 'GET') && re.test(String(url)))
    if (!r) return new Response(JSON.stringify({ code: 404, message: 'not found' }), { status: 404 })
    const res = r[2]
    if (res instanceof Error) throw res
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status || 200 })
  }
  fn.calls = calls
  return fn
}

async function envWith(extra = {}) {
  const DB = await makeD1()
  for (const [o, name, svc, phone] of [['ua', 'Pak Budi', 'Servis AC', '0812-3456-7890'], ['ua', 'Bu Sari', 'Cuci AC', ''], ['ub', 'Orang Lain', 'X', '081299998888'], ['ud', 'Demo', 'AC', '081211112222']]) {
    await DB.prepare('INSERT INTO requests (owner_id, customer_name, service_type, phone, status) VALUES (?, ?, ?, ?, ?)').bind(o, name, svc, phone, 'new').run()
  }
  return { DB, ...ENV, ...extra }
}
const WAPILOT_OK = [['GET', /\/me$/, { body: { status: 'active', days_left: 9, device_name: 'Dev' } }], ['GET', /\/status$/, { body: { online: true, whatsapp_connected: true } }], ['POST', /\/send$/, { body: { ok: true } }]]
async function connect(env, user, provider, fields, routes = WAPILOT_OK) {
  return data(await handleIntegrationPut({}, env, deps(user, fields, fakeFetch(routes)), { provider }))
}

/* ------------------------------------------------------------------ rules */

test('phone rules, cap and message templates', () => {
  for (const v of ['0812-3456-7890', '+62 812 3456 7890', '6281234567890', '812 3456 7890', '(0812) 3456.7890']) assert.equal(normalizePhone(v), '6281234567890', v)
  for (const v of ['', 'abc', '021555123', '+1 415 555 0100', '0812']) assert.equal(normalizePhone(v), null, v)
  assert.equal(maskPhone('6281234567890'), '62812*****890')
  assert.equal(capProblem({ user: 0 }), null)
  assert.match(capProblem({ user: WA_LIMITS.perUserDay }), /per hari/)
  assert.equal(validateText('  ').error, 'Isi pesan tidak boleh kosong.')
  assert.match(offerMessage({ customer: 'Budi', service: 'Servis AC', price: 1500000, terms: 'DP 50%', business: 'Usaha A' }), /Rp1\.500\.000[\s\S]*DP 50%/)
  assert.match(followUpMessage({ customer: 'Budi', business: 'Usaha A' }), /Usaha A/)
})

test('credential validation: required fields, formats, https-only base URL, last-4 hint', () => {
  assert.match(validateCredentials('wapilot', {}).error, /Token API wajib/)
  assert.match(validateCredentials('wapilot', { token: 'short' }).error, /tidak valid/)
  assert.match(validateCredentials('wapilot', { token: 'aica_0123456789abcdef', base_url: 'http://x.example' }).error, /tidak valid/)
  const v = validateCredentials('wapilot', { token: 'aica_0123456789abcdef', base_url: 'https://wa.example/' })
  assert.deepEqual(v, { secrets: { token: 'aica_0123456789abcdef' }, meta: { base_url: 'https://wa.example' }, hint: 'cdef' })
  const w = validateCredentials('waconsole', { app_key: 'app123', auth_key: 'auth9876', device_id: 'dev-1' })
  assert.deepEqual(w.meta, { device_id: 'dev-1' })
  assert.equal(w.hint, '9876')
  assert.match(validateCredentials('repliz', { access_key: '5873' }).error, /Secret key wajib/)
  assert.ok(Object.values(INTEGRATIONS).every((d) => d.help && d.url.startsWith('https://')))
})

/* ------------------------------------------------------------------ providers */

test('WAPilot client: token header; 202 / 401 / 402 / timeout become friendly errors; view hides owner data', async () => {
  const f = fakeFetch(WAPILOT_OK)
  await createWapilot({ token: 'tok' }, f).sendText('628123', 'hai')
  assert.equal(f.calls[0].headers['x-api-token'], 'tok')
  assert.deepEqual(f.calls[0].body, { command_type: 'send_text', receiver: '628123', text_content: 'hai' })
  for (const [status, re] of [[202, /belum merespons/], [401, /Token WAPilot ditolak/], [402, /Lisensi/], [500, /bermasalah/]]) {
    await assert.rejects(createWapilot({ token: 'tok' }, fakeFetch([['GET', /status/, { status, body: {} }]])).status(), (e) => e instanceof WaError && re.test(e.message))
  }
  const slow = createWapilot({ token: 'tok' }, async () => { const e = new Error('x'); e.name = 'AbortError'; throw e })
  await assert.rejects(slow.me(), (e) => e.status === 504)
  const v = wapilotView({ online: true, whatsapp_connected: true }, { device_name: 'Dev', days_left: 27, whatsapp_number: '6281234567890', email: 'x@y' })
  assert.equal(v.license.days_left, 27)
  assert.equal(v.device.number_masked, '62812*****890')
  assert.equal(JSON.stringify(v).includes('x@y'), false)
})

test('WAConsole client: keys in the body, success shape checked, failure, missing device id', async () => {
  const cfg = { app_key: 'app', auth_key: 'auth' }
  const okF = fakeFetch([['POST', /\/api\/create\/message$/, { body: { message_status: 'Success', data: { status_code: 200 } } }]])
  await sendText({ provider: 'waconsole', to: '628123', text: 'Halo' }, cfg, okF)
  assert.match(okF.calls[0].url, /^https:\/\/waconsole\.apipedia\.id\/api\/create\/message$/)
  assert.deepEqual(okF.calls[0].body, { appkey: 'app', authkey: 'auth', to: '628123', message: 'Halo' })
  await assert.rejects(createWaconsole(cfg, fakeFetch([['POST', /create/, { body: { message_status: 'Failed' } }]])).sendText('628', 'x'), /ditolak oleh layanan pengirim/)
  await assert.rejects(createWaconsole(cfg, fakeFetch([['POST', /create/, { status: 401, body: {} }]])).sendText('628', 'x'), /Kunci WAConsole ditolak/)
  __resetStatusCache()
  const none = fakeFetch([])
  const st = await providerStatus('waconsole', cfg, none, 'ua')
  assert.equal(none.calls.length, 0)
  assert.match(st.note, /status perangkat tidak tersedia/)
  assert.deepEqual(await verify('waconsole', cfg, none), { verified: false, note: 'Kunci disimpan. Tambahkan ID perangkat agar status perangkat bisa diperiksa.' })
  const sess = fakeFetch([['POST', /session\/status$/, { body: { success: true, data: { connected: true, authenticated: true, phone: '6281234567890' } } }]])
  const st2 = await providerStatus('waconsole', { ...cfg, device_id: 'dev1' }, sess, 'ub')
  assert.equal(sess.calls[0].body.device_id, 'dev1')
  assert.equal(st2.device.number_masked, '62812*****890')
  assert.equal(waconsoleView({ success: true, data: { connected: false } }).connected, false)
  await assert.rejects(sendText({ provider: 'waconsole', to: '628', text: 'x' }, {}, none), (e) => e.status === 503)
  assert.equal(providerReady('wapilot', {}), false)
  __resetStatusCache()
})

test('platform keys are used only when WA_PLATFORM_FALLBACK is "true"; DEMO_OTP gate', () => {
  const env = { WAPILOT_TOKEN: 'platform', WACONSOLE_APP_KEY: 'a', WACONSOLE_AUTH_KEY: 'b' }
  assert.equal(platformConfig('wapilot', env), null)
  assert.equal(platformConfig('wapilot', { ...env, WA_PLATFORM_FALLBACK: 'false' }), null)
  assert.equal(platformConfig('wapilot', { ...env, WA_PLATFORM_FALLBACK: 'true' }).token, 'platform')
  assert.equal(platformConfig('waconsole', { ...env, WA_PLATFORM_FALLBACK: 'true' }).auth_key, 'b')
  assert.equal(integrationsEnabled({ DEMO_OTP: 'true' }), false)
  assert.equal(integrationsEnabled({ DEMO_OTP: 'true', INTEGRATIONS_ALLOW_DEMO_OTP: 'true' }), true)
})

/* ------------------------------------------------------------------ credentials */

test('credentials: verified with a read-only call, encrypted at rest, never returned; demo and DEMO_OTP refused', async () => {
  const env = await envWith()
  const fields = { token: 'aica_0123456789abcdef' }
  await rejects(handleIntegrationPut({}, env, deps(demoUser, fields, fakeFetch(WAPILOT_OK)), { provider: 'wapilot' }), 403)
  await rejects(handleIntegrationPut({}, { ...env, DEMO_OTP: 'true' }, deps(owner, fields, fakeFetch(WAPILOT_OK)), { provider: 'wapilot' }), 503)
  await rejects(handleIntegrationPut({}, { ...env, TOKEN_KEY: '' }, deps(owner, fields, fakeFetch(WAPILOT_OK)), { provider: 'wapilot' }), 503, /Penyimpanan kunci/)
  await rejects(handleIntegrationPut({}, env, deps(owner, fields, fakeFetch([['GET', /\/me$/, { status: 401, body: {} }]])), { provider: 'wapilot' }), 400, /Kunci belum bisa dipakai: Token WAPilot ditolak/)
  assert.deepEqual(await connect(env, owner, 'wapilot', fields), { provider: 'wapilot', connected: true, hint: 'cdef', verified: true, note: null })
  const row = await env.DB.prepare("SELECT secret_enc FROM integration_credentials WHERE owner_id = 'ua'").first()
  assert.equal(row.secret_enc.includes('aica_'), false, 'encrypted at rest')
  const list = await data(await handleIntegrationList({}, env, deps(owner, {})))
  assert.equal(JSON.stringify(list).includes('aica_0123'), false, 'secret never returned')
  assert.deepEqual(list.items.map((i) => [i.provider, i.connected, i.hint]), [['wapilot', true, 'cdef'], ['waconsole', false, ''], ['repliz', false, '']])
  assert.equal((await loadCredentials(env, 'ua', 'wapilot')).token, 'aica_0123456789abcdef')
  assert.equal(await loadCredentials(env, 'ub', 'wapilot'), null, 'other businesses see nothing')
  await handleIntegrationDelete({}, env, deps(owner, {}), { provider: 'wapilot' })
  assert.equal(await loadCredentials(env, 'ua', 'wapilot'), null)
})

/* ------------------------------------------------------------------ WhatsApp routes */

test('send: business own keys; request phone or typed number; logged with provider; daily cap; failures logged', async () => {
  const env = await envWith()
  await rejects(handleWaSend({}, env, deps(owner, { request_id: 1, text: 'Halo' }, fakeFetch(WAPILOT_OK))), 409, /belum dihubungkan/)
  await connect(env, owner, 'wapilot', { token: 'aica_0123456789abcdef' })
  const f = fakeFetch(WAPILOT_OK)
  const out = await data(await handleWaSend({}, env, deps(owner, { request_id: 1, text: 'Halo Pak', kind: 'offer' }, f)))
  assert.deepEqual(out, { status: 'sent', to: '62812*****890', provider: 'wapilot' })
  assert.equal(f.calls[0].headers['x-api-token'], 'aica_0123456789abcdef', "the business's own token")
  assert.equal(f.calls[0].body.receiver, '6281234567890')
  assert.equal((await data(await handleWaSend({}, env, deps(owner, { phone: '0813 1111 2222', text: 'Halo', kind: 'test' }, f)))).to, '62813*****222')
  await rejects(handleWaSend({}, env, deps(owner, { request_id: 3, text: 'x' }, f)), 404) // another business's request
  await rejects(handleWaSend({}, env, deps(owner, { request_id: 2, text: 'x' }, f)), 400, /tujuan/)
  await rejects(handleWaSend({}, env, deps(owner, { phone: '12345', text: 'x' }, f)), 400)
  const log = await env.DB.prepare("SELECT provider, kind, status, phone_masked FROM wa_messages WHERE owner_id = 'ua' ORDER BY id").all()
  assert.deepEqual(log.results.map((r) => [r.provider, r.kind, r.status]), [['wapilot', 'offer', 'sent'], ['wapilot', 'test', 'sent']])
  assert.equal(JSON.stringify(log.results).includes('6281234567890'), false, 'raw number not stored')
  await env.DB.prepare("UPDATE usage_counters SET count = ? WHERE user_id = 'ua' AND feature = 'wa_send' AND period = ?").bind(WA_LIMITS.perUserDay, dayWib()).run()
  await rejects(handleWaSend({}, env, deps(owner, { request_id: 1, text: 'x' }, f)), 429, /per hari/)
  await env.DB.prepare('DELETE FROM usage_counters').run()
  await rejects(handleWaSend({}, env, deps(owner, { request_id: 1, text: 'x' }, fakeFetch([['POST', /\/send$/, { status: 202, body: {} }]]))), 503, /belum merespons/)
  assert.equal((await env.DB.prepare("SELECT status FROM wa_messages WHERE owner_id = 'ua' ORDER BY id DESC").first()).status, 'failed')
})

test('send: demo accounts are simulated and never reach a provider, even with the platform fallback on', async () => {
  const env = await envWith({ WA_PLATFORM_FALLBACK: 'true', WAPILOT_TOKEN: 'platform-token' })
  const f = fakeFetch(WAPILOT_OK)
  const out = await data(await handleWaSend({}, env, deps(demoUser, { request_id: 4, text: 'x' }, f)))
  assert.equal(out.status, 'simulated')
  assert.equal(f.calls.length, 0)
})

test('provider choice: only connected providers; sends go through the chosen one; status per business', async () => {
  const env = await envWith()
  await connect(env, owner, 'wapilot', { token: 'aica_0123456789abcdef' })
  await rejects(handleWaProvider({}, env, deps(owner, { provider: 'waconsole' })), 409, /Hubungkan akun WAConsole/)
  await connect(env, owner, 'waconsole', { app_key: 'app123', auth_key: 'auth9876' }, [])
  await handleWaProvider({}, env, deps(owner, { provider: 'waconsole' }))
  await rejects(handleWaProvider({}, env, deps(demoUser, { provider: 'waconsole' })), 403)
  const f = fakeFetch([['POST', /\/api\/create\/message$/, { body: { message_status: 'Success', data: { status_code: 200 } } }]])
  assert.equal((await data(await handleWaSend({}, env, deps(owner, { request_id: 1, text: 'Halo' }, f)))).provider, 'waconsole')
  assert.deepEqual(f.calls[0].body, { appkey: 'app123', authkey: 'auth9876', to: '6281234567890', message: 'Halo' })
  __resetStatusCache()
  const st = await data(await handleWaStatus({}, env, deps(owner, {}, fakeFetch([]))))
  assert.deepEqual([st.provider, st.configured], ['waconsole', true])
  assert.deepEqual(st.providers.map((p) => [p.key, p.connected]), [['wapilot', true], ['waconsole', true]])
  assert.equal((await data(await handleWaStatus({}, env, deps(other, {}, fakeFetch([]))))).configured, false)
  __resetStatusCache()
})

/* ------------------------------------------------------------------ Repliz */

test('validatePost: per-platform types, media counts, https, titles, Threads length, Pinterest board', () => {
  const now = Date.parse('2026-11-03T10:00:00Z')
  assert.match(validatePost('instagram', { type: 'text', description: 'hai' }, now).error, /tidak mendukung/)
  assert.match(validatePost('youtube', { type: 'video', medias: [{ url: 'https://x/v.mp4' }] }, now).error, /judul/)
  assert.match(validatePost('threads', { type: 'text', description: 'a'.repeat(501) }, now).error, /500/)
  assert.match(validatePost('facebook', { type: 'image', medias: [{ url: 'http://x/a.jpg' }] }, now).error, /https/)
  assert.match(validatePost('instagram', { type: 'album', medias: [{ url: 'https://x/1.jpg' }] }, now).error, /2–5/)
  assert.match(validatePost('pinterest', { type: 'image', medias: [{ url: 'https://x/1.jpg' }] }, now).error, /papan/)
  assert.match(validatePost('facebook', { type: 'text', description: 'x', scheduleAt: '2026-11-03T09:00:00Z' }, now).error, /lewat/)
  const yt = validatePost('youtube', { type: 'video', title: 'Demo', description: 'd', medias: [{ url: 'https://x/v.mp4' }], privacy: 'unlisted' }, now)
  assert.equal(yt.post.additionalInfo.privacy, 'unlisted')
  assert.equal(yt.post.scheduleAt, new Date(now).toISOString(), 'default: now')
  assert.equal(postLink('youtube', 'abc'), 'https://youtu.be/abc')
  assert.equal(safeCallbackMessage('<script>'), 'Koneksi gagal, coba lagi.')
  assert.equal(accountView({ _id: 'a1', type: 'tiktok', picture: 'http://insecure' }).picture, '')
  assert.ok(Object.values(REPLIZ_PLATFORMS).every((p) => p.types.length))
})

test('connect state: signed, bound to platform, expires, tamper-proof', async () => {
  const s = await signConnectState({ ownerId: 'ua', platform: 'instagram', reconnect: null, nonce: 'n', exp: Date.now() + 1000 }, 'secret')
  assert.deepEqual(await verifyConnectState(s, 'secret', 'instagram'), { ownerId: 'ua', platform: 'instagram', reconnect: null })
  assert.equal(await verifyConnectState(s, 'secret', 'tiktok'), null)
  assert.equal(await verifyConnectState(s, 'other', 'instagram'), null)
  assert.equal(await verifyConnectState(s, 'secret', 'instagram', Date.now() + 5000), null)
  const [p, sig] = s.split('.')
  assert.equal(await verifyConnectState(`${p}x.${sig}`, 'secret', 'instagram'), null)
})

test('Repliz client: Basic auth with the business keys; 401 / 402 / timeout mapped', async () => {
  const f = fakeFetch([['GET', /\/account\/count$/, { body: { total: 1, limit: 1 } }]])
  await createRepliz({ access_key: 'ak', secret_key: 'sk' }, f).count()
  assert.equal(f.calls[0].headers.authorization, `Basic ${btoa('ak:sk')}`)
  for (const [status, msg, re] of [[401, '', /Kunci Repliz ditolak/], [402, 'upgrade to get more storage', /Penyimpanan media/], [402, 'upgrade', /paket Repliz/]]) {
    await assert.rejects(createRepliz({ access_key: 'a', secret_key: 'b' }, fakeFetch([['GET', /count/, { status, body: { message: msg } }]])).count(), (e) => e instanceof ReplizError && re.test(e.message))
  }
  await assert.rejects(createRepliz({ access_key: 'a', secret_key: 'b' }, async () => { const e = new Error('x'); e.name = 'AbortError'; throw e }).count(), (e) => e.status === 504)
  assert.match(replizProblem(402, 'upgrade to get more storage'), /Penyimpanan/)
})

const BASIC = `Basic ${btoa('1234567890:secret-abcdef-123')}`
async function replizEnv() {
  const env = await envWith()
  await connect(env, owner, 'repliz', { access_key: '1234567890', secret_key: 'secret-abcdef-123' }, [['GET', /\/me\/addon$/, { body: { account: 0 } }]])
  return env
}
const cookieFor = async (platform, ownerId = 'ua') => `__Host-repliz_state=${await signConnectState({ ownerId, platform, reconnect: null, nonce: 'n', exp: Date.now() + 60000 }, TOKEN_KEY)}`
const req = (cookie) => ({ headers: new Headers(cookie ? { cookie } : {}), url: 'https://app.example/api/x' })

test('Repliz status and accounts use the business own workspace; without keys -> not configured / 409', async () => {
  const env = await replizEnv()
  assert.equal((await data(await handleReplizStatus({}, env, deps(other, {}, fakeFetch([]))))).configured, false)
  await rejects(handleReplizAccounts({}, env, deps(other, {}, fakeFetch([]))), 409, /Hubungkan akun Repliz/)
  const f = fakeFetch([
    ['GET', /\/account\/count$/, { body: { total: 2, limit: 1 } }],
    ['GET', /\/account\?limit=100$/, { body: { docs: [{ _id: 'acc1', type: 'instagram', username: 'usaha.a', isConnected: true }, { _id: 'acc2', type: 'whatsapp' }, { _id: 'acc3', type: 'tiktok', isConnected: false }] } }],
  ])
  assert.deepEqual((await data(await handleReplizStatus({}, env, deps(owner, {}, f)))).capacity, { used: 2, limit: 1 })
  assert.equal(f.calls[0].headers.authorization, BASIC)
  const list = await data(await handleReplizAccounts({}, env, deps(owner, {}, f)))
  assert.deepEqual(list.map((a) => [a.id, a.platform, a.needs_reconnect]), [['acc1', 'instagram', false], ['acc3', 'tiktok', true]])
})

test('authorize + complete (code flow): fixed redirect per platform, signed cookie names the owner', async () => {
  const env = await replizEnv()
  const f = fakeFetch([
    ['GET', /\/account\/instagram\/authorize/, { body: { url: 'https://www.instagram.com/oauth/authorize?x=1' } }],
    ['POST', /\/account\/instagram\/connect$/, { body: { accountId: 'acc111' } }],
    ['GET', /\/account\/acc111$/, { body: { _id: 'acc111', type: 'instagram', username: 'usaha.a', isConnected: true } }],
  ])
  await rejects(handleReplizAuthorize(req(), env, deps(demoUser, { platform: 'instagram' }, f)), 403)
  const res = await handleReplizAuthorize(req(), env, deps(owner, { platform: 'instagram' }, f))
  assert.equal(new URL(f.calls[0].url).searchParams.get('redirect'), 'https://app.example/api/social/repliz/callback/instagram')
  assert.match(res.headers.get('set-cookie'), /^__Host-repliz_state=[^;]+; HttpOnly; Secure; SameSite=Lax/)
  await rejects(handleReplizComplete(req(), env, deps(null, { code: 'c' }, f), { platform: 'instagram' }), 401)
  await rejects(handleReplizComplete(req(await cookieFor('tiktok')), env, deps(null, { code: 'c' }, f), { platform: 'instagram' }), 401)
  const done = await handleReplizComplete(req(await cookieFor('instagram')), env, deps(null, { code: 'c' }, f), { platform: 'instagram' })
  assert.equal((await data(done)).connected.username, 'usaha.a')
  assert.match(done.headers.get('set-cookie'), /Max-Age=0/, 'state is one-shot')
  assert.equal(f.calls.find((c) => /connect$/.test(c.url)).headers.authorization, BASIC)
  await rejects(handleReplizComplete(req(await cookieFor('instagram', 'ub')), env, deps(null, { code: 'c' }, f), { platform: 'instagram' }), 409)
})

test('complete (exchange flow): several pages -> encrypted pick without tokens -> connect the chosen one', async () => {
  const env = await replizEnv()
  const f = fakeFetch([
    ['POST', /\/account\/facebook\/exchange$/, { body: { token: 'user-token' } }],
    ['GET', /\/account\/facebook\/page/, { body: { docs: [{ id: 'p1', name: 'Halaman 1', token: 'page-1-token' }, { id: 'p2', name: 'Halaman 2', token: 'page-2-token' }] } }],
    ['POST', /\/account\/facebook\/connect$/, { body: { accountId: 'fb222' } }],
    ['GET', /\/account\/fb222$/, { body: { _id: 'fb222', type: 'facebook', name: 'Halaman 2', isConnected: true } }],
  ])
  const out = await data(await handleReplizComplete(req(await cookieFor('facebook')), env, deps(null, { code: 'fragment-token' }, f), { platform: 'facebook' }))
  assert.match(out.pick, /^[0-9a-f]{32}$/)
  const blob = await env.DB.prepare('SELECT blob FROM social_oauth_picks WHERE id = ?').bind(out.pick).first()
  assert.equal(blob.blob.includes('page-1-token'), false, 'pick is encrypted')
  const pick = await data(await handleReplizPick({}, env, deps(owner, {}), { id: out.pick }))
  assert.deepEqual(pick.entities.map((e) => e.id), ['p1', 'p2'])
  assert.equal(JSON.stringify(pick).includes('token'), false, 'tokens never reach the browser')
  await rejects(handleReplizPick({}, env, deps(other, {}), { id: out.pick }), 404)
  assert.equal((await data(await handleReplizConnect({}, env, deps(owner, { pick: out.pick, entity_id: 'p2' }, f)))).connected.id, 'fb222')
  assert.deepEqual(f.calls.find((c) => /connect$/.test(c.url)).body, { pageId: 'p2', token: 'page-2-token' })
})

test('schedule: account must exist in the business workspace; validated; history per business; disconnect', async () => {
  const env = await replizEnv()
  const f = fakeFetch([
    ['GET', /\/account\/thr111$/, { body: { _id: 'thr111', type: 'threads', username: 'usaha.a', isConnected: true } }],
    ['POST', /\/schedule$/, { body: { scheduleId: 'sch111' } }],
    ['GET', /\/schedule\/sch111$/, { body: { status: 'success', postId: 'POST9' } }],
    ['DELETE', /\/account\/thr111$/, { status: 204 }],
  ])
  await rejects(handleReplizSchedule({}, env, deps(owner, { account_id: 'nope99', type: 'text', description: 'hai' }, f)), 404)
  await rejects(handleReplizSchedule({}, env, deps(owner, { account_id: 'thr111', type: 'video', description: 'hai' }, f)), 400)
  const row = await data(await handleReplizSchedule({}, env, deps(owner, { account_id: 'thr111', type: 'text', description: 'Promo minggu ini' }, f)))
  assert.deepEqual([row.status, row.account_label], ['pending', '@usaha.a'])
  const sent = f.calls.find((c) => c.method === 'POST' && /\/schedule$/.test(c.url)).body
  assert.equal(sent.accountId, 'thr111')
  assert.deepEqual(sent.replies, [])
  const list = await data(await handleReplizSchedules({}, env, deps(owner, {}, f)))
  assert.deepEqual([list[0].status, list[0].link], ['success', 'https://www.threads.net/@usaha.a/post/POST9'])
  assert.equal((await data(await handleReplizSchedules({}, env, deps(other, {}, f)))).length, 0)
  await handleReplizDisconnect({}, env, deps(owner, {}, f), { id: 'thr111' })
  assert.ok(f.calls.some((c) => c.method === 'DELETE' && /\/account\/thr111$/.test(c.url)))
})

test('callback page reads the code from the query or the fragment and never embeds it', async () => {
  const res = handleReplizCallback({ url: 'https://app.example/api/social/repliz/callback/facebook?code=SECRET' }, {}, { platform: 'facebook' })
  const html = await res.text()
  assert.match(res.headers.get('content-security-policy'), /script-src 'nonce-/)
  assert.equal(html.includes('SECRET'), false)
  assert.match(html, /access_token/)
})

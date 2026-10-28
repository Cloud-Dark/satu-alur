// Integration tests (no network): app modules loaded through Vite's SSR loader with
// VITE_USE_MOCK=true, so src/cloud.js resolves to the mock cloud exactly as in
// `npm run dev`. The LLM / database of that single cloud instance are swapped per
// test to exercise the real code paths (approach adapted from zul-pr6:tests/ai-integration.test.mjs).
import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import './helpers/setup.mjs'

let server
let cloud
let mod = {}
let realCreate
let realDatabase

before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('true') },
  })
  const load = (p) => server.ssrLoadModule(p)
  const { getCloud, isUsingMockCloud } = await load('/src/cloud.js')
  cloud = getCloud()
  assert.equal(isUsingMockCloud(), true)
  realCreate = cloud.llm.chat.completions.create
  realDatabase = cloud.database
  mod = {
    agent: await load('/src/ai/agent.js'),
    social: await load('/src/ai/social-agent.js'),
    advisor: await load('/src/ai/advisor.js'),
    data: await load('/src/stages/data.js'),
    auth: await load('/src/auth/auth.js'),
  }
})
after(async () => { await server?.close() })
afterEach(() => {
  cloud.llm.chat.completions.create = realCreate
  cloud.database = realDatabase
})

/** Fake streaming LLM: records the call and yields `text` in small pieces (or throws). */
function fakeLLM(script) {
  const calls = []
  cloud.llm.chat.completions.create = function (opts) {
    calls.push(opts)
    const step = typeof script === 'function' ? script(calls.length, opts) : script
    return (async function* () {
      if (step instanceof Error) throw step
      const { text = '', failAfter } = typeof step === 'string' ? { text: step } : step
      for (let i = 0; i < text.length; i += 7) yield { choices: [{ delta: { content: text.slice(i, i + 7) } }] }
      if (failAfter) throw failAfter
    })()
  }
  return calls
}
const drain = async (gen) => {
  const events = []
  while (true) {
    const r = await gen.next()
    if (r.done) return { events, result: r.value }
    events.push(r.value)
  }
}

/* --------------------------------------------------------------- mock auth */

test('mock auth: OTP send -> wrong code rejected -> right code signs in; demo login', async () => {
  let code
  const onOtp = (e) => { code = e.detail.code }
  window.addEventListener('mock-otp-sent', onOtp)
  await mod.auth.sendEmailCode('qa@usaha.id')
  window.removeEventListener('mock-otp-sent', onOtp)
  assert.match(code, /^\d{6}$/)
  const wrong = code.split('').map((d) => String((+d + 1) % 10)).join('')
  await assert.rejects(mod.auth.submitEmailOtp('qa@usaha.id', wrong), /Kode OTP salah/)
  await assert.rejects(mod.auth.submitEmailOtp('lain@usaha.id', code), /Minta kode OTP untuk email ini terlebih dahulu/)
  const { user } = await mod.auth.submitEmailOtp('qa@usaha.id', code)
  assert.equal(user.email, 'qa@usaha.id')
  assert.equal((await mod.auth.getSession()).data.user.email, 'qa@usaha.id')
  // the code is single-use
  await assert.rejects(mod.auth.submitEmailOtp('qa@usaha.id', code), /Minta kode OTP/)
  await mod.auth.signOut()
  assert.equal((await mod.auth.getSession()).data, null)
  const demo = await mod.auth.loginWithDemo('demo-pest@satualur.id')
  assert.equal(demo.user.email, 'demo-pest@satualur.id')
  await mod.auth.signOut()
})

/* ---------------------------------------------------- data.js loadFlow paging */

test('loadFlow: keyset paging past 5000 rows, newest first, shared cache, invalidated on change', async () => {
  const requests = Array.from({ length: 5003 }, (_, i) => ({ id: i + 1, customer_name: `P${i + 1}`, created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }))
  const queries = []
  cloud.database = {
    from(table) {
      const q = { table, filters: [] }
      const b = {
        select() { return b },
        gt(col, val) { q.filters.push(['gt', col, val]); return b },
        order(col, o) { q.order = [col, o.ascending]; return b },
        limit(n) { q.limit = n; return b },
        then(resolve) {
          queries.push(q)
          let rows = table === 'requests' ? requests : []
          const gt = q.filters.find((f) => f[0] === 'gt')
          if (gt) rows = rows.filter((r) => r.id > gt[2])
          return Promise.resolve({ data: rows.slice(0, q.limit), error: null }).then(resolve)
        },
      }
      return b
    },
  }
  window.dispatchEvent(new CustomEvent('satualur:data-changed')) // clear cache from other tests
  const m = await mod.data.loadFlow()
  const reqQ = queries.filter((q) => q.table === 'requests')
  assert.equal(reqQ.length, 2)
  assert.deepEqual(reqQ[0].filters, [])
  assert.deepEqual(reqQ[1].filters, [['gt', 'id', 5000]])
  assert.deepEqual(reqQ[0].order, ['id', true])
  assert.equal(reqQ[0].limit, 5000)
  assert.equal(m.requests.length, 5003)
  assert.equal(m.requests[0].id, 5003, 'newest first')
  assert.equal(queries.length, 6) // 2 pages of requests + 4 other tables

  await mod.data.loadFlow()
  assert.equal(queries.length, 6, 'second load within 15 s served from cache')
  window.dispatchEvent(new CustomEvent('satualur:db-write'))
  await mod.data.loadFlow(['requests'])
  assert.equal(queries.length, 8, 'write event clears cache')
})

test('loadFlow: database error surfaces in Indonesian and is not cached', async () => {
  let n = 0
  cloud.database = { from: () => { const b = { select: () => b, gt: () => b, order: () => b, limit: () => b, then: (res) => { n++; return Promise.resolve({ data: null, error: { message: 'Batas penulisan harian database tercapai.' } }).then(res) } }; return b } }
  window.dispatchEvent(new CustomEvent('satualur:data-changed'))
  await assert.rejects(mod.data.loadFlow(['requests']), /Gagal memuat requests: Batas penulisan harian/)
  await assert.rejects(mod.data.loadFlow(['requests']))
  assert.equal(n, 2)
})

/* --------------------------------------------------------- offer agent */

test('generateOffer: streams, sends JSON schema, normalises the result', async () => {
  const calls = fakeLLM('Ini hasilnya: {"ruang_lingkup": "Cuci 3 unit AC split", "harga": "Rp 450.000", "terms": "Bayar setelah selesai, garansi 7 hari", "notes": "-",}')
  const chunks = []
  const offer = await mod.agent.generateOffer({ request: { customer_name: 'Bu Sari', service_type: 'Cuci AC' }, modelId: 'm1', onChunk: (d) => chunks.push(d) })
  assert.deepEqual(offer, { scope: 'Cuci 3 unit AC split', price: 450000, terms: 'Bayar setelah selesai, garansi 7 hari', notes: '-' })
  assert.ok(chunks.length > 3, 'onChunk called per delta')
  assert.equal(calls[0].model, 'm1')
  assert.equal(calls[0].stream, true)
  assert.equal(calls[0].response_format.type, 'json_schema')
  assert.deepEqual(calls[0].response_format.json_schema.required, ['scope', 'price', 'terms', 'notes'])
  assert.match(calls[0].messages[0].content, /HANYA satu objek JSON/)
  assert.match(calls[0].messages[1].content, /^Permintaan jasa:\n/)
})

test('generateOffer: non-JSON reply and transport errors give Indonesian messages; abort passes through', async () => {
  fakeLLM('Maaf, saya tidak bisa membuat penawaran.')
  await assert.rejects(mod.agent.generateOffer({ request: {}, modelId: 'm' }), /Respons AI bukan JSON yang valid/)
  fakeLLM(new Error('HTTP 502'))
  await assert.rejects(mod.agent.generateOffer({ request: {}, modelId: 'm' }), /Gagal menghasilkan penawaran: HTTP 502/)
  fakeLLM(new DOMException('Dibatalkan', 'AbortError'))
  await assert.rejects(mod.agent.generateOffer({ request: {}, modelId: 'm' }), { name: 'AbortError' })
})

test('generateOffer with the built-in mock LLM returns a valid offer', async () => {
  const { validateOffer } = await server.ssrLoadModule('/src/domain/rules.js')
  const offer = await mod.agent.generateOffer({ request: { customer_name: 'X', service_type: 'Servis AC', location: 'Bekasi' }, modelId: 'mock-gpt-4o' })
  assert.equal(validateOffer(offer).valid, true, JSON.stringify(offer))
})

test('explainReport streams the full text', async () => {
  fakeLLM('<h3>Ringkasan</h3><p>Laba naik.</p>')
  const html = await mod.agent.explainReport({ report: { revenue: 1 }, modelId: 'm' })
  assert.equal(html, '<h3>Ringkasan</h3><p>Laba naik.</p>')
})

/* --------------------------------------------------------- social agent */

test('social generateContent: inline hashtags move out of the body, tagged prompt', async () => {
  const calls = fakeLLM(JSON.stringify({ judul: 'AC dingin lagi', body: 'Servis AC hari ini #servisac\n\n\n\nHubungi kami #Bekasi', hashtags: ['#ServisAC', 'acbersih'], catatan: 'Pakai foto sebelum-sesudah' }))
  const { data } = await mod.social.generateContent({ platform: 'instagram', type: 'caption', topic: 'Servis AC', tone: 'santai', modelId: 'm' })
  assert.equal(data.title, 'AC dingin lagi')
  assert.equal(data.body, 'Servis AC hari ini\n\nHubungi kami')
  assert.deepEqual(data.hashtags, ['#ServisAC', '#acbersih', '#Bekasi'])
  assert.equal(data.notes, 'Pakai foto sebelum-sesudah')
  assert.match(calls[0].messages[0].content, /^\[agent:social\] \[task:content\]/)
  assert.equal(calls[0].response_format.type, 'json_schema')
})

test('social: business context block uses real aggregated data only', async () => {
  const calls = fakeLLM('{"hashtags":["#a"]}')
  await mod.social.generateHashtags({ topic: 'Cuci sofa', business: { services: [{ name: 'Cuci sofa', count: 12 }], areas: [{ name: 'Bandung' }] }, modelId: 'm' })
  assert.match(calls[0].messages[1].content, /Cuci sofa \(12 permintaan\)/)
  assert.match(calls[0].messages[1].content, /Area pelanggan: Bandung/)
})

test('social brainstormIdeas: synonyms normalised, count clamped 3..20, empty ideas dropped', async () => {
  const calls = fakeLLM(JSON.stringify({ ide: [{ judul: 'Tips filter', format: 'Reels', hook: 'Stop!', konsep: 'Cara cek filter' }, { format: 'x' }, 'bukan objek'] }))
  const { data } = await mod.social.brainstormIdeas({ topic: 'AC', platform: 'all', count: 99, modelId: 'm' })
  assert.deepEqual(data.ideas, [{ title: 'Tips filter', format: 'Reels', hook: 'Stop!', concept: 'Cara cek filter' }])
  assert.match(calls[0].messages[1].content, /Jumlah ide: 20/)
})

test('social planMetaAds: audience fallbacks and string lists', async () => {
  fakeLLM(JSON.stringify({ demographics: { age_min: 28, age_max: 50, interests: 'Rumah, Keluarga' }, placements: ['Reels'], best_posting_times: '19.00', ad_copies: [{ headline: 'H', text: 'T', cta: 'Kirim Pesan' }], hashtags: 'servisac bekasi', tips: [{ a: 'Uji', b: '7 hari' }] }))
  const { data } = await mod.social.planMetaAds({ service: 'Servis AC', budget: 100000, modelId: 'm' })
  assert.equal(data.audience.age_range, '28–50')
  assert.deepEqual(data.audience.interests, ['Rumah', 'Keluarga'])
  assert.equal(data.schedule, '19.00')
  assert.deepEqual(data.ad_copies, [{ headline: 'H', primary_text: 'T', cta: 'Kirim Pesan' }])
  assert.deepEqual(data.tips, ['Uji — 7 hari'])
})

test('social: reply without substance or not JSON -> data null, raw text kept', async () => {
  fakeLLM('{"body": ""}')
  const empty = await mod.social.generateContent({ topic: 'x', modelId: 'm' })
  assert.equal(empty.data, null)
  fakeLLM('```\nCaption bebas tanpa JSON\n```')
  const raw = await mod.social.generateContent({ topic: 'x', modelId: 'm' })
  assert.equal(raw.data, null)
  assert.equal(raw.raw, 'Caption bebas tanpa JSON')
  fakeLLM('')
  await assert.rejects(mod.social.generateContent({ topic: 'x', modelId: 'm' }), /AI tidak mengembalikan teks/)
  fakeLLM(new Error('HTTP 500'))
  await assert.rejects(mod.social.generateContent({ topic: 'x', modelId: 'm' }), /AI gagal merespons: HTTP 500/)
})

/* --------------------------------------------------------- advisor stream */

test('advisor streamAnswer: retries once on 5xx before any text', async () => {
  const calls = fakeLLM((n) => (n === 1 ? new Error('HTTP 502') : 'Jawaban kedua'))
  const { events, result } = await drain(mod.advisor.streamAnswer({ messages: [], model: 'm' }))
  assert.equal(calls.length, 2)
  assert.equal(events[0].type, 'retry')
  assert.equal(result.full, 'Jawaban kedua')
  assert.equal(result.retried, true)
  assert.ok(result.latency >= 0)
})

test('advisor streamAnswer: no retry after partial text or on 4xx; keeps partial on error', async () => {
  const calls = fakeLLM({ text: 'Jawaban parsial', failAfter: new Error('HTTP 502') })
  await assert.rejects(drain(mod.advisor.streamAnswer({ messages: [], model: 'm' })), (err) => err.partial === 'Jawaban parsial')
  assert.equal(calls.length, 1)
  const calls2 = fakeLLM(new Error('HTTP 400'))
  await assert.rejects(drain(mod.advisor.streamAnswer({ messages: [], model: 'm' })), /HTTP 400/)
  assert.equal(calls2.length, 1)
})

test('advisor streamAnswer: aborted signal stops with AbortError', async () => {
  const ctrl = new AbortController()
  ctrl.abort()
  fakeLLM('tidak dipakai')
  await assert.rejects(drain(mod.advisor.streamAnswer({ messages: [], model: 'm', signal: ctrl.signal })), { name: 'AbortError' })
})

test('advisor memory: save, load (oldest first), clear per agent (mock D1)', async () => {
  await mod.advisor.clearMessages(['keuangan', 'pemasaran'])
  await mod.advisor.saveMessage({ agent: 'keuangan', role: 'user', content: 'Q1' })
  await new Promise((r) => setTimeout(r, 5))
  await mod.advisor.saveMessage({ agent: 'keuangan', role: 'assistant', content: 'A1', model: 'm', latency_ms: 10 })
  // Mock ids are random, so ordering only holds across distinct timestamps (D1 ids are monotonic).
  await new Promise((r) => setTimeout(r, 5))
  await mod.advisor.saveMessage({ agent: 'pemasaran', role: 'user', content: 'Q2' })
  let { rows } = await mod.advisor.loadMessages()
  const mine = rows.filter((r) => ['Q1', 'A1', 'Q2'].includes(r.content))
  assert.deepEqual(mine.map((r) => r.content), ['Q1', 'A1', 'Q2'])
  await mod.advisor.clearMessages(['keuangan', 'tidak-ada'])
  ;({ rows } = await mod.advisor.loadMessages())
  assert.deepEqual(rows.filter((r) => r.agent === 'keuangan'), [])
  assert.equal(rows.filter((r) => r.content === 'Q2').length, 1)
  await mod.advisor.clearMessages(['pemasaran'])
})

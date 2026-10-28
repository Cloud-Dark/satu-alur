// Unit tests: src/ai/advisor.js pure parts (router, messages, retry policy, analytics).
// streamAnswer() retry/abort is covered in tests/ai-integration.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

const A = await import('../src/ai/advisor.js')

test('five agents with suggestions', () => {
  assert.deepEqual(A.AGENT_KEYS, ['konsultan', 'keuangan', 'pertumbuhan', 'pemasaran', 'operasional'])
  for (const k of A.AGENT_KEYS) assert.ok(A.AGENTS[k].suggestions.length >= 3, k)
  assert.equal(A.agentName('keuangan'), 'Analis keuangan')
  assert.equal(A.agentName('nope'), 'Penasihat')
})

test('routeQuestion: keyword routing', () => {
  assert.equal(A.routeQuestion('Bagaimana naik 2% bulan depan?').key, 'pertumbuhan')
  assert.equal(A.routeQuestion('Biaya mana yang paling bisa dihemat?').key, 'keuangan')
  assert.equal(A.routeQuestion('Promosi murah apa yang cocok di Instagram?').key, 'pemasaran')
  assert.equal(A.routeQuestion('Buatkan SOP singkat untuk tim lapangan').key, 'operasional')
  assert.equal(A.routeQuestion('Apa prioritas bisnis saya bulan ini?').key, 'konsultan')
  const r = A.routeQuestion('Berapa margin ideal?')
  assert.equal(r.reason, 'keyword')
  assert.deepEqual(r.hits, ['margin'])
})

test('routeQuestion: short keywords match whole words only', () => {
  // "kas" must not fire inside "kasih"
  assert.notEqual(A.routeQuestion('terima kasih').key, 'keuangan')
  assert.equal(A.routeQuestion('arus kas saya').key, 'keuangan')
})

test('routeQuestion: follow-up keeps previous agent, otherwise default', () => {
  assert.deepEqual(A.routeQuestion('lalu?', { lastAgent: 'pemasaran' }), { key: 'pemasaran', reason: 'follow-up', hits: [] })
  assert.deepEqual(A.routeQuestion('lalu?', { lastAgent: 'hilang' }), { key: 'konsultan', reason: 'default', hits: [] })
  assert.equal(A.routeQuestion('').key, 'konsultan')
})

test('describeRoute', () => {
  assert.equal(A.describeRoute({ reason: 'keyword', hits: ['naik', '%'] }), 'Dipilih otomatis dari kata "naik", "%"')
  assert.equal(A.describeRoute({ reason: 'follow-up' }), 'Melanjutkan percakapan sebelumnya')
  assert.equal(A.describeRoute({ reason: 'default' }), 'Dipilih otomatis sebagai penasihat umum')
  assert.equal(A.describeRoute(null), '')
})

test('systemPrompt tags the agent and embeds context', () => {
  const p = A.systemPrompt('keuangan', '[DATA BISNIS PENGGUNA] x')
  assert.match(p, /^\[agent:keuangan\]\n/)
  assert.match(p, /\[DATA BISNIS PENGGUNA\] x$/)
  assert.match(A.systemPrompt('unknown'), /Data belum dimuat/)
})

test('toHistory: only non-empty user/assistant turns, last N, trimmed', () => {
  const rows = [
    { role: 'user', content: 'a' }, { role: 'assistant', content: '' }, { role: 'system', content: 's' },
    { role: 'assistant', content: 'x'.repeat(5000) }, { role: 'user', content: 'b' },
  ]
  const h = A.toHistory(rows)
  assert.deepEqual(h.map((r) => r.role), ['user', 'assistant', 'user'])
  assert.equal(h[1].content.length, 3000)
  assert.equal(A.toHistory(rows, 1).length, 1)
})

test('buildMessages drops a dangling user turn before the new question', () => {
  const msgs = A.buildMessages({ agentKey: 'konsultan', context: 'c', history: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2 (gagal)' }], question: 'q3' })
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'user'])
  assert.equal(msgs.at(-1).content, 'q3')
})

test('isRetryable: network/5xx yes, 4xx/abort no', () => {
  assert.equal(A.isRetryable(new TypeError('Failed to fetch')), true)
  assert.equal(A.isRetryable(new Error('HTTP 502')), true)
  assert.equal(A.isRetryable(new Error('Layanan AI tidak tersedia')), true)
  assert.equal(A.isRetryable(new Error('Jaringan bermasalah.')), true)
  assert.equal(A.isRetryable(new Error('HTTP 400')), false)
  assert.equal(A.isRetryable(new Error('Belum masuk.')), false)
  assert.equal(A.isRetryable(new DOMException('x', 'AbortError')), false)
  assert.equal(A.isRetryable(null), false)
})

test('computeAnalytics: counts, error rate excludes stopped answers', () => {
  const rows = [
    { role: 'user', agent: 'keuangan' },
    { role: 'assistant', agent: 'keuangan', latency_ms: 1000 },
    { role: 'assistant', agent: 'keuangan', latency_ms: 3000 },
    { role: 'user', agent: 'pemasaran' },
    { role: 'assistant', agent: 'pemasaran', error: 'aborted' },
    { role: 'assistant', agent: 'pemasaran', error: 'HTTP 502' },
  ]
  const a = A.computeAnalytics(rows)
  assert.equal(a.questions, 2)
  assert.equal(a.count, 4)
  assert.equal(a.ok, 2)
  assert.equal(a.errors, 1)
  assert.equal(a.stopped, 1)
  assert.equal(a.avgLatency, 2000)
  assert.ok(Math.abs(a.errorRate - 100 / 3) < 1e-9)
  const k = a.byAgent.find((x) => x.key === 'keuangan')
  assert.equal(k.avgLatency, 2000)
  assert.equal(k.errorRate, 0)
  assert.equal(a.byAgent.find((x) => x.key === 'konsultan').errorRate, null)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

// Jalankan modul aplikasi dengan transformasi env Vite, tanpa layanan eksternal.
test('integrasi AI: mock, tool, pembatalan, fallback dan memori', async () => {
  const data = new Map()
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
  globalThis.localStorage = storage
  globalThis.sessionStorage = storage
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('true') } })
  const originalTimeout = globalThis.setTimeout
  try {
    const AI = await server.ssrLoadModule('/src/ai/superpowers.js')
    const { getCloud } = await server.ssrLoadModule('/src/cloud.js')
    const { loadModels } = await server.ssrLoadModule('/src/ai/models.js')
    const cloud = getCloud()
    await loadModels()
    globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0 }
    const collect = async (options) => {
      const events = []
      for await (const event of AI.chatWithAgent(options)) events.push(event)
      return events
    }
    const social = await collect({ agentKey: 'social', message: 'Buat caption' })
    assert.match(social.at(-1).full, /Caption/)
    const offer = await collect({ agentKey: 'offer', message: 'Buat penawaran cuci AC' })
    assert.ok(JSON.parse(offer.at(-1).full).scope)
    const mockCreate = cloud.llm.chat.completions.create
    let calls = 0
    let receivedSignal
    cloud.llm.chat.completions.create = async function* (options) {
      receivedSignal = options.signal
      const text = ++calls === 1 ? '```tool\n{"tool":"format_rupiah","parameters":{"amount":50000}}\n```' : 'Hasil Rp50.000'
      yield { choices: [{ delta: { content: text.slice(0, 5) } }] }
      yield { choices: [{ delta: { content: text.slice(5) } }] }
    }
    const controller = new AbortController()
    const tool = await collect({ agentKey: 'general', message: 'Format 50000', signal: controller.signal })
    assert.equal(receivedSignal, controller.signal)
    assert.equal(tool.filter((e) => e.type === 'tool').length, 1)
    assert.ok(tool.at(-1).full.endsWith('Hasil Rp50.000'))
    assert.equal(AI.getConversationHistory('general').at(-1).content, tool.at(-1).full)
    calls = 0
    cloud.llm.chat.completions.create = async function* () { calls++; throw new Error('model unavailable') }
    controller.abort()
    await assert.rejects(collect({ agentKey: 'general', message: 'Stop', signal: controller.signal }), { name: 'AbortError' })
    assert.equal(calls, 0)
    cloud.llm.chat.completions.create = async function* () {
      if (++calls === 1) throw new Error('model unavailable')
      yield { choices: [{ delta: { content: 'Fallback berhasil' } }] }
    }
    assert.equal((await collect({ agentKey: 'general', message: 'Fallback' })).at(-1).full, 'Fallback berhasil')
    assert.equal(calls, 2)
    calls = 0
    cloud.llm.chat.completions.create = async function* () {
      calls++
      yield { choices: [{ delta: { content: 'Jawaban parsial' } }] }
      throw new Error('stream terputus')
    }
    assert.equal((await collect({ agentKey: 'general', message: 'Partial' })).at(-1).type, 'error')
    assert.equal(calls, 1, 'Jangan gabungkan jawaban parsial dari model berbeda')
    storage.setItem('satualur_ai_analytics', '{bad json')
    assert.deepEqual(AI.getAnalytics(), [])
    cloud.llm.chat.completions.create = mockCreate
  } finally {
    globalThis.setTimeout = originalTimeout
    await server.close()
    delete globalThis.localStorage
    delete globalThis.sessionStorage
  }
})

// Unit tests: worker/ai-provider.js requireFirstText — an empty provider answer falls back instead of reaching the user.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireFirstText } from '../worker/ai-provider.js'

const enc = new TextEncoder()
const src = (parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close() } })
const text = async (s) => { let out = ''; const r = s.getReader(); const d = new TextDecoder(); for (;;) { const { done, value } = await r.read(); if (done) return out; out += d.decode(value) } }

test('replays the whole stream once real text arrives', async () => {
  const s = await requireFirstText(src(['data: {"choices":[{"delta":{"content":""}}]}\n\n', 'data: {"choices":[{"delta":{"content":"Ha', 'i"}}]}\n\n', 'data: [DONE]\n\n']))
  const out = await text(s)
  assert.match(out, /"content":"Hai"/)
  assert.match(out, /\[DONE\]/)
})

test('throws on an empty answer or an error before any text', async () => {
  await assert.rejects(requireFirstText(src(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'])), /tidak mengirim jawaban/)
  await assert.rejects(requireFirstText(src(['data: {"error":{"message":"Model AI kehabisan token"}}\n\n'])), /kehabisan token/)
})

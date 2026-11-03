/**
 * Custom AI providers chosen per business (business_integrations.ai_mode):
 *   openai     any OpenAI-compatible API: POST {base}/chat/completions, stream SSE
 *   anthropic  any Anthropic-compatible API: POST {base}/v1/messages, stream SSE
 * Both are mapped to the app's single stream contract (OpenAI-style chunks):
 *   data: {"choices":[{"delta":{"content":"…"},"finish_reason":null}]}  …  data: [DONE]
 * Pure helpers; the Worker supplies fetch and the decrypted key.
 */

export const JSON_HINT = 'Respond with ONLY a single valid JSON object. No markdown code fences, no commentary, no text before or after the JSON.'

const enc = new TextEncoder()
export const sseBytes = (obj) => enc.encode(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`)
const chunk = (text) => ({ choices: [{ delta: { content: text }, finish_reason: null }] })
const stop = { choices: [{ delta: {}, finish_reason: 'stop' }] }

/** Request for an OpenAI-compatible /chat/completions call. */
export function openAiRequest({ baseUrl, apiKey, model, messages, temperature, max_tokens, response_format }) {
  const body = { model, messages, stream: true }
  if (temperature !== undefined) body.temperature = temperature
  if (max_tokens !== undefined) body.max_tokens = max_tokens
  if (response_format) body.response_format = response_format
  return {
    url: `${baseUrl}/chat/completions`,
    init: { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  }
}

/**
 * Request for an Anthropic-compatible /v1/messages call. System messages are joined into
 * `system`; JSON mode is emulated with an instruction (the client parses tolerantly).
 */
export function anthropicRequest({ baseUrl, apiKey, model, messages, temperature, max_tokens, json = false, schema = null }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content)
  if (json) system.push(schema ? `${JSON_HINT} The JSON must match this JSON schema: ${JSON.stringify(schema).slice(0, 6000)}` : JSON_HINT)
  // Anthropic requires alternating turns starting with user; merge consecutive same-role turns.
  const turns = []
  for (const m of messages.filter((x) => x.role !== 'system')) {
    const last = turns[turns.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${m.content}`
    else turns.push({ role: m.role, content: m.content })
  }
  if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', content: '(mulai)' })
  const body = { model, messages: turns, max_tokens: max_tokens || 2048, stream: true }
  if (system.length) body.system = system.join('\n\n')
  if (temperature !== undefined) body.temperature = Math.min(1, temperature)
  const base = baseUrl.replace(/\/v1$/, '')
  return {
    url: `${base}/v1/messages`,
    init: {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  }
}

/** Builds a TransformStream that turns one SSE byte stream into the app's chunks via `onEvent`. */
function sseTransform(onData) {
  const dec = new TextDecoder()
  let buffer = ''
  let finished = false
  const finish = (c) => {
    if (finished) return
    finished = true
    c.enqueue(sseBytes(stop))
    c.enqueue(sseBytes('[DONE]'))
  }
  const line = (raw, c) => {
    const l = raw.trim()
    if (!l.startsWith('data:')) return
    const payload = l.slice(5).trim()
    if (!payload) return
    if (payload === '[DONE]') return finish(c)
    let obj
    try { obj = JSON.parse(payload) } catch { return }
    const out = onData(obj)
    if (out?.text) c.enqueue(sseBytes(chunk(out.text)))
    if (out?.error) c.enqueue(sseBytes({ error: { message: out.error } }))
    if (out?.done) finish(c)
  }
  return new TransformStream({
    transform(bytes, c) {
      buffer += dec.decode(bytes, { stream: true })
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, i), c)
        buffer = buffer.slice(i + 1)
      }
    },
    flush(c) {
      buffer += dec.decode()
      if (buffer) line(buffer, c)
      finish(c)
    },
  })
}

/** OpenAI-compatible SSE → app chunks. */
export const openAiToAppStream = () => sseTransform((obj) => {
  if (obj.error) return { error: String(obj.error.message || 'Layanan AI mengembalikan galat.') }
  const c = obj.choices?.[0]
  const text = (c?.delta && typeof c.delta.content === 'string' && c.delta.content) || (typeof c?.text === 'string' ? c.text : '')
  return { text }
})

/** Anthropic Messages SSE (content_block_delta / message_stop / error) → app chunks. */
export const anthropicToAppStream = () => sseTransform((obj) => {
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') return { text: obj.delta.text || '' }
  if (obj.type === 'message_stop') return { done: true }
  if (obj.type === 'error') return { error: String(obj.error?.message || 'Layanan AI mengembalikan galat.') }
  return null
})

/** Friendly message for a non-2xx provider response. */
export function providerErrorMessage(status, bodyText = '') {
  let detail = ''
  try { const j = JSON.parse(bodyText); detail = j?.error?.message || j?.message || '' } catch { detail = '' }
  detail = String(detail).slice(0, 160)
  if (status === 401 || status === 403) return 'API key AI ditolak penyedia. Periksa kunci di Pengaturan › Integrasi.'
  if (status === 404) return `Model atau alamat API tidak ditemukan.${detail ? ` ${detail}` : ''}`
  if (status === 429) return 'Kuota atau batas permintaan di penyedia AI Anda tercapai.'
  return `Penyedia AI menolak permintaan (HTTP ${status}).${detail ? ` ${detail}` : ''}`
}

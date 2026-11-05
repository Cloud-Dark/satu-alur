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

/** Text of an OpenAI-style content value: a string or an array of parts ({ type: 'text', text }). */
function contentText(v) {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '')).join('')
  return ''
}

/** Said when a model ends without any answer text, so the app never sits on an empty reply. */
export function emptyReplyMessage({ reasoning = false, finish = '' } = {}) {
  if (reasoning || finish === 'length') {
    return 'Model AI kehabisan token sebelum menulis jawaban (model "berpikir" terlalu panjang). Naikkan Maks. token atau pilih model lain di Pengaturan AI.'
  }
  return 'Model AI tidak mengembalikan jawaban. Coba lagi, atau pilih model lain di Pengaturan AI.'
}

/**
 * Builds a TransformStream that turns one SSE byte stream into the app's chunks via `onData`.
 * Also copes with providers that ignore `stream: true` and answer one plain JSON body
 * (`onData` gets it once with `whole: true`), and with streams that end without any text.
 */
function sseTransform(onData) {
  const dec = new TextDecoder()
  let buffer = ''
  let raw = ''
  let sawSse = false
  let finished = false
  let gotText = false
  let reasoning = false
  let finishReason = ''
  let errored = false
  const emit = (out, c) => {
    if (!out) return
    if (out.reasoning) reasoning = true
    if (out.finish) finishReason = out.finish
    if (out.text) { gotText = true; c.enqueue(sseBytes(chunk(out.text))) }
    if (out.error) { errored = true; c.enqueue(sseBytes({ error: { message: out.error } })) }
    if (out.done) finish(c)
  }
  const finish = (c) => {
    if (finished) return
    finished = true
    if (!gotText && !errored) c.enqueue(sseBytes({ error: { message: emptyReplyMessage({ reasoning, finish: finishReason }) } }))
    c.enqueue(sseBytes(stop))
    c.enqueue(sseBytes('[DONE]'))
  }
  const line = (rawLine, c) => {
    const l = rawLine.trim()
    if (!l.startsWith('data:')) return
    sawSse = true
    const payload = l.slice(5).trim()
    if (!payload) return
    if (payload === '[DONE]') return finish(c)
    let obj
    try { obj = JSON.parse(payload) } catch { return }
    emit(onData(obj), c)
  }
  return new TransformStream({
    transform(bytes, c) {
      const text = dec.decode(bytes, { stream: true })
      buffer += text
      if (!sawSse && raw.length < 200000) raw += text
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, i), c)
        buffer = buffer.slice(i + 1)
      }
    },
    flush(c) {
      const rest = dec.decode()
      buffer += rest
      if (!sawSse) raw += rest
      if (buffer) line(buffer, c)
      // No SSE at all: the provider answered with one JSON document.
      if (!sawSse && !finished && raw.trim()) {
        try { emit(onData(JSON.parse(raw), { whole: true }), c) } catch { /* not JSON either */ }
      }
      finish(c)
    },
  })
}

/** OpenAI-compatible SSE (or one non-streamed JSON body) → app chunks. Reasoning text is not shown. */
export const openAiToAppStream = () => sseTransform((obj) => {
  if (obj.error) return { error: String(obj.error.message || obj.error || 'Layanan AI mengembalikan galat.') }
  const c = obj.choices?.[0]
  if (!c) return null
  const d = c.delta || c.message || {}
  const text = contentText(d.content) || (typeof c.text === 'string' ? c.text : '')
  const reasoning = Boolean(d.reasoning_content || d.reasoning || d.reasoning_details?.length)
  return { text, reasoning, finish: c.finish_reason || '' }
})

/** Anthropic Messages SSE (content_block_delta / message_stop / error) → app chunks. */
export const anthropicToAppStream = () => sseTransform((obj) => {
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') return { text: obj.delta.text || '' }
  if (obj.type === 'message_stop') return { done: true }
  // Non-streamed reply (provider ignored stream: true): one message with content blocks.
  if (obj.type === 'message' && Array.isArray(obj.content)) {
    return { text: obj.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join(''), reasoning: obj.content.some((b) => b?.type === 'thinking'), finish: obj.stop_reason === 'max_tokens' ? 'length' : '' }
  }
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'thinking_delta') return { reasoning: true }
  if (obj.type === 'message_delta' && obj.delta?.stop_reason === 'max_tokens') return { finish: 'length' }
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

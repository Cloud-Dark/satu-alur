/**
 * How Waguri reaches a model.
 *   app     the signed-in client path every AI feature uses: getCloud().llm.chat.completions
 *           with feature 'advisor' (metered on the user's quota; the Worker picks the business's
 *           own provider, the admin's platform provider "Bawaan Satu Alur", or Workers AI).
 *           Quota errors (402) come back as QuotaError and open the upsell dialog.
 *   public  signed out: POST /api/waguri/public (worker/waguri.js) — the Worker builds the prompt
 *           from public knowledge itself and rate-limits per IP. Mock mode simulates it locally.
 * Both return the full text and stream deltas to onChunk.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { isQuotaError } from '../quota/errors.js'
import { buildMessages, historyTurns } from './skills.js'
import { knowledgeText } from './knowledge.js'

let modelPromise = null
async function modelId() {
  if (!modelPromise) {
    modelPromise = getCloud().llm.models.list().then(({ data, error }) => {
      if (error) throw new Error(error.message)
      const m = (data || []).find((x) => x.disabled !== true)
      if (!m) throw new Error('Tidak ada model AI yang tersedia saat ini.')
      return m.id
    })
    modelPromise.catch(() => { modelPromise = null })
  }
  return modelPromise
}

async function collect(stream, onChunk) {
  let text = ''
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content
    if (delta) {
      text += delta
      onChunk?.(delta, text)
    }
  }
  return text.trim()
}

/** Signed-in: one metered chat call with the skill's prompt and the facts as BAHAN. */
export async function askApp({ skill, question, context, history, signal, onChunk }) {
  const model = await modelId()
  const messages = buildMessages({ skill, question, context, history })
  const stream = getCloud().llm.chat.completions.create({
    model, messages, stream: true, feature: 'advisor', temperature: 0.4, max_tokens: 600, signal,
  })
  return collect(stream, onChunk)
}

/** Reads an OpenAI-style SSE body into chunks. */
async function* sse(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        try { yield JSON.parse(data) } catch { /* partial or keep-alive */ }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
}

/** Signed-out: the public endpoint (public knowledge only). Mock mode answers locally. */
export async function askPublic({ skill, question, history, context, signal, onChunk }) {
  if (isUsingMockCloud()) {
    // Same prompt the Worker builds (public knowledge only), answered by the local simulation.
    const { simulateAnswer } = await import('../ai/simulate.js')
    context = context || knowledgeText('public', { only: skill.only })
    return collect(simulateAnswer({ messages: buildMessages({ skill, question, context, history }) }), onChunk)
  }
  let res
  try {
    res = await fetch('/api/waguri/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: skill.id, question, history: historyTurns(history) }),
      signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('Jaringan bermasalah.')
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try { const j = await res.json(); message = j?.error?.message || j?.error || j?.message || message } catch { /* not JSON */ }
    throw Object.assign(new Error(message), { status: res.status })
  }
  if (!res.body) throw new Error('Respons AI kosong.')
  return collect(sse(res.body), onChunk)
}

/** User-facing reason an AI call failed (the deterministic answer stays). */
export function aiErrorNote(err) {
  if (isQuotaError(err)) return 'Kuota AI bulan ini sudah habis, jadi saya menjawab dari data saja.'
  if (err?.status === 429) return 'Banyak sekali pertanyaan barusan. Coba lagi beberapa menit lagi.'
  return null
}

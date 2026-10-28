import { getCloud } from '../cloud.js'
import { getAgentPrompts, getAgentParams } from '../stages/settings.js'

const OFFER_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string', description: 'Ruang lingkup pekerjaan, minimal satu kalimat.' },
    price: { type: 'integer', description: 'Harga total dalam Rupiah, angka bulat tanpa titik/teks.' },
    terms: { type: 'string', description: 'Ketentuan pembayaran dan garansi.' },
    notes: { type: 'string', description: 'Catatan tambahan, estimasi waktu, asumsi.' },
  },
  required: ['scope', 'price', 'terms', 'notes'],
}

const OFFER_FORMAT_RULES = `Keluarkan HANYA satu objek JSON dengan tepat empat key: "scope" (string), "price" (integer Rupiah tanpa titik), "terms" (string), "notes" (string). Jangan tambahkan key lain, jangan memakai markdown.`

/** Pulls the first JSON object out of model text and repairs common slips. */
export function parseModelJson(text) {
  let t = String(text || '').trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no-json')
  t = t.slice(start, end + 1)
  try { return JSON.parse(t) } catch { /* try repairs below */ }
  const repaired = t
    // "key: value", -> "key": "value",  (model forgot the closing quote of the key)
    .replace(/"([A-Za-z_][\w]*):\s*([^"\n]*?)"(\s*[,}\n])/g, (_m, k, v, tail) => `"${k}": ${JSON.stringify(v.trim())}${tail}`)
    // trailing commas
    .replace(/,\s*([}\]])/g, '$1')
    // smart quotes
    .replace(/[\u201C\u201D]/g, '"')
  return JSON.parse(repaired)
}

function toRupiahInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  const digits = String(v ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : NaN
}

/** Keeps only the four offer fields, tolerating synonyms the model may use. */
export function normalizeOffer(obj) {
  const pick = (...keys) => keys.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null && v !== '')
  return {
    scope: String(pick('scope', 'ruang_lingkup', 'lingkup') ?? '').trim(),
    price: toRupiahInt(pick('price', 'harga', 'total')),
    terms: String(pick('terms', 'ketentuan', 'syarat') ?? '').trim(),
    notes: String(pick('notes', 'catatan', 'keterangan') ?? '').trim(),
  }
}

export async function generateOffer({ request, modelId, signal, onChunk }) {
  const cloud = getCloud()
  const prompts = getAgentPrompts()
  const params = getAgentParams()

  const systemPrompt = prompts.offer || `Anda adalah agen penawaran untuk perusahaan jasa layanan di Indonesia. Buat proposal penawaran dalam JSON dengan field: scope, price, terms, notes.`

  const messages = [
    { role: 'system', content: `${systemPrompt}\n\n${OFFER_FORMAT_RULES}` },
    { role: 'user', content: `Permintaan jasa:\n${JSON.stringify(request, null, 2)}` },
  ]
  let fullText = ''
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: modelId,
      messages,
      stream: true,
      response_format: { type: 'json_schema', json_schema: OFFER_SCHEMA },
      temperature: params.temperature ?? 0.4,
      max_tokens: params.maxTokens ?? 2000,
      signal,
    })) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        fullText += delta
        onChunk?.(delta, fullText)
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Gagal menghasilkan penawaran: ${err.message}`)
  }
  try {
    return normalizeOffer(parseModelJson(fullText))
  } catch {
    throw new Error('Respons AI bukan JSON yang valid. Coba lagi.')
  }
}

export async function explainReport({ report, modelId, signal, onChunk }) {
  const cloud = getCloud()
  const prompts = getAgentPrompts()
  const params = getAgentParams()

  const systemPrompt = prompts.report || `Anda adalah analis laporan keuangan untuk perusahaan jasa. Jelaskan laporan dengan bahasa mudah dipahami dalam format HTML.`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Data laporan:\n${JSON.stringify(report, null, 2)}` },
  ]
  let fullText = ''
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: modelId,
      messages,
      stream: true,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 2000,
      signal,
    })) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        fullText += delta
        onChunk?.(delta, fullText)
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Gagal menjelaskan laporan: ${err.message}`)
  }
  return fullText
}

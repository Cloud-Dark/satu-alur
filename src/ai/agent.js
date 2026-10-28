import { getCloud } from '../cloud.js'
import { getAgentPrompts, getAgentParams } from '../stages/settings.js'

export async function generateOffer({ request, modelId, signal, onChunk }) {
  const cloud = getCloud()
  const prompts = getAgentPrompts()
  const params = getAgentParams()

  const systemPrompt = prompts.offer || `Anda adalah agen penawaran untuk perusahaan jasa layanan di Indonesia. Buat proposal penawaran dalam JSON dengan field: scope, price, terms, notes.`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Permintaan jasa:\n${JSON.stringify(request, null, 2)}` },
  ]
  let fullText = ''
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: modelId,
      messages,
      stream: true,
      response_format: { type: 'json_object' },
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
    return JSON.parse(fullText)
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

import { getCloud } from '../cloud.js'

function buildSystemPrompt(role, rules) {
  return `Kamu adalah ${role}. ${rules} Berikan jawaban dalam Bahasa Indonesia.`
}

export async function generateOffer({ request, modelId, signal, onChunk }) {
  const cloud = getCloud()
  const systemPrompt = buildSystemPrompt(
    'agen penawaran otomatis untuk perusahaan jasa di Indonesia',
    'Hasilkan proposal penawaran dalam JSON dengan field: scope (string, ruang lingkup), price (number, dalam Rupiah), terms (string, syarat & ketentuan), notes (string, catatan opsional). Pastikan harga wajar dan ruang lingkup spesifik.'
  )
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
      temperature: 0.4,
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
  const systemPrompt = buildSystemPrompt(
    'asisten keuangan/operasional yang menjelaskan laporan kepada pemilik usaha jasa di Indonesia',
    'Jelaskan laporan dengan bahasa yang mudah dipahami, soroti angka penting, tren, dan rekomendasi tindakan. Gunakan format HTML sederhana (paragraf, daftar, heading).'
  )
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
      temperature: 0.7,
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

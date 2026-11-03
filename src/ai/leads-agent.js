/**
 * Pencari prospek — AI steps (Workers AI via /api/llm/chat, json_schema).
 *
 *  rankLeads      sanitises / dedupes raw map results and rates relevance
 *                 to the user's own services (0–100 + one-sentence reason).
 *  draftLeadOffer writes a B2B offer draft for one lead, grounded on the
 *                 lead's public data and the user's real service values.
 *
 * Nothing here sends anything to the lead. Prompts start with [agent:leads]
 * so the demo cloud can recognise them.
 */
import { getCloud } from '../cloud.js'
import { getAgentParams } from '../stages/settings.js'
import { parseModelJson } from './agent.js'
import { heuristicRank, mergeRanking } from '../leads/scoring.js'
import { isQuotaError } from '../quota/errors.js'

export const LEADS_MARKER = '[agent:leads]'
export const AI_RANK_LIMIT = 25

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    leads: {
      type: 'array',
      description: 'Satu item untuk setiap kandidat, memakai id yang sama.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id kandidat persis seperti input, contoh "L3".' },
          keep: { type: 'boolean', description: 'false bila bukan usaha nyata, tidak relevan, atau duplikat.' },
          relevance: { type: 'integer', minimum: 0, maximum: 100, description: 'Seberapa mungkin usaha ini membutuhkan layanan pengguna.' },
          reason: { type: 'string', description: 'Satu kalimat alasan, maksimal 20 kata.' },
          suggested_service: { type: 'string', description: 'Persis salah satu nama layanan pengguna, atau "" bila tidak ada yang cocok.' },
          duplicate_of: { type: 'string', description: 'id kandidat lain yang sama, atau "".' },
        },
        required: ['id', 'keep', 'relevance', 'reason', 'suggested_service', 'duplicate_of'],
      },
    },
  },
  required: ['leads'],
}

const OFFER_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Judul penawaran singkat, maksimal 10 kata.' },
    pitch: { type: 'string', description: 'Pesan pembuka siap salin (WhatsApp/email), 50–90 kata, sopan, tanpa emoji, diakhiri ajakan survei/diskusi.' },
    scope: { type: 'string', description: 'Ruang lingkup pekerjaan yang ditawarkan, 1–3 kalimat.' },
    price: { type: 'integer', description: 'Perkiraan harga total dalam Rupiah, angka bulat.' },
    terms: { type: 'string', description: 'Ketentuan pembayaran dan garansi singkat.' },
    notes: { type: 'string', description: 'Asumsi dan hal yang perlu dicek saat survei.' },
  },
  required: ['subject', 'pitch', 'scope', 'price', 'terms', 'notes'],
}

async function streamJson({ messages, schema, modelId, signal, onChunk, maxTokens, temperature, feature }) {
  const params = getAgentParams()
  let full = ''
  try {
    for await (const chunk of getCloud().llm.chat.completions.create({
      model: modelId,
      messages,
      stream: true,
      response_format: { type: 'json_schema', json_schema: schema },
      feature,
      temperature: temperature ?? params.temperature ?? 0.3,
      max_tokens: maxTokens,
      signal,
    })) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        full += delta
        onChunk?.(delta, full)
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || isQuotaError(err)) throw err
    throw new Error(`AI gagal: ${err.message}`)
  }
  let data = null
  try { data = parseModelJson(full) } catch { data = null }
  return { data, raw: full }
}

const tagLine = (tags = {}) => Object.entries(tags).filter(([k]) => !/^(building:levels|level|opening_hours)$/.test(k)).slice(0, 5).map(([k, v]) => `${k}=${v}`).join('; ')

/**
 * leads: raw results (already distance-sorted). Only the first AI_RANK_LIMIT
 * go to the model (token budget); the rest keep the heuristic verdict.
 * services: [{ name, count, avg }] from serviceStats + names without price.
 */
export async function rankLeads({ leads, services, criteria, modelId, signal, onChunk }) {
  const names = services.map((s) => s.name)
  const head = leads.slice(0, AI_RANK_LIMIT)
  if (!head.length) return { leads: [], raw: '', aiCount: 0 }
  const system = `${LEADS_MARKER} Anda adalah analis prospek B2B untuk bisnis jasa di Indonesia.
Tugas: untuk setiap kandidat usaha di sekitar lokasi, nilai seberapa mungkin usaha itu membutuhkan layanan milik pengguna.
Aturan:
- Pakai hanya data yang diberikan (nama, kategori, tag OpenStreetMap, jarak). Jangan mengarang fakta tentang usaha itu.
- relevance 0–100: 80+ bila jelas butuh layanan pengguna secara rutin, 50–79 mungkin butuh, di bawah 40 kecil kemungkinan.
- keep=false untuk entri yang bukan usaha (nama tidak jelas, fasilitas umum tanpa pengelola), tidak relevan sama sekali, atau duplikat.
- duplicate_of berisi id kandidat yang sama (nama mirip dan lokasi berdekatan), selain itu "".
- suggested_service HARUS persis salah satu dari daftar layanan pengguna, atau "".
- reason: satu kalimat Bahasa Indonesia, maksimal 20 kata, tanpa emoji.
- Kembalikan satu item untuk setiap kandidat, dengan id yang sama.`
  const payload = {
    layanan_pengguna: services.slice(0, 12).map((s) => ({ nama: s.name, pekerjaan: s.count || 0, rata_rata_rp: s.avg || null })),
    kriteria_pencarian: criteria,
    kandidat: head.map((l, i) => ({
      id: `L${i + 1}`,
      nama: l.name,
      kategori: l.category,
      tag: tagLine(l.tags),
      jarak_km: l.distance_km,
      ada_telepon: Boolean(l.phone),
      ada_situs: Boolean(l.website),
    })),
  }
  const { data, raw } = await streamJson({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Data kandidat prospek (JSON):\n${JSON.stringify(payload)}` },
    ],
    schema: RANK_SCHEMA,
    feature: 'leads',
    modelId,
    signal,
    onChunk,
    maxTokens: Math.min(4096, 220 + head.length * 70),
    temperature: 0.2,
  })
  const items = Array.isArray(data?.leads) ? data.leads : []
  const merged = mergeRanking(head, items, names)
  const aiCount = merged.filter((l) => l.ai.basis === 'ai').length
  const rest = leads.slice(AI_RANK_LIMIT).map((l) => ({ ...l, ai: heuristicRank(l, names) }))
  return { leads: [...merged, ...rest], raw, aiCount }
}

const toInt = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d ? Number(d) : 0
}

export function normalizeLeadOffer(o) {
  const s = (v) => String(v ?? '').trim()
  return { subject: s(o?.subject), pitch: s(o?.pitch), scope: s(o?.scope), price: toInt(o?.price), terms: s(o?.terms), notes: s(o?.notes) }
}

/**
 * lead: a ranked lead; service: chosen service name; estimate: { potential,
 * basis, note }; sender: { name } (the user); extra: free notes from the user.
 */
export async function draftLeadOffer({ lead, service, estimate, sender, extra, modelId, signal, onChunk }) {
  const system = `${LEADS_MARKER} Anda menyusun draf penawaran B2B untuk bisnis jasa di Indonesia.
Aturan:
- Bahasa Indonesia yang sopan, ringkas, profesional. Tanpa emoji.
- Jangan mengarang fakta tentang calon pelanggan (misalnya keluhan, jumlah unit, atau masalah yang tidak disebut). Tulis sebagai tawaran survei/diskusi.
- Jangan menjanjikan diskon atau garansi yang tidak disebut pengguna; ketentuan umum boleh (DP, pelunasan, garansi kerja singkat).
- price: bila ada acuan nilai rata-rata pengguna, pakai sebagai titik awal yang wajar; bila tidak ada, beri perkiraan konservatif dan tulis asumsinya di notes.
- Keluarkan HANYA satu objek JSON sesuai skema.`
  const payload = {
    calon_pelanggan: {
      nama: lead.name,
      kategori: lead.category,
      alamat: lead.address || null,
      jarak_km: lead.distance_km,
      tag: tagLine(lead.tags),
      alasan_relevan: lead.ai?.reason || null,
    },
    layanan_ditawarkan: service || 'layanan utama pengguna',
    acuan_nilai: estimate?.potential ? { rata_rata_rp: estimate.potential, dasar: estimate.note } : null,
    pengirim: sender?.name || null,
    catatan_pengguna: extra || null,
  }
  const { data, raw } = await streamJson({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Susun draf penawaran untuk calon pelanggan berikut (JSON):\n${JSON.stringify(payload)}` },
    ],
    schema: OFFER_SCHEMA,
    feature: 'offer',
    modelId,
    signal,
    onChunk,
    maxTokens: 1200,
    temperature: 0.5,
  })
  return { data: data ? normalizeLeadOffer(data) : null, raw }
}

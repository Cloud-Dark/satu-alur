/**
 * Social media agent — ported from PR #3 (src/ai/superpowers.js `social`
 * agent + the generate_hashtags / suggest_demographics tools) onto the
 * current LLM pipeline (getCloud().llm, structured output via json_schema).
 *
 * Every task asks the model for JSON that matches a schema, then normalises
 * it. When the model (or the demo cloud) answers with something that is not
 * valid JSON, the raw text is returned so the UI can still show and save it.
 *
 * Deliberately NOT ported: the canned hashtag list (random shuffle of fixed
 * tags), the hard-coded demographics / "estimated reach" / CPM figures and the
 * "estimasi engagement" field. Nothing here invents performance numbers.
 */
import { getCloud } from '../cloud.js'
import { getAgentParams } from '../stages/settings.js'
import { parseModelJson } from './agent.js'

/** Marker the demo cloud uses to recognise these prompts. Keep it first. */
export const SOCIAL_MARKER = '[agent:social]'

export const PLATFORMS = [
  { value: 'instagram', label: 'Instagram', limit: 2200, maxTags: 12, style: 'visual, caption dengan baris pembuka kuat, hashtag di akhir' },
  { value: 'tiktok', label: 'TikTok', limit: 4000, maxTags: 6, style: 'santai, cepat, hook di 2 detik pertama, bahasa lisan' },
  { value: 'facebook', label: 'Facebook', limit: 63206, maxTags: 5, style: 'hangat, bercerita, cocok untuk komunitas lokal' },
  { value: 'threads', label: 'Threads', limit: 500, maxTags: 1, style: 'teks lebih dulu, singkat dan seperti mengobrol, satu gagasan per posting, ajak pembaca membalas; paling banyak 1 tag topik' },
  { value: 'linkedin', label: 'LinkedIn', limit: 3000, maxTags: 5, style: 'profesional, berbasis pengalaman dan hasil kerja, minim hashtag' },
  { value: 'whatsapp', label: 'WhatsApp (Status/Channel)', limit: 700, maxTags: 0, style: 'singkat, personal, ajakan chat langsung, tanpa hashtag' },
  { value: 'x', label: 'X', limit: 280, maxTags: 2, style: 'padat, satu gagasan, maksimal 280 karakter termasuk hashtag' },
]
/** Meta Ads covers Facebook + Instagram; only used for saved ad plans. */
export const META_PLATFORM = { value: 'meta', label: 'Meta (FB & IG)' }

export const CONTENT_TYPES = [
  { value: 'caption', label: 'Caption', ask: 'caption posting' },
  { value: 'script', label: 'Naskah video', ask: 'naskah video pendek (hook, isi per adegan, penutup)' },
  { value: 'story', label: 'Seri story', ask: 'seri story 3–5 slide (teks per slide)' },
  { value: 'ad_copy', label: 'Copy iklan', ask: 'copy iklan (headline, teks utama, ajakan)' },
  { value: 'image_prompt', label: 'Prompt gambar', ask: 'prompt untuk generator gambar AI beserta caption pendek' },
]

export const TONES = [
  { value: 'casual', label: 'Santai & akrab' },
  { value: 'professional', label: 'Profesional' },
  { value: 'inspirational', label: 'Inspiratif' },
  { value: 'educational', label: 'Edukatif' },
  { value: 'promotional', label: 'Promosi & diskon' },
]

export const POST_TYPES = [
  { value: 'organic', label: 'Organik' },
  { value: 'ads', label: 'Iklan' },
  { value: 'story', label: 'Story / Reels' },
]

export const AD_OBJECTIVES = [
  { value: 'messages', label: 'Pesan (WhatsApp / Messenger)' },
  { value: 'leads', label: 'Prospek (formulir)' },
  { value: 'traffic', label: 'Kunjungan profil / situs' },
  { value: 'awareness', label: 'Kesadaran merek di sekitar' },
]

export const PARTNER_GOALS = [
  { value: 'reach', label: 'Menjangkau pelanggan baru' },
  { value: 'referral', label: 'Saling rujuk pelanggan' },
  { value: 'content', label: 'Membuat konten bersama' },
  { value: 'bundle', label: 'Paket layanan gabungan' },
]

/** Hashtag budget per platform (Threads uses one topic tag, WhatsApp none). */
export function capHashtags(platform, tags) {
  const p = PLATFORMS.find((x) => x.value === platform)
  const list = Array.isArray(tags) ? tags : []
  return p ? list.slice(0, p.maxTags) : list
}

const tagRule = (p) => (p.maxTags === 0
  ? 'Tanpa hashtag.'
  : p.maxTags === 1 ? 'Hashtag: paling banyak 1 tag topik.' : `Hashtag: paling banyak ${p.maxTags}.`)

export const platformLabel = (v) => [...PLATFORMS, META_PLATFORM].find((p) => p.value === v)?.label || (v ? String(v) : 'Semua platform')
export const labelOf = (list, v) => list.find((o) => o.value === v)?.label || v || '—'

const BASE_PROMPT = `Anda adalah ahli pemasaran media sosial untuk bisnis jasa di Indonesia (kebersihan, perawatan, perbaikan, dan sejenisnya).
Aturan:
- Bahasa Indonesia yang natural, jelas, dan sesuai platform.
- Jangan pakai emoji.
- Jangan mengarang angka performa (jangkauan, CPM, CTR, engagement, jumlah pengikut) atau testimoni pelanggan.
- Jangan menyebut harga kecuali diberikan pengguna.
- Keluarkan HANYA satu objek JSON sesuai skema, tanpa markdown.`

/* ------------------------------------------------------------- Schemas */

const S = (description) => ({ type: 'string', description })
const LIST = (description, items = { type: 'string' }) => ({ type: 'array', description, items })

const SCHEMAS = {
  content: {
    type: 'object',
    properties: {
      title: S('Judul singkat untuk pustaka, maksimal 8 kata.'),
      body: S('Isi konten siap pakai. Gunakan baris baru untuk paragraf/slide/adegan. Tanpa hashtag.'),
      hashtags: LIST('Hashtag relevan, diawali #, tanpa spasi, sesuai batas platform. Kosong bila platform tanpa hashtag.'),
      notes: S('Satu kalimat saran pemakaian (visual, waktu unggah umum, atau format).'),
    },
    required: ['title', 'body', 'hashtags', 'notes'],
  },
  hashtags: {
    type: 'object',
    properties: {
      hashtags: LIST('Hashtag diawali #, tanpa spasi, campuran umum, niche, dan lokal.'),
    },
    required: ['hashtags'],
  },
  ideas: {
    type: 'object',
    properties: {
      ideas: LIST('Daftar ide konten.', {
        type: 'object',
        properties: {
          title: S('Judul ide.'),
          format: S('Format: video pendek, carousel, foto tunggal, story, live, atau teks.'),
          hook: S('Kalimat pembuka yang membuat orang berhenti menggulir.'),
          concept: S('Deskripsi konsep 1–2 kalimat.'),
        },
        required: ['title', 'format', 'hook', 'concept'],
      }),
    },
    required: ['ideas'],
  },
  ads: {
    type: 'object',
    properties: {
      audience: {
        type: 'object',
        properties: {
          age_range: S('Rentang usia, contoh "28–50".'),
          gender: S('Semua / perempuan / laki-laki, dengan alasan singkat.'),
          locations: LIST('Area target dan radius yang disarankan.'),
          interests: LIST('Minat untuk targeting detail di Meta.'),
          behaviors: LIST('Perilaku / kondisi hidup yang relevan.'),
        },
        required: ['age_range', 'gender', 'locations', 'interests', 'behaviors'],
      },
      placements: LIST('Penempatan yang disarankan, contoh Feed Instagram, Reels, Stories.'),
      schedule: S('Saran jam tayang berdasarkan kebiasaan target, sebagai hipotesis untuk diuji.'),
      budget_plan: S('Cara membagi anggaran harian yang diberikan: fase uji, durasi, kapan menaikkan.'),
      ad_copies: LIST('Tiga variasi materi iklan.', {
        type: 'object',
        properties: {
          headline: S('Judul iklan maksimal 40 karakter.'),
          primary_text: S('Teks utama 1–3 kalimat.'),
          cta: S('Tombol ajakan Meta, contoh "Kirim Pesan".'),
        },
        required: ['headline', 'primary_text', 'cta'],
      }),
      hashtags: LIST('5–10 hashtag untuk versi organik materi ini.'),
      tips: LIST('3–5 langkah optimasi yang bisa diukur sendiri di Ads Manager.'),
    },
    required: ['audience', 'placements', 'schedule', 'budget_plan', 'ad_copies', 'hashtags', 'tips'],
  },
  partnership: {
    type: 'object',
    properties: {
      ideas: LIST('Ide kolaborasi.', {
        type: 'object',
        properties: {
          partner: S('Jenis mitra lokal, contoh "Agen properti di area yang sama".'),
          why: S('Mengapa cocok untuk bisnis ini.'),
          offer: S('Apa yang saling ditukar / ditawarkan.'),
          pitch: S('Pesan ajakan singkat siap kirim lewat WhatsApp atau DM.'),
          first_step: S('Langkah pertama yang konkret minggu ini.'),
        },
        required: ['partner', 'why', 'offer', 'pitch', 'first_step'],
      }),
    },
    required: ['ideas'],
  },
}

/* ---------------------------------------------------------- Normalise */

const str = (v) => (v == null ? '' : String(v)).trim()
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/[\n,]+/))
const strList = (v) => arr(v).map((x) => (typeof x === 'object' && x ? Object.values(x).join(' — ') : str(x))).filter(Boolean)

/** "#Jasa AC", "jasa ac", "#jasaAC" -> "#jasaac"-style tags, deduped. */
export function normalizeHashtags(v, max = 30) {
  const seen = new Set()
  const out = []
  for (const raw of arr(v).flatMap((x) => String(x).split(/\s+(?=#)/))) {
    const t = String(raw).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(`#${t}`)
    if (out.length >= max) break
  }
  return out
}

/** Moves #tags the model left inside the body into the hashtag list. */
function splitInlineHashtags(body, tags) {
  const found = body.match(/#[\p{L}\p{N}_]+/gu) || []
  const clean = body
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { body: clean || body, hashtags: normalizeHashtags([...tags, ...found]) }
}

const NORMALIZE = {
  content: (o) => {
    const { body, hashtags } = splitInlineHashtags(
      str(o.body || o.content || o.caption || o.isi || o.text),
      normalizeHashtags(o.hashtags || o.tags),
    )
    return {
      title: str(o.title || o.judul),
      body,
      hashtags,
      notes: str(o.notes || o.catatan || o.tips),
    }
  },
  hashtags: (o) => ({ hashtags: normalizeHashtags(o.hashtags || o.tags || o) }),
  ideas: (o) => ({
    ideas: arr(o.ideas || o.ide || o).filter((x) => x && typeof x === 'object').map((x) => ({
      title: str(x.title || x.judul),
      format: str(x.format),
      hook: str(x.hook),
      concept: str(x.concept || x.konsep || x.description || x.deskripsi),
    })).filter((x) => x.title || x.concept),
  }),
  ads: (o) => {
    const a = o.audience || o.demographics || {}
    return {
      audience: {
        age_range: str(a.age_range || (a.age_min && a.age_max ? `${a.age_min}–${a.age_max}` : '')),
        gender: str(a.gender),
        locations: strList(a.locations),
        interests: strList(a.interests),
        behaviors: strList(a.behaviors),
      },
      placements: strList(o.placements),
      schedule: str(o.schedule || o.best_posting_times),
      budget_plan: str(o.budget_plan),
      ad_copies: arr(o.ad_copies).filter((x) => x && typeof x === 'object').map((x) => ({
        headline: str(x.headline), primary_text: str(x.primary_text || x.text), cta: str(x.cta),
      })),
      hashtags: normalizeHashtags(o.hashtags),
      tips: strList(o.tips),
    }
  },
  partnership: (o) => ({
    ideas: arr(o.ideas || o).filter((x) => x && typeof x === 'object').map((x) => ({
      partner: str(x.partner || x.partner_type),
      why: str(x.why),
      offer: str(x.offer),
      pitch: str(x.pitch),
      first_step: str(x.first_step),
    })).filter((x) => x.partner || x.pitch),
  }),
}

/** True when a normalised result actually carries something to show. */
function hasSubstance(task, d) {
  if (!d) return false
  if (task === 'content') return Boolean(d.body)
  if (task === 'hashtags') return d.hashtags.length > 0
  if (task === 'ideas' || task === 'partnership') return d.ideas.length > 0
  if (task === 'ads') return Boolean(d.ad_copies.length || d.audience.interests.length || d.placements.length)
  return true
}

/* ----------------------------------------------------------- Runner */

/**
 * Streams one structured task. Resolves { data, raw }: `data` is the
 * normalised object, or null when the reply could not be parsed (then `raw`
 * holds the model text so the UI can still show it).
 */
async function runTask(task, { instruction, user, modelId, signal, onChunk, maxTokens, temperature }) {
  const params = getAgentParams()
  const messages = [
    { role: 'system', content: `${SOCIAL_MARKER} [task:${task}]\n${BASE_PROMPT}\n\n${instruction}` },
    { role: 'user', content: user },
  ]
  let raw = ''
  try {
    for await (const chunk of getCloud().llm.chat.completions.create({
      model: modelId,
      messages,
      stream: true,
      response_format: { type: 'json_schema', json_schema: SCHEMAS[task] },
      temperature: temperature ?? params.temperature ?? 0.7,
      max_tokens: Math.max(params.maxTokens ?? 2000, maxTokens ?? 0),
      signal,
    })) {
      const delta = chunk?.choices?.[0]?.delta?.content
      if (delta) {
        raw += delta
        onChunk?.(delta, raw)
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`AI gagal merespons: ${err.message}`)
  }
  if (!raw.trim()) throw new Error('AI tidak mengembalikan teks. Coba lagi.')
  let data = null
  try {
    const parsed = parseModelJson(raw)
    const n = NORMALIZE[task](parsed)
    data = hasSubstance(task, n) ? n : null
  } catch { /* not JSON: caller shows raw text */ }
  return { data, raw: stripMarkup(raw) }
}

/** Plain-text view of a non-JSON reply (drops tags/markdown fences). */
function stripMarkup(text) {
  const t = String(text || '').replace(/```[a-z]*\n?/gi, '')
  if (!/<[a-z][\s\S]*>/i.test(t)) return t.trim()
  const div = document.createElement('div')
  div.innerHTML = t.replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim()
}

/** Business context line built from real request data (aggregated only). */
function contextBlock(business) {
  if (!business || (!business.services?.length && !business.areas?.length)) return ''
  const lines = ['Konteks bisnis dari data permintaan pengguna (gunakan bila relevan, jangan dikarang lebih jauh):']
  if (business.services?.length) lines.push(`- Layanan yang paling sering diminta: ${business.services.map((s) => `${s.name} (${s.count} permintaan)`).join(', ')}`)
  if (business.areas?.length) lines.push(`- Area pelanggan: ${business.areas.map((a) => a.name).join(', ')}`)
  return `\n\n${lines.join('\n')}`
}

/* -------------------------------------------------------------- Tasks */

export async function generateContent({ platform, type, topic, tone, cta, business, ...run }) {
  const p = PLATFORMS.find((x) => x.value === platform) || PLATFORMS[0]
  const t = CONTENT_TYPES.find((x) => x.value === type) || CONTENT_TYPES[0]
  const res = await runTask('content', {
    ...run,
    instruction: `Tugas: tulis ${t.ask} untuk ${p.label}. Gaya platform: ${p.style}. Batas teks ${p.limit.toLocaleString('id-ID')} karakter. ${tagRule(p)} Sertakan ajakan bertindak yang jelas.`,
    user: [
      `Topik / layanan: ${topic}`,
      `Platform: ${p.label}`,
      `Jenis konten: ${t.label}`,
      `Nada: ${labelOf(TONES, tone)}`,
      cta ? `Ajakan bertindak yang diminta: ${cta}` : 'Ajakan bertindak: tentukan yang paling cocok (misalnya chat WhatsApp).',
    ].join('\n') + contextBlock(business),
  })
  return res.data ? { ...res, data: { ...res.data, hashtags: capHashtags(p.value, res.data.hashtags) } } : res
}

const fewTags = (platform) => {
  const p = PLATFORMS.find((x) => x.value === platform)
  return p && p.maxTags > 0 && p.maxTags <= 2 ? ` ${p.label} memakai paling banyak ${p.maxTags} tag per posting, jadi urutkan dari yang paling relevan.` : ''
}

export function generateHashtags({ topic, platform, count = 15, business, ...run }) {
  return runTask('hashtags', {
    ...run,
    temperature: 0.6,
    instruction: `Tugas: susun ${count} hashtag untuk ${platformLabel(platform)}. Campurkan hashtag umum, niche layanan, dan lokal (kota/area). Hindari hashtag yang menyesatkan atau tidak terkait.${fewTags(platform)}`,
    user: `Topik: ${topic}` + contextBlock(business),
  })
}

export function brainstormIdeas({ topic, platform, count = 10, business, ...run }) {
  const n = Math.min(20, Math.max(3, Number(count) || 10))
  return runTask('ideas', {
    ...run,
    maxTokens: 260 * n + 400,
    temperature: 0.9,
    instruction: `Tugas: brainstorming tepat ${n} ide konten yang beragam (edukasi, di balik layar, sebelum-sesudah, tips, tanya jawab, musiman). Jangan memberi estimasi engagement.`,
    user: `Tema: ${topic}\nPlatform target: ${platform === 'all' ? 'semua platform' : platformLabel(platform)}\nJumlah ide: ${n}` + contextBlock(business),
  })
}

export function planMetaAds({ service, location, budget, objective, business, ...run }) {
  return runTask('ads', {
    ...run,
    maxTokens: 2400,
    temperature: 0.5,
    instruction: 'Tugas: susun rencana awal iklan Meta (Facebook & Instagram) untuk bisnis jasa lokal. Semua saran adalah hipotesis awal untuk diuji; JANGAN memberi estimasi jangkauan, CPM, CPC, CTR, atau jumlah prospek.',
    user: [
      `Layanan: ${service}`,
      `Lokasi target: ${location || 'belum ditentukan'}`,
      budget ? `Anggaran harian: Rp${Number(budget).toLocaleString('id-ID')}` : 'Anggaran harian: belum ditentukan',
      `Tujuan kampanye: ${labelOf(AD_OBJECTIVES, objective)}`,
    ].join('\n') + contextBlock(business),
  })
}

export function partnershipIdeas({ service, location, goal, offer, business, ...run }) {
  return runTask('partnership', {
    ...run,
    maxTokens: 2200,
    temperature: 0.8,
    instruction: 'Tugas: usulkan 5 ide kolaborasi dengan bisnis lokal, komunitas, atau kreator yang realistis untuk usaha kecil. Tanpa menyebut nama orang/merek nyata; sebut jenis mitranya saja.',
    user: [
      `Layanan: ${service}`,
      `Area: ${location || 'belum ditentukan'}`,
      `Tujuan kolaborasi: ${labelOf(PARTNER_GOALS, goal)}`,
      offer ? `Yang bisa ditawarkan ke mitra: ${offer}` : '',
    ].filter(Boolean).join('\n') + contextBlock(business),
  })
}

/* ------------------------------------------------------ Text helpers */

/** Content body plus hashtags, ready to paste. */
export function contentText(body, hashtags = []) {
  const tags = (hashtags || []).join(' ')
  return [str(body), tags].filter(Boolean).join('\n\n')
}

export function ideaText(i) {
  return [i.format && `Format: ${i.format}`, i.hook && `Hook: ${i.hook}`, i.concept].filter(Boolean).join('\n')
}

export function partnershipText(i) {
  return [
    i.why && `Alasan: ${i.why}`,
    i.offer && `Pertukaran: ${i.offer}`,
    i.pitch && `Pesan ajakan:\n${i.pitch}`,
    i.first_step && `Langkah pertama: ${i.first_step}`,
  ].filter(Boolean).join('\n\n')
}

export function adsText(d) {
  const a = d.audience
  const lines = []
  lines.push('Audiens')
  if (a.age_range) lines.push(`- Usia: ${a.age_range}`)
  if (a.gender) lines.push(`- Gender: ${a.gender}`)
  if (a.locations.length) lines.push(`- Lokasi: ${a.locations.join('; ')}`)
  if (a.interests.length) lines.push(`- Minat: ${a.interests.join(', ')}`)
  if (a.behaviors.length) lines.push(`- Perilaku: ${a.behaviors.join(', ')}`)
  if (d.placements.length) lines.push('', `Penempatan: ${d.placements.join(', ')}`)
  if (d.schedule) lines.push('', `Jam tayang: ${d.schedule}`)
  if (d.budget_plan) lines.push('', `Anggaran: ${d.budget_plan}`)
  d.ad_copies.forEach((c, i) => lines.push('', `Materi ${i + 1}: ${c.headline}`, c.primary_text, c.cta ? `Tombol: ${c.cta}` : ''))
  if (d.hashtags.length) lines.push('', d.hashtags.join(' '))
  if (d.tips.length) lines.push('', 'Optimasi', ...d.tips.map((t) => `- ${t}`))
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n').trim()
}

/**
 * AI business adviser engine (ported from PR #3 "AI Superpowers").
 *
 * Kept from the PR, reworked: multi-agent definitions, conversation memory,
 * smart retry and analytics. Memory lives in this browser's localStorage, one
 * key per user, so it survives page changes and reloads without spending
 * database writes. Tools run client-side and deterministically (advisor-tools.js);
 * their results are injected as context instead of parsing tool calls out of
 * model text.
 */
import { getCloud } from '../cloud.js'
import { isQuotaError } from '../quota/errors.js'

export const AUTO = 'auto'
export const HISTORY_FOR_CONTEXT = 20
const MAX_HISTORY_CHARS = 3000
export const MEMORY_PREFIX = 'satualur_advisor_v1:'
export const MAX_PER_AGENT = 60
export const MAX_STORED_CHARS = 8000

const SHARED_RULES = `Aturan menjawab:
- Bahasa Indonesia yang hangat, lugas, dan profesional. Sapa pengguna dengan "Anda". Tanpa emoji.
- Anda menerima blok [DATA BISNIS PENGGUNA] dan kadang [KALKULATOR TARGET]. Kutip angka dari sana (format Rupiah, mis. Rp2.500.000) saat relevan. Jangan mengarang angka, pelanggan, atau tren yang tidak ada di data. Jika data kurang, katakan apa yang perlu dicatat.
- Patokan pertumbuhan: usaha perorangan/UKM sehat menargetkan 1–2% per bulan; enterprise 5–10% per bulan. Bandingkan dengan pertumbuhan aktual pengguna bila tersedia.
- Fokus pada bisnis jasa di Indonesia (servis AC, kebersihan, perbaikan, perawatan, dsb.): harga per pekerjaan, kapasitas teknisi, pelanggan berulang, WhatsApp, ulasan Google Maps, kontrak langganan.
- Format markdown ringkas: satu kalimat inti di awal, lalu poin atau langkah bernomor. Pakai **tebal** untuk angka kunci. Maksimal sekitar 250 kata kecuali diminta lebih.
- Tutup dengan bagian "Langkah minggu ini" berisi 1–3 tindakan konkret yang bisa diukur.`

/**
 * Agents. PR mapping: general → konsultan, analyst + report → keuangan.
 * The PR's offer agent stays in stage 02 (its own JSON pipeline) and its
 * social agent lives in the Social Media workspace.
 */
export const AGENTS = {
  konsultan: {
    name: 'Konsultan bisnis',
    role: 'Gambaran utuh dan prioritas',
    icon: 'compass',
    temperature: 0.6,
    prompt: 'Anda adalah konsultan bisnis senior untuk pemilik usaha jasa di Indonesia. Anda melihat gambaran utuh (pendapatan, biaya, alur kerja, pelanggan) lalu menentukan 1–3 prioritas yang paling berdampak pada pertumbuhan.',
    suggestions: ['Apa prioritas bisnis saya bulan ini?', 'Di mana titik lemah alur kerja saya?', 'Ringkas kondisi bisnis saya dalam 5 poin'],
  },
  keuangan: {
    name: 'Analis keuangan',
    role: 'Margin, biaya, harga, arus kas',
    icon: 'wallet',
    temperature: 0.4,
    prompt: 'Anda adalah analis keuangan untuk usaha jasa. Anda membaca margin, komposisi biaya, nilai rata-rata pekerjaan, dan arus kas, lalu memberi rekomendasi harga dan efisiensi biaya yang bisa dihitung.',
    suggestions: ['Biaya mana yang paling bisa dihemat?', 'Apakah harga saya sudah sehat?', 'Berapa margin ideal untuk layanan saya?'],
  },
  pertumbuhan: {
    name: 'Strategi pertumbuhan',
    role: 'Target, proyeksi, kapasitas',
    icon: 'trendingUp',
    temperature: 0.5,
    prompt: 'Anda adalah ahli strategi pertumbuhan untuk usaha jasa. Anda menerjemahkan target pertumbuhan bulanan menjadi jumlah pekerjaan, pelanggan, dan kapasitas yang dibutuhkan, memakai hasil kalkulator target bila tersedia.',
    suggestions: ['Bagaimana naik 2% bulan depan?', 'Realistiskah tumbuh 10% per bulan?', 'Berapa pekerjaan tambahan yang saya butuhkan?'],
  },
  pemasaran: {
    name: 'Pemasaran',
    role: 'Pelanggan baru dan berulang',
    icon: 'megaphone',
    temperature: 0.7,
    prompt: 'Anda adalah ahli pemasaran lokal untuk usaha jasa di Indonesia. Anda fokus pada cara mendapat pelanggan baru dan membuat pelanggan lama kembali: WhatsApp, ulasan Google Maps, referral, paket langganan, dan promosi musiman, dengan biaya terukur.',
    suggestions: ['Bagaimana membuat pelanggan kembali lagi?', 'Promosi murah apa yang cocok bulan ini?', 'Layanan mana yang sebaiknya saya promosikan?'],
  },
  operasional: {
    name: 'Operasional',
    role: 'Jadwal, tim, kualitas',
    icon: 'wrench',
    temperature: 0.5,
    prompt: 'Anda adalah konsultan operasional untuk usaha jasa lapangan. Anda melihat pekerjaan tertunda, konversi antar tahap, dan kapasitas tim untuk mempercepat waktu respon, menjaga kualitas, dan menambah pekerjaan tanpa menambah kekacauan.',
    suggestions: ['Pekerjaan mana yang tertahan paling lama?', 'Bagaimana menambah kapasitas tanpa rekrut?', 'Buatkan SOP singkat untuk tim lapangan'],
  },
}
export const AGENT_KEYS = Object.keys(AGENTS)
export const agentName = (key) => AGENTS[key]?.name || 'Penasihat'

/* ---------------------------------------------------------------- Router */

const ROUTES = {
  keuangan: ['biaya', 'hemat', 'margin', 'laba', 'rugi', 'untung', 'harga', 'tarif', 'arus kas', 'kas', 'modal', 'pengeluaran', 'keuangan', 'profit', 'hpp', 'pajak', 'utang', 'piutang', 'diskon', 'mahal', 'murah', 'efisien biaya', 'cash'],
  pertumbuhan: ['tumbuh', 'pertumbuhan', 'naik', 'target', 'persen', '%', 'omzet', 'omset', 'skala', 'ekspansi', 'cabang', 'proyeksi', 'bulan depan', 'tahun depan', 'growth', 'berkembang', 'meningkat', 'tambah pendapatan', 'pekerjaan tambahan'],
  pemasaran: ['promosi', 'promo', 'iklan', 'pemasaran', 'marketing', 'pelanggan baru', 'instagram', 'tiktok', 'whatsapp', 'google', 'ulasan', 'review', 'brand', 'merek', 'konten', 'referral', 'langganan', 'retensi', 'loyal', 'kembali lagi', 'repeat', 'testimoni'],
  operasional: ['jadwal', 'teknisi', 'pekerja', 'tim', 'karyawan', 'sop', 'kualitas', 'keluhan', 'komplain', 'respon', 'efisien', 'kapasitas', 'alat', 'stok', 'bahan', 'penugasan', 'lembur', 'tertunda', 'tertahan', 'antrian', 'lapangan', 'rekrut'],
  konsultan: ['prioritas', 'strategi', 'kondisi', 'ringkas', 'gambaran', 'titik lemah', 'evaluasi', 'saran umum', 'mulai dari mana'],
}
const ROUTE_ORDER = ['pertumbuhan', 'keuangan', 'pemasaran', 'operasional', 'konsultan']

/**
 * Picks an agent for a question with keyword rules (no extra model call).
 * Short follow-ups without keywords stay with the previous agent.
 */
export function routeQuestion(text, { lastAgent } = {}) {
  const q = ` ${String(text || '').toLowerCase()} `
  const scores = ROUTE_ORDER.map((key) => {
    const hits = ROUTES[key].filter((kw) => (kw.length <= 3 ? new RegExp(`(^|[^a-z])${kw.replace(/[%]/g, '\\%')}([^a-z]|$)`).test(q) : q.includes(kw)))
    return { key, hits, score: hits.reduce((s, kw) => s + (kw.includes(' ') ? 2 : 1), 0) }
  })
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
  if (best.score > 0) return { key: best.key, reason: 'keyword', hits: best.hits.slice(0, 3) }
  if (lastAgent && AGENTS[lastAgent]) return { key: lastAgent, reason: 'follow-up', hits: [] }
  return { key: 'konsultan', reason: 'default', hits: [] }
}

export function describeRoute(route) {
  if (!route) return ''
  if (route.reason === 'keyword') return `Dipilih otomatis dari kata "${route.hits.join('", "')}"`
  if (route.reason === 'follow-up') return 'Melanjutkan percakapan sebelumnya'
  return 'Dipilih otomatis sebagai penasihat umum'
}

/* -------------------------------------------------------------- Messages */

export function systemPrompt(agentKey, context) {
  const a = AGENTS[agentKey] || AGENTS.konsultan
  return `[agent:${agentKey}]\n${a.prompt}\n\n${SHARED_RULES}\n\n${context || '[DATA BISNIS PENGGUNA] Data belum dimuat.'}`
}

/** Turns stored rows into chat history (skips failed turns, trims long ones). */
export function toHistory(rows, limit = HISTORY_FOR_CONTEXT) {
  return rows
    .filter((r) => (r.role === 'user' || r.role === 'assistant') && String(r.content || '').trim())
    .slice(-limit)
    .map((r) => ({ role: r.role, content: String(r.content).slice(0, MAX_HISTORY_CHARS) }))
}

export function buildMessages({ agentKey, context, history = [], question }) {
  const msgs = [{ role: 'system', content: systemPrompt(agentKey, context) }, ...history]
  // Chat templates want alternating turns; drop a dangling user turn before the new one.
  while (msgs.length > 1 && msgs[msgs.length - 1].role === 'user') msgs.pop()
  msgs.push({ role: 'user', content: question })
  return msgs
}

/* ------------------------------------------------------------ Smart retry */

const abortError = () => new DOMException('Dibatalkan', 'AbortError')
const isAbort = (e) => e?.name === 'AbortError'

/** Network failures and 5xx responses are worth one more try; 4xx are not. */
export function isRetryable(err) {
  if (!err || isAbort(err) || isQuotaError(err)) return false
  if (err instanceof TypeError) return true
  return /HTTP 5\d\d|\b50[0-9]\b|jaringan|network|failed to fetch|load failed|timeout|tidak tersedia|overload|unavailable|ECONN/i.test(String(err.message || ''))
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()) }, { once: true })
  })
}

/** Iterates an async stream but rejects as soon as `signal` aborts. */
async function* raceAbort(stream, signal) {
  const it = stream[Symbol.asyncIterator]()
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError())
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
  aborted.catch(() => {})
  try {
    while (true) {
      const r = await Promise.race([it.next(), aborted])
      if (r.done) return
      yield r.value
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try { it.return?.()?.catch?.(() => {}) } catch { /* ignore */ }
  }
}

/**
 * Streams one answer. Yields { type: 'delta', delta, full } and
 * { type: 'retry', error } events; resolves with { full, latency, retried }.
 * Retries once when the call fails before any text arrives.
 */
// feature: 'advisor' for the advisor chat, 'radar' for Radar peluang explanations (metered separately).
export async function* streamAnswer({ messages, model, temperature = 0.6, maxTokens = 1500, signal, feature = 'advisor' }) {
  const started = performance.now()
  let full = ''
  let retried = false
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = getCloud().llm.chat.completions.create({
        model, messages, stream: true, temperature, max_tokens: maxTokens, signal, feature,
      })
      for await (const chunk of raceAbort(stream, signal)) {
        const delta = chunk?.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          yield { type: 'delta', delta, full }
        }
      }
      return { full, latency: Math.round(performance.now() - started), retried }
    } catch (err) {
      if (isAbort(err) || signal?.aborted) throw isAbort(err) ? err : abortError()
      if (attempt === 0 && !full && isRetryable(err)) {
        retried = true
        yield { type: 'retry', error: err }
        await sleep(900, signal)
        continue
      }
      err.partial = full
      err.latency = Math.round(performance.now() - started)
      throw err
    }
  }
  return { full, latency: Math.round(performance.now() - started), retried }
}

/* ---------------------------------------------------------------- Memory */

export const memoryKey = (uid) => `${MEMORY_PREFIX}${uid || 'anon'}`

function readMemory(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(memoryKey(uid)) || '[]')
    return Array.isArray(raw) ? raw.filter((r) => r && AGENT_KEYS.includes(r.agent) && (r.role === 'user' || r.role === 'assistant')) : []
  } catch { return [] }
}

/** Keeps the newest MAX_PER_AGENT messages of each agent. Returns false when storage refused the write. */
function writeMemory(uid, rows) {
  const keep = new Set()
  for (const key of AGENT_KEYS) rows.filter((r) => r.agent === key).slice(-MAX_PER_AGENT).forEach((r) => keep.add(r))
  const list = rows.filter((r) => keep.has(r))
  try {
    localStorage.setItem(memoryKey(uid), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

let seq = 0
const newId = () => `m${Date.now().toString(36)}${(++seq).toString(36)}`

/** Loads the adviser's messages (all agents) for one user, oldest first. */
export async function loadMessages({ uid } = {}) {
  return { rows: readMemory(uid) }
}

/** Appends one message to the user's memory and returns the stored row. */
export async function saveMessage(row, { uid } = {}) {
  const saved = {
    id: newId(),
    agent: row.agent,
    role: row.role,
    content: String(row.content ?? '').slice(0, MAX_STORED_CHARS),
    model: row.model ?? null,
    latency_ms: row.latency_ms ?? null,
    error: row.error ?? null,
    created_at: row.created_at || new Date().toISOString(),
  }
  const rows = readMemory(uid)
  rows.push(saved)
  if (!writeMemory(uid, rows)) throw new Error('Penyimpanan browser penuh atau dinonaktifkan.')
  return saved
}

/** Removes one stored message (e.g. a failed answer that is being retried). */
export async function deleteMessage(id, { uid } = {}) {
  writeMemory(uid, readMemory(uid).filter((r) => r.id !== id))
}

/** Deletes the conversation of the given agents. */
export async function clearMessages(agentKeys, { uid } = {}) {
  const keys = new Set(agentKeys.filter((k) => AGENTS[k]))
  writeMemory(uid, readMemory(uid).filter((r) => !keys.has(r.agent)))
}

/* ------------------------------------------------------------- Analytics */

/** Real usage numbers from stored assistant turns. */
export function computeAnalytics(rows) {
  const answers = rows.filter((r) => r.role === 'assistant')
  const stat = () => ({ count: 0, ok: 0, errors: 0, stopped: 0, latencySum: 0, latencyN: 0 })
  const total = stat()
  const by = Object.fromEntries(AGENT_KEYS.map((k) => [k, stat()]))
  for (const r of answers) {
    for (const s of [total, by[r.agent]].filter(Boolean)) {
      s.count++
      if (r.error === 'aborted') s.stopped++
      else if (r.error) s.errors++
      else {
        s.ok++
        if (Number(r.latency_ms) > 0) { s.latencySum += Number(r.latency_ms); s.latencyN++ }
      }
    }
  }
  const finish = (s) => ({
    count: s.count, ok: s.ok, errors: s.errors, stopped: s.stopped,
    avgLatency: s.latencyN ? Math.round(s.latencySum / s.latencyN) : null,
    errorRate: s.count - s.stopped > 0 ? (s.errors / (s.count - s.stopped)) * 100 : null,
  })
  return {
    questions: rows.filter((r) => r.role === 'user').length,
    ...finish(total),
    byAgent: AGENT_KEYS.map((k) => ({ key: k, name: AGENTS[k].name, ...finish(by[k]) })),
  }
}

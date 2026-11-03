/**
 * Multi-team optimisation engine.
 *
 * Income work on Satu Alur is never one person's job. Five teams look at the
 * same brief from different angles, in parallel, and a lead agent merges their
 * proposals into one ranked plan with owners and Rupiah attached.
 *
 *   Kreatif      — nama, kemasan, cerita yang membuat orang mau membayar
 *   Marketing    — permintaan, kanal, momen penawaran
 *   Keuangan     — harga, margin, arus kas, titik balik modal
 *   Operasional  — kapasitas, jadwal, apakah bisa dikerjakan
 *   Riset        — bukti, asumsi, apa yang harus dibuktikan lebih dulu
 *
 * The engine streams: each team's text arrives as it is written, then the lead
 * synthesis streams once all five are in. Callers consume events, never await
 * a black box, so the UI can show work in progress.
 */
import { streamAnswer } from './advisor.js'

export const SCOPE_LABEL = {
  vas: 'Layanan tambahan (VAS)',
  waste: 'Tanpa limbah (zero waste)',
}

export const TEAMS = {
  kreatif: {
    name: 'Tim Kreatif',
    role: 'Nama, kemasan, cerita',
    icon: 'wand',
    temperature: 0.85,
    brief: 'Anda membuat tawaran yang ingin dibeli orang: nama yang jelas, kemasan yang mudah dipahami, dan alasan emosional yang jujur. Anda benci jargon dan paket yang membingungkan.',
    asks: ['Usulkan nama dan isi paket yang bisa dijelaskan dalam satu kalimat.', 'Tentukan apa yang membuat pelanggan memilih paket ini, bukan menunda.', 'Sebutkan satu hal yang harus dihapus karena membuat tawaran terasa rumit.'],
  },
  pemasaran: {
    name: 'Tim Marketing',
    role: 'Permintaan & kanal',
    icon: 'megaphone',
    temperature: 0.7,
    brief: 'Anda menciptakan permintaan dengan biaya terukur: WhatsApp, ulasan Google Maps, referral, dan momen setelah pekerjaan selesai. Anda tidak percaya pada promosi tanpa angka.',
    asks: ['Tentukan kanal termurah untuk menjangkau pelanggan yang sudah ada.', 'Tentukan momen penawaran yang paling tepat dalam alur kerja.', 'Perkirakan berapa pelanggan yang bisa dijangkau bulan ini dan berapa biayanya.'],
  },
  keuangan: {
    name: 'Tim Keuangan',
    role: 'Harga, margin, arus kas',
    icon: 'wallet',
    temperature: 0.35,
    brief: 'Anda menjaga agar setiap rupiah yang masuk benar-benar untung. Anda menghitung margin, biaya tambahan, dan berapa lama modal kembali. Anda berani menolak usulan yang tidak menutup biaya.',
    asks: ['Hitung margin dan harga minimum yang masih sehat.', 'Hitung berapa pekerjaan atau pelanggan yang dibutuhkan agar usulan ini layak.', 'Sebutkan satu usulan dari tim lain yang berisiko secara biaya, bila ada.'],
  },
  operasional: {
    name: 'Tim Operasional',
    role: 'Kapasitas & eksekusi',
    icon: 'wrench',
    temperature: 0.5,
    brief: 'Anda memastikan tawaran bisa dikerjakan tanpa merusak jadwal. Anda melihat kapasitas teknisi, waktu per pekerjaan, dan kualitas yang bisa dijaga.',
    asks: ['Perkirakan tambahan waktu kerja per pekerjaan dan apakah tim sanggup.', 'Tentukan perubahan jadwal atau SOP yang dibutuhkan.', 'Sebutkan titik gagal yang paling mungkin terjadi di lapangan.'],
  },
  riset: {
    name: 'Tim Riset & Data',
    role: 'Bukti & asumsi',
    icon: 'search',
    temperature: 0.3,
    brief: 'Anda memisahkan angka yang benar-benar diketahui dari asumsi. Anda menyebutkan apa yang harus diukur lebih dulu sebelum uang dikeluarkan, dan Anda menolak proyeksi yang tidak punya dasar.',
    asks: ['Pisahkan fakta dari asumsi pada brief ini.', 'Sebutkan satu pengukuran murah yang harus dijalankan minggu ini.', 'Tentukan angka mana yang paling rapuh dan bisa membatalkan seluruh rencana.'],
  },
}
export const TEAM_KEYS = Object.keys(TEAMS)

export const LEAD = {
  name: 'Pimpinan Optimasi',
  role: 'Menyatukan lima tim',
  icon: 'compass',
  temperature: 0.4,
}

const SHARED = `Aturan menjawab:
- Bahasa Indonesia yang lugas dan profesional. Sapa pengguna dengan "Anda". Tanpa emoji, tanpa basa-basi pembuka.
- Anda hanya boleh memakai angka dari blok [ANGKA BISNIS] dan [BRIEF]. Jangan mengarang pelanggan, harga, atau tren. Bila sebuah angka tidak tersedia, tulis asumsinya terang-terangan dengan kata "asumsi".
- Format markdown ringkas: satu kalimat tesis, lalu 3 usulan bernomor, lalu bagian **Risiko** berisi satu kalimat.
- Setiap usulan wajib memuat angka: Rupiah, jumlah pekerjaan, jumlah pelanggan, atau persen.
- Maksimal 180 kata. Tidak perlu menyapa atau menutup dengan pertanyaan.`

function businessBlock(context) {
  return context?.trim() ? `[ANGKA BISNIS]\n${context.trim()}` : '[ANGKA BISNIS] Data bisnis belum dimuat.'
}

function briefBlock(brief) {
  return `[BRIEF]\nCakupan: ${SCOPE_LABEL[brief.scope] || brief.scope}\nMasalah yang ingin dipecahkan: ${brief.problem || 'meningkatkan pendapatan tanpa menambah biaya besar'}\nTarget tambahan pendapatan: ${brief.target ? `Rp${Number(brief.target).toLocaleString('id-ID')} per bulan` : 'belum ditentukan'}\nCatatan pemilik usaha: ${brief.note || 'tidak ada'}`
}

export function teamMessages(teamKey, brief, context) {
  const team = TEAMS[teamKey]
  const system = `[agent:tim-${teamKey}]\nAnda adalah ${team.name} dalam ruang optimasi pendapatan sebuah usaha jasa di Indonesia.\n${team.brief}\n\n${SHARED}\n\n${briefBlock(brief)}\n\n${businessBlock(context)}`
  const user = `Berikan sudut pandang ${team.name} untuk brief di atas.\n${team.asks.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

export function leadMessages(brief, results, context) {
  const sections = TEAM_KEYS
    .filter((k) => String(results[k] || '').trim())
    .map((k) => `### ${TEAMS[k].name}\n${String(results[k]).trim()}`)
    .join('\n\n')
  const system = `[agent:pimpinan-optimasi]\nAnda adalah Pimpinan Optimasi. Lima tim sudah mengirim usulan terpisah. Tugas Anda menyatukannya menjadi satu rencana yang bisa dijalankan minggu ini.\n\nAturan:
- Bahasa Indonesia lugas, sapaan "Anda", tanpa emoji.
- Jangan mengulang isi tiap tim. Ambil yang terbaik dan buang yang bertabrakan.
- Bila dua tim bertentangan, sebutkan pertentangannya dalam satu kalimat lalu ambil keputusan.
- Semua angka harus berasal dari usulan tim atau [ANGKA BISNIS]. Jangan menambah angka baru.
- Format: "**Keputusan**" (2 kalimat), lalu "**Rencana 3 langkah**" (bernomor, tiap langkah memuat pemilik tim, tenggat dalam hari, dan dampak Rupiah), lalu "**Yang saya tolak**" (1–2 poin beserta alasannya), lalu "**Ukuran keberhasilan**" (satu angka yang dipantau mingguan).
- Maksimal 260 kata.

${briefBlock(brief)}

${businessBlock(context)}`
  const user = `Berikut usulan lima tim.\n\n${sections || '(tidak ada usulan yang berhasil dikumpulkan)'}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

/* --------------------------------------------------------------- Streaming */

/** Minimal async queue so five parallel streams can be consumed in order. */
class Queue {
  constructor() { this.items = []; this.waiters = []; this.ended = false }
  push(item) {
    if (this.ended) return
    const w = this.waiters.shift()
    if (w) w(item)
    else this.items.push(item)
  }
  end() {
    this.ended = true
    while (this.waiters.length) this.waiters.shift()(null)
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.items.length) { yield this.items.shift(); continue }
      if (this.ended) return
      const item = await new Promise((resolve) => this.waiters.push(resolve))
      if (item === null) return
      yield item
    }
  }
}

/**
 * Runs the five teams in parallel, then the lead synthesis.
 *
 * Yields events:
 *   { type: 'team-start', key }
 *   { type: 'team-delta', key, full }
 *   { type: 'team-retry', key }
 *   { type: 'team-done', key, text }
 *   { type: 'team-error', key, message }
 *   { type: 'teams-complete', results }
 *   { type: 'lead-start' }
 *   { type: 'lead-delta', full }
 *   { type: 'lead-retry' }
 *   { type: 'done', text, results }
 *   { type: 'lead-error', message }
 */
export async function* runOptimization({ brief, context, model, signal, maxTokens = 700 }) {
  const q = new Queue()
  const results = {}
  let remaining = TEAM_KEYS.length

  const tasks = TEAM_KEYS.map((key) => (async () => {
    q.push({ type: 'team-start', key })
    let full = ''
    try {
      for await (const step of streamAnswer({
        messages: teamMessages(key, brief, context),
        model,
        temperature: TEAMS[key].temperature,
        maxTokens,
        signal,
        feature: 'income',
      })) {
        if (step.type === 'delta') { full = step.full; q.push({ type: 'team-delta', key, full }) }
        else if (step.type === 'retry') q.push({ type: 'team-retry', key })
      }
      results[key] = full.trim()
      q.push({ type: 'team-done', key, text: results[key] })
    } catch (err) {
      if (err?.name === 'AbortError') { results[key] = ''; return }
      results[key] = ''
      q.push({ type: 'team-error', key, message: err?.message || 'Tim ini gagal menjawab.' })
    } finally {
      remaining -= 1
      if (remaining === 0) {
        q.push({ type: 'teams-complete', results: { ...results } })
        q.end()
      }
    }
  })())

  for await (const ev of q) {
    yield ev
    if (ev.type === 'teams-complete') break
  }
  await Promise.allSettled(tasks)
  if (signal?.aborted) return

  yield { type: 'lead-start' }
  let lead = ''
  try {
    for await (const step of streamAnswer({
      messages: leadMessages(brief, results, context),
      model,
      temperature: LEAD.temperature,
      maxTokens: 1100,
      signal,
      feature: 'income',
    })) {
      if (step.type === 'delta') { lead = step.full; yield { type: 'lead-delta', full: lead } }
      else if (step.type === 'retry') yield { type: 'lead-retry' }
    }
    if (lead.trim()) yield { type: 'done', text: lead.trim(), results }
    else yield { type: 'lead-error', message: 'Pimpinan optimasi tidak mengembalikan jawaban.' }
  } catch (err) {
    if (err?.name === 'AbortError') return
    yield { type: 'lead-error', message: err?.message || 'Penyatuan gagal.' }
  }
}

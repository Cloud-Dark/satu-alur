/**
 * Waguri's skills (pure; no I/O). A skill is what the user picks before asking:
 * its own system prompt, suggestion chips and the deterministic answer kind the
 * widget runs first ('progress' | 'finance' | 'message' | 'kb').
 * modes: where it shows — 'app' (signed in, may read the user's own data) or
 * 'public' (landing / login pages, public knowledge only, never user data).
 */

export const PERSONA = `[agent:waguri] Kamu Waguri, asisten AI Satu Alur: rekan kantor yang ramah, sopan, dan jujur. Jawab dalam bahasa Indonesia yang hangat dan ringkas (paling banyak 120 kata), satu hal per giliran. Pakai hanya fakta di BAHAN; jangan mengarang angka, nama, harga, atau fitur. Bila jawabannya tidak ada di BAHAN, katakan terus terang bahwa kamu belum tahu dan sarankan langkah yang aman. Jangan memakai markdown tabel atau HTML; boleh memakai poin "•".`

export const SKILLS = [
  {
    id: 'progress', modes: ['app'], kind: 'progress', icon: 'activity',
    label: 'Cek progres proyek',
    hint: 'Sebut nama pelanggan, saya cek posisinya di Alur kerja.',
    placeholder: 'Contoh: proyek dengan PT Maju Jaya sudah sampai mana?',
    suggestions: ['Proyek dengan PT Maju Jaya sudah sampai mana?', 'Pekerjaan mana yang paling lama menunggu?', 'Progres Hotel Grand Lestari'],
    system: 'Tugasmu: menjelaskan posisi pekerjaan pelanggan di alur Permintaan → Penawaran → Penugasan → Penyelesaian → Pembukuan, dan langkah berikutnya.',
  },
  {
    id: 'guide', modes: ['app'], kind: 'kb', icon: 'compass',
    label: 'Panduan Satu Alur',
    hint: 'Tanya cara memakai menu apa pun di Satu Alur.',
    placeholder: 'Contoh: bagaimana cara membuat invoice?',
    suggestions: ['Bagaimana cara membuat invoice?', 'Apa itu kolom Posisi di Alur kerja?', 'Di mana saya melihat sisa kuota AI?'],
    system: 'Tugasmu: memandu pemakaian aplikasi Satu Alur, menu demi menu, dengan langkah yang jelas.',
  },
  {
    id: 'finance', modes: ['app'], kind: 'finance', icon: 'chart',
    label: 'Ringkas keuangan',
    hint: 'Pendapatan, biaya, dan laba dari buku besar Anda.',
    placeholder: 'Contoh: berapa laba bulan ini?',
    suggestions: ['Ringkas keuangan saya', 'Berapa laba bulan ini?', 'Ada tagihan yang belum lunas?'],
    system: 'Tugasmu: meringkas pendapatan, biaya, dan laba dari buku besar pengguna dengan angka persis seperti di BAHAN.',
  },
  {
    id: 'message', modes: ['app'], kind: 'message', icon: 'send',
    label: 'Bantu tulis pesan',
    hint: 'Draf WhatsApp atau email follow-up untuk pelanggan.',
    placeholder: 'Contoh: tulis WA follow-up untuk Apartemen GreenView',
    suggestions: ['Tulis WA follow-up untuk Apartemen GreenView', 'Draf email konfirmasi jadwal untuk PT Sinar Abadi', 'Pesan terima kasih untuk Rumah Bapak Surya'],
    system: 'Tugasmu: menulis satu pesan follow-up yang sopan dan siap kirim untuk pelanggan, berdasarkan posisi pekerjaannya. Keluarkan hanya isi pesannya.',
  },
  {
    id: 'about', modes: ['public'], kind: 'kb', icon: 'sparkles',
    label: 'Tentang Satu Alur',
    hint: 'Apa itu Satu Alur dan apa saja fiturnya.',
    placeholder: 'Contoh: Satu Alur itu untuk usaha apa?',
    suggestions: ['Satu Alur itu aplikasi apa?', 'Fitur AI apa saja yang ada?', 'Apakah data saya aman?'],
    only: ['tentang', 'fitur', 'ai', 'data', 'kontak'],
    system: 'Tugasmu: menjelaskan Satu Alur kepada calon pengguna dengan jujur, hanya dari BAHAN.',
  },
  {
    id: 'pricing', modes: ['public'], kind: 'kb', icon: 'wallet',
    label: 'Harga & paket',
    hint: 'Paket, harga, dan batasnya.',
    placeholder: 'Contoh: ada paket gratis?',
    suggestions: ['Berapa harga paketnya?', 'Apa batasan paket gratis?', 'Paket mana yang cocok untuk tim 5 orang?'],
    only: ['harga', 'kontak'],
    system: 'Tugasmu: menjelaskan paket dan harga persis seperti di BAHAN. Jangan menjanjikan diskon atau harga lain.',
  },
  {
    id: 'start', modes: ['public'], kind: 'kb', icon: 'arrowRight',
    label: 'Cara mulai',
    hint: 'Langkah pertama memakai Satu Alur.',
    placeholder: 'Contoh: bagaimana cara daftar?',
    suggestions: ['Bagaimana cara mulai?', 'Apakah perlu kata sandi?', 'Setelah masuk, apa yang pertama dikerjakan?'],
    only: ['mulai', 'data', 'kontak'],
    system: 'Tugasmu: memandu calon pengguna memulai Satu Alur, langkah demi langkah.',
  },
]

export const PUBLIC_SKILL_IDS = SKILLS.filter((s) => s.modes.includes('public')).map((s) => s.id)

/** Skills for a mode, in display order. */
export const skillsFor = (mode) => SKILLS.filter((s) => s.modes.includes(mode === 'app' ? 'app' : 'public'))

/** A skill by id within a mode; falls back to the mode's first skill. */
export function skillById(id, mode) {
  const list = skillsFor(mode)
  return list.find((s) => s.id === id) || list[0]
}

/** Greeting bubble for a mode. */
export function greeting(mode, name = '') {
  const hi = name ? `Halo, ${name}!` : 'Halo!'
  return mode === 'app'
    ? `${hi} Aku Waguri. Pilih keahlian di atas, lalu tanya apa saja: posisi proyek pelanggan, cara memakai menu, ringkasan keuangan, atau draf pesan follow-up.`
    : `${hi} Aku Waguri, asisten AI Satu Alur. Tanya apa saja tentang Satu Alur, harga paket, atau cara mulai.`
}

const MAX_HISTORY = 6
const MAX_TURN_CHARS = 800

/** Recent turns for the model: user/assistant only, trimmed. */
export function historyTurns(history = []) {
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.text.slice(0, MAX_TURN_CHARS) }))
}

/** Chat messages for one question: persona + skill prompt, recent turns, then BAHAN + question. */
export function buildMessages({ skill, question, context = '', history = [] }) {
  return [
    { role: 'system', content: `${PERSONA}\n\n${skill.system}` },
    ...historyTurns(history),
    { role: 'user', content: `BAHAN:\n${String(context).slice(0, 6000)}\n\nPERTANYAAN:\n${String(question).slice(0, MAX_TURN_CHARS)}` },
  ]
}

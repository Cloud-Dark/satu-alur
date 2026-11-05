/**
 * Waguri's knowledge base (pure; no I/O). Short, checked facts about Satu Alur that
 * Waguri may repeat. Two scopes:
 *   public  what anyone may read on the landing page (about, pricing, how to start)
 *   app     how to use the app, menu by menu (shown to signed-in users)
 * The Worker's public endpoint (worker/waguri.js) builds its prompt from the public
 * entries only, so a signed-out visitor never gets more than the landing page says.
 */
import { PRICING_TIERS, PRICING_NOTE } from '../landing/pricing.js'

/**
 * id, scope, title, keys (words or phrases that point here), text (the answer),
 * stage (app: the menu to open), href (public: the page to open).
 */
export const ENTRIES = [
  /* ------------------------------------------------------------ Public */
  {
    id: 'tentang', scope: 'public', title: 'Apa itu Satu Alur',
    keys: ['apa itu', 'satu alur', 'tentang', 'aplikasi apa', 'fungsi', 'untuk apa', 'kegunaan', 'manfaat', 'siapa'],
    text: 'Satu Alur adalah aplikasi untuk usaha jasa di Indonesia (servis AC, kebersihan, pest control, perawatan kolam, dan sejenisnya). Semua pekerjaan berjalan di satu alur: permintaan pelanggan, penawaran yang disusun AI lalu diperiksa aturan bisnis, penugasan petugas, penyelesaian, pembukuan, sampai laporan untung-rugi. Setelah alurnya rapi, ada menu Pendapatan (layanan tambahan, tanpa limbah) dan Pertumbuhan (radar peluang, pencari prospek, media sosial, penasihat AI).',
    href: '#/tentang',
  },
  {
    id: 'fitur', scope: 'public', title: 'Fitur utama',
    keys: ['fitur', 'bisa apa', 'kemampuan', 'menu', 'modul', 'ai apa', 'penawaran ai', 'laporan ai', 'radar', 'prospek', 'media sosial'],
    text: 'Fitur utama: (1) Alur kerja dari permintaan sampai pembukuan dalam satu tabel, (2) penawaran yang disusun AI dan selalu divalidasi aturan sebelum disimpan, (3) penugasan petugas dan jadwal, (4) pembukuan dan laporan laba-rugi yang dijelaskan AI, (5) invoice yang bisa dikirim lewat email atau WhatsApp, (6) layanan tambahan dan pencatatan pemborosan, (7) radar peluang, pencari prospek di peta, konten media sosial, dan penasihat AI yang membaca angka bisnis Anda sendiri.',
  },
  {
    id: 'harga', scope: 'public', title: 'Harga & paket',
    keys: ['harga', 'biaya', 'paket', 'berlangganan', 'langganan', 'gratis', 'bayar', 'tarif', 'mahal', 'murah', 'enterprise', 'ukm', 'sole trader', 'trial', 'coba'],
    text: '', // filled from the plans by pricingText()
    href: '#harga',
  },
  {
    id: 'mulai', scope: 'public', title: 'Cara mulai',
    keys: ['cara mulai', 'mulai', 'daftar', 'masuk', 'login', 'registrasi', 'akun', 'otp', 'email', 'demo', 'langkah awal', 'memulai', 'sign up'],
    text: 'Cara mulai: (1) tekan "Mulai gratis" atau "Masuk", (2) isi email Anda, lalu masukkan kode sekali pakai (OTP) yang kami kirim, tidak perlu kata sandi, (3) setelah masuk, catat permintaan pelanggan pertama di menu Alur kerja › Permintaan baru, lalu buat penawarannya dengan AI. Data contoh tidak dicampur dengan data Anda.',
    href: '#/masuk',
  },
  {
    id: 'data', scope: 'public', title: 'Keamanan data',
    keys: ['data', 'aman', 'keamanan', 'privasi', 'disimpan', 'simpan', 'bocor', 'rahasia'],
    text: 'Data bisnis disimpan di cloud dan terikat ke akun Anda, terpisah dari pengguna lain. Fitur Pertumbuhan hanya membaca data milik akun Anda sendiri. Rincian ada di halaman Privasi.',
    href: '#/privasi',
  },
  {
    id: 'ai', scope: 'public', title: 'AI di Satu Alur',
    keys: ['ai', 'kecerdasan buatan', 'model', 'dipercaya', 'akurat', 'gpt', 'llm'],
    text: 'AI menyusun draf penawaran, menjelaskan laporan, dan membantu konten serta analisis. Hasil penawaran selalu melewati validasi aturan bisnis sebelum disimpan, dan keputusan akhir tetap di tangan Anda. Pemakaian AI dihitung per fitur sesuai kuota paket.',
  },
  {
    id: 'kontak', scope: 'public', title: 'Kontak & bantuan',
    keys: ['kontak', 'hubungi', 'tim', 'sales', 'bantuan', 'cs', 'customer service', 'keluhan', 'tanya tim'],
    text: 'Untuk pertanyaan penjualan atau kerja sama, isi formulir di halaman Kontak. Pengguna yang sudah masuk bisa mengirim tiket lewat menu Bantuan di dalam aplikasi dan mengikuti balasannya di sana.',
    href: '#/kontak',
  },

  /* --------------------------------------------------------------- App */
  {
    id: 'ringkasan', scope: 'app', title: 'Ringkasan', stage: 'dashboard',
    keys: ['ringkasan', 'dashboard', 'beranda', 'kpi', 'grafik', 'perlu tindakan', 'aktivitas'],
    text: 'Menu Ringkasan menampilkan laba, pendapatan, biaya, dan tingkat penyelesaian dari data Anda, plus corong alur, daftar "Perlu tindakan", dan aktivitas terbaru. Klik baris corong untuk membuka tahapnya.',
  },
  {
    id: 'alur-kerja', scope: 'app', title: 'Alur kerja', stage: 'workflow',
    keys: ['alur kerja', 'alur', 'workflow', 'tabel', 'posisi', 'langkah berikutnya', 'sampai mana', 'tahap', 'filter'],
    text: 'Alur kerja adalah tabel dengan satu baris untuk satu pekerjaan pelanggan: Permintaan → Penawaran → Penugasan → Penyelesaian → Pembukuan. Kolom Posisi menunjukkan sudah sampai mana, dan tombol "Langkah berikutnya" membuka tahap yang perlu dikerjakan. Pakai tab filter (Perlu penugasan, Dikerjakan, Perlu dibukukan, …) dan kotak cari untuk menemukan pelanggan.',
  },
  {
    id: 'permintaan', scope: 'app', title: 'Permintaan', stage: 'request',
    keys: ['permintaan', 'request', 'catat pelanggan', 'pelanggan baru', 'order', 'pesanan', 'isi otomatis'],
    text: 'Catat kebutuhan pelanggan di Alur kerja › Permintaan baru: nama pelanggan, layanan, lokasi, dan deskripsi. Tombol "Isi otomatis dengan AI" bisa merapikan potongan chat pelanggan menjadi deskripsi yang rinci.',
  },
  {
    id: 'penawaran', scope: 'app', title: 'Penawaran', stage: 'offer',
    keys: ['penawaran', 'offer', 'harga penawaran', 'proposal', 'quotation', 'kirim penawaran', 'setujui'],
    text: 'Di tahap Penawaran, AI menyusun ruang lingkup, harga, dan ketentuan dari permintaan. Aturan bisnis memeriksanya sebelum disimpan. Anda bisa mengubah isinya, mengirimnya lewat email atau WhatsApp, lalu menandainya disetujui atau ditolak.',
  },
  {
    id: 'penugasan', scope: 'app', title: 'Penugasan', stage: 'assign',
    keys: ['penugasan', 'tugaskan', 'petugas', 'teknisi', 'jadwal', 'assign', 'pekerja'],
    text: 'Penawaran yang disetujui dijadwalkan di tahap Penugasan: pilih petugas dan tanggalnya. Data petugas dikelola di menu yang sama.',
  },
  {
    id: 'penyelesaian', scope: 'app', title: 'Penyelesaian', stage: 'complete',
    keys: ['penyelesaian', 'selesai', 'tandai selesai', 'hasil kerja', 'complete'],
    text: 'Setelah pekerjaan di lapangan beres, tutup penugasannya di tahap Penyelesaian dengan catatan hasil kerja. Setelah itu pekerjaan siap dibukukan.',
  },
  {
    id: 'pembukuan', scope: 'app', title: 'Pembukuan', stage: 'bookkeeping',
    keys: ['pembukuan', 'bukukan', 'jurnal', 'ledger', 'catat biaya', 'catat pendapatan', 'saldo'],
    text: 'Di Pembukuan Anda mencatat pendapatan dan biaya (tenaga, bahan, transportasi, lain-lain) per pekerjaan. Saldo dihitung berjalan dan menjadi dasar Laporan.',
  },
  {
    id: 'laporan', scope: 'app', title: 'Laporan', stage: 'report',
    keys: ['laporan', 'untung', 'rugi', 'laba', 'report', 'keuangan', 'periode'],
    text: 'Menu Laporan menampilkan untung-rugi untuk periode yang dipilih, dihitung dari buku besar, dan AI bisa menjelaskan angkanya dalam bahasa sederhana.',
  },
  {
    id: 'invoice', scope: 'app', title: 'Invoice', stage: 'invoice',
    keys: ['invoice', 'tagihan', 'faktur', 'lunas', 'ppn', 'kirim tagihan'],
    text: 'Di menu Invoice Anda membuat tagihan dari pekerjaan yang selesai, mengirimnya lewat email atau WhatsApp, lalu menandainya lunas. Pendapatannya otomatis masuk Pembukuan.',
  },
  {
    id: 'pendapatan', scope: 'app', title: 'Layanan tambahan & Tanpa limbah', stage: 'vas',
    keys: ['layanan tambahan', 'vas', 'upsell', 'katalog', 'tanpa limbah', 'pemborosan', 'limbah', 'zero waste', 'kebocoran'],
    text: 'Grup Pendapatan berisi dua menu: Layanan tambahan (katalog add-on yang dijual bersama pekerjaan yang ada) dan Tanpa limbah (catat pemborosan waktu, perjalanan, bahan, pekerjaan ulang, air dan kimia dalam Rupiah).',
  },
  {
    id: 'pertumbuhan', scope: 'app', title: 'Pertumbuhan', stage: 'radar',
    keys: ['radar', 'peluang', 'prospek', 'pencari prospek', 'media sosial', 'konten', 'penasihat', 'advisor', 'superpowers', 'pertumbuhan'],
    text: 'Grup Pertumbuhan: Radar peluang (layanan rutin jatuh tempo, pelanggan yang menghilang), Pencari prospek (peta dan radius), Media Sosial (konten dan jadwal), Penasihat AI (multi-agen yang membaca angka bisnis Anda), dan AI Superpowers.',
  },
  {
    id: 'kuota', scope: 'app', title: 'Paket & kuota', stage: 'plan',
    keys: ['kuota', 'paket saya', 'voucher', 'saldo ai', 'habis', 'upgrade', 'langganan saya'],
    text: 'Menu Paket & kuota menunjukkan paket Anda, sisa kuota AI bulan ini per fitur, saldo AI, dan tempat menukar voucher. Kuota direset setiap tanggal 1.',
  },
  {
    id: 'bantuan', scope: 'app', title: 'Bantuan', stage: 'support',
    keys: ['bantuan', 'tiket', 'support', 'keluhan', 'error', 'masalah', 'hubungi tim'],
    text: 'Menu Bantuan untuk mengirim tiket ke tim Satu Alur. Balasan muncul di tiket yang sama, dengan status Terbuka, Diproses, atau Selesai.',
  },
  {
    id: 'pengaturan', scope: 'app', title: 'Pengaturan',
    keys: ['pengaturan', 'setting', 'integrasi', 'prompt', 'agent skill', 'model ai', 'temperature', 'whatsapp', 'tema', 'mode gelap'],
    text: 'Pengaturan (di bawah sidebar) berisi integrasi (email, WhatsApp, penyedia AI sendiri bila diizinkan), Agent Skill Editor untuk mengubah prompt AI, dan preferensi lain. Mode gelap ada di tombol bulan/matahari di bagian atas.',
  },
]

const STOP = new Set(['yang', 'di', 'ke', 'dari', 'dan', 'atau', 'apa', 'apakah', 'bagaimana', 'gimana', 'saya', 'aku', 'kami', 'kita', 'untuk', 'dengan', 'ini', 'itu', 'ada', 'bisa', 'mana', 'sudah', 'belum', 'kok', 'ya', 'sih', 'dong', 'nya', 'tolong', 'mau', 'ingin', 'buat', 'bikin', 'pakai', 'pake', 'menu', 'halaman', 'fitur', 'kak', 'min', 'waguri', 'tolong', 'jelaskan', 'cara', 'caranya', 'adalah', 'tentang', 'the', 'is', 'how', 'to', 'a', 'an', 'of'])

/** Lowercase, accents and punctuation removed, single spaces. */
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9&]+/g, ' ').trim()
}
/** Content words of a text (stopwords and 1-letter tokens dropped). */
export const tokens = (s, stop = STOP) => normalize(s).split(' ').filter((t) => t.length > 1 && !stop.has(t))

/** Pricing text from live plans (worker/business.js shape) or the landing's draft tiers. */
export function pricingText(plans) {
  const live = Array.isArray(plans) && plans.length > 0
  const rows = live
    ? plans.map((p) => {
      const price = p.price_idr === null || p.price_idr === undefined ? 'Kustom' : `Rp${new Intl.NumberFormat('id-ID').format(p.price_idr)}`
      const period = p.period_label || { month: 'per bulan', year: 'per tahun', once: 'sekali bayar' }[p.period] || ''
      const limits = (p.limits || []).map((l) => (l && typeof l === 'object' ? `${l.label} ${l.value}` : String(l))).filter(Boolean)
      return { name: p.name, price, period, tagline: p.tagline || '', limits, features: (p.features || []).slice(0, 4) }
    })
    : PRICING_TIERS.map((t) => ({ name: t.name, price: t.price, period: t.period, tagline: t.tagline, limits: t.limits.map((l) => `${l.label} ${l.value}`), features: t.features }))
  const lines = rows.map((r) => `• ${r.name}: ${r.price}${r.period ? ` (${r.period})` : ''}${r.tagline ? ` — ${r.tagline}` : ''}${r.limits.length ? ` ${r.limits.join(', ')}.` : ''}${r.features.length ? ` Termasuk: ${r.features.join(', ')}.` : ''}`)
  return [`Paket Satu Alur${live ? '' : ` (${PRICING_NOTE.toLowerCase()})`}:`, ...lines, 'Pindah paket kapan saja; detail lengkap ada di bagian Harga.'].join('\n')
}

/** Entries visible in a mode: the app sees both scopes, the public page only 'public'. */
export function entriesFor(mode, { plans } = {}) {
  return ENTRIES.filter((e) => mode === 'app' || e.scope === 'public')
    .map((e) => (e.id === 'harga' ? { ...e, text: pricingText(plans) } : e))
}

/** Ranked entries for a question: [{ entry, score }], best first. A phrase key scores 3, a word 2, a title word 1. */
export function searchKnowledge(question, { mode = 'public', plans, only } = {}) {
  const q = normalize(question)
  const qt = tokens(question)
  if (!q) return []
  const hit = (t, k) => t === k || (k.length >= 5 && t.length >= 4 && (k.startsWith(t) || t.startsWith(k)))
  const pool = entriesFor(mode, { plans }).filter((e) => !only || only.includes(e.id))
  return pool.map((entry) => {
    let score = 0
    for (const key of entry.keys) {
      const k = normalize(key)
      if (k.includes(' ')) { if (` ${q} `.includes(` ${k} `)) score += 3 }
      else if (qt.some((t) => hit(t, k))) score += 2
    }
    for (const w of tokens(entry.title)) if (qt.some((t) => hit(t, w))) score += 1
    return { entry, score }
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score)
}

/** The knowledge as prompt text (the AI may use only this). */
export function knowledgeText(mode, { plans, only } = {}) {
  return entriesFor(mode, { plans }).filter((e) => !only || only.includes(e.id))
    .map((e) => `## ${e.title}\n${e.text}`).join('\n\n')
}

/**
 * Landing page copy (Bahasa Indonesia). Product facts follow README.md and
 * docs/01_PRD.md — no invented customers, metrics, or testimonials.
 * Any number shown in a product preview is illustrative and labelled "Contoh".
 */

export const NAV = [
  { id: 'alur', label: 'Alur kerja' },
  { id: 'fitur-ai', label: 'Fitur AI' },
  { id: 'ide-besar', label: 'Roadmap' },
  { id: 'harga', label: 'Harga' },
  { id: 'faq', label: 'FAQ' },
]

/** Honest, verifiable facts shown under the hero CTAs. */
export const HERO_POINTS = [
  'Masuk cukup dengan email (OTP)',
  'Penawaran AI selalu divalidasi',
  'Data di Cloudflare D1',
]

export const STAGES = [
  {
    no: '01', title: 'Permintaan', icon: 'inbox', ai: false,
    desc: 'Setiap permintaan pelanggan tercatat rapi di satu tempat, bukan tercecer di chat.',
    out: 'Daftar permintaan',
  },
  {
    no: '02', title: 'Penawaran AI', icon: 'sparkles', ai: true,
    desc: 'AI menyusun ruang lingkup, harga, dan ketentuan, lalu aturan domain memeriksanya.',
    out: 'Proposal tervalidasi',
  },
  {
    no: '03', title: 'Penugasan', icon: 'users', ai: false,
    desc: 'Tetapkan pekerja dan jadwal untuk penawaran yang sudah disetujui.',
    out: 'Pekerja & jadwal',
  },
  {
    no: '04', title: 'Penyelesaian', icon: 'checkCircle', ai: false,
    desc: 'Catat hasil pekerjaan di lapangan; status penugasan ikut diperbarui.',
    out: 'Catatan hasil kerja',
  },
  {
    no: '05', title: 'Pembukuan', icon: 'ledger', ai: false,
    desc: 'Pendapatan dan biaya masuk jurnal, laba/rugi langsung terlihat.',
    out: 'Jurnal & laba/rugi',
  },
  {
    no: '06', title: 'Laporan AI', icon: 'chart', ai: true,
    desc: 'Ringkasan keuangan dijelaskan AI dalam bahasa yang mudah dipahami.',
    out: 'Laporan + penjelasan',
  },
]

/** Capability ticker: plain capability pills (no logos, no customer names). */
export const TICKER = [
  { icon: 'inbox', label: 'Permintaan terpusat' },
  { icon: 'sparkles', label: 'Penawaran AI' },
  { icon: 'shield', label: 'Validasi aturan domain' },
  { icon: 'users', label: 'Penugasan & jadwal' },
  { icon: 'checkCircle', label: 'Catatan penyelesaian' },
  { icon: 'ledger', label: 'Jurnal & laba/rugi' },
  { icon: 'chart', label: 'Laporan dijelaskan AI' },
  { icon: 'zap', label: 'Streaming Workers AI' },
  { icon: 'bot', label: 'Agent Skill Editor' },
  { icon: 'mail', label: 'Login email OTP' },
  { icon: 'layers', label: 'Data di Cloudflare D1' },
]

export const FEATURES = [
  {
    icon: 'sparkles',
    title: 'Penawaran AI dengan validasi aturan domain',
    desc: 'AI mengusulkan ruang lingkup, harga, dan ketentuan. Sebelum disimpan, aturan bisnis memeriksa rentang harga dan kelengkapan isi, jadi tidak ada proposal asal jadi.',
    tag: null,
  },
  {
    icon: 'chart',
    title: 'Laporan yang dijelaskan dengan bahasa biasa',
    desc: 'Angka laba/rugi diterjemahkan menjadi penjelasan singkat: apa yang naik, apa yang turun, dan apa yang perlu diperhatikan.',
    tag: null,
  },
  {
    icon: 'bot',
    title: 'Agent Skill Editor',
    desc: 'Ubah prompt agen, temperature, dan batas token sesuai gaya bisnis Anda. AI mengikuti cara Anda bekerja, bukan sebaliknya.',
    tag: null,
  },
  {
    icon: 'plug',
    title: 'Konektor WhatsApp & Email',
    desc: 'Permintaan masuk dan penawaran keluar lewat kanal yang sudah dipakai pelanggan Anda.',
    tag: 'Roadmap',
  },
]

export const ROADMAP = [
  {
    no: 'R1', icon: 'trendingUp',
    title: 'Model data untuk forecasting',
    desc: 'Setiap tahap alur menghasilkan data terstruktur. Data itu menjadi dasar untuk memproyeksikan permintaan, kapasitas tim, dan arus kas perusahaan ke depan.',
  },
  {
    no: 'R2', icon: 'sparkles',
    title: 'Parameter penawaran',
    desc: 'Atur tarif dasar, margin, dan aturan diskon yang dipakai AI saat menyusun penawaran, agar harga konsisten di seluruh tim.',
  },
  {
    no: 'R3', icon: 'chart',
    title: 'Parameter laporan',
    desc: 'Pilih metrik, periode, dan gaya penjelasan laporan sesuai pertanyaan yang benar-benar Anda ajukan tentang bisnis.',
  },
]

export const FAQS = [
  {
    q: 'Di mana data bisnis saya disimpan?',
    a: 'Data disimpan di Cloudflare D1 (basis data SQLite terkelola) dan dilayani oleh satu Cloudflare Worker. Setiap data terikat ke akun Anda, sehingga terpisah dari pengguna lain.',
  },
  {
    q: 'Bagaimana cara masuk ke Satu Alur?',
    a: 'Cukup dengan email. Kami mengirim kode sekali pakai (OTP) ke alamat Anda, jadi tidak ada kata sandi yang perlu diingat atau dibagikan.',
  },
  {
    q: 'AI apa yang dipakai, dan apakah hasilnya bisa dipercaya?',
    a: 'Penawaran dan penjelasan laporan dibuat dengan Cloudflare Workers AI dan ditampilkan secara streaming, sehingga bisa Anda batalkan kapan saja. Hasil penawaran selalu melewati validasi aturan domain sebelum disimpan, dan keputusan akhir tetap di tangan Anda.',
  },
  {
    q: 'Bisakah saya mengubah cara AI menulis penawaran?',
    a: 'Bisa. Di Pengaturan tersedia Agent Skill Editor untuk mengubah prompt agen, temperature, batas token, dan preferensi model.',
  },
  {
    q: 'Apa batasan paket gratis?',
    a: 'Menurut skema draf saat ini, paket Sole Trader gratis selama 3 bulan untuk 1 pengguna dan hingga 50 transaksi per bulan, termasuk AI penawaran dan laporan dasar. Angka ini masih dapat berubah.',
  },
  {
    q: 'Apakah sudah terhubung dengan WhatsApp dan email?',
    a: 'Belum. Konektor WhatsApp dan email ada di roadmap. Fondasi konektornya sudah tersedia di Pengaturan, dan akan diaktifkan setelah integrasinya siap.',
  },
]

/**
 * Streaming demo for the AI offer agent. Uses the real offer schema
 * (scope, price, terms, duration) and the real validation rules in
 * domain/rules.js. Illustrative only — not customer data.
 */
export const AGENT_DEMO = {
  request: 'Servis AC split 2 unit, Jakarta Selatan. Bisa minggu ini?',
  fields: [
    { key: 'scope', label: 'Ruang lingkup', value: 'Cuci dan cek freon 2 unit AC split 1 PK' },
    { key: 'price', label: 'Harga', value: 'Rp450.000' },
    { key: 'terms', label: 'Ketentuan', value: 'DP 30%, pelunasan setelah selesai. Garansi 7 hari.' },
    { key: 'duration', label: 'Durasi', value: '± 3 jam' },
  ],
  checks: [
    'Harga dalam rentang Rp10.000 – Rp1.000.000.000',
    'Ruang lingkup minimal 10 karakter',
    'Ketentuan minimal 10 karakter',
  ],
  status: 'Draf · menunggu persetujuan Anda',
}

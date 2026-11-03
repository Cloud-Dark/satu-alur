/**
 * Landing page copy (Bahasa Indonesia). Product facts follow README.md and
 * docs/01_PRD.md — no invented customers, metrics, or testimonials.
 * Any number shown in a product preview is illustrative and labelled "Contoh".
 */

export const NAV = [
  { id: 'alur', label: 'Alur kerja' },
  { id: 'pendapatan', label: 'Pendapatan' },
  { id: 'pertumbuhan', label: 'Pertumbuhan' },
  { id: 'fitur-ai', label: 'Fitur AI' },
  { id: 'harga', label: 'Harga' },
  { id: 'faq', label: 'FAQ' },
]

/** Hero copy as first rendered in the landing markup (the editor's "bawaan"). */
export const HERO = {
  badge: 'Untuk bisnis jasa di Indonesia · ditenagai AI',
  title: 'Bisnis jasa Anda, *tumbuh* dalam satu alur.',
  subtitle: 'Satu Alur menyatukan permintaan, penawaran, penugasan, pembukuan, dan laporan dalam satu alur kerja. Setelah rapi, dua mesin menyusul: pendapatan dari layanan tambahan, dan pertumbuhan dari data Anda sendiri.',
}

/** Honest, verifiable facts shown under the hero CTAs. */
export const HERO_POINTS = [
  'Masuk cukup dengan email (OTP)',
  'Penawaran AI selalu divalidasi',
  'Pendapatan & pertumbuhan sudah aktif',
  'Data aman di cloud',
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
  { icon: 'layers', label: 'Katalog layanan tambahan' },
  { icon: 'sprout', label: 'Lima aliran pemborosan' },
  { icon: 'bot', label: 'Ruang optimasi lima tim' },
  { icon: 'radar', label: 'Radar peluang' },
  { icon: 'mapPin', label: 'Pencari prospek' },
  { icon: 'megaphone', label: 'Konten & jadwal media sosial' },
  { icon: 'zap', label: 'Jawaban AI langsung mengalir' },
  { icon: 'mail', label: 'Login email OTP' },
  { icon: 'lock', label: 'Data aman di cloud' },
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
    icon: 'users',
    title: 'Ruang optimasi lima tim AI',
    desc: 'Kreatif, pemasaran, keuangan, operasional, dan riset bekerja paralel atas angka bisnis Anda, lalu satu pemimpin menyimpulkan. Cocok untuk keputusan yang tidak muat di satu kepala.',
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

/**
 * Pendapatan — the two money engines plus the shared five-team room.
 * Preview numbers are illustrative and labelled "Contoh" in the markup; the
 * counts (5 streams, 5 teams, 6 categories) are the real product constants.
 */
export const INCOME = {
  eyebrow: 'Pendapatan',
  title: 'Pekerjaan yang sama, nilai yang *lebih*.',
  lede: 'Dua menu untuk menambah nilai pekerjaan: temukan peluang add-on dari data operasi, kelola katalognya, lalu catat pemborosan dan penghematan yang sudah Anda capai.',
  engines: [
    {
      id: 'vas',
      icon: 'wallet',
      kicker: 'Layanan tambahan',
      title: 'Jual add-on tanpa menebak',
      desc: 'Satu Alur membaca jenis jasa yang paling sering Anda kerjakan, lalu menunjukkan add-on yang masuk akal untuk ditawarkan — dengan harga, biaya langsung, dan perkiraan serapan.',
      points: [
        'Katalog add-on dalam enam kategori',
        'Atur perkiraan serapan untuk setiap item',
        'Porsi add-on terukur di jurnal, bukan dikira-kira',
      ],
      preview: {
        title: 'Katalog add-on',
        rows: [
          { name: 'Cuci karpet', price: 'Rp75 rb', rate: 46 },
          { name: 'Isi freon', price: 'Rp180 rb', rate: 32 },
          { name: 'Kontrak perawatan', price: 'Rp450 rb', rate: 18 },
        ],
        footer: { label: 'Potensi per bulan', value: '+Rp1,8 jt' },
      },
    },
    {
      id: 'limbah',
      icon: 'sprout',
      kicker: 'Tanpa limbah',
      title: 'Hentikan kebocoran, satu per satu',
      desc: 'Waktu menganggur, perjalanan, bahan terbuang, pekerjaan ulang, serta air dan kimia dihitung dalam Rupiah. Angka bebas limbah menunjukkan kemajuan nyata, bukan perasaan.',
      points: [
        'Lima aliran pemborosan, semuanya dalam Rupiah',
        'Rencana penutupan diurutkan dari kebocoran terbesar',
        'Tandai selesai setelah penghematan terkonfirmasi',
      ],
      preview: {
        title: 'Kebocoran bulan ini',
        percent: 62,
        rows: [
          { label: 'Waktu tunggu', value: 'Rp1,4 jt' },
          { label: 'Perjalanan', value: 'Rp980 rb' },
          { label: 'Bahan terbuang', value: 'Rp620 rb' },
        ],
        footer: { label: 'Bebas limbah', value: '62%' },
      },
    },
  ],
  room: {
    icon: 'bot',
    kicker: 'Ruang optimasi',
    title: 'Lima tim AI, satu kesimpulan',
    desc: 'Setiap menu Pendapatan punya ruang kerja yang sama: lima tim AI membaca angka Anda secara paralel, lalu satu pemimpin menyimpulkan langkah berikutnya. Anda memilih salah satu dari tiga ringkasan singkat — tanpa menulis prompt.',
    teams: ['Kreatif', 'Pemasaran', 'Keuangan', 'Operasional', 'Riset'],
    lead: 'Pimpinan optimasi',
    briefs: ['Naikkan serapan add-on', 'Tutup kebocoran terbesar', 'Bundel untuk pelanggan tetap'],
  },
}

/**
 * Pertumbuhan — tools for finding new work, with labelled demo predictions.
 * The scores and Rupiah figures in the previews are illustrative.
 */
export const GROWTH = {
  eyebrow: 'Pertumbuhan',
  title: 'Setelah rapi, giliran *bertumbuh*.',
  lede: 'Radar dan penasihat membaca data alur Anda. Pencari prospek membantu menemukan calon pelanggan, Media Sosial mengelola konten, dan contoh rekomendasi menunjukkan cara menilai peluang.',
  cards: [
    {
      id: 'radar',
      icon: 'radar',
      title: 'Radar peluang',
      desc: 'Layanan rutin yang jatuh tempo, pelanggan yang menghilang, penawaran yang tertahan, dan musim ramai — ditemukan dari transaksi Anda sendiri, bukan dari daftar beli.',
      chips: [
        { icon: 'clock', label: 'Servis rutin jatuh tempo' },
        { icon: 'users', label: 'Pelanggan belum kembali' },
        { icon: 'file', label: 'Penawaran tertahan' },
      ],
    },
    {
      id: 'prediksi',
      icon: 'target',
      title: 'Rekomendasi & prediksi',
      desc: 'Jelajahi contoh skor peluang, estimasi nilai, dan probabilitas berhasil. Bagian ini memakai data demonstrasi untuk memperlihatkan cara membaca rekomendasi.',
      stat: { score: 92, label: 'Skor peluang', rows: [['Estimasi nilai', 'Rp54 jt/bln'], ['Peluang berhasil', '78%']] },
    },
    {
      id: 'prospek',
      icon: 'mapPin',
      title: 'Pencari prospek',
      desc: 'Pilih titik dan radius di peta, tentukan jenis usaha. AI menilai kecocokan dan menyiapkan penawarannya. Tidak ada pesan yang terkirim otomatis.',
      leads: [
        { name: 'Kafe · Kemang', score: 86, value: 'Rp4,2 jt' },
        { name: 'Klinik · Tebet', score: 74, value: 'Rp2,8 jt' },
      ],
    },
    {
      id: 'sosial',
      icon: 'megaphone',
      title: 'Media Sosial',
      desc: 'Tulis konten dengan AI, jadwalkan tayang ke Facebook, Instagram, atau Threads yang sudah terhubung, lalu ajukan iklan atau kolaborasi ke tim Satu Alur.',
      post: { caption: 'Servis AC sebelum musim hujan — slot minggu ini masih ada.', meta: 'Instagram · dijadwalkan' },
    },
  ],
  assistants: [
    {
      icon: 'lightbulb',
      title: 'Penasihat AI',
      desc: 'Tanya "kenapa laba turun bulan ini?" dan jawabannya memakai angka dari alur Anda, bukan tebakan umum. Percakapan tersimpan di perangkat Anda.',
      sample: 'Laba turun 12% karena dua biaya perjalanan naik dan satu pekerjaan belum ditagih.',
    },
    {
      icon: 'zap',
      title: 'AI Superpowers',
      desc: 'Asisten dengan alat hitung, data bisnis, dan format Rupiah — untuk pekerjaan yang tidak muat di satu formulir.',
      tools: ['Kalkulator', 'Data bisnis', 'Format Rupiah'],
    },
  ],
  note: 'Hubungkan platform yang ingin dipakai: Halaman Facebook, Instagram Bisnis yang tertaut ke Halaman Facebook, atau akun Threads.',
}

/**
 * Integrasi — the platform sits next to the systems a company already runs.
 * Only the connector kinds the Worker actually implements are listed: REST,
 * file import and inbound webhook. Direct database access needs a bridge agent
 * that does not exist yet, so it is deliberately absent here.
 */
export const INTEGRATION = {
  eyebrow: 'Bukan mulai dari nol',
  title: 'Satu Alur *melengkapi* sistem yang sudah berjalan.',
  lede: 'Anda tidak perlu membuang ERP, aplikasi kasir, atau spreadsheet yang sudah dipakai bertahun-tahun. Hubungkan sumbernya, petakan kolomnya, lalu pindahkan data bertahap — sementara dua sistem tetap berjalan berdampingan.',
  badge: 'Enterprise',
  cards: [
    {
      icon: 'plug',
      title: 'REST API',
      desc: 'Hubungkan Odoo, SAP Business One, NetSuite, atau aplikasi internal lewat endpoint yang sudah ada. Kredensial disimpan terenkripsi.',
    },
    {
      icon: 'fileText',
      title: 'Impor file',
      desc: 'Ekspor CSV atau JSON dari sistem lama (Excel dapat diekspor sebagai CSV), petakan kolomnya, lalu periksa pratinjau sebelum satu baris pun ditulis.',
    },
    {
      icon: 'rotateCcw',
      title: 'Webhook masuk',
      desc: 'Sistem lama mengirim peristiwa saat ada perubahan. Setiap kiriman diverifikasi tanda tangannya sebelum diterima.',
    },
  ],
  steps: [
    { no: '1', title: 'Hubungkan', desc: 'Uji koneksi lebih dulu. Tidak ada data yang berpindah sebelum Anda setuju.' },
    { no: '2', title: 'Petakan', desc: 'Cocokkan kolom sumber dengan kolom Satu Alur, termasuk format Rupiah dan tanggal Indonesia.' },
    { no: '3', title: 'Pindahkan bertahap', desc: 'Tenaga kerja dan katalog, lalu permintaan. Rollback mempertahankan baris yang sudah diedit atau dipakai.' },
  ],
  note: 'Integrasi ERP dan migrasi data tersedia untuk akun skala Enterprise. Pendekatan parallel running membuat dua sistem bisa dipakai bersamaan selama masa peralihan.',
}

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
    a: 'Data disimpan di cloud yang aman. Setiap data terikat ke akun Anda, sehingga terpisah dari pengguna lain.',
  },
  {
    q: 'Apa itu Layanan tambahan dan Tanpa limbah?',
    a: 'Dua menu di grup Pendapatan. Layanan tambahan mengelola katalog add-on yang dijual bersama pekerjaan yang sudah ada, lengkap dengan harga, biaya, dan perkiraan serapan. Tanpa limbah mencatat pemborosan di lima aliran — waktu, perjalanan, bahan, pekerjaan ulang, air dan kimia — dalam Rupiah, lalu mengurutkan mana yang paling besar untuk ditutup lebih dulu.',
  },
  {
    q: 'Apakah fitur Pertumbuhan memakai data pelanggan saya?',
    a: 'Ya, dan hanya data milik akun Anda. Radar peluang membaca transaksi Anda sendiri untuk menemukan layanan rutin yang jatuh tempo atau pelanggan yang belum kembali. Pencari prospek memakai titik dan radius yang Anda tentukan, dan tidak mengirim pesan apa pun secara otomatis.',
  },
  {
    q: 'Bagaimana cara masuk ke Satu Alur?',
    a: 'Cukup dengan email. Kami mengirim kode sekali pakai (OTP) ke alamat Anda, jadi tidak ada kata sandi yang perlu diingat atau dibagikan.',
  },
  {
    q: 'Bagaimana kalau saya butuh bantuan?',
    a: 'Di dalam aplikasi ada menu Bantuan: kirim tiket berisi pertanyaan atau kendala, dan tim Satu Alur menjawab di thread yang sama. Status tiket terlihat jelas — Terbuka, Diproses, atau Selesai.',
  },
  {
    q: 'AI apa yang dipakai, dan apakah hasilnya bisa dipercaya?',
    a: 'Penawaran dan penjelasan laporan dibuat AI dan tampil langsung saat ditulis, sehingga bisa Anda batalkan kapan saja. Hasil penawaran selalu melewati validasi aturan domain sebelum disimpan, dan keputusan akhir tetap di tangan Anda.',
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

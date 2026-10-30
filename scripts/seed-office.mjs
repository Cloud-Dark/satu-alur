#!/usr/bin/env node
/**
 * Satu Alur: data contoh (DUMMY) untuk Kantor Satu Alur (halaman staf).
 * Menulis seeds/office.sql. Semua nama, email, telepon, dan angka FIKTIF.
 *
 *   node scripts/seed-office.mjs            tulis seeds/office.sql
 *
 * Isi: konten situs (landing + 4 halaman dokumen), paket Free/Lite/Pro, pengaturan pembayaran
 * (tanpa kunci), akun pelanggan, pesan kontak, tiket bantuan, influencer, permintaan layanan,
 * kampanye, kuota AI per paket, voucher (paket / saldo AI / gabungan) beserta contoh penukaran.
 * Aman dijalankan ulang: setiap baris memakai id/kunci tetap dan upsert.
 * Butuh migrasi 0007_social_meta.sql dan 0008_quota_vouchers.sql. Lihat seeds/README.md.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HERO, HERO_POINTS, FAQS } from '../src/landing/content.js'
import { periodOf } from '../src/quota/rules.js'

const OUT = fileURLToPath(new URL('../seeds/office.sql', import.meta.url))
const BY = 'seed-office'
const NOW = '2026-10-30T09:00:00.000Z'

/* ------------------------------------------------------------- SQL helpers */

const q = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}
const json = (v) => q(JSON.stringify(v))
const ts = (daysAgo, hour = 9) => {
  const d = new Date(Date.UTC(2026, 9, 30, hour - 7, 0, 0) - daysAgo * 86400000)
  return d.toISOString()
}
const day = (offset) => new Date(Date.UTC(2026, 9, 30) + offset * 86400000).toISOString().slice(0, 10)

/** INSERT ... ON CONFLICT(key) DO UPDATE for every non-key column. */
function upsert(table, key, rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const keys = Array.isArray(key) ? key : [key]
  const set = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`)
  const values = rows.map((r) => `(${cols.map((c) => r[c]).join(', ')})`).join(',\n')
  const tail = set.length ? `DO UPDATE SET ${set.join(', ')}` : 'DO NOTHING'
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${values}\nON CONFLICT(${keys.join(', ')}) ${tail};\n`
}

let rowCount = 0
const sections = []
function section(title, table, key, rows) {
  rowCount += rows.length
  sections.push(`-- ${title}: ${rows.length} baris\n${upsert(table, key, rows)}`)
}

/* ------------------------------------------------------------ Site content */

const landing = {
  hero: {
    badge: HERO.badge,
    title: HERO.title,
    subtitle: HERO.subtitle,
    points: HERO_POINTS.slice(0, 4),
  },
  faqs: FAQS.map((f) => (/batasan paket gratis/i.test(f.q)
    ? { q: f.q, a: 'Paket Free bisa dipakai tanpa batas waktu untuk 1 pengguna, dengan kuota AI kecil (3 penawaran AI, 3 penjelasan laporan, dan 3 pencarian prospek per bulan). Butuh lebih? Naik ke Lite atau Pro kapan saja. Harga paket tidak termasuk saldo AI.' }
    : f)).concat([
    { q: 'Apa beda paket dan saldo AI?', a: 'Paket membuka fitur dan kuota bulanan. Saldo AI terpisah dan dipakai saat kuota AI paket habis. Voucher bisa berisi paket, saldo AI, atau keduanya.' },
  ]),
}

const DOCS = {
  about: {
    title: 'Tentang Satu Alur',
    body: [
      'Satu Alur membantu bisnis jasa di Indonesia mengelola pekerjaan dari permintaan pelanggan sampai laporan keuangan dalam satu alur kerja.',
      '## Yang kami kerjakan',
      '- Mencatat permintaan pelanggan dan menyusun penawaran dengan bantuan AI.',
      '- Menjadwalkan petugas, menutup pekerjaan, dan membukukan pendapatan serta biaya.',
      '- Membaca angka bisnis Anda untuk menemukan peluang tumbuh: pelanggan rutin, prospek baru, dan konten media sosial.',
      '## Untuk siapa',
      'Pemilik usaha jasa: servis AC, kebersihan, laundry, pest control, instalasi listrik, hingga penyedia jasa fasilitas untuk gedung dan rumah sakit.',
      '## Kontak',
      'Kirim pesan lewat formulir Hubungi kami di halaman depan. Tim kami membalas di hari kerja.',
    ].join('\n\n'),
  },
  privacy: {
    title: 'Kebijakan Privasi',
    body: [
      'Draf contoh. Teks ini perlu ditinjau oleh penasihat hukum sebelum dipakai.',
      '## Data yang kami simpan',
      '- Email akun dan nama usaha.',
      '- Data operasional yang Anda masukkan: permintaan, penawaran, penugasan, pembukuan, dan laporan.',
      '- Pesan yang Anda kirim ke tim bantuan.',
      '## Cara kami memakainya',
      'Data dipakai untuk menjalankan layanan Satu Alur bagi akun Anda. Data setiap akun terpisah dari akun lain. Kami tidak menjual data Anda.',
      '## AI',
      'Saat Anda memakai fitur AI, potongan data yang relevan dikirim ke model AI untuk menghasilkan jawaban. Hasilnya bisa Anda edit atau buang.',
      '## Hak Anda',
      '- Meminta salinan data akun Anda.',
      '- Meminta penghapusan akun beserta datanya.',
      'Ajukan permintaan lewat menu Bantuan di aplikasi.',
    ].join('\n\n'),
  },
  terms: {
    title: 'Syarat & Ketentuan',
    body: [
      'Draf contoh. Teks ini perlu ditinjau oleh penasihat hukum sebelum dipakai.',
      '## Akun',
      'Anda bertanggung jawab atas aktivitas di akun Anda dan kebenaran data yang dimasukkan.',
      '## Paket dan pembayaran',
      '- Paket Free tersedia tanpa biaya dengan kuota terbatas.',
      '- Paket berbayar ditagih di muka per periode dan dapat dihentikan kapan saja; layanan berjalan sampai akhir periode.',
      '- Harga paket tidak termasuk saldo AI.',
      '## Penggunaan AI',
      'Hasil AI adalah bantuan, bukan nasihat profesional. Periksa harga, syarat, dan isi penawaran sebelum dikirim ke pelanggan.',
      '## Penghentian',
      'Kami dapat menangguhkan akun yang melanggar hukum atau menyalahgunakan layanan, setelah pemberitahuan bila memungkinkan.',
    ].join('\n\n'),
  },
  cookies: {
    title: 'Kebijakan Cookie',
    body: [
      'Draf contoh. Teks ini perlu ditinjau oleh penasihat hukum sebelum dipakai.',
      '## Yang kami simpan di perangkat',
      '- Token sesi agar Anda tetap masuk.',
      '- Preferensi tampilan, misalnya tema terang atau gelap.',
      '- Riwayat pencarian prospek dan percakapan penasihat AI, agar tidak hilang saat pindah halaman.',
      'Kami tidak memakai cookie iklan pihak ketiga.',
    ].join('\n\n'),
  },
}

section('site_content', 'site_content', 'key', [
  { key: q('landing'), value_json: json(landing), updated_at: q(NOW), updated_by: q(BY) },
  ...Object.entries(DOCS).map(([k, v]) => ({ key: q(k), value_json: json(v), updated_at: q(NOW), updated_by: q(BY) })),
])

/* -------------------------------------------------------- Subscription plans */

const PLANS = [
  {
    slug: 'free', name: 'Free', tagline: 'Coba seluruh alur kerja tanpa biaya, dengan kuota AI kecil.',
    price_idr: 0, period: 'month', period_label: 'selamanya', recommended: 0, badge: '',
    limits: [
      { label: 'Pengguna', value: '1 orang' },
      { label: 'Transaksi', value: '50 per bulan' },
      { label: 'Penawaran AI', value: '10 per bulan' },
      { label: 'Laporan AI', value: '10 per bulan' },
      { label: 'Pencari prospek', value: '10 pencarian per bulan' },
      { label: 'Penasihat AI', value: '5 pesan per bulan' },
    ],
    // Trial quota (src/quota/rules.js FREE_QUOTA): try every AI feature; the advisor costs most, so fewer messages.
    quota: { offer: 10, report: 10, leads: 10, radar: 10, advisor: 5, social: 10 },
    features: ['Alur kerja 6 tahap lengkap', 'Radar peluang (ringkasan)', 'Media sosial: tulis konten manual', 'Data aman di cloud', 'Tidak termasuk saldo AI'],
    cta_label: 'Mulai gratis', cta_kind: 'signup', sort: 1,
  },
  {
    slug: 'lite', name: 'Lite', tagline: 'Untuk usaha jasa yang mulai rutin menerima pesanan.',
    price_idr: 99000, period: 'month', period_label: 'per bulan', recommended: 0, badge: '',
    limits: [
      { label: 'Pengguna', value: '3 orang' },
      { label: 'Transaksi', value: '300 per bulan' },
      { label: 'Penawaran AI', value: '50 per bulan' },
      { label: 'Laporan AI', value: '20 per bulan' },
      { label: 'Pencari prospek', value: '20 pencarian per bulan' },
      { label: 'Penasihat AI', value: '100 pesan per bulan' },
    ],
    quota: { offer: 50, report: 20, leads: 20, radar: 30, advisor: 100, social: 60 },
    features: ['Semua fitur Free', 'Radar peluang lengkap', 'Jadwal konten media sosial', 'Kelola petugas lapangan', 'Ekspor laporan', 'Tidak termasuk saldo AI'],
    cta_label: 'Pilih Lite', cta_kind: 'signup', sort: 2,
  },
  {
    slug: 'pro', name: 'Pro', tagline: 'Alur kerja tanpa batas untuk tim yang sedang tumbuh.',
    price_idr: 249000, period: 'month', period_label: 'per bulan', recommended: 1, badge: 'Paling populer',
    limits: [
      { label: 'Pengguna', value: '10 orang' },
      { label: 'Transaksi', value: 'Tanpa batas' },
      { label: 'Penawaran AI', value: 'Tanpa batas' },
      { label: 'Laporan AI', value: 'Tanpa batas' },
      { label: 'Pencari prospek', value: '100 pencarian per bulan' },
      { label: 'Penasihat AI', value: '500 pesan per bulan' },
    ],
    // null = unlimited; the two most expensive features keep a ceiling.
    quota: { offer: null, report: null, leads: 100, radar: null, advisor: 500, social: null },
    features: ['Semua fitur Lite', 'Publikasi ke Facebook, Instagram, dan Threads', 'Permintaan kolaborasi influencer', 'Permintaan iklan Meta', 'Prioritas bantuan', 'Tidak termasuk saldo AI'],
    cta_label: 'Pilih Pro', cta_kind: 'signup', sort: 3,
  },
]

section('subscription_plans', 'subscription_plans', 'slug', PLANS.map((p) => ({
  slug: q(p.slug), name: q(p.name), tagline: q(p.tagline), price_idr: q(p.price_idr), period: q(p.period),
  period_label: q(p.period_label), recommended: q(p.recommended), badge: q(p.badge),
  limits_json: json(p.limits), features_json: json(p.features), quota_json: json(p.quota), cta_label: q(p.cta_label), cta_kind: q(p.cta_kind),
  sort: q(p.sort), active: q(1), updated_at: q(NOW), updated_by: q(BY),
})))

/* --------------------------------------------------------- Payment settings */

// No keys at all: the gateway stays off until staff enter real keys in Pembayaran.
section('payment_settings', 'payment_settings', 'id', [{
  id: q(1), provider: q('none'), mode: q('sandbox'), client_key: q(''), server_key_enc: 'NULL', server_key_last4: q(''),
  webhook_token_enc: 'NULL', updated_at: q(NOW), updated_by: q(BY),
}])

/* ------------------------------------------------------------------- Users */

// Demo businesses (same ids/emails as seeds/demo*.sql) plus fictional sign-ups.
const DEMO = [
  ['0d3e5a11-7c1a-4b5e-9a01-5a7a1a1d0001', 'demo-ac@satualur.id', 'Budi Santoso (Servis AC)'],
  ['0d3e5a11-7c1a-4b5e-9a02-5a7a1a1d0002', 'demo-cleaning@satualur.id', 'Rina Kusuma (Rapi Bersih Home Cleaning)'],
  ['0d3e5a11-7c1a-4b5e-9a03-5a7a1a1d0003', 'demo-listrik@satualur.id', 'Hendra Siregar (Listrik Siaga Medan)'],
  ['0d3e5a11-7c1a-4b5e-9a04-5a7a1a1d0004', 'demo-pest@satualur.id', 'CV Basmi Hama Nusantara'],
  ['0d3e5a11-7c1a-4b5e-9a05-5a7a1a1d0005', 'demo-laundry@satualur.id', 'CV Wangi Bersih Laundry'],
  ['0d3e5a11-7c1a-4b5e-9a06-5a7a1a1d0006', 'demo-dinding@satualur.id', 'CV Glasur Dinding Borneo'],
  ['0d3e5a11-7c1a-4b5e-9a07-5a7a1a1d0007', 'demo-mall@satualur.id', 'PT Arunika Layanan Ritel'],
  ['0d3e5a11-7c1a-4b5e-9a08-5a7a1a1d0008', 'demo-fm@satualur.id', 'PT Prima Layanan Fasilitas'],
  ['0d3e5a11-7c1a-4b5e-9a09-5a7a1a1d0009', 'demo-rs@satualur.id', 'PT Sehat Bersih Medika'],
]
const SIGNUPS = [
  ['5eed0ff1-0000-4000-8000-000000000001', 'sari.laundrykiloan@contoh.satualur.id', 'Sari Laundry Kiloan', 12],
  ['5eed0ff1-0000-4000-8000-000000000002', 'agus.servispompa@contoh.satualur.id', 'Agus Servis Pompa Air', 9],
  ['5eed0ff1-0000-4000-8000-000000000003', 'dewi.cucisofa@contoh.satualur.id', 'Dewi Cuci Sofa & Karpet', 5],
  ['5eed0ff1-0000-4000-8000-000000000004', 'bengkel.lasprima@contoh.satualur.id', 'Las & Kanopi Prima', 2],
]

// Demo users keep the row the demo seed made (INSERT OR IGNORE on id and email).
const userRows = [...DEMO.map(([id, email, name]) => [id, email, name, '2025-10-01T02:00:00.000Z']),
  ...SIGNUPS.map(([id, email, name, ago]) => [id, email, name, ts(ago)])]
rowCount += userRows.length
sections.push(`-- users: ${userRows.length} baris (demo + pendaftar contoh; baris yang sudah ada tidak diubah)\n` +
  `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES\n${userRows.map((r) => `(${r.map(q).join(', ')})`).join(',\n')};\n`)

/** Owner id by email, so rows follow the account even if an older seed used another UUID. */
const owner = (email) => `(SELECT id FROM users WHERE email = ${q(email)})`
const plan = (slug) => `(SELECT id FROM subscription_plans WHERE slug = ${q(slug)})`
const E = Object.fromEntries([...DEMO, ...SIGNUPS].map(([, email]) => [email.split('@')[0], email]))

/* ------------------------------------------------------- Customer accounts */

const CUSTOMERS = [
  ['demo-ac', 'free', 'active', null, 'Servis AC Budi', '0812-1000-0001', 'Akun demo. Aktif tiap hari, tertarik naik ke Lite.'],
  ['demo-cleaning', 'lite', 'active', day(23), 'Rapi Bersih Home Cleaning', '0812-1000-0002', 'Akun demo. Memakai jadwal konten tiap minggu.'],
  ['demo-listrik', 'lite', 'trial', day(9), 'Listrik Siaga Medan', '0812-1000-0003', 'Akun demo. Trial Lite 14 hari.'],
  ['demo-pest', 'pro', 'active', day(17), 'CV Basmi Hama Nusantara', '031-5550-0004', 'Akun demo. Minta kolaborasi influencer (lihat Permintaan).'],
  ['demo-laundry', 'lite', 'past_due', day(-3), 'CV Wangi Bersih Laundry', '022-5550-0005', 'Akun demo. Tagihan Oktober belum dibayar; sudah diingatkan via email.'],
  ['demo-dinding', 'lite', 'active', day(12), 'CV Glasur Dinding Borneo', '0542-555-0006', 'Akun demo.'],
  ['demo-mall', 'pro', 'active', day(28), 'PT Arunika Layanan Ritel', '021-5550-0007', 'Akun demo. Enterprise; minta penawaran kustom untuk 12 cabang.'],
  ['demo-fm', 'pro', 'active', day(5), 'PT Prima Layanan Fasilitas', '021-5550-0008', 'Akun demo. Perpanjangan tahunan sedang dibahas.'],
  ['demo-rs', 'pro', 'trial', day(11), 'PT Sehat Bersih Medika', '021-5550-0009', 'Akun demo. Trial Pro; jadwalkan demo dengan tim housekeeping.'],
  ['sari.laundrykiloan', 'free', 'active', null, 'Sari Laundry Kiloan', '0857-2000-0001', 'Daftar dari soft launch. Belum pernah membuat penawaran.'],
  ['agus.servispompa', 'lite', 'cancelled', day(-6), 'Agus Servis Pompa Air', '0857-2000-0002', 'Berhenti: musim sepi. Tawarkan voucher bila kembali.'],
  ['dewi.cucisofa', 'lite', 'active', day(27), 'Dewi Cuci Sofa & Karpet', '0857-2000-0003', 'Lite 30 hari dari voucher SATU-COMBO (soft launch).'],
]
section('customer_accounts', 'customer_accounts', 'owner_id', CUSTOMERS.map(([u, p, status, end, company, phone, notes]) => ({
  owner_id: owner(E[u]), plan_id: plan(p), status: q(status), period_end: q(end), company: q(company), phone: q(phone),
  notes: q(notes), updated_at: q(NOW), updated_by: q(BY),
})))

/* ------------------------------------------------------------- User flags */

section('user_flags', 'user_flags', 'user_id', [{
  user_id: owner(E['bengkel.lasprima']), suspended: q(1),
  reason: q('Contoh: mendaftar dengan data usaha palsu dan mengirim spam lewat formulir kontak.'),
  updated_at: q(NOW), updated_by: q(BY),
}])

/* --------------------------------------------------------- Contact messages */

const CONTACTS = [
  [9001, 'Rudi Hartono', 'rudi.hartono@contoh.id', '0813-3000-1001', 'Harga untuk 5 cabang laundry', 'Halo, saya punya 5 cabang laundry di Depok. Apakah ada paket untuk banyak cabang dan bisa dibayar tahunan?', 'new', '', 0],
  [9002, 'Maya Lestari', 'maya@contoh.id', '', 'Bisa dipakai untuk jasa catering?', 'Usaha saya catering harian. Apakah alur permintaan sampai laporan cocok untuk pesanan nasi kotak?', 'new', '', 1],
  [9003, 'Yusuf Pratama', 'yusuf.p@contoh.id', '0821-3000-1003', 'Integrasi WhatsApp', 'Apakah penawaran bisa langsung dikirim ke WhatsApp pelanggan?', 'read', 'Belum tersedia; masuk roadmap konektor.', 2],
  [9004, 'Lina Wijaya', 'lina.w@contoh.id', '0817-3000-1004', 'Demo untuk tim', 'Kami tim facility management 40 orang. Boleh jadwalkan demo minggu depan?', 'replied', 'Demo dijadwalkan Selasa 10.00 via Meet.', 4],
  [9005, 'Andi Saputra', 'andi.s@contoh.id', '', 'Voucher soft launch', 'Saya dapat voucher di acara soft launch, cara menukarnya bagaimana?', 'replied', 'Dikirim panduan tukar voucher.', 6],
  [9006, 'Promo SEO Murah', 'promo@contoh.id', '', 'Jasa backlink', 'Kami menawarkan 1000 backlink murah untuk website Anda.', 'archived', 'Spam.', 9],
]
section('contact_messages', 'contact_messages', 'id', CONTACTS.map(([id, name, email, phone, subject, message, status, note, ago]) => ({
  id: q(id), name: q(name), email: q(email), phone: q(phone), subject: q(subject), message: q(message), status: q(status),
  staff_note: q(note), ip_hash: q(`seed-office-${id}`), created_at: q(ts(ago, 10)),
  updated_at: status === 'new' ? 'NULL' : q(ts(Math.max(0, ago - 1), 14)), updated_by: status === 'new' ? 'NULL' : q(BY),
})))

/* ---------------------------------------------------------- Support tickets */

const TICKETS = [
  [8001, 'demo-laundry', 'tagihan', 'Tagihan Oktober belum tercatat', 'in_progress', 3, [
    ['customer', 'CV Wangi Bersih Laundry', 'Kami sudah transfer tanggal 27, tapi status masih menunggak.', 3],
    ['staff', 'Tim Satu Alur', 'Terima kasih. Mohon kirim bukti transfer, kami cek ke bank.', 2],
    ['customer', 'CV Wangi Bersih Laundry', 'Sudah kami lampirkan di email ke tim bantuan.', 1],
  ]],
  [8002, 'demo-ac', 'teknis', 'Pencari prospek lama memuat', 'resolved', 5, [
    ['customer', 'Budi Santoso', 'Pencarian di Bekasi muter terus.', 5],
    ['staff', 'Tim Satu Alur', 'Sudah kami perbaiki; pencarian kini jalan di belakang layar. Silakan coba lagi.', 4],
  ]],
  [8003, 'demo-rs', 'akun', 'Tambah pengguna untuk supervisor', 'open', 1, [
    ['customer', 'PT Sehat Bersih Medika', 'Kami butuh 3 akun tambahan untuk supervisor per rumah sakit.', 1],
  ]],
  [8004, 'demo-cleaning', 'lainnya', 'Permintaan fitur cetak invoice', 'open', 2, [
    ['customer', 'Rina Kusuma', 'Bisa ada tombol cetak invoice PDF dari penawaran?', 2],
    ['staff', 'Tim Satu Alur', 'Ide bagus, kami catat untuk roadmap.', 1],
  ]],
  [8005, 'dewi.cucisofa', 'akun', 'Cara tukar voucher', 'closed', 8, [
    ['customer', 'Dewi', 'Voucher dari acara soft launch dimasukkan di mana?', 8],
    ['staff', 'Tim Satu Alur', 'Sudah kami aktifkan trial Lite di akun Ibu. Terima kasih!', 7],
  ]],
]
section('support_tickets', 'support_tickets', 'id', TICKETS.map(([id, u, category, subject, status, ago, msgs]) => ({
  id: q(id), owner_id: owner(E[u]), category: q(category), subject: q(subject), status: q(status),
  created_at: q(ts(ago, 9)), updated_at: q(ts(msgs[msgs.length - 1][3], 15)), last_reply_by: q(msgs[msgs.length - 1][0]),
})))
let msgId = 80000
section('support_messages', 'support_messages', 'id', TICKETS.flatMap(([tid, , , , , , msgs]) => msgs.map(([author, name, body, ago], i) => ({
  id: q(++msgId), ticket_id: q(tid), author: q(author), author_name: q(name), body: q(body), created_at: q(ts(ago, i === 0 ? 9 : 15)),
}))))

/* -------------------------------------------------------------- Influencers */

const rate = (feed, reel, story, tiktok) => [
  { deliverable: 'Feed Instagram', price_idr: feed }, { deliverable: 'Reel Instagram', price_idr: reel },
  { deliverable: 'Story (3 frame)', price_idr: story }, { deliverable: 'Video TikTok', price_idr: tiktok },
].filter((r) => r.price_idr)
const INFLUENCERS = [
  [7001, 'Nadia Rumah Rapi', 'Rumah tangga & kebersihan', 'Jakarta', 48200, 61500, 'Tips beres-beres rumah kecil dan kos. Audiens ibu muda 25–34.', 'nadiarumahrapi', 'nadiarumahrapi', '', rate(1500000, 2500000, 750000, 2200000), 'Respons cepat. Minta brief 5 hari sebelum tayang.'],
  [7002, 'Kang Dadang Teknik', 'Servis & DIY', 'Bandung', 22800, 104000, 'Video servis AC, pompa air, dan listrik rumah dengan bahasa Sunda santai.', 'kangdadangteknik', 'kangdadang.teknik', 'KangDadangTeknik', rate(900000, 1800000, 500000, 2000000), 'Paling cocok untuk servis AC dan listrik.'],
  [7003, 'Mbak Laundry Kece', 'Laundry & fashion care', 'Surabaya', 15400, 38900, 'Cara merawat pakaian, review laundry kiloan.', 'mbaklaundrykece', 'mbaklaundrykece', '', rate(600000, 1100000, 350000, 1000000), ''],
  [7004, 'Ardi Properti', 'Properti & renovasi', 'Tangerang', 87300, 52100, 'Renovasi rumah subsidi, cat dinding, kanopi.', 'ardiproperti', 'ardi.properti', 'ArdiProperti', rate(3000000, 4500000, 1200000, 3500000), 'Harga bisa nego untuk paket 3 konten.'],
  [7005, 'Sasa Mom Life', 'Parenting & rumah', 'Depok', 132000, 88400, 'Keseharian ibu bekerja; sering bahas jasa bersih rumah dan pest control.', 'sasamomlife', 'sasamomlife', '', rate(4500000, 6500000, 1800000, 5000000), 'Wajib kontrak tertulis.'],
  [7006, 'Medan Kuliner & Usaha', 'UMKM lokal', 'Medan', 41000, 27600, 'Liputan usaha lokal Medan.', 'medanusaha', '', '', rate(800000, 1500000, 400000, 0), ''],
  [7007, 'Bersih Bareng Rio', 'Kebersihan & deep cleaning', 'Makassar', 9800, 71200, 'Video before–after deep cleaning yang viral di TikTok.', 'bersihbarengrio', 'bersihbarengrio', '', rate(500000, 900000, 250000, 1300000), 'Mikro influencer, engagement tinggi.'],
  [7008, 'Dokter Gedung', 'Facility management', 'Jakarta', 18600, 6400, 'Edukasi perawatan gedung kantor dan rumah sakit untuk audiens B2B.', 'doktergedung', '', 'DokterGedung', rate(2000000, 3000000, 0, 0), 'Cocok untuk klien enterprise (FM, RS).'],
  [7009, 'Borneo Living', 'Gaya hidup Kalimantan', 'Balikpapan', 27500, 19300, 'Rumah, kuliner, dan usaha di Balikpapan–Samarinda.', 'borneoliving', 'borneoliving', '', rate(700000, 1300000, 350000, 1100000), ''],
  [7010, 'Raka Review Jasa', 'Review jasa', 'Yogyakarta', 56000, 143000, 'Mencoba dan mereview jasa rumah tangga secara jujur.', 'rakareviewjasa', 'rakareviewjasa', 'RakaReviewJasa', rate(2500000, 3800000, 900000, 3200000), 'Sedang cuti sampai akhir November.'],
]
section('influencers', 'influencers', 'id', INFLUENCERS.map(([id, name, niche, city, ig, tt, bio, hig, htt, hyt, rates, notes]) => ({
  id: q(id), name: q(name), photo_key: 'NULL', niche: q(niche), city: q(city), ig_followers: q(ig), tiktok_followers: q(tt), bio: q(bio),
  visible: q(id === 7010 ? 0 : 1), handle_ig: q(hig), handle_tiktok: q(htt), handle_youtube: q(hyt),
  contact_phone: q(`0811-7000-${String(id).slice(-4)}`), contact_email: q(`${hig || 'kontak'}@contoh.id`),
  rates_json: json(rates), internal_notes: q(notes), created_at: q(ts(20 - (id - 7000), 11)),
})))

/* ---------------------------------------------------------- Service requests */

const REQUESTS = [
  [6001, 'demo-pest', 'collab', 7005, { campaign: 'Kampanye musim hujan: kenalkan layanan anti rayap rumah di Surabaya–Sidoarjo. Ingin video before–after di rumah klien.', budget_range: 'Rp5–10 juta', timing: 'November 2026' }, 'in_progress', 'Kampanye dibuat; menunggu konten pertama.', 12],
  [6002, 'demo-cleaning', 'collab', 7007, { campaign: 'Promo langganan bersih rumah mingguan untuk kos-kosan di Makassar.', budget_range: 'Rp1–3 juta', timing: 'Minggu ke-2 November' }, 'in_progress', 'Brief terkirim ke Rio.', 6],
  [6003, 'demo-ac', 'collab', 7002, { campaign: 'Servis AC cuci + isi freon menjelang musim panas, area Bekasi.', budget_range: 'Rp1–3 juta', timing: 'Desember 2026' }, 'new', '', 1],
  [6004, 'demo-fm', 'collab', 7008, { campaign: 'Edukasi B2B: perawatan gedung kantor BUMN, target manajer gedung di LinkedIn & Instagram.', budget_range: 'Rp10–25 juta', timing: 'Q1 2027' }, 'done', 'Kampanye selesai, 2 konten tayang.', 40],
  [6005, 'demo-laundry', 'ads', null, { service: 'Laundry kiloan antar-jemput', location: 'Bandung', daily_budget: 75000, duration_days: 14, goal: 'messages', notes: 'Target ibu rumah tangga radius 5 km dari 3 outlet.' }, 'new', '', 0],
  [6006, 'demo-dinding', 'ads', null, { service: 'Cat ulang dinding rumah', location: 'Balikpapan', daily_budget: 50000, duration_days: 30, goal: 'leads', notes: '' }, 'in_progress', 'Iklan disiapkan, menunggu materi foto.', 4],
  [6007, 'demo-mall', 'ads', null, { service: 'Jasa kebersihan tenant mal', location: 'Jakarta, Bandung, Surabaya', daily_budget: 300000, duration_days: 21, goal: 'awareness', notes: 'Kampanye rekrutmen mitra tenant.' }, 'done', 'Iklan berjalan 21 hari, laporan dikirim.', 35],
  [6008, 'demo-rs', 'ads', null, { service: 'Housekeeping rumah sakit & klinik', location: 'Jabodetabek', daily_budget: 150000, duration_days: 14, goal: 'traffic', notes: 'Arahkan ke halaman profil perusahaan.' }, 'new', '', 2],
]
section('service_requests', 'service_requests', 'id', REQUESTS.map(([id, u, kind, inf, payload, status, note, ago]) => ({
  id: q(id), owner_id: owner(E[u]), kind: q(kind), influencer_id: q(inf), payload_json: json(payload), status: q(status),
  admin_note: q(note), created_at: q(ts(ago, 10)), updated_at: q(ts(Math.max(0, ago - 1), 16)),
})))

/* ---------------------------------------------------------------- Campaigns */

const CAMPAIGNS = [
  [5001, 6001, 'demo-pest', 'Anti rayap musim hujan — Surabaya', 'Dua video before–after di rumah klien dan satu story ajakan konsultasi gratis. Sebutkan garansi 1 tahun.', 'active', day(-10), day(20), 9500000, 12,
    [[7005, 6500000], [7003, 1100000]],
    [[7005, 'reel', day(3), 'in_progress', null, 'Syuting di Sidoarjo hari Sabtu.'], [7005, 'story', day(5), 'planned', null, ''], [7003, 'reel', day(-1), 'published', 'https://www.instagram.com/reel/contoh-satualur-1/', 'Tayang, 12 ribu tayangan hari pertama.']]],
  [5002, 6002, 'demo-cleaning', 'Langganan bersih kos — Makassar', 'Video TikTok kunjungan bersih kamar kos 60 detik + kode promo KOSRAPI.', 'active', day(-5), day(15), 2200000, 6,
    [[7007, 1300000]],
    [[7007, 'tiktok', day(4), 'briefed', null, 'Brief dikirim 25 Okt.']]],
  [5003, 6004, 'demo-fm', 'Edukasi perawatan gedung — B2B', 'Seri edukasi perawatan gedung untuk manajer gedung.', 'completed', day(-38), day(-8), 6000000, 40,
    [[7008, 5000000]],
    [[7008, 'feed', day(-30), 'published', 'https://www.instagram.com/p/contoh-satualur-2/', ''], [7008, 'youtube', day(-12), 'published', 'https://www.youtube.com/watch?v=contoh-satualur', 'Video 8 menit.']]],
]
section('campaigns', 'campaigns', 'id', CAMPAIGNS.map(([id, rid, u, title, brief, status, start, end, fee, ago]) => ({
  id: q(id), request_id: q(rid), owner_id: owner(E[u]), title: q(title), brief: q(brief), status: q(status), start_date: q(start),
  end_date: q(end), client_fee_idr: q(fee), created_at: q(ts(ago, 13)), updated_at: q(ts(Math.max(0, ago - 2), 13)), updated_by: q(BY),
})))
section('campaign_influencers', 'campaign_influencers', ['campaign_id', 'influencer_id'], CAMPAIGNS.flatMap(([id, , , , , , , , , , infs]) =>
  infs.map(([inf, payout]) => ({ campaign_id: q(id), influencer_id: q(inf), payout_idr: q(payout) }))))
let delId = 50000
section('campaign_deliverables', 'campaign_deliverables', 'id', CAMPAIGNS.flatMap(([id, , , , , , , , , , , dels]) =>
  dels.map(([inf, kind, due, status, link, note]) => ({
    id: q(++delId), campaign_id: q(id), influencer_id: q(inf), kind: q(kind), due_date: q(due), status: q(status), link: q(link),
    note: q(note), updated_at: q(NOW), updated_by: q(BY),
  }))))

/* --------------------------------------------------------- Vouchers & credit */

// One voucher per type. Codes are readable on stage; staff make real ones in Kantor › Voucher.
const VOUCHERS = [
  [1, 'SATU-LAUNCH-PRO', 'plan', 'pro', 30, 0, 20, 0, '2026-12-31', 'Soft launch: Pro 30 hari untuk 20 usaha terpilih.', 8],
  [2, 'SATU-AI-50K', 'credit', null, null, 50000, 20, 1, '2026-12-31', 'Saldo AI Rp50.000 untuk mencoba fitur AI setelah kuota habis.', 8],
  [3, 'SATU-COMBO', 'bundle', 'lite', 30, 25000, 10, 1, '2026-11-30', 'Lite 30 hari + saldo AI Rp25.000 untuk peserta demo.', 6],
]
section('vouchers', 'vouchers', 'id', VOUCHERS.map(([id, code, type, p, days, credit, max, used, exp, note, ago]) => ({
  id: q(id), code: q(code), type: q(type), plan_id: p ? plan(p) : 'NULL', plan_days: q(days), credit_idr: q(credit),
  max_redemptions: q(max), redeemed_count: q(used), expires_on: q(exp), active: q(1), note: q(note), created_by: q(BY), created_at: q(ts(ago)),
})))
section('voucher_redemptions', 'voucher_redemptions', ['voucher_id', 'user_id'], [
  { voucher_id: q(2), user_id: owner(E['sari.laundrykiloan']), redeemed_at: q(ts(4, 14)) },
  { voucher_id: q(3), user_id: owner(E['dewi.cucisofa']), redeemed_at: q(ts(3, 10)) },
])
// Sari spent Rp2.000 of her Rp50.000 after using up the Free offer quota; Dewi still has the bundle's Rp25.000.
section('ai_credits', 'ai_credits', 'user_id', [
  { user_id: owner(E['sari.laundrykiloan']), balance_idr: q(48000), updated_at: q(ts(1, 15)) },
  { user_id: owner(E['dewi.cucisofa']), balance_idr: q(25000), updated_at: q(ts(3, 10)) },
])
section('ai_credit_entries', 'ai_credit_entries', 'id', [
  [90001, 'sari.laundrykiloan', 50000, 'voucher', 'SATU-AI-50K', ts(4, 14)],
  [90002, 'sari.laundrykiloan', -1000, 'offer', periodOf(new Date(NOW)), ts(2, 11)],
  [90003, 'sari.laundrykiloan', -1000, 'offer', periodOf(new Date(NOW)), ts(1, 15)],
  [90004, 'dewi.cucisofa', 25000, 'voucher', 'SATU-COMBO', ts(3, 10)],
].map(([id, u, amount, reason, ref, at]) => ({ id: q(id), user_id: owner(E[u]), amount_idr: q(amount), reason: q(reason), ref: q(ref), created_at: q(at) })))
// This month's usage for two sign-ups (period of the seed date), so the quota bars aren't empty.
section('usage_counters', 'usage_counters', ['user_id', 'feature', 'period'], [
  ['sari.laundrykiloan', 'offer', 10], ['sari.laundrykiloan', 'report', 3], ['sari.laundrykiloan', 'advisor', 5],
  ['dewi.cucisofa', 'offer', 4], ['dewi.cucisofa', 'leads', 2],
].map(([u, f, n]) => ({ user_id: owner(E[u]), feature: q(f), period: q(periodOf(new Date(NOW))), count: q(n) })))

/* -------------------------------------------------------------------- Write */

// Index entries add writes; this is a rough upper bound for the D1 free-tier quota.
const estimate = rowCount * 3
const header = `-- =====================================================================
-- Satu Alur: DATA CONTOH (DUMMY) untuk Kantor Satu Alur. Semua nama, email, telepon, dan angka FIKTIF.
-- Dibuat oleh scripts/seed-office.mjs. Jangan edit manual; ubah skripnya lalu jalankan ulang.
-- ${rowCount} baris; perkiraan D1 rows written <= ${estimate} (termasuk entri indeks).
-- Butuh migrasi 0007_social_meta.sql dan 0008_quota_vouchers.sql. Aman dijalankan ulang (upsert dengan id/kunci tetap).
-- Tidak berisi akun staf atau kunci pembayaran. Buat staf dengan: npm run staff -- add <username>
-- =====================================================================
`
writeFileSync(OUT, `${header}\n${sections.join('\n')}`)
console.log(`seeds/office.sql: ${rowCount} baris, perkiraan tulis <= ${estimate}`)

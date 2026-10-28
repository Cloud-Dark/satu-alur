#!/usr/bin/env node
/**
 * Satu Alur: generator DATA DEMO (dummy) yang mensimulasikan pertumbuhan usaha.
 *
 * Menghasilkan satu file SQL untuk D1 berisi 9 usaha demo (3 sole trader, 3 UKM,
 * 3 enterprise), masing-masing dengan satu akun login (OTP demo). Semua nama,
 * telepon, alamat, dan angka adalah fiktif. Output deterministik untuk --seed
 * yang sama.
 *
 *   node scripts/seed-demo.mjs [--months 12] [--end 2026-10-31]
 *        [--asof 2026-10-28T17:00:00+07:00 | --asof now] [--seed 20261028]
 *        [--out seeds/demo.sql] [--summary seeds/demo-summary.json] [--only ac,fm] [--quiet]
 *
 * Asumsi, rumus, dan kalender musiman: docs/specs/2026-10-28-demo-growth-data-design.md
 * Tanpa dependency (Node >= 18, ESM).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const HOUR = 3600000
const DAY = 24 * HOUR
const MIN = 60000

/* ================================================================== CLI */

function parseArgs(argv) {
  const a = { months: 12, end: '2026-10-31', asof: null, seed: 20261028, out: 'seeds/demo.sql', summary: 'seeds/demo-summary.json', only: null, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = () => {
      const x = argv[++i]
      if (x === undefined) throw new Error(`Nilai untuk ${k} tidak ada`)
      return x
    }
    if (k === '--months') a.months = Number(v())
    else if (k === '--end') a.end = v()
    else if (k === '--asof') a.asof = v()
    else if (k === '--seed') a.seed = Number(v())
    else if (k === '--out') a.out = v()
    else if (k === '--summary') a.summary = v()
    else if (k === '--only') a.only = v().split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--quiet') a.quiet = true
    else if (k === '-h' || k === '--help') {
      console.log('Pemakaian: node scripts/seed-demo.mjs [--months 12] [--end YYYY-MM-DD] [--asof ISO|now] [--seed N] [--out file.sql] [--summary file.json|none] [--only ac,fm] [--quiet]')
      process.exit(0)
    } else throw new Error(`Argumen tidak dikenal: ${k}`)
  }
  if (!Number.isInteger(a.months) || a.months < 3 || a.months > 36) throw new Error('--months harus 3..36')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.end)) throw new Error('--end harus YYYY-MM-DD')
  if (!Number.isFinite(a.seed)) throw new Error('--seed harus angka')
  return a
}

/* ================================================================= PRNG */

function hashStr(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h >>> 0
}
function makeRng(seed) {
  let t = seed >>> 0
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const r = {
    next,
    uni: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** weighted pick from [[value, weight], ...] */
    wpick: (pairs) => {
      let tot = 0
      for (const p of pairs) tot += p[1]
      let x = next() * tot
      for (const p of pairs) if ((x -= p[1]) < 0) return p[0]
      return pairs[pairs.length - 1][0]
    },
    normal: () => {
      const u = Math.max(1e-12, next())
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
    },
  }
  r.lognoise = (sigma) => Math.exp(sigma * r.normal() - (sigma * sigma) / 2)
  return r
}

/* ============================================================= Kalender */

// Perkiraan hari libur nasional & cuti bersama (cek SKB 3 Menteri untuk tanggal resmi).
const HOLIDAYS = new Set([
  '2024-12-25', '2024-12-26', '2025-01-01', '2025-01-27', '2025-01-29', '2025-03-28', '2025-03-31', '2025-04-01', '2025-04-18',
  '2025-05-01', '2025-05-12', '2025-05-29', '2025-06-01', '2025-06-06', '2025-06-27', '2025-08-17', '2025-09-05',
  '2025-12-25', '2025-12-26', '2026-01-01', '2026-01-16', '2026-02-17', '2026-03-19', '2026-03-20', '2026-03-21',
  '2026-04-03', '2026-05-01', '2026-05-14', '2026-05-27', '2026-05-31', '2026-06-01', '2026-06-16', '2026-08-17',
  '2026-08-25', '2026-12-25', '2026-12-26', '2027-01-01', '2027-02-06', '2027-03-10', '2027-03-11',
])
// Perkiraan 1 Syawal (Idulfitri). Ramadan ~30 hari sebelumnya.
const LEBARAN = ['2024-04-10', '2025-03-31', '2026-03-20', '2027-03-10', '2028-02-27'].map((d) => Date.parse(`${d}T00:00:00Z`))

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)
const monthLabel = (y, m) => `${BULAN[m]} ${y}`
/** local wall-clock (UTC-based date math) -> UTC epoch ms */
const localToUtc = (dayMs, hourFloat, tz) => dayMs + hourFloat * HOUR - tz * HOUR
/** epoch ms -> {y,m} of the WIB (UTC+7) calendar month */
const wibMonth = (ms) => {
  const d = new Date(ms + 7 * HOUR)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
}

/* =========================================================== Nama/kata */

const M_FIRST = ['Agus', 'Bambang', 'Dedi', 'Eko', 'Fajar', 'Hendra', 'Irfan', 'Joko', 'Kurniawan', 'Rudi', 'Slamet', 'Teguh', 'Wahyu', 'Yusuf', 'Arif', 'Bayu', 'Dimas', 'Gilang', 'Hadi', 'Imam', 'Rizal', 'Andre', 'Ferry', 'Yohanes', 'Made', 'Ketut', 'Andi', 'Rahmat', 'Syamsul', 'Taufik', 'Hamzah', 'Bonar', 'Rizky', 'Galih', 'Heru', 'Sutrisno', 'Daniel', 'Fikri', 'Ilham', 'Nanda']
const F_FIRST = ['Sri', 'Dewi', 'Rina', 'Siti', 'Wulan', 'Ratna', 'Fitri', 'Indah', 'Lestari', 'Maya', 'Nur', 'Putri', 'Ayu', 'Yuni', 'Lina', 'Melati', 'Novi', 'Tuti', 'Endang', 'Anisa', 'Larasati', 'Kartika', 'Mega', 'Rosa', 'Yohana', 'Nining', 'Hartini', 'Suryani', 'Andriani', 'Felicia', 'Citra', 'Rahmawati', 'Intan', 'Desi', 'Winda']
const LAST = ['Santoso', 'Wibowo', 'Saputra', 'Hidayat', 'Pratama', 'Kusuma', 'Setiawan', 'Nugroho', 'Simanjuntak', 'Siregar', 'Nasution', 'Lubis', 'Hutapea', 'Gunawan', 'Halim', 'Wijaya', 'Susanto', 'Purnomo', 'Rahman', 'Hakim', 'Syahputra', 'Maulana', 'Ramadhan', 'Firmansyah', 'Permana', 'Suryadi', 'Hartono', 'Tanjung', 'Sitompul', 'Manurung', 'Tambunan', 'Daulay', 'Fauzi', 'Anwar', 'Kurnia', 'Pangaribuan', 'Mappanyukki', 'Daeng Tika', 'Rasyid', 'Wonoatmojo', 'Sembiring', 'Ginting', 'Matondang', 'Lumban Gaol', 'Pakpahan', 'Pattiasina', 'Rumagit', 'Tuwo', 'Latuconsina', 'Basri']
const STREETS = ['Melati', 'Kenanga', 'Cempaka', 'Mawar', 'Anggrek', 'Dahlia', 'Flamboyan', 'Merpati', 'Rajawali', 'Cendrawasih', 'Kutilang', 'Nusa Indah', 'Teratai', 'Bougenville', 'Kamboja', 'Seroja', 'Pelita', 'Damai', 'Sejahtera', 'Harapan', 'Pendidikan', 'Masjid', 'Swadaya', 'Karya Bakti', 'Pemuda']
const ADJ = ['Berkah', 'Barokah', 'Jaya Abadi', 'Sinar Makmur', 'Sentosa', 'Maju Bersama', 'Sejahtera', 'Mandiri', 'Lancar Jaya', 'Rejeki', 'Harapan', 'Cahaya', 'Mulia', 'Bintang', 'Sumber Rezeki', 'Karya', 'Indah', 'Bahagia', 'Amanah', 'Sakinah', 'Pelangi', 'Mentari', 'Nusantara', 'Lestari']
const UMKM_KIND = ['Warung Makan', 'Rumah Makan', 'Kedai Kopi', 'Laundry', 'Bengkel Motor', 'Toko Bangunan', 'Klinik Pratama', 'Salon', 'Konter HP', 'Minimarket', 'Bimbel', 'Toko Kue', 'Studio Foto', 'Pet Shop', 'Apotek', 'Toko Kelontong', 'Katering', 'Percetakan', 'Barbershop', 'Toko Elektronik']
const CO_A = ['Adi', 'Bumi', 'Cipta', 'Dwi', 'Graha', 'Inti', 'Mitra', 'Nusa', 'Sarana', 'Tri', 'Wahana', 'Mega', 'Panca', 'Sinar', 'Arta', 'Buana', 'Daya', 'Lintas', 'Samudra', 'Cakra', 'Kencana', 'Bentala', 'Arunika']
const CO_B = ['Mandiri', 'Persada', 'Sentosa', 'Perkasa', 'Lestari', 'Makmur', 'Utama', 'Abadi', 'Sejati', 'Gemilang', 'Cemerlang', 'Semesta', 'Raya', 'Jaya']
const CO_C = ['Logistik', 'Properti', 'Teknik', 'Farma', 'Retail', 'Manufaktur', 'Digital', 'Kimia', 'Plastindo', 'Elektrindo', 'Agro', 'Media', 'Konstruksi', 'Pangan', 'Tekstil', 'Otomotif', 'Energi', 'Distribusi']
const MOBILE = ['0811', '0812', '0813', '0821', '0822', '0852', '0853', '0856', '0857', '0858', '0877', '0878', '0895', '0896', '0898']

/* ======================================================= Profil skala */

const SCALE = {
  sole: {
    dow: [1.15, 0.9, 0.9, 0.9, 0.95, 0.85, 1.35], holiday: 0.5, peak: 1.2, lull: 0.6, ramadan: 0.97, pre: 1.4, leb: 0.12, post: 0.75,
    leadDays: [[0, 30], [1, 40], [2, 20], [3, 10]], quoteH: [0.2, 3], durH: null, entryLate: 0.08, entryLateDays: [1, 3],
    postLag: [[0, 60], [1, 27], [2, 6], [4, 4], [7, 3]], hours: [8, 18.5], loss: 0.1, noOffer: 0.12, repeat: 0.35,
    round: 5000, transportLine: 0.95, sigma: 0.025, gDraw: [0.012, 0.018], band: [0.01, 0.02], decisionDays: [1, 6],
  },
  ukm: {
    dow: [0.35, 1.05, 1.05, 1.05, 1.05, 1.0, 0.85], holiday: 0.2, peak: 1.25, lull: 0.5, ramadan: 1.0, pre: 1.35, leb: 0.1, post: 0.7,
    leadDays: [[1, 15], [2, 25], [3, 25], [5, 20], [8, 15]], quoteH: [18, 72], entryLate: 0.08, entryLateDays: [1, 4],
    postLag: [[0, 30], [1, 30], [2, 20], [3, 10], [5, 7], [9, 3]], hours: [7.5, 16.5], loss: 0.16, noOffer: 0.1, repeat: 0.45,
    round: 50000, transportLine: 0.85, sigma: 0.025, gDraw: [0.012, 0.018], band: [0.01, 0.02], decisionDays: [2, 10],
  },
  enterprise: {
    dow: [0.15, 1.1, 1.1, 1.1, 1.1, 1.05, 0.5], holiday: 0.1, peak: 1.2, lull: 0.45, ramadan: 1.0, pre: 1.12, leb: 0.1, post: 0.8,
    leadDays: [[4, 20], [7, 30], [10, 25], [14, 15], [21, 10]], quoteH: [36, 150], entryLate: 0.1, entryLateDays: [1, 5],
    postLag: [[1, 20], [2, 25], [3, 20], [5, 20], [8, 15]], hours: [7, 17], loss: 0.22, noOffer: 0.08, repeat: 0.7,
    round: 100000, transportLine: 0.6, sigma: 0.025, gDraw: [0.06, 0.09], band: [0.05, 0.1], decisionDays: [5, 21],
  },
}

/* ====================================================== Profil wilayah */
// Asumsi demo (bukan data BPS): nasional ~5%/th, menengah ~6-7%/th, cepat ~8-10%/th.
const R = (key, name, profile, growth, tz, code, areas, extra = {}) => ({ key, name, profile, growth, tz, code, areas, w: 1, open: -99, ...extra })
const REG = {
  JKT: R('JKT', 'DKI Jakarta', 'nasional', 0.05, 7, '021', ['Kuningan, Jakarta Selatan', 'Sudirman, Jakarta Pusat', 'TB Simatupang, Jakarta Selatan', 'Kelapa Gading, Jakarta Utara', 'Puri Kembangan, Jakarta Barat', 'Pulogadung, Jakarta Timur', 'Gambir, Jakarta Pusat', 'Mampang Prapatan, Jakarta Selatan']),
  BDT: R('BDT', 'Bodetabek', 'nasional', 0.052, 7, '021', ['BSD, Tangerang Selatan', 'Cikarang, Kab. Bekasi', 'Karawaci, Tangerang', 'Cibubur, Depok', 'Sentul, Kab. Bogor', 'Bekasi Selatan, Kota Bekasi']),
  BKS: R('BKS', 'Kota/Kab. Bekasi', 'nasional', 0.052, 7, '021', ['Jatiasih, Kota Bekasi', 'Rawalumbu, Kota Bekasi', 'Bekasi Timur, Kota Bekasi', 'Bekasi Barat, Kota Bekasi', 'Medan Satria, Kota Bekasi', 'Pondok Gede, Kota Bekasi', 'Mustika Jaya, Kota Bekasi', 'Tambun Selatan, Kab. Bekasi', 'Cikarang Utara, Kab. Bekasi']),
  BDG: R('BDG', 'Bandung Raya', 'nasional', 0.05, 7, '022', ['Dago, Kota Bandung', 'Buahbatu, Kota Bandung', 'Antapani, Kota Bandung', 'Sukajadi, Kota Bandung', 'Cicendo, Kota Bandung', 'Lengkong, Kota Bandung', 'Cimahi', 'Dayeuhkolot, Kab. Bandung']),
  SBY: R('SBY', 'Surabaya', 'nasional', 0.05, 7, '031', ['Gubeng, Surabaya', 'Rungkut, Surabaya', 'Wonokromo, Surabaya', 'Tegalsari, Surabaya', 'Sukolilo, Surabaya', 'Wiyung, Surabaya', 'Mulyorejo, Surabaya', 'Genteng, Surabaya', 'Tandes, Surabaya']),
  SDA: R('SDA', 'Sidoarjo–Gresik', 'nasional', 0.052, 7, '031', ['Waru, Sidoarjo', 'Buduran, Sidoarjo', 'Candi, Sidoarjo', 'Kebomas, Gresik', 'Manyar, Gresik']),
  MLG: R('MLG', 'Malang', 'nasional', 0.05, 7, '0341', ['Klojen, Kota Malang', 'Lowokwaru, Kota Malang', 'Blimbing, Kota Malang']),
  SMG: R('SMG', 'Semarang', 'nasional', 0.05, 7, '024', ['Simpang Lima, Semarang', 'Tembalang, Semarang', 'Candisari, Semarang']),
  MDN: R('MDN', 'Medan', 'nasional', 0.049, 7, '061', ['Medan Baru', 'Medan Petisah', 'Medan Johor', 'Medan Sunggal', 'Medan Helvetia', 'Medan Tembung', 'Medan Selayang', 'Medan Amplas']),
  DPS: R('DPS', 'Denpasar–Badung', 'menengah', 0.065, 8, '0361', ['Denpasar Selatan', 'Kuta, Badung', 'Denpasar Barat']),
  BTM: R('BTM', 'Batam', 'menengah', 0.065, 7, '0778', ['Batam Center', 'Nagoya, Batam', 'Muka Kuning, Batam']),
  MKS: R('MKS', 'Makassar', 'cepat', 0.08, 8, '0411', ['Panakkukang, Makassar', 'Tamalanrea, Makassar', 'Rappocini, Makassar', 'Manggala, Makassar', 'Biringkanaya, Makassar', 'Tamalate, Makassar', 'Somba Opu, Gowa']),
  BPN: R('BPN', 'Balikpapan & koridor IKN', 'cepat', 0.09, 8, '0542', ['Balikpapan Kota', 'Balikpapan Selatan', 'Balikpapan Utara', 'Kariangau, Balikpapan', 'Penajam, PPU', 'Sepaku, PPU']),
  MRW: R('MRW', 'Morowali–Kendari', 'cepat', 0.1, 8, '0401', ['Bahodopi, Morowali', 'Kendari', 'Konawe']),
}
const region = (key, extra = {}) => ({ ...REG[key], ...extra })

/* ===================================================== Katalog usaha */
// price: [lo, hi] per unit (q) atau flat; cost: porsi harga [lo, hi]; dur: jam.
// tags: 'outdoor' (berkurang saat hujan), rain: pengali permintaan Nov-Mar.

const TERMS = {
  sole: [
    'Pembayaran tunai atau transfer setelah pekerjaan selesai. Garansi servis 14 hari untuk keluhan yang sama.',
    'Bayar setelah selesai (tunai/QRIS). Garansi 30 hari untuk pekerjaan yang sama, tidak termasuk kerusakan baru.',
    'Pembayaran di lokasi setelah dicek bersama. Harga sudah termasuk biaya kunjungan dalam kota.',
  ],
  ukm: [
    'DP 30% saat jadwal disepakati, pelunasan maksimal 7 hari setelah pekerjaan selesai. Garansi 30 hari.',
    'Pembayaran transfer 100% setelah pekerjaan selesai dan dicek bersama. Garansi pekerjaan 1 bulan.',
    'Termin: 50% di muka, 50% setelah serah terima. Harga belum termasuk PPN.',
  ],
  enterprise: [
    'Pembayaran NET 30 hari setelah invoice dan BAST ditandatangani. Harga belum termasuk PPN 11%. Garansi pekerjaan 90 hari.',
    'Termin bulanan sesuai kontrak; invoice terbit tiap akhir bulan setelah BAST dan laporan SLA. Harga belum termasuk PPN 11% dan PPh 23.',
    'Pembayaran 30 hari setelah tagihan lengkap (invoice, faktur pajak, BAST, foto before-after). Garansi 3 bulan.',
  ],
}

const fmtRp = (n) => `Rp${Math.round(n).toLocaleString('id-ID')}`
const jt = (n) => (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })

const BUSINESSES = [
  /* ------------------------------------------------------------ 1. AC */
  {
    k: 1, key: 'ac', scale: 'sole', email: 'demo-ac@satualur.id', name: 'Budi Santoso (Servis AC)', industry: 'Servis AC rumah & ruko',
    regions: [region('BKS')], base: 17.5e6, margin: [0.25, 0.35],
    moy: [0.84, 0.86, 0.95, 1.0, 1.05, 1.03, 1.0, 1.06, 1.12, 1.14, 0.98, 0.96],
    custMix: { individu: 74, umkm: 21, korporat: 5 },
    workers: { owner: 'Budi Santoso', helpers: [['Budi Santoso & Andi (helper)', -99], ['Rizky Pratama (teknisi)', 7]], helperP: 0.75 },
    labourLineP: 0.75, transportAbs: [18000, 45000],
    services: [
      { name: 'Cuci AC', w: 48, q: [[1, 22], [2, 34], [3, 22], [4, 12], [5, 6], [6, 4]], unit: 'unit', price: [75000, 90000], min: 150000, dur: [1, 3], cost: { tenaga: [0.28, 0.36], bahan: [0.06, 0.1] }, rain: 0.85,
        issues: ['AC kurang dingin', 'AC menetes air di dalam kamar', 'bau apek saat dinyalakan', 'sudah 6 bulan belum dicuci', 'persiapan ada tamu menginap', 'remote normal tapi angin lemah'],
        desc: (v) => `Cuci ${v.q} unit AC split ${v.pick(['1/2 PK', '3/4 PK', '1 PK', '1,5 PK', '1 PK dan 1/2 PK'])}. Keluhan: ${v.issue}. ${v.pick(['Bisa datang pagi?', 'Mohon kabari sebelum datang.', 'Ada anak kecil, mohon rapi.', ''])}`.trim(),
        scope: (v) => `Cuci ${v.q} unit AC split (indoor dan outdoor), cek tekanan freon, bersihkan filter dan saluran pembuangan.`,
        done: ['Semua unit dicuci, tekanan freon normal (±140 psi). Saran cuci rutin 3 bulan.', 'Saluran pembuangan tersumbat lumut, sudah dibersihkan. AC dingin normal.', 'Unit kamar depan kapasitor mulai lemah, pelanggan diminta pantau. Lainnya normal.', 'Selesai, filter sangat kotor. Disarankan servis tiap 3 bulan karena dekat jalan raya.'] },
      { name: 'Isi freon AC', w: 16, q: [[1, 80], [2, 20]], unit: 'unit', price: [250000, 420000], dur: [1, 2], cost: { tenaga: [0.16, 0.22], bahan: [0.36, 0.46] },
        issues: ['AC hanya keluar angin', 'AC tidak dingin setelah dipindah', 'pipa outdoor berembun es'],
        desc: (v) => `Isi freon ${v.pick(['R32', 'R410A', 'R22'])} ${v.q} unit. ${v.issue}.`,
        scope: (v) => `Pengecekan kebocoran dan isi freon ${v.q} unit AC sampai tekanan standar.`,
        done: ['Ada kebocoran halus di sambungan flare, sudah dikencangkan dan isi freon.', 'Isi freon tambah, tekanan kembali normal.', 'Freon diisi penuh, disarankan cek ulang 2 minggu.'] },
      { name: 'Bongkar pasang AC', w: 10, q: [[1, 70], [2, 30]], unit: 'unit', price: [350000, 650000], dur: [2, 4], cost: { tenaga: [0.24, 0.3], bahan: [0.16, 0.24] },
        issues: ['pindah kamar', 'pindah rumah dalam kota', 'renovasi dinding'],
        desc: (v) => `Bongkar pasang ${v.q} unit AC karena ${v.issue}. Pipa kemungkinan perlu disambung.`,
        scope: (v) => `Bongkar ${v.q} unit AC, pasang ulang di lokasi baru, vakum dan uji dingin.`,
        done: ['Pindah unit selesai, tambah pipa 2 m. AC dingin normal.', 'Bongkar pasang selesai, bracket outdoor diganti baru.'] },
      { name: 'Pasang AC baru', w: 9, q: [[1, 80], [2, 20]], unit: 'unit', price: [450000, 950000], dur: [2, 5], cost: { tenaga: [0.2, 0.26], bahan: [0.34, 0.42] },
        issues: ['AC baru beli online', 'unit dari toko belum dipasang', 'ganti AC lama'],
        desc: (v) => `Pasang ${v.q} unit AC baru (${v.issue}). Butuh pipa ±3 m, kabel, dan bracket.`,
        scope: (v) => `Instalasi ${v.q} unit AC baru termasuk pipa standar 3 m, kabel, bracket, vakum, dan uji fungsi.`,
        done: ['Instalasi selesai, sisa pipa dikembalikan. Uji dingin 30 menit OK.', 'Pasang selesai, jalur listrik dipisah MCB sendiri.'] },
      { name: 'Perbaikan AC', w: 12, q: [[1, 100]], unit: 'unit', price: [300000, 1500000], dur: [1, 4], cost: { tenaga: [0.14, 0.2], bahan: [0.4, 0.5] },
        issues: ['AC mati total', 'kompresor tidak jalan', 'lampu indikator berkedip', 'AC bocor freon terus'],
        desc: (v) => `Perbaikan AC: ${v.issue}. Merk ${v.pick(['Daikin', 'Panasonic', 'Sharp', 'LG', 'Gree', 'Polytron'])}.`,
        scope: () => 'Diagnosa dan perbaikan AC, termasuk penggantian sparepart yang rusak (kapasitor/PCB/las kebocoran).',
        done: ['Kapasitor kompresor diganti, AC normal.', 'PCB indoor rusak, diganti modul universal. Garansi 30 hari.', 'Las kebocoran pipa evaporator dan isi freon.'] },
      { name: 'Servis rutin AC kantor/ruko', w: 5, types: ['umkm', 'korporat'], q: [[4, 30], [5, 25], [6, 25], [8, 20]], unit: 'unit', price: [70000, 85000], min: 300000, dur: [3, 6], cost: { tenaga: [0.3, 0.36], bahan: [0.05, 0.08] },
        issues: ['jadwal servis 3 bulanan', 'ruang server terlalu panas', 'karyawan komplain AC kurang dingin'],
        desc: (v) => `Servis rutin ${v.q} unit AC di ${v.pick(['ruko 2 lantai', 'kantor kecil', 'klinik', 'toko'])}: ${v.issue}.`,
        scope: (v) => `Servis rutin ${v.q} unit AC (cuci, cek freon, cek arus listrik) dengan laporan kondisi per unit.`,
        done: ['Semua unit selesai, laporan kondisi dikirim via WhatsApp.', 'Selesai, 1 unit perlu isi freon (penawaran terpisah).'] },
    ],
    overheads: [
      { label: 'Pulsa & kuota internet', cat: 'biaya_lain', day: 5, amt: () => 150000 },
      { label: 'Iklan marketplace / Facebook', cat: 'biaya_lain', day: 12, amt: (c) => c.r.uni(250000, 650000) },
      { label: 'Penyusutan & servis alat (pompa vakum, manifold)', cat: 'biaya_lain', day: 26, amt: (c) => c.r.uni(250000, 450000) },
      { label: 'BBM motor operasional (di luar job)', cat: 'biaya_transport', day: 27, amt: (c) => c.r.uni(150000, 300000) },
      { label: 'Cicilan & servis motor box', cat: 'biaya_transport', day: 8, amt: () => 850000 },
      { label: 'Sewa gudang kecil (stok freon & pipa)', cat: 'biaya_lain', day: 2, amt: () => 600000 },
    ],
    thr: { kind: 'fixed', amount: 1250000, label: 'THR helper' },
  },
  /* ------------------------------------------------------- 2. Cleaning */
  {
    k: 2, key: 'cleaning', scale: 'sole', email: 'demo-cleaning@satualur.id', name: 'Rina Kusuma (Rapi Bersih Home Cleaning)', industry: 'Cleaning service rumah & kos',
    regions: [region('MKS')], base: 14.5e6, margin: [0.25, 0.35],
    moy: [0.92, 0.95, 1.0, 1.0, 0.98, 1.04, 1.06, 1.0, 0.98, 1.0, 0.98, 1.02],
    custMix: { individu: 70, kos: 22, umkm: 8 },
    workers: { owner: 'Rina Kusuma', helpers: [['Rina & Wati', -99], ['Rina & Sukma', -99], ['Wati & Sukma', 4]], helperP: 0.9 },
    labourLineP: 0.9, transportAbs: [15000, 40000],
    contract: { share: 0.18, churn: 0.04, services: [
      { name: 'Langganan bersih kos mingguan', w: 60, types: ['kos'], q: [[6, 20], [8, 30], [10, 30], [12, 20]], unit: 'kamar', price: [95000, 130000], cost: { tenaga: [0.44, 0.5], bahan: [0.06, 0.09] },
        scope: (v) => `Pembersihan area bersama kos dan ${v.q} kamar kosong 4x sebulan (sapu, pel, kamar mandi, buang sampah).`, done: ['4 kunjungan bulan ini selesai, foto dikirim ke pemilik.', 'Langganan bulan ini selesai; 1 kunjungan digeser karena hujan.'] },
      { name: 'Langganan bersih rumah mingguan', w: 40, types: ['individu'], q: [[4, 100]], unit: 'kunjungan', price: [180000, 280000], cost: { tenaga: [0.44, 0.5], bahan: [0.05, 0.08] },
        scope: (v) => `Bersih rumah rutin ${v.q} kunjungan per bulan, 3 jam per kunjungan, termasuk dapur dan kamar mandi.`, done: ['Semua kunjungan bulan ini selesai.', 'Kunjungan lengkap, pelanggan minta tambah setrika bulan depan.'] },
    ] },
    services: [
      { name: 'General cleaning rumah', w: 40, q: [[3, 50], [4, 35], [6, 15]], unit: 'jam', price: [55000, 70000], min: 150000, dur: [3, 6], cost: { tenaga: [0.42, 0.5], bahan: [0.06, 0.09] },
        issues: ['mau ada arisan', 'baru selesai acara keluarga', 'ART pulang kampung', 'rumah lama tidak ditempati'],
        desc: (v) => `Bersih rumah ${v.q} jam, ${v.issue}. Rumah ${v.pick(['tipe 36', 'tipe 45', '2 lantai', 'tipe 54'])}.`,
        scope: (v) => `General cleaning ${v.q} jam: sapu-pel seluruh ruangan, lap debu, dapur, dan kamar mandi.`,
        done: ['Selesai sesuai jam, pelanggan puas.', 'Selesai, kamar mandi berkerak perlu deep cleaning lain kali.'] },
      { name: 'Deep cleaning rumah', w: 22, q: [[1, 100]], unit: 'rumah', price: [450000, 1400000], dur: [5, 9], cost: { tenaga: [0.4, 0.46], bahan: [0.09, 0.13] },
        issues: ['menjelang Lebaran', 'mau ditempati penyewa baru', 'habis banjir kecil', 'rumah baru pindah'],
        desc: (v) => `Deep cleaning rumah (${v.issue}). ${v.pick(['3 kamar tidur, 2 kamar mandi.', '2 kamar tidur, 1 kamar mandi.', 'Rumah 2 lantai.'])}`,
        scope: () => 'Deep cleaning menyeluruh: kerak kamar mandi, dapur & kitchen set, jendela, plafon, dan lantai.',
        done: ['Deep cleaning selesai, kerak kamar mandi hilang ±90%.', 'Selesai 2 orang 7 jam. Saran perawatan rutin bulanan.'] },
      { name: 'Bersih kamar kos', w: 18, types: ['kos'], q: [[2, 30], [4, 35], [6, 25], [10, 10]], unit: 'kamar', price: [75000, 110000], min: 150000, dur: [2, 6], cost: { tenaga: [0.42, 0.5], bahan: [0.06, 0.09] },
        issues: ['pergantian penghuni', 'awal semester mahasiswa', 'kamar lama kosong'],
        desc: (v) => `Bersihkan ${v.q} kamar kos karena ${v.issue}.`,
        scope: (v) => `Pembersihan ${v.q} kamar kos (lantai, kamar mandi dalam, jendela, kasur divakum).`,
        done: ['Semua kamar siap huni.', 'Selesai, 1 kamar ada jamur dinding (disarankan cat ulang).'] },
      { name: 'Cuci sofa & kasur', w: 12, q: [[1, 40], [2, 40], [3, 20]], unit: 'item', price: [150000, 280000], dur: [2, 4], cost: { tenaga: [0.34, 0.4], bahan: [0.12, 0.16] }, rain: 0.8,
        issues: ['noda tumpahan', 'tungau/alergi', 'bau apek'],
        desc: (v) => `Cuci ${v.q} item (sofa/kasur): ${v.issue}.`,
        scope: (v) => `Cuci ${v.q} item sofa/kasur dengan mesin ekstraksi dan sanitasi anti-tungau.`,
        done: ['Selesai, perlu 6–8 jam kering.', 'Noda hilang sebagian besar, noda tinta tidak bisa 100%.'] },
      { name: 'Bersih pasca pindahan', w: 8, q: [[1, 100]], unit: 'rumah', price: [400000, 1100000], dur: [4, 8], cost: { tenaga: [0.4, 0.46], bahan: [0.08, 0.11] },
        issues: ['serah terima kontrakan', 'pindah ke rumah baru'],
        desc: (v) => `Bersih rumah pasca pindahan (${v.issue}).`,
        scope: () => 'Pembersihan rumah kosong pasca pindahan: lantai, dinding, kamar mandi, dapur, buang sampah sisa.',
        done: ['Rumah kosong sudah bersih, siap serah terima.'] },
    ],
    overheads: [
      { label: 'Pulsa & kuota internet', cat: 'biaya_lain', day: 5, amt: () => 120000 },
      { label: 'Iklan Instagram/TikTok', cat: 'biaya_lain', day: 10, amt: (c) => c.r.uni(200000, 500000) },
      { label: 'Perlengkapan (mop, vakum, lap) penyusutan', cat: 'biaya_lain', day: 25, amt: (c) => c.r.uni(250000, 450000) },
      { label: 'Cicilan motor & BBM antar-jemput helper', cat: 'biaya_transport', day: 8, amt: () => 950000 },
      { label: 'Seragam & BPJS Ketenagakerjaan helper', cat: 'biaya_lain', day: 15, amt: () => 350000 },
    ],
    thr: { kind: 'fixed', amount: 1500000, label: 'THR 2 helper' },
  },
  /* -------------------------------------------------------- 3. Listrik */
  {
    k: 3, key: 'listrik', scale: 'sole', email: 'demo-listrik@satualur.id', name: 'Hendra Siregar (Listrik Siaga Medan)', industry: 'Tukang listrik: instalasi & perbaikan',
    regions: [region('MDN')], base: 16e6, margin: [0.25, 0.35],
    moy: [1.08, 1.06, 1.02, 0.98, 0.96, 0.97, 0.98, 0.96, 0.98, 1.0, 1.04, 1.05],
    custMix: { individu: 70, umkm: 24, korporat: 6 },
    workers: { owner: 'Hendra Siregar', helpers: [['Hendra Siregar & Bonar (helper)', -99]], helperP: 0.7 },
    labourLineP: 0.7, transportAbs: [20000, 50000],
    services: [
      { name: 'Perbaikan korsleting', w: 30, q: [[1, 100]], unit: 'titik', price: [150000, 600000], dur: [1, 3], cost: { tenaga: [0.16, 0.22], bahan: [0.28, 0.36] }, rain: 1.35,
        issues: ['MCB turun terus saat hujan', 'stop kontak berasap', 'lampu kedap-kedip', 'listrik padam sebagian rumah'],
        desc: (v) => `Korsleting: ${v.issue}. ${v.pick(['Rumah 1 lantai.', 'Rumah 2 lantai.', 'Ruko.'])}`,
        scope: () => 'Pelacakan sumber korsleting, perbaikan jalur kabel, dan penggantian komponen yang terbakar.',
        done: ['Sambungan kabel di plafon meleleh, sudah diganti kabel NYM baru.', 'Stop kontak kamar mandi kemasukan air, diganti tipe outdoor.', 'Grounding tidak ada, disarankan pasang grounding (penawaran terpisah).'] },
      { name: 'Instalasi titik lampu/stop kontak', w: 22, q: [[2, 30], [4, 35], [6, 20], [10, 15]], unit: 'titik', price: [80000, 120000], min: 150000, dur: [2, 5], cost: { tenaga: [0.18, 0.24], bahan: [0.38, 0.46] },
        issues: ['renovasi dapur', 'tambah kamar', 'pasang lampu taman', 'buka usaha di rumah'],
        desc: (v) => `Tambah ${v.q} titik lampu/stop kontak untuk ${v.issue}.`,
        scope: (v) => `Instalasi ${v.q} titik baru dengan kabel NYM 2x1,5 mm, pipa conduit, dan saklar/stop kontak standar SNI.`,
        done: ['Semua titik terpasang dan diuji.', 'Selesai, jalur ditanam di dinding (plester ditambal).'] },
      { name: 'Ganti MCB / panel & tambah daya', w: 18, q: [[1, 100]], unit: 'panel', price: [350000, 1500000], dur: [2, 5], cost: { tenaga: [0.16, 0.22], bahan: [0.42, 0.5] },
        issues: ['naik daya 1300 ke 2200 VA', 'MCB lama sering panas', 'panel ruko mau dipisah per lantai'],
        desc: (v) => `Panel listrik: ${v.issue}.`,
        scope: () => 'Penggantian/penambahan MCB dan box panel, penataan ulang grup beban, uji beban.',
        done: ['Panel baru 4 grup terpasang, beban dibagi rata.', 'MCB diganti, siap untuk pengajuan tambah daya ke PLN.'] },
      { name: 'Instalasi listrik rumah baru', w: 6, q: [[15, 40], [25, 40], [40, 20]], unit: 'titik', price: [95000, 125000], dur: [8, 24], cost: { tenaga: [0.22, 0.28], bahan: [0.42, 0.48] },
        issues: ['rumah baru dibangun', 'renovasi total'],
        desc: (v) => `Instalasi listrik ${v.q} titik untuk ${v.issue}. Gambar denah ada.`,
        scope: (v) => `Instalasi listrik ${v.q} titik lengkap dengan panel, grounding, dan pengujian sebelum SLO.`,
        done: ['Instalasi selesai bertahap 3 hari, siap uji SLO.', 'Selesai, gambar as-built dikirim ke pemilik.'] },
      { name: 'Pasang pompa air & jalur listrik', w: 12, q: [[1, 100]], unit: 'unit', price: [450000, 1400000], dur: [2, 4], cost: { tenaga: [0.12, 0.18], bahan: [0.46, 0.56] },
        issues: ['pompa lama mati', 'pasang pompa sumur dangkal', 'otomatis pompa rusak'],
        desc: (v) => `Pompa air: ${v.issue}.`,
        scope: () => 'Pemasangan/penggantian pompa air beserta jalur listrik, otomatis, dan pengujian tekanan.',
        done: ['Pompa terpasang, otomatis disetel.', 'Otomatis diganti, pompa lama masih layak.'] },
      { name: 'Pemeriksaan instalasi ruko/kantor', w: 12, types: ['umkm', 'korporat'], q: [[1, 100]], unit: 'lokasi', price: [250000, 700000], dur: [2, 4], cost: { tenaga: [0.22, 0.28], bahan: [0.06, 0.1] },
        issues: ['tagihan listrik melonjak', 'persiapan buka toko', 'pemeriksaan berkala'],
        desc: (v) => `Pemeriksaan instalasi: ${v.issue}.`,
        scope: () => 'Pemeriksaan instalasi (beban, grounding, kebocoran arus) dengan laporan rekomendasi tertulis.',
        done: ['Ada kebocoran arus di jalur AC, rekomendasi ganti kabel.', 'Instalasi aman, beban perlu dibagi ulang.'] },
    ],
    overheads: [
      { label: 'Pulsa & kuota internet', cat: 'biaya_lain', day: 5, amt: () => 150000 },
      { label: 'Iklan Google Maps / Facebook', cat: 'biaya_lain', day: 12, amt: (c) => c.r.uni(200000, 500000) },
      { label: 'Kalibrasi & penyusutan tang ampere, tester', cat: 'biaya_lain', day: 26, amt: (c) => c.r.uni(150000, 300000) },
      { label: 'Cicilan & servis motor', cat: 'biaya_transport', day: 8, amt: () => 800000 },
    ],
    thr: { kind: 'fixed', amount: 1000000, label: 'THR helper' },
  },
  /* -------------------------------------------------------- 4. Pest */
  {
    k: 4, key: 'pest', scale: 'ukm', email: 'demo-pest@satualur.id', name: 'CV Basmi Hama Nusantara', industry: 'Pest control (rumah, F&B, gudang, pabrik)',
    regions: [region('SBY', { w: 0.8 }), region('SDA', { w: 0.2 })], base: 172e6, margin: [0.15, 0.25],
    moy: [1.08, 1.1, 1.06, 1.0, 0.95, 0.92, 0.9, 0.92, 0.95, 1.0, 1.04, 1.06],
    custMix: { individu: 30, umkm: 35, korporat: 30, instansi: 5 },
    workers: { roster: ['Agus Salim', 'Siti Aminah', 'Joko Purnomo', 'Rahmat Hidayat', 'Dedi Kurniawan', 'Eko Prasetyo', 'Wahyu Nugroho', 'Teguh Santoso', 'Fajar Ramadhan', 'Imam Syafii', 'Bayu Saputra', 'Yusuf Maulana', 'Heru Susanto', 'Andre Wijaya', 'Gilang Permana'], revPerWorker: 17e6, min: 8, max: 15, team: 'Tim {lead} ({n} orang)' },
    contract: { share: 0.45, churn: 0.02, services: [
      { name: 'Kontrak pest control bulanan', w: 100, types: ['umkm', 'korporat', 'instansi'], q: [[2, 60], [4, 40]], unit: 'kunjungan', price: [900000, 3500000], cost: { tenaga: [0.3, 0.36], bahan: [0.18, 0.24] },
        scope: (v) => `Pengendalian hama terpadu ${v.q} kunjungan/bulan (kecoa, tikus, semut, lalat) termasuk pemasangan & monitoring bait station.`,
        done: ['Monitoring bait station: aktivitas tikus turun. Laporan bulanan terlampir.', 'Kunjungan lengkap, temuan kecoa di area dapur ditindak gel bait.', 'Laporan tren hama dikirim ke QA pelanggan.'] },
    ] },
    services: [
      { name: 'Anti rayap pra-konstruksi', w: 10, types: ['korporat', 'individu'], q: [[100, 30], [250, 35], [600, 25], [1200, 10]], unit: 'm²', price: [30000, 45000], dur: [6, 24], cost: { tenaga: [0.2, 0.26], bahan: [0.32, 0.4] }, tags: ['outdoor'],
        issues: ['pembangunan rumah baru', 'pembangunan gudang', 'perluasan pabrik'],
        desc: (v) => `Soil treatment anti rayap ${v.q} m² untuk ${v.issue}.`,
        scope: (v) => `Soil treatment anti rayap pra-konstruksi ${v.q} m² dengan termitisida terdaftar, sertifikat garansi 5 tahun.`,
        done: ['Injeksi tanah selesai sebelum pengecoran, sertifikat garansi diterbitkan.', 'Selesai 2 tahap mengikuti jadwal kontraktor.'] },
      { name: 'Anti rayap pasca-konstruksi', w: 20, q: [[1, 100]], unit: 'bangunan', price: [2500000, 15000000], dur: [5, 16], cost: { tenaga: [0.26, 0.32], bahan: [0.26, 0.32] }, rain: 1.2,
        issues: ['kusen pintu keropos', 'lemari dimakan rayap', 'laron keluar tiap hujan'],
        desc: (v) => `Rayap: ${v.issue}. ${v.pick(['Rumah 2 lantai.', 'Ruko 3 lantai.', 'Rumah tipe 70.'])}`,
        scope: () => 'Pengeboran dan injeksi termitisida di sekeliling bangunan, baiting di titik aktif, garansi 1 tahun.',
        done: ['Injeksi keliling bangunan selesai, 6 titik aktif dipasang bait.', 'Pengeboran lantai keramik ditutup ulang rapi.'] },
      { name: 'Fogging nyamuk / DBD', w: 26, q: [[1, 100]], unit: 'area', price: [400000, 2500000], dur: [1, 3], cost: { tenaga: [0.28, 0.34], bahan: [0.2, 0.26] }, rain: 1.6, tags: ['outdoor'],
        issues: ['ada warga kena DBD', 'banyak nyamuk sejak musim hujan', 'acara di area terbuka'],
        desc: (v) => `Fogging ${v.pick(['perumahan', 'sekolah', 'area pabrik', 'masjid dan halaman'])}: ${v.issue}.`,
        scope: () => 'Fogging dan larvasida (abatisasi) di area yang disepakati, 2 siklus dengan jarak 1 minggu.',
        done: ['Siklus 1 selesai, siklus 2 dijadwalkan minggu depan.', 'Fogging selesai, jentik ditemukan di talang air.'] },
      { name: 'Pengendalian tikus', w: 18, q: [[1, 100]], unit: 'lokasi', price: [900000, 6000000], dur: [3, 8], cost: { tenaga: [0.3, 0.36], bahan: [0.2, 0.26] }, rain: 1.15,
        issues: ['tikus di gudang bahan baku', 'kabel digigit tikus', 'temuan saat audit keamanan pangan'],
        desc: (v) => `Pengendalian tikus: ${v.issue}.`,
        scope: () => 'Inspeksi, pemasangan bait station dan perangkap, proofing celah masuk, laporan peta aktivitas.',
        done: ['Bait station terpasang, 3 jalur masuk ditutup.', 'Aktivitas tikus turun, rekomendasi kontrak bulanan.'] },
      { name: 'Fumigasi gudang/kontainer', w: 10, types: ['korporat'], q: [[1, 60], [2, 30], [4, 10]], unit: 'kontainer/ruang', price: [1800000, 4500000], dur: [24, 72], cost: { tenaga: [0.2, 0.26], bahan: [0.34, 0.4] },
        issues: ['ekspor kayu/palet (ISPM-15)', 'kutu beras di gudang', 'persyaratan buyer'],
        desc: (v) => `Fumigasi ${v.q} kontainer/ruang: ${v.issue}.`,
        scope: (v) => `Fumigasi ${v.q} kontainer/ruang dengan sertifikat fumigasi, termasuk pengukuran konsentrasi.`,
        done: ['Fumigasi selesai, sertifikat diterbitkan.', 'Waktu papar 48 jam terpenuhi, gas dilepas aman.'] },
      { name: 'Disinfeksi ruangan', w: 8, q: [[1, 100]], unit: 'area', price: [800000, 4000000], dur: [2, 5], cost: { tenaga: [0.26, 0.32], bahan: [0.2, 0.26] },
        issues: ['ada karyawan sakit menular', 'persiapan audit', 'pasca banjir'],
        desc: (v) => `Disinfeksi area kantor/gudang: ${v.issue}.`,
        scope: () => 'Disinfeksi ruangan dengan metode spraying/ULV, disinfektan terdaftar, berita acara.',
        done: ['Disinfeksi selesai, ruangan bisa dipakai setelah 2 jam.'] },
    ],
    overheads: [
      { label: 'Gaji admin, supervisor & BPJS', cat: 'biaya_tenaga', day: 25, amt: (c) => 14e6 * c.r.uni(0.98, 1.02) * Math.pow(1.004, c.i) },
      { label: 'Sewa kantor & gudang bahan', cat: 'biaya_lain', day: 3, amt: () => 6.5e6 },
      { label: 'Izin, sertifikasi & APD', cat: 'biaya_lain', day: 15, amt: (c) => c.r.uni(1.5e6, 3e6) },
      { label: 'Marketing (Google Ads, katalog)', cat: 'biaya_lain', day: 10, amt: (c) => c.trend * c.r.uni(0.015, 0.025) },
      { label: 'BBM & servis kendaraan operasional', cat: 'biaya_transport', day: 27, amt: (c) => c.trend * c.r.uni(0.012, 0.018) },
    ],
    thr: { kind: 'perWorker', amount: 4.6e6, label: 'THR teknisi' },
  },
  /* ------------------------------------------------------- 5. Laundry */
  {
    k: 5, key: 'laundry', scale: 'ukm', email: 'demo-laundry@satualur.id', name: 'CV Wangi Bersih Laundry', industry: 'Laundry kiloan + B2B hotel/restoran/klinik',
    regions: [region('BDG')], base: 158e6, margin: [0.15, 0.25],
    moy: [0.94, 1.0, 1.04, 0.98, 1.0, 1.06, 1.06, 0.98, 0.96, 0.98, 1.0, 1.08],
    custMix: { individu: 22, umkm: 18, korporat: 14, hotel: 20, resto: 14, salon: 8, klinik: 4 },
    workers: { roster: ['Neneng Suryani', 'Asep Saepudin', 'Euis Rahmawati', 'Dadang Hermawan', 'Yayan Sopyan', 'Lilis Andriani', 'Ujang Kurnia', 'Cucu Lestari', 'Iwan Setiawan', 'Rika Nuraeni', 'Ade Permana', 'Dewi Kartika', 'Ujang Ramdani', 'Tati Rohayati', 'Rudi Gunawan'], revPerWorker: 16.5e6, min: 8, max: 15, team: 'Shift {lead} ({n} orang)' },
    contract: { share: 0.42, churn: 0.02, services: [
      { name: 'Kontrak laundry linen hotel/restoran', w: 75, types: ['hotel', 'resto'], q: [[800, 30], [1500, 40], [2500, 30]], unit: 'kg', price: [8500, 11000], cost: { tenaga: [0.28, 0.34], bahan: [0.13, 0.17] },
        scope: (v) => `Laundry linen (sprei, handuk, taplak, seragam) estimasi ${v.q} kg/bulan, antar-jemput harian, SLA 24 jam.`,
        done: ['Rekap bulanan sesuai berita acara timbang. 3 item noda permanen dilaporkan.', 'Semua pengiriman tepat SLA, 1 keluhan handuk kurang wangi ditangani.'] },
      { name: 'Kontrak laundry klinik/salon', w: 25, types: ['salon', 'klinik'], q: [[200, 40], [400, 40], [700, 20]], unit: 'kg', price: [11000, 14000], cost: { tenaga: [0.28, 0.34], bahan: [0.15, 0.19] },
        scope: (v) => `Laundry handuk dan linen klinik/salon ±${v.q} kg/bulan, pemisahan linen infeksius, antar-jemput 3x seminggu.`,
        done: ['Rekap bulanan lengkap, linen infeksius diproses terpisah.'] },
    ] },
    services: [
      { name: 'Rekap laundry kiloan harian', w: 140, fixed: 'outlet', q: [[1, 100]], unit: 'hari', price: [1100000, 2600000], dur: [9, 12], cost: { tenaga: [0.28, 0.34], bahan: [0.12, 0.16] }, rain: 1.2,
        desc: (v) => `Rekap kasir kiloan & satuan walk-in ${v.customer.replace('Pelanggan walk-in — ', '')} hari ini: ${v.r.int(25, 70)} nota, ±${v.r.int(120, 300)} kg.`,
        scope: () => 'Rekap penjualan layanan kiloan, satuan, dan express pelanggan walk-in selama satu hari kerja outlet.',
        done: ['Kas harian ditutup, sesuai laporan kasir.', 'Kas ditutup; 1 klaim baju luntur dikompensasi.', 'Kas ditutup, 3 order express selesai < 6 jam.'] },
      { name: 'Cuci karpet masjid/kantor', w: 14, types: ['umkm', 'korporat', 'individu'], q: [[30, 40], [80, 35], [200, 25]], unit: 'm²', price: [18000, 25000], min: 300000, dur: [24, 72], cost: { tenaga: [0.3, 0.36], bahan: [0.1, 0.14] }, rain: 0.75,
        issues: ['menjelang Ramadan', 'karpet bau lembap', 'acara kantor'],
        desc: (v) => `Cuci karpet ${v.q} m² (${v.issue}), minta antar-jemput.`,
        scope: (v) => `Cuci karpet ${v.q} m² (vakum, shampoo, bilas, pengeringan), termasuk antar-jemput.`,
        done: ['Karpet bersih dan kering, dikirim kembali.', 'Selesai, 1 karpet bernoda lama tidak hilang total.'] },
      { name: 'Cuci gorden & bed cover', w: 14, q: [[5, 40], [12, 40], [30, 20]], unit: 'pcs', price: [35000, 60000], min: 200000, dur: [24, 72], cost: { tenaga: [0.28, 0.34], bahan: [0.1, 0.14] },
        issues: ['bersih-bersih menjelang Lebaran', 'pindahan', 'gorden kantor kusam'],
        desc: (v) => `Cuci ${v.q} pcs gorden/bed cover (${v.issue}).`,
        scope: (v) => `Cuci ${v.q} pcs gorden/bed cover, lepas-pasang gorden bila diminta.`,
        done: ['Selesai dan dipasang kembali.', 'Selesai, 2 gorden menyusut sedikit (sudah diinformasikan).'] },
      { name: 'Laundry seragam/event', w: 10, types: ['korporat', 'umkm'], q: [[100, 40], [300, 40], [600, 20]], unit: 'pcs', price: [6000, 9000], min: 500000, dur: [24, 48], cost: { tenaga: [0.3, 0.36], bahan: [0.1, 0.14] },
        issues: ['seragam karyawan pabrik', 'linen catering pernikahan', 'kostum acara kampus'],
        desc: (v) => `Laundry ${v.q} pcs untuk ${v.issue}.`,
        scope: (v) => `Cuci-setrika ${v.q} pcs dengan pengemasan per nama/divisi.`,
        done: ['Selesai tepat waktu, dikemas per divisi.'] },
    ],
    outlets: ['Outlet Dago', 'Outlet Buahbatu', 'Outlet Antapani'],
    overheads: [
      { label: 'Gaji admin, kurir & BPJS', cat: 'biaya_tenaga', day: 25, amt: (c) => 11e6 * c.r.uni(0.98, 1.02) },
      { label: 'Sewa 3 outlet & workshop', cat: 'biaya_lain', day: 3, amt: () => 11.5e6 },
      { label: 'Listrik, gas LPG pengering & air', cat: 'biaya_lain', day: 20, amt: (c) => c.trend * c.r.uni(0.07, 0.085) },
      { label: 'Penyusutan & servis mesin cuci/dryer', cat: 'biaya_lain', day: 26, amt: (c) => c.r.uni(3e6, 4.5e6) },
      { label: 'Promosi (Instagram, GoFood/ShopeeFood mitra)', cat: 'biaya_lain', day: 10, amt: (c) => c.trend * c.r.uni(0.01, 0.02) },
      { label: 'BBM armada antar-jemput', cat: 'biaya_transport', day: 27, amt: (c) => c.trend * c.r.uni(0.02, 0.03) },
    ],
    thr: { kind: 'perWorker', amount: 4.1e6, label: 'THR karyawan' },
  },
  /* -------------------------------------------------------- 6. Dinding */
  {
    k: 6, key: 'dinding', scale: 'ukm', email: 'demo-dinding@satualur.id', name: 'CV Glasur Dinding Borneo', industry: 'Glasur & dinding: pengecatan, coating, waterproofing',
    regions: [region('BPN')], base: 185e6, margin: [0.15, 0.25],
    moy: [0.84, 0.86, 1.02, 0.98, 1.04, 1.08, 1.1, 1.12, 1.1, 1.06, 0.92, 0.88],
    custMix: { individu: 45, umkm: 20, korporat: 30, instansi: 5 },
    workers: { roster: ['Syamsul Bahri', 'La Ode Rahman', 'Andi Baso', 'Ruslan Effendi', 'Jumadi', 'Muh. Arsyad', 'Kadir Daeng', 'Samsuddin', 'Haris Munandar', 'Paulus Tandi', 'Yohanis Toding', 'Rahmat Saleh', 'Akbar Pratama', 'Fadli Hasan', 'Irwan Syah'], revPerWorker: 18e6, min: 8, max: 15, team: 'Tim {lead} ({n} orang)' },
    services: [
      { name: 'Pengecatan interior', w: 30, q: [[80, 30], [150, 35], [300, 25], [600, 10]], unit: 'm²', price: [28000, 42000], min: 1500000, dur: [16, 72], cost: { tenaga: [0.22, 0.28], bahan: [0.32, 0.38] },
        issues: ['menjelang Lebaran', 'rumah baru dibeli', 'kantor rebranding warna', 'dinding kusam dan berjamur'],
        desc: (v) => `Cat ulang interior ±${v.q} m² (${v.issue}). Warna ${v.pick(['putih tulang', 'abu muda', 'krem', 'sesuai brand'])}.`,
        scope: (v) => `Pengecatan interior ±${v.q} m²: pengamplasan, plamir titik retak, 1 lapis sealer, 2 lapis cat akhir.`,
        done: ['Selesai 2 lapis, sisa cat diserahkan ke pemilik.', 'Ada rembesan di 1 dinding, disarankan waterproofing.'] },
      { name: 'Pengecatan eksterior', w: 18, q: [[100, 35], [250, 40], [500, 25]], unit: 'm²', price: [38000, 55000], min: 3000000, dur: [24, 120], cost: { tenaga: [0.24, 0.3], bahan: [0.32, 0.38] }, tags: ['outdoor'],
        issues: ['cat mengelupas kena hujan', 'fasad ruko baru', 'gedung sekolah'],
        desc: (v) => `Cat eksterior ±${v.q} m²: ${v.issue}. Butuh scaffolding.`,
        scope: (v) => `Pengecatan eksterior ±${v.q} m² dengan cat weatherproof, termasuk scaffolding dan pembersihan jamur.`,
        done: ['Selesai, 2 hari tertunda hujan.', 'Fasad selesai, scaffolding dibongkar.'] },
      { name: 'Waterproofing dak/atap', w: 22, q: [[30, 35], [80, 40], [200, 25]], unit: 'm²', price: [110000, 165000], min: 2500000, dur: [16, 72], cost: { tenaga: [0.18, 0.24], bahan: [0.36, 0.44] }, tags: ['outdoor'], rain: 1.2,
        issues: ['dak bocor saat hujan deras', 'plafon rembes', 'kamar mandi lantai atas rembes ke bawah'],
        desc: (v) => `Waterproofing ±${v.q} m²: ${v.issue}.`,
        scope: (v) => `Waterproofing membran/coating ±${v.q} m², uji genang 24 jam, garansi 2 tahun.`,
        done: ['Uji genang 24 jam lolos, garansi 2 tahun.', 'Retak struktur ditambal dulu, lalu coating 2 lapis.'] },
      { name: 'Coating glasur & tekstur dinding', w: 14, q: [[40, 40], [100, 40], [250, 20]], unit: 'm²', price: [140000, 240000], min: 3000000, dur: [24, 96], cost: { tenaga: [0.24, 0.3], bahan: [0.36, 0.44] },
        issues: ['lobi kantor', 'kafe baru', 'fasad showroom', 'ruang tamu'],
        desc: (v) => `Coating glasur/tekstur ±${v.q} m² untuk ${v.issue}. Minta sampel warna.`,
        scope: (v) => `Aplikasi coating glasur/tekstur dekoratif ±${v.q} m² termasuk sampel warna dan lapisan pelindung.`,
        done: ['Selesai sesuai sampel yang disetujui.', 'Finishing glossy, pelanggan minta touch-up 1 sudut (sudah).'] },
      { name: 'Perbaikan retak & plester aci', w: 16, q: [[1, 100]], unit: 'lokasi', price: [1500000, 9000000], dur: [8, 48], cost: { tenaga: [0.3, 0.36], bahan: [0.26, 0.34] },
        issues: ['dinding retak rambut', 'plester kopong', 'bekas bongkar kusen'],
        desc: (v) => `Perbaikan dinding: ${v.issue}.`,
        scope: () => 'Bobok bagian kopong, plester-aci ulang, dan cat setempat menyesuaikan warna existing.',
        done: ['Perbaikan selesai, warna disamakan.'] },
    ],
    overheads: [
      { label: 'Gaji admin, estimator & BPJS', cat: 'biaya_tenaga', day: 25, amt: (c) => 13e6 * c.r.uni(0.98, 1.02) * Math.pow(1.005, c.i) },
      { label: 'Sewa workshop & gudang material', cat: 'biaya_lain', day: 3, amt: () => 7e6 },
      { label: 'Sewa/penyusutan scaffolding & alat semprot', cat: 'biaya_lain', day: 18, amt: (c) => c.r.uni(3e6, 5e6) },
      { label: 'Marketing (Instagram, kerja sama toko cat)', cat: 'biaya_lain', day: 10, amt: (c) => c.trend * c.r.uni(0.012, 0.02) },
      { label: 'BBM pikap & mobil survei', cat: 'biaya_transport', day: 27, amt: (c) => c.trend * c.r.uni(0.012, 0.018) },
    ],
    thr: { kind: 'perWorker', amount: 4.4e6, label: 'THR tukang tetap' },
  },
  /* ---------------------------------------------------------- 7. Mall */
  {
    k: 7, key: 'mall', scale: 'enterprise', email: 'demo-mall@satualur.id', name: 'PT Arunika Layanan Ritel', industry: 'Retail mall: kebersihan & maintenance mal',
    regions: [region('JKT', { w: 0.34 }), region('BDT', { w: 0.2 }), region('BDG', { w: 0.12 }), region('SBY', { w: 0.14 }), region('MDN', { w: 0.1 }), region('BTM', { w: 0.05, open: 3 }), region('MKS', { w: 0.07, open: 2 }), region('BPN', { w: 0.07, open: 6 })],
    base: 1.5e9, margin: [0.1, 0.18], regionAlpha: 8, hq: 'JKT',
    moy: [0.9, 0.95, 1.06, 1.0, 0.98, 1.04, 1.04, 0.98, 0.98, 1.0, 1.0, 1.12],
    custMix: { mall: 100 },
    workers: { teamPerRev: 140e6 },
    contract: { share: 0.62, churn: 0.008, services: [
      { name: 'Kontrak kebersihan mal (bulanan)', w: 60, types: ['mall'], q: [[18, 30], [28, 40], [45, 30]], unit: 'petugas', price: [6.2e6, 7.4e6], cost: { tenaga: [0.6, 0.64], bahan: [0.09, 0.11] },
        scope: (v) => `Jasa kebersihan mal 3 shift, ${v.q} petugas termasuk supervisor, chemical, dan peralatan; laporan SLA bulanan.`,
        done: ['BAST bulan ini ditandatangani building manager. Skor SLA 96%.', 'BAST terbit; 2 komplain toilet lantai 3 ditutup < 2 jam.', 'Skor audit kebersihan 94%, tambahan petugas akhir pekan disetujui.'] },
      { name: 'Kontrak maintenance MEP mal (bulanan)', w: 40, types: ['mall'], q: [[5, 40], [8, 40], [12, 20]], unit: 'teknisi', price: [8.5e6, 10.5e6], cost: { tenaga: [0.52, 0.58], bahan: [0.15, 0.19] },
        scope: (v) => `Preventive & corrective maintenance MEP (chiller, AHU, eskalator koordinasi vendor, plumbing, genset), ${v.q} teknisi on-site.`,
        done: ['PM chiller & AHU sesuai jadwal; 14 work order corrective ditutup.', 'BAST terbit; downtime eskalator 0,5%, di bawah batas SLA.'] },
    ] },
    services: [
      { name: 'Work order perbaikan ringan tenant/area publik', w: 45, types: ['mall'], q: [[1, 100]], unit: 'work order', price: [1.5e6, 6e6], dur: [2, 8], cost: { tenaga: [0.34, 0.4], bahan: [0.3, 0.36] },
        issues: ['pintu toilet macet', 'lampu koridor parkir mati', 'kran wastafel bocor', 'plafon area tenant rembes', 'handle eskalator kotor dan lengket'],
        desc: (v) => `Work order area publik/tenant: ${v.issue}.`,
        scope: () => 'Perbaikan ringan di luar lingkup kontrak bulanan, dikerjakan di luar jam ramai pengunjung.',
        done: ['Selesai, foto before-after diunggah ke tiket.', 'Perbaikan selesai < SLA 24 jam.'] },
      { name: 'Deep cleaning area food court', w: 22, types: ['mall'], q: [[1, 100]], unit: 'area', price: [6e6, 22e6], dur: [6, 14], cost: { tenaga: [0.42, 0.5], bahan: [0.16, 0.22] },
        issues: ['temuan audit higiene', 'persiapan grand opening tenant', 'lantai licin berminyak'],
        desc: (v) => `Work order deep cleaning food court: ${v.issue}. Dikerjakan malam setelah mal tutup.`,
        scope: () => 'Deep cleaning food court (degreasing lantai, grease trap koordinasi, dinding & kursi) malam hari.',
        done: ['Selesai 2 malam, foto before-after terlampir.', 'Grease trap dikuras, bau hilang.'] },
      { name: 'Pembersihan fasad & kaca atrium', w: 14, types: ['mall'], q: [[1, 100]], unit: 'gedung', price: [18e6, 70e6], dur: [24, 96], cost: { tenaga: [0.46, 0.52], bahan: [0.08, 0.12] }, tags: ['outdoor'],
        issues: ['jadwal semesteran', 'menjelang dekorasi Lebaran', 'menjelang dekorasi Natal & Tahun Baru'],
        desc: (v) => `Pembersihan fasad/kaca atrium dengan gondola/rope access: ${v.issue}.`,
        scope: () => 'Pembersihan fasad dan kaca atrium dengan gondola/rope access bersertifikat K3, termasuk izin kerja ketinggian.',
        done: ['Selesai, 1 hari tertunda angin kencang.', 'Fasad bersih, laporan K3 nihil insiden.'] },
      { name: 'Event cleaning (pameran/konser)', w: 20, types: ['mall'], q: [[1, 100]], unit: 'event', price: [5e6, 25e6], dur: [12, 72], cost: { tenaga: [0.5, 0.56], bahan: [0.1, 0.14] },
        issues: ['pameran otomotif di atrium', 'konser akhir pekan', 'bazar Ramadan', 'midnight sale'],
        desc: (v) => `Tambahan petugas kebersihan untuk ${v.issue}.`,
        scope: () => 'Tambahan tim kebersihan selama event (persiapan, berjalan, pasca-event) sesuai rundown.',
        done: ['Event selesai, area kembali normal sebelum mal buka.', 'Sampah event 3,2 ton diangkut.'] },
      { name: 'Perbaikan MEP non-rutin', w: 26, types: ['mall'], q: [[1, 100]], unit: 'work order', price: [4e6, 35e6], dur: [4, 48], cost: { tenaga: [0.3, 0.36], bahan: [0.32, 0.4] },
        issues: ['pompa transfer air bersih rusak', 'AHU lantai 2 bunyi kasar', 'panel lampu parkir trip', 'pipa toilet bocor ke tenant bawah'],
        desc: (v) => `Work order corrective: ${v.issue}.`,
        scope: () => 'Perbaikan corrective di luar lingkup PM kontrak, termasuk penggantian sparepart sesuai persetujuan building manager.',
        done: ['Sparepart diganti, unit normal. Garansi 3 bulan.', 'Perbaikan selesai, rekomendasi peremajaan unit tahun depan.'] },
      { name: 'Pest control & sanitasi tenant F&B', w: 18, types: ['mall'], q: [[1, 100]], unit: 'paket', price: [4e6, 14e6], dur: [4, 12], cost: { tenaga: [0.3, 0.36], bahan: [0.22, 0.28] }, rain: 1.2,
        issues: ['temuan tikus di loading dock', 'kecoa di area tenant F&B', 'persyaratan sertifikasi halal tenant'],
        desc: (v) => `Pest control tambahan: ${v.issue}.`,
        scope: () => 'Pest control dan sanitasi area tenant F&B dan loading dock, laporan untuk QA mal.',
        done: ['Treatment selesai, monitoring 2 minggu.', 'Laporan diserahkan ke tim QA mal.'] },
    ],
    overheads: [
      { label: 'Gaji & tunjangan staf kantor pusat', cat: 'biaya_tenaga', day: 25, amt: (c) => 85e6 * Math.pow(1.01, c.i) },
      { label: 'Sewa kantor pusat & cabang', cat: 'biaya_lain', day: 3, amt: (c) => 35e6 + 15e6 * c.branches },
      { label: 'Asuransi, K3 & sertifikasi', cat: 'biaya_lain', day: 15, amt: (c) => c.trend * c.r.uni(0.012, 0.016) },
      { label: 'IT, sistem absensi & admin', cat: 'biaya_lain', day: 20, amt: (c) => c.trend * c.r.uni(0.008, 0.012) },
      { label: 'Marketing & biaya tender', cat: 'biaya_lain', day: 10, amt: (c) => c.trend * c.r.uni(0.012, 0.02) },
      { label: 'Kendaraan operasional & perjalanan dinas', cat: 'biaya_transport', day: 27, amt: (c) => c.trend * c.r.uni(0.01, 0.015) },
    ],
    thr: { kind: 'accrued' },
  },
  /* ------------------------------------------------------------ 8. FM */
  {
    k: 8, key: 'fm', scale: 'enterprise', email: 'demo-fm@satualur.id', name: 'PT Prima Layanan Fasilitas', industry: 'Facility management kantor BUMN, perbankan & perkantoran',
    regions: [region('JKT', { w: 0.4 }), region('BDT', { w: 0.12 }), region('BDG', { w: 0.1 }), region('SBY', { w: 0.12 }), region('MDN', { w: 0.08 }), region('SMG', { w: 0.06 }), region('BPN', { w: 0.08, open: 1 }), region('MKS', { w: 0.06, open: 4 }), region('MRW', { w: 0.05, open: 6 })],
    base: 1.6e9, margin: [0.1, 0.18], regionAlpha: 8, hq: 'JKT',
    moy: [0.86, 0.93, 0.98, 0.97, 1.0, 1.02, 1.0, 1.0, 1.02, 1.04, 1.04, 1.1],
    custMix: { kantor: 100 },
    workers: { teamPerRev: 150e6 },
    contract: { share: 0.6, churn: 0.008, services: [
      { name: 'Kontrak facility management gedung (bulanan)', w: 55, types: ['kantor'], q: [[15, 30], [30, 40], [60, 30]], unit: 'personel', price: [6.8e6, 8.2e6], cost: { tenaga: [0.6, 0.64], bahan: [0.08, 0.1] },
        scope: (v) => `Integrated FM (cleaning, office boy, teknisi gedung, resepsionis) ${v.q} personel, termasuk supervisor dan laporan KPI bulanan.`,
        done: ['BAST & laporan KPI bulanan diserahkan ke GA. Kehadiran personel 99,1%.', 'BAST terbit; 1 personel diganti atas permintaan klien.', 'Skor kepuasan GA 4,5/5; 21 tiket helpdesk ditutup.'] },
      { name: 'Kontrak perawatan kantor cabang (bulanan)', w: 45, types: ['kantor'], q: [[4, 40], [8, 40], [15, 20]], unit: 'kantor cabang', price: [7.5e6, 11e6], cost: { tenaga: [0.5, 0.56], bahan: [0.14, 0.18] },
        scope: (v) => `Perawatan rutin ${v.q} kantor cabang (AC, genset, UPS, plumbing, kebersihan ringan) sesuai jadwal PM dan SLA respon 4 jam.`,
        done: ['PM semua cabang sesuai jadwal; 2 cabang butuh penggantian kompresor (penawaran terpisah).', 'BAST terbit, SLA respon rata-rata 2,6 jam.'] },
    ] },
    services: [
      { name: 'Work order perbaikan ringan kantor', w: 45, types: ['kantor'], q: [[1, 100]], unit: 'work order', price: [1.2e6, 5e6], dur: [2, 6], cost: { tenaga: [0.34, 0.4], bahan: [0.3, 0.36] },
        issues: ['kunci laci & pintu rusak', 'lampu ruang rapat mati', 'kloset toilet lantai 5 mampet', 'kursi kerja patah', 'stop kontak meja tidak berfungsi'],
        desc: (v) => `Tiket helpdesk: ${v.issue}.`,
        scope: () => 'Perbaikan ringan via tiket helpdesk di luar lingkup kontrak, SLA respon 4 jam.',
        done: ['Tiket ditutup, foto diunggah.', 'Selesai, material diambil dari stok gedung.'] },
      { name: 'Perbaikan AC / genset / UPS (work order)', w: 30, types: ['kantor'], q: [[1, 100]], unit: 'work order', price: [3.5e6, 28e6], dur: [3, 24], cost: { tenaga: [0.28, 0.34], bahan: [0.36, 0.44] }, rain: 1.05,
        issues: ['kompresor AC ruang server mati', 'genset gagal start saat uji mingguan', 'baterai UPS drop', 'AC banking hall kurang dingin'],
        desc: (v) => `Work order: ${v.issue}. Mohon teknisi datang hari ini.`,
        scope: () => 'Perbaikan corrective termasuk penggantian sparepart sesuai persetujuan GA, laporan teknis dan foto.',
        done: ['Sparepart diganti, unit normal; laporan teknis diunggah.', 'Perbaikan sementara, sparepart indent 2 minggu.'] },
      { name: 'Renovasi ringan & pengecatan kantor', w: 18, types: ['kantor'], q: [[1, 100]], unit: 'paket', price: [12e6, 85e6], dur: [24, 160], cost: { tenaga: [0.3, 0.36], bahan: [0.36, 0.42] },
        issues: ['relayout ruang kerja', 'pengecatan sesuai brand guideline baru', 'perbaikan plafon bocor'],
        desc: (v) => `Renovasi ringan kantor: ${v.issue}.`,
        scope: () => 'Pekerjaan renovasi ringan (partisi, plafon, cat) dikerjakan di luar jam operasional, termasuk pembersihan akhir.',
        done: ['Selesai di luar jam kerja, BAST ditandatangani.', 'Selesai, 3 item punch list ditutup.'] },
      { name: 'Deep cleaning & sanitasi kantor', w: 22, types: ['kantor'], q: [[1, 100]], unit: 'gedung', price: [6e6, 30e6], dur: [8, 24], cost: { tenaga: [0.46, 0.52], bahan: [0.14, 0.18] },
        issues: ['menjelang audit kantor pusat', 'pasca renovasi', 'kunjungan direksi'],
        desc: (v) => `Deep cleaning kantor: ${v.issue}.`,
        scope: () => 'Deep cleaning (karpet ekstraksi, poles lantai, kaca, sanitasi pantry & toilet) akhir pekan.',
        done: ['Selesai akhir pekan, siap dipakai Senin.'] },
      { name: 'Pembersihan fasad & kaca gedung', w: 12, types: ['kantor'], q: [[1, 100]], unit: 'gedung', price: [20e6, 75e6], dur: [24, 96], cost: { tenaga: [0.46, 0.52], bahan: [0.08, 0.12] }, tags: ['outdoor'],
        issues: ['jadwal tahunan', 'HUT perusahaan', 'kunjungan tamu kementerian'],
        desc: (v) => `Pembersihan fasad gedung: ${v.issue}.`,
        scope: () => 'Pembersihan fasad dan kaca gedung dengan gondola/rope access bersertifikat K3.',
        done: ['Fasad selesai, nihil insiden K3.'] },
      { name: 'Perawatan taman & landscape', w: 10, types: ['kantor'], q: [[1, 100]], unit: 'area', price: [5e6, 20e6], dur: [8, 24], cost: { tenaga: [0.44, 0.5], bahan: [0.16, 0.22] }, tags: ['outdoor'],
        issues: ['penataan ulang taman depan', 'pohon tumbang', 'persiapan acara 17 Agustus'],
        desc: (v) => `Landscape: ${v.issue}.`,
        scope: () => 'Penataan dan perawatan taman (pangkas, tanam ulang, pupuk), termasuk pengangkutan sampah hijau.',
        done: ['Taman ditata ulang, rencana perawatan bulanan diusulkan.'] },
    ],
    overheads: [
      { label: 'Gaji & tunjangan staf kantor pusat', cat: 'biaya_tenaga', day: 25, amt: (c) => 95e6 * Math.pow(1.01, c.i) },
      { label: 'Sewa kantor pusat & cabang', cat: 'biaya_lain', day: 3, amt: (c) => 40e6 + 14e6 * c.branches },
      { label: 'Asuransi, K3 & sertifikasi ISO', cat: 'biaya_lain', day: 15, amt: (c) => c.trend * c.r.uni(0.012, 0.016) },
      { label: 'IT, helpdesk & admin', cat: 'biaya_lain', day: 20, amt: (c) => c.trend * c.r.uni(0.008, 0.012) },
      { label: 'Marketing & biaya tender (e-procurement)', cat: 'biaya_lain', day: 10, amt: (c) => c.trend * c.r.uni(0.012, 0.02) },
      { label: 'Kendaraan operasional & perjalanan dinas', cat: 'biaya_transport', day: 27, amt: (c) => c.trend * c.r.uni(0.01, 0.015) },
    ],
    thr: { kind: 'accrued' },
  },
  /* ------------------------------------------------------------ 9. RS */
  {
    k: 9, key: 'rs', scale: 'enterprise', email: 'demo-rs@satualur.id', name: 'PT Sehat Bersih Medika', industry: 'Hospital & healthcare housekeeping (RS, klinik bersalin, lab)',
    regions: [region('SBY', { w: 0.32 }), region('JKT', { w: 0.22 }), region('MLG', { w: 0.1 }), region('SMG', { w: 0.08 }), region('DPS', { w: 0.08 }), region('MKS', { w: 0.08, open: 2 }), region('BPN', { w: 0.07, open: 5 }), region('MDN', { w: 0.05, open: 7 })],
    base: 1.4e9, margin: [0.1, 0.18], regionAlpha: 8, hq: 'SBY',
    moy: [1.06, 1.06, 1.02, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 1.0, 1.0, 1.0],
    custMix: { rs: 70, klinik: 30 },
    workers: { teamPerRev: 130e6 },
    contract: { share: 0.66, churn: 0.006, services: [
      { name: 'Kontrak housekeeping rumah sakit (bulanan)', w: 65, types: ['rs'], q: [[18, 30], [30, 40], [50, 30]], unit: 'petugas', price: [6.6e6, 7.8e6], cost: { tenaga: [0.57, 0.61], bahan: [0.15, 0.19] },
        scope: (v) => `Housekeeping RS 24 jam ${v.q} petugas (ruang rawat, IGD, OK, ICU), standar PPI, chemical & APD termasuk, laporan SLA dan audit kebersihan.`,
        done: ['BAST ditandatangani; skor audit PPI 95%.', 'BAST terbit; respon pembersihan IGD rata-rata 9 menit (SLA 15).', 'Audit PPI 92%: temuan di ruang isolasi sudah ditindaklanjuti.'] },
      { name: 'Kontrak housekeeping klinik bersalin/lab (bulanan)', w: 35, types: ['klinik'], q: [[4, 40], [6, 40], [10, 20]], unit: 'petugas', price: [6.4e6, 7.6e6], cost: { tenaga: [0.55, 0.59], bahan: [0.16, 0.2] },
        scope: (v) => `Housekeeping klinik/lab ${v.q} petugas, termasuk penanganan tumpahan biologis dan pemisahan limbah sesuai SOP.`,
        done: ['BAST terbit; nihil insiden tumpahan biologis.', 'Laporan bulanan & checklist ruang tindakan diserahkan.'] },
    ] },
    sla: { p: 0.06, pct: [0.01, 0.03], label: 'Potongan SLA' },
    services: [
      { name: 'Work order kebersihan tambahan', w: 40, types: ['rs', 'klinik'], q: [[1, 100]], unit: 'work order', price: [1.5e6, 5e6], dur: [2, 8], cost: { tenaga: [0.42, 0.48], bahan: [0.2, 0.26] },
        issues: ['tumpahan cairan tubuh di koridor', 'tambahan petugas untuk visitasi akreditasi', 'pembersihan gudang farmasi', 'pembersihan ruang jenazah pasca-renovasi'],
        desc: (v) => `Permintaan tambahan: ${v.issue}.`,
        scope: () => 'Pekerjaan kebersihan tambahan di luar kontrak bulanan, mengikuti SOP PPI fasilitas.',
        done: ['Selesai sesuai SOP, checklist ditandatangani kepala ruangan.', 'Selesai < 1 jam setelah panggilan.'] },
      { name: 'Terminal cleaning & disinfeksi ruang isolasi', w: 30, types: ['rs', 'klinik'], q: [[1, 100]], unit: 'paket', price: [3.5e6, 16e6], dur: [3, 12], cost: { tenaga: [0.36, 0.42], bahan: [0.24, 0.3] }, rain: 1.2,
        issues: ['pasien infeksius pulang', 'lonjakan pasien DBD', 'persiapan akreditasi'],
        desc: (v) => `Permintaan terminal cleaning: ${v.issue}.`,
        scope: () => 'Terminal cleaning dan disinfeksi (UV/hidrogen peroksida) ruang isolasi sesuai SOP PPI, berita acara dan swab test.',
        done: ['Swab test pasca-disinfeksi negatif.', 'Selesai, ruang dirilis ke perawat jaga.'] },
      { name: 'Pembersihan pasca renovasi ruang OK/ICU', w: 16, types: ['rs'], q: [[1, 100]], unit: 'area', price: [12e6, 55e6], dur: [16, 72], cost: { tenaga: [0.42, 0.48], bahan: [0.2, 0.26] },
        issues: ['renovasi ruang operasi', 'pembukaan ICU baru', 'perluasan IGD'],
        desc: (v) => `Pembersihan pasca konstruksi: ${v.issue}. Harus lolos uji partikel.`,
        scope: () => 'Pembersihan pasca konstruksi standar ruang steril, termasuk HEPA vacuum dan koordinasi uji partikel.',
        done: ['Uji partikel lolos, ruang siap dioperasikan.', 'Selesai, 1 putaran ulang di koridor steril.'] },
      { name: 'Perawatan lantai vinyl/epoxy', w: 22, types: ['rs', 'klinik'], q: [[300, 40], [800, 40], [2000, 20]], unit: 'm²', price: [14000, 26000], min: 4e6, dur: [8, 48], cost: { tenaga: [0.4, 0.46], bahan: [0.2, 0.26] },
        issues: ['lantai kusam di koridor', 'jadwal stripping & coating tahunan', 'persiapan akreditasi'],
        desc: (v) => `Perawatan lantai ±${v.q} m²: ${v.issue}.`,
        scope: (v) => `Stripping, coating, dan buffing lantai vinyl ±${v.q} m², dikerjakan bertahap per bangsal.`,
        done: ['Selesai bertahap 3 malam tanpa ganggu layanan.'] },
      { name: 'Pest control fasilitas kesehatan', w: 16, types: ['rs', 'klinik'], q: [[1, 100]], unit: 'paket', price: [4e6, 15e6], dur: [4, 12], cost: { tenaga: [0.3, 0.36], bahan: [0.24, 0.3] }, rain: 1.25,
        issues: ['temuan kecoa di instalasi gizi', 'nyamuk di bangsal', 'persyaratan akreditasi'],
        desc: (v) => `Pest control: ${v.issue}.`,
        scope: () => 'Pest control dengan bahan aman fasilitas kesehatan, jadwal di luar jam kunjungan, laporan untuk komite PPI.',
        done: ['Treatment selesai, laporan diserahkan ke komite PPI.'] },
      { name: 'Linen & tirai bed tambahan', w: 16, types: ['rs', 'klinik'], q: [[100, 40], [300, 40], [600, 20]], unit: 'pcs', price: [18000, 30000], min: 3e6, dur: [24, 72], cost: { tenaga: [0.34, 0.4], bahan: [0.18, 0.24] },
        issues: ['penggantian tirai bed semesteran', 'lonjakan pasien', 'persiapan akreditasi'],
        desc: (v) => `Pencucian/penggantian ${v.q} pcs tirai & linen: ${v.issue}.`,
        scope: (v) => `Pencucian dan pemasangan ulang ${v.q} pcs tirai bed/linen dengan proses disinfeksi termal.`,
        done: ['Tirai terpasang kembali, label tanggal cuci ditempel.'] },
    ],
    overheads: [
      { label: 'Gaji & tunjangan staf kantor pusat', cat: 'biaya_tenaga', day: 25, amt: (c) => 75e6 * Math.pow(1.01, c.i) },
      { label: 'Sewa kantor pusat & cabang', cat: 'biaya_lain', day: 3, amt: (c) => 30e6 + 12e6 * c.branches },
      { label: 'Pelatihan PPI, vaksinasi & MCU petugas', cat: 'biaya_lain', day: 15, amt: (c) => c.trend * c.r.uni(0.01, 0.014) },
      { label: 'Asuransi, K3 & sertifikasi', cat: 'biaya_lain', day: 18, amt: (c) => c.trend * c.r.uni(0.008, 0.012) },
      { label: 'IT, absensi & admin', cat: 'biaya_lain', day: 20, amt: (c) => c.trend * c.r.uni(0.006, 0.01) },
      { label: 'Marketing & biaya tender', cat: 'biaya_lain', day: 10, amt: (c) => c.trend * c.r.uni(0.01, 0.016) },
      { label: 'Kendaraan operasional & perjalanan dinas', cat: 'biaya_transport', day: 27, amt: (c) => c.trend * c.r.uni(0.008, 0.012) },
    ],
    thr: { kind: 'accrued' },
  },
]

/* ======================================================= Pelanggan */

function makeCustomerFactory(biz, r) {
  const used = new Set()
  const uniq = (fn) => {
    for (let i = 0; i < 50; i++) {
      const n = fn()
      if (!used.has(n)) { used.add(n); return n }
    }
    const n = `${fn()} ${r.int(2, 99)}`
    used.add(n)
    return n
  }
  const person = () => {
    const f = r.chance(0.5)
    return `${f ? 'Ibu' : 'Bapak'} ${r.pick(f ? F_FIRST : M_FIRST)} ${r.pick(LAST)}`
  }
  const mobile = () => `${r.pick(MOBILE)}-${r.int(1000, 9999)}-${r.int(100, 9999)}`
  const land = (reg) => `(${reg.code}) ${r.int(3, 8)}${r.int(100, 999)}-${r.int(1000, 9999)}`
  const street = (area) => `Jl. ${r.pick(STREETS)} ${r.chance(0.3) ? ['I', 'II', 'III', 'IV', 'Raya'][r.int(0, 4)] + ' ' : ''}No. ${r.int(1, 120)}, ${area}`
  const city = (reg) => reg.areas[0].split(',').pop().trim()
  const gens = {
    individu: (reg) => ({ name: uniq(person), phone: mobile(), loc: street(r.pick(reg.areas)) }),
    kos: (reg) => ({ name: uniq(() => `Kos ${r.pick(['Putri', 'Putra', 'Campur', 'Eksklusif'])} ${r.pick(ADJ)} (${person()})`), phone: mobile(), loc: street(r.pick(reg.areas)) }),
    umkm: (reg) => ({ name: uniq(() => `${r.pick(UMKM_KIND)} ${r.pick(ADJ)}`), phone: mobile(), loc: street(r.pick(reg.areas)) }),
    korporat: (reg) => ({ name: uniq(() => `PT ${r.pick(CO_A)} ${r.pick(CO_B)} ${r.pick(CO_C)}`), phone: r.chance(0.5) ? land(reg) : mobile(), loc: r.pick(reg.areas) }),
    instansi: (reg) => ({ name: uniq(() => r.pick([`SMA ${r.pick(ADJ)} ${city(reg)}`, `Yayasan Pendidikan ${r.pick(ADJ)}`, `Puskesmas ${r.pick(reg.areas).split(',')[0]}`, `Masjid Raya ${r.pick(ADJ)}`, `Kampus Politeknik ${r.pick(ADJ)}`])), phone: land(reg), loc: r.pick(reg.areas) }),
    hotel: (reg) => ({ name: uniq(() => `${r.pick(['Hotel', 'Hotel', 'Guest House', 'Resort', 'Hotel Syariah'])} ${r.pick(['Grand', 'Puri', 'Griya', 'Taman', 'Villa'])} ${r.pick(ADJ)}`), phone: land(reg), loc: r.pick(reg.areas), corp: true }),
    resto: (reg) => ({ name: uniq(() => `${r.pick(['Restoran', 'Rumah Makan', 'Kafe', 'Resto & Kafe', 'Katering'])} ${r.pick(['Saung', 'Dapur', 'Kedai', 'Bale', 'Lembur'])} ${r.pick(ADJ)}`), phone: r.chance(0.5) ? land(reg) : mobile(), loc: street(r.pick(reg.areas)) }),
    salon: (reg) => ({ name: uniq(() => `${r.pick(['Klinik Kecantikan', 'Salon & Spa', 'Barbershop', 'Klinik Gigi'])} ${r.pick(ADJ)}`), phone: mobile(), loc: street(r.pick(reg.areas)) }),
    mall: (reg) => ({ name: uniq(() => `${r.pick(['Mal', 'Plaza', 'Town Square', 'City Mall', 'Lifestyle Center'])} ${r.pick(CO_A)} ${r.pick(['Square', 'Point', 'Walk', 'Central', 'Park', 'Avenue', city(reg)])}`), phone: land(reg), loc: r.pick(reg.areas), corp: true }),
    kantor: (reg) => ({ name: uniq(() => r.pick([
      `PT ${r.pick(CO_A)} ${r.pick(CO_B)} (Persero) — Kantor ${city(reg)}`,
      `Bank ${r.pick(['Nusa', 'Arta', 'Daya', 'Mitra', 'Buana', 'Kencana'])} ${r.pick(['Sejahtera', 'Makmur', 'Utama', 'Persada'])} KC ${r.pick(reg.areas).split(',')[0]}`,
      `Menara ${r.pick(CO_A)} ${r.pick(CO_B)} (perkantoran)`,
      `PT ${r.pick(CO_A)} ${r.pick(CO_B)} ${r.pick(CO_C)} — Kantor Pusat`,
      `Kantor Wilayah PT ${r.pick(CO_A)} ${r.pick(['Energi', 'Logistik', 'Pelabuhan', 'Asuransi', 'Telekomunikasi'])} ${r.pick(CO_B)} (BUMN)`,
    ])), phone: land(reg), loc: r.pick(reg.areas), corp: true }),
    rs: (reg) => ({ name: uniq(() => `${r.pick(['RS', 'RSU', 'RS Ibu & Anak', 'RS Bedah'])} ${r.pick(['Kasih', 'Harapan', 'Medika', 'Husada', 'Sentosa', 'Bunda', 'Permata', 'Mitra Sehat'])} ${r.pick(ADJ)}${r.chance(0.3) ? ` ${city(reg)}` : ''}`), phone: land(reg), loc: r.pick(reg.areas), corp: true }),
    klinik: (reg) => ({ name: uniq(() => r.pick([`Klinik Bersalin ${r.pick(['Bunda', 'Kasih Ibu', 'Permata', 'Sehati'])} ${r.pick(ADJ)}`, `Laboratorium Klinik ${r.pick(CO_A)} ${r.pick(['Medika', 'Diagnostika', 'Prima'])}`, `Klinik Utama ${r.pick(['Medika', 'Husada', 'Sentosa'])} ${r.pick(ADJ)}`])), phone: land(reg), loc: r.pick(reg.areas), corp: true }),
  }
  const pool = new Map() // region key -> customers[]
  let n = 0
  return {
    /** Picks an existing (repeat) or new customer of an allowed type in the region. */
    get(reg, types, repeatP) {
      const list = pool.get(reg.key) || []
      const allowed = list.filter((c) => types.includes(c.type))
      if (allowed.length && r.chance(repeatP)) {
        // preferential attachment: frequent customers come back more often
        let tot = 0
        for (const c of allowed) tot += 1 + c.jobs
        let x = r.next() * tot
        for (const c of allowed) if ((x -= 1 + c.jobs) < 0) return c
        return allowed[allowed.length - 1]
      }
      return this.create(reg, types)
    },
    create(reg, types) {
      const mix = Object.entries(biz.custMix).filter(([t]) => types.includes(t))
      const type = mix.length ? r.wpick(mix) : types[0]
      const c = { id: ++n, type, region: reg.key, jobs: 0, ...gens[type](reg) }
      if (!pool.has(reg.key)) pool.set(reg.key, [])
      pool.get(reg.key).push(c)
      return c
    },
    count: () => n,
    all: () => [...pool.values()].flat(),
  }
}

/* ======================================================= Simulasi */

function intensityFn(biz) {
  const sc = { ...SCALE[biz.scale], ...(biz.intensity || {}) }
  return (dayMs) => {
    const d = new Date(dayMs)
    const m = d.getUTCMonth()
    const md = (m + 1) * 100 + d.getUTCDate()
    let f = biz.moy[m] * sc.dow[d.getUTCDay()]
    if (HOLIDAYS.has(ymd(dayMs))) f *= sc.holiday
    if (md >= 1210 && md <= 1223) f *= sc.peak
    if (md >= 1224 || md <= 101) f *= sc.lull
    let L = LEBARAN[0]
    for (const x of LEBARAN) if (Math.abs(x - dayMs) < Math.abs(L - dayMs)) L = x
    const k = Math.round((dayMs - L) / DAY)
    if (k >= -30 && k <= -21) f *= sc.ramadan
    else if (k >= -20 && k <= -5) f *= sc.pre
    else if (k >= -4 && k <= 5) f *= sc.leb
    else if (k >= 6 && k <= 12) f *= sc.post
    return f
  }
}
const isRainy = (m) => m >= 10 || m <= 2 // Nov..Mar (0-based)

function simulateBusiness(biz, ctx, attempt) {
  const sc = SCALE[biz.scale]
  const r = makeRng(hashStr(`${ctx.seed}:${biz.key}:${attempt}`))
  const intensity = intensityFn(biz)
  const owner = ownerId(biz.k)
  const g = r.uni(sc.gDraw[0], sc.gDraw[1])
  const cShare = biz.contract?.share || 0
  const months = ctx.months // [{i, y, m, startMs, days}]
  const meanRaw = months.filter((x) => x.i >= 0 && x.i < ctx.nMonths).reduce((s, x) => s + x.raw(intensity), 0) / ctx.nMonths
  const custs = makeCustomerFactory(biz, r)
  const asof = ctx.asof
  const priceIdx = (i) => Math.pow(1.0025, i) // ~3%/th inflasi harga jasa
  const jobs = []
  const lost = []
  const contracts = []
  const monthStats = new Map()
  const thrPaid = new Set()

  const regionWeights = (i) => {
    const nat = 0.05
    const alpha = biz.regionAlpha || 0
    return biz.regions.map((rg) => {
      if (i < rg.open) return [rg, 0]
      const ramp = rg.open > -50 ? Math.min(1, (i - rg.open + 1) / 3) : 1
      const tilt = Math.pow((1 + rg.growth) / (1 + nat), (alpha * i) / 12)
      return [rg, rg.w * ramp * tilt]
    })
  }
  const workerFor = (i, rg, price, avg) => {
    const w = biz.workers
    if (w.owner) {
      const active = w.helpers.filter(([, from]) => i >= from).map(([n]) => n)
      const useHelper = r.chance(w.helperP)
      if (!useHelper) return { name: w.owner, helper: false }
      return { name: active.length ? r.pick(active) : w.owner, helper: true }
    }
    if (w.roster) {
      const need = Math.max(w.min, Math.min(w.max, Math.ceil((biz.base * Math.pow(1 + g, Math.max(0, i))) / w.revPerWorker)))
      const lead = w.roster[r.int(0, need - 1)]
      const n = price > avg * 1.6 ? r.int(3, 5) : price > avg * 0.8 ? r.int(2, 3) : 1
      return { name: n > 1 ? w.team.replace('{lead}', lead).replace('{n}', n) : lead, helper: true, need }
    }
    // enterprise: tim per wilayah
    const monthlyRegionRev = (biz.base * Math.pow(1 + g, Math.max(0, i))) * 0.15
    const teams = Math.max(1, Math.round(monthlyRegionRev / w.teamPerRev))
    const t = r.int(1, teams)
    const spvR = makeRng(hashStr(`${biz.key}:${rg.key}:${t}`))
    const spv = `${spvR.pick(M_FIRST.concat(F_FIRST))} ${spvR.pick(LAST)}`
    return { name: `Tim ${rg.key}-${String(t).padStart(2, '0')} · Spv. ${spv}`, helper: true }
  }

  const sampleDay = (mo) => {
    const ws = []
    for (let d = 0; d < mo.days; d++) ws.push([mo.startMs + d * DAY, intensity(mo.startMs + d * DAY)])
    return r.wpick(ws)
  }
  const roundP = (p) => Math.max(10000, Math.round(p / sc.round) * sc.round)
  const qty = (svc) => (Array.isArray(svc.q[0]) ? r.wpick(svc.q) : r.int(svc.q[0], svc.q[1]))
  const vars = (svc, extra) => ({ r, pick: r.pick, issue: svc.issues ? r.pick(svc.issues) : '', ...extra })

  const mkPrice = (svc, q, cust, i) => {
    const corp = ['korporat', 'instansi', 'mall', 'kantor', 'rs', 'klinik'].includes(cust.type)
    const u = corp ? 0.35 + 0.65 * r.next() : r.next()
    let p = q * (svc.price[0] + (svc.price[1] - svc.price[0]) * u)
    if (svc.min) p = Math.max(svc.min, p)
    return roundP(p * priceIdx(i))
  }

  const buildTimeline = (S, kind, durH, rg) => {
    const tz = rg.tz
    let R0
    if (kind === 'contract') {
      R0 = S - r.int(4, 11) * DAY + (r.uni(9, 16) - 7) * HOUR
    } else {
      const lead = r.wpick(sc.leadDays) + r.int(0, 1)
      const dayR = Math.floor((S + tz * HOUR) / DAY) * DAY - lead * DAY
      R0 = localToUtc(dayR, r.uni(7, 21), tz)
      if (R0 > S - HOUR) R0 = S - r.uni(1.5, 4) * HOUR
    }
    const gap = S - R0
    const O = R0 + Math.min(r.uni(sc.quoteH[0], sc.quoteH[1]) * HOUR, gap * r.uni(0.2, 0.55))
    const A = O + Math.max(10 * MIN, (S - O) * r.uni(0.15, 0.85))
    let C = S + durH * HOUR
    if (r.chance(sc.entryLate)) C += r.int(sc.entryLateDays[0], sc.entryLateDays[1]) * DAY + r.uni(0, 6) * HOUR
    else C += r.uni(5, 90) * MIN
    let P
    if (kind === 'contract') P = C + r.uni(0.5, 30) * HOUR
    else {
      const lag = r.wpick(sc.postLag)
      if (lag === 0) P = C + r.uni(20, 300) * MIN
      else {
        const dayP = Math.floor((C + tz * HOUR) / DAY) * DAY + lag * DAY
        P = localToUtc(dayP, r.uni(8, 21.5), tz)
      }
    }
    return { R: R0, O, A, S, C, P }
  }

  let prevContractMonthDone = null
  for (const mo of months) {
    const i = mo.i
    const S_i = mo.raw(intensity) / meanRaw
    const trend = biz.base * Math.pow(1 + g, i)
    const eps = r.lognoise(sc.sigma)
    const target = trend * (cShare + (1 - cShare) * S_i) * eps
    const rw = regionWeights(i)
    const activeRegions = rw.filter(([, w]) => w > 0)
    monthStats.set(i, { S_i, SI: cShare + (1 - cShare) * S_i, trend, target })

    /* --- kontrak berulang --- */
    let contractRev = 0
    if (biz.contract) {
      const cTarget = trend * cShare * eps
      for (const c of contracts) if (c.active && i > c.start && r.chance(biz.contract.churn)) c.active = false
      if (mo.m === 0 && prevContractMonthDone !== null) for (const c of contracts) if (c.active) c.value = roundP(c.value * r.uni(1.03, 1.06)) // eskalasi Januari
      let sum = contracts.filter((c) => c.active).reduce((s, c) => s + c.value, 0)
      let guard = 0
      while (guard++ < 200) {
        const svc = r.wpick(biz.contract.services.map((s) => [s, s.w]))
        const rg = r.wpick(activeRegions)
        const q = qty(svc)
        const cust = custs.create(rg, svc.types || Object.keys(biz.custMix))
        const value = mkPrice(svc, q, cust, i)
        if (sum + value / 2 > cTarget) break
        contracts.push({ svc, rg, q, cust, value, start: i, active: true, no: contracts.length + 1, billDay: r.int(1, 26) })
        sum += value
      }
      for (const c of contracts.filter((x) => x.active)) {
        // Siklus tagihan per kontrak (tanggal ulang tahun kontrak 1-26): BAST & invoice di tanggal itu.
        const C = localToUtc(mo.startMs + (c.billDay - 1) * DAY, r.uni(14, 17), c.rg.tz)
        const S = C - r.uni(2, 5) * HOUR // kunjungan inspeksi/BAST bulanan
        const A = C - r.uni(27, 31) * DAY // awal periode layanan
        const O = A - r.uni(1, 4) * DAY
        const R0 = O - r.uni(1, 5) * DAY
        const tl = { R: R0, O, A, S, C, P: C + r.uni(1, 20) * HOUR }
        c.cust.jobs++
        contractRev += c.value
        jobs.push({ kind: 'contract', i, svc: c.svc, rg: c.rg, cust: c.cust, q: c.q, price: c.value, tl, contract: c, period: `${monthLabel(mo.y, mo.m)} (siklus tgl ${c.billDay})` })
      }
      prevContractMonthDone = i
    }

    /* --- pekerjaan ad-hoc / work order --- */
    const adhocTarget = Math.max(target * 0.12, target - contractRev)
    const svcPairs = biz.services.map((s) => {
      let w = s.w
      if (isRainy(mo.m)) { if (s.tags?.includes('outdoor')) w *= 0.55; w *= s.rain || 1 }
      return [s, w]
    })
    const meanQ = (x) => (Array.isArray(x.q[0]) ? x.q.reduce((a, [v, ww]) => a + v * ww, 0) / x.q.reduce((a, [, ww]) => a + ww, 0) : (x.q[0] + x.q[1]) / 2)
    const avgTicket = biz.services.reduce((s, x) => s + x.w * meanQ(x) * ((x.price[0] + x.price[1]) / 2), 0) / biz.services.reduce((s, x) => s + x.w, 0)
    let sum = 0
    let nAdhoc = 0
    let guard = 0
    while (guard++ < 5000) {
      const svc = r.wpick(svcPairs)
      const rg = r.wpick(activeRegions)
      let cust
      if (svc.fixed === 'outlet') {
        const name = r.pick(biz.outlets)
        cust = custs.all().find((c) => c.name === `Pelanggan walk-in — ${name}`) || (() => {
          const c = custs.create(rg, ['umkm'])
          c.name = `Pelanggan walk-in — ${name}`
          c.type = 'retail_agregat'
          c.phone = null
          c.loc = rg.areas[biz.outlets.indexOf(name) % rg.areas.length]
          return c
        })()
      } else cust = custs.get(rg, svc.types || Object.keys(biz.custMix), sc.repeat)
      const q = qty(svc)
      const price = mkPrice(svc, q, cust, i)
      if (sum + price / 2 > adhocTarget) break
      sum += price
      nAdhoc++
      cust.jobs++
      const durH = r.uni(svc.dur[0], svc.dur[1])
      let tl
      for (let tries = 0; tries < 12; tries++) {
        const S = localToUtc(sampleDay(mo), r.uni(sc.hours[0], sc.hours[1]), rg.tz)
        tl = buildTimeline(S, 'adhoc', durH, rg)
        const pm = wibMonth(tl.P)
        if (pm.y === mo.y && pm.m === mo.m) break // pendapatan diakui di bulan target
      }
      jobs.push({ kind: 'adhoc', i, svc, rg, cust, q, price, tl, avgTicket })
    }

    /* --- prospek yang tidak jadi (funnel) --- */
    const nLost = Math.round(nAdhoc * sc.loss * r.lognoise(0.2))
    for (let k = 0; k < nLost; k++) {
      const svc = r.wpick(svcPairs)
      if (svc.fixed) continue
      const rg = r.wpick(activeRegions)
      const cust = custs.get(rg, svc.types || Object.keys(biz.custMix), sc.repeat * 0.6)
      const q = qty(svc)
      const price = mkPrice(svc, q, cust, i)
      const day = sampleDay(mo)
      const Rt = localToUtc(day, r.uni(7.5, 21), rg.tz)
      const noOffer = r.chance(sc.noOffer)
      const O = Rt + r.uni(sc.quoteH[0], sc.quoteH[1]) * HOUR
      const D = O + r.uni(sc.decisionDays[0], sc.decisionDays[1]) * DAY
      lost.push({ i, svc, rg, cust, q, price, R: Rt, O: noOffer ? null : O, D })
    }
  }

  /* --- biaya overhead bulanan, THR, dan baris SQL --- */
  const rows = { requests: [], offers: [], assignments: [], completions: [], ledger_entries: [], reports: [] }
  const base = biz.k * 1_000_000
  const ids = { requests: 0, offers: 0, assignments: 0, completions: 0, ledger_entries: 0, reports: 0 }
  const nextId = (t) => base + ++ids[t]
  const iso = (ms) => new Date(Math.round(ms / 1000) * 1000 + r.int(0, 999)).toISOString()
  const terms = TERMS[biz.scale]
  const windowStart = ctx.windowStartMs
  const completionsByTime = []

  const sorted = jobs.filter((j) => j.tl.P >= windowStart && j.tl.R <= asof).sort((a, b) => a.tl.R - b.tl.R)
  for (const j of sorted) {
    const { svc, cust, rg, tl } = j
    const v = vars(svc, { q: j.q, customer: cust.name })
    const reqId = nextId('requests')
    const isContract = j.kind === 'contract'
    const description = isContract
      ? `Tagihan kontrak bulanan periode ${j.period} (kontrak no. ${biz.key.toUpperCase()}/${String(j.contract.no).padStart(3, '0')}): ${j.svc.name.toLowerCase()}, ${j.q} ${svc.unit}.`
      : svc.desc(v)
    rows.requests.push({ id: reqId, owner_id: owner, customer_name: cust.name, service_type: svc.name, phone: cust.phone, location: cust.loc, description, status: 'draft', created_at: iso(tl.R) })
    if (tl.O > asof) continue
    const scope = svc.scope(v)
    const aiPrice = roundP(j.price * r.uni(0.9, 1.1))
    const notes = isContract
      ? `Nilai kontrak per bulan, berlaku sejak ${monthLabel(ctx.monthOf(j.contract.start).y, ctx.monthOf(j.contract.start).m)}. Wilayah: ${rg.name}.`
      : `${svc.dur[1] <= 8 ? `Estimasi ${Math.max(1, Math.round((svc.dur[0] + svc.dur[1]) / 2))} jam` : `Estimasi ${Math.max(1, Math.round((svc.dur[0] + svc.dur[1]) / 48))} hari kerja`}. ${r.pick(['Harga sudah termasuk bahan standar.', 'Sparepart di luar lingkup ditagih terpisah dengan persetujuan.', 'Jadwal menyesuaikan pelanggan.', `Wilayah layanan: ${rg.name}.`])}`
    const offerId = nextId('offers')
    rows.offers.push({ id: offerId, owner_id: owner, request_id: reqId, ai_proposal_json: JSON.stringify({ scope, price: aiPrice, terms: r.pick(terms), notes }), validated_price: j.price, validated_scope: scope, status: 'approved', created_at: iso(tl.O) })
    if (tl.A > asof) continue
    const wk = workerFor(j.i, rg, j.price, j.avgTicket || j.price)
    const asgId = nextId('assignments')
    const done = tl.C <= asof
    rows.assignments.push({ id: asgId, owner_id: owner, offer_id: offerId, worker_name: wk.name, scheduled_at: iso(tl.S), status: done ? 'done' : 'assigned', created_at: iso(tl.A) })
    if (!done) continue
    const complId = nextId('completions')
    let note = r.pick(svc.done)
    if (j.kind === 'adhoc' && isRainy(new Date(tl.S).getUTCMonth()) && svc.tags?.includes('outdoor') && r.chance(0.35)) note += ' Sempat tertunda hujan.'
    const cIso = iso(tl.C)
    rows.completions.push({ id: complId, owner_id: owner, assignment_id: asgId, notes: note, photos_path: null, status: 'done', completed_at: cIso, created_at: cIso })
    completionsByTime.push({ id: complId, t: tl.C, rg })
    if (tl.P > asof) continue
    // ---- jurnal per pekerjaan
    const revenue = r.chance(0.06) ? roundP(j.price * r.uni(1.03, 1.12)) : j.price // tambahan sparepart/volume aktual
    const post = (cat, amt, dt = 0) => {
      const a = Math.round(amt / 1000) * 1000
      if (a <= 0) return
      const t = iso(tl.P + dt)
      rows.ledger_entries.push({ id: nextId('ledger_entries'), owner_id: owner, completion_id: complId, amount: a, category: cat, status: 'posted', posted_at: t, created_at: t, _ms: tl.P + dt, _rg: rg.key, _cust: cust.name, _svc: svc.name })
    }
    post('pendapatan', revenue)
    const c = svc.cost
    const labourOk = biz.labourLineP == null || wk.helper
    if (labourOk && (biz.labourLineP == null || r.chance(biz.labourLineP / (biz.workers.helperP || 1)))) post('biaya_tenaga', revenue * r.uni(c.tenaga[0], c.tenaga[1]), 2 * MIN)
    post('biaya_bahan', revenue * r.uni(c.bahan[0], c.bahan[1]), 3 * MIN)
    if (biz.transportAbs) post('biaya_transport', r.uni(biz.transportAbs[0], biz.transportAbs[1]) * (j.q > 4 ? 1.3 : 1), 4 * MIN)
    else if (r.chance(sc.transportLine)) post('biaya_transport', revenue * r.uni(0.015, 0.035) / sc.transportLine, 4 * MIN)
    if (isContract && biz.sla && r.chance(biz.sla.p)) post('biaya_lain', revenue * r.uni(biz.sla.pct[0], biz.sla.pct[1]), 5 * MIN)
  }

  // Overhead bulanan & THR: dilekatkan ke penyelesaian terakhir sebelum tanggal posting (skema mewajibkan completion_id).
  completionsByTime.sort((a, b) => a.t - b.t)
  const attach = (ms) => {
    let lo = 0
    let hi = completionsByTime.length - 1
    let best = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (completionsByTime[mid].t <= ms) { best = completionsByTime[mid]; lo = mid + 1 } else hi = mid - 1
    }
    return best
  }
  const tzHQ = biz.regions.find((x) => x.key === biz.hq)?.tz || biz.regions[0].tz
  for (const mo of months.filter((x) => x.i >= 0 && x.i < ctx.nMonths)) {
    const i = mo.i
    const trend = biz.base * Math.pow(1 + g, i)
    const branches = biz.regions.filter((x) => i >= x.open).length - 1
    const cctx = { r, i, trend, branches }
    const items = biz.overheads.map((o) => ({ ...o, amount: o.amt(cctx) }))
    // THR tunai: H-10 Lebaran di bulan tersebut
    for (const L of LEBARAN) {
      const lm = new Date(L - 10 * DAY)
      if (lm.getUTCFullYear() === mo.y && lm.getUTCMonth() === mo.m && biz.thr.kind !== 'accrued' && !thrPaid.has(L)) {
        thrPaid.add(L)
        const workers = biz.workers.roster ? Math.max(biz.workers.min, Math.min(biz.workers.max, Math.ceil(trend / biz.workers.revPerWorker))) : 1
        items.push({ label: biz.thr.label, cat: 'biaya_tenaga', day: lm.getUTCDate(), amount: biz.thr.kind === 'perWorker' ? workers * biz.thr.amount : biz.thr.amount })
      }
    }
    for (const it of items) {
      const day = Math.min(it.day, mo.days)
      const t = localToUtc(mo.startMs + (day - 1) * DAY, r.uni(9, 16), tzHQ)
      if (t > asof) continue
      const host = attach(t)
      if (!host) continue
      const a = Math.round(it.amount / 1000) * 1000
      const ts = iso(t)
      rows.ledger_entries.push({ id: nextId('ledger_entries'), owner_id: owner, completion_id: host.id, amount: a, category: it.cat, status: 'posted', posted_at: ts, created_at: ts, _ms: t, _overhead: it.label })
    }
  }

  // Prospek yang tidak jadi
  for (const L of lost.filter((x) => x.R >= windowStart && x.R <= asof).sort((a, b) => a.R - b.R)) {
    const v = vars(L.svc, { q: L.q, customer: L.cust.name })
    const reqId = nextId('requests')
    rows.requests.push({ id: reqId, owner_id: owner, customer_name: L.cust.name, service_type: L.svc.name, phone: L.cust.phone, location: L.cust.loc, description: L.svc.desc(v), status: 'draft', created_at: iso(L.R) })
    if (!L.O || L.O > asof) continue
    const scope = L.svc.scope(v)
    const status = L.D <= asof ? 'rejected' : r.chance(0.6) ? 'pending_approval' : 'draft'
    const aiPrice = roundP(L.price * r.uni(0.92, 1.08))
    rows.offers.push({ id: nextId('offers'), owner_id: owner, request_id: reqId, ai_proposal_json: JSON.stringify({ scope, price: aiPrice, terms: r.pick(terms), notes: status === 'rejected' ? r.pick(['Pelanggan membandingkan dengan vendor lain.', 'Menunggu persetujuan anggaran pelanggan.', 'Jadwal pelanggan belum pasti.']) : 'Menunggu konfirmasi pelanggan.' }), validated_price: L.price, validated_scope: scope, status, created_at: iso(L.O) })
  }

  return { biz, g, rows, monthStats, attempt, custCount: custs.count(), contracts: contracts.length, activeContracts: contracts.filter((c) => c.active).length, regionsOf: rows }
}

/* =================================================== Statistik & cek */

function analyse(sim, ctx) {
  const { biz, rows, monthStats } = sim
  const per = new Map()
  for (const l of rows.ledger_entries) {
    const { y, m } = wibMonth(l._ms)
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    if (!per.has(key)) per.set(key, { rev: 0, cost: 0, jobs: 0, byReg: {} })
    const p = per.get(key)
    if (l.category === 'pendapatan') {
      p.rev += l.amount
      p.jobs++
      p.byReg[l._rg] = (p.byReg[l._rg] || 0) + l.amount
    } else p.cost += l.amount
  }
  const out = []
  for (const mo of ctx.months.filter((x) => x.i >= 0 && x.i < ctx.nMonths)) {
    const key = `${mo.y}-${String(mo.m + 1).padStart(2, '0')}`
    const p = per.get(key) || { rev: 0, cost: 0, jobs: 0, byReg: {} }
    const full = mo.endMs <= ctx.asof
    const frac = full ? 1 : Math.max(0.01, (ctx.asof - mo.startMs) / (mo.endMs - mo.startMs))
    out.push({ key, label: monthLabel(mo.y, mo.m), i: mo.i, full, frac, ...p, SI: monthStats.get(mo.i).SI })
  }
  const full = out.filter((x) => x.full)
  for (let k = 0; k < out.length; k++) {
    const prev = out[k - 1]
    const cur = out[k]
    const rr = (x) => x.rev / x.frac
    cur.mom = prev && cur.full ? rr(cur) / rr(prev) - 1 : null
    cur.momDes = prev && cur.full ? (rr(cur) / cur.SI) / (rr(prev) / prev.SI) - 1 : null
  }
  // regresi log-linear pendapatan desesonal (bulan penuh)
  const xs = full.map((x) => x.i)
  const ys = full.map((x) => Math.log(x.rev / x.SI))
  const xm = xs.reduce((a, b) => a + b, 0) / xs.length
  const ym = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0
  let den = 0
  for (let k = 0; k < xs.length; k++) { num += (xs[k] - xm) * (ys[k] - ym); den += (xs[k] - xm) ** 2 }
  const trendG = Math.exp(num / den) - 1
  const first = full[0]
  const last = full[full.length - 1]
  const cmgr = Math.pow(last.rev / first.rev, 1 / (last.i - first.i)) - 1
  const cmgrDes = Math.pow((last.rev / last.SI) / (first.rev / first.SI), 1 / (last.i - first.i)) - 1
  const totRev = full.reduce((s, x) => s + x.rev, 0)
  const totCost = full.reduce((s, x) => s + x.cost, 0)
  const margin = (totRev - totCost) / totRev
  const band = SCALE[biz.scale].band
  const ok = trendG >= band[0] && trendG <= band[1] && margin >= biz.margin[0] && margin <= biz.margin[1]
  // pangsa wilayah (pendapatan) bulan penuh pertama vs terakhir
  const share = (x) => Object.fromEntries(Object.entries(x.byReg).map(([k2, v]) => [k2, v / x.rev]))
  return { months: out, trendG, cmgr, cmgrDes, cagrEq: Math.pow(1 + trendG, 12) - 1, margin, ok, band, totRev, totCost, regFirst: share(first), regLast: share(last) }
}

/* ============================================================ Laporan */

function buildReports(sim, ctx) {
  const { biz, rows } = sim
  const owner = ownerId(biz.k)
  const byMonth = new Map()
  for (const l of rows.ledger_entries) {
    const { y, m } = wibMonth(l._ms)
    const key = `${y}-${m}`
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(l)
  }
  const reqByLedger = new Map()
  const reqOf = new Map(rows.requests.map((q) => [q.id, q]))
  const offerOf = new Map(rows.offers.map((o) => [o.id, o]))
  const asgOf = new Map(rows.assignments.map((a) => [a.id, a]))
  const complOf = new Map(rows.completions.map((c) => [c.id, c]))
  const custOfCompl = (cid) => {
    if (reqByLedger.has(cid)) return reqByLedger.get(cid)
    const c = complOf.get(cid)
    const q = reqOf.get(offerOf.get(asgOf.get(c.assignment_id).offer_id).request_id)
    reqByLedger.set(cid, q)
    return q
  }
  const LABEL = { pendapatan: 'Pendapatan', biaya_tenaga: 'Biaya tenaga kerja', biaya_bahan: 'Biaya bahan / material', biaya_transport: 'Biaya transportasi', biaya_lain: 'Biaya lain-lain' }
  const r = makeRng(hashStr(`${ctx.seed}:${biz.key}:reports`))
  const sumOf = (list) => {
    let rev = 0
    let cost = 0
    for (const l of list) l.category === 'pendapatan' ? (rev += l.amount) : (cost += l.amount)
    return { rev, cost, profit: rev - cost }
  }
  let prev = null
  for (const mo of ctx.months.filter((x) => x.i >= 0 && x.i < ctx.nMonths)) {
    const list = (byMonth.get(`${mo.y}-${mo.m}`) || []).slice().sort((a, b) => a._ms - b._ms)
    const t = sumOf(list)
    const label = monthLabel(mo.y, mo.m)
    const createdMs = mo.endMs + r.int(1, 4) * DAY + r.uni(2, 5) * HOUR
    if (mo.endMs <= ctx.asof && createdMs <= ctx.asof && list.length) {
      const cats = new Map()
      for (const l of list) {
        const c = cats.get(l.category) || { amount: 0, n: 0 }
        c.amount += l.amount
        c.n++
        cats.set(l.category, c)
      }
      const by_category = [...cats.entries()].map(([category, v]) => ({ category, label: LABEL[category], amount: v.amount, entries: v.n }))
        .sort((a, b) => (a.category === 'pendapatan' ? -1 : b.category === 'pendapatan' ? 1 : b.amount - a.amount))
      const custs = new Map()
      for (const l of list.filter((x) => x.category === 'pendapatan')) {
        const q = custOfCompl(l.completion_id)
        const c = custs.get(q.customer_name) || { name: q.customer_name, service: q.service_type, revenue: 0 }
        c.revenue += l.amount
        custs.set(q.customer_name, c)
      }
      const top = [...custs.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5)
      const MAXE = 300
      const entries = list.slice(-MAXE).map((l) => ({ id: l.id, category: l.category, amount: l.amount, posted_at: l.posted_at }))
      const margin = t.rev > 0 ? Number(((t.profit / t.rev) * 100).toFixed(1)) : null
      const summary = {
        period: label,
        period_start: ymd(mo.startMs),
        period_end: ymd(mo.endMs - DAY),
        total_revenue: t.rev,
        total_cost: t.cost,
        net_profit: t.profit,
        margin_pct: margin,
        previous_period: prev ? { label: prev.label, total_revenue: prev.rev, total_cost: prev.cost, net_profit: prev.profit } : null,
        by_category,
        top_customers: top,
        entries,
        ...(list.length > MAXE ? { entries_total: list.length, entries_truncated: true } : {}),
      }
      rows.reports.push({ id: biz.k * 1_000_000 + rows.reports.length + 1, owner_id: owner, period_start: summary.period_start, period_end: summary.period_end, summary_json: JSON.stringify(summary), explanation_html: explainHTML(summary, biz), status: 'final', created_at: new Date(createdMs).toISOString() })
    }
    prev = { label, ...t }
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pctFmt = (n) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
function explainHTML(s, biz) {
  const out = [`<h3>Ringkasan ${esc(s.period)}</h3>`]
  out.push(`<p>Pendapatan <strong>${fmtRp(s.total_revenue)}</strong>, biaya <strong>${fmtRp(s.total_cost)}</strong>, ${s.net_profit >= 0 ? 'laba' : 'rugi'} bersih <strong>${fmtRp(Math.abs(s.net_profit))}</strong> (margin ${pctFmt(s.margin_pct ?? 0)}).</p>`)
  if (s.previous_period && s.previous_period.total_revenue > 0) {
    const g = ((s.total_revenue - s.previous_period.total_revenue) / s.previous_period.total_revenue) * 100
    out.push(`<p>Dibanding ${esc(s.previous_period.label)}, pendapatan ${g >= 0 ? 'naik' : 'turun'} <strong>${pctFmt(Math.abs(g))}</strong>.</p>`)
  }
  const cost = s.by_category.filter((c) => c.category !== 'pendapatan')
  const recs = []
  if (cost[0]) recs.push(`Komponen biaya terbesar adalah ${esc(cost[0].label.toLowerCase())} (${pctFmt((cost[0].amount / Math.max(1, s.total_revenue)) * 100)} dari pendapatan); pantau produktivitas per petugas.`)
  if (s.top_customers[0]) recs.push(`Pelanggan terbesar: ${esc(s.top_customers[0].name)} (${pctFmt((s.top_customers[0].revenue / Math.max(1, s.total_revenue)) * 100)} dari pendapatan).`)
  if (s.margin_pct != null && s.margin_pct < biz.margin[0] * 100) recs.push('Margin di bawah target usaha; periksa harga penawaran dan biaya bahan.')
  out.push(`<h3>Catatan</h3><ul>${recs.map((x) => `<li>${x}</li>`).join('')}</ul>`)
  out.push('<p><small>Contoh penjelasan untuk DATA DEMO (dibuat skrip seed, bukan model AI).</small></p>')
  return out.join('\n')
}

/* ================================================================ SQL */

const ownerId = (k) => `0d3e5a11-7c1a-4b5e-9a0${k}-5a7a1a1d000${k}`
const sqlVal = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v))
  return `'${String(v).replace(/'/g, "''")}'`
}
const COLS = {
  requests: ['id', 'owner_id', 'customer_name', 'service_type', 'phone', 'location', 'description', 'status', 'created_at'],
  offers: ['id', 'owner_id', 'request_id', 'ai_proposal_json', 'validated_price', 'validated_scope', 'status', 'created_at'],
  assignments: ['id', 'owner_id', 'offer_id', 'worker_name', 'scheduled_at', 'status', 'created_at'],
  completions: ['id', 'owner_id', 'assignment_id', 'notes', 'photos_path', 'status', 'completed_at', 'created_at'],
  ledger_entries: ['id', 'owner_id', 'completion_id', 'amount', 'category', 'status', 'posted_at', 'created_at'],
  reports: ['id', 'owner_id', 'period_start', 'period_end', 'summary_json', 'explanation_html', 'status', 'created_at'],
}
const DELETE_ORDER = ['ledger_entries', 'completions', 'assignments', 'offers', 'requests', 'reports', 'social_schedules', 'social_contents', 'ai_messages']
const MAX_ROWS = 100
const MAX_STMT_BYTES = 90_000 // D1: maks 100 KB per statement

function emitInserts(out, table, rows) {
  const cols = COLS[table]
  const head = `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n`
  let batch = []
  let bytes = Buffer.byteLength(head)
  let stmts = 0
  const flush = () => {
    if (!batch.length) return
    out.push(`${head}${batch.join(',\n')};`)
    stmts++
    batch = []
    bytes = Buffer.byteLength(head)
  }
  for (const r of rows) {
    const t = `(${cols.map((c) => sqlVal(r[c])).join(', ')})`
    const b = Buffer.byteLength(t) + 2
    if (batch.length && (batch.length >= MAX_ROWS || bytes + b > MAX_STMT_BYTES)) flush()
    batch.push(t)
    bytes += b
  }
  flush()
  return stmts
}

/* =============================================================== main */

function buildContext(args) {
  const [ey, em] = args.end.split('-').map(Number)
  const endMonthIdx = ey * 12 + (em - 1)
  const nMonths = args.months
  const months = []
  for (let i = -1; i <= nMonths; i++) {
    const mi = endMonthIdx - (nMonths - 1) + i
    const y = Math.floor(mi / 12)
    const m = mi % 12
    const startMs = Date.UTC(y, m, 1)
    const endMs = Date.UTC(y, m + 1, 1)
    const days = Math.round((endMs - startMs) / DAY)
    let cache = null
    months.push({ i, y, m, startMs, endMs: endMs - 7 * HOUR, days, raw(fn) { if (cache == null) { cache = 0; for (let d = 0; d < days; d++) cache += fn(startMs + d * DAY) } return cache } })
  }
  // raw() caches per business call: reset cache per business
  const windowStartMs = months[1].startMs - 7 * HOUR
  const endOfWindow = months[nMonths + 1].startMs - 7 * HOUR // awal bulan lookahead (WIB)
  let asof
  if (args.asof === 'now') asof = Date.now()
  else if (args.asof) {
    asof = Date.parse(/T/.test(args.asof) ? args.asof : `${args.asof}T17:00:00+07:00`)
    if (Number.isNaN(asof)) throw new Error('--asof tidak valid')
  } else asof = Date.parse('2026-10-28T17:00:00+07:00')
  if (asof > endOfWindow) asof = endOfWindow - 7 * HOUR
  if (asof < windowStartMs + 60 * DAY) throw new Error('--asof terlalu awal untuk jendela data')
  // WIB month boundaries for full-month checks
  for (const mo of months) mo.startMs = Date.UTC(mo.y, mo.m, 1)
  return {
    seed: args.seed, nMonths, months, windowStartMs, asof,
    monthOf: (i) => months.find((x) => x.i === i) || months[0],
  }
}

function freshMonths(ctx) {
  // raw() keeps a per-month cache; give each business its own copy.
  return ctx.months.map((mo) => {
    let cache = null
    return { ...mo, raw(fn) { if (cache == null) { cache = 0; for (let d = 0; d < mo.days; d++) cache += fn(mo.startMs + d * DAY) } return cache } }
  })
}

function fmtJt(n) {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`
  return `${(n / 1e6).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} jt`
}
const pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`)
const pad = (s, n, left = false) => (left ? String(s).padStart(n) : String(s).padEnd(n))

function main() {
  const args = parseArgs(process.argv.slice(2))
  const ctx = buildContext(args)
  const list = args.only ? BUSINESSES.filter((b) => args.only.includes(b.key)) : BUSINESSES
  if (!list.length) throw new Error('--only tidak cocok dengan usaha mana pun')
  const results = []
  for (const biz of list) {
    let sim
    let an
    for (let attempt = 0; attempt < 40; attempt++) {
      const c2 = { ...ctx, months: freshMonths(ctx) }
      sim = simulateBusiness(biz, c2, attempt)
      an = analyse(sim, c2)
      if (an.ok) break
    }
    buildReports(sim, ctx)
    results.push({ sim, an })
  }

  /* ---- SQL */
  const out = []
  const allIds = list.map((b) => `'${ownerId(b.k)}'`).join(', ')
  const allEmails = list.map((b) => `'${b.email}'`).join(', ')
  out.push('-- =====================================================================')
  out.push('-- Satu Alur: DATA DEMO (DUMMY). Semua pelanggan, telepon, alamat, dan angka FIKTIF.')
  out.push(`-- Dibuat oleh scripts/seed-demo.mjs --months ${args.months} --end ${args.end} --asof ${new Date(ctx.asof).toISOString()} --seed ${args.seed}`)
  out.push('-- Aman dijalankan ulang: menghapus dulu seluruh data milik akun demo lalu mengisi ulang.')
  out.push('-- Lihat seeds/README.md dan docs/specs/2026-10-28-demo-growth-data-design.md.')
  out.push('-- =====================================================================')
  out.push('')
  out.push('-- 1) Bersihkan data domain milik akun demo (anak dulu), termasuk akun demo lama dengan UUID berbeda.')
  for (const t of DELETE_ORDER) out.push(`DELETE FROM ${t} WHERE owner_id IN (${allIds}) OR owner_id IN (SELECT id FROM users WHERE email IN (${allEmails}));`)
  out.push('')
  out.push('-- 2) Akun demo dengan UUID tetap (login lewat OTP mode demo).')
  out.push(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${allEmails}) AND id NOT IN (${allIds}));`)
  out.push(`DELETE FROM users WHERE email IN (${allEmails}) AND id NOT IN (${allIds});`)
  out.push(`INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES\n${list.map((b) => `(${sqlVal(ownerId(b.k))}, ${sqlVal(b.email)}, ${sqlVal(b.name)}, '2025-10-01T02:00:00.000Z')`).join(',\n')};`)
  for (const b of list) out.push(`UPDATE users SET name = ${sqlVal(b.name)} WHERE id = ${sqlVal(ownerId(b.k))};`)
  out.push('')
  const counts = {}
  let stmts = 0
  for (const t of ['requests', 'offers', 'assignments', 'completions', 'ledger_entries', 'reports']) {
    const rows = results.flatMap((x) => x.sim.rows[t]).sort((a, b) => a.id - b.id)
    counts[t] = rows.length
    out.push(`-- ${t}: ${rows.length} baris`)
    stmts += emitInserts(out, t, rows)
    out.push('')
  }
  const sql = `${out.join('\n')}\n`
  const outPath = resolve(args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, sql)

  /* ---- ringkasan */
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
  const log = (...a) => { if (!args.quiet) console.log(...a) }
  log(`\nSatu Alur demo seed — as-of ${new Date(ctx.asof).toISOString()} (WIB ${new Date(ctx.asof + 7 * HOUR).toISOString().slice(0, 16).replace('T', ' ')})`)
  const summary = { generated_with: { months: args.months, end: args.end, asof: new Date(ctx.asof).toISOString(), seed: args.seed }, businesses: [], counts, total_rows: totalRows, sql_bytes: Buffer.byteLength(sql), statements: stmts }
  for (const { sim, an } of results) {
    const b = sim.biz
    log(`\n[${b.k}] ${b.name} — ${b.industry} (${b.scale}) · ${b.email}`)
    log(`    g model ${(sim.g * 100).toFixed(2)}%/bln · attempt ${sim.attempt} · pelanggan ${sim.custCount}${sim.contracts ? ` · kontrak ${sim.activeContracts} aktif/${sim.contracts} total` : ''}`)
    log(`    ${pad('Bulan', 15)}${pad('Pendapatan', 12, true)}${pad('Biaya', 12, true)}${pad('Laba', 12, true)}${pad('Margin', 8, true)}${pad('MoM', 9, true)}${pad('MoM-des', 9, true)}${pad('Job', 6, true)}`)
    for (const m of an.months) {
      const mg = m.rev ? (m.rev - m.cost) / m.rev : 0
      log(`    ${pad(m.label + (m.full ? '' : '*'), 15)}${pad(fmtJt(m.rev), 12, true)}${pad(fmtJt(m.cost), 12, true)}${pad(fmtJt(m.rev - m.cost), 12, true)}${pad((mg * 100).toFixed(1) + '%', 8, true)}${pad(pct(m.mom), 9, true)}${pad(pct(m.momDes), 9, true)}${pad(m.jobs, 6, true)}`)
    }
    log(`    Tren desesonal ${pct(an.trendG)}/bln (band ${(an.band[0] * 100).toFixed(0)}–${(an.band[1] * 100).toFixed(0)}%) · CMGR mentah ${pct(an.cmgr)} · CMGR desesonal ${pct(an.cmgrDes)} · setara tahunan ${pct(an.cagrEq)} · margin ${(an.margin * 100).toFixed(1)}% (target ${(b.margin[0] * 100).toFixed(0)}–${(b.margin[1] * 100).toFixed(0)}%) → ${an.ok ? 'OK' : 'DI LUAR BAND'}`)
    if (b.regions.length > 1) {
      const fmtS = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')
      log(`    Pangsa wilayah: ${an.months.find((x) => x.full).label}: ${fmtS(an.regFirst)}`)
      log(`                    ${an.months.filter((x) => x.full).pop().label}: ${fmtS(an.regLast)}`)
    }
    summary.businesses.push({
      k: b.k, key: b.key, name: b.name, scale: b.scale, email: b.email, owner_id: ownerId(b.k), industry: b.industry,
      regions: b.regions.map((x) => ({ key: x.key, name: x.name, profile: x.profile, growth: x.growth, open_month_index: x.open < -50 ? null : x.open })),
      g_model: Number(sim.g.toFixed(4)), trend_g: Number(an.trendG.toFixed(4)), cmgr: Number(an.cmgr.toFixed(4)), cmgr_deseasonalised: Number(an.cmgrDes.toFixed(4)), cagr_equivalent: Number(an.cagrEq.toFixed(4)), margin: Number(an.margin.toFixed(4)), in_band: an.ok,
      customers: sim.custCount, contracts_total: sim.contracts, contracts_active: sim.activeContracts,
      rows: Object.fromEntries(Object.entries(sim.rows).map(([t, v]) => [t, v.length])),
      months: an.months.map((m) => ({ month: m.key, full: m.full, revenue: m.rev, cost: m.cost, profit: m.rev - m.cost, jobs: m.jobs, mom: m.mom == null ? null : Number(m.mom.toFixed(4)), mom_deseasonalised: m.momDes == null ? null : Number(m.momDes.toFixed(4)), seasonal_index: Number(m.SI.toFixed(3)) })),
      region_share_first: an.regFirst, region_share_last: an.regLast,
    })
  }
  log(`\nBaris: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')} · total ${totalRows}`)
  log(`SQL: ${outPath} · ${(Buffer.byteLength(sql) / 1e6).toFixed(2)} MB · ${stmts} INSERT (≤${MAX_ROWS} baris, ≤${MAX_STMT_BYTES / 1000} KB per statement)`)
  log('* = bulan berjalan (terpotong di as-of): tidak dihitung MoM dan tidak ikut regresi tren.')
  if (args.summary && args.summary !== 'none') {
    const sp = resolve(args.summary)
    mkdirSync(dirname(sp), { recursive: true })
    writeFileSync(sp, `${JSON.stringify(summary, null, 2)}\n`)
    log(`Ringkasan JSON: ${sp}`)
  }
  if (results.some((x) => !x.an.ok)) {
    console.error('PERINGATAN: ada usaha di luar band pertumbuhan/margin.')
    process.exitCode = 2
  }
}

main()

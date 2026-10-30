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
 *        [--out seeds/demo.sql] [--summary seeds/demo-summary.json] [--only demo-ac,demo-rs] [--quiet]
 *        [--lean] [--split N] [--existing-counts seeds/existing.json] [--budget 90000] [--per-file 45000]
 *        [--report md] [--report-out docs/specs/generated/demo-economic-summary.md] [--from-summary seeds/demo-summary.json]
 *
 * --lean    : hemat tulis D1 (≤ ±18 rb baris): biaya per job digabung jadi 1 baris, overhead 1 baris/bulan,
 *             rekap kiloan mingguan, work order enterprise direkap bulanan, kontrak lebih besar.
 * --split N : bagi usaha (utuh) ke N file SQL (target ≤ --per-file writes per file) untuk diterapkan per hari.
 * Setiap run mencetak estimasi D1 "rows written" (insert + hapus data lama) dan memperingatkan bila > --budget.
 * --report md : tulis ringkasan ekonomi Markdown dari objek ringkasan JSON yang sama (satu sumber kebenaran).
 *               Dengan --from-summary FILE, MD dibuat dari JSON yang sudah ada tanpa simulasi ulang.
 *
 * Lapisan makro (riil vs nominal, inflasi, UMK, pajak) ada di blok MACRO: semua nilainya ASUMSI PERENCANAAN.
 *
 * Asumsi, rumus, dan kalender musiman: docs/specs/2026-10-28-demo-growth-data-design.md
 * Tanpa dependency (Node >= 18, ESM).
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOUR = 3600000
const DAY = 24 * HOUR
const MIN = 60000

/* ================================================================== CLI */

function parseArgs(argv) {
  const a = { months: 12, end: '2026-10-31', asof: null, seed: 20261028, out: 'seeds/demo.sql', summary: 'seeds/demo-summary.json', only: null, quiet: false, lean: false, split: 1, existing: null, budget: 90000, perFile: 45000, report: null, reportOut: 'docs/specs/generated/demo-economic-summary.md', fromSummary: null }
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
    else if (k === '--only') a.only = v().split(',').map((s) => s.trim().toLowerCase().replace(/@.*$/, '').replace(/^demo-/, '')).filter(Boolean)
    else if (k === '--lean') a.lean = true
    else if (k === '--split') a.split = Number(v())
    else if (k === '--existing-counts') a.existing = v()
    else if (k === '--budget') a.budget = Number(v())
    else if (k === '--per-file') a.perFile = Number(v())
    else if (k === '--quiet') a.quiet = true
    else if (k === '--report') a.report = v()
    else if (k === '--report-out') a.reportOut = v()
    else if (k === '--from-summary') a.fromSummary = v()
    else if (k === '-h' || k === '--help') {
      console.log('Pemakaian: node scripts/seed-demo.mjs [--lean] [--months 12] [--end YYYY-MM-DD] [--asof ISO|now] [--seed N] [--out file.sql] [--summary file.json|none]\n  [--only demo-ac,demo-rs] [--split N] [--existing-counts seeds/existing.json] [--budget 90000] [--per-file 45000] [--quiet]\n  [--report md] [--report-out file.md] [--from-summary seeds/demo-summary.json]')
      process.exit(0)
    } else throw new Error(`Argumen tidak dikenal: ${k}`)
  }
  if (!Number.isInteger(a.months) || a.months < 3 || a.months > 36) throw new Error('--months harus 3..36')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.end)) throw new Error('--end harus YYYY-MM-DD')
  if (!Number.isFinite(a.seed)) throw new Error('--seed harus angka')
  if (!Number.isInteger(a.split) || a.split < 1 || a.split > 9) throw new Error('--split harus 1..9')
  if (a.report != null && a.report !== 'md') throw new Error('--report hanya mendukung "md"')
  if (a.fromSummary && a.report !== 'md') throw new Error('--from-summary dipakai bersama --report md')
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
    round: 5000, transportLine: 0.95, sigma: 0.04, gDraw: [0.012, 0.018], band: [0.01, 0.02], decisionDays: [1, 6], labour: 'perJob', cvBand: [0.05, 0.2],
  },
  ukm: {
    dow: [0.35, 1.05, 1.05, 1.05, 1.05, 1.0, 0.85], holiday: 0.2, peak: 1.25, lull: 0.5, ramadan: 1.0, pre: 1.35, leb: 0.1, post: 0.7,
    leadDays: [[1, 15], [2, 25], [3, 25], [5, 20], [8, 15]], quoteH: [18, 72], entryLate: 0.08, entryLateDays: [1, 4],
    postLag: [[0, 30], [1, 30], [2, 20], [3, 10], [5, 7], [9, 3]], hours: [7.5, 16.5], loss: 0.16, noOffer: 0.1, repeat: 0.45,
    round: 50000, transportLine: 0.85, sigma: 0.035, gDraw: [0.012, 0.018], band: [0.01, 0.02], decisionDays: [2, 10], labour: 'payroll', cvBand: [0.05, 0.2],
  },
  enterprise: {
    dow: [0.15, 1.1, 1.1, 1.1, 1.1, 1.05, 0.5], holiday: 0.1, peak: 1.2, lull: 0.45, ramadan: 1.0, pre: 1.12, leb: 0.1, post: 0.8,
    leadDays: [[4, 20], [7, 30], [10, 25], [14, 15], [21, 10]], quoteH: [36, 150], entryLate: 0.1, entryLateDays: [1, 5],
    postLag: [[1, 20], [2, 25], [3, 20], [5, 20], [8, 15]], hours: [7, 17], loss: 0.22, noOffer: 0.08, repeat: 0.7,
    round: 100000, transportLine: 0.6, sigma: 0.025, gDraw: [0.06, 0.09], band: [0.05, 0.1], decisionDays: [5, 21], labour: 'payroll', cvBand: null,
  },
}

/* ======================================================= Lapisan makro */
// SEMUA angka di blok ini adalah ASUMSI PERENCANAAN untuk data demo, BUKAN angka resmi.
// Sumber yang harus dicek sebelum dipakai di luar demo:
//   - PDB riil nasional & PDRB riil provinsi: Berita Resmi Statistik (BRS) BPS, bps.go.id (rilis triwulanan).
//   - Inflasi IHK nasional & provinsi: BRS Inflasi BPS (rilis bulanan).
//   - UMK/UMP: SK Gubernur masing-masing provinsi (diumumkan menjelang 1 Januari).
//   - Pajak: PP 55/2022 (PPh Final UMKM) dan UU 7/2021 (HPP) jo. Pasal 31E UU PPh; cek ke konsultan pajak.
// Pertumbuhan PDB/PDRB adalah angka RIIL; pendapatan di buku besar NOMINAL:
//   nominal ≈ (1 + riil) × (1 + inflasi) − 1
const MACRO = {
  year0: 2025, // tahun acuan nilai UMK di REG (jendela data mulai Nov 2025)
  realGdp: 0.05, // pertumbuhan PDB riil nasional ±5,0%/th (asumsi; cek BRS PDB BPS)
  cpi: 0.028, // inflasi IHK ±2,5–3,0%/th, dipakai 2,8% (asumsi; sasaran inflasi 2,5±1%; cek BRS Inflasi BPS)
  // Kenaikan tarif jasa: ditetapkan tiap Januari (rentang per skala), plus penyesuaian pertengahan tahun sesekali.
  servicePriceJan: { sole: [0.03, 0.05], ukm: [0.03, 0.05], enterprise: [0.04, 0.06] }, // asumsi: IHK + 0,5–2 poin
  servicePriceMid: { p: 0.35, month: 6, pct: [0.01, 0.02] }, // Juli, ±35% usaha menyesuaikan tarif lagi (asumsi)
  contractEsc: [0.03, 0.05], // eskalasi Januari kontrak non-UMK (pest, laundry, cleaning, FM cabang) (asumsi)
  umkStep: 0.065, // kenaikan UMK tiap 1 Januari ±6,5% (asumsi; cek SK Gubernur)
  allIn: 1.25, // biaya tenaga all-in ≈ 1,25 × UMK, rincian di allInParts (asumsi)
  allInParts: { bpjs: 0.115, thr: 1 / 12, other: 0.052 }, // BPJS TK+Kes porsi pemberi kerja ±10–11,5%; THR 1 bln/th; seragam, APD, uang makan ±5%
  materials: 0.04, // inflasi bahan/material/chemical ±4%/th, naik bertahap per bulan (asumsi)
  fuel: 0.03, // BBM & biaya transport ±3%/th, bertahap (asumsi)
  rentStep: 0.05, // sewa naik ±5% saat perpanjangan tiap Januari (asumsi)
  softwareStep: 0.03, // langganan aplikasi/internet: ikut IHK (asumsi)
  overtime: 1.3, // kelebihan beban di atas kapasitas: campuran lembur (1,5–2× upah per jam) dan tenaga harian (±1× tanpa tunjangan) ≈ 1,3× (asumsi)
  tax: {
    // PPh Final UMKM 0,5% dari peredaran bruto (PP 55/2022, perubahan PP 23/2018). Asumsi yang wajib diverifikasi:
    pphFinal: 0.005,
    turnoverCap: 4.8e9, // berlaku bila peredaran bruto ≤ Rp4,8 M setahun
    individualExempt: 500e6, // WP orang pribadi: Rp500 jt pertama peredaran bruto setahun tidak dikenai PPh Final
    timeLimit: 'WP OP 7 tahun pajak, CV/firma/koperasi 4 tahun, PT 3 tahun sejak terdaftar (diasumsikan masih dalam batas)',
    corporate: 0.22, // enterprise (PT): PPh Badan 22% atas laba fiskal (UU HPP); hanya perkiraan di ringkasan & dokumen
    corp31eGross: 50e9, // fasilitas Pasal 31E: peredaran ≤ Rp50 M → diskon 50% tarif atas porsi PKP dari Rp4,8 M peredaran
    corp31eSlice: 4.8e9,
  },
}
// Profil wilayah (PDRB riil, asumsi). 4–6%/th wajar untuk sebagian besar wilayah; 8–10% hanya untuk wilayah "boom"
// (hilirisasi nikel Sulawesi/Maluku Utara, Kalimantan Timur/IKN). Angka aktual provinsi tambang bisa jauh berbeda: cek BRS PDRB.
const PROFILES = {
  nasional: { label: 'Nasional (metro Jawa–Sumatra)', real: [0.045, 0.055] },
  menengah: { label: 'Menengah (pariwisata, industri)', real: [0.055, 0.06] },
  cepat: { label: 'Boom (nikel, IKN)', real: [0.08, 0.1] },
}
const nominalOf = (real, cpi = MACRO.cpi) => (1 + real) * (1 + cpi) - 1
// umk: UMK/UMP tahun acuan (MACRO.year0) dalam rupiah, DIBULATKAN dan PERKIRAAN (verifikasi ke SK Gubernur).
const R = (key, name, profile, real, tz, code, umk, areas, extra = {}) => ({ key, name, profile, real, cpi: MACRO.cpi, nominal: nominalOf(real), umk, tz, code, areas, w: 1, open: -99, ...extra })
const REG = {
  JKT: R('JKT', 'DKI Jakarta', 'nasional', 0.05, 7, '021', 5.4e6, ['Kuningan, Jakarta Selatan', 'Sudirman, Jakarta Pusat', 'TB Simatupang, Jakarta Selatan', 'Kelapa Gading, Jakarta Utara', 'Puri Kembangan, Jakarta Barat', 'Pulogadung, Jakarta Timur', 'Gambir, Jakarta Pusat', 'Mampang Prapatan, Jakarta Selatan']),
  BDT: R('BDT', 'Bodetabek', 'nasional', 0.052, 7, '021', 5.1e6, ['BSD, Tangerang Selatan', 'Cikarang, Kab. Bekasi', 'Karawaci, Tangerang', 'Cibubur, Depok', 'Sentul, Kab. Bogor', 'Bekasi Selatan, Kota Bekasi']),
  BKS: R('BKS', 'Kota/Kab. Bekasi', 'nasional', 0.052, 7, '021', 5.6e6, ['Jatiasih, Kota Bekasi', 'Rawalumbu, Kota Bekasi', 'Bekasi Timur, Kota Bekasi', 'Bekasi Barat, Kota Bekasi', 'Medan Satria, Kota Bekasi', 'Pondok Gede, Kota Bekasi', 'Mustika Jaya, Kota Bekasi', 'Tambun Selatan, Kab. Bekasi', 'Cikarang Utara, Kab. Bekasi']),
  BDG: R('BDG', 'Bandung Raya', 'nasional', 0.05, 7, '022', 4.5e6, ['Dago, Kota Bandung', 'Buahbatu, Kota Bandung', 'Antapani, Kota Bandung', 'Sukajadi, Kota Bandung', 'Cicendo, Kota Bandung', 'Lengkong, Kota Bandung', 'Cimahi', 'Dayeuhkolot, Kab. Bandung']),
  SBY: R('SBY', 'Surabaya', 'nasional', 0.05, 7, '031', 5.0e6, ['Gubeng, Surabaya', 'Rungkut, Surabaya', 'Wonokromo, Surabaya', 'Tegalsari, Surabaya', 'Sukolilo, Surabaya', 'Wiyung, Surabaya', 'Mulyorejo, Surabaya', 'Genteng, Surabaya', 'Tandes, Surabaya']),
  SDA: R('SDA', 'Sidoarjo–Gresik', 'nasional', 0.052, 7, '031', 4.9e6, ['Waru, Sidoarjo', 'Buduran, Sidoarjo', 'Candi, Sidoarjo', 'Kebomas, Gresik', 'Manyar, Gresik']),
  MLG: R('MLG', 'Malang', 'nasional', 0.05, 7, '0341', 3.5e6, ['Klojen, Kota Malang', 'Lowokwaru, Kota Malang', 'Blimbing, Kota Malang']),
  SMG: R('SMG', 'Semarang', 'nasional', 0.05, 7, '024', 3.5e6, ['Simpang Lima, Semarang', 'Tembalang, Semarang', 'Candisari, Semarang']),
  MDN: R('MDN', 'Medan', 'nasional', 0.048, 7, '061', 3.9e6, ['Medan Baru', 'Medan Petisah', 'Medan Johor', 'Medan Sunggal', 'Medan Helvetia', 'Medan Tembung', 'Medan Selayang', 'Medan Amplas']),
  DPS: R('DPS', 'Denpasar–Badung', 'menengah', 0.055, 8, '0361', 3.4e6, ['Denpasar Selatan', 'Kuta, Badung', 'Denpasar Barat']),
  BTM: R('BTM', 'Batam', 'menengah', 0.06, 7, '0778', 5.0e6, ['Batam Center', 'Nagoya, Batam', 'Muka Kuning, Batam']),
  MKS: R('MKS', 'Makassar', 'menengah', 0.056, 8, '0411', 3.9e6, ['Panakkukang, Makassar', 'Tamalanrea, Makassar', 'Rappocini, Makassar', 'Manggala, Makassar', 'Biringkanaya, Makassar', 'Tamalate, Makassar', 'Somba Opu, Gowa']),
  BPN: R('BPN', 'Balikpapan & koridor IKN', 'cepat', 0.085, 8, '0542', 3.8e6, ['Balikpapan Kota', 'Balikpapan Selatan', 'Balikpapan Utara', 'Kariangau, Balikpapan', 'Penajam, PPU', 'Sepaku, PPU']),
  MRW: R('MRW', 'Morowali–Kendari', 'cepat', 0.1, 8, '0401', 3.7e6, ['Bahodopi, Morowali', 'Kendari', 'Konawe']),
  // Tersedia sebagai profil boom ketiga; belum dipakai usaha demo mana pun.
  MLU: R('MLU', 'Maluku Utara (Halmahera–Ternate)', 'cepat', 0.09, 9, '0921', 3.4e6, ['Ternate Tengah', 'Weda, Halmahera Tengah', 'Obi, Halmahera Selatan']),
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

/* ------------------------------------------------- Mode --lean (hemat tulis) */
// Seri bervolume tinggi diringkas: rekap kiloan mingguan (laundry), work order kecil
// enterprise ditagih sebagai rekap bulanan per klien, proyek lebih sedikit tapi lebih besar,
// dan kontrak enterprise lebih besar (lebih sedikit tagihan per bulan).
function leanEnterprise(services, smallName, { recapPrice = [35e6, 150e6], bigMul = 1.8, bigW = 0.5 } = {}) {
  const small = services.find((x) => x.name === smallName)
  const recap = {
    ...small, name: 'Rekap work order bulanan', w: small.w * 0.6, price: recapPrice, dur: [6, 10],
    desc: (v) => `Rekap ${v.r.int(12, 45)} work order bulan ini untuk ${v.customer} (antara lain: ${v.issue}).`,
    scope: () => 'Rekap work order corrective/perbaikan ringan selama satu bulan sesuai tiket helpdesk, ditagih sekaligus dengan lampiran foto per tiket.',
    done: ['Rekap bulanan disetujui PIC, lampiran tiket lengkap.', 'Rekap disetujui; 2 tiket dipindah ke periode berikutnya.', 'Rekap disetujui setelah verifikasi foto before-after.'],
  }
  return [recap, ...services.filter((x) => x !== small).map((x) => ({ ...x, w: x.w * bigW, price: [x.price[0] * bigMul, x.price[1] * bigMul] }))]
}
function applyLean(biz) {
  const L = biz.lean
  if (!L) return biz
  const b = { ...biz }
  if (L.contractQMul && b.contract) b.contract = { ...b.contract, services: b.contract.services.map((x) => ({ ...x, q: x.q.map(([v, w]) => [Math.round(v * L.contractQMul), w]) })) }
  if (L.services) b.services = L.services(b.services)
  return b
}

/* ------------------------------------------------------ Biaya overhead */
// kind: 'fixed' = biaya tetap bulanan (naik hanya lewat indeks: sewa/IHK/UMK tiap Januari, BBM bertahap);
//       'step'  = semi-tetap, naik bertingkat mengikuti pemicu (jumlah pekerja, cabang);
//       'var'   = variabel, sebanding volume riil (listrik/gas laundry, BBM armada, asuransi kontrak).
// amt(c) menerima c = { r, i, m, I(nama), rev, real, heads, branches, umk, staffUnits }.
const OH = (label, cat, day, kind, amt) => ({ label, cat, day, kind, amt })
/** Anggaran promosi tetap, dinaikkan di bulan kampanye (0-based). */
const promo = (m, months, mul = 1.4) => (months.includes(m) ? mul : 1)
/** Staf tetap non-lapangan UKM: [jumlah, kelipatan UMK]. */
const staffUnits = (list) => list.reduce((s, [n, mult]) => s + Math.max(0, n) * mult, 0)

const BUSINESSES = [
  /* ------------------------------------------------------------ 1. AC */
  {
    k: 1, key: 'ac', scale: 'sole', email: 'demo-ac@satualur.id', name: 'Budi Santoso (Servis AC)', industry: 'Servis AC rumah & ruko',
    regions: [region('BKS')], base: 17.5e6, margin: [0.25, 0.35],
    moy: [0.84, 0.86, 0.95, 1.0, 1.05, 1.03, 1.0, 1.06, 1.12, 1.14, 0.98, 0.96],
    custMix: { individu: 74, umkm: 21, korporat: 5 },
    // Helper harian dibayar per job; jumlah helper aktif mengikuti volume (maks. jobsPerHelper job/bulan per helper).
    workers: { owner: 'Budi Santoso', helpers: [{ n: 'Andi', label: 'Budi Santoso & Andi (helper)' }, { n: 'Rizky', label: 'Rizky Pratama (teknisi)' }, { n: 'Fikri', label: 'Budi Santoso & Fikri (helper)' }], helperP: 0.75, jobsPerHelper: 32, minHelpers: 1 },
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
      OH('Pulsa, kuota & aplikasi pembukuan', 'biaya_lain', 5, 'fixed', (c) => 210000 * c.I('soft')),
      OH('Iklan marketplace / Facebook (anggaran tetap)', 'biaya_lain', 12, 'fixed', (c) => 420000 * c.I('cpi') * promo(c.m, [1, 2, 7, 8, 9]) * c.r.uni(0.9, 1.1)),
      OH('Penyusutan & servis alat (pompa vakum, manifold)', 'biaya_lain', 26, 'fixed', (c) => 350000 * c.r.uni(0.85, 1.15)),
      OH('BBM motor operasional (di luar job)', 'biaya_transport', 27, 'fixed', (c) => 220000 * c.I('fuel') * c.r.uni(0.85, 1.15)),
      OH('Cicilan & servis motor box', 'biaya_transport', 8, 'fixed', () => 850000),
      OH('Sewa gudang kecil (stok freon & pipa)', 'biaya_lain', 2, 'fixed', (c) => 600000 * c.I('rent')),
    ],
    thr: { kind: 'perHelper', amount: 650000, label: 'THR helper' },
  },
  /* ------------------------------------------------------- 2. Cleaning */
  {
    k: 2, key: 'cleaning', scale: 'sole', email: 'demo-cleaning@satualur.id', name: 'Rina Kusuma (Rapi Bersih Home Cleaning)', industry: 'Cleaning service rumah & kos',
    regions: [region('MKS')], base: 14.5e6, margin: [0.25, 0.35],
    moy: [0.92, 0.95, 1.0, 1.0, 0.98, 1.04, 1.06, 1.0, 0.98, 1.0, 0.98, 1.02],
    custMix: { individu: 70, kos: 22, umkm: 8 },
    workers: { owner: 'Rina Kusuma', short: 'Rina', pairs: true, helpers: [{ n: 'Wati' }, { n: 'Sukma' }, { n: 'Dewi' }, { n: 'Nurul' }], helperP: 0.9, jobsPerHelper: 17, minHelpers: 2 },
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
      { name: 'Deep cleaning rumah', w: 22, q: [[1, 100]], unit: 'rumah', price: [450000, 1400000], dur: [5, 9], cost: { tenaga: [0.4, 0.46], bahan: [0.07, 0.1] },
        issues: ['menjelang Lebaran', 'mau ditempati penyewa baru', 'habis banjir kecil', 'rumah baru pindah'],
        desc: (v) => `Deep cleaning rumah (${v.issue}). ${v.pick(['3 kamar tidur, 2 kamar mandi.', '2 kamar tidur, 1 kamar mandi.', 'Rumah 2 lantai.'])}`,
        scope: () => 'Deep cleaning menyeluruh: kerak kamar mandi, dapur & kitchen set, jendela, plafon, dan lantai.',
        done: ['Deep cleaning selesai, kerak kamar mandi hilang ±90%.', 'Selesai 2 orang 7 jam. Saran perawatan rutin bulanan.'] },
      { name: 'Bersih kamar kos', w: 18, types: ['kos'], q: [[2, 30], [4, 35], [6, 25], [10, 10]], unit: 'kamar', price: [75000, 110000], min: 150000, dur: [2, 6], cost: { tenaga: [0.42, 0.5], bahan: [0.06, 0.09] },
        issues: ['pergantian penghuni', 'awal semester mahasiswa', 'kamar lama kosong'],
        desc: (v) => `Bersihkan ${v.q} kamar kos karena ${v.issue}.`,
        scope: (v) => `Pembersihan ${v.q} kamar kos (lantai, kamar mandi dalam, jendela, kasur divakum).`,
        done: ['Semua kamar siap huni.', 'Selesai, 1 kamar ada jamur dinding (disarankan cat ulang).'] },
      { name: 'Cuci sofa & kasur', w: 12, q: [[1, 40], [2, 40], [3, 20]], unit: 'item', price: [150000, 280000], dur: [2, 4], cost: { tenaga: [0.38, 0.44], bahan: [0.08, 0.1] }, rain: 0.8,
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
      OH('Pulsa, kuota & aplikasi pembukuan', 'biaya_lain', 5, 'fixed', (c) => 180000 * c.I('soft')),
      OH('Iklan Instagram/TikTok (anggaran tetap)', 'biaya_lain', 10, 'fixed', (c) => 330000 * c.I('cpi') * promo(c.m, [1, 2, 5, 6]) * c.r.uni(0.9, 1.1)),
      OH('Perlengkapan (mop, vakum, lap) penyusutan', 'biaya_lain', 25, 'fixed', (c) => 350000 * c.r.uni(0.85, 1.15)),
      OH('Cicilan motor & BBM antar-jemput helper', 'biaya_transport', 8, 'fixed', (c) => 700000 + 250000 * c.I('fuel')),
      OH('Seragam & BPJS Ketenagakerjaan helper', 'biaya_lain', 15, 'step', (c) => 120000 * c.heads * c.I('umk')),
    ],
    thr: { kind: 'perHelper', amount: 750000, label: 'THR helper' },
  },
  /* -------------------------------------------------------- 3. Listrik */
  {
    k: 3, key: 'listrik', scale: 'sole', email: 'demo-listrik@satualur.id', name: 'Hendra Siregar (Listrik Siaga Medan)', industry: 'Tukang listrik: instalasi & perbaikan',
    regions: [region('MDN')], base: 16e6, margin: [0.25, 0.35],
    moy: [1.08, 1.06, 1.02, 0.98, 0.96, 0.97, 0.98, 0.96, 0.98, 1.0, 1.04, 1.05],
    custMix: { individu: 70, umkm: 24, korporat: 6 },
    workers: { owner: 'Hendra Siregar', helpers: [{ n: 'Bonar', label: 'Hendra Siregar & Bonar (helper)' }, { n: 'Daniel', label: 'Hendra Siregar & Daniel (helper)' }], helperP: 0.7, jobsPerHelper: 20, minHelpers: 1 },
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
      OH('Pulsa, kuota & aplikasi pembukuan', 'biaya_lain', 5, 'fixed', (c) => 210000 * c.I('soft')),
      OH('Iklan Google Maps / Facebook (anggaran tetap)', 'biaya_lain', 12, 'fixed', (c) => 350000 * c.I('cpi') * promo(c.m, [10, 11, 0]) * c.r.uni(0.9, 1.1)),
      OH('Kalibrasi & penyusutan tang ampere, tester', 'biaya_lain', 26, 'fixed', (c) => 220000 * c.r.uni(0.85, 1.15)),
      OH('Cicilan & servis motor', 'biaya_transport', 8, 'fixed', () => 800000),
      OH('Sewa kios kecil (stok kabel & MCB)', 'biaya_lain', 2, 'fixed', (c) => 400000 * c.I('rent')),
    ],
    thr: { kind: 'perHelper', amount: 900000, label: 'THR helper' },
  },
  /* -------------------------------------------------------- 4. Pest */
  {
    k: 4, key: 'pest', scale: 'ukm', email: 'demo-pest@satualur.id', name: 'CV Basmi Hama Nusantara', industry: 'Pest control (rumah, F&B, gudang, pabrik)',
    regions: [region('SBY', { w: 0.8 }), region('SDA', { w: 0.2 })], base: 172e6, margin: [0.15, 0.25],
    moy: [1.08, 1.1, 1.06, 1.0, 0.95, 0.92, 0.9, 0.92, 0.95, 1.0, 1.04, 1.06],
    custMix: { individu: 30, umkm: 35, korporat: 30, instansi: 5 },
    // Teknisi tetap digaji bulanan (UMK × all-in); jumlahnya mengikuti beban kerja riil (utilisasi ≤ util), puncak musiman dibayar lembur.
    workers: { roster: ['Agus Salim', 'Siti Aminah', 'Joko Purnomo', 'Rahmat Hidayat', 'Dedi Kurniawan', 'Eko Prasetyo', 'Wahyu Nugroho', 'Teguh Santoso', 'Fajar Ramadhan', 'Imam Syafii', 'Bayu Saputra', 'Yusuf Maulana', 'Heru Susanto', 'Andre Wijaya', 'Gilang Permana', 'Rizal Effendi', 'Hamzah Fauzi', 'Galih Pratama', 'Sutrisno', 'Ilham Nasution'], util: 0.9, min: 6, team: 'Tim {lead} ({n} orang)' },
    staff: (heads) => [[1, 1.0], [Math.ceil(heads / 12), 1.4]], // admin + supervisor per 12 teknisi
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
      OH('Gaji admin & supervisor (UMK × all-in)', 'biaya_tenaga', 25, 'step', (c) => c.staffUnits * c.umk * c.allInMonthly),
      OH('Sewa kantor & gudang bahan', 'biaya_lain', 3, 'fixed', (c) => 6.5e6 * c.I('rent')),
      OH('Izin, sertifikasi & APD teknisi', 'biaya_lain', 15, 'step', (c) => (1.1e6 + 95000 * c.heads) * c.I('cpi') * c.r.uni(0.9, 1.1)),
      OH('Aplikasi, internet & telepon kantor', 'biaya_lain', 5, 'fixed', (c) => 750000 * c.I('soft')),
      OH('Marketing (Google Ads, katalog; anggaran tetap)', 'biaya_lain', 10, 'fixed', (c) => 3.2e6 * c.I('cpi') * promo(c.m, [9, 10, 11]) * c.r.uni(0.9, 1.1)),
      OH('BBM & servis kendaraan operasional', 'biaya_transport', 27, 'var', (c) => c.real * c.r.uni(0.012, 0.016) * c.I('fuel')),
    ],
    thr: { kind: 'umk', label: 'THR karyawan (1 bulan UMK)' },
  },
  /* ------------------------------------------------------- 5. Laundry */
  {
    k: 5, key: 'laundry', scale: 'ukm', email: 'demo-laundry@satualur.id', name: 'CV Wangi Bersih Laundry', industry: 'Laundry kiloan + B2B hotel/restoran/klinik',
    regions: [region('BDG')], base: 158e6, margin: [0.15, 0.25],
    moy: [0.94, 1.0, 1.04, 0.98, 1.0, 1.06, 1.06, 0.98, 0.96, 0.98, 1.0, 1.08],
    custMix: { individu: 22, umkm: 18, korporat: 14, hotel: 20, resto: 14, salon: 8, klinik: 4 },
    workers: { roster: ['Neneng Suryani', 'Asep Saepudin', 'Euis Rahmawati', 'Dadang Hermawan', 'Yayan Sopyan', 'Lilis Andriani', 'Ujang Kurnia', 'Cucu Lestari', 'Iwan Setiawan', 'Rika Nuraeni', 'Ade Permana', 'Dewi Kartika', 'Ujang Ramdani', 'Tati Rohayati', 'Rudi Gunawan', 'Yani Mulyani', 'Dede Supriatna', 'Enok Kurniasih', 'Cecep Hidayat', 'Wawan Setiadi'], util: 0.9, min: 6, team: 'Shift {lead} ({n} orang)' },
    staff: (heads) => [[1, 1.0], [2, 1.0]], // admin + 2 kurir antar-jemput
    contract: { share: 0.42, churn: 0.02, services: [
      { name: 'Kontrak laundry linen hotel/restoran', w: 75, types: ['hotel', 'resto'], q: [[800, 30], [1500, 40], [2500, 30]], unit: 'kg', price: [8500, 11000], cost: { tenaga: [0.28, 0.34], bahan: [0.09, 0.12] },
        scope: (v) => `Laundry linen (sprei, handuk, taplak, seragam) estimasi ${v.q} kg/bulan, antar-jemput harian, SLA 24 jam.`,
        done: ['Rekap bulanan sesuai berita acara timbang. 3 item noda permanen dilaporkan.', 'Semua pengiriman tepat SLA, 1 keluhan handuk kurang wangi ditangani.'] },
      { name: 'Kontrak laundry klinik/salon', w: 25, types: ['salon', 'klinik'], q: [[200, 40], [400, 40], [700, 20]], unit: 'kg', price: [11000, 14000], cost: { tenaga: [0.28, 0.34], bahan: [0.1, 0.13] },
        scope: (v) => `Laundry handuk dan linen klinik/salon ±${v.q} kg/bulan, pemisahan linen infeksius, antar-jemput 3x seminggu.`,
        done: ['Rekap bulanan lengkap, linen infeksius diproses terpisah.'] },
    ] },
    services: [
      { name: 'Rekap laundry kiloan harian', w: 140, fixed: 'outlet', q: [[1, 100]], unit: 'hari', price: [1100000, 2600000], dur: [9, 12], cost: { tenaga: [0.28, 0.34], bahan: [0.08, 0.11] }, rain: 1.2,
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
    lean: { services: (list) => list.map((x) => (x.fixed !== 'outlet' ? x : {
      ...x, name: 'Rekap laundry kiloan mingguan', w: x.w / 6, price: [x.price[0] * 6, x.price[1] * 6], dur: [150, 165],
      desc: (v) => `Rekap kasir kiloan & satuan walk-in ${v.customer.replace('Pelanggan walk-in — ', '')} minggu ini: ${v.r.int(180, 420)} nota, ±${v.r.int(800, 1900)} kg.`,
      scope: () => 'Rekap penjualan layanan kiloan, satuan, dan express pelanggan walk-in selama satu minggu (7 kas harian).',
      done: ['Rekap mingguan ditutup, sesuai 7 laporan kas harian.', 'Rekap ditutup; 2 klaim baju luntur dikompensasi.'],
    })) },
    overheads: [
      OH('Gaji admin & kurir (UMK × all-in)', 'biaya_tenaga', 25, 'step', (c) => c.staffUnits * c.umk * c.allInMonthly),
      OH('Sewa 3 outlet & workshop', 'biaya_lain', 3, 'fixed', (c) => 11.5e6 * c.I('rent')),
      OH('Listrik, gas LPG pengering & air', 'biaya_lain', 20, 'var', (c) => c.real * c.r.uni(0.065, 0.075) * c.I('fuel')),
      OH('Penyusutan & servis mesin cuci/dryer', 'biaya_lain', 26, 'fixed', (c) => 3.6e6 * c.r.uni(0.85, 1.15)),
      OH('Aplikasi kasir, internet & telepon', 'biaya_lain', 5, 'fixed', (c) => 900000 * c.I('soft')),
      OH('Promosi (Instagram, mitra GoFood/ShopeeFood; anggaran tetap)', 'biaya_lain', 10, 'fixed', (c) => 2.2e6 * c.I('cpi') * promo(c.m, [1, 2, 5]) * c.r.uni(0.9, 1.1)),
      OH('BBM armada antar-jemput', 'biaya_transport', 27, 'var', (c) => c.real * c.r.uni(0.018, 0.024) * c.I('fuel')),
    ],
    thr: { kind: 'umk', label: 'THR karyawan (1 bulan UMK)' },
  },
  /* -------------------------------------------------------- 6. Dinding */
  {
    k: 6, key: 'dinding', scale: 'ukm', email: 'demo-dinding@satualur.id', name: 'CV Glasur Dinding Borneo', industry: 'Glasur & dinding: pengecatan, coating, waterproofing',
    regions: [region('BPN')], base: 185e6, margin: [0.15, 0.25],
    moy: [0.84, 0.86, 1.02, 0.98, 1.04, 1.08, 1.1, 1.12, 1.1, 1.06, 0.92, 0.88],
    custMix: { individu: 45, umkm: 20, korporat: 30, instansi: 5 },
    workers: { roster: ['Syamsul Bahri', 'La Ode Rahman', 'Andi Baso', 'Ruslan Effendi', 'Jumadi', 'Muh. Arsyad', 'Kadir Daeng', 'Samsuddin', 'Haris Munandar', 'Paulus Tandi', 'Yohanis Toding', 'Rahmat Saleh', 'Akbar Pratama', 'Fadli Hasan', 'Irwan Syah', 'Baharuddin', 'Markus Pasang', 'Syahrul Gunawan', 'Taufik Hidayat', 'Udin Saprudin', 'Zainal Abidin', 'Yakobus Rante'], util: 0.9, min: 6, team: 'Tim {lead} ({n} orang)' },
    staff: (heads) => [[1, 1.0], [1, 1.5], [Math.ceil(heads / 12) - 1, 1.3]], // admin, estimator, mandor tambahan per 12 tukang
    services: [
      { name: 'Pengecatan interior', w: 30, q: [[80, 30], [150, 35], [300, 25], [600, 10]], unit: 'm²', price: [28000, 42000], min: 1500000, dur: [16, 72], cost: { tenaga: [0.22, 0.28], bahan: [0.31, 0.37] },
        issues: ['menjelang Lebaran', 'rumah baru dibeli', 'kantor rebranding warna', 'dinding kusam dan berjamur'],
        desc: (v) => `Cat ulang interior ±${v.q} m² (${v.issue}). Warna ${v.pick(['putih tulang', 'abu muda', 'krem', 'sesuai brand'])}.`,
        scope: (v) => `Pengecatan interior ±${v.q} m²: pengamplasan, plamir titik retak, 1 lapis sealer, 2 lapis cat akhir.`,
        done: ['Selesai 2 lapis, sisa cat diserahkan ke pemilik.', 'Ada rembesan di 1 dinding, disarankan waterproofing.'] },
      { name: 'Pengecatan eksterior', w: 18, q: [[100, 35], [250, 40], [500, 25]], unit: 'm²', price: [38000, 55000], min: 3000000, dur: [24, 120], cost: { tenaga: [0.24, 0.3], bahan: [0.31, 0.37] }, tags: ['outdoor'],
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
      OH('Gaji admin, estimator & mandor (UMK × all-in)', 'biaya_tenaga', 25, 'step', (c) => c.staffUnits * c.umk * c.allInMonthly),
      OH('Sewa workshop & gudang material', 'biaya_lain', 3, 'fixed', (c) => 7e6 * c.I('rent')),
      OH('Sewa/penyusutan scaffolding & alat semprot', 'biaya_lain', 18, 'fixed', (c) => 3.3e6 * c.r.uni(0.85, 1.15)),
      OH('Aplikasi, internet & telepon kantor', 'biaya_lain', 5, 'fixed', (c) => 650000 * c.I('soft')),
      OH('Marketing (Instagram, kerja sama toko cat; anggaran tetap)', 'biaya_lain', 10, 'fixed', (c) => 2.8e6 * c.I('cpi') * promo(c.m, [1, 2, 5, 6]) * c.r.uni(0.9, 1.1)),
      OH('BBM pikap & mobil survei', 'biaya_transport', 27, 'var', (c) => c.real * c.r.uni(0.012, 0.016) * c.I('fuel')),
    ],
    thr: { kind: 'umk', label: 'THR tukang & staf (1 bulan UMK)' },
  },
  /* ---------------------------------------------------------- 7. Mall */
  {
    k: 7, key: 'mall', scale: 'enterprise', email: 'demo-mall@satualur.id', name: 'PT Arunika Layanan Ritel', industry: 'Retail mall: kebersihan & maintenance mal',
    regions: [region('JKT', { w: 0.34 }), region('BDT', { w: 0.2 }), region('BDG', { w: 0.12 }), region('SBY', { w: 0.14 }), region('MDN', { w: 0.1 }), region('BTM', { w: 0.05, open: 3 }), region('MKS', { w: 0.07, open: 2 }), region('BPN', { w: 0.07, open: 6 })],
    base: 1.5e9, margin: [0.1, 0.18], regionAlpha: 8, hq: 'JKT',
    lean: { contractQMul: 1.6, services: (list) => leanEnterprise(list, 'Work order perbaikan ringan tenant/area publik') },
    moy: [0.9, 0.95, 1.06, 1.0, 0.98, 1.04, 1.04, 0.98, 0.98, 1.0, 1.0, 1.12],
    custMix: { mall: 100 },
    workers: { util: 0.9, teamSize: 6 },
    contract: { share: 0.62, churn: 0.008, services: [
      { name: 'Kontrak kebersihan mal (bulanan)', w: 60, types: ['mall'], q: [[18, 30], [28, 40], [45, 30]], unit: 'petugas', priceUmk: [1.9, 2.05], fte: 1, skill: 1.0, price: [6.2e6, 7.4e6], cost: { tenaga: [0.6, 0.66], bahan: [0.06, 0.08] },
        scope: (v) => `Jasa kebersihan mal 3 shift, ${v.q} petugas termasuk supervisor, chemical, dan peralatan; laporan SLA bulanan.`,
        done: ['BAST bulan ini ditandatangani building manager. Skor SLA 96%.', 'BAST terbit; 2 komplain toilet lantai 3 ditutup < 2 jam.', 'Skor audit kebersihan 94%, tambahan petugas akhir pekan disetujui.'] },
      { name: 'Kontrak maintenance MEP mal (bulanan)', w: 40, types: ['mall'], q: [[5, 40], [8, 40], [12, 20]], unit: 'teknisi', priceUmk: [2.6, 2.85], fte: 1, skill: 1.4, price: [8.5e6, 10.5e6], cost: { tenaga: [0.6, 0.66], bahan: [0.08, 0.11] },
        scope: (v) => `Preventive & corrective maintenance MEP (chiller, AHU, eskalator koordinasi vendor, plumbing, genset), ${v.q} teknisi on-site.`,
        done: ['PM chiller & AHU sesuai jadwal; 14 work order corrective ditutup.', 'BAST terbit; downtime eskalator 0,5%, di bawah batas SLA.'] },
    ] },
    services: [
      { name: 'Work order perbaikan ringan tenant/area publik', w: 45, types: ['mall'], q: [[1, 100]], unit: 'work order', price: [1.5e6, 6e6], dur: [2, 8], cost: { tenaga: [0.3, 0.36], bahan: [0.3, 0.36] },
        issues: ['pintu toilet macet', 'lampu koridor parkir mati', 'kran wastafel bocor', 'plafon area tenant rembes', 'handle eskalator kotor dan lengket'],
        desc: (v) => `Work order area publik/tenant: ${v.issue}.`,
        scope: () => 'Perbaikan ringan di luar lingkup kontrak bulanan, dikerjakan di luar jam ramai pengunjung.',
        done: ['Selesai, foto before-after diunggah ke tiket.', 'Perbaikan selesai < SLA 24 jam.'] },
      { name: 'Deep cleaning area food court', w: 22, types: ['mall'], q: [[1, 100]], unit: 'area', price: [6e6, 22e6], dur: [6, 14], cost: { tenaga: [0.38, 0.46], bahan: [0.16, 0.22] },
        issues: ['temuan audit higiene', 'persiapan grand opening tenant', 'lantai licin berminyak'],
        desc: (v) => `Work order deep cleaning food court: ${v.issue}. Dikerjakan malam setelah mal tutup.`,
        scope: () => 'Deep cleaning food court (degreasing lantai, grease trap koordinasi, dinding & kursi) malam hari.',
        done: ['Selesai 2 malam, foto before-after terlampir.', 'Grease trap dikuras, bau hilang.'] },
      { name: 'Pembersihan fasad & kaca atrium', w: 14, types: ['mall'], q: [[1, 100]], unit: 'gedung', price: [18e6, 70e6], dur: [24, 96], cost: { tenaga: [0.42, 0.48], bahan: [0.08, 0.12] }, tags: ['outdoor'],
        issues: ['jadwal semesteran', 'menjelang dekorasi Lebaran', 'menjelang dekorasi Natal & Tahun Baru'],
        desc: (v) => `Pembersihan fasad/kaca atrium dengan gondola/rope access: ${v.issue}.`,
        scope: () => 'Pembersihan fasad dan kaca atrium dengan gondola/rope access bersertifikat K3, termasuk izin kerja ketinggian.',
        done: ['Selesai, 1 hari tertunda angin kencang.', 'Fasad bersih, laporan K3 nihil insiden.'] },
      { name: 'Event cleaning (pameran/konser)', w: 20, types: ['mall'], q: [[1, 100]], unit: 'event', price: [5e6, 25e6], dur: [12, 72], cost: { tenaga: [0.46, 0.52], bahan: [0.1, 0.14] },
        issues: ['pameran otomotif di atrium', 'konser akhir pekan', 'bazar Ramadan', 'midnight sale'],
        desc: (v) => `Tambahan petugas kebersihan untuk ${v.issue}.`,
        scope: () => 'Tambahan tim kebersihan selama event (persiapan, berjalan, pasca-event) sesuai rundown.',
        done: ['Event selesai, area kembali normal sebelum mal buka.', 'Sampah event 3,2 ton diangkut.'] },
      { name: 'Perbaikan MEP non-rutin', w: 26, types: ['mall'], q: [[1, 100]], unit: 'work order', price: [4e6, 35e6], dur: [4, 48], cost: { tenaga: [0.26, 0.32], bahan: [0.32, 0.4] },
        issues: ['pompa transfer air bersih rusak', 'AHU lantai 2 bunyi kasar', 'panel lampu parkir trip', 'pipa toilet bocor ke tenant bawah'],
        desc: (v) => `Work order corrective: ${v.issue}.`,
        scope: () => 'Perbaikan corrective di luar lingkup PM kontrak, termasuk penggantian sparepart sesuai persetujuan building manager.',
        done: ['Sparepart diganti, unit normal. Garansi 3 bulan.', 'Perbaikan selesai, rekomendasi peremajaan unit tahun depan.'] },
      { name: 'Pest control & sanitasi tenant F&B', w: 18, types: ['mall'], q: [[1, 100]], unit: 'paket', price: [4e6, 14e6], dur: [4, 12], cost: { tenaga: [0.26, 0.32], bahan: [0.22, 0.28] }, rain: 1.2,
        issues: ['temuan tikus di loading dock', 'kecoa di area tenant F&B', 'persyaratan sertifikasi halal tenant'],
        desc: (v) => `Pest control tambahan: ${v.issue}.`,
        scope: () => 'Pest control dan sanitasi area tenant F&B dan loading dock, laporan untuk QA mal.',
        done: ['Treatment selesai, monitoring 2 minggu.', 'Laporan diserahkan ke tim QA mal.'] },
    ],
    overheads: [
      OH('Gaji & tunjangan staf kantor pusat (inti + HR/payroll per 60 petugas)', 'biaya_tenaga', 25, 'step', (c) => (60e6 + Math.ceil(c.heads / 60) * 2.2 * c.umkHq * MACRO.allIn) * c.I('umk')),
      OH('Sewa kantor pusat & cabang', 'biaya_lain', 3, 'step', (c) => (35e6 + 9e6 * c.branches) * c.I('rent')),
      OH('Asuransi, K3 & sertifikasi', 'biaya_lain', 15, 'var', (c) => c.rev * c.r.uni(0.008, 0.011)),
      OH('IT, sistem absensi & admin (lisensi per petugas)', 'biaya_lain', 20, 'step', (c) => (12e6 + 45000 * c.heads) * c.I('soft')),
      OH('Marketing & biaya tender', 'biaya_lain', 10, 'step', (c) => (22e6 + 4e6 * c.branches) * c.I('cpi') * c.r.uni(0.9, 1.1)),
      OH('Kendaraan operasional & perjalanan dinas', 'biaya_transport', 27, 'var', (c) => c.real * c.r.uni(0.008, 0.011) * c.I('fuel')),
    ],
    thr: { kind: 'accrued' },
  },
  /* ------------------------------------------------------------ 8. FM */
  {
    k: 8, key: 'fm', scale: 'enterprise', email: 'demo-fm@satualur.id', name: 'PT Prima Layanan Fasilitas', industry: 'Facility management kantor BUMN, perbankan & perkantoran',
    regions: [region('JKT', { w: 0.4 }), region('BDT', { w: 0.12 }), region('BDG', { w: 0.1 }), region('SBY', { w: 0.12 }), region('MDN', { w: 0.08 }), region('SMG', { w: 0.06 }), region('BPN', { w: 0.08, open: 1 }), region('MKS', { w: 0.06, open: 4 }), region('MRW', { w: 0.05, open: 6 })],
    base: 1.6e9, margin: [0.1, 0.18], regionAlpha: 8, hq: 'JKT',
    lean: { contractQMul: 1.6, services: (list) => leanEnterprise(list, 'Work order perbaikan ringan kantor') },
    moy: [0.86, 0.93, 0.98, 0.97, 1.0, 1.02, 1.0, 1.0, 1.02, 1.04, 1.04, 1.1],
    custMix: { kantor: 100 },
    workers: { util: 0.9, teamSize: 6 },
    contract: { share: 0.6, churn: 0.008, services: [
      { name: 'Kontrak facility management gedung (bulanan)', w: 55, types: ['kantor'], q: [[15, 30], [30, 40], [60, 30]], unit: 'personel', priceUmk: [1.9, 2.05], fte: 1, skill: 1.05, price: [6.8e6, 8.2e6], cost: { tenaga: [0.62, 0.68], bahan: [0.06, 0.08] },
        scope: (v) => `Integrated FM (cleaning, office boy, teknisi gedung, resepsionis) ${v.q} personel, termasuk supervisor dan laporan KPI bulanan.`,
        done: ['BAST & laporan KPI bulanan diserahkan ke GA. Kehadiran personel 99,1%.', 'BAST terbit; 1 personel diganti atas permintaan klien.', 'Skor kepuasan GA 4,5/5; 21 tiket helpdesk ditutup.'] },
      { name: 'Kontrak perawatan kantor cabang (bulanan)', w: 45, types: ['kantor'], q: [[4, 40], [8, 40], [15, 20]], unit: 'kantor cabang', fte: 0.45, skill: 1.3, price: [7.5e6, 11e6], cost: { tenaga: [0.4, 0.46], bahan: [0.13, 0.16] },
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
      OH('Gaji & tunjangan staf kantor pusat (inti + HR/payroll per 60 personel)', 'biaya_tenaga', 25, 'step', (c) => (68e6 + Math.ceil(c.heads / 60) * 2.2 * c.umkHq * MACRO.allIn) * c.I('umk')),
      OH('Sewa kantor pusat & cabang', 'biaya_lain', 3, 'step', (c) => (40e6 + 9e6 * c.branches) * c.I('rent')),
      OH('Asuransi, K3 & sertifikasi ISO', 'biaya_lain', 15, 'var', (c) => c.rev * c.r.uni(0.008, 0.011)),
      OH('IT, helpdesk & admin (lisensi per personel)', 'biaya_lain', 20, 'step', (c) => (14e6 + 45000 * c.heads) * c.I('soft')),
      OH('Marketing & biaya tender (e-procurement)', 'biaya_lain', 10, 'step', (c) => (24e6 + 4e6 * c.branches) * c.I('cpi') * c.r.uni(0.9, 1.1)),
      OH('Kendaraan operasional & perjalanan dinas', 'biaya_transport', 27, 'var', (c) => c.real * c.r.uni(0.008, 0.011) * c.I('fuel')),
    ],
    thr: { kind: 'accrued' },
  },
  /* ------------------------------------------------------------ 9. RS */
  {
    k: 9, key: 'rs', scale: 'enterprise', email: 'demo-rs@satualur.id', name: 'PT Sehat Bersih Medika', industry: 'Hospital & healthcare housekeeping (RS, klinik bersalin, lab)',
    regions: [region('SBY', { w: 0.32 }), region('JKT', { w: 0.22 }), region('MLG', { w: 0.1 }), region('SMG', { w: 0.08 }), region('DPS', { w: 0.08 }), region('MKS', { w: 0.08, open: 2 }), region('BPN', { w: 0.07, open: 5 }), region('MDN', { w: 0.05, open: 7 })],
    base: 1.4e9, margin: [0.1, 0.18], regionAlpha: 8, hq: 'SBY',
    lean: { contractQMul: 1.6, services: (list) => leanEnterprise(list, 'Work order kebersihan tambahan', { recapPrice: [30e6, 120e6] }) },
    moy: [1.06, 1.06, 1.02, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 1.0, 1.0, 1.0],
    custMix: { rs: 70, klinik: 30 },
    workers: { util: 0.9, teamSize: 6 },
    contract: { share: 0.66, churn: 0.006, services: [
      { name: 'Kontrak housekeeping rumah sakit (bulanan)', w: 65, types: ['rs'], q: [[18, 30], [30, 40], [50, 30]], unit: 'petugas', priceUmk: [2.0, 2.15], fte: 1, skill: 1.05, price: [6.6e6, 7.8e6], cost: { tenaga: [0.6, 0.66], bahan: [0.1, 0.13] },
        scope: (v) => `Housekeeping RS 24 jam ${v.q} petugas (ruang rawat, IGD, OK, ICU), standar PPI, chemical & APD termasuk, laporan SLA dan audit kebersihan.`,
        done: ['BAST ditandatangani; skor audit PPI 95%.', 'BAST terbit; respon pembersihan IGD rata-rata 9 menit (SLA 15).', 'Audit PPI 92%: temuan di ruang isolasi sudah ditindaklanjuti.'] },
      { name: 'Kontrak housekeeping klinik bersalin/lab (bulanan)', w: 35, types: ['klinik'], q: [[4, 40], [6, 40], [10, 20]], unit: 'petugas', priceUmk: [2.0, 2.15], fte: 1, skill: 1.05, price: [6.4e6, 7.6e6], cost: { tenaga: [0.6, 0.66], bahan: [0.11, 0.14] },
        scope: (v) => `Housekeeping klinik/lab ${v.q} petugas, termasuk penanganan tumpahan biologis dan pemisahan limbah sesuai SOP.`,
        done: ['BAST terbit; nihil insiden tumpahan biologis.', 'Laporan bulanan & checklist ruang tindakan diserahkan.'] },
    ] },
    sla: { p: 0.06, pct: [0.01, 0.03], label: 'Potongan SLA' },
    services: [
      { name: 'Work order kebersihan tambahan', w: 40, types: ['rs', 'klinik'], q: [[1, 100]], unit: 'work order', price: [1.5e6, 5e6], dur: [2, 8], cost: { tenaga: [0.38, 0.44], bahan: [0.2, 0.26] },
        issues: ['tumpahan cairan tubuh di koridor', 'tambahan petugas untuk visitasi akreditasi', 'pembersihan gudang farmasi', 'pembersihan ruang jenazah pasca-renovasi'],
        desc: (v) => `Permintaan tambahan: ${v.issue}.`,
        scope: () => 'Pekerjaan kebersihan tambahan di luar kontrak bulanan, mengikuti SOP PPI fasilitas.',
        done: ['Selesai sesuai SOP, checklist ditandatangani kepala ruangan.', 'Selesai < 1 jam setelah panggilan.'] },
      { name: 'Terminal cleaning & disinfeksi ruang isolasi', w: 30, types: ['rs', 'klinik'], q: [[1, 100]], unit: 'paket', price: [3.5e6, 16e6], dur: [3, 12], cost: { tenaga: [0.32, 0.38], bahan: [0.24, 0.3] }, rain: 1.2,
        issues: ['pasien infeksius pulang', 'lonjakan pasien DBD', 'persiapan akreditasi'],
        desc: (v) => `Permintaan terminal cleaning: ${v.issue}.`,
        scope: () => 'Terminal cleaning dan disinfeksi (UV/hidrogen peroksida) ruang isolasi sesuai SOP PPI, berita acara dan swab test.',
        done: ['Swab test pasca-disinfeksi negatif.', 'Selesai, ruang dirilis ke perawat jaga.'] },
      { name: 'Pembersihan pasca renovasi ruang OK/ICU', w: 16, types: ['rs'], q: [[1, 100]], unit: 'area', price: [12e6, 55e6], dur: [16, 72], cost: { tenaga: [0.38, 0.44], bahan: [0.2, 0.26] },
        issues: ['renovasi ruang operasi', 'pembukaan ICU baru', 'perluasan IGD'],
        desc: (v) => `Pembersihan pasca konstruksi: ${v.issue}. Harus lolos uji partikel.`,
        scope: () => 'Pembersihan pasca konstruksi standar ruang steril, termasuk HEPA vacuum dan koordinasi uji partikel.',
        done: ['Uji partikel lolos, ruang siap dioperasikan.', 'Selesai, 1 putaran ulang di koridor steril.'] },
      { name: 'Perawatan lantai vinyl/epoxy', w: 22, types: ['rs', 'klinik'], q: [[300, 40], [800, 40], [2000, 20]], unit: 'm²', price: [14000, 26000], min: 4e6, dur: [8, 48], cost: { tenaga: [0.36, 0.42], bahan: [0.2, 0.26] },
        issues: ['lantai kusam di koridor', 'jadwal stripping & coating tahunan', 'persiapan akreditasi'],
        desc: (v) => `Perawatan lantai ±${v.q} m²: ${v.issue}.`,
        scope: (v) => `Stripping, coating, dan buffing lantai vinyl ±${v.q} m², dikerjakan bertahap per bangsal.`,
        done: ['Selesai bertahap 3 malam tanpa ganggu layanan.'] },
      { name: 'Pest control fasilitas kesehatan', w: 16, types: ['rs', 'klinik'], q: [[1, 100]], unit: 'paket', price: [4e6, 15e6], dur: [4, 12], cost: { tenaga: [0.26, 0.32], bahan: [0.24, 0.3] }, rain: 1.25,
        issues: ['temuan kecoa di instalasi gizi', 'nyamuk di bangsal', 'persyaratan akreditasi'],
        desc: (v) => `Pest control: ${v.issue}.`,
        scope: () => 'Pest control dengan bahan aman fasilitas kesehatan, jadwal di luar jam kunjungan, laporan untuk komite PPI.',
        done: ['Treatment selesai, laporan diserahkan ke komite PPI.'] },
      { name: 'Linen & tirai bed tambahan', w: 16, types: ['rs', 'klinik'], q: [[100, 40], [300, 40], [600, 20]], unit: 'pcs', price: [18000, 30000], min: 3e6, dur: [24, 72], cost: { tenaga: [0.3, 0.36], bahan: [0.18, 0.24] },
        issues: ['penggantian tirai bed semesteran', 'lonjakan pasien', 'persiapan akreditasi'],
        desc: (v) => `Pencucian/penggantian ${v.q} pcs tirai & linen: ${v.issue}.`,
        scope: (v) => `Pencucian dan pemasangan ulang ${v.q} pcs tirai bed/linen dengan proses disinfeksi termal.`,
        done: ['Tirai terpasang kembali, label tanggal cuci ditempel.'] },
    ],
    overheads: [
      OH('Gaji & tunjangan staf kantor pusat (inti + HR/payroll per 60 petugas)', 'biaya_tenaga', 25, 'step', (c) => (55e6 + Math.ceil(c.heads / 60) * 2.2 * c.umkHq * MACRO.allIn) * c.I('umk')),
      OH('Sewa kantor pusat & cabang', 'biaya_lain', 3, 'step', (c) => (30e6 + 8e6 * c.branches) * c.I('rent')),
      OH('Pelatihan PPI, vaksinasi & MCU petugas', 'biaya_lain', 15, 'step', (c) => 150000 * c.heads * c.I('cpi') * c.r.uni(0.9, 1.1)),
      OH('Asuransi, K3 & sertifikasi', 'biaya_lain', 18, 'var', (c) => c.rev * c.r.uni(0.006, 0.009)),
      OH('IT, absensi & admin (lisensi per petugas)', 'biaya_lain', 20, 'step', (c) => (10e6 + 45000 * c.heads) * c.I('soft')),
      OH('Marketing & biaya tender', 'biaya_lain', 10, 'step', (c) => (18e6 + 3.5e6 * c.branches) * c.I('cpi') * c.r.uni(0.9, 1.1)),
      OH('Kendaraan operasional & perjalanan dinas', 'biaya_transport', 27, 'var', (c) => c.real * c.r.uni(0.007, 0.01) * c.I('fuel')),
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

/**
 * Lean: gabungkan beberapa baris biaya menjadi satu. Jumlah = total semua bagian;
 * kategori = komponen terbesar; waktu = baris acuan (default baris pertama).
 */
function mergeCosts(parts, ref = parts[0]) {
  const byCat = new Map()
  let total = 0
  for (const p of parts) {
    byCat.set(p.category, (byCat.get(p.category) || 0) + p.amount)
    total += p.amount
  }
  const category = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0][0]
  // _ck: rincian kategori × jenis biaya (var/fixed/step) agar analisis tetap akurat setelah digabung
  const ck = {}
  for (const p of parts) for (const [k, v] of Object.entries(p._ck || { [`${p.category}|${p._kind || 'var'}`]: p.amount })) ck[k] = (ck[k] || 0) + v
  return { ...ref, amount: total, category, _parts: Object.fromEntries(byCat), _ck: ck }
}

/** Rata-rata rentang [lo, hi]. */
const mid = (x) => (x[0] + x[1]) / 2

/**
 * Indeks makro per bulan, relatif terhadap bulan pertama jendela (i = 0 → 1,0):
 *  P = tarif jasa (naik tiap Januari + penyesuaian pertengahan tahun sesekali), W = UMK (naik tiap Januari),
 *  rent = sewa (Januari), soft = langganan aplikasi (Januari), cpi/mat/fuel = naik bertahap per bulan.
 */
function buildIndices(months, steps) {
  const byI = new Map(months.map((mo) => [mo.i, mo]))
  const NAMES = ['P', 'W', 'rent', 'soft', 'cpi', 'mat', 'fuel']
  const stepOf = (mo) => ({
    P: (mo.m === 0 ? 1 + steps.priceJan : 1) * (mo.m === MACRO.servicePriceMid.month ? 1 + steps.midAdj : 1),
    W: mo.m === 0 ? 1 + MACRO.umkStep : 1,
    rent: mo.m === 0 ? 1 + MACRO.rentStep : 1,
    soft: mo.m === 0 ? 1 + MACRO.softwareStep : 1,
    cpi: Math.pow(1 + MACRO.cpi, 1 / 12),
    mat: Math.pow(1 + MACRO.materials, 1 / 12),
    fuel: Math.pow(1 + MACRO.fuel, 1 / 12),
  })
  const out = new Map([[0, Object.fromEntries(NAMES.map((n) => [n, 1]))]])
  const is = months.map((m) => m.i)
  const lo = Math.min(...is)
  const hi = Math.max(...is)
  for (let i = 1; i <= hi; i++) {
    const st = stepOf(byI.get(i))
    out.set(i, Object.fromEntries(NAMES.map((n) => [n, out.get(i - 1)[n] * st[n]])))
  }
  for (let i = -1; i >= lo; i--) {
    const st = stepOf(byI.get(i + 1))
    out.set(i, Object.fromEntries(NAMES.map((n) => [n, out.get(i + 1)[n] / st[n]])))
  }
  const year0 = byI.get(0).y
  return {
    I: (name, i) => {
      const v = out.get(Math.max(lo, Math.min(hi, i)))[name === 'umk' ? 'W' : name]
      if (v == null) throw new Error(`Indeks tidak dikenal: ${name}`)
      return v
    },
    /** UMK nominal wilayah di bulan i (nilai REG = tahun MACRO.year0). */
    umkAt: (rg, i) => rg.umk * Math.pow(1 + MACRO.umkStep, (byI.get(Math.max(lo, Math.min(hi, i))).y - MACRO.year0)),
    year0,
  }
}

/**
 * Kapasitas & headcount berbasis utilisasi.
 *  - sole: helper aktif = ceil(rata-rata 3 bln job × peluang pakai helper / jobsPerHelper), lengket (tidak turun karena 1 bulan sepi).
 *  - payroll (UKM/enterprise): FTE kontrak per-petugas = q × fte (ditempatkan penuh); FTE lain = beban kerja riil
 *    (pendapatan riil × porsi tenaga ÷ biaya all-in UMK dasar). Pekerja tetap = ceil(FTE rata-rata 3 bln ÷ util);
 *    kelebihan beban bulan puncak di atas kapasitas dibayar lembur/harian.
 */
function computeLabour(biz, jobs, months, idx, g = 0) {
  const sc = SCALE[biz.scale]
  const is = months.map((m) => m.i).sort((a, b) => a - b)
  const w = biz.workers
  if (sc.labour === 'perJob') {
    const load = new Map(is.map((i) => [i, 0]))
    for (const j of jobs) load.set(j.i, (load.get(j.i) || 0) + (j.kind === 'contract' ? 4 : 1))
    const helpers = new Map()
    let h = null
    for (const i of is) {
      const win = is.filter((k) => k <= i && k > i - 3).map((k) => load.get(k))
      const need = Math.min(w.helpers.length, Math.max(w.minHelpers || 0, Math.ceil((win.reduce((a, b) => a + b, 0) / win.length) * w.helperP / w.jobsPerHelper)))
      if (h == null || need > h) h = need
      else if (need < h - 1) h -= 1
      helpers.set(i, h)
    }
    return {
      mode: 'perJob',
      helpers: (i) => helpers.get(i) ?? helpers.get(is[is.length - 1]),
      heads: (i) => 1 + (helpers.get(i) ?? 0),
      fte: (i) => load.get(i) || 0,
      series: is.map((i) => ({ i, heads: 1 + helpers.get(i), helpers: helpers.get(i), jobs: load.get(i), util: Math.min(1.5, ((load.get(i) || 0) * w.helperP) / Math.max(1, helpers.get(i) * w.jobsPerHelper)) })),
    }
  }
  const multi = biz.scale === 'enterprise'
  const keyOf = (j) => (multi ? j.rg.key : '_')
  const rgOfKey = (k) => (multi ? biz.regions.find((x) => x.key === k) : biz.regions[0])
  const base = new Map() // key|i -> { a, c, sw }
  for (const j of jobs) {
    const k = `${keyOf(j)}|${j.i}`
    const b = base.get(k) || { a: 0, c: 0, swA: 0, swC: 0 }
    const skill = j.svc.skill || 1
    if (j.svc.fte) {
      const f = j.q * j.svc.fte
      b.c += f
      b.swC += f * skill
    } else {
      const umk0 = (multi ? j.rg : biz.regions[0]).umk
      const f = ((j.price / j.px) * mid(j.svc.cost.tenaga)) / (umk0 * MACRO.allIn * skill)
      b.a += f
      b.swA += f * skill
    }
    base.set(k, b)
  }
  const keys = multi ? biz.regions.map((x) => x.key) : ['_']
  const get = (k, i) => base.get(`${k}|${i}`) || { a: 0, c: 0, swA: 0, swC: 0 }
  // Pekerja ad-hoc dikelola sebagai satu pool (UKM: satu lokasi; enterprise: tim mobile lintas wilayah),
  // dialokasikan ke wilayah sebanding beban ad-hoc-nya. Petugas kontrak ditempatkan penuh per wilayah.
  const poolA = new Map(is.map((i) => [i, keys.reduce((s, k) => s + get(k, i).a, 0)]))
  const hAt = new Map()
  let hA = null
  for (const i of is) {
    const win = is.filter((x) => x <= i && x > i - 3).map((x) => poolA.get(x))
    const avg = win.reduce((s, x) => s + x, 0) / win.length
    // Pekerja tetap mengikuti beban rata-rata 3 bulan (diproyeksikan 1 bulan ke depan dengan rencana pertumbuhan g)
    // ÷ utilisasi sasaran; beban di atasnya ditutup lembur/harian. Turun hanya lewat atrisi bertahap (±10%/bulan).
    let need = Math.ceil((avg * (1 + g)) / w.util - 1e-9)
    if (!multi) need = Math.max(w.min || 1, need)
    if (hA == null || need > hA) hA = need
    else if (need < hA) hA = Math.max(need, hA - Math.max(1, Math.round(hA * 0.1)))
    hAt.set(i, hA)
  }
  const per = new Map() // key -> Map(i -> {...})
  for (const k of keys) {
    const m = new Map()
    for (const i of is) {
      const b = get(k, i)
      const A = poolA.get(i)
      const shareA = A > 0 ? b.a / A : multi ? 0 : 1
      const hAk = hAt.get(i) * shareA // alokasi pecahan (untuk gaji); tampilan dibulatkan
      const otK = Math.max(0, A - hAt.get(i)) * shareA
      const hC = Math.ceil(b.c - 1e-9)
      const fte = b.a + b.c
      const skillA = b.a > 0 ? b.swA / b.a : 1
      const skillC = b.c > 0 ? b.swC / b.c : 1
      // wageUnits: kelipatan UMK yang dibayar (pekerja × keahlian); lembur dari kelebihan beban ad-hoc
      m.set(i, { heads: Math.round(hAk) + hC, hA: hAk, hC, fteA: b.a, fteC: b.c, skillA, skillC, wageUnits: hAk * skillA + hC * skillC, ot: otK * skillA, util: hAk + hC > 0 ? fte / (hAk + hC) : 0 })
    }
    per.set(k, m)
  }
  const at = (k, i) => per.get(k)?.get(i) || { heads: 0, hA: 0, hC: 0, fteA: 0, fteC: 0, skillA: 1, skillC: 1, wageUnits: 0, ot: 0, util: 0 }
  const heads = (i) => hAt.get(i) + keys.reduce((s, k) => s + at(k, i).hC, 0)
  return {
    mode: 'payroll',
    keys,
    rgOfKey,
    at,
    heads,
    series: is.map((i) => {
      const xs = keys.map((k) => at(k, i))
      const hd = heads(i)
      const fte = xs.reduce((s, x) => s + x.fteA + x.fteC, 0)
      return { i, heads: hd, fte, util: hd ? fte / hd : 0, overtime_fte: xs.reduce((s, x) => s + x.ot, 0), by_region: multi ? Object.fromEntries(keys.map((k) => [k, at(k, i).heads])) : undefined }
    }),
  }
}

function simulateBusiness(biz, ctx, attempt) {
  const sc = SCALE[biz.scale]
  const r = makeRng(hashStr(`${ctx.seed}:${biz.key}:${attempt}`))
  const intensity = intensityFn(biz)
  const owner = ownerId(biz.k)
  const g = r.uni(sc.gDraw[0], sc.gDraw[1])
  // Lapisan makro: kenaikan tarif Januari & pertengahan tahun (per usaha), eskalasi kontrak non-UMK.
  const priceJan = r.uni(MACRO.servicePriceJan[biz.scale][0], MACRO.servicePriceJan[biz.scale][1])
  const midAdj = r.chance(MACRO.servicePriceMid.p) ? r.uni(MACRO.servicePriceMid.pct[0], MACRO.servicePriceMid.pct[1]) : 0
  const cShare = biz.contract?.share || 0
  const months = ctx.months // [{i, y, m, startMs, days}]
  const idx = buildIndices(months, { priceJan, midAdj })
  const I = idx.I
  const meanRaw = months.filter((x) => x.i >= 0 && x.i < ctx.nMonths).reduce((s, x) => s + x.raw(intensity), 0) / ctx.nMonths
  const custs = makeCustomerFactory(biz, r)
  const asof = ctx.asof
  const jobs = []
  const lost = []
  const contracts = []
  const monthStats = new Map()
  const thrPaid = new Set()
  const natNominal = nominalOf(MACRO.realGdp)

  // Bobot wilayah enterprise: condong ke wilayah yang ekonominya (NOMINAL = riil + inflasi) tumbuh lebih cepat.
  const regionWeights = (i) => {
    const alpha = biz.regionAlpha || 0
    return biz.regions.map((rg) => {
      if (i < rg.open) return [rg, 0]
      const ramp = rg.open > -50 ? Math.min(1, (i - rg.open + 1) / 3) : 1
      const tilt = Math.pow((1 + rg.nominal) / (1 + natNominal), (alpha * i) / 12)
      return [rg, rg.w * ramp * tilt]
    })
  }
  let lab = null // diisi setelah semua pekerjaan diundi
  const workerFor = (i, rg, price, avg) => {
    const w = biz.workers
    if (w.owner) {
      const active = w.helpers.slice(0, lab.helpers(i))
      const useHelper = r.chance(w.helperP)
      if (!useHelper || !active.length) return { name: w.owner, helper: false }
      if (w.pairs) {
        const ppl = [w.short || w.owner, ...active.map((h) => h.n)]
        const a = r.int(0, ppl.length - 1)
        let b = r.int(0, ppl.length - 2)
        if (b >= a) b++
        return { name: `${ppl[Math.min(a, b)]} & ${ppl[Math.max(a, b)]}`, helper: true }
      }
      return { name: r.pick(active).label, helper: true }
    }
    if (w.roster) {
      const need = Math.max(1, lab.heads(i))
      const k = r.int(0, need - 1)
      const lead = w.roster[k] || `Pekerja ${k + 1}`
      const n = price > avg * 1.6 ? r.int(3, 5) : price > avg * 0.8 ? r.int(2, 3) : 1
      return { name: n > 1 ? w.team.replace('{lead}', lead).replace('{n}', n) : lead, helper: true, need }
    }
    // enterprise: tim per wilayah, jumlah tim mengikuti pekerja tetap ad-hoc di wilayah itu
    const teams = Math.max(1, Math.ceil(lab.at(rg.key, i).hA / w.teamSize))
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

  /** Harga nominal. Kontrak per petugas dihargai dari UMK wilayah (× kelipatan); lainnya dari katalog × indeks tarif P. */
  const mkPrice = (svc, q, cust, i, rg) => {
    const corp = ['korporat', 'instansi', 'mall', 'kantor', 'rs', 'klinik'].includes(cust.type)
    const u = corp ? 0.35 + 0.65 * r.next() : r.next()
    if (svc.priceUmk) return roundP(q * idx.umkAt(rg, i) * (svc.priceUmk[0] + (svc.priceUmk[1] - svc.priceUmk[0]) * u))
    let p = q * (svc.price[0] + (svc.price[1] - svc.price[0]) * u)
    if (svc.min) p = Math.max(svc.min, p)
    return roundP(p * I('P', i))
  }
  /** Indeks harga yang melekat pada harga: dipakai untuk mendeflasi pendapatan (riil = nominal ÷ px). */
  const pxOf = (svc, i) => (svc.priceUmk ? I('W', i) : I('P', i))

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
    const trend = biz.base * Math.pow(1 + g, i) // target NOMINAL (tren bisnis), bukan pertumbuhan riil
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
      if (mo.m === 0 && prevContractMonthDone !== null) {
        // Eskalasi Januari: kontrak per petugas mengikuti kenaikan UMK; kontrak lain mengikuti rentang MACRO.contractEsc.
        for (const c of contracts) {
          if (!c.active) continue
          const e = c.svc.priceUmk ? MACRO.umkStep : r.uni(MACRO.contractEsc[0], MACRO.contractEsc[1])
          c.value = roundP(c.value * (1 + e))
          c.px *= 1 + e
        }
      }
      let sum = contracts.filter((c) => c.active).reduce((s, c) => s + c.value, 0)
      let guard = 0
      while (guard++ < 200) {
        const svc = r.wpick(biz.contract.services.map((s) => [s, s.w]))
        const rg = r.wpick(activeRegions)
        const q = qty(svc)
        const cust = custs.create(rg, svc.types || Object.keys(biz.custMix))
        const value = mkPrice(svc, q, cust, i, rg)
        if (sum + value / 2 > cTarget) break
        contracts.push({ svc, rg, q, cust, value, px: pxOf(svc, i), start: i, active: true, no: contracts.length + 1, billDay: r.int(1, 26) })
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
        jobs.push({ kind: 'contract', i, svc: c.svc, rg: c.rg, cust: c.cust, q: c.q, price: c.value, px: c.px, tl, contract: c, period: `${monthLabel(mo.y, mo.m)} (siklus tgl ${c.billDay})` })
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
      const price = mkPrice(svc, q, cust, i, rg)
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
      jobs.push({ kind: 'adhoc', i, svc, rg, cust, q, price, px: pxOf(svc, i), tl, avgTicket })
    }

    /* --- prospek yang tidak jadi (funnel) --- */
    const nLost = Math.round(nAdhoc * sc.loss * r.lognoise(0.2))
    for (let k = 0; k < nLost; k++) {
      const svc = r.wpick(svcPairs)
      if (svc.fixed) continue
      const rg = r.wpick(activeRegions)
      const cust = custs.get(rg, svc.types || Object.keys(biz.custMix), sc.repeat * 0.6)
      const q = qty(svc)
      const price = mkPrice(svc, q, cust, i, rg)
      const day = sampleDay(mo)
      const Rt = localToUtc(day, r.uni(7.5, 21), rg.tz)
      const noOffer = r.chance(sc.noOffer)
      const O = Rt + r.uni(sc.quoteH[0], sc.quoteH[1]) * HOUR
      const D = O + r.uni(sc.decisionDays[0], sc.decisionDays[1]) * DAY
      lost.push({ i, svc, rg, cust, q, price, R: Rt, O: noOffer ? null : O, D })
    }
  }

  /* --- kapasitas: headcount mengikuti volume riil --- */
  lab = computeLabour(biz, jobs, months, idx, g)

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
    // ---- jurnal per pekerjaan (biaya variabel). Biaya riil × indeks biaya ÷ indeks harga jual.
    const revenue = r.chance(0.06) ? roundP(j.price * r.uni(1.03, 1.12)) : j.price // tambahan sparepart/volume aktual
    const costBuf = []
    const post = (cat, amt, dt = 0, extra = {}) => {
      const a = Math.round(amt / 1000) * 1000
      if (a <= 0) return
      const t = iso(tl.P + dt) // selalu dipanggil agar urutan PRNG sama di mode penuh & lean
      const row = { owner_id: owner, completion_id: complId, amount: a, category: cat, status: 'posted', posted_at: t, created_at: t, _ms: tl.P + dt, _rg: rg.key, _cust: cust.name, _svc: svc.name, _kind: 'var', ...extra }
      if (ctx.lean && cat !== 'pendapatan') costBuf.push(row)
      else rows.ledger_entries.push({ id: nextId('ledger_entries'), ...row })
    }
    post('pendapatan', revenue, 0, { _px: j.px, _contract: isContract })
    const c = svc.cost
    const ji = j.i
    if (sc.labour === 'perJob') {
      // Sole: helper harian dibayar per job; tarifnya naik mengikuti UMK tiap Januari (W), harga jual mengikuti P.
      const labourOk = biz.labourLineP == null || wk.helper
      if (labourOk && (biz.labourLineP == null || r.chance(biz.labourLineP / (biz.workers.helperP || 1)))) post('biaya_tenaga', revenue * r.uni(c.tenaga[0], c.tenaga[1]) * (I('W', ji) / j.px), 2 * MIN)
    }
    post('biaya_bahan', revenue * r.uni(c.bahan[0], c.bahan[1]) * (I('mat', ji) / j.px), 3 * MIN)
    if (biz.transportAbs) post('biaya_transport', r.uni(biz.transportAbs[0], biz.transportAbs[1]) * (j.q > 4 ? 1.3 : 1) * I('fuel', ji), 4 * MIN)
    else if (r.chance(sc.transportLine)) post('biaya_transport', revenue * r.uni(0.015, 0.035) / sc.transportLine * (I('fuel', ji) / j.px), 4 * MIN)
    if (isContract && biz.sla && r.chance(biz.sla.p)) post('biaya_lain', revenue * r.uni(biz.sla.pct[0], biz.sla.pct[1]), 5 * MIN)
    if (costBuf.length) rows.ledger_entries.push({ id: nextId('ledger_entries'), ...mergeCosts(costBuf) })
  }

  // Overhead bulanan, gaji tetap & THR: dilekatkan ke penyelesaian terakhir sebelum tanggal posting (skema mewajibkan completion_id).
  completionsByTime.sort((a, b) => a.t - b.t)
  const attach = (ms) => {
    let lo = 0
    let hi = completionsByTime.length - 1
    let best = null
    while (lo <= hi) {
      const mid2 = (lo + hi) >> 1
      if (completionsByTime[mid2].t <= ms) { best = completionsByTime[mid2]; lo = mid2 + 1 } else hi = mid2 - 1
    }
    return best
  }
  const hqReg = biz.regions.find((x) => x.key === biz.hq) || biz.regions[0]
  const tzHQ = hqReg.tz
  const allInMonthly = biz.thr.kind === 'accrued' ? MACRO.allIn : 1 + MACRO.allInParts.bpjs + MACRO.allInParts.other // UKM: THR dibayar tunai terpisah
  const revBy = new Map()
  for (const j of jobs) {
    const x = revBy.get(j.i) || { rev: 0, real: 0 }
    x.rev += j.price
    x.real += j.price / j.px
    revBy.set(j.i, x)
  }
  for (const mo of months.filter((x) => x.i >= 0 && x.i < ctx.nMonths)) {
    const i = mo.i
    const branches = biz.regions.filter((x) => i >= x.open).length - 1
    const heads = sc.labour === 'perJob' ? lab.helpers(i) : lab.heads(i)
    const umk = idx.umkAt(biz.regions[0], i)
    const staff = biz.staff ? biz.staff(heads) : []
    const cctx = { r, i, m: mo.m, I: (n) => I(n, i), rev: revBy.get(i)?.rev || 0, real: revBy.get(i)?.real || 0, heads, branches, umk, umkHq: hqReg.umk, allInMonthly, staffUnits: staffUnits(staff) }
    const items = biz.overheads.map((o) => ({ ...o, amount: o.amt(cctx) }))
    // Gaji pekerja tetap (UMK × all-in) dan lembur/harian di bulan puncak
    if (lab.mode === 'payroll') {
      let ot = 0
      for (const k of lab.keys) {
        const x = lab.at(k, i)
        if (!x.heads) continue
        const rg = lab.rgOfKey(k)
        const u = idx.umkAt(rg, i)
        items.push({ label: `Gaji pekerja lapangan tetap${lab.keys.length > 1 ? ` ${rg.key}` : ''} (${x.heads} org × UMK × ${allInMonthly.toFixed(3).replace('.', ',')})`, cat: 'biaya_tenaga', day: 25, kind: 'step', amount: x.wageUnits * u * allInMonthly })
        ot += x.ot * u * MACRO.allIn * MACRO.overtime
      }
      items.push({ label: 'Lembur & tenaga harian (beban di atas kapasitas)', cat: 'biaya_tenaga', day: 28, kind: 'var', amount: ot })
    }
    // THR tunai: H-10 Lebaran di bulan tersebut
    for (const L of LEBARAN) {
      const lm = new Date(L - 10 * DAY)
      if (lm.getUTCFullYear() === mo.y && lm.getUTCMonth() === mo.m && biz.thr.kind !== 'accrued' && !thrPaid.has(L)) {
        thrPaid.add(L)
        const amount = biz.thr.kind === 'umk' ? (heads + cctx.staffUnits) * umk : biz.thr.amount * Math.max(1, heads)
        items.push({ label: biz.thr.label, cat: 'biaya_tenaga', day: lm.getUTCDate(), kind: 'step', amount })
      }
    }
    const ohBuf = []
    for (const it of items) {
      const day = Math.min(it.day, mo.days)
      const t = localToUtc(mo.startMs + (day - 1) * DAY, r.uni(9, 16), tzHQ)
      if (t > asof) continue
      const host = attach(t)
      if (!host) continue
      const a = Math.round(it.amount / 1000) * 1000
      if (a <= 0) continue
      const ts = iso(t)
      const row = { owner_id: owner, completion_id: host.id, amount: a, category: it.cat, status: 'posted', posted_at: ts, created_at: ts, _ms: t, _overhead: it.label, _kind: it.kind || 'fixed' }
      if (ctx.lean) ohBuf.push(row)
      else rows.ledger_entries.push({ id: nextId('ledger_entries'), ...row })
    }
    // Lean: satu baris overhead per bulan, diposting pada tanggal item terakhir (total bulanan tetap sama).
    if (ohBuf.length) {
      const last = ohBuf.reduce((x, y) => (y._ms > x._ms ? y : x))
      rows.ledger_entries.push({ id: nextId('ledger_entries'), ...mergeCosts(ohBuf, last), _overhead: ohBuf.map((x) => x._overhead).join('; ') })
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

  const macro = { price_jan_step: priceJan, price_mid_step: midAdj, umk_step: MACRO.umkStep, umk_primary_region: biz.regions[0].umk, umk_hq: hqReg.umk, all_in_monthly: allInMonthly }
  return { biz, g, rows, monthStats, attempt, custCount: custs.count(), contracts: contracts.length, activeContracts: contracts.filter((c) => c.active).length, lab, idx, macro }
}

/* =================================================== Statistik & cek */

/** Regresi log-linear y = a + b·x → pertumbuhan per periode e^b − 1, plus deviasi standar residual. */
function logFit(xs, vals) {
  const ys = vals.map((v) => Math.log(v))
  const xm = xs.reduce((a, b) => a + b, 0) / xs.length
  const ym = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0
  let den = 0
  for (let k = 0; k < xs.length; k++) { num += (xs[k] - xm) * (ys[k] - ym); den += (xs[k] - xm) ** 2 }
  const b = num / den
  const res = ys.map((y, k) => y - (ym + b * (xs[k] - xm)))
  const sd = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / Math.max(1, res.length - 2))
  return { g: Math.exp(b) - 1, sd }
}

/** Estimasi pajak per bulan (TIDAK ditulis ke buku besar; buku besar = laba sebelum pajak). */
function taxModel(biz, sim, months) {
  const T = MACRO.tax
  if (biz.scale === 'enterprise') {
    // PT: PPh Badan 22% atas laba (perkiraan kasar, tanpa koreksi fiskal) dengan fasilitas Pasal 31E bila peredaran ≤ Rp50 M.
    const full = months.filter((m) => m.full)
    const annual = (full.reduce((s, m) => s + m.rev, 0) / Math.max(1, full.length)) * 12
    const slice = annual <= T.corp31eGross ? Math.min(1, T.corp31eSlice / annual) : 0
    const eff = T.corporate * (1 - 0.5 * slice)
    return { method: `Perkiraan PPh Badan ${idPct(T.corporate, 0)} × laba sebelum pajak${slice ? `, fasilitas Pasal 31E (peredaran setahun ±${idRp(annual)} ≤ Rp50 M; porsi ${idPct(slice, 0)} PKP bertarif 50%)` : ''}; tarif efektif ±${idPct(eff)}. Tanpa koreksi fiskal; hanya ilustrasi, tidak ditulis ke buku besar.`, eff, annual_turnover: annual, monthly: (m) => (m.rev - m.cost) * eff, floorTotal: true }
  }
  // Sole (WP orang pribadi) & UKM (CV): PPh Final 0,5% × peredaran bruto (PP 55/2022). WP OP: Rp500 jt pertama setahun bebas.
  const indiv = biz.scale === 'sole'
  // Peredaran Jan..sebelum bulan pertama jendela (tahun pajak berjalan): diekstrapolasi mundur dari tren.
  const first = months[0]
  let pre = 0
  for (let k = 1; k <= first.m0; k++) pre += biz.base * Math.pow(1 + sim.g, -k)
  const ytd = new Map()
  let acc = pre
  let year = first.y
  const full = months.filter((m) => m.full)
  const annual = (full.reduce((s, m) => s + m.rev, 0) / Math.max(1, full.length)) * 12
  for (const m of months) {
    if (m.y !== year) { year = m.y; acc = 0 }
    const before = acc
    acc += m.rev
    ytd.set(m.key, { before, after: acc })
  }
  const capOk = annual <= T.turnoverCap
  return {
    method: indiv
      ? `PPh Final UMKM ${idPct(T.pphFinal)} × peredaran bruto di atas Rp${T.individualExempt / 1e6} jt pertama per tahun pajak (WP orang pribadi, PP 55/2022). Peredaran setahun ±${idRp(annual)}${annual < T.individualExempt ? ' < Rp500 jt, jadi estimasi pajak Rp0' : ''}.`
      : `PPh Final UMKM ${idPct(T.pphFinal)} × peredaran bruto bulanan (CV, PP 55/2022; batas waktu CV 4 tahun pajak diasumsikan belum lewat). Peredaran setahun ±${idRp(annual)} ${capOk ? '≤' : '>'} Rp4,8 M${capOk ? '' : ': DI ATAS BATAS, rezim final tidak berlaku'}.`,
    eff: null,
    annual_turnover: annual,
    turnover_cap_ok: capOk,
    pre_window_ytd: indiv ? pre : undefined,
    monthly: (m) => {
      if (!capOk) return 0
      if (!indiv) return m.rev * T.pphFinal
      const y = ytd.get(m.key)
      const taxable = Math.max(0, y.after - Math.max(T.individualExempt, y.before))
      return taxable * T.pphFinal
    },
    floorTotal: false,
  }
}

function analyse(sim, ctx) {
  const { biz, rows, monthStats, lab } = sim
  const sc = SCALE[biz.scale]
  const per = new Map()
  const blank = () => ({ rev: 0, real: 0, revContract: 0, cost: 0, jobs: 0, byReg: {}, ck: {} })
  for (const l of rows.ledger_entries) {
    const { y, m } = wibMonth(l._ms)
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    if (!per.has(key)) per.set(key, blank())
    const p = per.get(key)
    if (l.category === 'pendapatan') {
      p.rev += l.amount
      p.real += l.amount / (l._px || 1)
      if (l._contract) p.revContract += l.amount
      p.jobs++
      p.byReg[l._rg] = (p.byReg[l._rg] || 0) + l.amount
    } else {
      p.cost += l.amount
      for (const [k, v] of Object.entries(l._ck || { [`${l.category}|${l._kind || 'var'}`]: l.amount })) p.ck[k] = (p.ck[k] || 0) + v
    }
  }
  const out = []
  const firstMo = ctx.months.find((x) => x.i === 0)
  for (const mo of ctx.months.filter((x) => x.i >= 0 && x.i < ctx.nMonths)) {
    const key = `${mo.y}-${String(mo.m + 1).padStart(2, '0')}`
    const p = per.get(key) || blank()
    const full = mo.endMs <= ctx.asof
    const frac = full ? 1 : Math.max(0.01, (ctx.asof - mo.startMs) / (mo.endMs - mo.startMs))
    const L = lab.series.find((x) => x.i === mo.i)
    out.push({ key, y: mo.y, m: mo.m, m0: firstMo.m, label: monthLabel(mo.y, mo.m), i: mo.i, full, frac, ...p, SI: monthStats.get(mo.i).SI, P: sim.idx.I('P', mo.i), W: sim.idx.I('W', mo.i), lab: L })
  }
  const full = out.filter((x) => x.full)
  for (let k = 0; k < out.length; k++) {
    const prev = out[k - 1]
    const cur = out[k]
    const rr = (x) => x.rev / x.frac
    cur.mom = prev && cur.full ? rr(cur) / rr(prev) - 1 : null
    cur.momDes = prev && cur.full ? (rr(cur) / cur.SI) / (rr(prev) / prev.SI) - 1 : null
  }
  const xs = full.map((x) => x.i)
  // Tren NOMINAL desesonal (yang diuji terhadap band bisnis) dan tren volume RIIL (pendapatan ÷ indeks harga).
  const nomFit = logFit(xs, full.map((x) => x.rev / x.SI))
  const realFit = logFit(xs, full.map((x) => x.real / x.SI))
  const rawFit = logFit(xs, full.map((x) => x.rev))
  const trendG = nomFit.g
  const realG = realFit.g
  const priceG = (1 + trendG) / (1 + realG) - 1
  const first = full[0]
  const last = full[full.length - 1]
  const n = last.i - first.i
  const cmgr = Math.pow(last.rev / first.rev, 1 / n) - 1
  const cmgrDes = Math.pow((last.rev / last.SI) / (first.rev / first.SI), 1 / n) - 1
  const priceIdxChange = (last.rev / last.real) / (first.rev / first.real) - 1 // perubahan indeks harga efektif (bauran)
  // Volatilitas: CV di sekitar tren (musim + derau), CV mentah, dan derau setelah koreksi musim.
  const mean = full.reduce((s, x) => s + x.rev, 0) / full.length
  const cvRaw = Math.sqrt(full.reduce((s, x) => s + (x.rev - mean) ** 2, 0) / (full.length - 1)) / mean
  const cv = rawFit.sd
  const cvNoise = nomFit.sd
  const momAbs = full.filter((x) => x.mom != null).reduce((s, x, _, a) => s + Math.abs(x.mom) / a.length, 0)
  // Pasar wilayah (rata-rata tertimbang pangsa pendapatan)
  const regShareAll = {}
  for (const x of full) for (const [k2, v] of Object.entries(x.byReg)) regShareAll[k2] = (regShareAll[k2] || 0) + v
  const totReg = Object.values(regShareAll).reduce((a, b) => a + b, 0)
  let mReal = 0
  let mNom = 0
  for (const [k2, v] of Object.entries(regShareAll)) {
    const rg = biz.regions.find((x) => x.key === k2)
    mReal += (v / totReg) * (Math.pow(1 + rg.real, 1 / 12) - 1)
    mNom += (v / totReg) * (Math.pow(1 + rg.nominal, 1 / 12) - 1)
  }
  // Biaya & pajak
  const totRev = full.reduce((s, x) => s + x.rev, 0)
  const totCost = full.reduce((s, x) => s + x.cost, 0)
  const margin = (totRev - totCost) / totRev
  const tax = taxModel(biz, sim, out)
  for (const x of out) x.tax = tax.monthly(x)
  let totTax = full.reduce((s, x) => s + x.tax, 0)
  if (tax.floorTotal) totTax = Math.max(0, totTax)
  const marginAfter = (totRev - totCost - totTax) / totRev
  const ck = {}
  for (const x of full) for (const [k2, v] of Object.entries(x.ck)) ck[k2] = (ck[k2] || 0) + v
  const sumCk = (fn) => Object.entries(ck).filter(([k2]) => fn(...k2.split('|'))).reduce((s, [, v]) => s + v, 0) / totRev
  const costShare = {
    labour: sumCk((c) => c === 'biaya_tenaga'),
    labour_fixed: sumCk((c, k2) => c === 'biaya_tenaga' && k2 !== 'var'),
    labour_variable: sumCk((c, k2) => c === 'biaya_tenaga' && k2 === 'var'),
    materials: sumCk((c) => c === 'biaya_bahan'),
    transport: sumCk((c) => c === 'biaya_transport'),
    other: sumCk((c) => c === 'biaya_lain'),
    variable: sumCk((c, k2) => k2 === 'var'),
    fixed: sumCk((c, k2) => k2 === 'fixed'),
    semi_fixed: sumCk((c, k2) => k2 === 'step'),
  }
  // Leverage operasi: margin kuartal pertama vs terakhir (bulan penuh)
  const q = (xs2) => (xs2.reduce((s, x) => s + x.rev - x.cost, 0) / xs2.reduce((s, x) => s + x.rev, 0))
  const marginFirstQ = q(full.slice(0, 3))
  const marginLastQ = q(full.slice(-3))
  const band = sc.band
  const cvOk = !sc.cvBand || (cv >= sc.cvBand[0] && cv <= sc.cvBand[1])
  const ok = trendG >= band[0] && trendG <= band[1] && margin >= biz.margin[0] && margin <= biz.margin[1] && cvOk && tax.turnover_cap_ok !== false
  const share = (x) => Object.fromEntries(Object.entries(x.byReg).map(([k2, v]) => [k2, v / x.rev]))
  const headStart = first.lab.heads
  const headEnd = last.lab.heads
  return {
    months: out, trendG, realG, priceG, priceIdxChange, marketReal: mReal, marketNominal: mNom, shareGain: (1 + realG) / (1 + mReal) - 1,
    cmgr, cmgrDes, cagrEq: Math.pow(1 + trendG, 12) - 1, realCagrEq: Math.pow(1 + realG, 12) - 1,
    cv, cvRaw, cvNoise, momAbs, cvOk,
    margin, marginAfter, totTax, tax, costShare, marginFirstQ, marginLastQ,
    ok, band, totRev, totCost, regFirst: share(first), regLast: share(last), headStart, headEnd,
  }
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
  out.push(`<p>Pendapatan <strong>${fmtRp(s.total_revenue)}</strong>, biaya <strong>${fmtRp(s.total_cost)}</strong>, ${s.net_profit >= 0 ? 'laba' : 'rugi'} sebelum pajak <strong>${fmtRp(Math.abs(s.net_profit))}</strong> (margin ${pctFmt(s.margin_pct ?? 0)}).</p>`)
  if (s.previous_period && s.previous_period.total_revenue > 0) {
    const g = ((s.total_revenue - s.previous_period.total_revenue) / s.previous_period.total_revenue) * 100
    out.push(`<p>Dibanding ${esc(s.previous_period.label)}, pendapatan ${g >= 0 ? 'naik' : 'turun'} <strong>${pctFmt(Math.abs(g))}</strong>.</p>`)
  }
  const cost = s.by_category.filter((c) => c.category !== 'pendapatan')
  const recs = []
  if (cost[0]) recs.push(`Komponen biaya terbesar adalah ${esc(cost[0].label.toLowerCase())} (${pctFmt((cost[0].amount / Math.max(1, s.total_revenue)) * 100)} dari pendapatan); pantau produktivitas per petugas.`)
  if (s.top_customers[0]) recs.push(`Pelanggan terbesar: ${esc(s.top_customers[0].name)} (${pctFmt((s.top_customers[0].revenue / Math.max(1, s.total_revenue)) * 100)} dari pendapatan).`)
  if (s.margin_pct != null && s.margin_pct < biz.margin[0] * 100) recs.push('Margin di bawah target usaha; periksa harga penawaran dan biaya bahan.')
  if (biz.scale !== 'enterprise') recs.push(biz.scale === 'sole' ? 'Pajak belum dihitung: PPh Final UMKM 0,5% hanya berlaku atas peredaran di atas Rp500 jt setahun (WP orang pribadi, PP 55/2022).' : `Pajak belum dihitung: estimasi PPh Final UMKM 0,5% × pendapatan ≈ ${fmtRp(s.total_revenue * MACRO.tax.pphFinal)} (PP 55/2022).`)
  else recs.push('Pajak belum dihitung: PPh Badan dihitung tahunan atas laba fiskal.')
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

/* ===================================================== Ringkasan & laporan MD */

const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(4)))

function macroSummary() {
  return {
    note: 'ASUMSI PERENCANAAN untuk data demo, bukan angka resmi. Verifikasi: PDB/PDRB riil & inflasi IHK → BRS BPS (bps.go.id); UMK → SK Gubernur; pajak → PP 55/2022, UU HPP, Pasal 31E UU PPh.',
    real_gdp_national: MACRO.realGdp,
    cpi: MACRO.cpi,
    nominal_national: r4(nominalOf(MACRO.realGdp)),
    service_price_jan: MACRO.servicePriceJan,
    service_price_mid: MACRO.servicePriceMid,
    contract_escalation: MACRO.contractEsc,
    umk_step: MACRO.umkStep,
    umk_year0: MACRO.year0,
    labour_all_in: MACRO.allIn,
    labour_all_in_parts: { bpjs: MACRO.allInParts.bpjs, thr: r4(MACRO.allInParts.thr), other: MACRO.allInParts.other },
    materials_inflation: MACRO.materials,
    fuel_inflation: MACRO.fuel,
    rent_step: MACRO.rentStep,
    software_step: MACRO.softwareStep,
    overtime_multiplier: MACRO.overtime,
    tax: MACRO.tax,
    profiles: PROFILES,
    regions: Object.values(REG).map((x) => ({ key: x.key, name: x.name, profile: x.profile, real: x.real, cpi: x.cpi, nominal: r4(x.nominal), umk_year0: x.umk, umk_next: Math.round(x.umk * (1 + MACRO.umkStep)), used_by: BUSINESSES.filter((b) => b.regions.some((y) => y.key === x.key)).map((b) => b.key) })),
  }
}

function bizSummary(sim, an) {
  const b = sim.biz
  return {
    k: b.k, key: b.key, name: b.name, scale: b.scale, email: b.email, owner_id: ownerId(b.k), industry: b.industry,
    regions: b.regions.map((x) => ({ key: x.key, name: x.name, profile: x.profile, real: x.real, nominal: r4(x.nominal), umk_year0: x.umk, open_month_index: x.open < -50 ? null : x.open })),
    g_model: r4(sim.g), trend_g: r4(an.trendG), cmgr: r4(an.cmgr), cmgr_deseasonalised: r4(an.cmgrDes), cagr_equivalent: r4(an.cagrEq), margin: r4(an.margin), in_band: an.ok,
    growth: {
      note: 'Target bisnis = pertumbuhan pendapatan NOMINAL desesonal. nominal = (1 + volume riil) × (1 + harga) − 1.',
      nominal_trend_g: r4(an.trendG), real_volume_g: r4(an.realG), price_contribution_g: r4(an.priceG),
      price_share_of_growth: r4(Math.log(1 + an.priceG) / Math.log(1 + an.trendG)),
      price_index_change_window: r4(an.priceIdxChange), price_jan_step: r4(sim.macro.price_jan_step), price_mid_step: r4(sim.macro.price_mid_step),
      market_real_g: r4(an.marketReal), market_nominal_g: r4(an.marketNominal), share_gain_g: r4(an.shareGain),
      real_cagr_equivalent: r4(an.realCagrEq),
    },
    volatility: { cv: r4(an.cv), cv_raw: r4(an.cvRaw), cv_noise: r4(an.cvNoise), mom_abs_mean: r4(an.momAbs), band: SCALE[b.scale].cvBand, ok: an.cvOk, definition: 'cv = deviasi standar residual ln(pendapatan bulanan) terhadap garis tren log-linear (musim + derau, tanpa pertumbuhan); cv_raw = stdev/mean pendapatan bulanan; cv_noise = residual setelah koreksi musim.' },
    profit: {
      revenue: an.totRev, cost: an.totCost, profit_pre_tax: an.totRev - an.totCost, margin_pre_tax: r4(an.margin),
      tax_estimate: Math.round(an.totTax), profit_after_tax_estimate: Math.round(an.totRev - an.totCost - an.totTax), margin_after_tax_estimate: r4(an.marginAfter),
      tax_method: an.tax.method, tax_effective_rate: an.tax.eff == null ? null : r4(an.tax.eff), annual_turnover_estimate: Math.round(an.tax.annual_turnover),
      tax_in_ledger: false,
    },
    cost_structure: { ...Object.fromEntries(Object.entries(an.costShare).map(([k, v]) => [k, r4(v)])), margin_first_quarter: r4(an.marginFirstQ), margin_last_quarter: r4(an.marginLastQ) },
    labour: { mode: sim.lab.mode, headcount_start: an.headStart, headcount_end: an.headEnd, all_in_monthly: r4(sim.macro.all_in_monthly), umk_primary_region_year0: sim.macro.umk_primary_region },
    customers: sim.custCount, contracts_total: sim.contracts, contracts_active: sim.activeContracts,
    rows: rowCounts(sim),
    months: an.months.map((m) => ({
      month: m.key, full: m.full, revenue: m.rev, real_revenue: Math.round(m.real), contract_revenue: m.revContract, cost: m.cost, profit: m.rev - m.cost,
      tax_estimate: Math.round(m.tax), profit_after_tax: Math.round(m.rev - m.cost - m.tax),
      fixed_cost: Math.round(Object.entries(m.ck).filter(([k]) => !k.endsWith('|var')).reduce((s, [, v]) => s + v, 0)),
      variable_cost: Math.round(Object.entries(m.ck).filter(([k]) => k.endsWith('|var')).reduce((s, [, v]) => s + v, 0)),
      jobs: m.jobs, headcount: m.lab.heads, utilisation: r4(m.lab.util), overtime_fte: m.lab.overtime_fte == null ? undefined : r4(m.lab.overtime_fte), headcount_by_region: m.lab.by_region,
      price_index: r4(m.P), wage_index: r4(m.W),
      mom: r4(m.mom), mom_deseasonalised: r4(m.momDes), seasonal_index: Number(m.SI.toFixed(3)),
    })),
    region_share_first: an.regFirst, region_share_last: an.regLast,
  }
}

/* ---- Markdown (dibuat dari objek ringkasan; tidak membaca data simulasi lain) */
const idNum = (x, d = 1) => (x == null ? '–' : x.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }))
const idPct = (x, d = 1, sign = false) => (x == null ? '–' : `${sign && x >= 0 ? '+' : ''}${idNum(x * 100, d)}%`)
const idRp = (n) => {
  if (n == null) return '–'
  if (Math.round(n) === 0) return 'Rp0'
  const a = Math.abs(n)
  const s = a >= 1e9 ? `${idNum(a / 1e9, 2)} M` : a >= 1e6 ? `${idNum(a / 1e6, 1)} jt` : `${idNum(a / 1e3, 0)} rb`
  return `${n < 0 ? '−' : ''}Rp${s}`
}
const SCALE_LABEL = { sole: 'Sole', ukm: 'UKM', enterprise: 'Enterprise' }
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const mon = (key) => `${BLN[Number(key.slice(5, 7)) - 1]}-${key.slice(2, 4)}`

function renderReport(S) {
  const g = S.generated_with
  const M = S.macro
  const B = S.businesses
  const L = []
  const t = (head, rows) => {
    L.push(`| ${head.join(' | ')} |`)
    L.push(`|${head.map(() => '---').join('|')}|`)
    for (const r of rows) L.push(`| ${r.join(' | ')} |`)
    L.push('')
  }
  L.push('# Ringkasan Ekonomi Data Demo (dibuat otomatis)')
  L.push('')
  L.push('> **Jangan diedit manual.** Berkas ini dibuat oleh `node scripts/seed-demo.mjs --report md` dari objek ringkasan yang sama dengan `seeds/demo-summary.json`, sehingga angka di sini selalu sama dengan data seed. Untuk membuat ulang tanpa simulasi: `node scripts/seed-demo.mjs --report md --from-summary seeds/demo-summary.json`.')
  L.push('')
  L.push(`Parameter: ${g.lean ? 'mode lean, ' : ''}${g.months} bulan s.d. ${g.end}, as-of ${g.asof}, seed ${g.seed}${g.only ? `, hanya ${g.only.join(', ')}` : ''}. Semua data **DUMMY**. Penjelasan model: [2026-10-28-demo-growth-data-design.md](../2026-10-28-demo-growth-data-design.md).`)
  L.push('')
  L.push('## 1. Asumsi makro')
  L.push('')
  L.push(`${M.note}`)
  L.push('')
  t(['Parameter', 'Nilai', 'Dipakai untuk'], [
    ['PDB riil nasional', `${idPct(M.real_gdp_national)}/th`, 'Pembanding pertumbuhan wilayah (riil)'],
    ['Inflasi IHK', `${idPct(M.cpi)}/th`, 'Nominal wilayah = (1 + riil) × (1 + IHK) − 1; indeks biaya umum'],
    ['Pertumbuhan nominal nasional', `${idPct(M.nominal_national, 2)}/th`, 'Bobot wilayah enterprise (kemiringan relatif)'],
    ['Kenaikan tarif jasa Januari', Object.entries(M.service_price_jan).map(([k, v]) => `${SCALE_LABEL[k]} ${idPct(v[0], 0)}–${idPct(v[1], 0)}`).join('; '), 'Harga tiket jasa ad-hoc'],
    ['Penyesuaian tarif pertengahan tahun', `peluang ${idPct(M.service_price_mid.p, 0)}, ${idPct(M.service_price_mid.pct[0], 0)}–${idPct(M.service_price_mid.pct[1], 0)} di ${BULAN[M.service_price_mid.month]}`, 'Harga tiket jasa ad-hoc'],
    ['Eskalasi kontrak non-UMK (Januari)', `${idPct(M.contract_escalation[0], 0)}–${idPct(M.contract_escalation[1], 0)}`, 'Kontrak pest, laundry, cleaning, FM cabang'],
    ['Kenaikan UMK (1 Januari)', idPct(M.umk_step), 'Gaji pekerja, tarif helper, kontrak per petugas'],
    ['Biaya tenaga all-in', `${idNum(M.labour_all_in, 2)} × UMK (BPJS ${idPct(M.labour_all_in_parts.bpjs)}, THR ${idPct(M.labour_all_in_parts.thr)}, lain ${idPct(M.labour_all_in_parts.other)})`, 'UKM: 1,167 × UMK per bulan + THR tunai saat Lebaran; enterprise: 1,25 × UMK diakrualkan'],
    ['Inflasi bahan/material', `${idPct(M.materials_inflation)}/th (bertahap)`, 'Biaya bahan per job'],
    ['Inflasi BBM/transport', `${idPct(M.fuel_inflation)}/th (bertahap)`, 'Transport per job, BBM armada'],
    ['Kenaikan sewa (Januari)', idPct(M.rent_step), 'Sewa kantor, gudang, outlet'],
    ['Lembur/harian di atas kapasitas', `${idNum(M.overtime_multiplier, 1)} × tarif normal`, 'Beban bulan puncak'],
    ['PPh Final UMKM (PP 55/2022)', `${idPct(M.tax.pphFinal)} peredaran bruto; batas Rp${idNum(M.tax.turnoverCap / 1e9, 1)} M/th; WP OP bebas Rp${M.tax.individualExempt / 1e6} jt pertama/th`, 'Estimasi pajak sole & UKM (tidak ditulis ke buku besar)'],
    ['PPh Badan (UU HPP)', `${idPct(M.tax.corporate, 0)}; Pasal 31E untuk peredaran ≤ Rp${M.tax.corp31eGross / 1e9} M`, 'Perkiraan kasar enterprise (tidak ditulis ke buku besar)'],
  ])
  L.push('## 2. Profil wilayah')
  L.push('')
  t(['Kode', 'Wilayah', 'Profil', 'PDRB riil/th', 'IHK/th', 'Nominal/th', `UMK ${M.umk_year0} (perkiraan)`, `UMK ${M.umk_year0 + 1} (×${idNum(1 + M.umk_step, 3)})`, 'Dipakai oleh'],
    M.regions.map((x) => [x.key, x.name, x.profile, idPct(x.real), idPct(x.cpi), idPct(x.nominal, 2), idRp(x.umk_year0), idRp(x.umk_next), x.used_by.join(', ') || '(belum dipakai)']))
  L.push('UMK dibulatkan ke Rp0,1 jt dan merupakan **perkiraan**; nilai resmi ada di SK Gubernur masing-masing provinsi. Pertumbuhan riil wilayah adalah asumsi; cek BRS PDRB BPS.')
  L.push('')
  L.push('## 3. Hasil per usaha')
  L.push('')
  L.push('Semua persentase pertumbuhan adalah **per bulan**, dihitung dari bulan penuh dengan regresi log-linear setelah koreksi musim. Target bisnis (sole/UKM 1–2%/bln, enterprise 5–10%/bln) adalah target **nominal**.')
  L.push('')
  t(['Akun', 'Skala', 'Tren nominal', 'Volume riil', 'Kontribusi harga (porsi)', 'CV', 'Margin sebelum pajak', 'Margin setelah pajak (est.)', 'Headcount awal→akhir', 'Band'],
    B.map((b) => [b.key, SCALE_LABEL[b.scale], idPct(b.growth.nominal_trend_g, 2, true), idPct(b.growth.real_volume_g, 2, true), `${idPct(b.growth.price_contribution_g, 2, true)} (${idPct(b.growth.price_share_of_growth, 0)})`, idPct(b.volatility.cv), idPct(b.profit.margin_pre_tax), idPct(b.profit.margin_after_tax_estimate), `${b.labour.headcount_start} → ${b.labour.headcount_end}`, b.in_band ? 'OK' : '**DI LUAR BAND**']))
  L.push('## 4. Dekomposisi pertumbuhan')
  L.push('')
  L.push('`nominal ≈ (1 + volume riil) × (1 + harga) − 1`. Volume riil = pendapatan dideflasi dengan indeks harga yang melekat di tiap tagihan (tarif jasa, atau UMK untuk kontrak per petugas). Pasar wilayah = PDRB riil wilayah per bulan, ditimbang pangsa pendapatan. Tambahan pangsa = volume riil di atas pertumbuhan pasar.')
  L.push('')
  t(['Akun', 'g model (nominal)', 'Tren nominal', 'Harga', 'Kenaikan tarif Jan / pertengahan th', 'Volume riil', 'Pasar wilayah riil', 'Tambahan pangsa', 'Setara tahunan nominal / riil', 'CMGR mentah'],
    B.map((b) => [b.key, idPct(b.g_model, 2), idPct(b.growth.nominal_trend_g, 2), idPct(b.growth.price_contribution_g, 2), `${idPct(b.growth.price_jan_step, 1)} / ${b.growth.price_mid_step ? idPct(b.growth.price_mid_step, 1) : '–'}`, idPct(b.growth.real_volume_g, 2), idPct(b.growth.market_real_g, 2), idPct(b.growth.share_gain_g, 2), `${idPct(b.cagr_equivalent, 0)} / ${idPct(b.growth.real_cagr_equivalent, 0)}`, idPct(b.cmgr, 2)]))
  L.push('## 5. Volatilitas bulanan')
  L.push('')
  t(['Akun', 'CV sekitar tren', 'Band', 'CV mentah (stdev/mean)', 'Derau setelah koreksi musim', 'Rata-rata MoM absolut'],
    B.map((b) => [b.key, idPct(b.volatility.cv), b.volatility.band ? `${idPct(b.volatility.band[0], 0)}–${idPct(b.volatility.band[1], 0)}` : '–', idPct(b.volatility.cv_raw), idPct(b.volatility.cv_noise), idPct(b.volatility.mom_abs_mean)]))
  L.push(`Definisi: ${B[0]?.volatility.definition || ''} CV mentah enterprise besar karena tren 5–10%/bln ikut terhitung.`)
  L.push('')
  L.push('## 6. Struktur biaya (porsi pendapatan, bulan penuh)')
  L.push('')
  t(['Akun', 'Tenaga (tetap / variabel)', 'Bahan', 'Transport', 'Lain-lain', 'Biaya variabel', 'Tetap + semi-tetap', 'Margin kuartal pertama → terakhir'],
    B.map((b) => { const c = b.cost_structure; return [b.key, `${idPct(c.labour)} (${idPct(c.labour_fixed)} / ${idPct(c.labour_variable)})`, idPct(c.materials), idPct(c.transport), idPct(c.other), idPct(c.variable), `${idPct(c.fixed + c.semi_fixed)}`, `${idPct(c.margin_first_quarter)} → ${idPct(c.margin_last_quarter)}`] }))
  L.push('Tenaga tetap = gaji pekerja tetap (headcount × UMK × all-in), staf, dan THR. Tenaga variabel = helper harian per job (sole) dan lembur/harian saat beban melebihi kapasitas. Kenaikan margin dari kuartal pertama ke terakhir menunjukkan *operating leverage* biaya tetap.')
  L.push('')
  L.push('## 7. Laba sebelum dan setelah pajak (estimasi)')
  L.push('')
  t(['Akun', 'Pendapatan', 'Biaya', 'Laba sebelum pajak', 'Estimasi pajak', 'Laba setelah pajak (est.)', 'Peredaran setahun (est.)', 'Metode'],
    B.map((b) => { const p = b.profit; return [b.key, idRp(p.revenue), idRp(p.cost), `${idRp(p.profit_pre_tax)} (${idPct(p.margin_pre_tax)})`, idRp(p.tax_estimate), `${idRp(p.profit_after_tax_estimate)} (${idPct(p.margin_after_tax_estimate)})`, idRp(p.annual_turnover_estimate), p.tax_method] }))
  L.push('Pajak **tidak** ditulis ke buku besar: aplikasi melabeli pendapatan − biaya sebagai "Laba sebelum pajak", dan `LEDGER_CATEGORIES` belum punya kategori pajak.')
  L.push('')
  L.push('## 8. Kapasitas: headcount per bulan')
  L.push('')
  const keys = B[0]?.months.map((m) => m.month) || []
  t(['Akun', ...keys.map(mon)], B.map((b) => [b.key, ...b.months.map((m) => String(m.headcount))]))
  L.push('Sole: owner + helper aktif. UKM: pekerja lapangan tetap (tidak termasuk admin/staf). Enterprise: petugas kontrak + pekerja tetap ad-hoc di semua wilayah (tidak termasuk kantor pusat).')
  L.push('')
  t(['Akun', ...keys.map(mon)], B.map((b) => [b.key, ...b.months.map((m) => idPct(m.utilisation, 0))]))
  L.push('Utilisasi = beban kerja (FTE) ÷ headcount. Di atas 100% berarti lembur/harian.')
  L.push('')
  L.push('## 9. Indeks musiman (SI)')
  L.push('')
  t(['Akun', ...keys.map(mon)], B.map((b) => [b.key, ...b.months.map((m) => idNum(m.seasonal_index, 2))]))
  if (B.some((b) => b.regions.length > 1)) {
    L.push('## 10. Pangsa wilayah (bulan penuh pertama → terakhir)')
    L.push('')
    const fmtS = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${idPct(v, 0)}`).join(', ')
    t(['Akun', 'Awal', 'Akhir'], B.filter((b) => b.regions.length > 1).map((b) => [b.key, fmtS(b.region_share_first), fmtS(b.region_share_last)]))
  }
  L.push('## 11. Bulanan per usaha')
  L.push('')
  for (const b of B) {
    L.push(`### ${b.k}. ${b.key}: ${b.name}`)
    L.push('')
    t(['Bulan', 'Pendapatan', 'Riil (harga awal)', 'Biaya', 'Laba sblm pajak', 'Margin', 'Pajak est.', 'Laba stlh pajak est.', 'MoM', 'MoM desesonal', 'Job', 'Org', 'Indeks harga'],
      b.months.map((m) => [`${mon(m.month)}${m.full ? '' : '*'}`, idRp(m.revenue), idRp(m.real_revenue), idRp(m.cost), idRp(m.profit), idPct(m.revenue ? m.profit / m.revenue : null), idRp(m.tax_estimate), idRp(m.profit_after_tax), idPct(m.mom, 1, true), idPct(m.mom_deseasonalised, 1, true), String(m.jobs), String(m.headcount), idNum(m.price_index, 3)]))
  }
  L.push('\\* Bulan berjalan, terpotong di as-of: tidak ikut MoM, regresi tren, maupun total.')
  L.push('')
  return L.join('\n')
}

function writeReport(summary, path, log = console.log) {
  const p = resolve(path)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, renderReport(summary))
  log(`Ringkasan ekonomi MD: ${p}`)
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

/* ===================================================== Estimasi tulis D1 */
// D1 menagih "rows written" = baris tabel + setiap entri indeks yang ikut berubah.
// Jumlah indeks dibaca dari migrations/ (CREATE/DROP INDEX), ditambah autoindex
// untuk PRIMARY KEY bertipe TEXT dan kolom UNIQUE.
const DOMAIN_TABLES = ['requests', 'offers', 'assignments', 'completions', 'ledger_entries', 'reports']
const AUTOINDEX = { users: 2, sessions: 1, otp_codes: 1 }

function loadWriteModel() {
  const idx = new Map()
  let source = 'migrations/'
  try {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve(dir, f), 'utf8').replace(/--.*$/gm, '')
      for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)/gi)) idx.set(m[1], m[2])
      for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(\w+)/gi)) idx.delete(m[1])
    }
  } catch {
    source = 'default (migrations/ tidak terbaca)'
    for (const t of [...DOMAIN_TABLES, 'social_contents', 'social_schedules', 'ai_messages']) idx.set(`idx_${t}_owner_id`, t)
  }
  const perTable = {}
  for (const t of idx.values()) perTable[t] = (perTable[t] || 0) + 1
  const wpr = (t) => 1 + (perTable[t] || 0) + (AUTOINDEX[t] || 0)
  return { wpr, perTable, source }
}

/** Biaya tulis satu usaha: insert baru + hapus baris lama + upsert user. */
function bizWrites(rows, existing, wm) {
  let ins = 0
  let del = 0
  for (const t of DOMAIN_TABLES) {
    ins += (rows[t] || 0) * wm.wpr(t)
    del += (existing?.[t] || 0) * wm.wpr(t)
  }
  const user = wm.wpr('users') + 1 // INSERT OR IGNORE (kasus terburuk) + UPDATE name
  return { ins, del, user, total: ins + del + user }
}

const normKey = (v) => String(v || '').trim().toLowerCase().replace(/@.*$/, '').replace(/^demo-/, '')

/** --existing-counts: output `wrangler d1 execute --json`, demo-summary.json lama, objek per akun, atau total datar. */
function loadExisting(path, list, fallback) {
  const raw = JSON.parse(readFileSync(resolve(path), 'utf8'))
  const out = {}
  const pickRow = (r) => Object.fromEntries(DOMAIN_TABLES.map((t) => [t, Number(r?.[t]) || 0]))
  if (Array.isArray(raw)) {
    for (const r of raw.flatMap((x) => x.results || [])) out[normKey(r.email || r.key)] = pickRow(r)
  } else if (Array.isArray(raw.businesses)) {
    for (const b of raw.businesses) out[normKey(b.key || b.email)] = pickRow(b.rows)
  } else if (DOMAIN_TABLES.some((t) => typeof raw[t] === 'number')) {
    // total datar: dibagi proporsional terhadap seed penuh
    const tot = Object.fromEntries(DOMAIN_TABLES.map((t) => [t, list.reduce((s, b) => s + (fallback[b.key]?.[t] || 0), 0)]))
    for (const b of list) out[b.key] = Object.fromEntries(DOMAIN_TABLES.map((t) => [t, tot[t] ? Math.round(((fallback[b.key]?.[t] || 0) / tot[t]) * raw[t]) : 0]))
  } else {
    for (const [k, v] of Object.entries(raw)) out[normKey(k)] = pickRow(v)
  }
  return Object.fromEntries(list.map((b) => [b.key, out[b.key] || Object.fromEntries(DOMAIN_TABLES.map((t) => [t, 0]))]))
}

function generate(biz, ctx, lean) {
  const b = lean ? applyLean(biz) : biz
  let sim
  let an
  for (let attempt = 0; attempt < 40; attempt++) {
    const c2 = { ...ctx, lean, months: freshMonths(ctx) }
    sim = simulateBusiness(b, c2, attempt)
    an = analyse(sim, c2)
    if (an.ok) break
  }
  buildReports(sim, ctx)
  return { sim, an }
}

/** SQL untuk sekumpulan usaha (hapus data lama → user → insert). */
function buildSql(results, args, ctx, note) {
  const list = results.map((x) => x.sim.biz)
  const out = []
  const allIds = list.map((b) => `'${ownerId(b.k)}'`).join(', ')
  const allEmails = list.map((b) => `'${b.email}'`).join(', ')
  out.push('-- =====================================================================')
  out.push('-- Satu Alur: DATA DEMO (DUMMY). Semua pelanggan, telepon, alamat, dan angka FIKTIF.')
  out.push(`-- Dibuat oleh scripts/seed-demo.mjs${args.lean ? ' --lean' : ''} --months ${args.months} --end ${args.end} --asof ${new Date(ctx.asof).toISOString()} --seed ${args.seed}`)
  out.push(`-- Usaha: ${list.map((b) => b.email).join(', ')}`)
  if (note) out.push(`-- ${note}`)
  out.push('-- Aman dijalankan ulang: menghapus dulu seluruh data milik akun demo di file ini lalu mengisi ulang.')
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
  for (const b of list) out.push(`UPDATE users SET name = ${sqlVal(b.name)} WHERE id = ${sqlVal(ownerId(b.k))} AND name IS NOT ${sqlVal(b.name)};`)
  out.push('')
  const counts = {}
  let stmts = 0
  for (const t of DOMAIN_TABLES) {
    const rows = results.flatMap((x) => x.sim.rows[t]).sort((a, b) => a.id - b.id)
    counts[t] = rows.length
    out.push(`-- ${t}: ${rows.length} baris`)
    stmts += emitInserts(out, t, rows)
    out.push('')
  }
  return { sql: `${out.join('\n')}\n`, counts, stmts }
}

const fmtN = (n) => Math.round(n).toLocaleString('id-ID')
const rowCounts = (sim) => Object.fromEntries(DOMAIN_TABLES.map((t) => [t, sim.rows[t].length]))
const sumRows = (o) => DOMAIN_TABLES.reduce((s, t) => s + (o?.[t] || 0), 0)

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.fromSummary) {
    writeReport(JSON.parse(readFileSync(resolve(args.fromSummary), 'utf8')), args.reportOut)
    return
  }
  const ctx = buildContext(args)
  const list = args.only ? BUSINESSES.filter((b) => args.only.includes(b.key)) : BUSINESSES
  if (!list.length) throw new Error('--only tidak cocok dengan usaha mana pun (pakai mis. demo-ac,demo-rs)')
  const missing = (args.only || []).filter((k) => !BUSINESSES.some((b) => b.key === k))
  if (missing.length) throw new Error(`--only tidak dikenal: ${missing.join(', ')}`)
  const results = list.map((biz) => generate(biz, ctx, args.lean))

  /* ---- estimasi tulis */
  const wm = loadWriteModel()
  // Baris lama per usaha: dari --existing-counts, atau diasumsikan seed PENUH sebelumnya (parameter sama).
  const fullCounts = Object.fromEntries(list.map((biz, i) => [biz.key, args.lean ? rowCounts(generate(biz, ctx, false).sim) : rowCounts(results[i].sim)]))
  const existing = args.existing ? loadExisting(args.existing, list, fullCounts) : fullCounts
  const existingSrc = args.existing ? args.existing : 'asumsi: seed penuh sebelumnya (parameter yang sama)'
  const per = results.map(({ sim }) => ({ sim, rows: rowCounts(sim), w: bizWrites(rowCounts(sim), existing[sim.biz.key], wm), wFresh: bizWrites(rowCounts(sim), null, wm) }))

  /* ---- bagi ke N file (bin-packing usaha utuh) */
  const N = Math.min(args.split, per.length)
  const bins = Array.from({ length: N }, () => ({ items: [], writes: 0 }))
  for (const it of [...per].sort((a, b) => b.w.total - a.w.total)) {
    const bin = bins.reduce((x, y) => (y.writes < x.writes ? y : x))
    bin.items.push(it)
    bin.writes += it.w.total
  }
  for (const b of bins) b.items.sort((x, y) => x.sim.biz.k - y.sim.biz.k)
  const outBase = resolve(args.out)
  const files = []
  let totalStmts = 0
  let totalBytes = 0
  bins.forEach((bin, i) => {
    const path = N === 1 ? outBase : outBase.replace(/\.sql$/i, '') + `.part${i + 1}of${N}.sql`
    const note = `Perkiraan D1 rows written file ini: ${fmtN(bin.writes)} (hapus ${fmtN(bin.items.reduce((s, x) => s + x.w.del, 0))} + insert ${fmtN(bin.items.reduce((s, x) => s + x.w.ins + x.w.user, 0))}).${N > 1 ? ` File ${i + 1} dari ${N}; terapkan di hari yang berbeda.` : ''}`
    const { sql, counts, stmts } = buildSql(bin.items.map((x) => results.find((r) => r.sim === x.sim)), args, ctx, note)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, sql)
    totalStmts += stmts
    totalBytes += Buffer.byteLength(sql)
    files.push({ path, writes: bin.writes, bytes: Buffer.byteLength(sql), rows: sumRows(counts), stmts, businesses: bin.items.map((x) => x.sim.biz.key) })
  })

  /* ---- ringkasan */
  const counts = Object.fromEntries(DOMAIN_TABLES.map((t) => [t, per.reduce((s, x) => s + x.rows[t], 0)]))
  const totalRows = sumRows(counts)
  const log = (...a) => { if (!args.quiet) console.log(...a) }
  log(`\nSatu Alur demo seed${args.lean ? ' [LEAN]' : ''} — as-of ${new Date(ctx.asof).toISOString()} (WIB ${new Date(ctx.asof + 7 * HOUR).toISOString().slice(0, 16).replace('T', ' ')})`)
  const summary = { generated_with: { lean: args.lean, months: args.months, end: args.end, asof: new Date(ctx.asof).toISOString(), seed: args.seed, only: args.only, split: N }, macro: macroSummary(), businesses: [], counts, total_rows: totalRows, sql_bytes: totalBytes, statements: totalStmts }
  for (const { sim, an } of results) {
    const b = sim.biz
    log(`\n[${b.k}] ${b.name} — ${b.industry} (${b.scale}) · ${b.email}`)
    log(`    g model ${(sim.g * 100).toFixed(2)}%/bln · tarif Jan +${(sim.macro.price_jan_step * 100).toFixed(1)}%${sim.macro.price_mid_step ? `, Jul +${(sim.macro.price_mid_step * 100).toFixed(1)}%` : ''} · attempt ${sim.attempt} · pelanggan ${sim.custCount}${sim.contracts ? ` · kontrak ${sim.activeContracts} aktif/${sim.contracts} total` : ''} · ${fmtN(sumRows(rowCounts(sim)))} baris`)
    log(`    ${pad('Bulan', 15)}${pad('Pendapatan', 12, true)}${pad('Biaya', 12, true)}${pad('Laba', 12, true)}${pad('Margin', 8, true)}${pad('MoM', 9, true)}${pad('MoM-des', 9, true)}${pad('Job', 6, true)}${pad('Org', 5, true)}${pad('Idx P', 7, true)}`)
    for (const m of an.months) {
      const mg = m.rev ? (m.rev - m.cost) / m.rev : 0
      log(`    ${pad(m.label + (m.full ? '' : '*'), 15)}${pad(fmtJt(m.rev), 12, true)}${pad(fmtJt(m.cost), 12, true)}${pad(fmtJt(m.rev - m.cost), 12, true)}${pad((mg * 100).toFixed(1) + '%', 8, true)}${pad(pct(m.mom), 9, true)}${pad(pct(m.momDes), 9, true)}${pad(m.jobs, 6, true)}${pad(m.lab.heads, 5, true)}${pad(m.P.toFixed(3), 7, true)}`)
    }
    log(`    Tren desesonal NOMINAL ${pct(an.trendG)}/bln (band ${(an.band[0] * 100).toFixed(0)}–${(an.band[1] * 100).toFixed(0)}%) = volume riil ${pct(an.realG)} + harga ${pct(an.priceG)} · pasar wilayah riil ${pct(an.marketReal)}/bln · CMGR mentah ${pct(an.cmgr)} · setara tahunan ${pct(an.cagrEq)}`)
    log(`    CV sekitar tren ${(an.cv * 100).toFixed(1)}%${SCALE[b.scale].cvBand ? ` (band ${SCALE[b.scale].cvBand.map((x) => x * 100).join('–')}%)` : ''} · CV mentah ${(an.cvRaw * 100).toFixed(1)}% · derau desesonal ${(an.cvNoise * 100).toFixed(1)}% · headcount ${an.headStart}→${an.headEnd}`)
    log(`    Margin sebelum pajak ${(an.margin * 100).toFixed(1)}% (target ${(b.margin[0] * 100).toFixed(0)}–${(b.margin[1] * 100).toFixed(0)}%) · pajak est. ${fmtJt(an.totTax)} · setelah pajak est. ${(an.marginAfter * 100).toFixed(1)}% · tenaga ${(an.costShare.labour * 100).toFixed(0)}% · bahan ${(an.costShare.materials * 100).toFixed(0)}% · tetap+semi ${((an.costShare.fixed + an.costShare.semi_fixed) * 100).toFixed(0)}% → ${an.ok ? 'OK' : 'DI LUAR BAND'}`)
    if (b.regions.length > 1) {
      const fmtS = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')
      log(`    Pangsa wilayah: ${an.months.find((x) => x.full).label}: ${fmtS(an.regFirst)}`)
      log(`                    ${an.months.filter((x) => x.full).pop().label}: ${fmtS(an.regLast)}`)
    }
    summary.businesses.push(bizSummary(sim, an))
  }
  log(`\nBaris insert: ${Object.entries(counts).map(([k, v]) => `${k} ${fmtN(v)}`).join(' · ')} · total ${fmtN(totalRows)} (+${list.length} users)`)
  for (const f of files) log(`SQL: ${f.path} · ${(f.bytes / 1e6).toFixed(2)} MB · ${f.stmts} INSERT · ${fmtN(f.rows)} baris · ±${fmtN(f.writes)} writes · ${f.businesses.join(', ')}`)
  log(`(≤${MAX_ROWS} baris dan ≤${MAX_STMT_BYTES / 1000} KB per statement)`)

  // Estimasi rows written D1
  const sumW = (k) => per.reduce((s, x) => s + x.w[k], 0)
  const fresh = per.reduce((s, x) => s + x.wFresh.total, 0)
  const total = sumW('total')
  log(`\nEstimasi D1 rows written (indeks dari ${wm.source}: ${DOMAIN_TABLES.map((t) => `${t} ×${wm.wpr(t)}`).join(', ')}, users ×${wm.wpr('users')})`)
  log(`    ${pad('Akun', 14)}${pad('Baris baru', 12, true)}${pad('Insert', 10, true)}${pad('Baris lama', 12, true)}${pad('Hapus', 10, true)}${pad('Total', 10, true)}`)
  for (const x of per) log(`    ${pad(x.sim.biz.key, 14)}${pad(fmtN(sumRows(x.rows)), 12, true)}${pad(fmtN(x.w.ins + x.w.user), 10, true)}${pad(fmtN(sumRows(existing[x.sim.biz.key])), 12, true)}${pad(fmtN(x.w.del), 10, true)}${pad(fmtN(x.w.total), 10, true)}`)
  log(`    ${pad('TOTAL', 14)}${pad(fmtN(totalRows), 12, true)}${pad(fmtN(sumW('ins') + sumW('user')), 10, true)}${pad(fmtN(per.reduce((s, x) => s + sumRows(existing[x.sim.biz.key]), 0)), 12, true)}${pad(fmtN(sumW('del')), 10, true)}${pad(fmtN(total), 10, true)}`)
  log(`    Baris lama: ${existingSrc}. Bila DB kosong (tanpa hapus): ±${fmtN(fresh)} writes.`)
  summary.write_estimate = { model: Object.fromEntries([...DOMAIN_TABLES, 'users'].map((t) => [t, wm.wpr(t)])), existing_source: existingSrc, existing, insert_writes: sumW('ins') + sumW('user'), delete_writes: sumW('del'), total_writes: total, fresh_db_writes: fresh, files: files.map((f) => ({ path: f.path, writes: f.writes, rows: f.rows, businesses: f.businesses })) }
  const loud = (msg) => console.error(`\n${'!'.repeat(78)}\n${msg}\n${'!'.repeat(78)}`)
  if (total > args.budget) loud(`PERINGATAN KUOTA D1: estimasi total ${fmtN(total)} rows written > ${fmtN(args.budget)}.\nFree tier D1 = 100.000 rows written/hari (reset 00:00 UTC). ${N > 1 && files.every((f) => f.writes <= args.perFile) ? `Sudah dibagi ke ${N} file (masing-masing ≤ ${fmtN(args.perFile)}): terapkan SATU file per hari, jangan sekaligus.` : 'Pakai --lean, --only, atau --split N dan terapkan per hari.'}`)
  for (const f of files) if (f.writes > args.perFile) loud(`PERINGATAN: ${f.path} ±${fmtN(f.writes)} writes > ${fmtN(args.perFile)} per file. Naikkan --split atau pakai --only.`)

  log('* = bulan berjalan (terpotong di as-of): tidak dihitung MoM dan tidak ikut regresi tren.')
  if (args.summary && args.summary !== 'none') {
    const sp = resolve(args.summary)
    mkdirSync(dirname(sp), { recursive: true })
    writeFileSync(sp, `${JSON.stringify(summary, null, 2)}\n`)
    log(`Ringkasan JSON: ${sp}`)
  }
  if (args.report === 'md') writeReport(summary, args.reportOut, log)
  if (results.some((x) => !x.an.ok)) {
    console.error('PERINGATAN: ada usaha di luar band pertumbuhan/margin.')
    process.exitCode = 2
  }
}

main()

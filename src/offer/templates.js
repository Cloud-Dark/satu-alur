/**
 * Offer templates ("Template penawaran"): the platform's ready-made offer types.
 * Admins manage them in Kantor; businesses only pick one in the offer wizard and
 * answer its questions. Shared by the browser, the mock cloud and the Worker.
 */

export const TEMPLATE_CATEGORIES = [
  { value: 'jasa', label: 'Jasa' },
  { value: 'barang', label: 'Barang' },
  { value: 'digital', label: 'Digital' },
  { value: 'konsultasi', label: 'Konsultasi' },
]
export const FIELD_TYPES = [
  { value: 'text', label: 'Teks' },
  { value: 'number', label: 'Angka' },
  { value: 'select', label: 'Pilihan' },
  { value: 'date', label: 'Tanggal' },
]
export const TEMPLATE_LIMITS = { name: 80, description: 400, fields: 12, label: 80, options: 12, option: 60, promptHint: 1000, terms: 600, answer: 300, maxPrice: 1_000_000_000 }

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}

const str = (v) => String(v ?? '').trim()
const slugKey = (label, i) => (str(label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `isian_${i + 1}`)

/** Validates and normalises the question list of a template. */
export function validateFields(input) {
  const list = Array.isArray(input) ? input : []
  if (list.length > TEMPLATE_LIMITS.fields) fail(`Maksimal ${TEMPLATE_LIMITS.fields} isian per template.`)
  const seen = new Set()
  return list.map((f, i) => {
    const label = str(f?.label)
    if (!label) fail(`Isian ke-${i + 1} belum punya label.`)
    if (label.length > TEMPLATE_LIMITS.label) fail(`Label isian ke-${i + 1} terlalu panjang.`)
    const type = FIELD_TYPES.some((t) => t.value === f?.type) ? f.type : fail(`Jenis isian "${label}" tidak dikenal.`)
    let key = str(f?.key) ? slugKey(f.key, i) : slugKey(label, i)
    while (seen.has(key)) key = `${key}_${i + 1}`
    seen.add(key)
    const out = { key, label, type, required: Boolean(f?.required) }
    if (type === 'select') {
      const opts = (Array.isArray(f?.options) ? f.options : String(f?.options || '').split(/\r?\n|,/))
        .map(str).filter(Boolean)
      if (opts.length < 2) fail(`Isian pilihan "${label}" butuh minimal 2 opsi.`)
      if (opts.length > TEMPLATE_LIMITS.options) fail(`Isian pilihan "${label}" maksimal ${TEMPLATE_LIMITS.options} opsi.`)
      out.options = [...new Set(opts.map((o) => o.slice(0, TEMPLATE_LIMITS.option)))]
    }
    return out
  })
}

const intOrNull = (v, label) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > TEMPLATE_LIMITS.maxPrice) fail(`${label} tidak valid.`)
  return Math.round(n)
}

/** Validates a whole template (create or full update). */
export function validateTemplate(input = {}) {
  const name = str(input.name)
  if (name.length < 2) fail('Nama template minimal 2 karakter.')
  if (name.length > TEMPLATE_LIMITS.name) fail(`Nama template maksimal ${TEMPLATE_LIMITS.name} karakter.`)
  const category = TEMPLATE_CATEGORIES.some((c) => c.value === input.category) ? input.category : fail('Pilih kategori template.')
  const description = str(input.description)
  if (description.length > TEMPLATE_LIMITS.description) fail('Deskripsi terlalu panjang.')
  const prompt_hint = str(input.prompt_hint)
  if (prompt_hint.length > TEMPLATE_LIMITS.promptHint) fail('Arahan untuk AI terlalu panjang.')
  const default_terms = str(input.default_terms)
  if (default_terms.length > TEMPLATE_LIMITS.terms) fail('Ketentuan bawaan terlalu panjang.')
  const price_hint_min = intOrNull(input.price_hint_min, 'Harga minimum')
  const price_hint_max = intOrNull(input.price_hint_max, 'Harga maksimum')
  if (price_hint_min !== null && price_hint_max !== null && price_hint_min > price_hint_max) fail('Harga minimum tidak boleh lebih besar dari harga maksimum.')
  const sort = Number.isInteger(Number(input.sort)) ? Number(input.sort) : 0
  return {
    name, category, description, fields: validateFields(input.fields), prompt_hint, default_terms,
    price_hint_min, price_hint_max, active: input.active === false || input.active === 0 ? 0 : 1, sort,
  }
}

/** Checks a business's answers against a template; returns { answers, errors }. */
export function validateAnswers(template, input = {}) {
  const answers = {}
  const errors = []
  for (const f of template?.fields || []) {
    const raw = str(input[f.key])
    if (!raw) {
      if (f.required) errors.push({ key: f.key, text: `${f.label} wajib diisi.` })
      continue
    }
    if (raw.length > TEMPLATE_LIMITS.answer) { errors.push({ key: f.key, text: `${f.label} terlalu panjang.` }); continue }
    if (f.type === 'number' && !Number.isFinite(Number(raw.replace(',', '.')))) { errors.push({ key: f.key, text: `${f.label} harus berupa angka.` }); continue }
    if (f.type === 'date' && Number.isNaN(new Date(raw).getTime())) { errors.push({ key: f.key, text: `${f.label} bukan tanggal yang valid.` }); continue }
    if (f.type === 'select' && !(f.options || []).includes(raw)) { errors.push({ key: f.key, text: `Pilih salah satu opsi untuk ${f.label}.` }); continue }
    answers[f.key] = raw
  }
  return { answers, errors }
}

const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`

/** The text block the offer agent gets about the chosen template and answers. */
export function templateContext(template, answers = {}) {
  if (!template) return ''
  const lines = [`Template penawaran: ${template.name} (${TEMPLATE_CATEGORIES.find((c) => c.value === template.category)?.label || template.category})`]
  if (template.description) lines.push(`Tentang template: ${template.description}`)
  const qa = (template.fields || []).filter((f) => answers[f.key]).map((f) => `- ${f.label}: ${answers[f.key]}`)
  if (qa.length) lines.push('Detail dari klien:', ...qa)
  if (template.prompt_hint) lines.push(`Arahan penyusunan: ${template.prompt_hint}`)
  if (template.price_hint_min || template.price_hint_max) {
    const lo = template.price_hint_min ? rp(template.price_hint_min) : null
    const hi = template.price_hint_max ? rp(template.price_hint_max) : null
    lines.push(`Kisaran harga wajar: ${lo && hi ? `${lo} – ${hi}` : lo ? `mulai ${lo}` : `hingga ${hi}`}`)
  }
  if (template.default_terms) lines.push(`Ketentuan bawaan (pakai sebagai dasar "terms"): ${template.default_terms}`)
  return lines.join('\n')
}

/** Built-in templates: seeded by migration 0018 and by the mock cloud. */
export const DEFAULT_TEMPLATES = [
  {
    name: 'Pengembangan website', category: 'digital', sort: 1,
    description: 'Website profil usaha, toko online, atau landing page.',
    fields: [
      { key: 'jenis', label: 'Jenis website', type: 'select', required: true, options: ['Profil usaha', 'Toko online', 'Landing page', 'Aplikasi web'] },
      { key: 'halaman', label: 'Perkiraan jumlah halaman', type: 'number', required: false },
      { key: 'fitur', label: 'Fitur utama', type: 'text', required: true },
      { key: 'tenggat', label: 'Tenggat', type: 'date', required: false },
    ],
    prompt_hint: 'Rinci tahapan: desain, pengembangan, uji, peluncuran. Sebutkan jumlah revisi, hosting/domain (termasuk atau tidak), dan masa dukungan.',
    default_terms: 'DP 50% saat mulai, 50% saat peluncuran. Termasuk 2 kali revisi desain. Dukungan perbaikan bug 30 hari.',
    price_hint_min: 3_000_000, price_hint_max: 45_000_000,
  },
  {
    name: 'Pengembangan agentic AI / chatbot', category: 'digital', sort: 2,
    description: 'Asisten AI untuk layanan pelanggan, penjualan, atau operasional.',
    fields: [
      { key: 'kanal', label: 'Kanal', type: 'select', required: true, options: ['WhatsApp', 'Website', 'Instagram', 'Internal tim'] },
      { key: 'tugas', label: 'Tugas yang diotomatiskan', type: 'text', required: true },
      { key: 'integrasi', label: 'Sistem yang perlu terhubung', type: 'text', required: false },
      { key: 'volume', label: 'Perkiraan percakapan per bulan', type: 'number', required: false },
    ],
    prompt_hint: 'Jelaskan alur agen, sumber pengetahuan, batasan jawaban, eskalasi ke manusia, dan biaya pemakaian AI bulanan terpisah dari biaya pembuatan.',
    default_terms: 'DP 40%, 40% saat uji coba, 20% saat serah terima. Biaya pemakaian AI ditagih bulanan sesuai pemakaian.',
    price_hint_min: 5_000_000, price_hint_max: 80_000_000,
  },
  {
    name: 'Servis & perawatan AC', category: 'jasa', sort: 3,
    description: 'Cuci, isi freon, perbaikan, atau kontrak perawatan AC.',
    fields: [
      { key: 'unit', label: 'Jumlah unit', type: 'number', required: true },
      { key: 'jenis', label: 'Jenis pekerjaan', type: 'select', required: true, options: ['Cuci rutin', 'Isi freon', 'Perbaikan', 'Bongkar pasang', 'Kontrak perawatan'] },
      { key: 'pk', label: 'Kapasitas (PK)', type: 'text', required: false },
    ],
    prompt_hint: 'Hitung per unit, sebutkan material (freon, sparepart) terpisah bila belum pasti, dan estimasi durasi kerja.',
    default_terms: 'Pembayaran setelah pekerjaan selesai. Garansi pengerjaan 30 hari.',
    price_hint_min: 75_000, price_hint_max: 15_000_000,
  },
  {
    name: 'Cleaning service', category: 'jasa', sort: 4,
    description: 'Pembersihan rumah, kantor, atau pasca renovasi.',
    fields: [
      { key: 'luas', label: 'Luas area (m²)', type: 'number', required: true },
      { key: 'jenis', label: 'Jenis pembersihan', type: 'select', required: true, options: ['Harian', 'Deep cleaning', 'Pasca renovasi', 'Kontrak bulanan'] },
      { key: 'frekuensi', label: 'Frekuensi', type: 'text', required: false },
    ],
    prompt_hint: 'Sebutkan jumlah petugas, durasi, perlengkapan dan bahan yang termasuk.',
    default_terms: 'DP 30%, pelunasan setelah pekerjaan diterima. Kontrak bulanan ditagih di awal bulan.',
    price_hint_min: 150_000, price_hint_max: 60_000_000,
  },
  {
    name: 'Laundry B2B (selimut & linen hotel)', category: 'jasa', sort: 5,
    description: 'Cuci linen untuk hotel, penginapan, dan kos.',
    fields: [
      { key: 'volume', label: 'Volume per minggu (kg)', type: 'number', required: true },
      { key: 'jenis', label: 'Jenis linen', type: 'text', required: true },
      { key: 'antar', label: 'Antar-jemput', type: 'select', required: true, options: ['Ya', 'Tidak'] },
    ],
    prompt_hint: 'Hitung per kg atau per potong, jadwal antar-jemput, waktu proses, dan penanganan noda/kerusakan.',
    default_terms: 'Tagihan mingguan, jatuh tempo 7 hari. Kerusakan akibat proses diganti sesuai nilai wajar.',
    price_hint_min: 500_000, price_hint_max: 50_000_000,
  },
  {
    name: 'Pengadaan barang', category: 'barang', sort: 6,
    description: 'Penawaran harga barang beserta pengiriman.',
    fields: [
      { key: 'barang', label: 'Nama barang & spesifikasi', type: 'text', required: true },
      { key: 'jumlah', label: 'Jumlah', type: 'number', required: true },
      { key: 'kirim', label: 'Lokasi pengiriman', type: 'text', required: false },
    ],
    prompt_hint: 'Rinci harga satuan, total, ongkos kirim, waktu pengiriman, dan garansi barang.',
    default_terms: 'Pembayaran 100% sebelum pengiriman, atau tempo 14 hari untuk pelanggan tetap. Harga berlaku 7 hari.',
    price_hint_min: 100_000, price_hint_max: 500_000_000,
  },
  {
    name: 'Konsultasi bisnis', category: 'konsultasi', sort: 7,
    description: 'Pendampingan strategi, keuangan, atau pemasaran.',
    fields: [
      { key: 'topik', label: 'Topik', type: 'text', required: true },
      { key: 'sesi', label: 'Jumlah sesi', type: 'number', required: true },
      { key: 'format', label: 'Format', type: 'select', required: false, options: ['Online', 'Tatap muka', 'Campuran'] },
    ],
    prompt_hint: 'Sebutkan keluaran tiap sesi, materi yang diterima klien, dan cara mengukur hasil.',
    default_terms: 'Pembayaran di muka per paket sesi. Penjadwalan ulang paling lambat 24 jam sebelumnya.',
    price_hint_min: 500_000, price_hint_max: 30_000_000,
  },
  {
    name: 'Desain grafis', category: 'digital', sort: 8,
    description: 'Logo, materi promosi, kemasan, atau konten media sosial.',
    fields: [
      { key: 'jenis', label: 'Jenis desain', type: 'select', required: true, options: ['Logo & identitas', 'Konten media sosial', 'Kemasan', 'Materi cetak'] },
      { key: 'jumlah', label: 'Jumlah desain', type: 'number', required: true },
      { key: 'tenggat', label: 'Tenggat', type: 'date', required: false },
    ],
    prompt_hint: 'Sebutkan jumlah konsep awal, revisi, format file akhir, dan hak penggunaan.',
    default_terms: 'DP 50%, pelunasan sebelum file akhir dikirim. Termasuk 3 kali revisi.',
    price_hint_min: 250_000, price_hint_max: 20_000_000,
  },
]

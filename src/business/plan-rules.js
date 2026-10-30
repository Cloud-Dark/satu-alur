// Pure validators + price formatting for subscription plans. Errors carry Indonesian text.

export const PERIODS = ['month', 'year', 'once', 'custom']
export const CTA_KINDS = ['signup', 'contact']
const SUFFIX = { month: 'per bulan', year: 'per tahun', once: 'sekali bayar', custom: '' }
const MAX_PRICE = 1_000_000_000

// Tagged so the worker turns only these into 400s (anything else is a real bug).
function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const str = (v) => (typeof v === 'string' ? v.trim() : '')
function text(v, label, max) {
  const s = str(v)
  if (s.length > max) fail(`${label} maksimal ${max} karakter.`)
  return s
}
const flag = (v, label) => {
  if (v === undefined) return null
  if (v === 0 || v === 1 || v === true || v === false) return Number(v)
  return fail(`${label} tidak valid.`)
}

/** { price, period } display strings: Rp349.000 / Kustom, and the period suffix or period_label. */
export function formatPrice(plan) {
  const price = plan.price_idr === null || plan.price_idr === undefined
    ? 'Kustom'
    : `Rp${new Intl.NumberFormat('id-ID').format(plan.price_idr)}`
  const label = str(plan.period_label)
  return { price, period: label || SUFFIX[plan.period] || '' }
}

/** The new order must list every existing plan id exactly once. Returns the ids. */
export function validateReorder(ids, existing) {
  if (!Array.isArray(ids) || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) fail('Urutan paket tidak valid.')
  if (ids.length !== existing.length || !existing.every((id) => ids.includes(id))) fail('Urutan harus memuat semua paket.')
  return ids
}

export function validatePlan(body) {
  const b = body && typeof body === 'object' ? body : {}
  const slug = str(b.slug)
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) fail('Slug 2-40 karakter: huruf kecil, angka, atau tanda hubung.')
  const name = text(b.name, 'Nama paket', 60)
  if (!name) fail('Nama paket wajib diisi.')

  let price = b.price_idr
  if (price === '' || price === undefined) price = null
  if (price !== null && (!Number.isInteger(price) || price < 0 || price > MAX_PRICE)) fail('Harga harus bilangan bulat 0 sampai 1.000.000.000, atau kosong untuk Kustom.')

  if (!PERIODS.includes(b.period)) fail('Periode tidak dikenal.')
  if (!CTA_KINDS.includes(b.cta_kind)) fail('Tombol harus mengarah ke daftar atau kontak.')
  const cta_label = text(b.cta_label, 'Teks tombol', 30)
  if (!cta_label) fail('Teks tombol wajib diisi.')

  if (b.limits !== undefined && !Array.isArray(b.limits)) fail('Format batasan tidak valid.')
  if (b.features !== undefined && !Array.isArray(b.features)) fail('Format fitur tidak valid.')
  const limits = b.limits || []
  if (limits.length > 6) fail('Maksimal 6 batas.')
  const features = b.features || []
  if (features.length > 12) fail('Maksimal 12 fitur.')
  if (b.sort !== undefined && !Number.isInteger(b.sort)) fail('Urutan harus bilangan bulat.')

  return {
    slug,
    name,
    tagline: text(b.tagline, 'Tagline', 160),
    price_idr: price,
    period: b.period,
    period_label: text(b.period_label, 'Label periode', 40),
    recommended: flag(b.recommended, 'Rekomendasi') ?? 0,
    badge: text(b.badge, 'Badge', 30),
    limits: limits.map((l) => ({ label: text(l?.label, 'Label batas', 30), value: text(l?.value, 'Nilai batas', 60) })).filter((l) => l.label && l.value),
    features: features.map((f) => text(f, 'Fitur', 100)).filter(Boolean),
    cta_label,
    cta_kind: b.cta_kind,
    sort: b.sort ?? 0,
    active: flag(b.active, 'Status aktif') ?? 1,
  }
}

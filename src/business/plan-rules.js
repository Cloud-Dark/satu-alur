// Pure validators + price formatting for subscription plans. Errors carry Indonesian text.
import { validateQuota, rupiah } from '../quota/rules.js'

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

/**
 * Enterprise: the top paket (slug 'enterprise'). Everything in Pro plus an NDA and an SLA, so it is sold
 * under contract: the button goes to the contact form, not to sign-up. Single source for migration
 * 0020_enterprise_plan.sql (tests/business-plans.test.mjs checks they match), scripts/seed-office.mjs and
 * the landing's built-in Enterprise card (src/landing/pricing.js).
 * Not the same as the "skala akun" Enterprise in plan-access.js, which staff set per user to open ERP integration.
 */
export const ENTERPRISE_PLAN = Object.freeze({
  slug: 'enterprise',
  name: 'Enterprise',
  tagline: 'Untuk operasi jasa berskala besar yang butuh kerahasiaan dan jaminan layanan tertulis.',
  price_idr: 3_512_172,
  period: 'month',
  period_label: 'per bulan',
  recommended: 0,
  badge: 'NDA + SLA',
  limits: [
    { label: 'Pengguna', value: 'Tanpa batas' },
    { label: 'Transaksi', value: 'Tanpa batas' },
    { label: 'Penawaran AI', value: 'Tanpa batas' },
    { label: 'Laporan AI', value: 'Tanpa batas' },
    { label: 'Pencari prospek', value: '500 pencarian per bulan' },
    { label: 'Penasihat AI', value: '2.500 pesan per bulan' },
  ],
  // At least Pro everywhere (Pro: leads 100, advisor 500, the rest unlimited); null = unlimited.
  quota: { offer: null, report: null, leads: 500, radar: null, advisor: 2500, social: null, income: null },
  features: [
    'Semua fitur Pro',
    'NDA: perjanjian kerahasiaan untuk data usaha Anda',
    'SLA uptime layanan 99,9% per bulan',
    'SLA respons dukungan maksimal 4 jam kerja',
    'Kontrak dan tagihan atas nama perusahaan',
    'Tidak termasuk saldo AI',
  ],
  cta_label: 'Hubungi kami',
  cta_kind: 'contact',
  sort: 4,
})

/** Built-in card price text -> rupiah: 'Rp0' -> 0, 'Rp349rb' -> 349000, 'Rp3.512.172' -> 3512172, 'Kustom' -> null. */
export function priceFromText(s) {
  const m = /(\d[\d.]*)\s*(rb)?/i.exec(String(s ?? ''))
  return m ? Number(m[1].replace(/\./g, '')) * (m[2] ? 1000 : 1) : null
}

/** { price, period } display strings: Rp349.000 / Kustom, and the period suffix or period_label. */
export function formatPrice(plan) {
  const price = plan.price_idr === null || plan.price_idr === undefined
    ? 'Kustom'
    : rupiah(plan.price_idr)
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
    quota: validateQuota(b.quota),
    cta_label,
    cta_kind: b.cta_kind,
    sort: b.sort ?? 0,
    active: flag(b.active, 'Status aktif') ?? 1,
  }
}

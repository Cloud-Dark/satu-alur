/**
 * Invoice rules (pure; no I/O): line totals, discount, PPN, numbering, status
 * transitions and how "Tandai lunas" links to Pembukuan. Money is whole rupiah.
 */

export const STATUSES = [
  { value: 'draft', label: 'Draft', tone: 'neutral' },
  { value: 'terkirim', label: 'Terkirim', tone: 'brand' },
  { value: 'lunas', label: 'Lunas', tone: 'ok' },
  { value: 'batal', label: 'Batal', tone: 'danger' },
]
export const STATUS_KEYS = new Set(STATUSES.map((s) => s.value))
export const statusLabel = (v) => STATUSES.find((s) => s.value === v)?.label || 'Draft'
export const PPN_RATE = 11
export const LIMITS = { items: 30, description: 300, notes: 1000, payment: 600, qtyMax: 100000, priceMax: 1e12 }

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const rp = (v) => Math.round(num(v))

/** Rounded line amount (qty may be fractional, e.g. 2,5 kg). */
export const lineAmount = (it) => rp(num(it.qty) * num(it.unit_price))

/**
 * Totals for an invoice: subtotal of lines, minus discount (capped at subtotal),
 * plus PPN on the discounted base. tax_rate is 0 or 11.
 */
export function computeTotals(items, { discount = 0, tax_rate = 0 } = {}) {
  const subtotal = (items || []).reduce((s, it) => s + lineAmount(it), 0)
  const disc = Math.min(Math.max(0, rp(discount)), subtotal)
  const base = subtotal - disc
  const rate = num(tax_rate) > 0 ? num(tax_rate) : 0
  const tax_amount = Math.round((base * rate) / 100)
  return { subtotal, discount: disc, base, tax_rate: rate, tax_amount, total: base + tax_amount }
}

/** Indonesian validation messages; empty when the invoice can be saved. */
export function invoiceProblems(inv, items) {
  const errs = []
  if (!String(inv.customer_name || '').trim()) errs.push('Isi nama pelanggan.')
  if (!inv.issue_date) errs.push('Isi tanggal invoice.')
  if (inv.due_date && inv.issue_date && inv.due_date < inv.issue_date) errs.push('Jatuh tempo tidak boleh sebelum tanggal invoice.')
  if (!items?.length) errs.push('Tambahkan minimal satu baris tagihan.')
  if ((items?.length || 0) > LIMITS.items) errs.push(`Maksimal ${LIMITS.items} baris tagihan.`)
  ;(items || []).forEach((it, i) => {
    const n = i + 1
    if (!String(it.description || '').trim()) errs.push(`Baris ${n}: isi keterangan.`)
    if (!(num(it.qty) > 0) || num(it.qty) > LIMITS.qtyMax) errs.push(`Baris ${n}: jumlah harus lebih dari nol.`)
    if (num(it.unit_price) < 0 || num(it.unit_price) > LIMITS.priceMax) errs.push(`Baris ${n}: harga tidak valid.`)
  })
  if (num(inv.discount) < 0) errs.push('Diskon tidak boleh negatif.')
  const t = computeTotals(items, inv)
  if (!(t.total > 0)) errs.push('Total invoice harus lebih dari nol.')
  return errs
}

/** INV-2026-0001 */
export const formatNumber = (year, seq) => `INV-${year}-${String(Math.max(1, seq)).padStart(4, '0')}`

/** Next sequence for a year from existing numbers (offline / fallback path). */
export function nextSeqFrom(numbers, year) {
  let max = 0
  const re = new RegExp(`^INV-${year}-(\\d+)$`)
  for (const n of numbers || []) {
    const m = re.exec(String(n))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/** Allowed status changes. Lunas and Batal are final (Batal can be re-opened to Draft). */
const NEXT = {
  draft: ['terkirim', 'lunas', 'batal'],
  terkirim: ['lunas', 'batal', 'draft'],
  lunas: [],
  batal: ['draft'],
}
export const canTransition = (from, to) => (NEXT[from || 'draft'] || []).includes(to)
export const isEditable = (status) => status === 'draft' || status === 'terkirim'

/**
 * What "Tandai lunas" does to Pembukuan. One revenue entry per penyelesaian
 * (the Worker enforces it): link the existing one, or post a new one for the
 * amount excluding PPN (PPN is collected for the state, not income).
 */
export function revenuePlan(invoice, ledger) {
  const existing = (ledger || []).find((l) => String(l.completion_id) === String(invoice.completion_id) && l.category === 'pendapatan')
  if (existing) return { action: 'link', ledgerId: existing.id }
  const amount = rp(num(invoice.total) - num(invoice.tax_amount))
  if (!(amount > 0)) return { action: 'none' }
  return { action: 'post', amount }
}

/** Default due date: issue date + N days, as YYYY-MM-DD. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + (Number(days) || 0))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** Plain-text invoice summary for WhatsApp / email bodies. */
export function invoiceText(inv, items, { businessName = '' } = {}) {
  const fmt = (n) => `Rp ${rp(n).toLocaleString('id-ID')}`
  const lines = [
    `Halo ${inv.customer_name || 'Bapak/Ibu'},`,
    '',
    `Berikut invoice ${inv.number}${businessName ? ` dari ${businessName}` : ''}:`,
    ...(items || []).map((it) => `• ${it.description} — ${num(it.qty).toLocaleString('id-ID')} × ${fmt(it.unit_price)} = ${fmt(lineAmount(it))}`),
  ]
  if (num(inv.discount) > 0) lines.push(`Diskon: −${fmt(inv.discount)}`)
  if (num(inv.tax_amount) > 0) lines.push(`PPN ${num(inv.tax_rate)}%: ${fmt(inv.tax_amount)}`)
  lines.push(`Total: ${fmt(inv.total)}`)
  if (inv.due_date) lines.push(`Jatuh tempo: ${inv.due_date}`)
  if (inv.payment_info) lines.push('', 'Pembayaran:', inv.payment_info)
  lines.push('', 'Terima kasih.')
  return lines.join('\n')
}

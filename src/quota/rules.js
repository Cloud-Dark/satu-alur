// Pure rules for AI quotas, AI credit and vouchers. Shared by the Worker (worker/quota.js) and the
// demo-mode client (src/quota/api.js), so both enforce the same numbers. Errors carry Indonesian text.

// One key per metered AI feature. price_idr is what one call costs from AI credit once the
// month's quota is used up.
export const FEATURES = [
  { key: 'offer', label: 'Penawaran AI', unit: 'draf', price_idr: 1000 },
  { key: 'report', label: 'Laporan AI', unit: 'penjelasan', price_idr: 1000 },
  { key: 'leads', label: 'Pencari prospek', unit: 'pencarian', price_idr: 2000 },
  { key: 'radar', label: 'Radar peluang', unit: 'analisis', price_idr: 500 },
  { key: 'advisor', label: 'Penasihat AI', unit: 'pesan', price_idr: 300 },
  { key: 'social', label: 'Konten media sosial', unit: 'konten', price_idr: 500 },
]
export const FEATURE_KEYS = FEATURES.map((f) => f.key)
const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]))
export const featureOf = (key) => BY_KEY[key] || null

// Trial quota = the Free plan's monthly limits. Used when no plan row says otherwise.
// The advisor is the most expensive feature (long multi-agent prompts), so it gets fewer tries.
export const FREE_QUOTA = { offer: 10, report: 10, leads: 10, radar: 10, advisor: 5, social: 10 }
// Margareta's "3 tries before signing up". Every AI path needs a signed-in session today,
// so nothing uses this yet; kept here so a future public demo has one number to read.
export const GUEST_TRIES = 3
export const FREE_SLUG = 'free'

export const VOUCHER_TYPES = ['plan', 'credit', 'bundle']
export const VOUCHER_TYPE_LABEL = { plan: 'Paket', credit: 'Saldo AI', bundle: 'Paket + saldo AI' }
export const MAX_VOUCHER_CREDIT = 500_000 // bigger vouchers go through the team (Hubungi kami)
const MAX_PLAN_DAYS = 366
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const str = (v) => (typeof v === 'string' ? v.trim() : '')
const toInt = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v)

/* ----------------------------------------------------------------- Periods */

// Quotas reset on the 1st, Jakarta time (WIB, UTC+7, no DST).
const WIB_MS = 7 * 60 * 60 * 1000
export const todayWib = (now = new Date()) => new Date(now.getTime() + WIB_MS).toISOString().slice(0, 10)
export const periodOf = (now = new Date()) => todayWib(now).slice(0, 7)

/** 'YYYY-MM' -> first day of the next month as 'YYYY-MM-DD' (when the quota resets). */
export function resetDate(period) {
  const [y, m] = period.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ Quotas */

/** Limit for one feature: a number, or null for unlimited (-1/null in the plan). Unknown keys fall back to Free. */
export function limitFor(quota, feature) {
  const q = quota && typeof quota === 'object' ? quota : {}
  if (!(feature in q)) return FREE_QUOTA[feature] ?? 0
  const v = q[feature]
  return v === null || v === -1 ? null : Math.max(0, Number(v) || 0)
}

export function parseQuota(json) {
  try {
    const v = typeof json === 'string' ? JSON.parse(json || '{}') : json
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

/** Staff input from the plan editor: { feature: int >= 0 | null (unlimited) }. */
export function validateQuota(body) {
  if (body === undefined || body === null) return {}
  if (typeof body !== 'object' || Array.isArray(body)) fail('Format kuota tidak valid.')
  const out = {}
  for (const [k, raw] of Object.entries(body)) {
    if (!BY_KEY[k]) fail('Fitur kuota tidak dikenal.')
    const v = raw === '' || raw === -1 ? null : toInt(raw)
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000)) fail(`Kuota ${BY_KEY[k].label} harus 0 sampai 100.000, atau kosong untuk tanpa batas.`)
    out[k] = v
  }
  return out
}

/**
 * The plan that applies today. account: customer_accounts row (or null); plans: [{ id, slug, quota }].
 * A trial/active account inside its period uses its plan; anything else falls back to Free.
 */
export function effectivePlan(account, plans, today) {
  const free = plans.find((p) => p.slug === FREE_SLUG) || { id: null, slug: FREE_SLUG, name: 'Free', quota: FREE_QUOTA }
  if (!account?.plan_id || !['trial', 'active'].includes(account.status)) return { plan: free, period_end: null }
  if (account.period_end && account.period_end < today) return { plan: free, period_end: null, lapsed: true }
  const plan = plans.find((p) => p.id === account.plan_id)
  return plan ? { plan, period_end: account.period_end || null } : { plan: free, period_end: null }
}

/**
 * Whether one more call may run, and how it is paid. demo accounts are never blocked (competition demo)
 * but still count usage. Returns { allow, via: 'demo'|'unlimited'|'quota'|'credit' }.
 */
export function decide({ used, limit, balance, price, demo = false }) {
  if (demo) return { allow: true, via: 'demo' }
  if (limit === null) return { allow: true, via: 'unlimited' }
  if (used < limit) return { allow: true, via: 'quota' }
  if (balance >= price) return { allow: true, via: 'credit' }
  return { allow: false, via: null }
}

export const quotaMessage = (feature) =>
  `Kuota ${featureOf(feature)?.label || 'AI'} bulan ini sudah habis dan saldo AI tidak cukup. Tukar voucher atau pilih paket yang lebih besar.`

/** Usage rows for the "Paket & kuota" page. counts: { feature: used }. */
export function usageRows(quota, counts) {
  return FEATURES.map((f) => {
    const limit = limitFor(quota, f.key)
    const used = Number(counts?.[f.key]) || 0
    return { ...f, used, limit, left: limit === null ? null : Math.max(0, limit - used) }
  })
}

/* ---------------------------------------------------------------- Vouchers */

export function normalizeCode(v) {
  return str(v).toUpperCase().replace(/\s+/g, '')
}

/** SATU-XXXX-XXXX from a random source (crypto.getRandomValues in the Worker and browser). */
export function generateCode(randomBytes) {
  const bytes = randomBytes(8)
  const ch = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
  return `SATU-${ch.slice(0, 4)}-${ch.slice(4)}`
}

/** Staff create/update input. planIds: ids of existing plans. */
export function validateVoucher(body, planIds = []) {
  const b = body && typeof body === 'object' ? body : {}
  const code = normalizeCode(b.code)
  if (code && !/^[A-Z0-9-]{4,32}$/.test(code)) fail('Kode 4-32 karakter: huruf, angka, atau tanda hubung.')
  if (!VOUCHER_TYPES.includes(b.type)) fail('Jenis voucher tidak dikenal.')
  const withPlan = b.type !== 'credit'
  const withCredit = b.type !== 'plan'

  let plan_id = null
  let plan_days = null
  if (withPlan) {
    plan_id = toInt(b.plan_id)
    if (!Number.isInteger(plan_id) || !planIds.includes(plan_id)) fail('Pilih paket untuk voucher ini.')
    plan_days = toInt(b.plan_days)
    if (!Number.isInteger(plan_days) || plan_days < 1 || plan_days > MAX_PLAN_DAYS) fail(`Durasi paket 1 sampai ${MAX_PLAN_DAYS} hari.`)
  }
  let credit_idr = 0
  if (withCredit) {
    credit_idr = toInt(b.credit_idr)
    if (!Number.isInteger(credit_idr) || credit_idr < 1000 || credit_idr > MAX_VOUCHER_CREDIT) {
      fail(`Saldo AI Rp1.000 sampai Rp${new Intl.NumberFormat('id-ID').format(MAX_VOUCHER_CREDIT)}.`)
    }
  }
  let max_redemptions = b.max_redemptions === '' || b.max_redemptions === undefined ? null : toInt(b.max_redemptions)
  if (max_redemptions !== null && (!Number.isInteger(max_redemptions) || max_redemptions < 1 || max_redemptions > 100_000)) {
    fail('Batas penukaran 1 sampai 100.000, atau kosong untuk tanpa batas.')
  }
  const expires_on = str(b.expires_on) || null
  if (expires_on && !/^\d{4}-\d{2}-\d{2}$/.test(expires_on)) fail('Tanggal kedaluwarsa tidak valid.')
  const note = str(b.note)
  if (note.length > 200) fail('Catatan maksimal 200 karakter.')
  const active = b.active === undefined ? 1 : (b.active === 1 || b.active === true ? 1 : 0)
  return { code, type: b.type, plan_id, plan_days, credit_idr, max_redemptions, expires_on, note, active }
}

/** Why a voucher can't be redeemed right now, or null. */
export function redeemProblem(voucher, { today, alreadyRedeemed }) {
  if (!voucher) return 'Kode voucher tidak ditemukan.'
  if (alreadyRedeemed) return 'Anda sudah menukar voucher ini.'
  if (!voucher.active) return 'Voucher ini sudah tidak aktif.'
  if (voucher.expires_on && voucher.expires_on < today) return 'Voucher ini sudah kedaluwarsa.'
  if (voucher.max_redemptions !== null && voucher.max_redemptions !== undefined && voucher.redeemed_count >= voucher.max_redemptions) {
    return 'Kuota penukaran voucher ini sudah habis.'
  }
  return null
}

/**
 * New plan period from a plan voucher. Same plan still running → extend from its end; otherwise start today.
 * current: { plan_id, status, period_end } or null.
 */
export function planAfterVoucher(current, voucher, today) {
  const running = current && current.plan_id === voucher.plan_id && ['trial', 'active'].includes(current.status)
    && current.period_end && current.period_end >= today
  const from = running ? current.period_end : today
  return { plan_id: voucher.plan_id, status: 'active', period_end: addDays(from, voucher.plan_days) }
}

export const rupiah = (n) => `Rp${new Intl.NumberFormat('id-ID').format(Number(n) || 0)}`

/** One-line value for lists: "Pro 30 hari + Rp50.000". planName(id) resolves the plan. */
export function voucherValue(v, planName = () => 'Paket') {
  const parts = []
  if (v.type !== 'credit') parts.push(`${planName(v.plan_id)} ${v.plan_days} hari`)
  if (v.type !== 'plan') parts.push(`saldo AI ${rupiah(v.credit_idr)}`)
  return parts.join(' + ')
}

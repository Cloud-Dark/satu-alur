// Pure validators for business customers (plan + status). Errors carry Indonesian text and `validation: true`.

export const CUSTOMER_STATUS_LABEL = { trial: 'Uji coba', active: 'Aktif', past_due: 'Tertunggak', cancelled: 'Berhenti' }
export const STAFF_EMAIL_SUFFIX = '@staff.satualur.internal'
/** Staff addresses exist only through staff login; the email (OTP) sign-up refuses them. */
export const isStaffEmail = (email) => String(email ?? '').trim().toLowerCase().endsWith(STAFF_EMAIL_SUFFIX)
export const DEMO_SUSPEND_MESSAGE = 'Akun demo bersama tidak bisa ditangguhkan.'

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const str = (v) => (typeof v === 'string' ? v.trim() : '')
function text(v, label, max) {
  const s = str(v)
  if (s.length > max) fail(`${label} maksimal ${max} karakter.`)
  return s
}

/** Escape LIKE wildcards; pair with `ESCAPE '\'` in SQL. */
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&')

function realDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toISOString().slice(0, 10) === s
}

export const SUSPENDED_MESSAGE = 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.'
/** sessionStorage key: a message the login page shows once (set when a suspended session is dropped). */
export const AUTH_NOTICE_KEY = 'satualur_auth_notice'

/** A user_flags row (or nothing) → is this user locked out? */
export const isBlocked = (flag) => Boolean(flag && (flag.suspended === 1 || flag.suspended === true))

export function validateSuspendReason(body) {
  const s = str(body?.reason)
  if (!s) fail('Alasan wajib diisi.')
  if (s.length > 300) fail('Alasan maksimal 300 karakter.')
  return s
}

export function validateCustomer(body) {
  const b = body && typeof body === 'object' ? body : {}
  if (typeof b.status !== 'string' || !Object.hasOwn(CUSTOMER_STATUS_LABEL, b.status)) fail('Status tidak dikenal.')
  let plan = b.plan_id
  if (plan === '' || plan === undefined) plan = null
  if (plan !== null && (!Number.isInteger(plan) || plan < 1)) fail('Paket tidak valid.')
  if (b.period_end !== undefined && b.period_end !== null && typeof b.period_end !== 'string') fail('Tanggal tidak valid.')
  const end = str(b.period_end)
  if (end && !realDate(end)) fail('Berlaku sampai harus tanggal yang valid (YYYY-MM-DD).')
  return {
    plan_id: plan,
    status: b.status,
    period_end: end || null,
    company: text(b.company, 'Perusahaan', 120),
    phone: text(b.phone, 'Telepon', 30),
    notes: text(b.notes, 'Catatan internal', 2000),
  }
}

/* ------------------------------------------------------------------ Contact Us */

export const CONTACT_STATUS_LABEL = { new: 'Baru', read: 'Dibaca', replied: 'Dibalas', archived: 'Arsip' }
export const CONTACT_OK_MESSAGE = 'Pesan terkirim. Tim Satu Alur akan membalas lewat email.'
export const CONTACT_LIMIT_MESSAGE = 'Terlalu banyak pesan. Coba lagi nanti.'
export const CONTACT_LIMIT = 5
// Strict on purpose: nothing that could smuggle extra mailto parameters or a scheme.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

function required(v, label, max) {
  const s = text(v, label, max)
  if (!s) fail(`${label} wajib diisi.`)
  return s
}

export function validateContact(body) {
  const b = body && typeof body === 'object' ? body : {}
  const name = required(b.name, 'Nama', 80)
  const email = str(b.email)
  if (email.length > 120 || !EMAIL_RE.test(email)) fail('Email tidak valid.')
  return { name, email, phone: text(b.phone, 'Telepon', 30), subject: required(b.subject, 'Subjek', 120), message: required(b.message, 'Pesan', 3000) }
}

/** The hidden `website` field: humans never see it, bots fill it. */
export const isHoneypot = (body) => str(body?.website) !== ''

/** Messages from one ip_hash in the last hour → refuse? */
export const contactRateLimited = (count) => count >= CONTACT_LIMIT
/** Messages from everyone in the last hour → refuse? (stops rotating-address floods) */
export const CONTACT_GLOBAL_LIMIT = 200
export const contactGloballyLimited = (count) => count >= CONTACT_GLOBAL_LIMIT

/**
 * Rate-limit bucket for an address: IPv4 as is, IPv6 by its /64 (one customer usually owns a whole /64).
 * `::` is expanded and leading zeros dropped so every spelling of one /64 lands in the same bucket;
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) counts as the IPv4 address.
 */
export function ipBucket(ip) {
  const s = String(ip ?? '').trim().toLowerCase()
  if (!s.includes(':')) return s
  if (s.includes('.')) return s.slice(s.lastIndexOf(':') + 1)
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')
}

export function validateContactUpdate(body) {
  const b = body && typeof body === 'object' ? body : {}
  const out = {}
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !Object.hasOwn(CONTACT_STATUS_LABEL, b.status)) fail('Status tidak dikenal.')
    out.status = b.status
  }
  if (b.staff_note !== undefined) out.staff_note = text(b.staff_note, 'Catatan', 2000)
  if (!Object.keys(out).length) fail('Tidak ada perubahan.')
  return out
}

/** "Balas lewat email" link, or null when the stored address is not a strict email. */
export const mailtoHref = (email, subject) =>
  EMAIL_RE.test(String(email)) ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Re: ${subject}`)}` : null

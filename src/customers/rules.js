// Pure validators for business customers (plan + status). Errors carry Indonesian text and `validation: true`.

export const CUSTOMER_STATUS_LABEL = { trial: 'Uji coba', active: 'Aktif', past_due: 'Tertunggak', cancelled: 'Berhenti' }
export const STAFF_EMAIL_SUFFIX = '@staff.satualur.internal'

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

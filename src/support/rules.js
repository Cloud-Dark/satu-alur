// Pure rules for support tickets (Bantuan / Pengaduan CS). Errors carry Indonesian text and `validation: true`.

export const TICKET_STATUS_LABEL = { open: 'Terbuka', in_progress: 'Diproses', resolved: 'Selesai', closed: 'Ditutup' }
export const TICKET_CATEGORY_LABEL = { teknis: 'Teknis', tagihan: 'Tagihan', akun: 'Akun', lainnya: 'Lainnya' }
export const OPEN_TICKET_LIMIT = 20
export const TICKET_LIMIT_MESSAGE = 'Terlalu banyak tiket terbuka.'
export const TICKET_CLOSED_MESSAGE = 'Tiket sudah ditutup.'
export const TICKET_NOT_FOUND = 'Tiket tidak ditemukan.'

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const str = (v) => (typeof v === 'string' ? v.trim() : '')
function required(v, label, max) {
  const s = str(v)
  if (!s) fail(`${label} wajib diisi.`)
  if (s.length > max) fail(`${label} maksimal ${max} karakter.`)
  return s
}

export function validateTicket(body) {
  const b = body && typeof body === 'object' ? body : {}
  if (typeof b.category !== 'string' || !Object.hasOwn(TICKET_CATEGORY_LABEL, b.category)) fail('Kategori tidak dikenal.')
  return { category: b.category, subject: required(b.subject, 'Subjek', 120), body: required(b.body, 'Pesan', 3000) }
}

export const validateReply = (body) => required(body?.body, 'Pesan', 3000)

export function validateTicketStatus(body) {
  const s = body?.status
  if (typeof s !== 'string' || !Object.hasOwn(TICKET_STATUS_LABEL, s)) fail('Status tidak dikenal.')
  return s
}

/** Open (non-closed) tickets a business already has → refuse a new one? */
export const ticketLimitReached = (openCount) => openCount >= OPEN_TICKET_LIMIT

/** Status after a reply by 'customer' or 'staff'. A customer cannot reply on a closed ticket. */
export function nextStatusOnReply(status, author) {
  if (author === 'staff') return status === 'open' ? 'in_progress' : status
  if (status === 'closed') fail(TICKET_CLOSED_MESSAGE)
  return status === 'resolved' ? 'open' : status
}

export const customerAuthorName = ({ company, name, email }) => str(company) || str(name) || String(email || '')
export const staffAuthorName = (name) => (str(name) ? `Tim Satu Alur (${str(name)})` : 'Tim Satu Alur')

/**
 * Local (no AI) helpers for the offer pipeline: the schedule suggestion and the
 * internal review draft ("draf tinjauan"). Pure functions, unit-tested.
 */

const DAY = 86400000
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`

/**
 * The client's requested time when it is still in the future; otherwise the
 * working day (Mon–Sat) within the next 7 days with the fewest assignments, 09:00.
 */
export function suggestSchedule({ requestedAt = null, assignments = [], now = new Date() } = {}) {
  const asked = requestedAt ? new Date(requestedAt) : null
  if (asked && !Number.isNaN(asked.getTime()) && asked.getTime() > now.getTime()) return { at: asked, reason: 'client' }
  const load = new Map()
  for (const a of assignments) {
    const t = a?.scheduled_at ? new Date(a.scheduled_at) : null
    if (!t || Number.isNaN(t.getTime())) continue
    const k = t.toDateString()
    load.set(k, (load.get(k) || 0) + 1)
  }
  let best = null
  for (let d = 1; d <= 7; d += 1) {
    const day = new Date(now.getTime() + d * DAY)
    if (day.getDay() === 0) continue // Sunday
    day.setHours(9, 0, 0, 0)
    const n = load.get(day.toDateString()) || 0
    if (!best || n < best.n) best = { at: day, n }
  }
  return { at: best.at, reason: best.n === 0 ? 'free' : 'lightest', load: best.n }
}

/** Average validated price of earlier offers, or null when there is none. */
export function priceHistory(offers = []) {
  const prices = offers.map((o) => Number(o?.validated_price)).filter((n) => Number.isFinite(n) && n > 0)
  if (!prices.length) return null
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length
  return { count: prices.length, avg: Math.round(avg), min: Math.min(...prices), max: Math.max(...prices) }
}

/**
 * Internal review notes for the owner before sending: price vs history and the
 * template's range, missing contact data, schedule, things to double-check.
 */
export function reviewDraft({ offer = {}, request = {}, history = null, template = null, schedule = null } = {}) {
  const price = Number(offer.price)
  const points = []
  if (history) {
    const diff = (price - history.avg) / history.avg
    const pct = Math.round(Math.abs(diff) * 100)
    if (pct <= 15) points.push({ tone: 'ok', text: `Harga sejalan dengan ${history.count} penawaran serupa (rata-rata ${rp(history.avg)}).` })
    else if (diff > 0) points.push({ tone: 'warn', text: `Harga ${pct}% di atas rata-rata ${history.count} penawaran serupa (${rp(history.avg)}). Pastikan nilainya sepadan.` })
    else points.push({ tone: 'warn', text: `Harga ${pct}% di bawah rata-rata ${history.count} penawaran serupa (${rp(history.avg)}). Periksa margin Anda.` })
  } else {
    points.push({ tone: 'info', text: 'Belum ada penawaran serupa sebagai pembanding harga.' })
  }
  if (template && (template.price_hint_min || template.price_hint_max)) {
    const lo = template.price_hint_min || 0
    const hi = template.price_hint_max || Infinity
    if (price < lo || price > hi) points.push({ tone: 'warn', text: `Harga di luar kisaran template "${template.name}".` })
    else points.push({ tone: 'ok', text: `Harga dalam kisaran template "${template.name}".` })
  }
  if (!request.phone) points.push({ tone: 'warn', text: 'Nomor telepon pelanggan belum ada, jadi penawaran belum bisa dikirim lewat WhatsApp.' })
  if (!schedule) points.push({ tone: 'warn', text: 'Jadwal pelaksanaan belum ditentukan.' })
  if (String(request.description || '').trim().length < 30) points.push({ tone: 'info', text: 'Deskripsi kebutuhan singkat; harga bisa berubah setelah survei.' })
  if (/survei|estimasi|perkiraan/i.test(String(offer.notes || ''))) points.push({ tone: 'info', text: 'Penawaran menyebut estimasi; jelaskan kapan harga final dikunci.' })
  points.push({ tone: 'info', text: 'Cek ulang: ruang lingkup sesuai permintaan, ketentuan pembayaran, dan masa berlaku penawaran.' })
  const warn = points.filter((p) => p.tone === 'warn').length
  const summary = warn ? `${warn} hal perlu diperhatikan sebelum dikirim.` : 'Siap dikirim setelah Anda meninjau isinya.'
  return { summary, points }
}

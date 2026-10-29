// Pure validators for the office (influencer catalogue + service requests). Errors carry Indonesian text.

export const REQUEST_STATUSES = ['new', 'in_progress', 'done']
const GOALS = ['awareness', 'traffic', 'leads', 'messages']

const SHORT_MAX = 200

// Tagged so the worker turns only these into 400s (anything else is a real bug).
function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const str = (v) => (typeof v === 'string' ? v.trim() : '')
// Trimmed single-line field capped at 200 characters.
function short(v, label) {
  const s = str(v)
  if (s.length > SHORT_MAX) fail(`${label} maksimal ${SHORT_MAX} karakter.`)
  return s
}
const isInt = (v) => Number.isInteger(v)

function optInt(v, min, max, msg) {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  if (!isInt(n) || n < min || n > max) fail(msg)
  return n
}

export function validateServiceRequest(body) {
  const b = body || {}
  const p = b.payload && typeof b.payload === 'object' ? b.payload : {}
  if (b.kind === 'collab') {
    const campaign = str(p.campaign)
    if (!campaign) fail('Ceritakan kampanye Anda.')
    if (campaign.length > 2000) fail('Cerita kampanye maksimal 2000 karakter.')
    const budget_range = short(p.budget_range, 'Kisaran budget')
    if (!budget_range) fail('Pilih kisaran budget.')
    const timing = short(p.timing, 'Waktu pelaksanaan')
    if (!timing) fail('Isi waktu pelaksanaan.')
    const id = Number(b.influencer_id)
    if (!isInt(id) || id < 1) fail('Pilih influencer.')
    return { kind: 'collab', influencer_id: id, payload: { campaign, budget_range, timing } }
  }
  if (b.kind === 'ads') {
    const service = short(p.service, 'Layanan')
    if (!service) fail('Layanan yang diiklankan wajib diisi.')
    const goal = str(p.goal)
    if (goal && !GOALS.includes(goal)) fail('Tujuan iklan tidak dikenal.')
    const notes = str(p.notes)
    if (notes.length > 2000) fail('Catatan maksimal 2000 karakter.')
    return {
      kind: 'ads',
      influencer_id: null,
      payload: {
        service,
        location: short(p.location, 'Lokasi'),
        daily_budget: optInt(p.daily_budget, 10000, 1000000000, 'Budget harian harus 10.000 sampai 1.000.000.000.'),
        duration_days: optInt(p.duration_days, 1, 90, 'Durasi harus 1 sampai 90 hari.'),
        goal,
        notes,
      },
    }
  }
  fail('Jenis permintaan tidak dikenal.')
}

export function validateInfluencer(body) {
  const b = body || {}
  const name = short(b.name, 'Nama')
  if (!name) fail('Nama wajib diisi.')
  const niche = short(b.niche, 'Niche')
  if (!niche) fail('Niche wajib diisi.')
  const city = short(b.city, 'Kota')
  if (!city) fail('Kota wajib diisi.')
  const bio = str(b.bio)
  if (bio.length > 2000) fail('Bio maksimal 2000 karakter.')
  const photo_key = b.photo_key ? String(b.photo_key) : null
  if (photo_key && !/^[0-9a-f]{32}$/.test(photo_key)) fail('Foto tidak valid.')
  const msg = 'Jumlah pengikut harus bilangan bulat 0 atau lebih.'
  const visible = b.visible === undefined ? 1 : Number(b.visible)
  if (visible !== 0 && visible !== 1) fail('Status tampil harus 0 atau 1.')
  const handle = (v, label) => { const h = short(v, label).replace(/^@+/, ''); if (h.length > 60) fail(`${label} maksimal 60 karakter.`); return h }
  const contact_phone = str(b.contact_phone)
  if (contact_phone.length > 30) fail('Telepon maksimal 30 karakter.')
  const contact_email = str(b.contact_email)
  if (contact_email.length > 120) fail('Email maksimal 120 karakter.')
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) fail('Email tidak valid.')
  const internal_notes = str(b.internal_notes)
  if (internal_notes.length > 2000) fail('Catatan internal maksimal 2000 karakter.')
  if (b.rates !== undefined && b.rates !== null && !Array.isArray(b.rates)) fail('Format tarif tidak valid.')
  const rates = (b.rates || []).map((r) => ({ deliverable: str(r?.deliverable), price: r?.price_idr }))
    .filter((r) => r.deliverable || (r.price !== undefined && r.price !== null && r.price !== ''))
    .map((r) => {
      if (!r.deliverable) fail('Jenis konten tarif wajib diisi.')
      if (r.deliverable.length > 40) fail('Jenis konten tarif maksimal 40 karakter.')
      const price_idr = optInt(r.price, 0, 1_000_000_000, 'Harga tarif harus bilangan bulat 0 sampai 1.000.000.000.')
      if (price_idr === null) fail('Harga tarif harus bilangan bulat 0 sampai 1.000.000.000.')
      return { deliverable: r.deliverable, price_idr }
    })
  if (rates.length > 8) fail('Maksimal 8 tarif.')
  return {
    name, niche, city, bio, photo_key,
    handle_ig: handle(b.handle_ig, 'Handle Instagram'), handle_tiktok: handle(b.handle_tiktok, 'Handle TikTok'), handle_youtube: handle(b.handle_youtube, 'Handle YouTube'),
    contact_phone, contact_email, rates, internal_notes,
    ig_followers: optInt(b.ig_followers, 0, Number.MAX_SAFE_INTEGER, msg) ?? 0,
    tiktok_followers: optInt(b.tiktok_followers, 0, Number.MAX_SAFE_INTEGER, msg) ?? 0,
    visible,
  }
}

const PUBLIC_INFLUENCER = ['id', 'name', 'photo_key', 'niche', 'city', 'ig_followers', 'tiktok_followers', 'bio']
// The only influencer keys businesses may see; staff-only fields (contacts, rates, notes) never pass through.
export const publicInfluencer = (row) => Object.fromEntries(PUBLIC_INFLUENCER.map((k) => [k, row[k]]))

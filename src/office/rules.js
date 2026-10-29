// Pure validators for the office (influencer catalogue + service requests). Errors carry Indonesian text.

export const REQUEST_STATUSES = ['new', 'in_progress', 'done']
const GOALS = ['awareness', 'traffic', 'leads', 'messages']

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const isInt = (v) => Number.isInteger(v)

function optInt(v, min, max, msg) {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  if (!isInt(n) || n < min || n > max) throw new Error(msg)
  return n
}

export function validateServiceRequest(body) {
  const b = body || {}
  const p = b.payload && typeof b.payload === 'object' ? b.payload : {}
  if (b.kind === 'collab') {
    const campaign = str(p.campaign)
    if (!campaign) throw new Error('Ceritakan kampanye Anda.')
    if (campaign.length > 2000) throw new Error('Cerita kampanye maksimal 2000 karakter.')
    const budget_range = str(p.budget_range)
    if (!budget_range) throw new Error('Pilih kisaran budget.')
    const timing = str(p.timing)
    if (!timing) throw new Error('Isi waktu pelaksanaan.')
    const id = Number(b.influencer_id)
    if (!isInt(id) || id < 1) throw new Error('Pilih influencer.')
    return { kind: 'collab', influencer_id: id, payload: { campaign, budget_range, timing } }
  }
  if (b.kind === 'ads') {
    const service = str(p.service)
    if (!service) throw new Error('Layanan yang diiklankan wajib diisi.')
    const goal = str(p.goal)
    if (goal && !GOALS.includes(goal)) throw new Error('Tujuan iklan tidak dikenal.')
    const notes = str(p.notes)
    if (notes.length > 2000) throw new Error('Catatan maksimal 2000 karakter.')
    return {
      kind: 'ads',
      influencer_id: null,
      payload: {
        service,
        location: str(p.location),
        daily_budget: optInt(p.daily_budget, 10000, 1000000000, 'Budget harian harus 10.000 sampai 1.000.000.000.'),
        duration_days: optInt(p.duration_days, 1, 90, 'Durasi harus 1 sampai 90 hari.'),
        goal,
        notes,
      },
    }
  }
  throw new Error('Jenis permintaan tidak dikenal.')
}

export function validateInfluencer(body) {
  const b = body || {}
  const name = str(b.name)
  if (!name) throw new Error('Nama wajib diisi.')
  const niche = str(b.niche)
  if (!niche) throw new Error('Niche wajib diisi.')
  const city = str(b.city)
  if (!city) throw new Error('Kota wajib diisi.')
  const bio = str(b.bio)
  if (bio.length > 2000) throw new Error('Bio maksimal 2000 karakter.')
  const photo_key = b.photo_key ? String(b.photo_key) : null
  if (photo_key && !/^[0-9a-f]{32}$/.test(photo_key)) throw new Error('Foto tidak valid.')
  const msg = 'Jumlah pengikut harus bilangan bulat 0 atau lebih.'
  const visible = b.visible === undefined ? 1 : Number(b.visible)
  if (visible !== 0 && visible !== 1) throw new Error('Status tampil harus 0 atau 1.')
  return {
    name, niche, city, bio, photo_key,
    ig_followers: optInt(b.ig_followers, 0, Number.MAX_SAFE_INTEGER, msg) ?? 0,
    tiktok_followers: optInt(b.tiktok_followers, 0, Number.MAX_SAFE_INTEGER, msg) ?? 0,
    visible,
  }
}

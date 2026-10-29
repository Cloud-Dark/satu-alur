// Pure rules for influencer campaigns (Agensi influencer). Shared by worker/agency.js and the demo client.

export const CAMPAIGN_STATUS_LABEL = { draft: 'Draf', active: 'Berjalan', completed: 'Selesai', cancelled: 'Dibatalkan' }
export const DELIVERABLE_STATUS_LABEL = { planned: 'Direncanakan', briefed: 'Brief terkirim', in_progress: 'Dikerjakan', submitted: 'Menunggu persetujuan', approved: 'Disetujui', published: 'Tayang' }
export const CAMPAIGN_TONE = { draft: 'neutral', active: 'warn', completed: 'ok', cancelled: 'neutral' }
export const DELIVERABLE_KIND_LABEL = { feed: 'Feed', reel: 'Reel', story: 'Story', tiktok: 'TikTok', youtube: 'YouTube', lainnya: 'Lainnya' }

export const CAMPAIGN_NOT_FOUND = 'Kampanye tidak ditemukan.'
export const REQUEST_NOT_FOUND = 'Permintaan tidak ditemukan.'
export const DELIVERABLE_NOT_FOUND = 'Konten tidak ditemukan.'
export const DUPLICATE_CAMPAIGN = 'Permintaan ini sudah punya kampanye.'
export const COLLAB_ONLY = 'Kampanye hanya untuk permintaan kolaborasi.'
export const INFLUENCER_MISSING = 'Influencer tidak ditemukan.'
export const INFLUENCER_HIDDEN = 'Influencer ini tidak aktif.'
export const NOT_ASSIGNED = 'Influencer ini belum ditugaskan di kampanye ini.'
export const REMOVE_BLOCKED = 'Hapus atau pindahkan konten influencer ini terlebih dahulu.'
export const PUBLISHED_NEEDS_LINK = 'Tambahkan tautan konten yang sudah tayang.'

const MAX_IDR = 1_000_000_000_000

function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim())
const empty = (v) => v === undefined || v === null || v === ''

function date(v, msg) {
  if (empty(v)) return null
  const s = str(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(msg)
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(msg)
  return s
}

function money(v, msg) {
  if (empty(v)) return null
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v
  if (!Number.isInteger(n) || n < 0 || n > MAX_IDR) fail(msg)
  return n
}

export function positiveId(v, msg) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  if (!Number.isInteger(n) || n < 1) fail(msg)
  return n
}

export const isHttpsLink = (s) => typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s)

export function validateCampaign(body) {
  const b = body || {}
  const title = str(b.title)
  if (!title) fail('Judul wajib diisi.')
  if (title.length > 120) fail('Judul maksimal 120 karakter.')
  const brief = str(b.brief)
  if (brief.length > 3000) fail('Brief maksimal 3000 karakter.')
  const status = empty(b.status) ? 'draft' : b.status
  if (!Object.hasOwn(CAMPAIGN_STATUS_LABEL, status)) fail('Status kampanye tidak dikenal.')
  const start_date = date(b.start_date, 'Tanggal mulai tidak valid.')
  const end_date = date(b.end_date, 'Tanggal selesai tidak valid.')
  if (start_date && end_date && end_date < start_date) fail('Tanggal selesai tidak boleh sebelum tanggal mulai.')
  const client_fee_idr = money(b.client_fee_idr, 'Biaya klien harus bilangan bulat 0 atau lebih.')
  return { title, brief, status, start_date, end_date, client_fee_idr }
}

export function validatePayout(body) {
  const b = body || {}
  return {
    influencer_id: positiveId(b.influencer_id, 'Pilih influencer.'),
    payout_idr: money(b.payout_idr, 'Bayaran harus bilangan bulat 0 atau lebih.'),
  }
}

export function validateDeliverable(body) {
  const b = body || {}
  const influencer_id = positiveId(b.influencer_id, 'Pilih influencer.')
  if (!Object.hasOwn(DELIVERABLE_KIND_LABEL, b.kind)) fail('Jenis konten tidak dikenal.')
  const status = empty(b.status) ? 'planned' : b.status
  if (!Object.hasOwn(DELIVERABLE_STATUS_LABEL, status)) fail('Status konten tidak dikenal.')
  const due_date = date(b.due_date, 'Tenggat tidak valid.')
  const link = str(b.link)
  if (link.length > 300) fail('Tautan maksimal 300 karakter.')
  if (link && !isHttpsLink(link)) fail('Tautan harus diawali https://.')
  if (status === 'published' && !link) fail(PUBLISHED_NEEDS_LINK)
  const note = str(b.note)
  if (note.length > 500) fail('Catatan maksimal 500 karakter.')
  return { influencer_id, kind: b.kind, due_date, status, link: link || null, note }
}

/**
 * What a business may see of its campaign. Allow-list only: payouts, the client fee, contacts, rates,
 * internal notes and deliverable notes never pass. A link shows only once the deliverable is published.
 * influencers: rows with influencer_id, name, niche, city, photo_key.
 */
export function campaignProjection(campaign, influencers, deliverables) {
  const names = new Map(influencers.map((i) => [i.influencer_id, i.name]))
  return {
    title: campaign.title,
    status: campaign.status,
    start_date: campaign.start_date ?? null,
    end_date: campaign.end_date ?? null,
    influencers: influencers.map((i) => ({ name: i.name, niche: i.niche, city: i.city, photo_key: i.photo_key ?? null })),
    deliverables: deliverables.map((d) => ({
      influencer_name: names.get(d.influencer_id) ?? '',
      kind: d.kind,
      due_date: d.due_date ?? null,
      status: d.status,
      link: d.status === 'published' && isHttpsLink(d.link) ? d.link : null,
    })),
  }
}

/** Summary numbers for the staff editor: margin = fee − sum of payouts, null when no fee is set. */
export function campaignMoney(campaign, influencers) {
  const payout = influencers.reduce((s, i) => s + (i.payout_idr || 0), 0)
  const fee = campaign.client_fee_idr ?? null
  return { fee, payout, margin: fee === null ? null : fee - payout }
}

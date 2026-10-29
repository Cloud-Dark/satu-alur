/**
 * Agensi influencer — campaigns client for /api/office/admin/campaigns, /api/office/admin/deliverables and the
 * business projection GET /api/office/requests/:id/campaign.
 * Demo mode (mock cloud): { seq, campaigns, links, deliverables } in localStorage `satualur_agency_demo_v1`. Requests and
 * influencers are read from the social demo store (`satualur_social_demo_v1`); a campaign's owner is its request's owner.
 * Test seam (demo mode): `satualur_agency_fail` = '1' makes reads fail.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'
import {
  validateCampaign, validateDeliverable, validatePayout, positiveId, campaignProjection, CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_NOT_FOUND, REQUEST_NOT_FOUND, DELIVERABLE_NOT_FOUND, DUPLICATE_CAMPAIGN, COLLAB_ONLY, INFLUENCER_MISSING,
  INFLUENCER_HIDDEN, NOT_ASSIGNED, REMOVE_BLOCKED,
} from './rules.js'

export const PAGE_SIZE = 50
export const AGENCY_KEY = 'satualur_agency_demo_v1'
const SOCIAL_KEY = 'satualur_social_demo_v1'
const token = () => { try { return localStorage.getItem('satualur_token') } catch { return null } }

async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Jaringan bermasalah. Periksa koneksi lalu coba lagi.')
  }
  let json = null
  try { json = await res.json() } catch { /* not JSON */ }
  if (!res.ok || json?.error) {
    const message = json?.error?.message || `HTTP ${res.status}`
    signOutIfSuspended(res.status, message)
    throw Object.assign(new Error(message), { status: res.status })
  }
  return json?.data
}

/* ------------------------------------------------------------------ demo store */
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
const loadAgency = () => ({ seq: 0, campaigns: [], links: [], deliverables: [], ...read(AGENCY_KEY, {}) })
// Every mock call reads, changes and writes both stores in one synchronous turn, so rules can't race.
function mock(fn) {
  const a = loadAgency()
  const s = read(SOCIAL_KEY, {})
  const out = fn(a, s)
  try {
    localStorage.setItem(AGENCY_KEY, JSON.stringify(a))
    localStorage.setItem(SOCIAL_KEY, JSON.stringify(s))
  } catch { /* private mode: state stays in this call only, like social's saveDemo */ }
  return out
}
const failRead = () => { if (localStorage.getItem('satualur_agency_fail') === '1') throw new Error('Gagal memuat kampanye. Coba lagi.') }
const nowIso = () => new Date().toISOString()
async function staffName() { return (await getCloud().auth.getSession())?.data?.user?.name || 'demo' }
const findCampaign = (a, id) => {
  const c = a.campaigns.find((x) => x.id === Number(id))
  if (!c) throw new Error(CAMPAIGN_NOT_FOUND)
  return c
}
const linksOf = (a, s, cid) => a.links.filter((l) => l.campaign_id === cid).map((l) => {
  const i = (s.influencers || []).find((x) => x.id === l.influencer_id) || {}
  return { influencer_id: l.influencer_id, name: i.name, niche: i.niche, city: i.city, photo_key: i.photo_key ?? null, visible: i.visible, payout_idr: l.payout_idr }
}).sort((x, y) => String(x.name).localeCompare(String(y.name)))
const deliverablesOf = (a, cid) => a.deliverables.filter((d) => d.campaign_id === cid)
  .sort((x, y) => (x.due_date === null) - (y.due_date === null) || String(x.due_date).localeCompare(String(y.due_date)) || x.id - y.id)
const assigned = (a, cid, iid) => a.links.some((l) => l.campaign_id === cid && l.influencer_id === iid)
const withBusiness = (s, c) => {
  const r = (s.requests || []).find((x) => x.id === c.request_id) || {}
  return { ...c, business_name: r.business_name ?? null, business_email: r.business_email ?? null }
}

/* ------------------------------------------------------------------ staff */
/** { request_id, title, brief?, start_date?, end_date?, client_fee_idr? } → { id }. Request goes to in_progress. */
export async function adminCreateCampaign(body) {
  if (!isUsingMockCloud()) return call('/api/office/admin/campaigns', { method: 'POST', body })
  const by = await staffName()
  return mock((a, s) => {
    const r = (s.requests || []).find((x) => x.id === Number(body?.request_id))
    if (!r) throw new Error(REQUEST_NOT_FOUND)
    if (r.kind !== 'collab') throw new Error(COLLAB_ONLY)
    const v = validateCampaign(body)
    if (a.campaigns.some((c) => c.request_id === r.id)) throw new Error(DUPLICATE_CAMPAIGN)
    const at = nowIso()
    const c = { id: ++a.seq, request_id: r.id, owner_id: r.owner_id, ...v, created_at: at, updated_at: at, updated_by: by }
    a.campaigns.push(c)
    const inf = (s.influencers || []).find((i) => i.id === r.influencer_id && i.visible === 1)
    if (inf) a.links.push({ campaign_id: c.id, influencer_id: inf.id, payout_idr: null })
    Object.assign(r, { status: 'in_progress', updated_at: at })
    return { id: c.id }
  })
}

/** { items, total, page }; status = a campaign status or empty for all. */
export async function adminListCampaigns({ status = '', page = 1 } = {}) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/campaigns?status=${encodeURIComponent(status)}&page=${page}`)
  if (status && !Object.hasOwn(CAMPAIGN_STATUS_LABEL, status)) throw new Error('Status tidak dikenal.')
  failRead()
  return mock((a, s) => {
    const all = a.campaigns.filter((c) => !status || c.status === status)
      .sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)) || y.id - x.id)
    return { items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => withBusiness(s, c)), total: all.length, page }
  })
}

/** Full staff detail: the campaign, its influencers (with payout) and deliverables (with notes). */
export async function adminGetCampaign(id) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/campaigns/${encodeURIComponent(id)}`)
  failRead()
  return mock((a, s) => {
    const c = findCampaign(a, id)
    return { ...withBusiness(s, c), influencers: linksOf(a, s, c.id), deliverables: deliverablesOf(a, c.id).map((d) => ({ ...d })) }
  })
}

export async function adminUpdateCampaign(id, patch) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
  const by = await staffName()
  return mock((a) => {
    const c = findCampaign(a, id)
    Object.assign(c, validateCampaign({ ...c, ...patch }), { updated_at: nowIso(), updated_by: by })
    return null
  })
}

/** Adds an influencer (visible only) or updates the payout of one already on the campaign. */
export async function adminAssignInfluencer(id, body) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/campaigns/${encodeURIComponent(id)}/influencers`, { method: 'POST', body })
  return mock((a, s) => {
    const c = findCampaign(a, id)
    const v = validatePayout(body)
    const cur = a.links.find((l) => l.campaign_id === c.id && l.influencer_id === v.influencer_id)
    if (cur) { cur.payout_idr = v.payout_idr; return null }
    const inf = (s.influencers || []).find((i) => i.id === v.influencer_id)
    if (!inf) throw new Error(INFLUENCER_MISSING)
    if (inf.visible !== 1) throw new Error(INFLUENCER_HIDDEN)
    a.links.push({ campaign_id: c.id, influencer_id: inf.id, payout_idr: v.payout_idr })
    return null
  })
}

export async function adminRemoveInfluencer(id, influencerId) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/campaigns/${encodeURIComponent(id)}/influencers/${encodeURIComponent(influencerId)}`, { method: 'DELETE' })
  return mock((a) => {
    const c = findCampaign(a, id)
    const iid = Number(influencerId)
    if (!assigned(a, c.id, iid)) throw new Error(NOT_ASSIGNED)
    if (a.deliverables.some((d) => d.campaign_id === c.id && d.influencer_id === iid)) throw new Error(REMOVE_BLOCKED)
    a.links = a.links.filter((l) => !(l.campaign_id === c.id && l.influencer_id === iid))
    return null
  })
}

/** { influencer_id, kind, due_date?, status?, link?, note? } → { id } */
export async function adminAddDeliverable(id, body) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/campaigns/${encodeURIComponent(id)}/deliverables`, { method: 'POST', body })
  const by = await staffName()
  return mock((a) => {
    const c = findCampaign(a, id)
    const v = validateDeliverable(body)
    if (!assigned(a, c.id, v.influencer_id)) throw new Error(NOT_ASSIGNED)
    const d = { id: ++a.seq, campaign_id: c.id, ...v, updated_at: nowIso(), updated_by: by }
    a.deliverables.push(d)
    return { id: d.id }
  })
}

export async function adminUpdateDeliverable(id, patch) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/deliverables/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
  const by = await staffName()
  return mock((a) => {
    const d = a.deliverables.find((x) => x.id === Number(id))
    if (!d) throw new Error(DELIVERABLE_NOT_FOUND)
    const v = validateDeliverable({ ...d, ...patch })
    if (!assigned(a, d.campaign_id, v.influencer_id)) throw new Error(NOT_ASSIGNED)
    Object.assign(d, v, { updated_at: nowIso(), updated_by: by })
    return null
  })
}

export async function adminDeleteDeliverable(id) {
  if (!isUsingMockCloud()) return call(`/api/office/admin/deliverables/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return mock((a) => {
    const n = a.deliverables.length
    a.deliverables = a.deliverables.filter((x) => x.id !== Number(id))
    if (a.deliverables.length === n) throw new Error(DELIVERABLE_NOT_FOUND)
    return null
  })
}

/* ------------------------------------------------------------------ business */
/** The signed-in business's view of the campaign for one of its requests (campaignProjection). */
export async function getRequestCampaign(requestId) {
  if (!isUsingMockCloud()) return call(`/api/office/requests/${encodeURIComponent(requestId)}/campaign`)
  const u = (await getCloud().auth.getSession())?.data?.user
  if (!u) throw new Error('Belum masuk.')
  return mock((a, s) => {
    let rid
    try { rid = positiveId(String(requestId), '') } catch { throw new Error(CAMPAIGN_NOT_FOUND) }
    const r = (s.requests || []).find((x) => x.id === rid && x.owner_id === u.id)
    const c = r && a.campaigns.find((x) => x.request_id === r.id)
    if (!c) throw new Error(CAMPAIGN_NOT_FOUND)
    return campaignProjection(c, linksOf(a, s, c.id), deliverablesOf(a, c.id))
  })
}

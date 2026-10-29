/**
 * Media Sosial + Kantor — client for /api/social/* and /api/office/*. In demo
 * mode (mock cloud) everything except social_contents (cloud database client)
 * lives in localStorage `satualur_social_demo_v1`; publishing is simulated.
 * Every failure carries a readable Indonesian message.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { PLATFORMS, validateScheduleAt, igEligibility } from './rules.js'
import { REQUEST_STATUSES, validateServiceRequest, validateInfluencer, publicInfluencer } from '../office/rules.js'

const TOKEN_KEY = 'satualur_token'
const DEMO_KEY = 'satualur_social_demo_v1'
export const UNCERTAIN = 'Status tidak pasti — periksa Laporan tayang sebelum mencoba lagi.'
const token = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

async function call(path, { method = 'GET', body, raw, signal } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(raw ? { 'Content-Type': raw.type || 'image/jpeg' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
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
let now = () => Date.now()
export function __setNow(fn) { now = fn || (() => Date.now()) }
let delayMs = 2000
export function __setDelay(ms) { delayMs = ms }

const objectUrls = new Map() // key -> object URL (demo uploads; memory only)
const SEED_INFLUENCERS = [
  ['Aulia Rahma', 'Kuliner', 'Jakarta', 182000, 95000, 'Review kedai dan jajanan Jakarta setiap pekan.'],
  ['Bima Pratama', 'Otomotif', 'Bandung', 74000, 41000, 'Perawatan motor dan mobil harian, gaya santai.'],
  ['Citra Lestari', 'Kecantikan', 'Surabaya', 256000, 180000, 'Tutorial makeup natural dan skincare lokal.'],
  ['Dimas Wicaksono', 'Rumah & Properti', 'Yogyakarta', 48000, 22000, 'Tips renovasi dan dekorasi rumah hemat.'],
  ['Eka Putri Handayani', 'Keluarga', 'Semarang', 121000, 67000, 'Parenting dan kebutuhan rumah tangga sehari-hari.'],
  ['Fajar Nugraha', 'Teknologi', 'Medan', 89000, 58000, 'Ulasan gawai dan aplikasi untuk usaha kecil.'],
]

function loadDemo() {
  let s = null
  try { s = JSON.parse(localStorage.getItem(DEMO_KEY)) } catch { /* fresh */ }
  if (s?.influencers) return s
  return {
    seq: 100, account: null, posts: [], requests: [],
    influencers: SEED_INFLUENCERS.map(([name, niche, city, ig, tt, bio], i) => ({
      id: i + 1, name, photo_key: null, niche, city, ig_followers: ig, tiktok_followers: tt, bio, visible: 1,
    })),
  }
}
const saveDemo = (s) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { /* private mode: state stays in this call only */ } }
const demo = (fn) => { const s = loadDemo(); const out = fn(s); saveDemo(s); return out }

// Moves due rows forward the way the worker cron would: scheduled -> posted/failed, publishing -> posted/failed.
function settle(s) {
  const t = now()
  for (const r of s.posts) {
    const due = (r.status === 'scheduled' && Date.parse(r.scheduled_at) <= t) || (r.status === 'publishing' && r.resolve_at <= t)
    if (!due) continue
    if (/#gagal/i.test(r.content || '')) {
      r.status = 'failed'
      r.error = 'Meta menolak posting (simulasi).'
    } else {
      r.status = 'posted'
      r.permalink = r.platform === 'instagram' ? `https://instagram.com/p/demo${r.id}` : `https://facebook.com/demo/${r.id}`
      r.published_at = new Date(t).toISOString()
    }
    delete r.resolve_at
  }
}

async function demoCreatePosts(contentId, platforms, scheduledAt, publishing) {
  const list = [...new Set(Array.isArray(platforms) ? platforms : [])]
  if (!list.length || !list.every((p) => PLATFORMS.includes(p))) throw new Error('Pilih platform Facebook dan/atau Instagram.')
  const { data } = await db().from('social_contents').select('*').eq('id', Number(contentId)).maybeSingle()
  if (!data) throw new Error('Konten tidak ditemukan.')
  return demo((s) => {
    if (!s.account) throw new Error('Hubungkan akun Facebook terlebih dahulu.')
    if (list.includes('instagram')) {
      if (!data.image_key) throw new Error('Instagram wajib memakai gambar.')
      const ig = igEligibility({ hasImage: true, width: 1, height: 1, caption: data.body || '' })
      if (!ig.ok) throw new Error(ig.reason)
    }
    return list.map((platform) => {
      const row = {
        id: ++s.seq, content_id: data.id, platform, content: data.body || '', image_key: data.image_key ?? null,
        status: publishing ? 'publishing' : 'scheduled', scheduled_at: scheduledAt, permalink: null, error: null,
        created_at: new Date(now()).toISOString(),
        ...(publishing ? { resolve_at: now() + 2000 } : {}),
      }
      s.posts.push(row)
      return { ...row }
    })
  })
}

const db = () => getCloud().database
const unwrap = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message || 'terjadi kesalahan'}`)
  return data
}

/* ------------------------------------------------------------------ account */
export async function getAccount() {
  if (isUsingMockCloud()) return { configured: true, account: demo((s) => s.account) }
  return call('/api/social/account')
}

export async function startConnect() {
  if (isUsingMockCloud()) {
    demo((s) => { s.account = { page_name: 'Demo Page', ig_username: 'demo', ig_connected: true, needs_reconnect: false } })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('satualur:db-write'))
    return
  }
  const { url } = await call('/api/social/oauth/start', { method: 'POST' })
  location.href = url
}

export async function listPagesToPick(pick) {
  if (isUsingMockCloud()) return [{ id: 'demo', name: 'Demo Page', ig_username: 'demo' }]
  return call(`/api/social/oauth/pages?pick=${encodeURIComponent(pick)}`)
}

export async function pickPage(pick, pageId) {
  if (isUsingMockCloud()) return startConnect()
  return call('/api/social/oauth/pick', { method: 'POST', body: { pick, page_id: pageId } })
}

export async function disconnect() {
  if (isUsingMockCloud()) { demo((s) => { s.account = null }); return }
  await call('/api/social/account', { method: 'DELETE' })
}

/* ------------------------------------------------------------------ media */
export async function uploadImage(blob) {
  if (isUsingMockCloud()) {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('') // same shape as an R2 key, so validators accept it
    objectUrls.set(key, typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '')
    return key
  }
  const { key } = await call('/api/social/media', { method: 'POST', raw: blob })
  return key
}

export function mediaUrl(key) {
  if (!key) return ''
  return isUsingMockCloud() ? (objectUrls.get(key) || '') : `/api/media/${encodeURIComponent(key)}`
}

/* ------------------------------------------------------------------ contents */
export async function listContents(kind) {
  let q = db().from('social_contents').select('*')
  if (kind) q = q.eq('kind', kind)
  return unwrap(await q.order('created_at', { ascending: false }), 'Gagal memuat konten') || []
}

export async function saveContent({ kind, body, title = null, image_key = null, platform = null, meta_json = null }) {
  const row = { kind, platform, title, body, meta_json, status: 'saved', image_key }
  return unwrap(await db().from('social_contents').insert(row), 'Gagal menyimpan')
}

export async function updateContent(id, patch) {
  unwrap(await db().from('social_contents').update(patch).eq('id', id), 'Gagal menyimpan')
}

export async function deleteContent(id) {
  unwrap(await db().from('social_contents').delete().eq('id', id), 'Gagal menghapus')
}

/* ------------------------------------------------------------------ publish / schedule */
export async function publishNow(contentId, platforms) {
  if (isUsingMockCloud()) {
    const rows = await demoCreatePosts(contentId, platforms, new Date(now()).toISOString(), true)
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    const ids = rows.map((r) => r.id)
    return demo((s) => {
      s.posts.forEach((r) => { if (ids.includes(r.id)) r.resolve_at = 0 })
      settle(s)
      return s.posts.filter((r) => ids.includes(r.id)).map((r) => ({ ...r }))
    })
  }
  // A lost response, network error or 5xx may still have posted: never invite a blind retry.
  let rows
  try {
    rows = await call('/api/social/publish', { method: 'POST', body: { content_id: contentId, platforms } })
  } catch (e) {
    if (e.status === undefined || e.status >= 500) throw new Error(UNCERTAIN)
    throw e
  }
  if (!Array.isArray(rows)) throw new Error(UNCERTAIN)
  return rows
}

export async function schedulePost(contentId, platforms, scheduledAtIso) {
  if (isUsingMockCloud()) {
    const err = validateScheduleAt(scheduledAtIso, now())
    if (err) throw new Error(err)
    return demoCreatePosts(contentId, platforms, new Date(scheduledAtIso).toISOString(), false)
  }
  return call('/api/social/schedule', { method: 'POST', body: { content_id: contentId, platforms, scheduled_at: scheduledAtIso } })
}

export async function cancelSchedule(id) {
  if (isUsingMockCloud()) {
    demo((s) => {
      const r = s.posts.find((p) => p.id === Number(id))
      if (!r) throw new Error('Jadwal tidak ditemukan.')
      settle(s)
      if (r.status !== 'scheduled') throw new Error('Jadwal sudah diproses.')
      r.status = 'cancelled'
    })
    return
  }
  await call(`/api/social/schedule/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listSchedules() {
  if (isUsingMockCloud()) {
    return demo((s) => {
      settle(s)
      return s.posts.map((r) => ({ ...r })).sort((a, b) => (b.scheduled_at < a.scheduled_at ? -1 : b.scheduled_at > a.scheduled_at ? 1 : b.id - a.id))
    })
  }
  return unwrap(await db().from('social_posts').select('*').order('scheduled_at', { ascending: false }), 'Gagal memuat jadwal') || []
}

/* ------------------------------------------------------------------ office */
const byName = (a, b) => a.name.localeCompare(b.name)
const newestFirst = (a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id)

export async function listInfluencers() {
  if (isUsingMockCloud()) {
    return demo((s) => s.influencers.filter((i) => i.visible === 1).sort(byName)
      .map(publicInfluencer))
  }
  return call('/api/office/influencers')
}

export async function sendRequest(body) {
  if (isUsingMockCloud()) {
    const v = validateServiceRequest(body)
    return demo((s) => {
      let inf = null
      if (v.kind === 'collab') {
        inf = s.influencers.find((i) => i.id === v.influencer_id && i.visible === 1)
        if (!inf) throw new Error('Influencer tidak tersedia.')
      }
      const at = new Date(now()).toISOString()
      const id = ++s.seq
      s.requests.push({ id, kind: v.kind, influencer_id: v.influencer_id, influencer_name: inf?.name ?? null, payload: v.payload,
        status: 'new', admin_note: '', created_at: at, updated_at: at, business_name: 'Pengguna Demo', business_email: 'demo@satualur.id' })
      return { id }
    })
  }
  return call('/api/office/requests', { method: 'POST', body })
}

export async function listMyRequests() {
  if (isUsingMockCloud()) return demo((s) => s.requests.map(({ business_name, business_email, ...r }) => r).sort(newestFirst))
  return call('/api/office/requests')
}

export async function adminListInfluencers() {
  if (isUsingMockCloud()) return demo((s) => s.influencers.map((i) => ({ ...i })).sort(byName))
  return call('/api/office/admin/influencers')
}

export async function adminSaveInfluencer(row) {
  if (isUsingMockCloud()) {
    return demo((s) => {
      const cur = row.id ? s.influencers.find((i) => i.id === Number(row.id)) : null
      if (row.id && !cur) throw new Error('Data tidak ditemukan.')
      const v = validateInfluencer({ ...cur, ...row })
      if (cur) { Object.assign(cur, v); return { id: cur.id } }
      const id = ++s.seq
      s.influencers.push({ id, ...v })
      return { id }
    })
  }
  const { id, ...fields } = row
  return id
    ? call(`/api/office/admin/influencers/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields })
    : call('/api/office/admin/influencers', { method: 'POST', body: fields })
}

export async function adminListRequests(status) {
  if (isUsingMockCloud()) {
    if (status && !REQUEST_STATUSES.includes(status)) throw new Error('Status tidak dikenal.')
    return demo((s) => s.requests.filter((r) => !status || r.status === status).map((r) => ({ ...r })).sort(newestFirst))
  }
  return call(`/api/office/admin/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`)
}

export async function adminUpdateRequest(id, patch) {
  if (isUsingMockCloud()) {
    demo((s) => {
      const r = s.requests.find((x) => x.id === Number(id))
      if (!r) throw new Error('Data tidak ditemukan.')
      if (patch.status === undefined && patch.admin_note === undefined) throw new Error('Tidak ada perubahan.')
      if (patch.status !== undefined && !REQUEST_STATUSES.includes(patch.status)) throw new Error('Status tidak dikenal.')
      const note = patch.admin_note === undefined ? undefined : patch.admin_note === null ? '' : String(patch.admin_note)
      if (note !== undefined && note.length > 2000) throw new Error('Catatan maksimal 2000 karakter.')
      if (patch.status !== undefined) r.status = patch.status
      if (note !== undefined) r.admin_note = note
      r.updated_at = new Date(now()).toISOString()
    })
    return
  }
  await call(`/api/office/admin/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

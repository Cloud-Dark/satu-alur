/**
 * Client for /api/social/repliz/* (the business's own Repliz workspace). In demo mode (mock cloud),
 * once Repliz keys are "saved" (src/integrations/api.js), accounts and posts are simulated in
 * localStorage `satualur_repliz_demo_v1`: connecting creates a demo account
 * at once, and a post moves pending -> success a moment after its time (or to error
 * when the text contains "#gagal").
 */
import { isUsingMockCloud } from '../cloud.js'
import { demoConnected } from '../integrations/api.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { REPLIZ_PLATFORMS, PLATFORM_KEYS, validatePost, postLink } from './rules.js'

const TOKEN_KEY = 'satualur_token'
const DEMO_KEY = 'satualur_repliz_demo_v1'
const token = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

async function call(path, { method = 'GET', body, raw } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(raw ? { 'Content-Type': raw.type } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
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
let now = () => Date.now()
export function __setNow(fn) { now = fn || (() => Date.now()) }

function loadDemo() {
  try {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY))
    if (s && Array.isArray(s.accounts) && Array.isArray(s.posts)) return s
  } catch { /* fresh */ }
  return { seq: 100, accounts: [], posts: [] }
}
const saveDemo = (s) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { /* private mode */ } }
const demo = (fn) => { const s = loadDemo(); const out = fn(s); saveDemo(s); return out }

function settle(s) {
  const t = now()
  for (const p of s.posts) {
    if (p.status !== 'pending' || Date.parse(p.scheduled_at) > t - 1500) continue
    if (/#gagal/i.test(p.preview || '')) {
      p.status = 'error'
      p.error = 'Platform menolak unggahan ini. Periksa media dan teksnya. (simulasi)'
    } else {
      p.status = 'success'
      p.post_id = `demo${p.id}`
    }
  }
}
const demoPostView = (p, s) => {
  const a = s.accounts.find((x) => x.id === p.account_id)
  return { ...p, account_label: a ? `@${a.username}` : '', link: p.status === 'success' ? postLink(p.platform, p.post_id, a?.username) : '' }
}

/* ------------------------------------------------------------------ api */
export async function status() {
  if (isUsingMockCloud()) {
    const s = loadDemo()
    return {
      enabled: true, configured: demoConnected('repliz'), demo: false,
      platforms: PLATFORM_KEYS.map((key) => ({ key, label: REPLIZ_PLATFORMS[key].label, types: REPLIZ_PLATFORMS[key].types })),
      capacity: demoConnected('repliz') ? { used: s.accounts.length, limit: 8 } : null,
    }
  }
  return call('/api/social/repliz/status')
}

export async function listAccounts() {
  if (isUsingMockCloud()) return loadDemo().accounts.map((a) => ({ ...a }))
  return call('/api/social/repliz/accounts')
}

// Real flow: leaves the app for the platform's sign-in page. Demo: connects a demo account in place.
export async function connect(platform, reconnect = null) {
  if (!REPLIZ_PLATFORMS[platform]) throw new Error('Platform tidak dikenal.')
  if (isUsingMockCloud()) {
    demo((s) => {
      const existing = s.accounts.find((a) => a.id === reconnect || (!reconnect && a.platform === platform))
      if (existing) { existing.needs_reconnect = false; return }
      s.accounts.push({ id: `demo-${platform}-${++s.seq}`, platform, username: `demo.${platform}`, name: `Usaha Demo (${REPLIZ_PLATFORMS[platform].label})`,
        picture: '', needs_reconnect: false, connected_at: new Date(now()).toISOString() })
    })
    return { connected: true }
  }
  const { url } = await call('/api/social/repliz/authorize', { method: 'POST', body: { platform, ...(reconnect ? { reconnect } : {}) } })
  location.href = url
  return { redirected: true }
}

export async function disconnect(id) {
  if (isUsingMockCloud()) {
    demo((s) => {
      s.accounts = s.accounts.filter((a) => a.id !== id)
      s.posts = s.posts.filter((p) => !(p.account_id === id && p.status === 'pending'))
    })
    return
  }
  await call(`/api/social/repliz/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getPick(id) {
  return call(`/api/social/repliz/picks/${encodeURIComponent(id)}`)
}

export async function choosePick(pick, entityId) {
  return call('/api/social/repliz/connect', { method: 'POST', body: { pick, entity_id: entityId } })
}

export async function listBoards(accountId) {
  if (isUsingMockCloud()) return [{ id: '1001', name: 'Inspirasi Usaha', picture: '' }, { id: '1002', name: 'Promo Bulanan', picture: '' }]
  return call(`/api/social/repliz/accounts/${encodeURIComponent(accountId)}/boards`)
}

// input: { account_id, type, description, title?, medias: [{ url }], scheduleAt?, privacy?, board? }
export async function schedule(input) {
  if (isUsingMockCloud()) {
    return demo((s) => {
      const a = s.accounts.find((x) => x.id === input.account_id)
      if (!a) throw new Error('Pilih akun yang terhubung.')
      if (a.needs_reconnect) throw new Error('Sambungkan ulang akun ini di tab Akun terlebih dahulu.')
      const v = validatePost(a.platform, input, now())
      if (v.error) throw new Error(v.error)
      const at = new Date(now()).toISOString()
      const row = { id: ++s.seq, schedule_id: `demo-sch-${s.seq}`, account_id: a.id, platform: a.platform, type: v.post.type,
        preview: (v.post.description || v.post.title || '').slice(0, 280), status: 'pending', post_id: null, error: null,
        scheduled_at: v.post.scheduleAt, created_at: at }
      s.posts.push(row)
      return demoPostView(row, s)
    })
  }
  return call('/api/social/repliz/schedule', { method: 'POST', body: input })
}

export async function listPosts() {
  if (isUsingMockCloud()) {
    return demo((s) => {
      settle(s)
      return s.posts.map((p) => demoPostView(p, s)).sort((a, b) => (b.scheduled_at < a.scheduled_at ? -1 : b.scheduled_at > a.scheduled_at ? 1 : b.id - a.id))
    })
  }
  return call('/api/social/repliz/schedules')
}

export async function cancelPost(id) {
  if (isUsingMockCloud()) {
    demo((s) => {
      settle(s)
      const p = s.posts.find((x) => x.id === Number(id))
      if (!p) throw new Error('Jadwal tidak ditemukan.')
      if (p.status !== 'pending') throw new Error('Jadwal sudah diproses.')
      s.posts = s.posts.filter((x) => x !== p)
    })
    return
  }
  await call(`/api/social/repliz/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// Uploads an image/video file to the platform's media storage; returns { url, type }.
export async function uploadMedia(file) {
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(file?.type)) throw new Error('Berkas harus JPG, PNG, atau MP4.')
  if (file.size > 50 * 1024 * 1024) throw new Error('Berkas maksimal 50 MB.')
  if (isUsingMockCloud()) return { url: `https://contoh.satualur.id/media/demo-${Date.now()}.${file.type === 'video/mp4' ? 'mp4' : 'jpg'}`, type: file.type.startsWith('video/') ? 'video' : 'image' }
  return call('/api/social/repliz/media', { method: 'POST', raw: file })
}

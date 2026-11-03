/**
 * Social accounts through the business's own Repliz workspace: platform table and post validation,
 * shared by the Worker (worker/repliz.js), the client (src/repliz/api.js) and the demo store.
 *
 * flow:
 *   'code'     authorize -> provider redirects back with ?code= -> connect { code }
 *   'exchange' authorize -> ?code= -> exchange { code } -> list entities -> connect { <entityKey>, token }
 *   'fragment' like 'exchange', but Facebook returns #access_token=… in the URL fragment (sent as code)
 */

export const REPLIZ_PLATFORMS = {
  instagram: { label: 'Instagram', flow: 'code', types: ['image', 'video', 'album'] },
  facebook: { label: 'Facebook', flow: 'fragment', entity: 'page', entityKey: 'pageId', entityLabel: 'Halaman Facebook', types: ['text', 'image', 'video', 'album'] },
  threads: { label: 'Threads', flow: 'code', types: ['text', 'image', 'video', 'album'] },
  tiktok: { label: 'TikTok', flow: 'code', types: ['image', 'video', 'album'] },
  youtube: { label: 'YouTube', flow: 'exchange', entity: 'channel', entityKey: 'channelId', entityLabel: 'Kanal YouTube', types: ['video'] },
  linkedin: { label: 'LinkedIn', flow: 'exchange', entity: 'organization', entityKey: 'organizationId', entityLabel: 'Halaman LinkedIn', types: ['image', 'video', 'album'] },
  // X: Repliz lists no post types for it; text, image and video are what X itself accepts.
  twitter: { label: 'X', flow: 'code', types: ['text', 'image', 'video'] },
  pinterest: { label: 'Pinterest', flow: 'code', types: ['image', 'video', 'album'], needsBoard: true },
}
export const PLATFORM_KEYS = Object.keys(REPLIZ_PLATFORMS)

export const POST_TYPES = {
  text: { label: 'Teks', medias: [0, 0], media: null },
  image: { label: 'Gambar', medias: [1, 1], media: 'image' },
  video: { label: 'Video', medias: [1, 1], media: 'video' },
  album: { label: 'Album', medias: [2, 5], media: 'image' },
}

export const SCHEDULE_STATUS = { pending: 'Terjadwal', process: 'Diproses', success: 'Tayang', error: 'Gagal' }
export const CAPTION_MAX = 2200
export const TITLE_MAX = 100

const httpsUrl = (u) => {
  try { return new URL(String(u)).protocol === 'https:' } catch { return false }
}

/**
 * Validates a post for one platform. input: { type, description, title, medias: [{ url }], scheduleAt, board }.
 * Returns { error } or { post } ready for POST /public/schedule (accountId added by the caller).
 */
export function validatePost(platform, input, now = Date.now()) {
  const p = REPLIZ_PLATFORMS[platform]
  if (!p) return { error: 'Platform tidak dikenal.' }
  const type = String(input?.type || '')
  const t = POST_TYPES[type]
  if (!t) return { error: 'Jenis unggahan tidak dikenal.' }
  if (!p.types.includes(type)) return { error: `${p.label} tidak mendukung unggahan ${t.label.toLowerCase()}.` }
  const description = String(input.description ?? '').trim()
  if (type === 'text' && !description) return { error: 'Tulis isi unggahan.' }
  if (description.length > CAPTION_MAX) return { error: `Teks maksimal ${CAPTION_MAX} karakter.` }
  if (platform === 'threads' && type === 'text' && description.length > 500) return { error: 'Teks Threads maksimal 500 karakter.' }
  const title = String(input.title ?? '').trim().slice(0, TITLE_MAX)
  if (platform === 'youtube' && !title) return { error: 'Video YouTube wajib punya judul.' }
  const urls = (Array.isArray(input.medias) ? input.medias : []).map((m) => String(m?.url ?? m ?? '').trim()).filter(Boolean)
  const [min, max] = t.medias
  if (urls.length < min || urls.length > max) {
    return { error: min === max ? (min ? `Unggahan ${t.label.toLowerCase()} perlu 1 tautan media.` : 'Unggahan teks tidak memakai media.') : `Album perlu ${min}–${max} gambar.` }
  }
  if (urls.some((u) => !httpsUrl(u))) return { error: 'Tautan media harus diawali https://.' }
  // No time = post now: Repliz picks up due schedules every minute.
  let scheduleAt = input.scheduleAt ? Date.parse(input.scheduleAt) : now
  if (!Number.isFinite(scheduleAt)) return { error: 'Waktu tayang tidak valid.' }
  if (scheduleAt < now - 5 * 60 * 1000) return { error: 'Waktu tayang sudah lewat.' }
  if (scheduleAt > now + 180 * 24 * 3600 * 1000) return { error: 'Waktu tayang maksimal 6 bulan ke depan.' }
  scheduleAt = Math.max(scheduleAt, now)
  let board = null
  if (p.needsBoard) {
    if (!input.board?.id) return { error: 'Pilih papan Pinterest.' }
    board = { id: String(input.board.id), name: String(input.board.name || ''), picture: String(input.board.picture || ''), type: 'board' }
  }
  const post = {
    title: ['youtube', 'pinterest', 'tiktok', 'facebook'].includes(platform) ? title : '',
    description,
    topic: '',
    type,
    medias: urls.map((url) => ({ type: t.media, url })),
    replies: [],
    scheduleAt: new Date(scheduleAt).toISOString(),
    additionalInfo: {
      ...(platform === 'youtube' ? { privacy: ['public', 'unlisted', 'private'].includes(input.privacy) ? input.privacy : 'public' } : {}),
      ...(board ? { channel: board } : {}),
    },
  }
  return { post }
}

// Repliz account object -> what the app shows.
export function accountView(a, platformHint) {
  return {
    id: String(a?._id || a?.id || ''),
    platform: a?.type || platformHint || '',
    name: a?.name || '',
    username: a?.username || '',
    picture: typeof a?.picture === 'string' && a.picture.startsWith('https://') ? a.picture : '',
    connected: a?.isConnected !== false,
  }
}

// Public link to a published post, when the platform makes one from the post id.
export function postLink(platform, postId, username) {
  if (!postId || /^INBOX_/.test(postId)) return ''
  const id = encodeURIComponent(postId)
  if (platform === 'youtube') return `https://youtu.be/${id}`
  if (platform === 'twitter') return `https://x.com/i/web/status/${id}`
  if (platform === 'threads' && username) return `https://www.threads.net/@${encodeURIComponent(username)}/post/${id}`
  if (platform === 'facebook') return `https://www.facebook.com/${id}`
  if (platform === 'tiktok' && username) return `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${id}`
  return ''
}

// Messages the connect callback may put in #/social-media?repliz_error=… . The URL is attacker-controllable,
// so the page echoes only these and shows a generic message for anything else.
export const CALLBACK_MESSAGES = [
  'Koneksi dibatalkan.', 'Sesi koneksi kedaluwarsa, coba lagi.', 'Koneksi gagal, coba lagi.',
  'Hubungkan akun Repliz Anda terlebih dahulu di Media Sosial › Akun.', 'Tidak tersedia di akun demo.',
  'Kunci Repliz ditolak. Periksa Access key dan Secret key di Media Sosial › Akun.', 'Fitur ini butuh paket Repliz yang lebih tinggi.',
  'Permintaan ditolak oleh platform media sosial. Periksa isinya lalu coba lagi.', 'Terlalu banyak permintaan. Coba lagi sebentar.',
  'Layanan media sosial sedang bermasalah. Coba lagi nanti.', 'Layanan media sosial tidak menjawab. Coba lagi sebentar.',
  'Tidak dapat menghubungi layanan media sosial.', 'Platform tidak mengembalikan akun.', 'Platform tidak mengembalikan izin akses.',
  ...Object.values(REPLIZ_PLATFORMS).filter((p) => p.entityLabel).map((p) => `Tidak ada ${p.entityLabel} yang bisa dihubungkan.`),
]
export const safeCallbackMessage = (m) => (CALLBACK_MESSAGES.includes(m) ? m : 'Koneksi gagal, coba lagi.')

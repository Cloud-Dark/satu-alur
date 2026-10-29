/**
 * Social accounts the user links on the Media sosial page.
 *
 * There is no platform login yet, so "connecting" an account means saving its
 * handle (or WhatsApp number) on this device, per user. The page uses it to
 * open the right profile and to pick default platforms. Nothing is posted
 * automatically.
 */

const KEY = 'satualur_social_accounts'
const EVENT = 'satualur:social-accounts'

const clean = (v) => String(v ?? '').trim()

/** Pulls the first path segment out of a profile URL on one of `hosts`. */
function fromUrl(input, hosts) {
  let u
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`) } catch { return null }
  const host = u.hostname.replace(/^(www|m|mobile)\./i, '').toLowerCase()
  if (!hosts.includes(host)) return null
  return u.pathname.split('/').filter(Boolean)
}

const looksLikeUrl = (s) => /^https?:\/\//i.test(s) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(s)

function handleParser({ hosts, re, at = false, hint }) {
  return (raw) => {
    let s = clean(raw)
    if (!s) return { error: 'Isi nama pengguna atau tautan profil.' }
    if (looksLikeUrl(s)) {
      const parts = fromUrl(s, hosts)
      if (!parts?.length) return { error: `Tautan bukan profil ${hint}.` }
      s = parts[0]
    }
    s = s.replace(/^@/, '')
    if (!re.test(s)) return { error: `Nama pengguna ${hint} tidak valid.` }
    return { handle: s, display: at ? `@${s}` : s }
  }
}

function parseLinkedIn(raw) {
  const s = clean(raw)
  if (!s) return { error: 'Isi tautan profil atau halaman LinkedIn.' }
  const re = /^[A-Za-z0-9-_%]{3,100}$/
  if (looksLikeUrl(s)) {
    const parts = fromUrl(s, ['linkedin.com'])
    if (!parts || parts.length < 2 || !['in', 'company'].includes(parts[0]) || !re.test(parts[1])) {
      return { error: 'Gunakan tautan linkedin.com/in/… atau linkedin.com/company/….' }
    }
    return { handle: `${parts[0]}/${parts[1]}`, display: parts[1] }
  }
  const slug = s.replace(/^@/, '')
  if (!re.test(slug)) return { error: 'Nama profil LinkedIn tidak valid.' }
  return { handle: `in/${slug}`, display: slug }
}

/** Indonesian mobile numbers: 08… / +628… / 628… -> 628… */
export function normalizeWaNumber(raw) {
  let s = clean(raw)
  if (looksLikeUrl(s)) {
    const parts = fromUrl(s, ['wa.me', 'api.whatsapp.com'])
    if (!parts) return null
    s = parts[0] || ''
  }
  const digits = s.replace(/[\s().-]/g, '').replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  const n = digits.startsWith('0') ? `62${digits.slice(1)}` : digits
  return /^62[1-9]\d{7,12}$/.test(n) ? n : null
}

function parseWhatsApp(raw) {
  if (!clean(raw)) return { error: 'Isi nomor WhatsApp bisnis.' }
  const n = normalizeWaNumber(raw)
  if (!n) return { error: 'Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.' }
  return { handle: n, display: `+${n}` }
}

const enc = encodeURIComponent

/**
 * profile(handle) -> profile URL; compose(text, handle) -> URL that opens the
 * platform's own composer (text prefilled where the platform allows it).
 */
export const ACCOUNT_PLATFORMS = [
  {
    value: 'instagram', mark: 'IG', placeholder: '@namausaha atau instagram.com/namausaha',
    parse: handleParser({ hosts: ['instagram.com'], re: /^[A-Za-z0-9._]{1,30}$/, at: true, hint: 'Instagram' }),
    profile: (h) => `https://www.instagram.com/${h}/`,
    compose: () => 'https://www.instagram.com/',
  },
  {
    value: 'tiktok', mark: 'TT', placeholder: '@namausaha atau tiktok.com/@namausaha',
    parse: handleParser({ hosts: ['tiktok.com'], re: /^[A-Za-z0-9._]{2,24}$/, at: true, hint: 'TikTok' }),
    profile: (h) => `https://www.tiktok.com/@${h}`,
    compose: () => 'https://www.tiktok.com/upload',
  },
  {
    value: 'facebook', mark: 'FB', placeholder: 'facebook.com/namahalaman',
    parse: handleParser({ hosts: ['facebook.com', 'fb.com'], re: /^[A-Za-z0-9.-]{3,80}$/, hint: 'Facebook' }),
    profile: (h) => `https://www.facebook.com/${h}`,
    compose: (_t, h) => (h ? `https://www.facebook.com/${h}` : 'https://www.facebook.com/'),
  },
  {
    value: 'threads', mark: '@', placeholder: '@namausaha atau threads.net/@namausaha',
    parse: handleParser({ hosts: ['threads.net', 'threads.com'], re: /^[A-Za-z0-9._]{1,30}$/, at: true, hint: 'Threads' }),
    profile: (h) => `https://www.threads.net/@${h}`,
    compose: (t) => `https://www.threads.net/intent/post?text=${enc(t || '')}`,
  },
  {
    value: 'linkedin', mark: 'in', placeholder: 'linkedin.com/company/namausaha',
    parse: parseLinkedIn,
    profile: (h) => `https://www.linkedin.com/${h}/`,
    compose: (t) => `https://www.linkedin.com/feed/?shareActive=true&text=${enc(t || '')}`,
  },
  {
    value: 'whatsapp', mark: 'WA', placeholder: '0812 3456 7890',
    parse: parseWhatsApp,
    profile: (h) => `https://wa.me/${h}`,
    compose: (t) => `https://wa.me/?text=${enc(t || '')}`,
  },
  {
    value: 'x', mark: 'X', placeholder: '@namausaha atau x.com/namausaha',
    parse: handleParser({ hosts: ['x.com', 'twitter.com'], re: /^[A-Za-z0-9_]{1,15}$/, at: true, hint: 'X' }),
    profile: (h) => `https://x.com/${h}`,
    compose: (t) => `https://x.com/intent/post?text=${enc(t || '')}`,
  },
]

export const accountPlatform = (v) => ACCOUNT_PLATFORMS.find((p) => p.value === v) || null

/** Validates user input for one platform: { handle, display } or { error }. */
export function parseAccount(platform, input) {
  const p = accountPlatform(platform)
  if (!p) return { error: 'Platform tidak dikenal.' }
  return p.parse(input)
}

/** URL that opens the platform with `text` ready (or its home/profile). */
export function composeUrl(platform, text, account) {
  const p = accountPlatform(platform)
  return p ? p.compose(text, account?.handle) : null
}

export function profileUrl(platform, account) {
  const p = accountPlatform(platform)
  return p && account?.handle ? p.profile(account.handle) : null
}

const keyFor = (userId) => `${KEY}:${userId || 'anon'}`

/** { [platform]: { handle, display, name, connected_at } } for this user. */
export function loadAccounts(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(userId)) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out = {}
    for (const p of ACCOUNT_PLATFORMS) {
      const a = raw[p.value]
      if (a && typeof a.handle === 'string' && a.handle) out[p.value] = a
    }
    return out
  } catch {
    return {}
  }
}

function persist(userId, accounts) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(accounts)) } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId } })) } catch { /* no window */ }
  return accounts
}

export function connectAccount(userId, platform, input, name = '') {
  const res = parseAccount(platform, input)
  if (res.error) return res
  const accounts = loadAccounts(userId)
  accounts[platform] = { handle: res.handle, display: res.display, name: clean(name).slice(0, 80), connected_at: new Date().toISOString() }
  persist(userId, accounts)
  return { account: accounts[platform] }
}

export function disconnectAccount(userId, platform) {
  const accounts = loadAccounts(userId)
  delete accounts[platform]
  return persist(userId, accounts)
}

/** Connected platforms in page order (used for default selections). */
export function connectedPlatforms(accounts, order = ACCOUNT_PLATFORMS.map((p) => p.value)) {
  return order.filter((v) => accounts?.[v])
}

export function onAccountsChange(fn) {
  const h = () => fn()
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

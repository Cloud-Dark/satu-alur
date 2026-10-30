/**
 * Meta Graph client (Facebook Pages + Instagram publishing) and the Threads API client. Fetch-only so it
 * runs in the Cloudflare Worker; `fetchFn` is always injected. Tokens go in
 * `access_token` form/query fields and are never logged.
 */

export const GRAPH = 'https://graph.facebook.com/v21.0'
export const THREADS = 'https://graph.threads.net'
const RATE_LIMIT_CODES = [4, 17, 32, 613]
const SCOPE = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management'

export class MetaError extends Error {
  constructor(message, { code = null, subcode = null, kind = 'fatal' } = {}) {
    super(message)
    this.name = 'MetaError'
    this.code = code
    this.subcode = subcode
    this.kind = kind
  }
}

export function classifyMetaError(status, body) {
  const e = body && body.error
  const code = e && e.code
  if (code === 190 || code === 102) return 'token'
  if (status >= 500 || RATE_LIMIT_CODES.includes(code) || (e && e.is_transient)) return 'transient'
  return 'fatal'
}

export function oauthUrl({ appId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, scope: SCOPE, response_type: 'code' })
  return `https://www.facebook.com/v21.0/dialog/oauth?${q}`
}

async function call(fetchFn, url, init) {
  let res
  try {
    res = await fetchFn(url, init)
  } catch {
    throw new MetaError('Meta API tidak dapat dijangkau', { kind: 'transient' })
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    const e = body.error || {}
    throw new MetaError(e.message || `Meta API error (HTTP ${res.status})`, {
      code: e.code ?? null,
      subcode: e.error_subcode ?? null,
      kind: classifyMetaError(res.status, body),
    })
  }
  return body
}

const get = (fetchFn, path, params, base = GRAPH) => call(fetchFn, `${base}${path}?${new URLSearchParams(params)}`)
const post = (fetchFn, path, params, base = GRAPH) => call(fetchFn, `${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params),
})

export async function exchangeCode({ appId, appSecret, redirectUri, code }, fetchFn) {
  const short = await get(fetchFn, '/oauth/access_token', { client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code })
  const long = await get(fetchFn, '/oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.access_token,
  })
  return long.access_token
}

export function parsePages(json) {
  return ((json && json.data) || []).map((p) => ({
    id: p.id,
    name: p.name,
    token: p.access_token,
    igUserId: p.instagram_business_account?.id ?? null,
    igUsername: p.instagram_business_account?.username ?? null,
  }))
}

export async function listPages(userToken, fetchFn) {
  return parsePages(await get(fetchFn, '/me/accounts', {
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: userToken,
  }))
}

// The post already exists by now: a failed lookup must not fail it (a retry would double post).
async function permalinkOf(fetchFn, id, field, pageToken, base) {
  try {
    return (await get(fetchFn, `/${id}`, { fields: field, access_token: pageToken }, base))[field] ?? null
  } catch {
    return null
  }
}

// The call that creates the live post: a transient failure (timeout, 5xx) may mean it went out anyway,
// so it is flagged ambiguous and must never be retried. Rate limits are rejected before posting.
async function postFinal(fetchFn, path, params, base) {
  try {
    return await post(fetchFn, path, params, base)
  } catch (e) {
    if (e instanceof MetaError && e.kind === 'transient' && !RATE_LIMIT_CODES.includes(e.code)) e.ambiguous = true
    throw e
  }
}

export async function postFacebook({ pageId, pageToken, message, imageUrl }, fetchFn) {
  const r = imageUrl
    ? await postFinal(fetchFn, `/${pageId}/photos`, { url: imageUrl, caption: message, access_token: pageToken })
    : await postFinal(fetchFn, `/${pageId}/feed`, { message, access_token: pageToken })
  return { id: r.id, permalink: await permalinkOf(fetchFn, r.id, 'permalink_url', pageToken) }
}

const IG_POLLS = 5
const IG_POLL_MS = 1500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const IG_CONTAINER = { field: 'status_code', rejected: 'Instagram menolak gambar ini.', pending: 'Instagram masih memproses gambar, coba lagi nanti.' }
const TH_CONTAINER = { field: 'status', rejected: 'Threads menolak konten ini.', pending: 'Threads masih memproses konten, coba lagi nanti.', base: `${THREADS}/v1.0` }

// Instagram and Threads fetch media asynchronously: publishing before the container is FINISHED fails.
async function waitForContainer(fetchFn, id, token, wait, { field, rejected, pending, base }) {
  for (let i = 0; i < IG_POLLS; i++) {
    if (i > 0) await wait(IG_POLL_MS)
    const s = (await get(fetchFn, `/${id}`, { fields: field, access_token: token }, base))[field]
    if (s === 'FINISHED') return
    if (s === 'ERROR' || s === 'EXPIRED') throw new MetaError(rejected)
  }
  throw new MetaError(pending, { kind: 'transient' })
}

export async function postInstagram({ igUserId, pageToken, caption, imageUrl, wait = sleep }, fetchFn) {
  const c = await post(fetchFn, `/${igUserId}/media`, { image_url: imageUrl, caption, access_token: pageToken })
  await waitForContainer(fetchFn, c.id, pageToken, wait, IG_CONTAINER)
  const m = await postFinal(fetchFn, `/${igUserId}/media_publish`, { creation_id: c.id, access_token: pageToken })
  return { id: m.id, permalink: await permalinkOf(fetchFn, m.id, 'permalink', pageToken) }
}

// ------------------------------------------------------------------ Threads

export function threadsOauthUrl({ appId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, scope: 'threads_basic,threads_content_publish', response_type: 'code', state })
  return `https://threads.net/oauth/authorize?${q}`
}

/** Code -> short-lived token -> long-lived token (about 60 days). */
export async function exchangeThreadsCode({ appId, appSecret, redirectUri, code }, fetchFn) {
  const short = await post(fetchFn, '/oauth/access_token', {
    client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code,
  }, THREADS)
  const long = await get(fetchFn, '/access_token', { grant_type: 'th_exchange_token', client_secret: appSecret, access_token: short.access_token }, THREADS)
  return { token: long.access_token, expiresIn: long.expires_in }
}

export async function refreshThreadsToken(token, fetchFn) {
  const r = await get(fetchFn, '/refresh_access_token', { grant_type: 'th_refresh_token', access_token: token }, THREADS)
  return { token: r.access_token, expiresIn: r.expires_in }
}

export async function threadsProfile(token, fetchFn) {
  const r = await get(fetchFn, '/v1.0/me', { fields: 'id,username', access_token: token }, THREADS)
  return { id: r.id, username: r.username }
}

export async function postThreads({ threadsUserId, token, text, imageUrl, wait = sleep }, fetchFn) {
  const base = `${THREADS}/v1.0`
  const c = await post(fetchFn, `/${threadsUserId}/threads`, {
    media_type: imageUrl ? 'IMAGE' : 'TEXT', text, ...(imageUrl ? { image_url: imageUrl } : {}), access_token: token,
  }, base)
  await waitForContainer(fetchFn, c.id, token, wait, TH_CONTAINER)
  const m = await postFinal(fetchFn, `/${threadsUserId}/threads_publish`, { creation_id: c.id, access_token: token }, base)
  return { id: m.id, permalink: await permalinkOf(fetchFn, m.id, 'permalink', token, base) }
}

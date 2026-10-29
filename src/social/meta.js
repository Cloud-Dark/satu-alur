/**
 * Meta Graph client (Facebook Pages + Instagram publishing). Fetch-only so it
 * runs in the Cloudflare Worker; `fetchFn` is always injected. Tokens go in
 * `access_token` form/query fields and are never logged.
 */

export const GRAPH = 'https://graph.facebook.com/v21.0'
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

const get = (fetchFn, path, params) => call(fetchFn, `${GRAPH}${path}?${new URLSearchParams(params)}`)
const post = (fetchFn, path, params) => call(fetchFn, `${GRAPH}${path}`, {
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
async function permalinkOf(fetchFn, id, field, pageToken) {
  try {
    return (await get(fetchFn, `/${id}`, { fields: field, access_token: pageToken }))[field] ?? null
  } catch {
    return null
  }
}

// The call that creates the live post: a transient failure (timeout, 5xx) may mean it went out anyway,
// so it is flagged ambiguous and must never be retried. Rate limits are rejected before posting.
async function postFinal(fetchFn, path, params) {
  try {
    return await post(fetchFn, path, params)
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

export async function postInstagram({ igUserId, pageToken, caption, imageUrl }, fetchFn) {
  const c = await post(fetchFn, `/${igUserId}/media`, { image_url: imageUrl, caption, access_token: pageToken })
  const m = await postFinal(fetchFn, `/${igUserId}/media_publish`, { creation_id: c.id, access_token: pageToken })
  return { id: m.id, permalink: await permalinkOf(fetchFn, m.id, 'permalink', pageToken) }
}

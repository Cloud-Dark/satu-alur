/**
 * Client for /api/mcp-tokens and /api/oauth/* (Pengaturan › Akses AI (MCP), consent page #/izin-ai).
 * In mock mode (dev, e2e) the mock cloud keeps simulated tokens and grants instead
 * (src/mock/mock-cloud.js `mcpTokens`, `aiOAuth`); they do not work against a server.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { t } from '../i18n/index.js'

const TOKEN_KEY = 'satualur_token'
const session = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session() ? { Authorization: `Bearer ${session()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(t('consent.errors.network'))
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

const mock = () => (isUsingMockCloud() ? getCloud().mcpTokens : null)

/** -> { items: [{ id, name, prefix, created_at, last_used_at }], demo, max } */
export function listTokens() {
  return mock()?.list() ?? call('/api/mcp-tokens')
}

/** -> { token, item } — the plain token is only in this answer. */
export function createToken(name) {
  return mock()?.create({ name }) ?? call('/api/mcp-tokens', { method: 'POST', body: { name } })
}

export function revokeToken(id) {
  return mock()?.revoke(id) ?? call(`/api/mcp-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---- Akses AI by login (OAuth, worker/oauth.js): consent page #/izin-ai and connected apps ----
const mockOAuth = () => (isUsingMockCloud() ? getCloud().aiOAuth : null)

/** -> { client_name, redirect_host, scope, read_only, tools, account, refused, expires_at } */
export function getAuthRequest(req) {
  return mockOAuth()?.request(req) ?? call(`/api/oauth/request?req=${encodeURIComponent(req)}`)
}

/** -> { approved, redirect }: the caller sends the browser to `redirect` (back to Claude). */
export function decideAuthRequest(req, approve) {
  return mockOAuth()?.decide(req, approve) ?? call('/api/oauth/decision', { method: 'POST', body: { req, approve: Boolean(approve) } })
}

/** -> { items: [{ id, client_name, redirect_host, created_at, last_used_at }], demo } */
export function listGrants() {
  return mockOAuth()?.grants() ?? call('/api/oauth/grants')
}

/** "Putuskan": every token of that app stops working. */
export function revokeGrant(id) {
  return mockOAuth()?.revokeGrant(id) ?? call(`/api/oauth/grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

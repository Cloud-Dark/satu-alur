/**
 * Client for /api/mcp-tokens (Pengaturan › Akses AI (MCP)). In mock mode (dev, e2e) the mock cloud
 * keeps simulated tokens instead (src/mock/mock-cloud.js `mcpTokens`); they do not work against a server.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'

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

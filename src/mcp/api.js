import { t } from '../i18n/index.js'
/**
 * Thin HTTP client for /api/mcp/*.
 *
 * Mirrors the envelope used everywhere else: { data, error } with an
 * `Authorization: Bearer` header. Kept separate from connector.js so the
 * mock implementation never needs to know about fetch.
 */

function token() {
  try { return localStorage.getItem('satualur_token') } catch { return null }
}

export async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(t('erp.common.network'))
  }

  let json = null
  try { json = await res.json() } catch { /* not JSON */ }

  if (!res.ok || json?.error) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return json?.data
}

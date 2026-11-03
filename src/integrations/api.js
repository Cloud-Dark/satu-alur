/**
 * Client for /api/integrations (the business's own WAPilot / WAConsole / Repliz keys).
 * In demo mode (mock cloud) the keys are not kept at all: only the last 4 characters and the plain
 * settings go to localStorage `satualur_integrations_demo_v1`, enough to drive the simulated flows.
 */
import { isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { INTEGRATIONS, INTEGRATION_KEYS, validateCredentials } from './rules.js'

const TOKEN_KEY = 'satualur_token'
const DEMO_KEY = 'satualur_integrations_demo_v1'
const token = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }

async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
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

function loadDemo() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {} } catch { return {} }
}
const saveDemo = (s) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { /* private mode */ } }

// Demo only: which providers have (simulated) keys.
export const demoConnected = (provider) => isUsingMockCloud() && Boolean(loadDemo()[provider])

export async function list() {
  if (isUsingMockCloud()) {
    const s = loadDemo()
    return {
      enabled: true, demo: false,
      items: INTEGRATION_KEYS.map((key) => {
        const def = INTEGRATIONS[key]
        const r = s[key]
        return {
          provider: key, label: def.label, kind: def.kind, help: def.help, url: def.url,
          fields: def.fields.map(({ key: k, label, secret, required, placeholder }) => ({ key: k, label, secret, required, placeholder: placeholder || '' })),
          connected: Boolean(r), hint: r?.hint || '', meta: r?.meta || {}, verified_at: r?.verified_at || null,
        }
      }),
    }
  }
  return call('/api/integrations')
}

export async function save(provider, fields) {
  const v = validateCredentials(provider, fields)
  if (v.error) throw new Error(v.error)
  if (isUsingMockCloud()) {
    const s = loadDemo()
    const verified = !(provider === 'waconsole' && !v.meta.device_id)
    s[provider] = { hint: v.hint, meta: v.meta, verified_at: verified ? new Date().toISOString() : null }
    saveDemo(s)
    return { provider, connected: true, hint: v.hint, verified, note: verified ? null : 'Kunci disimpan. Tambahkan ID perangkat agar status perangkat bisa diperiksa.' }
  }
  return call(`/api/integrations/${encodeURIComponent(provider)}`, { method: 'PUT', body: { ...v.meta, ...v.secrets } })
}

export async function remove(provider) {
  if (isUsingMockCloud()) {
    const s = loadDemo()
    delete s[provider]
    saveDemo(s)
    return
  }
  await call(`/api/integrations/${encodeURIComponent(provider)}`, { method: 'DELETE' })
}

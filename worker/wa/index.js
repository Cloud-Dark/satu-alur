/**
 * WhatsApp provider abstraction. Every provider takes Indonesian numbers as '628…' (country code, no plus) and a
 * cfg object with the credentials of ONE business (see src/integrations/rules.js for the fields):
 *   wapilot   { token, base_url? }
 *   waconsole { app_key, auth_key, device_id?, base_url? }
 *
 *   PROVIDERS                                    ['wapilot', 'waconsole']
 *   providerReady(provider, cfg)                 credentials present
 *   sendText({ provider, to, text }, cfg, fetchImpl)   resolves when the provider accepted the message; throws WaError
 *   status(provider, cfg, fetchImpl, cacheKey?)  { connected, device, license, note? }  (cached 60 s per cacheKey)
 *   verify(provider, cfg, fetchImpl)             read-only check used when credentials are saved: { verified, note? }
 *   platformConfig(provider, env)                the platform's own credentials, ONLY when WA_PLATFORM_FALLBACK = "true"
 *
 * Callers (worker/whatsapp.js) own the rules: who may receive, the daily cap, demo simulation and the audit log.
 */
import { WaError } from './errors.js'
import { createWapilot, wapilotReady, wapilotView } from './wapilot.js'
import { createWaconsole, waconsoleReady, waconsoleView } from './waconsole.js'

export { WaError }
export const PROVIDERS = ['wapilot', 'waconsole']
export const PROVIDER_LABEL = { wapilot: 'WAPilot', waconsole: 'WAConsole' }
const CACHE_MS = 60 * 1000

export function providerReady(provider, cfg) {
  if (provider === 'wapilot') return wapilotReady(cfg)
  if (provider === 'waconsole') return waconsoleReady(cfg)
  return false
}

export async function sendText({ provider, to, text }, cfg, fetchImpl = fetch) {
  if (!providerReady(provider, cfg)) throw new WaError(503, 'WhatsApp belum dihubungkan. Isi kunci akun di Pengaturan › Konektor.')
  if (provider === 'waconsole') return createWaconsole(cfg, fetchImpl).sendText(to, text)
  return createWapilot(cfg, fetchImpl).sendText(to, text)
}

let cache = new Map()
export function __resetStatusCache() { cache = new Map() }

export async function status(provider, cfg, fetchImpl = fetch, cacheKey = null) {
  if (!providerReady(provider, cfg)) return { connected: false, device: null, license: null }
  const key = cacheKey ? `${provider}:${cacheKey}` : null
  const hit = key && cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.view
  let view
  if (provider === 'waconsole') {
    view = waconsoleView(await createWaconsole(cfg, fetchImpl).session())
  } else {
    const wa = createWapilot(cfg, fetchImpl)
    const [s, me] = await Promise.all([wa.status(), wa.me()])
    view = wapilotView(s, me)
  }
  if (key) {
    if (cache.size > 500) cache.clear()
    cache.set(key, { at: Date.now(), view })
  }
  return view
}
export const forgetStatus = (provider, cacheKey) => cache.delete(`${provider}:${cacheKey}`)

// Read-only check when credentials are saved. WAPilot: GET /me. WAConsole: session status when a device id is
// given; without one there is no harmless call, so the keys are stored unverified.
export async function verify(provider, cfg, fetchImpl = fetch) {
  if (provider === 'wapilot') {
    await createWapilot(cfg, fetchImpl).me()
    return { verified: true }
  }
  if (provider === 'waconsole') {
    const s = await createWaconsole(cfg, fetchImpl).session()
    if (!s) return { verified: false, note: 'Kunci disimpan. Tambahkan ID perangkat agar status perangkat bisa diperiksa.' }
    if (!s.success) throw new WaError(400, 'ID perangkat tidak dikenali WAConsole.')
    return { verified: true }
  }
  throw new WaError(400, 'Integrasi tidak dikenal.')
}

// The platform's credentials (Worker secrets), used for businesses ONLY when an admin turns the fallback on.
export function platformConfig(provider, env) {
  if (env.WA_PLATFORM_FALLBACK !== 'true') return null
  if (provider === 'wapilot' && env.WAPILOT_TOKEN) return { token: env.WAPILOT_TOKEN, base_url: env.WAPILOT_BASE_URL }
  if (provider === 'waconsole' && env.WACONSOLE_APP_KEY && env.WACONSOLE_AUTH_KEY) {
    return { app_key: env.WACONSOLE_APP_KEY, auth_key: env.WACONSOLE_AUTH_KEY, device_id: env.WACONSOLE_DEVICE_ID, base_url: env.WACONSOLE_BASE_URL }
  }
  return null
}

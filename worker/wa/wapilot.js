/**
 * WAPilot client (https://integrator.wapilot.id). cfg = { token, base_url? } — the business's own credentials.
 * Header `x-api-token: <token>` on every call.
 *   GET /status -> { online, status, whatsapp_connected }
 *   GET /me     -> { status, days_left, expires_at, device_name, whatsapp_number, license_type, ... }
 *   POST /send  { command_type: 'send_text', receiver: '628…', text_content }
 * HTTP 202 means the device has not answered yet ("retry later").
 */
import { WaError } from './errors.js'
import { maskPhone, normalizePhone } from '../../src/wa/rules.js'

const DEFAULT_BASE = 'https://integrator.wapilot.id'
const TIMEOUT_MS = 15000

export const wapilotReady = (cfg) => Boolean(cfg?.token)

export function wapilotProblem(status) {
  if (status === 202) return 'Perangkat WhatsApp belum merespons, coba lagi sebentar.'
  if (status === 401 || status === 403) return 'Token WAPilot ditolak. Periksa token di Pengaturan › Konektor.'
  if (status === 402) return 'Lisensi WAPilot Anda tidak aktif. Perpanjang di dasbor WAPilot.'
  if (status === 404) return 'Layanan WhatsApp tidak menemukan perintah ini.'
  if (status === 429) return 'Layanan WhatsApp sedang sibuk. Coba lagi sebentar.'
  return 'Layanan WhatsApp sedang bermasalah. Coba lagi nanti.'
}

export function createWapilot(cfg, fetchImpl = fetch) {
  const base = String(cfg.base_url || DEFAULT_BASE).replace(/\/+$/, '')
  async function request(method, path, body) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    let res
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'x-api-token': cfg.token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      })
    } catch (e) {
      throw new WaError(504, e?.name === 'AbortError' ? 'Layanan WhatsApp tidak menjawab. Coba lagi sebentar.' : 'Tidak dapat menghubungi layanan WhatsApp.')
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 202 || !res.ok) throw new WaError(res.status === 202 ? 503 : 502, wapilotProblem(res.status))
    try { return await res.json() } catch { return {} }
  }
  return {
    status: () => request('GET', '/status'),
    me: () => request('GET', '/me'),
    sendText: (to, text) => request('POST', '/send', { command_type: 'send_text', receiver: to, text_content: text }),
  }
}

// Only what the app shows; never the token, user ids or the device owner's e-mail.
export function wapilotView(status = {}, me = {}) {
  const online = Boolean(status.online ?? me.online)
  const days = Number(me.days_left)
  return {
    connected: online && Boolean(status.whatsapp_connected ?? me.whatsapp_connected),
    device: { name: typeof me.device_name === 'string' ? me.device_name : '', online, number_masked: me.whatsapp_number ? maskPhone(normalizePhone(me.whatsapp_number) || '') : '' },
    license: {
      status: typeof me.status === 'string' ? me.status : '',
      days_left: Number.isFinite(days) ? days : null,
      expires_at: typeof me.expires_at === 'string' ? me.expires_at : null,
      type: typeof me.license_type === 'string' ? me.license_type : '',
    },
  }
}

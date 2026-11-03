/**
 * WAConsole client (https://waconsole.apipedia.id). cfg = { app_key, auth_key, device_id?, base_url? } — the
 * business's own credentials, sent in the body as appkey / authkey.
 *   POST /api/create/message         { appkey, authkey, to: '628…', message }  -> { message_status: 'Success', data: {...} }
 *   POST /api/device/session/status  { appkey, authkey, device_id }            -> { success, data: { connected, authenticated, phone } }
 * Device status needs device_id; without it the provider still sends, and status says so.
 */
import { WaError } from './errors.js'
import { maskPhone, normalizePhone } from '../../src/wa/rules.js'

const DEFAULT_BASE = 'https://waconsole.apipedia.id'
const TIMEOUT_MS = 20000

export const waconsoleReady = (cfg) => Boolean(cfg?.app_key && cfg?.auth_key)

export function createWaconsole(cfg, fetchImpl = fetch) {
  const base = String(cfg.base_url || DEFAULT_BASE).replace(/\/+$/, '')
  const keys = { appkey: cfg.app_key, authkey: cfg.auth_key }
  async function post(path, body) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    let res
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ...keys, ...body }),
        signal: ac.signal,
      })
    } catch (e) {
      throw new WaError(504, e?.name === 'AbortError' ? 'Layanan WhatsApp tidak menjawab. Coba lagi sebentar.' : 'Tidak dapat menghubungi layanan WhatsApp.')
    } finally {
      clearTimeout(timer)
    }
    let json = null
    try { json = await res.json() } catch { /* not JSON */ }
    if (res.status === 401 || res.status === 403) throw new WaError(502, 'Kunci WAConsole ditolak. Periksa App key dan Auth key di Pengaturan › Konektor.')
    if (!res.ok) throw new WaError(502, 'Layanan WhatsApp sedang bermasalah. Coba lagi nanti.')
    return json || {}
  }
  return {
    async sendText(to, text) {
      const json = await post('/api/create/message', { to, message: text })
      const okStatus = String(json?.message_status || '').toLowerCase() === 'success' && Number(json?.data?.status_code ?? 200) < 400
      if (!okStatus) throw new WaError(502, 'Pesan WhatsApp ditolak oleh layanan pengirim. Periksa nomor tujuan lalu coba lagi.')
      return json
    },
    async session() {
      if (!cfg.device_id) return null
      return post('/api/device/session/status', { device_id: cfg.device_id })
    },
  }
}

export function waconsoleView(session) {
  if (!session) return { connected: true, device: null, license: null, note: 'Terkonfigurasi (status perangkat tidak tersedia).' }
  const d = session?.data || {}
  const connected = Boolean(session?.success) && Boolean(d.connected) && d.authenticated !== false
  return {
    connected,
    device: { name: 'WAConsole', online: Boolean(d.connected), number_masked: d.phone ? maskPhone(normalizePhone(d.phone) || '') : '' },
    license: null,
  }
}

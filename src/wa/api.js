/**
 * WhatsApp client for /api/wa/* — sent from the business's own WAPilot or WAConsole account.
 * In demo mode (mock cloud) the device, the provider choice and every send are simulated in
 * localStorage `satualur_wa_demo_v1` (keys come from src/integrations/connectors.js); nothing leaves the browser.
 */
import { getCloud, isUsingMockCloud } from '../cloud.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { demoConnected } from '../integrations/connectors.js'
import { WA_LIMITS, normalizePhone, maskPhone, dayWib, validateText } from './rules.js'

const TOKEN_KEY = 'satualur_token'
const DEMO_KEY = 'satualur_wa_demo_v1'
const token = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const PROVIDERS = ['wapilot', 'waconsole']
export const PROVIDER_LABEL = { wapilot: 'WAPilot', waconsole: 'WAConsole' }

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

/* ------------------------------------------------------------------ demo */
function loadDemo() {
  try {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY))
    if (s && Array.isArray(s.sent)) return s
  } catch { /* fresh */ }
  return { sent: [], provider: null }
}
const saveDemo = (s) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { /* private mode */ } }
const usedToday = (s) => s.sent.filter((m) => m.day === dayWib()).length
function demoProvider(s) {
  const connected = PROVIDERS.filter(demoConnected)
  return { provider: connected.includes(s.provider) ? s.provider : connected[0] || 'wapilot', connected }
}

/* ------------------------------------------------------------------ api */
export async function status() {
  if (isUsingMockCloud()) {
    const s = loadDemo()
    const { provider, connected } = demoProvider(s)
    const configured = connected.includes(provider)
    return {
      enabled: true, demo: false, provider, configured, connected: configured,
      providers: PROVIDERS.map((key) => ({ key, label: PROVIDER_LABEL[key], connected: connected.includes(key) })),
      device: configured ? { name: `Perangkat ${PROVIDER_LABEL[provider]} (simulasi)`, online: true, number_masked: '62812****000' } : null,
      license: configured && provider === 'wapilot' ? { status: 'active', days_left: 30, expires_at: null, type: 'demo' } : null,
      note: configured ? 'Mode demo: pesan hanya disimulasikan.' : undefined,
      limits: { per_day: WA_LIMITS.perUserDay }, used_today: usedToday(s),
    }
  }
  return call('/api/wa/status')
}

// to: { requestId } (the customer's number from the request) and/or { phone } (typed in the dialog; wins).
export async function send({ requestId = null, phone = '', text, kind = 'custom' }) {
  const v = validateText(text)
  if (v.error) throw new Error(v.error)
  let target = phone ? normalizePhone(phone) : null
  if (phone && !target) throw new Error('Masukkan nomor WhatsApp Indonesia yang valid, misalnya 0812 3456 7890.')
  if (isUsingMockCloud()) {
    if (!target && requestId) {
      const { data } = await getCloud().database.from('requests').select('*').eq('id', Number(requestId)).maybeSingle()
      if (!data) throw new Error('Permintaan tidak ditemukan.')
      target = normalizePhone(data.phone)
    }
    if (!target) throw new Error('Nomor WhatsApp tujuan belum ada atau tidak valid.')
    const s = loadDemo()
    const { provider, connected } = demoProvider(s)
    if (!connected.includes(provider)) throw new Error('WhatsApp belum dihubungkan. Isi kunci akun WAPilot atau WAConsole Anda di Pengaturan › Konektor.')
    if (usedToday(s) >= WA_LIMITS.perUserDay) throw new Error(`Batas ${WA_LIMITS.perUserDay} pesan WhatsApp per hari untuk usaha Anda tercapai. Coba lagi besok.`)
    s.sent.push({ to: maskPhone(target), kind, provider, request_id: requestId ?? null, day: dayWib(), at: new Date().toISOString() })
    saveDemo(s)
    return { status: 'simulated', to: maskPhone(target), provider }
  }
  return call('/api/wa/send', { method: 'POST', body: { ...(requestId ? { request_id: Number(requestId) } : {}), ...(target ? { phone: target } : {}), text: v.text, kind } })
}

export async function setProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('Pilihan pengirim tidak dikenal.')
  if (isUsingMockCloud()) {
    const s = loadDemo()
    s.provider = provider
    saveDemo(s)
    return { provider }
  }
  return call('/api/wa/provider', { method: 'PUT', body: { provider } })
}

export { normalizePhone }

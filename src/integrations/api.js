/**
 * Business integrations client (Pengaturan › Integrasi) and outgoing email.
 * Worker: /api/integrations*, /api/email/send. Demo mode (mock cloud): settings live in
 * localStorage `satualur_integrations_demo_v1`, and test/send calls are simulated.
 * Secrets typed by the user are sent once and never read back (only has_password / has_key).
 */
import { isUsingMockCloud, getCloud } from '../cloud.js'
import { isDemoEmail } from '../auth/demo-accounts.js'
import { signOutIfSuspended } from '../http-cloud.js'
import { validateEmailIntegration, validateAiIntegration } from '../admin/rules.js'
import { DEMO_MODELS } from '../ai-providers/demo-models.js'
import { isEmail } from '../admin/constants.js'

const DEMO_KEY = 'satualur_integrations_demo_v1'
const token = () => { try { return localStorage.getItem('satualur_token') } catch { return null } }

export async function call(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
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

const readDemo = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {} } catch { return {} } }
const writeDemo = (v) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)) } catch { /* storage unavailable */ } }
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

function demoView(d, demo = false) {
  return {
    email: {
      mode: d.email_mode || 'platform', smtp_host: d.smtp_host || '', smtp_port: d.smtp_port || 465, smtp_secure: d.smtp_secure || 'tls',
      smtp_user: d.smtp_user || '', smtp_from_email: d.smtp_from_email || '', smtp_from_name: d.smtp_from_name || '', has_password: Boolean(d.has_password),
    },
    ai: { mode: d.ai_mode || 'builtin', base_url: d.ai_base_url || '', model: d.ai_model || '', has_key: Boolean(d.has_key) },
    options: { custom_smtp_allowed: true, custom_ai_allowed: true, secrets_enabled: true, platform_email_ready: true, demo },
  }
}

export async function getIntegrations() {
  if (isUsingMockCloud()) {
    await delay()
    let email = ''
    try { email = (await getCloud().auth.getSession()).data?.user?.email || '' } catch { /* signed out */ }
    return demoView(readDemo(), isDemoEmail(email))
  }
  return call('/api/integrations')
}

export async function saveEmailIntegration(input) {
  const clean = validateEmailIntegration(input)
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    const { smtp_pass, ...rest } = clean
    if (clean.email_mode === 'smtp' && !smtp_pass && !d.has_password) throw new Error('Password SMTP wajib diisi.')
    const next = { ...d, ...rest, has_password: clean.email_mode === 'smtp' ? (Boolean(smtp_pass) || d.has_password) : d.has_password }
    writeDemo(next)
    return demoView(next)
  }
  return call('/api/integrations/email', { method: 'PUT', body: clean })
}

export async function saveAiIntegration(input) {
  const clean = validateAiIntegration(input)
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    const { ai_key, ...rest } = clean
    if (clean.ai_mode !== 'builtin' && !ai_key && !d.has_key) throw new Error('API key wajib diisi.')
    const next = { ...d, ...rest, has_key: clean.ai_mode !== 'builtin' ? (Boolean(ai_key) || d.has_key) : d.has_key }
    writeDemo(next)
    return demoView(next)
  }
  return call('/api/integrations/ai', { method: 'PUT', body: clean })
}

export async function testEmailIntegration() {
  if (isUsingMockCloud()) { await delay(); return { simulated: true, provider: 'demo' } }
  return call('/api/integrations/email/test', { method: 'POST', body: {} })
}

/** Tests the unsaved form values when given ({ ai_mode, ai_base_url, ai_model, ai_key }), else what is saved. */
export async function testAiIntegration(form) {
  if (isUsingMockCloud()) {
    await delay(300)
    if (form && form.ai_mode !== 'builtin') {
      validateAiIntegration(form)
      if (!form.ai_key && !readDemo().has_key) throw new Error('Isi API key penyedia AI.')
      return { mode: form.ai_mode, model: form.ai_model, reply: 'OK (simulasi)', ms: 380 }
    }
    return { mode: readDemo().ai_mode || 'builtin', reply: 'OK (simulasi)' }
  }
  return call('/api/integrations/ai/test', { method: 'POST', body: form || {} })
}

/** Lists the provider's models for the unsaved form values (key '' = the saved key). */
export async function listAiModels(form) {
  if (isUsingMockCloud()) {
    await delay(300)
    if (!form.ai_key && !readDemo().has_key) throw new Error('Isi API key penyedia AI.')
    return { supported: true, models: DEMO_MODELS[form.ai_mode] || [], simulated: true }
  }
  return call('/api/integrations/ai/models', { method: 'POST', body: form })
}

/** Sends an email written by the business: kind 'offer' / 'invoice' (to the customer) or 'report' (to the owner). */
export async function sendBusinessEmail({ kind = 'offer', to, subject, body }) {
  if (kind !== 'report' && !isEmail(String(to || ''))) throw new Error('Alamat email penerima tidak valid.')
  if (!String(subject || '').trim()) throw new Error('Subjek wajib diisi.')
  if (!String(body || '').trim()) throw new Error('Isi email wajib diisi.')
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    d.sent = [...(d.sent || []), { kind, to, subject, at: new Date().toISOString() }].slice(-50)
    writeDemo(d)
    return { simulated: true, provider: 'demo', to }
  }
  return call('/api/email/send', { method: 'POST', body: { kind, to, subject, body } })
}

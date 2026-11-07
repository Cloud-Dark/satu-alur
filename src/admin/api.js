/**
 * Kantor Satu Alur › Sistem client (admins only). Worker routes in worker/admin-system.js.
 * Demo mode (mock cloud): settings live in localStorage `satualur_system_demo_v1`; counts are
 * computed from the mock's users table and email tests are simulated.
 */
import { isUsingMockCloud } from '../cloud.js'
import { pageOf } from '../office/paging.js'
import { call } from '../integrations/api.js'
import { withDefaults, normalizeSetting, AI_MODE_LABELS, validatePlatformTransport, publicTransport, validatePlatformAi, publicPlatformAi, PLATFORM_AI_LABELS } from './rules.js'
import { DEMO_MODELS } from '../ai-providers/demo-models.js'
import { isEmail } from './constants.js'
import { PLANS } from '../business/plan-access.js'
import { t } from '../i18n/index.js'

const DEMO_KEY = 'satualur_system_demo_v1'
const readDemo = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || {} } catch { return {} } }
const writeDemo = (v) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)) } catch { /* storage unavailable */ } }
const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const mockUsers = () => { try { return (JSON.parse(localStorage.getItem('satualur_mock_v1')) || {}).users || [] } catch { return [] } }

export async function getSystem() {
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    return {
      settings: withDefaults(d.settings || {}),
      status: {
        email: { resend: true, from: 'Satu Alur <noreply@apipedia.id>', businesses_with_smtp: 0, transport: publicTransport(d.transport) },
        encryption: true,
        ai: { builtin_models: [{ id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct (fast)' }, { id: '@cf/meta/llama-3.1-8b-instruct-fast', name: 'Llama 3.1 8B Instruct (fast)' }], businesses_with_custom: 0, modes: AI_MODE_LABELS, provider: publicPlatformAi(d.aiProvider), provider_modes: PLATFORM_AI_LABELS },
        login: { otp_email: false, demo_otp: true, demo_login: true, google: false, google_redirect_uri: `${location.origin}/api/auth/google/callback`, admin_emails: 1 },
        whatsapp: { platform_fallback: false, wapilot: null, waconsole: null, repliz: null },
      },
      demo: true,
    }
  }
  return call('/api/office/admin/system')
}

export async function saveSystemSetting(key, value) {
  const clean = normalizeSetting(key, value)
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    d.settings = { ...(d.settings || {}), [key]: clean }
    writeDemo(d)
    return { key, value: clean }
  }
  return call(`/api/office/admin/system/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: clean } })
}

/** Platform email transport (Resend or a custom SMTP server). The password never comes back. */
export async function saveEmailTransport(input) {
  const v = validatePlatformTransport(input)
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    const prev = d.transport?.mode === 'smtp' ? d.transport : null
    if (v.mode === 'smtp') {
      const { pass, ...rest } = v
      if (!pass && !prev?.pass_enc) throw new Error('Isi password SMTP.')
      d.transport = { ...rest, pass_enc: pass ? 'demo' : prev.pass_enc, pass_last4: pass ? pass.slice(-4) : prev.pass_last4 }
    } else d.transport = { mode: 'resend' }
    writeDemo(d)
    return { transport: publicTransport(d.transport) }
  }
  return call('/api/office/admin/system/email-transport', { method: 'PUT', body: v })
}

export async function testSystemEmail(to, via) {
  if (to && !isEmail(to)) throw new Error(t('office.errors.badTestEmail'))
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    const provider = via !== 'resend' && d.transport?.mode === 'smtp' ? 'platform_smtp' : 'resend'
    d.emails = [{ kind: 'admin_test', recipient: to || 'admin', subject: 'Email uji Satu Alur', provider, status: 'sent', created_at: new Date().toISOString() }, ...(d.emails || [])].slice(0, 50)
    writeDemo(d)
    return { provider, to: to || 'admin', simulated: true }
  }
  return call('/api/office/admin/system/email/test', { method: 'POST', body: { ...(to ? { to } : {}), ...(via ? { via } : {}) } })
}

/* Platform AI provider (what "Bawaan Satu Alur" runs on). Mock: simulated lists and replies. */
function mockKey(v, d) {
  if (v.mode === 'workers') return
  if (!v.api_key && !(d.aiProvider?.mode === v.mode && d.aiProvider.key_enc)) throw new Error('Isi API key penyedia AI.')
}

export async function listPlatformModels(input) {
  const v = validatePlatformAi(input, { requireModel: false })
  if (isUsingMockCloud()) {
    await delay(300)
    mockKey(v, readDemo())
    return { supported: true, models: v.mode === 'workers' ? [] : DEMO_MODELS[v.mode], simulated: true }
  }
  return call('/api/office/admin/system/ai-provider/models', { method: 'POST', body: v })
}

export async function testPlatformAi(input) {
  const v = validatePlatformAi(input)
  if (isUsingMockCloud()) {
    await delay(400)
    mockKey(v, readDemo())
    return { model: v.model || 'workers', reply: 'OK (simulasi)', ms: 412, simulated: true }
  }
  return call('/api/office/admin/system/ai-provider/test', { method: 'POST', body: v })
}

export async function savePlatformAi(input) {
  const v = validatePlatformAi(input)
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    mockKey(v, d)
    if (v.mode === 'workers') d.aiProvider = { mode: 'workers' }
    else {
      const { api_key: key, ...rest } = v
      d.aiProvider = { ...rest, key_enc: key ? 'demo' : d.aiProvider.key_enc, key_last4: key ? key.slice(-4) : d.aiProvider.key_last4 }
    }
    writeDemo(d)
    return { provider: publicPlatformAi(d.aiProvider) }
  }
  return call('/api/office/admin/system/ai-provider', { method: 'PUT', body: v })
}

export async function testSystemAi() {
  if (isUsingMockCloud()) { await delay(); return { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', reply: 'OK (simulasi)', ms: 120 } }
  return call('/api/office/admin/system/ai/test', { method: 'POST', body: {} })
}

export async function getSummary() {
  if (isUsingMockCloud()) {
    await delay()
    const users = mockUsers().filter((u) => !String(u.email).endsWith('@staff.satualur.internal'))
    const week = Date.now() - 7 * 86400000
    return {
      users: users.length, new_this_week: users.filter((u) => Date.parse(u.created_at) >= week).length, active_this_week: 0, suspended: 0,
      ai_calls_month: 0, ai_calls_own_provider_month: 0, emails_month: (readDemo().emails || []).length, emails_failed_month: 0,
      vouchers_redeemed_month: 0, period: new Date().toISOString().slice(0, 7),
    }
  }
  return call('/api/office/admin/summary')
}

/** Activity log; emails are paged server-side ({ emails, emails_total, page, size }). */
export async function getActivity(kind = '', page = 1) {
  if (isUsingMockCloud()) {
    await delay()
    const all = (readDemo().emails || []).filter((e) => !kind || e.kind === kind)
    const { items, total, size } = pageOf(all, { page })
    return { emails: items, emails_total: total, page, size, usage: [], whatsapp: { platform_fallback: false, wapilot: null, waconsole: null, repliz: null }, period: new Date().toISOString().slice(0, 7) }
  }
  const q = new URLSearchParams({ page: String(page) })
  if (kind) q.set('kind', kind)
  return call(`/api/office/admin/activity?${q}`)
}

export async function getUserDetail(userId) {
  if (isUsingMockCloud()) {
    await delay()
    const u = mockUsers().find((x) => x.id === userId)
    if (!u) throw new Error('Pengguna tidak ditemukan.')
    const tiers = readDemo().tiers || {}
    return {
      user: { ...u, last_login_at: null }, demo: /@satualur\.id$/.test(u.email), tier: tiers[userId] || 'sole', suspended: false, reason: '',
      subscription: null, usage: [], credit_idr: 0, integrations: { email_mode: 'platform', ai_mode: 'builtin' }, emails: [], sessions: { total: 0, last: null },
    }
  }
  return call(`/api/office/admin/users/${encodeURIComponent(userId)}/detail`)
}

export async function setUserTier(userId, plan) {
  if (!PLANS.includes(plan)) throw new Error('Skala akun tidak dikenal.')
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    d.tiers = { ...(d.tiers || {}), [userId]: plan }
    writeDemo(d)
    return { plan }
  }
  return call(`/api/office/admin/users/${encodeURIComponent(userId)}/tier`, { method: 'PUT', body: { plan } })
}

/* ---------------------------------------------------------- admin access */

const mockBootstrap = () => String(import.meta.env?.VITE_ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)

export async function listAdmins() {
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    return { admins: d.admins || [], bootstrap: mockBootstrap(), audit: d.audit || [], email_admins_active: true }
  }
  return call('/api/office/admin/system/admins')
}

function mockAudit(d, action, target) {
  d.audit = [{ actor: 'admin', action, target, detail: null, created_at: new Date().toISOString() }, ...(d.audit || [])].slice(0, 50)
}

export async function addAdmin(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!isEmail(e)) throw new Error('Email tidak valid.')
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    d.admins = d.admins || []
    if (d.admins.some((a) => a.email === e)) throw new Error('Email ini sudah menjadi admin.')
    d.admins.push({ email: e, role: 'admin', added_by: 'admin', added_at: new Date().toISOString() })
    mockAudit(d, 'admin.add', e)
    writeDemo(d)
    return { email: e }
  }
  return call('/api/office/admin/system/admins', { method: 'POST', body: { email: e } })
}

export async function removeAdmin(email) {
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    if ((d.admins || []).length <= 1) throw new Error('Admin terakhir tidak bisa dihapus. Tambahkan admin lain dulu.')
    d.admins = d.admins.filter((a) => a.email !== email)
    mockAudit(d, 'admin.remove', email)
    writeDemo(d)
    return { email }
  }
  return call(`/api/office/admin/system/admins/${encodeURIComponent(email)}`, { method: 'DELETE' })
}

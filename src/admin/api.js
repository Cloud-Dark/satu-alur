/**
 * Kantor Satu Alur › Sistem client (admins only). Worker routes in worker/admin-system.js.
 * Demo mode (mock cloud): settings live in localStorage `satualur_system_demo_v1`; counts are
 * computed from the mock's users table and email tests are simulated.
 */
import { isUsingMockCloud } from '../cloud.js'
import { call } from '../integrations/api.js'
import { withDefaults, normalizeSetting, AI_MODE_LABELS } from './rules.js'
import { isEmail } from './constants.js'
import { PLANS } from '../business/plan-access.js'

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
        email: { resend: true, from: 'Satu Alur <noreply@apipedia.id>', businesses_with_smtp: 0 },
        encryption: true,
        ai: { builtin_models: [{ id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct (fast)' }, { id: '@cf/meta/llama-3.1-8b-instruct-fast', name: 'Llama 3.1 8B Instruct (fast)' }], businesses_with_custom: 0, modes: AI_MODE_LABELS },
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

export async function testSystemEmail(to) {
  if (to && !isEmail(to)) throw new Error('Alamat email tujuan tidak valid.')
  if (isUsingMockCloud()) {
    await delay()
    const d = readDemo()
    d.emails = [{ kind: 'admin_test', recipient: to || 'admin', subject: 'Email uji Satu Alur', provider: 'demo', status: 'sent', created_at: new Date().toISOString() }, ...(d.emails || [])].slice(0, 50)
    writeDemo(d)
    return { provider: 'demo', to: to || 'admin', simulated: true }
  }
  return call('/api/office/admin/system/email/test', { method: 'POST', body: to ? { to } : {} })
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

export async function getActivity(kind = '') {
  if (isUsingMockCloud()) {
    await delay()
    const emails = (readDemo().emails || []).filter((e) => !kind || e.kind === kind)
    return { emails, usage: [], whatsapp: { platform_fallback: false, wapilot: null, waconsole: null, repliz: null }, period: new Date().toISOString().slice(0, 7) }
  }
  return call(`/api/office/admin/activity${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)
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

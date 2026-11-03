/**
 * Admin and integration rules shared by the Worker, the mock cloud and the UI.
 *
 * Admins: staff sessions (POST /api/auth/staff-login) and email-login users listed
 * in ADMIN_EMAILS. Email admins count only while OTP codes really go to the inbox
 * (DEMO_OTP !== "true"): in demo-OTP mode anyone can sign in as any address.
 */
import { isEmail, SMTP_PORTS_LIST } from './constants.js'

export { SMTP_PORTS_LIST }

export function adminEmailSet(raw) {
  return new Set(String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
}

export function isEmailAdmin(email, env, demoEmails = new Set()) {
  const e = String(email || '').toLowerCase()
  if (!e || env?.DEMO_OTP === 'true' || demoEmails.has(e)) return false
  return adminEmailSet(env?.ADMIN_EMAILS).has(e)
}

// ------------------------------------------------------------- system settings

export const SETTING_DEFAULTS = {
  email: { allow_custom_smtp: true, from_name: 'Satu Alur', offer_daily_cap: 20 },
  ai: { allow_custom: true, default_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  login: { otp_email: true },
}
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS)

const bool = (v, d) => (typeof v === 'boolean' ? v : d)

/** Validates one settings value against its defaults; unknown fields are dropped. */
export function normalizeSetting(key, value) {
  const d = SETTING_DEFAULTS[key]
  if (!d) throw Object.assign(new Error('Pengaturan tidak dikenal.'), { validation: true })
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  if (key === 'email') {
    const fromName = typeof v.from_name === 'string' ? v.from_name.replace(/[\r\n<>"]/g, '').trim().slice(0, 60) : d.from_name
    const cap = Number.isInteger(v.offer_daily_cap) ? Math.min(200, Math.max(1, v.offer_daily_cap)) : d.offer_daily_cap
    return { allow_custom_smtp: bool(v.allow_custom_smtp, d.allow_custom_smtp), from_name: fromName || d.from_name, offer_daily_cap: cap }
  }
  if (key === 'ai') {
    const model = typeof v.default_model === 'string' && /^@cf\/[\w.@/-]{3,120}$/.test(v.default_model) ? v.default_model : d.default_model
    return { allow_custom: bool(v.allow_custom, d.allow_custom), default_model: model }
  }
  return { otp_email: bool(v.otp_email, d.otp_email) }
}

export function withDefaults(rows) {
  const out = {}
  for (const k of SETTING_KEYS) out[k] = normalizeSetting(k, rows?.[k] ?? SETTING_DEFAULTS[k])
  return out
}

// -------------------------------------------------------- business integrations

const fail = (message) => { throw Object.assign(new Error(message), { validation: true }) }

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

/** Validates the email part of business_integrations. Password '' keeps the stored one. */
export function validateEmailIntegration(input) {
  const mode = input?.email_mode === 'smtp' ? 'smtp' : 'platform'
  if (mode === 'platform') return { email_mode: 'platform' }
  const host = String(input.smtp_host || '').trim().toLowerCase()
  if (!HOST_RE.test(host)) fail('Host SMTP tidak valid, contoh: smtp.gmail.com.')
  if (/^(localhost|.*\.local|.*\.internal)$/.test(host)) fail('Host SMTP harus alamat publik.')
  const port = Number(input.smtp_port)
  if (!SMTP_PORTS_LIST.includes(port)) fail(`Port SMTP harus salah satu dari ${SMTP_PORTS_LIST.join(', ')}.`)
  const secure = input.smtp_secure === 'tls' || input.smtp_secure === 'starttls' ? input.smtp_secure : ([465, 2465].includes(port) ? 'tls' : 'starttls')
  const user = String(input.smtp_user || '').trim()
  if (!user || user.length > 200) fail('Username SMTP wajib diisi.')
  const fromEmail = String(input.smtp_from_email || '').trim().toLowerCase()
  if (!isEmail(fromEmail)) fail('Email pengirim tidak valid.')
  const fromName = String(input.smtp_from_name || '').replace(/[\r\n<>"]/g, '').trim().slice(0, 60)
  const pass = typeof input.smtp_pass === 'string' ? input.smtp_pass : ''
  if (pass.length > 500) fail('Password SMTP terlalu panjang.')
  return { email_mode: 'smtp', smtp_host: host, smtp_port: port, smtp_secure: secure, smtp_user: user, smtp_from_email: fromEmail, smtp_from_name: fromName || null, smtp_pass: pass }
}

/**
 * Platform email transport chosen by admins (system_settings key 'email_transport'):
 * 'resend' (default) or 'smtp'. Password '' keeps the stored one; it is never sent back.
 */
export const PLATFORM_TRANSPORTS = ['resend', 'smtp']

export function validatePlatformTransport(input) {
  const mode = input?.mode === 'smtp' ? 'smtp' : 'resend'
  if (mode === 'resend') return { mode: 'resend' }
  const smtp = validateEmailIntegration({
    email_mode: 'smtp', smtp_host: input.host, smtp_port: input.port, smtp_secure: input.secure, smtp_user: input.user,
    smtp_from_email: input.from_email, smtp_from_name: input.from_name, smtp_pass: input.pass,
  })
  const replyTo = String(input.reply_to || '').trim().toLowerCase()
  if (replyTo && !isEmail(replyTo)) fail('Alamat balasan (reply-to) tidak valid.')
  return {
    mode: 'smtp', host: smtp.smtp_host, port: smtp.smtp_port, secure: smtp.smtp_secure, user: smtp.smtp_user,
    from_email: smtp.smtp_from_email, from_name: smtp.smtp_from_name, reply_to: replyTo || null, pass: smtp.smtp_pass,
  }
}

/** What the admin UI may see of the stored transport: everything but the password. */
export function publicTransport(stored) {
  if (!stored || stored.mode !== 'smtp') return { mode: 'resend' }
  const { pass_enc: _enc, ...rest } = stored
  return { ...rest, pass_saved: Boolean(stored.pass_enc) }
}

export const AI_MODES = ['builtin', 'openai', 'anthropic']
export const AI_MODE_LABELS = { builtin: 'Bawaan Satu Alur', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' }
export const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com'

/** Base URL for a custom AI provider: https only, no credentials, no private hosts, no trailing slash. */
export function cleanBaseUrl(raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch { fail('Alamat API tidak valid.') }
  if (u.protocol !== 'https:') fail('Alamat API harus https.')
  if (u.username || u.password) fail('Alamat API tidak boleh berisi kredensial.')
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || /\.(local|internal)$/.test(h) || /^(\d+\.){3}\d+$/.test(h) || h.includes(':')) fail('Alamat API harus domain publik.')
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

/**
 * Platform AI provider chosen by admins (system_settings 'ai_provider'): what "Bawaan Satu Alur"
 * means for live businesses. 'workers' = Workers AI (default). API key '' keeps the stored one.
 */
export const PLATFORM_AI_MODES = ['workers', 'openai', 'anthropic']
export const PLATFORM_AI_LABELS = { workers: 'Workers AI (bawaan)', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' }
export const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1'

export function validatePlatformAi(input, { requireModel = true } = {}) {
  const mode = PLATFORM_AI_MODES.includes(input?.mode) ? input.mode : 'workers'
  if (mode === 'workers') return { mode: 'workers' }
  const base = cleanBaseUrl(input.base_url || (mode === 'anthropic' ? ANTHROPIC_DEFAULT_BASE : OPENAI_DEFAULT_BASE))
  const model = String(input.model || '').trim()
  if (requireModel && !/^[\w.:@/-]{1,120}$/.test(model)) fail('Pilih atau ketik nama model.')
  const key = typeof input.api_key === 'string' ? input.api_key.trim() : ''
  if (key.length > 500) fail('API key terlalu panjang.')
  const out = { mode, base_url: base, model, api_key: key }
  if (input.max_tokens !== undefined && input.max_tokens !== null && input.max_tokens !== '') {
    const n = Number(input.max_tokens)
    if (!Number.isInteger(n) || n < 16 || n > 8192) fail('Maks token harus 16–8192.')
    out.max_tokens = n
  }
  if (input.temperature !== undefined && input.temperature !== null && input.temperature !== '') {
    const t = Number(input.temperature)
    if (!(t >= 0 && t <= 2)) fail('Temperature harus 0–2.')
    out.temperature = t
  }
  return out
}

/** What the admin UI may see of the stored platform provider: everything but the key. */
export function publicPlatformAi(stored) {
  if (!stored || stored.mode === 'workers' || !PLATFORM_AI_MODES.includes(stored.mode)) return { mode: 'workers' }
  const { key_enc: _k, ...rest } = stored
  return { ...rest, key_saved: Boolean(stored.key_enc) }
}

export function validateAiIntegration(input) {
  const mode = AI_MODES.includes(input?.ai_mode) ? input.ai_mode : 'builtin'
  if (mode === 'builtin') return { ai_mode: 'builtin' }
  const base = cleanBaseUrl(input.ai_base_url || (mode === 'anthropic' ? ANTHROPIC_DEFAULT_BASE : ''))
  const model = String(input.ai_model || '').trim()
  if (!/^[\w.:@/-]{1,120}$/.test(model)) fail('Nama model wajib diisi, contoh: gpt-4o-mini.')
  const key = typeof input.ai_key === 'string' ? input.ai_key.trim() : ''
  if (key.length > 500) fail('API key terlalu panjang.')
  return { ai_mode: mode, ai_base_url: base, ai_model: model, ai_key: key }
}

/** Masks an email for logs shown to admins of other businesses' data. */
export const maskEmail = (e) => String(e || '').replace(/^(.{0,2})[^@]*(@.*)$/, (_, a, b) => `${a}***${b}`)

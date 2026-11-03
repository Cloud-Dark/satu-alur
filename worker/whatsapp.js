/**
 * WhatsApp for businesses, sent from the business's OWN WAPilot or WAConsole account (keys in worker/connectors.js,
 * providers in worker/wa/).
 *
 *   GET  /api/wa/status    { enabled, demo, provider, providers: [{ key, label, connected }], configured, connected,
 *                            device, license, note?, error?, limits, used_today }
 *   PUT  /api/wa/provider  { provider } -> which connected provider sends (business_settings.wa_provider)
 *   POST /api/wa/send      { request_id?, phone?, text, kind? } -> { status: 'sent' | 'simulated', to, provider }
 *                          phone (typed by the user after the confirm dialog) wins; otherwise the phone of the
 *                          caller's own request. kind 'test' is the settings test message.
 *
 * A per-business daily cap (WA_LIMITS.perUserDay) is the safety net. Shared DEMO_EMAILS accounts never reach WhatsApp:
 * they get a simulated success. The platform's own keys are used only when WA_PLATFORM_FALLBACK = "true".
 * Every attempt is logged in wa_messages with a masked number; keys are never logged or returned.
 */
import { WA_LIMITS, normalizePhone, maskPhone, dayWib, validateText, capProblem } from '../src/wa/rules.js'
import { PROVIDERS, PROVIDER_LABEL, WaError, sendText, status as providerStatus, platformConfig } from './wa/index.js'
import { loadCredentials, connectedProviders, integrationsEnabled, isDemo } from './connectors.js'

const KINDS = new Set(['offer', 'invoice', 'followup', 'custom', 'test'])
const NOT_CONNECTED = 'WhatsApp belum dihubungkan. Isi kunci akun WAPilot atau WAConsole Anda di Pengaturan › Konektor.'

// The provider this business sends with: its saved choice when still connected, else the first connected one.
export async function providerOf(env, ownerId) {
  const connected = (await connectedProviders(env, ownerId)).filter((p) => PROVIDERS.includes(p))
  const row = await env.DB.prepare('SELECT wa_provider FROM business_settings WHERE owner_id = ?').bind(ownerId).first()
  if (connected.includes(row?.wa_provider)) return { provider: row.wa_provider, connected }
  if (connected.length) return { provider: connected[0], connected }
  const fallback = PROVIDERS.find((p) => platformConfig(p, env))
  return { provider: fallback || 'wapilot', connected, platform: Boolean(fallback) }
}

async function configFor(env, ownerId, provider) {
  return (await loadCredentials(env, ownerId, provider)) || platformConfig(provider, env)
}

async function counter(env, userId, day) {
  const row = await env.DB.prepare("SELECT count FROM usage_counters WHERE user_id = ? AND feature = 'wa_send' AND period = ?").bind(userId, day).first()
  return Number(row?.count || 0)
}
const bump = (env, userId, day) => env.DB.prepare(
  `INSERT INTO usage_counters (user_id, feature, period, count) VALUES (?, 'wa_send', ?, 1)
   ON CONFLICT(user_id, feature, period) DO UPDATE SET count = count + 1`,
).bind(userId, day)
const logStmt = (env, r) => env.DB.prepare(
  'INSERT INTO wa_messages (owner_id, request_id, provider, kind, phone_masked, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
).bind(r.owner_id, r.request_id ?? null, r.provider, r.kind, r.phone_masked, r.status, r.error ?? null, new Date().toISOString())

// ----------------------------------------------------------------- routes

export async function handleWaStatus(request, env, deps) {
  const { user } = await deps.authenticate(request, env)
  const demo = isDemo(user, deps)
  const { provider, connected, platform } = await providerOf(env, user.id)
  const out = {
    enabled: integrationsEnabled(env) && Boolean(env.TOKEN_KEY), demo, provider,
    providers: PROVIDERS.map((key) => ({ key, label: PROVIDER_LABEL[key], connected: connected.includes(key) })),
    configured: false, connected: false, device: null, license: null,
    limits: { per_day: WA_LIMITS.perUserDay }, used_today: await counter(env, user.id, dayWib()),
  }
  if (demo) return deps.ok(out)
  const cfg = await configFor(env, user.id, provider)
  if (!cfg) return deps.ok(out)
  out.configured = true
  if (platform) out.note = 'Memakai akun WhatsApp Satu Alur.'
  try {
    return deps.ok({ ...out, ...(await providerStatus(provider, cfg, deps.fetchImpl, user.id)), ...(platform ? { note: out.note } : {}) })
  } catch (e) {
    return deps.ok({ ...out, error: e instanceof WaError ? e.message : 'Status WhatsApp tidak terbaca.' })
  }
}

export async function handleWaProvider(request, env, deps) {
  const { readJson, ok, HttpError } = deps
  const { user } = await deps.authenticate(request, env)
  if (isDemo(user, deps)) throw new HttpError(403, 'Tidak tersedia di akun demo.')
  const body = await readJson(request)
  if (!PROVIDERS.includes(body.provider)) throw new HttpError(400, 'Pilihan pengirim tidak dikenal.')
  if (!(await connectedProviders(env, user.id)).includes(body.provider)) throw new HttpError(409, `Hubungkan akun ${PROVIDER_LABEL[body.provider]} Anda terlebih dahulu.`)
  await env.DB.prepare(
    `INSERT INTO business_settings (owner_id, wa_provider, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET wa_provider = excluded.wa_provider, updated_at = excluded.updated_at`,
  ).bind(user.id, body.provider, new Date().toISOString()).run()
  return ok({ provider: body.provider })
}

export async function handleWaSend(request, env, deps) {
  const { readJson, ok, HttpError } = deps
  const { user } = await deps.authenticate(request, env)
  const body = await readJson(request)
  const v = validateText(body.text)
  if (v.error) throw new HttpError(400, v.error)
  const kind = KINDS.has(body.kind) ? body.kind : 'custom'
  let requestId = null
  let phone = null
  if (body.request_id !== undefined && body.request_id !== null && body.request_id !== '') {
    requestId = Number(body.request_id)
    if (!Number.isInteger(requestId) || requestId <= 0) throw new HttpError(400, 'Permintaan tidak dikenal.')
    const row = await env.DB.prepare('SELECT phone FROM requests WHERE id = ? AND owner_id = ?').bind(requestId, user.id).first()
    if (!row) throw new HttpError(404, 'Permintaan tidak ditemukan.')
    phone = normalizePhone(row.phone)
  }
  if (body.phone) {
    phone = normalizePhone(body.phone)
    if (!phone) throw new HttpError(400, 'Masukkan nomor WhatsApp Indonesia yang valid, misalnya 0812 3456 7890.')
  }
  if (!phone) throw new HttpError(400, 'Nomor WhatsApp tujuan belum ada atau tidak valid.')

  const { provider } = await providerOf(env, user.id)
  const base = { owner_id: user.id, request_id: requestId, provider, kind, phone_masked: maskPhone(phone) }
  if (isDemo(user, deps)) {
    await logStmt(env, { ...base, status: 'simulated' }).run()
    return ok({ status: 'simulated', to: base.phone_masked, provider })
  }
  const cfg = await configFor(env, user.id, provider)
  if (!cfg) throw new HttpError(409, NOT_CONNECTED)
  const day = dayWib()
  const problem = capProblem({ user: await counter(env, user.id, day) })
  if (problem) throw new HttpError(429, problem)
  try {
    await sendText({ provider, to: phone, text: v.text }, cfg, deps.fetchImpl)
  } catch (e) {
    const message = e instanceof WaError ? e.message : 'Gagal mengirim WhatsApp.'
    await logStmt(env, { ...base, status: 'failed', error: message }).run()
    throw new HttpError(e instanceof WaError ? e.status : 502, message)
  }
  await env.DB.batch([logStmt(env, { ...base, status: 'sent' }), bump(env, user.id, day)])
  return ok({ status: 'sent', to: base.phone_masked, provider })
}

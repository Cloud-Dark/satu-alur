/**
 * Per-business integration credentials (WAPilot, WAConsole, Repliz). Each business stores its OWN keys.
 *
 *   GET    /api/integrations             [{ provider, label, kind, connected, hint, meta, verified_at, help, url }]
 *   PUT    /api/integrations/:provider   form fields -> verified with a read-only call, encrypted, stored -> { connected, hint, verified, note? }
 *   DELETE /api/integrations/:provider   forgets the keys
 *
 * Secrets are AES-GCM encrypted with TOKEN_KEY (src/social/crypto.js) and never returned: the browser only sees the
 * last 4 characters. Shared DEMO_EMAILS accounts cannot store keys. While DEMO_OTP is "true" anyone can sign in as any
 * email (and so use another business's keys), so integrations stay off unless INTEGRATIONS_ALLOW_DEMO_OTP = "true".
 */
import { isDemoUser } from './demo.js'
import { encryptToken, decryptToken } from '../src/social/crypto.js'
import { INTEGRATIONS, INTEGRATION_KEYS, validateCredentials } from '../src/integrations/rules.js'
import { WaError, verify as verifyWa, forgetStatus } from './wa/index.js'
import { createRepliz, ReplizError } from './repliz-client.js'

export const integrationsEnabled = (env) => env.DEMO_OTP !== 'true' || env.INTEGRATIONS_ALLOW_DEMO_OTP === 'true'
// One definition of "demo account" for the whole Worker (worker/demo.js); deps kept for call-site compatibility.
export const isDemo = (user, _deps) => isDemoUser(user)
const OFF = 'Integrasi akun belum aktif di server ini.'
const NO_KEY = 'Penyimpanan kunci belum dikonfigurasi di server. Hubungi admin Satu Alur.'

// Decrypted credentials of one business for one provider ({ ...secrets, ...meta }), or null.
export async function loadCredentials(env, ownerId, provider) {
  if (!env.TOKEN_KEY || !integrationsEnabled(env)) return null
  const row = await env.DB.prepare('SELECT secret_enc, meta_json FROM integration_credentials WHERE owner_id = ? AND provider = ?')
    .bind(ownerId, provider).first()
  if (!row) return null
  try {
    return { ...JSON.parse(row.meta_json || '{}'), ...JSON.parse(await decryptToken(row.secret_enc, env.TOKEN_KEY)) }
  } catch {
    return null // key rotated or row damaged: treat as not connected
  }
}

export async function connectedProviders(env, ownerId) {
  if (!integrationsEnabled(env)) return []
  const { results } = await env.DB.prepare('SELECT provider FROM integration_credentials WHERE owner_id = ?').bind(ownerId).all()
  return results.map((r) => r.provider)
}

async function check(provider, cfg, fetchImpl) {
  if (provider === 'repliz') {
    await createRepliz(cfg, fetchImpl).request('GET', '/me/addon')
    return { verified: true }
  }
  return verifyWa(provider, cfg, fetchImpl)
}

// ----------------------------------------------------------------- routes

export async function handleIntegrationList(request, env, deps) {
  const { user } = await deps.authenticate(request, env)
  const { results } = integrationsEnabled(env)
    ? await env.DB.prepare('SELECT provider, hint, meta_json, verified_at FROM integration_credentials WHERE owner_id = ?').bind(user.id).all()
    : { results: [] }
  const byProvider = new Map(results.map((r) => [r.provider, r]))
  return deps.ok({
    enabled: integrationsEnabled(env) && Boolean(env.TOKEN_KEY),
    demo: isDemo(user, deps),
    items: INTEGRATION_KEYS.map((key) => {
      const def = INTEGRATIONS[key]
      const r = byProvider.get(key)
      let meta = {}
      try { meta = JSON.parse(r?.meta_json || '{}') } catch { /* ignore */ }
      return {
        provider: key, label: def.label, kind: def.kind, help: def.help, url: def.url,
        fields: def.fields.map(({ key: k, label, secret, required, placeholder }) => ({ key: k, label, secret, required, placeholder: placeholder || '' })),
        connected: Boolean(r), hint: r?.hint || '', meta, verified_at: r?.verified_at || null,
      }
    }),
  })
}

export async function handleIntegrationPut(request, env, deps, params) {
  const { readJson, ok, HttpError } = deps
  const { user } = await deps.authenticate(request, env)
  const provider = String(params.provider || '')
  if (!INTEGRATIONS[provider]) throw new HttpError(404, 'Integrasi tidak dikenal.')
  if (isDemo(user, deps)) throw new HttpError(403, 'Akun demo dipakai bersama, jadi tidak bisa menyimpan kunci akun.')
  if (!integrationsEnabled(env)) throw new HttpError(503, OFF)
  if (!env.TOKEN_KEY) throw new HttpError(503, NO_KEY)
  const v = validateCredentials(provider, await readJson(request))
  if (v.error) throw new HttpError(400, v.error)
  let result
  try {
    result = await check(provider, { ...v.meta, ...v.secrets }, deps.fetchImpl)
  } catch (e) {
    if (e instanceof WaError || e instanceof ReplizError) throw new HttpError(400, `Kunci belum bisa dipakai: ${e.message}`)
    throw e
  }
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO integration_credentials (owner_id, provider, secret_enc, hint, meta_json, verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, provider) DO UPDATE SET secret_enc = excluded.secret_enc, hint = excluded.hint, meta_json = excluded.meta_json,
       verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
  ).bind(user.id, provider, await encryptToken(JSON.stringify(v.secrets), env.TOKEN_KEY), v.hint, JSON.stringify(v.meta),
    result.verified ? now : null, now).run()
  forgetStatus(provider, user.id)
  return ok({ provider, connected: true, hint: v.hint, verified: result.verified, note: result.note || null })
}

export async function handleIntegrationDelete(request, env, deps, params) {
  const { user } = await deps.authenticate(request, env)
  const provider = String(params.provider || '')
  if (!INTEGRATIONS[provider]) throw new deps.HttpError(404, 'Integrasi tidak dikenal.')
  await env.DB.prepare('DELETE FROM integration_credentials WHERE owner_id = ? AND provider = ?').bind(user.id, provider).run()
  forgetStatus(provider, user.id)
  return deps.ok(null)
}

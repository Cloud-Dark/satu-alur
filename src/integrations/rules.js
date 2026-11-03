/**
 * Per-business integrations: each business connects its OWN WAPilot, WAConsole and Repliz accounts.
 * Field definitions shared by the Worker (worker/integrations.js) and the settings UI.
 * `secret` fields are encrypted at rest and never sent back to the browser; `meta` fields are plain settings.
 */

export const INTEGRATIONS = {
  wapilot: {
    label: 'WAPilot',
    kind: 'whatsapp',
    help: 'Buka dasbor wapilot.id › Remote › API Docs, lalu salin token API perangkat Anda.',
    url: 'https://wapilot.id',
    fields: [
      { key: 'token', label: 'Token API', secret: true, required: true, pattern: /^[A-Za-z0-9_.-]{16,200}$/ },
      { key: 'base_url', label: 'Alamat layanan (opsional)', secret: false, required: false, url: true, placeholder: 'https://integrator.wapilot.id' },
    ],
  },
  waconsole: {
    label: 'WAConsole',
    kind: 'whatsapp',
    help: 'Buka dasbor waconsole.apipedia.id, lalu salin App key dan Auth key. ID perangkat dipakai untuk menampilkan status perangkat.',
    url: 'https://waconsole.apipedia.id',
    fields: [
      { key: 'app_key', label: 'App key', secret: true, required: true, pattern: /^[A-Za-z0-9_.-]{6,200}$/ },
      { key: 'auth_key', label: 'Auth key', secret: true, required: true, pattern: /^[A-Za-z0-9_.-]{6,200}$/ },
      { key: 'device_id', label: 'ID perangkat (opsional)', secret: false, required: false, pattern: /^[A-Za-z0-9_.:-]{1,100}$/ },
      { key: 'base_url', label: 'Alamat layanan (opsional)', secret: false, required: false, url: true, placeholder: 'https://waconsole.apipedia.id' },
    ],
  },
  repliz: {
    label: 'Repliz',
    kind: 'social',
    help: 'Buka repliz.com › Setting › Public API, lalu salin Access key dan Secret key.',
    url: 'https://repliz.com/user/setting/api',
    fields: [
      { key: 'access_key', label: 'Access key', secret: true, required: true, pattern: /^[A-Za-z0-9_.-]{4,200}$/ },
      { key: 'secret_key', label: 'Secret key', secret: true, required: true, pattern: /^[A-Za-z0-9_.-]{8,300}$/ },
    ],
  },
}
export const INTEGRATION_KEYS = Object.keys(INTEGRATIONS)
export const WA_PROVIDERS = INTEGRATION_KEYS.filter((k) => INTEGRATIONS[k].kind === 'whatsapp')

const httpsUrl = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password } catch { return false }
}

// Splits and checks a form submission. Returns { error } or { secrets, meta, hint }.
export function validateCredentials(provider, input) {
  const def = INTEGRATIONS[provider]
  if (!def) return { error: 'Integrasi tidak dikenal.' }
  const secrets = {}
  const meta = {}
  for (const f of def.fields) {
    const v = String(input?.[f.key] ?? '').trim()
    if (!v) {
      if (f.required) return { error: `${f.label} wajib diisi.` }
      continue
    }
    if (f.url ? !httpsUrl(v) : f.pattern && !f.pattern.test(v)) return { error: `${f.label} tidak valid.` }
    ;(f.secret ? secrets : meta)[f.key] = f.url ? v.replace(/\/+$/, '') : v
  }
  const last = Object.values(secrets).at(-1) || ''
  return { secrets, meta, hint: last.slice(-4) }
}

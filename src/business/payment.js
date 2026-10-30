// Payment gateway settings: pure validation + a connection test with injected fetch. Never logs or returns a key.

export const PROVIDERS = ['none', 'midtrans', 'xendit']
export const MODES = ['sandbox', 'production']
export const PROVIDER_NAMES = { midtrans: 'Midtrans', xendit: 'Xendit' }
const MAX = 200

// Tagged so the worker turns only these into 400s.
function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
function text(v, label) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length > MAX) fail(`${label} maksimal ${MAX} karakter.`)
  return s
}

/** Blank secrets mean "keep the stored one"; the caller decides what to do with them. */
export function validatePaymentSettings(body = {}) {
  if (!PROVIDERS.includes(body.provider)) fail('Penyedia pembayaran tidak valid.')
  if (!MODES.includes(body.mode)) fail('Mode tidak valid.')
  return {
    provider: body.provider,
    mode: body.mode,
    client_key: text(body.client_key, 'Client key'),
    server_key: text(body.server_key, 'Server key'),
    webhook_token: text(body.webhook_token, 'Webhook token'),
    clear_server_key: body.clear_server_key === true,
  }
}

/** Calls the provider with the server key; returns { ok, message } and never throws. */
export async function testGateway({ provider, mode, serverKey }, fetchFn, { timeoutMs = 10000 } = {}) {
  const name = PROVIDER_NAMES[provider]
  if (!name) return { ok: false, message: 'Pilih penyedia pembayaran terlebih dahulu.' }
  if (!serverKey) return { ok: false, message: 'Server key belum diatur.' }
  const url = provider === 'xendit'
    ? 'https://api.xendit.co/balance'
    : `https://api${mode === 'production' ? '' : '.sandbox'}.midtrans.com/v2/satualur-ping/status`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetchFn(url, { headers: { Authorization: `Basic ${btoa(`${serverKey}:`)}`, Accept: 'application/json' }, signal: ctrl.signal })
  } catch {
    return { ok: false, message: `Tidak dapat menghubungi ${name}.` }
  } finally {
    clearTimeout(timer)
  }
  if (provider === 'midtrans') {
    // Any non-401 answer (404 for the unknown ping order included) proves the key was accepted.
    return res.status === 401 ? { ok: false, message: 'Server key ditolak Midtrans.' } : { ok: true, message: `Terhubung ke Midtrans (${mode}).` }
  }
  if (res.status === 200) return { ok: true, message: 'Terhubung ke Xendit.' }
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'Server key ditolak Xendit.' }
  return { ok: false, message: `Xendit membalas HTTP ${res.status}.` }
}

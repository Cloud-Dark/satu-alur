/**
 * Signed, short-lived connect state for the Repliz flow (HMAC SHA-256, WebCrypto).
 * Lives in an HttpOnly cookie while the user is at the social platform, because the
 * redirect address has to stay fixed per platform (no query string the platform could reject).
 */

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export const STATE_TTL_MS = 10 * 60 * 1000

// { ownerId, platform, reconnect, nonce, exp } -> 'payload.sig'
export async function signConnectState(state, secret) {
  const payload = b64url(enc.encode(JSON.stringify(state)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload))
  return `${payload}.${b64url(sig)}`
}

// Returns the state when the signature holds, it has not expired and it was made for `platform`; else null.
export async function verifyConnectState(token, secret, platform, now = Date.now()) {
  try {
    const [payload, sig, extra] = String(token || '').split('.')
    if (!payload || !sig || extra !== undefined) return null
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(payload)))) return null
    const s = JSON.parse(dec.decode(unb64url(payload)))
    if (typeof s.ownerId !== 'string' || !s.ownerId || s.platform !== platform || !(Number(s.exp) >= now)) return null
    return { ownerId: s.ownerId, platform: s.platform, reconnect: typeof s.reconnect === 'string' ? s.reconnect : null }
  } catch {
    return null
  }
}

// AES key (base64, 32 bytes) for the encrypted page/channel picker, derived from a secret.
export async function derivedKeyB64(secret, purpose = 'repliz-pick') {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${purpose}:${secret}`))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

/**
 * Token encryption (AES-GCM, 12-byte IV) and signed OAuth state (HMAC SHA-256).
 * WebCrypto only, so it runs in the Worker and in Node tests.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const aesKey = (keyB64) => crypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt'])
const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function encryptToken(plain, keyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(plain))
  return `${b64url(iv)}.${b64url(ct)}`
}

export async function decryptToken(blob, keyB64) {
  const [iv, ct] = String(blob).split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, await aesKey(keyB64), unb64url(ct))
  return dec.decode(pt)
}

// `purpose` ('facebook' | 'threads') keeps one flow's state from completing the other's callback.
export async function signState({ ownerId, exp, nonce, purpose = 'facebook' }, secret) {
  const payload = b64url(enc.encode(JSON.stringify({ ownerId, exp, nonce, purpose })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload))
  return `${payload}.${b64url(sig)}`
}

export async function verifyState(state, secret, now = Date.now(), purpose = 'facebook') {
  try {
    const [payload, sig, extra] = String(state).split('.')
    if (!payload || !sig || extra !== undefined) return null
    // crypto.subtle.verify compares in constant time.
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(payload)))) return null
    const { ownerId, exp, nonce, purpose: p } = JSON.parse(dec.decode(unb64url(payload)))
    if (typeof ownerId !== 'string' || !ownerId || !(Number(exp) >= now) || p !== purpose) return null
    return { ownerId, nonce: typeof nonce === 'string' ? nonce : null }
  } catch {
    return null
  }
}

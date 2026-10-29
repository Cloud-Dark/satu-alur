/**
 * Staff passwords (Kantor Satu Alur): PBKDF2-SHA256 with a random 16-byte salt.
 * WebCrypto only, so the Worker (worker/staff.js) and the CLI (scripts/staff.mjs) share it.
 * Stored as `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`.
 */

// Cloudflare Workers cap PBKDF2 at 100 000 iterations.
export const ITERATIONS = 100000
export const MIN_PASSWORD = 12
export const MAX_PASSWORD = 128
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/

const enc = new TextEncoder()
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export function validateUsername(username) {
  return USERNAME_RE.test(String(username || '')) ? null : 'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.'
}

export function validatePassword(password) {
  const p = String(password || '')
  if (p.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`
  if (p.length > MAX_PASSWORD) return `Password maksimal ${MAX_PASSWORD} karakter.`
  return null
}

export async function hashPassword(password, { iterations = ITERATIONS, salt = crypto.getRandomValues(new Uint8Array(16)) } = {}) {
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`
}

/** Constant-time compare. Malformed hashes are false, never throw. */
export async function verifyPassword(password, stored) {
  const [alg, it, salt, hash] = String(stored || '').split('$')
  const iterations = Number(it)
  if (alg !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS || !salt || !hash) return false
  let want, saltBytes
  try { want = unb64(hash); saltBytes = unb64(salt) } catch { return false }
  const got = await derive(String(password), saltBytes, iterations)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]
  return diff === 0
}

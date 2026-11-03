/**
 * Google sign-in (OAuth 2.0 authorization code + PKCE, OpenID Connect).
 * Pure helpers used by worker/google.js and the tests.
 */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function randomUrlToken(nBytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(nBytes)))
}

export async function pkceChallenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
}

/** Exact redirect URI registered in Google Cloud: PUBLIC_BASE_URL when set, else the request origin. */
export function googleRedirectUri(env, requestUrl) {
  const base = String(env?.PUBLIC_BASE_URL || new URL(requestUrl).origin).replace(/\/+$/, '')
  return `${base}/api/auth/google/callback`
}

export const isGoogleConfigured = (env) => Boolean(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET)

export function googleAuthUrl({ clientId, redirectUri, state, challenge }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    access_type: 'online',
  })
  return `${GOOGLE_AUTH_URL}?${q}`
}

/** Decodes the payload of a JWT (no signature check: the token came straight from Google over TLS). */
export function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1]
  if (!part) return null
  try {
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
}

/**
 * Validates id_token claims (OpenID Connect Core 3.1.3.7). Returns { email, name, sub } or throws.
 * The token is received directly from Google's token endpoint over TLS, so the claims check is the
 * required verification (signature verification is optional in that case per the spec).
 */
export function validateIdTokenClaims(claims, { clientId, now = Date.now() }) {
  const bad = (m) => { throw new Error(m) }
  if (!claims || typeof claims !== 'object') bad('Token Google tidak valid.')
  if (!GOOGLE_ISSUERS.has(claims.iss)) bad('Penerbit token Google tidak dikenal.')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(clientId)) bad('Token Google bukan untuk aplikasi ini.')
  if (!(Number(claims.exp) * 1000 > now)) bad('Token Google sudah kedaluwarsa.')
  if (claims.iat && Number(claims.iat) * 1000 > now + 5 * 60 * 1000) bad('Token Google belum berlaku.')
  if (claims.email_verified !== true && claims.email_verified !== 'true') bad('Email Google belum terverifikasi.')
  const email = String(claims.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) bad('Akun Google tidak punya email.')
  return { email, name: typeof claims.name === 'string' ? claims.name.slice(0, 100) : null, sub: String(claims.sub || '') }
}

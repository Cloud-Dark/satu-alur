import { getCloud } from '../cloud.js'

let pendingEmailOtp = null

export async function sendEmailCode(email) {
  const cloud = getCloud()
  const sent = await cloud.auth.sendOtp({ email })
  if (sent.error) {
    throw new Error(sent.error.message)
  }
  pendingEmailOtp = {
    email,
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser,
  }
  return { isExistingUser: sent.data.isExistingUser }
}

export async function submitEmailOtp(email, verificationCode) {
  const pending = pendingEmailOtp
  if (!pending || pending.email !== email) {
    throw new Error('Minta kode OTP untuk email ini terlebih dahulu.')
  }
  const cloud = getCloud()
  const completed = await cloud.auth.verifyOtp({
    email: pending.email,
    verificationId: pending.verificationId,
    isExistingUser: pending.isExistingUser,
    token: verificationCode,
  })
  if (completed.error) {
    throw new Error(completed.error.message)
  }
  pendingEmailOtp = null
  return completed.data
}

/** Satu Alur staff sign-in (/super-admin-login): username + password, staff-only session. */
export async function staffLogin(username, password) {
  const res = await getCloud().auth.staffLogin({ username, password })
  if (res?.error) throw new Error(res.error.message)
  return res.data
}

/** Which sign-in options the server offers: { google, otp_email, demo_login }. */
export async function authProviders() {
  try { return await getCloud().auth.providers() } catch { return { google: false, otp_email: true, demo_login: true } }
}

/** Completes Google sign-in with the one-time code the Worker callback put in #/masuk?google=… */
export async function finishGoogleLogin(code) {
  const res = await getCloud().auth.googleExchange({ code })
  if (res?.error) throw new Error(res.error.message)
  return res.data
}

/** Signs in to one of the seeded demo accounts (no OTP). */
export async function loginWithDemo(email) {
  const res = await getCloud().auth.demoLogin({ email })
  if (res?.error) throw new Error(res.error.message)
  return res.data
}

export async function getSession() {
  const cloud = getCloud()
  return cloud.auth.getSession()
}

export function onAuthStateChange(callback) {
  const cloud = getCloud()
  return cloud.auth.onAuthStateChange(callback)
}

export async function signOut() {
  const cloud = getCloud()
  return cloud.auth.signOut()
}

export async function restoreAuth() {
  const url = new URL(location.href)
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    return { type: 'normal' }
  }
  const provider = url.searchParams.get('provider')
  if (provider !== 'workbuddy' && provider !== 'wechat') {
    throw new Error('Callback login tidak valid.')
  }
  const cloud = getCloud()
  const handleCallback = provider === 'workbuddy'
    ? cloud.auth.handleWorkBuddyCallback
    : cloud.auth.handleWechatWebCallback
  if (typeof handleCallback !== 'function') {
    throw new Error('Metode login belum tersedia.')
  }
  const { data: session, error } = await handleCallback.call(cloud.auth)
  if (error) throw new Error(error.message)
  if (session) {
    for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key)
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    return { type: 'oauth', session }
  }
  return { type: 'normal' }
}

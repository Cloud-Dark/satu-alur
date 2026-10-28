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

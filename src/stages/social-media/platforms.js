// Platform rules shared by Konten (share now) and Jadwal (schedule): connected platforms only, reconnect first, per-platform eligibility.
export const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads' }
export const RECONNECT = 'Hubungkan ulang akun di tab Akun.'

export function connectedPlatforms(account) {
  if (!account) return []
  return [
    ...(account.fb_connected ? ['facebook', ...(account.ig_connected ? ['instagram'] : [])] : []),
    ...(account.threads_connected ? ['threads'] : []),
  ]
}

// Reason a platform cannot be chosen, or '' when it can. `elig` maps a platform to its eligibility result
// (igEligibility for instagram, threadsEligibility for threads).
export function platformReason(account, platform, elig = {}) {
  if (platform === 'threads' ? account.threads_needs_reconnect : account.needs_reconnect) return RECONNECT
  return elig[platform] && !elig[platform].ok ? elig[platform].reason : ''
}

// True when at least one connected platform does not need reconnecting first.
export const canShare = (account) => connectedPlatforms(account).some((p) => platformReason(account, p) !== RECONNECT)

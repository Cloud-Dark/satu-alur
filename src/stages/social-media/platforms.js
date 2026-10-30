// Platform rules shared by Konten (share now) and Jadwal (schedule): connected platforms only, reconnect first, per-platform eligibility.
export const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads' }
export const RECONNECT = 'Hubungkan ulang akun di tab Akun.'

// Takes the tab ctx: a platform shows only when it is connected and its integration is configured.
export function connectedPlatforms({ account, configured, threadsConfigured }) {
  if (!account) return []
  return [
    ...(account.fb_connected && configured !== false ? ['facebook', ...(account.ig_connected ? ['instagram'] : [])] : []),
    ...(account.threads_connected && threadsConfigured !== false ? ['threads'] : []),
  ]
}

// Reason a platform cannot be chosen, or '' when it can. `elig` maps a platform to its eligibility result
// (igEligibility for instagram, threadsEligibility for threads).
export function platformReason(account, platform, elig = {}) {
  if (platform === 'threads' ? account.threads_needs_reconnect : account.needs_reconnect) return RECONNECT
  return elig[platform] && !elig[platform].ok ? elig[platform].reason : ''
}

// True when at least one connected platform does not need reconnecting first.
export const canShare = (ctx) => connectedPlatforms(ctx).some((p) => platformReason(ctx.account, p) !== RECONNECT)

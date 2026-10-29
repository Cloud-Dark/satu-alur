// Platform rules shared by Konten (share now) and Jadwal (schedule): connected platforms only, reconnect first, IG eligibility.
export const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram' }
export const RECONNECT = 'Hubungkan ulang akun di tab Akun.'

export function connectedPlatforms(account) {
  return account ? ['facebook', ...(account.ig_connected ? ['instagram'] : [])] : []
}

// Reason a platform cannot be chosen, or '' when it can. `ig` is the igEligibility() result for the content.
export function platformReason(account, platform, ig) {
  if (account.needs_reconnect) return RECONNECT
  return platform === 'instagram' && !ig.ok ? ig.reason : ''
}

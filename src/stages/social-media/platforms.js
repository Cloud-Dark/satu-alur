import { t } from '../../i18n/index.js'

// Platform rules shared by Konten (share now) and Jadwal (schedule): connected platforms only, reconnect first, per-platform eligibility.
export const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads' }
// Browser-only module: language is fixed per page load, so a module-level t() is safe here.
export const RECONNECT = t('social.platforms.reconnect')

// Eligibility reasons come from social/rules.js (shared with the worker) in Indonesian; show them in the UI language.
const REASON_KEYS = {
  'Instagram wajib memakai gambar.': 'igImage', 'Rasio gambar harus antara 4:5 dan 1,91:1 untuk Instagram.': 'igRatio',
  'Caption Instagram maksimal 2.200 karakter.': 'igCaption', 'Instagram maksimal 30 hashtag.': 'igTags',
  'Isi konten tidak boleh kosong.': 'empty', 'Threads maksimal 500 karakter.': 'thText', 'Threads maksimal 1 tag topik.': 'thTags',
}
export const reasonText = (r) => (REASON_KEYS[r] ? t(`social.platforms.reasons.${REASON_KEYS[r]}`) : r)

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
  return elig[platform] && !elig[platform].ok ? reasonText(elig[platform].reason) : ''
}

// True when at least one connected platform does not need reconnecting first.
export const canShare = (ctx) => connectedPlatforms(ctx).some((p) => platformReason(ctx.account, p) !== RECONNECT)

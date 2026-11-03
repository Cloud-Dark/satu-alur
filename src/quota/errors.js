// QuotaError and the "quota used up" event. No imports, so the LLM clients (src/http-cloud.js,
// src/mock/mock-cloud.js) can use it without an import cycle through src/cloud.js.

export const QUOTA_EVENT = 'satualur:quota'

/** Thrown when a feature's quota and the AI credit are both used up (HTTP 402). */
export class QuotaError extends Error {
  constructor(message, feature) {
    super(message)
    this.name = 'QuotaError'
    this.status = 402
    this.quota = true
    this.feature = feature || null
  }
}
export const isQuotaError = (err) => Boolean(err && (err.quota === true || err.status === 402))

/** Tells the shell to show the upsell dialog (src/quota/upsell.js). */
export function announceQuota(err) {
  try { window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: { feature: err.feature, message: err.message } })) } catch { /* no window */ }
}

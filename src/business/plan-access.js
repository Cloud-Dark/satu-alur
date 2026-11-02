/**
 * Subscription tier and feature gating — one source of truth for the Worker,
 * the browser and the mock cloud.
 *
 * A tier is stored per user in `user_flags.plan` (migration 0010). Everything
 * that is not explicitly listed in FEATURES is available on every tier, so a
 * new feature is open by default and closing it is a deliberate edit here.
 *
 * Errors carry Indonesian text, like the rest of the app's validators.
 */

export const PLANS = ['sole', 'ukm', 'enterprise']

export const PLAN_LABELS = {
  sole: 'Sole Trader',
  ukm: 'UKM',
  enterprise: 'Enterprise',
}

const RANK = { sole: 1, ukm: 2, enterprise: 3 }

/** Feature keys are stable strings; the UI and the Worker both use them. */
export const FEATURES = {
  erpIntegration: {
    label: 'Integrasi ERP & migrasi data',
    minPlan: 'enterprise',
    summary: 'Menghubungkan Satu Alur dengan ERP, database, atau file ekspor yang sudah dipakai perusahaan.',
  },
}

export function normalizePlan(value) {
  const v = String(value || '').trim().toLowerCase()
  return PLANS.includes(v) ? v : 'sole'
}

export function planLabel(plan) {
  return PLAN_LABELS[normalizePlan(plan)]
}

export function planRank(plan) {
  return RANK[normalizePlan(plan)]
}

/** Minimum tier for a feature, or 'sole' when the feature is ungated. */
export function requiredPlan(feature) {
  return normalizePlan(FEATURES[feature]?.minPlan || 'sole')
}

/** True when `plan` is at or above the feature's minimum tier. */
export function canUse(plan, feature) {
  const spec = FEATURES[feature]
  if (!spec) return true
  return planRank(plan) >= planRank(spec.minPlan)
}

/** Indonesian sentence for a 403 / locked panel. */
export function planLockMessage(feature) {
  const spec = FEATURES[feature]
  if (!spec) return ''
  return `${spec.label} tersedia pada paket ${planLabel(spec.minPlan)}.`
}

/**
 * The plan a demo account stands for. The seeded scales are already
 * sole/ukm/enterprise, so this is an identity map with a safety net.
 */
export function planForScale(scale) {
  return normalizePlan(scale)
}

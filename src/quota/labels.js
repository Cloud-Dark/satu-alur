/**
 * Display labels for the metered AI features in quota/rules.js (shared with the Worker, so its
 * Indonesian labels stay there). The UI translates them here by the stable feature key.
 */
import { t, has } from '../i18n/index.js'

/** "Penawaran AI" / "AI offers" for a feature key; fallback when the key is unknown. */
export const featureLabel = (key, fallback = key) => (has(`plan.feature.${key}.label`) ? t(`plan.feature.${key}.label`) : fallback)
/** "draf" / "drafts" for a feature key. */
export const featureUnit = (key, fallback = '') => (has(`plan.feature.${key}.unit`) ? t(`plan.feature.${key}.unit`) : fallback)

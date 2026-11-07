/**
 * Multi-language support (Indonesian + English).
 *
 * Strings live in src/lang/<lang>/<namespace>.json, e.g. src/lang/en/dashboard.json.
 * A key is "<namespace>.<path>": t('dashboard.kpi.profit') reads
 * src/lang/<current>/dashboard.json → { "kpi": { "profit": "…" } }.
 *
 *   t('common.save')                         → "Simpan" / "Save"
 *   t('dashboard.greeting', { name: 'Ana' }) → "{name}" placeholders are filled in
 *   t('common.items', { count: 3 })          → a value may be { "one": "…", "other": "…" }
 *
 * A key missing in the current language falls back to Indonesian, then to the key itself.
 *
 * Language choice: the one the user picked (localStorage "lang"), otherwise the browser's
 * preferred languages (navigator.languages), otherwise Indonesian. Switching reloads the page
 * so every screen renders again in the new language.
 */

export const LANGS = ['id', 'en']
export const DEFAULT_LANG = 'id'
export const LANG_NAMES = { id: 'Bahasa Indonesia', en: 'English' }
const KEY = 'lang'

// Vite bundles every JSON file at build time by rewriting this exact call (a `typeof
// import.meta.glob` check is NOT rewritten, so the call must be made directly). Outside Vite
// (node tests, the worker) import.meta.glob does not exist; t() then returns the key.
let files = {}
try {
  files = import.meta.glob('../lang/*/*.json', { eager: true, import: 'default' })
} catch { /* not running under Vite */ }

const dict = { id: {}, en: {} }
for (const [path, data] of Object.entries(files)) {
  const m = path.match(/lang\/([a-z]{2})\/([\w-]+)\.json$/)
  if (m && dict[m[1]]) dict[m[1]][m[2]] = data
}

function storedLang() {
  try { const v = localStorage.getItem(KEY); return LANGS.includes(v) ? v : null } catch { return null }
}

/** Picks a supported language from the browser's preferences (e.g. "en-GB" → "en", "id-ID" → "id"). */
export function detectLang(prefs) {
  const list = prefs || (typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [])
  for (const p of list) {
    const base = String(p || '').toLowerCase().split('-')[0]
    if (base === 'ms') return 'id' // Malay readers are closer to Indonesian
    if (LANGS.includes(base)) return base
  }
  return DEFAULT_LANG
}

let current = (typeof window !== 'undefined' && (storedLang() || detectLang())) || DEFAULT_LANG

export function getLang() { return current }

/** Locale for Intl / toLocale* calls: "id-ID" or "en-US". */
export function locale() { return current === 'en' ? 'en-US' : 'id-ID' }

/** Saves the choice and reloads so every page renders in the new language. */
export function setLang(lang, { reload = true } = {}) {
  if (!LANGS.includes(lang)) return
  try { localStorage.setItem(KEY, lang) } catch { /* storage unavailable */ }
  current = lang
  applyDocumentLang()
  if (reload && typeof location !== 'undefined') location.reload()
}

export function applyDocumentLang() {
  if (typeof document !== 'undefined') document.documentElement.lang = current
}

function lookup(lang, key) {
  const [ns, ...rest] = key.split('.')
  let v = dict[lang]?.[ns]
  for (const part of rest) {
    if (v == null || typeof v !== 'object') return undefined
    v = v[part]
  }
  return v
}

function fill(str, vars) {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}

/** Translates a key. vars fills {placeholders}; vars.count picks one/other for plural objects. */
export function t(key, vars) {
  let v = lookup(current, key)
  if (v == null) v = lookup(DEFAULT_LANG, key)
  if (v == null) return key
  if (typeof v === 'object' && !Array.isArray(v)) {
    const n = Number(vars?.count)
    v = n === 1 && v.one != null ? v.one : (v.other ?? v.one ?? key)
  }
  return typeof v === 'string' ? fill(v, vars) : v
}

/** Returns a translated array/object value as-is (lists of bullet points, FAQ entries…). */
export function tv(key) {
  const v = lookup(current, key)
  return v != null ? v : lookup(DEFAULT_LANG, key)
}

/** True when the key exists in the current language (or the fallback). */
export function has(key) {
  return lookup(current, key) != null || lookup(DEFAULT_LANG, key) != null
}

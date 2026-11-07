/**
 * i18n core (pure; no DOM, no bundler features): catalogs per language and
 * namespace, key lookup with fallback, {var} interpolation and language detection.
 *
 * Texts live in /lang/<lang>/<namespace>.json, e.g. lang/en/header.json; a key is
 * "<namespace>.<path.in.json>", e.g. t('header.nav.pricing').
 */
export const LANGS = [
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID', locale: 'id-ID' },
  { code: 'en', label: 'English', short: 'EN', locale: 'en-US' },
]
export const DEFAULT_LANG = 'id'
export const STORAGE_KEY = 'satualur_lang'
const CODES = new Set(LANGS.map((l) => l.code))

const catalogs = new Map() // lang -> { [namespace]: object }

export function registerCatalog(lang, namespace, data) {
  if (!catalogs.has(lang)) catalogs.set(lang, {})
  catalogs.get(lang)[namespace] = data || {}
}

export const isLang = (code) => CODES.has(code)

/** Language from a stored choice, else the browser's languages (Indonesian/Malay → id, anything else → en). */
export function detectLang({ stored, languages = [] } = {}) {
  if (isLang(stored)) return stored
  for (const raw of languages || []) {
    const code = String(raw || '').toLowerCase()
    if (code.startsWith('id') || code.startsWith('in') || code.startsWith('ms')) return 'id'
    if (code.startsWith('en')) return 'en'
  }
  return (languages || []).length ? 'en' : DEFAULT_LANG
}

function lookup(lang, key) {
  const cat = catalogs.get(lang)
  if (!cat) return undefined
  const [ns, ...path] = String(key).split('.')
  let v = cat[ns]
  for (const p of path) {
    if (v == null || typeof v !== 'object') return undefined
    v = v[p]
  }
  return v
}

/** Fills {name} placeholders; unknown placeholders stay as they are. */
export function interpolate(text, vars) {
  if (!vars) return text
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])))
}

/**
 * Translates `key` in `lang`, falling back to Indonesian, then to `fallback`
 * (or the key itself). Arrays and objects are returned as they are (lists of texts).
 */
export function translate(lang, key, vars, fallback) {
  let v = lookup(lang, key)
  if (v === undefined && lang !== DEFAULT_LANG) v = lookup(DEFAULT_LANG, key)
  if (v === undefined) return fallback !== undefined ? interpolate(fallback, vars) : key
  return typeof v === 'string' ? interpolate(v, vars) : v
}

/** Every key path of a catalog object ("a.b.c"), for parity checks between languages. */
export function keyPaths(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj || {})) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keyPaths(v, p))
    else out.push(p)
  }
  return out
}

/**
 * App i18n: loads every /lang/<lang>/<namespace>.json at build time, picks the
 * language (stored choice → browser language) and exposes t(), the current
 * locale for Intl, and setLang() (saves the choice and reloads the page so every
 * screen redraws in the new language).
 *
 *   import { t } from '../i18n/index.js'
 *   t('header.nav.pricing')              // "Harga" / "Pricing"
 *   t('common.time.ago', { n: 3, unit }) // with {n} placeholders
 */
import { LANGS, DEFAULT_LANG, STORAGE_KEY, registerCatalog, detectLang, translate, isLang } from './core.js'

export { LANGS }

let files = {}
try {
  // Vite replaces this with the bundled JSON objects; under plain Node it throws and the app runs on fallbacks.
  files = import.meta.glob('../../lang/*/*.json', { eager: true, import: 'default' })
} catch { files = {} }
for (const [path, data] of Object.entries(files)) {
  const m = path.match(/lang\/([a-z]{2})\/([\w-]+)\.json$/)
  if (m) registerCatalog(m[1], m[2], data)
}

const store = {
  get() { try { return localStorage.getItem(STORAGE_KEY) } catch { return null } },
  set(v) { try { localStorage.setItem(STORAGE_KEY, v) } catch { /* storage unavailable */ } },
}

let current = typeof navigator === 'undefined'
  ? DEFAULT_LANG
  : detectLang({ stored: store.get(), languages: navigator.languages?.length ? navigator.languages : [navigator.language] })
if (typeof document !== 'undefined') document.documentElement.lang = current

export const getLang = () => current
export const locale = () => LANGS.find((l) => l.code === current)?.locale || 'id-ID'

/** Translate a key in the current language. `fallback` is used when no catalog has the key. */
export const t = (key, vars, fallback) => translate(current, key, vars, fallback)

/** Switches the language, remembers it on this device and redraws the page. */
export function setLang(code, { reload = true } = {}) {
  if (!isLang(code) || code === current) return
  store.set(code)
  current = code
  if (typeof document !== 'undefined') document.documentElement.lang = code
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('satualur:lang-changed', { detail: { lang: code } }))
    if (reload) window.location.reload()
  }
}

/** Language switch button ("ID" / "EN"); place it next to the theme toggle. */
export function langSwitcher({ className = '' } = {}) {
  const next = LANGS.find((l) => l.code !== current) || LANGS[0]
  const cur = LANGS.find((l) => l.code === current) || LANGS[0]
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `lang-switch ${className}`.trim()
  b.dataset.lang = current
  b.setAttribute('aria-label', t('common.lang.switchTo', { lang: next.label }))
  b.title = t('common.lang.switchTo', { lang: next.label })
  b.innerHTML = `<span class="lang-switch-cur">${cur.short}</span><span class="lang-switch-sep" aria-hidden="true">/</span><span class="lang-switch-next">${next.short}</span>`
  b.addEventListener('click', () => setLang(next.code))
  return b
}

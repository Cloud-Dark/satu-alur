/**
 * Language switch button: shows the current language ("ID" / "EN") and toggles to
 * the other one. Placed next to the theme toggle on every page.
 */
import { getLang, setLang, LANG_NAMES, t } from './index.js'

export function langToggleButton() {
  const cur = getLang()
  const next = cur === 'id' ? 'en' : 'id'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'icon-btn lang-toggle'
  btn.textContent = cur.toUpperCase()
  const label = t('common.lang.switchTo', { lang: LANG_NAMES[next] })
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.setAttribute('lang', next)
  btn.addEventListener('click', () => setLang(next))
  return btn
}

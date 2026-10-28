/**
 * Light/dark theme. The initial theme is applied by an inline script in
 * index.html (before first paint) to avoid a flash; this module handles toggling.
 */
import { icon } from './icons.js'

const KEY = 'theme'

export function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch { /* storage unavailable */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1310' : '#f7f4ee')
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }))
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark')
}

/** Icon button that toggles the theme and keeps its own icon in sync. */
export function themeToggleButton() {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'icon-btn theme-toggle'
  const sync = () => {
    if (btn.dataset.mounted && !btn.isConnected) {
      window.removeEventListener('themechange', sync)
      return
    }
    if (btn.isConnected) btn.dataset.mounted = '1'
    const dark = getTheme() === 'dark'
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'))
    btn.setAttribute('aria-label', dark ? 'Gunakan mode terang' : 'Gunakan mode gelap')
    btn.title = btn.getAttribute('aria-label')
  }
  btn.addEventListener('click', toggleTheme)
  window.addEventListener('themechange', sync)
  sync()
  return btn
}

/** Reads a CSS custom property from :root (used by canvas/WebGL scenes). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

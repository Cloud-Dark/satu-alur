/**
 * AntiSlop — small UI quality guard for Satu Alur.
 *
 * Colours, type and spacing live in src/styles/tokens.css. TOKENS mirrors
 * them as CSS variable references so JS never carries raw hex values and
 * both themes keep working.
 */

export const TOKENS = Object.freeze({
  colors: {
    paper: 'var(--paper)',
    paper2: 'var(--paper-2)',
    card: 'var(--card)',
    sunken: 'var(--sunken)',
    ink: 'var(--ink)',
    ink2: 'var(--ink-2)',
    muted: 'var(--muted)',
    faint: 'var(--faint)',
    rule: 'var(--rule)',
    signal: 'var(--signal)',
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    danger: 'var(--danger)',
    // Legacy aliases (older callers asked for these names)
    primary: 'var(--ink)',
    text: 'var(--ink)',
    textMuted: 'var(--muted)',
    success: 'var(--ok)',
    warning: 'var(--warn)',
    accent: {},
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 },
  radius: { sm: 4, md: 6 },
  font: {
    display: 'var(--font-display)',
    sans: 'var(--font-body)',
    mono: 'var(--font-mono)',
    weights: { normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
  },
  shadows: { sm: 'var(--shadow-sm)', md: 'var(--shadow)', lg: 'var(--shadow-lg)' },
})

/** Returns a CSS variable reference for a named token colour. */
export function solidColor(name) {
  const color = TOKENS.colors[name]
  if (!color || typeof color !== 'string') throw new Error(`[AntiSlop] Warna "${name}" tidak terdaftar di TOKENS`)
  return color
}

/* ---------------------------------------------------------------- Validator */

export const VALIDATOR = {
  input(element, labelText) {
    const ok = Boolean(labelText && labelText.length >= 2) && Boolean(element.id || element.getAttribute('aria-label'))
    if (!ok) console.warn('[AntiSlop::Input] Input wajib punya label dan id/aria-label', element)
    return ok
  },
  card(element, title) {
    const ok = Boolean(title && title.trim().length >= 3)
    if (!ok) console.warn('[AntiSlop::Card] Judul kartu terlalu pendek', element)
    return ok
  },
  button(element, text) {
    const ok = Boolean((text && text.trim()) || element.getAttribute('aria-label'))
    if (!ok) console.warn('[AntiSlop::Button] Tombol wajib punya label', element)
    return ok
  },
  noPlaceholderLabel(element) {
    const hasLabel = element.labels?.length > 0 || element.getAttribute('aria-label')
    if (element.getAttribute('placeholder') && !hasLabel) {
      console.warn('[AntiSlop::A11y] Placeholder tidak boleh menggantikan label', element)
      return false
    }
    return true
  },
}

/* ------------------------------------------------------------- Content gate */

const SLOP_PATTERNS = [/lorem\s+ipsum/i, /dummy\s+text/i, /click\s+here/i, /untitled/i, /\btodo\b/i, /\bfixme\b/i]
const EMOJI = /\p{Extended_Pictographic}/u

export const CONTENT_GATE = {
  scan(text, context = 'unknown') {
    if (!text || typeof text !== 'string') return { clean: true, issues: [] }
    const issues = []
    for (const p of SLOP_PATTERNS) if (p.test(text)) issues.push(`Pola placeholder: "${text.slice(0, 40)}"`)
    if (EMOJI.test(text)) issues.push(`Emoji di teks UI: "${text.slice(0, 40)}"`)
    if (issues.length) console.warn(`[AntiSlop::Content][${context}]`, issues.join('; '))
    return { clean: issues.length === 0, issues }
  },
  cardDescription(text) { return this.scan(text, 'card-description') },
  buttonLabel(text) {
    const result = this.scan(text, 'button-label')
    if (text && text.length > 32) {
      result.issues.push('Label tombol terlalu panjang (maks 32 karakter)')
      result.clean = false
    }
    return result
  },
}

/* ------------------------------------------------------------- Audit (dev) */

export const ANTI_PATTERNS = {
  detect(root = document.body) {
    const issues = []
    root.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') || ''
      if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(style)) issues.push({ type: 'hardcoded-color', element: el })
    })
    root.querySelectorAll('img:not([alt])').forEach((el) => issues.push({ type: 'missing-alt', element: el }))
    root.querySelectorAll('button, a').forEach((el) => {
      if (!el.textContent.trim() && !el.getAttribute('aria-label') && !el.title) issues.push({ type: 'unlabelled-control', element: el })
    })
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (EMOJI.test(walker.currentNode.nodeValue)) issues.push({ type: 'emoji', element: walker.currentNode.parentElement })
    }
    if (issues.length) {
      console.groupCollapsed(`[AntiSlop::Audit] ${issues.length} temuan`)
      issues.forEach((i) => console.warn(i.type, i.element))
      console.groupEnd()
    }
    return issues
  },
}

/* ---------------------------------------------------------------- Skeleton */

export function createSkeleton({ type = 'text', lines = 1, width = '100%' } = {}) {
  const wrapper = document.createElement('div')
  wrapper.className = `skel-group skel-${type}`
  wrapper.setAttribute('aria-busy', 'true')
  wrapper.setAttribute('aria-label', 'Memuat')
  for (let i = 0; i < lines; i++) {
    const line = document.createElement('div')
    line.className = 'skel'
    line.style.width = i === lines - 1 && lines > 1 ? '60%' : width
    wrapper.appendChild(line)
  }
  return wrapper
}

/* -------------------------------------------------------------- Injection */

export function injectAntiSlopStyles() {
  if (document.getElementById('antislop-styles')) return
  const style = document.createElement('style')
  style.id = 'antislop-styles'
  style.textContent = `
    .slop-warning { outline: 2px dashed var(--danger) !important; outline-offset: 2px !important; }
  `
  document.head.appendChild(style)
}

/**
 * Dev-only audit. Opt in with localStorage.satualur_audit = '1' on localhost.
 * Runs on DOM changes (debounced) instead of polling the whole tree.
 */
export function enableDevAudit(debounceMs = 1500) {
  if (typeof window === 'undefined') return
  const host = window.location.hostname
  if (host !== 'localhost' && host !== '127.0.0.1') return
  let optedIn = false
  try { optedIn = localStorage.getItem('satualur_audit') === '1' } catch { /* storage unavailable */ }
  if (!optedIn) return
  injectAntiSlopStyles()
  let t = null
  const observer = new MutationObserver(() => {
    clearTimeout(t)
    t = setTimeout(() => ANTI_PATTERNS.detect(), debounceMs)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  console.info('[AntiSlop] Audit dev aktif')
}

export default {
  TOKENS,
  VALIDATOR,
  CONTENT_GATE,
  ANTI_PATTERNS,
  solidColor,
  createSkeleton,
  injectAntiSlopStyles,
  enableDevAudit,
}

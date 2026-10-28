/**
 * AntiSlop Engine — UI/UX Quality Enforcement System
 * Satu Alur Edition — Orange & Brown Solid Color Palette
 */

/* =========================================================
   DESIGN TOKENS — Single Source of Truth
   Orange + Brown solid colors. NO gradients.
   ========================================================= */

export const TOKENS = Object.freeze({
  colors: {
    // Base — Light Theme
    bgDeep: '#faf6f1',
    bgSurface: '#ffffff',
    bgCard: '#ffffff',
    bgInput: '#f5f0ea',
    bgHover: '#f0e9e0',

    // Text
    text: '#3d2b1f',
    textMuted: '#8a7263',
    textDim: '#b5a396',

    // Primary — Orange (solid only)
    primary: '#e67e22',
    primaryDark: '#d35400',
    primaryLight: '#f39c12',
    primarySoft: 'rgba(230,126,34,0.12)',

    // Secondary — Brown (solid only)
    secondary: '#8d6e63',
    secondaryDark: '#6d4c41',
    secondaryLight: '#a1887f',
    secondarySoft: 'rgba(141,110,99,0.12)',

    // Accent palette (solid, no gradients)
    accent: {
      orange: '#e67e22',
      brown: '#8d6e63',
      terracotta: '#c0392b',
      sand: '#d4a574',
      cream: '#f5e6d3',
      olive: '#7d8c3f',
    },

    // Semantic
    danger: '#c0392b',
    success: '#27ae60',
    warning: '#f39c12',
    info: '#2980b9',

    // Borders
    border: '#e8ddd0',
    borderLight: '#f0e6da',
    borderFocus: '#e67e22',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
  },

  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    full: 9999,
  },

  font: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
    sizes: {
      xs: '0.75rem',
      sm: '0.85rem',
      base: '0.95rem',
      md: '1.05rem',
      lg: '1.15rem',
      xl: '1.3rem',
      '2xl': '1.5rem',
      '3xl': '2rem',
    },
    weights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
  },

  shadows: {
    card: '0 2px 12px rgba(61,43,31,0.06)',
    button: '0 4px 12px rgba(230,126,34,0.2)',
    hover: '0 6px 20px rgba(61,43,31,0.08)',
  },

  transitions: {
    fast: '0.15s ease',
    normal: '0.2s ease',
    slow: '0.3s ease',
  },
})

/* =========================================================
   SOLID COLOR HELPER — No gradients allowed
   ========================================================= */
export function solidColor(name) {
  const color = TOKENS.colors[name] || TOKENS.colors.accent[name]
  if (!color) throw new Error(`[AntiSlop] Color "${name}" tidak terdaftar di TOKENS`)
  return color
}

/* =========================================================
   LAYOUT CONSTRAINT ENGINE
   ========================================================= */

export const CONSTRAINTS = Object.freeze({
  maxWidth: {
    content: 1100,
    form: 420,
    dialog: 520,
    panel: 420,
  },
  minTap: 44,
  maxLines: {
    cardTitle: 2,
    description: 4,
    toast: 3,
  },
  grid: {
    columns: [1, 2, 3, 4, 6, 12],
    gutter: TOKENS.spacing.md,
  },
})

export function size(value, allowed = 'md') {
  const sizes = TOKENS.spacing
  if (typeof value === 'number') {
    if (!Object.values(sizes).includes(value)) {
      console.warn(`[AntiSlop] Size ${value}px tidak terdaftar. Gunakan: ${Object.values(sizes).join(', ')}px`)
      return sizes[allowed] || value
    }
  }
  return value
}

/* =========================================================
   COMPONENT VALIDATOR
   ========================================================= */

export const VALIDATOR = {
  input(element, labelText) {
    const violations = []
    if (!labelText || labelText.length < 2) {
      violations.push('Input WAJIB memiliki label deskriptif (min 2 karakter)')
    }
    if (!element.id && !element.getAttribute('aria-label')) {
      violations.push('Input WAJIB memiliki id atau aria-label untuk aksesibilitas')
    }
    if (violations.length > 0) {
      console.error('[AntiSlop::Input]', violations.join('; '), element)
    }
    return violations.length === 0
  },

  card(element, title) {
    const violations = []
    if (!title || title.trim().length < 3) {
      violations.push('Card WAJIB memiliki title deskriptif (min 3 karakter)')
    }
    if (element.children.length === 0) {
      violations.push('Card tidak boleh kosong — gunakan skeleton jika loading')
    }
    if (violations.length > 0) {
      console.error('[AntiSlop::Card]', violations.join('; '), element)
    }
    return violations.length === 0
  },

  button(element, text) {
    const violations = []
    if (!text || text.trim().length === 0) {
      violations.push('Button WAJIB memiliki label text atau aria-label')
    }
    if (element.offsetWidth < CONSTRAINTS.minTap || element.offsetHeight < CONSTRAINTS.minTap) {
      violations.push(`Button WAJIB min ${CONSTRAINTS.minTap}x${CONSTRAINTS.minTap}px (WCAG)`)
    }
    if (violations.length > 0) {
      console.warn('[AntiSlop::Button]', violations.join('; '), element)
    }
    return violations.length === 0
  },

  noPlaceholderLabel(element) {
    const placeholder = element.getAttribute('placeholder')
    const hasLabel = element.labels?.length > 0 || document.querySelector(`label[for="${element.id}"]`)
    if (placeholder && !hasLabel && !element.getAttribute('aria-label')) {
      console.error('[AntiSlop::A11y] Placeholder tidak boleh menggantikan label. Tambahkan <label> atau aria-label:', element)
      return false
    }
    return true
  },
}

/* =========================================================
   CONTENT QUALITY GATE
   ========================================================= */

const SLOP_PATTERNS = [
  /lorem\s+ipsum/i,
  /placeholder/i,
  /dummy\s+text/i,
  /sample\s+content/i,
  /click\s+here/i,
  /read\s+more\.{0,3}$/i,
  /untitled/i,
  /no\s+description/i,
  /xxx+/,
  /todo/i,
  /fixme/i,
  /\.{3,}$/,
]

const WEAK_WORDS = new Set([
  'bagus', 'nice', 'good', 'very', 'sangat', 'cukup', 'lumayan',
  'dll', 'etc', 'dst', 'dan lain-lain', 'dsh',
])

export const CONTENT_GATE = {
  scan(text, context = 'unknown') {
    if (!text || typeof text !== 'string') return { clean: true, issues: [] }
    const issues = []

    for (const pattern of SLOP_PATTERNS) {
      if (pattern.test(text)) {
        issues.push(`Terdeteksi pola placeholder/slop: "${text.slice(0, 40)}..."`)
      }
    }

    const words = text.toLowerCase().split(/\s+/)
    const weakCount = words.filter(w => WEAK_WORDS.has(w)).length
    if (weakCount > 3) {
      issues.push(`Konten terlalu generik (${weakCount} weak words). Tambahkan detail spesifik.`)
    }

    if (text.length < 10) {
      issues.push('Konten terlalu pendek (< 10 karakter). Tambahkan deskripsi.')
    }

    if (issues.length > 0) {
      console.warn(`[AntiSlop::Content][${context}]`, issues.join('; '))
    }

    return { clean: issues.length === 0, issues }
  },

  cardDescription(text) {
    return this.scan(text, 'card-description')
  },

  buttonLabel(text) {
    const result = this.scan(text, 'button-label')
    if (text && text.length > 30) {
      result.issues.push('Label button terlalu panjang (max 30 karakter)')
      result.clean = false
    }
    return result
  },
}

/* =========================================================
   ANTI-PATTERN DETECTOR
   ========================================================= */

export const ANTI_PATTERNS = {
  detect() {
    const issues = []

    document.querySelectorAll('[style]').forEach(el => {
      const style = el.getAttribute('style')
      if (/#[0-9a-f]{3,6}/i.test(style) && !style.includes('var(--')) {
        issues.push({ type: 'hardcoded-color', element: el, style })
      }
      const pxValues = style.match(/(\d+)px/g)
      if (pxValues) {
        const allowedPx = Object.values(TOKENS.spacing)
        pxValues.forEach(px => {
          const val = parseInt(px)
          if (!allowedPx.includes(val) && ![1, 2, 3].includes(val)) {
            issues.push({ type: 'arbitrary-size', element: el, value: val })
          }
        })
      }
    })

    document.querySelectorAll('img:not([alt])').forEach(el => {
      issues.push({ type: 'missing-alt', element: el })
    })

    document.querySelectorAll('a').forEach(el => {
      if (!el.textContent.trim() && !el.querySelector('img, svg, [aria-label]')) {
        issues.push({ type: 'empty-link', element: el })
      }
    })

    const fontSizes = new Set()
    document.querySelectorAll('*').forEach(el => {
      const size = getComputedStyle(el).fontSize
      fontSizes.add(size)
    })
    if (fontSizes.size > 10) {
      issues.push({ type: 'font-inconsistency', count: fontSizes.size, sizes: [...fontSizes] })
    }

    if (issues.length > 0) {
      console.group('[AntiSlop::Audit] Issues ditemukan:', issues.length)
      issues.forEach((issue, i) => {
        console.warn(`  ${i + 1}. [${issue.type}]`, issue.element || '', issue.style || issue.value || '')
      })
      console.groupEnd()
    } else {
      console.log('[AntiSlop::Audit] Tidak ada anti-pattern terdeteksi')
    }

    return issues
  },
}

/* =========================================================
   SKELETON FACTORY
   ========================================================= */

export function createSkeleton({ type = 'text', lines = 1, width = '100%' }) {
  const wrapper = document.createElement('div')
  wrapper.style.display = 'flex'
  wrapper.style.flexDirection = 'column'
  wrapper.style.gap = TOKENS.spacing.sm + 'px'
  wrapper.setAttribute('aria-busy', 'true')
  wrapper.setAttribute('aria-label', 'Loading...')

  for (let i = 0; i < lines; i++) {
    const line = document.createElement('div')
    line.style.height = type === 'title' ? '20px' : '14px'
    line.style.width = i === lines - 1 && lines > 1 ? '60%' : width
    line.style.borderRadius = TOKENS.radius.sm + 'px'
    line.style.background = TOKENS.colors.bgHover
    line.style.animation = 'skeleton-pulse 1.5s ease-in-out infinite'
    line.style.animationDelay = `${i * 0.1}s`
    wrapper.appendChild(line)
  }

  return wrapper
}

/* =========================================================
   CSS INJECTION
   ========================================================= */

export function injectAntiSlopStyles() {
  if (document.getElementById('antislop-styles')) return

  const style = document.createElement('style')
  style.id = 'antislop-styles'
  style.textContent = `
    @keyframes skeleton-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.7; }
    }
    .slop-warning {
      outline: 3px dashed var(--danger, #c0392b) !important;
      outline-offset: 2px !important;
      position: relative;
    }
    .slop-warning::after {
      content: 'SLOP';
      position: absolute;
      top: -20px;
      left: 0;
      background: var(--danger, #c0392b);
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: bold;
      pointer-events: none;
      z-index: 99999;
    }
  `
  document.head.appendChild(style)
}

/* =========================================================
   DEV MODE
   ========================================================= */

export function enableDevAudit(intervalMs = 5000) {
  if (typeof window === 'undefined') return
  if (window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1')) {
    console.log('[AntiSlop] Dev audit dinonaktifkan di non-localhost')
    return
  }

  injectAntiSlopStyles()

  setInterval(() => {
    ANTI_PATTERNS.detect()
  }, intervalMs)

  const observer = new MutationObserver(() => {
    clearTimeout(window._antislopDebounce)
    window._antislopDebounce = setTimeout(() => ANTI_PATTERNS.detect(), 1000)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  console.log('[AntiSlop] Dev audit aktif — memeriksa UI setiap', intervalMs, 'ms')
}

/* =========================================================
   EXPORTS
   ========================================================= */
export default {
  TOKENS,
  CONSTRAINTS,
  VALIDATOR,
  CONTENT_GATE,
  ANTI_PATTERNS,
  solidColor,
  size,
  createSkeleton,
  injectAntiSlopStyles,
  enableDevAudit,
}

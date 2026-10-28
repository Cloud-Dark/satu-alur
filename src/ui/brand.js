/**
 * Satu Alur brand mark: a rounded green tile with one flowing line
 * (the "alur") that bends into an S, starting from a turmeric seed.
 */

export function logoMarkHTML({ size = 30 } = {}) {
  return `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--brand)"/>
    <path d="M9.5 22.5c0 0 2.2 1.5 6.5 1.5 3.6 0 5.8-1.6 5.8-4.1 0-2.6-2.4-3.4-5.8-3.9-3.4-.5-5.8-1.3-5.8-3.9C10.2 9.6 12.4 8 16 8c3.2 0 5.3 1 6.5 2" stroke="var(--text-on-brand)" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="22.5" cy="10" r="2.4" fill="var(--accent)"/>
  </svg>`
}

export function logoHTML({ size = 30, withText = true } = {}) {
  const text = withText
    ? '<span class="brand-word">Satu<span class="brand-word-thin">Alur</span></span>'
    : ''
  return `<span class="brand">${logoMarkHTML({ size })}${text}</span>`
}

/** Returns an <a> element pointing to the landing page. */
export function logoLink({ size = 30, href = '#/' } = {}) {
  const a = document.createElement('a')
  a.href = href
  a.className = 'brand-link'
  a.setAttribute('aria-label', 'Satu Alur — beranda')
  a.innerHTML = logoHTML({ size })
  return a
}

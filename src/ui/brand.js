/**
 * Satu Alur brand mark: one continuous line (the "alur") bending into an S
 * and leaving as an arrow. The start node uses the signal colour.
 */

export function logoMarkHTML({ size = 28 } = {}) {
  return `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6" fill="var(--card)" stroke="var(--ink)" stroke-width="1.5"/>
    <path d="M7 24h13a4 4 0 0 0 0-8h-8a4 4 0 0 1 0-8h13" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M21.5 4.5 25 8l-3.5 3.5" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="7" cy="24" r="2.6" fill="var(--signal)" stroke="var(--ink)" stroke-width="1.4"/>
  </svg>`
}

export function logoHTML({ size = 28, withText = true } = {}) {
  const text = withText
    ? '<span class="brand-word">Satu<span class="brand-word-thin">Alur</span></span>'
    : ''
  return `<span class="brand">${logoMarkHTML({ size })}${text}</span>`
}

/** Returns an <a> element pointing to the landing page. */
export function logoLink({ size = 28, href = '#/' } = {}) {
  const a = document.createElement('a')
  a.href = href
  a.className = 'brand-link'
  a.setAttribute('aria-label', 'Satu Alur — beranda')
  a.innerHTML = logoHTML({ size })
  return a
}

/**
 * Satu Alur brand mark: a rounded green tile with one continuous line that
 * climbs in steps (one flow, growing stage by stage) up to a turmeric milestone.
 */

export function logoMarkHTML({ size = 30 } = {}) {
  return `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--brand)"/>
    <path d="M7.5 23.5h5.5v-5h5.5v-5h4" stroke="var(--text-on-brand)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="23.5" cy="9.5" r="3" fill="var(--accent)"/>
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

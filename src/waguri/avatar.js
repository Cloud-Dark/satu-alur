/**
 * Waguri's pictures. The real art lives in public/assets/waguri/ (avatar.png, a face
 * crop; full.png, the full body). When a file is missing or fails to load, an inline
 * SVG in the brand colours takes its place, so the widget never shows a broken image.
 */

export const AVATAR_SRC = '/assets/waguri/avatar.png'
export const FULL_SRC = '/assets/waguri/full.png'

// Remembered per page load so later renders go straight to the fallback.
const failed = { avatar: false, full: false }

const HAIR = '#2a2320'
const SKIN = '#f6dcc8'
const BLUSH = '#f2a9a0'

/** Head-and-shoulders, for round avatars (viewBox 0 0 120 120). */
export const AVATAR_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <rect width="120" height="120" fill="var(--brand-100, #dcebe3)"/>
  <circle cx="60" cy="60" r="60" fill="var(--brand-50, #edf5f0)"/>
  <path d="M22 120c2-22 18-34 38-34s36 12 38 34z" fill="#1b5a48"/>
  <path d="M48 88l12 14 12-14z" fill="#fbf9f5"/>
  <path d="M55 92l5 10 5-10-5-4z" fill="#e7a13a"/>
  <rect x="52" y="74" width="16" height="16" rx="6" fill="${SKIN}"/>
  <path d="M28 64c-2-26 12-44 32-44s34 18 32 44c-1 14-4 26-8 34l-6-30H42l-6 30c-4-8-7-20-8-34z" fill="${HAIR}"/>
  <ellipse cx="60" cy="58" rx="22" ry="25" fill="${SKIN}"/>
  <path d="M36 52c4-16 14-24 24-24s20 8 24 24c-6-6-12-9-16-10l-4 6-4-7c-6 2-14 6-24 11z" fill="${HAIR}"/>
  <ellipse cx="50" cy="61" rx="3.6" ry="4.6" fill="#2b1c05"/>
  <ellipse cx="70" cy="61" rx="3.6" ry="4.6" fill="#2b1c05"/>
  <circle cx="51.3" cy="59.4" r="1.3" fill="#fff"/>
  <circle cx="71.3" cy="59.4" r="1.3" fill="#fff"/>
  <path d="M45 54q5-3 9 0M66 54q5-3 9 0" stroke="${HAIR}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <ellipse cx="45" cy="69" rx="4" ry="2.4" fill="${BLUSH}" opacity=".55"/>
  <ellipse cx="75" cy="69" rx="4" ry="2.4" fill="${BLUSH}" opacity=".55"/>
  <path d="M55 72q5 4 10 0" stroke="#b4412f" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <path d="M80 36l6-4 2 7z" fill="#e7a13a"/>
</svg>`

/** Full body, standing (viewBox 0 0 240 420). */
export const FULL_SVG = `<svg viewBox="0 0 240 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMin meet">
  <defs>
    <linearGradient id="wgBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dcebe3"/><stop offset="1" stop-color="#8fbfab"/>
    </linearGradient>
  </defs>
  <rect width="240" height="420" fill="url(#wgBg)"/>
  <rect x="20" y="40" width="70" height="90" rx="6" fill="#fbf9f5" opacity=".5"/>
  <rect x="150" y="30" width="70" height="110" rx="6" fill="#fbf9f5" opacity=".4"/>
  <path d="M88 108c-4-40 12-70 32-70s36 30 32 70c-2 30-8 56-14 70H102c-6-14-12-40-14-70z" fill="${HAIR}"/>
  <path d="M100 400l4-118h12l2 118zM122 400l2-118h12l4 118z" fill="${SKIN}"/>
  <path d="M98 404h22v8H96zM120 404h22l2 8h-24z" fill="#16241f"/>
  <path d="M92 236l28-6 28 6 10 60H82z" fill="#16241f"/>
  <path d="M84 150c4-14 18-22 36-22s32 8 36 22l8 92H76z" fill="#1b5a48"/>
  <path d="M108 132l12 26 12-26z" fill="#fbf9f5"/>
  <path d="M116 142l4 22 4-22-4-4z" fill="#e7a13a"/>
  <path d="M84 152l-14 70 10 4 14-56zM156 152l14 70-10 4-14-56z" fill="#1b5a48"/>
  <circle cx="74" cy="228" r="7" fill="${SKIN}"/>
  <circle cx="166" cy="228" r="7" fill="${SKIN}"/>
  <rect x="160" y="196" width="26" height="34" rx="3" fill="#fbf9f5" transform="rotate(-8 173 213)"/>
  <rect x="112" y="112" width="16" height="22" rx="6" fill="${SKIN}"/>
  <ellipse cx="120" cy="92" rx="26" ry="30" fill="${SKIN}"/>
  <path d="M93 84c4-20 16-30 27-30s23 10 27 30c-7-7-14-11-19-12l-5 7-4-8c-8 2-16 7-26 13z" fill="${HAIR}"/>
  <ellipse cx="109" cy="96" rx="4" ry="5.2" fill="#2b1c05"/>
  <ellipse cx="131" cy="96" rx="4" ry="5.2" fill="#2b1c05"/>
  <circle cx="110.5" cy="94" r="1.4" fill="#fff"/>
  <circle cx="132.5" cy="94" r="1.4" fill="#fff"/>
  <ellipse cx="103" cy="105" rx="4.5" ry="2.6" fill="${BLUSH}" opacity=".55"/>
  <ellipse cx="137" cy="105" rx="4.5" ry="2.6" fill="${BLUSH}" opacity=".55"/>
  <path d="M114 109q6 4.5 12 0" stroke="#b4412f" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M142 64l7-5 2 8z" fill="#e7a13a"/>
</svg>`

function fallback(kind, className) {
  const span = document.createElement('span')
  span.className = `${className} wg-svg`
  span.setAttribute('aria-hidden', 'true')
  span.innerHTML = kind === 'full' ? FULL_SVG : AVATAR_SVG
  return span
}

/**
 * <img> for Waguri ('avatar' | 'full') that swaps itself for the SVG on error.
 * alt '' marks it decorative (the surrounding control carries the name).
 */
export function waguriImage(kind = 'avatar', { className = '', alt = '' } = {}) {
  if (failed[kind]) return fallback(kind, className)
  const img = document.createElement('img')
  img.className = className
  img.src = kind === 'full' ? FULL_SRC : AVATAR_SRC
  img.alt = alt
  img.decoding = 'async'
  img.draggable = false
  if (kind === 'avatar') { img.width = 64; img.height = 64 }
  img.addEventListener('error', () => {
    failed[kind] = true
    if (img.parentNode) img.replaceWith(fallback(kind, className))
  }, { once: true })
  return img
}

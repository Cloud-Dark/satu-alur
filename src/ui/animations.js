/**
 * Motion + feedback helpers. Every effect respects prefers-reduced-motion
 * and reads colours from tokens.css (no raw hex here).
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)' // mirrors --ease in tokens.css

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Fades/lifts an element in. Safe to call on detached nodes. */
export function animateEntrance(element, delay = 0, { distance = 14, duration = 560 } = {}) {
  if (!element || reducedMotion() || typeof element.animate !== 'function') return
  element.animate(
    [
      { opacity: 0, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration, delay, easing: EASE, fill: 'backwards' },
  )
}

/** Staggers the direct children of `parent`. */
export function staggerChildren(parent, { step = 50, start = 0, max = 12 } = {}) {
  if (!parent) return
  Array.from(parent.children).slice(0, max).forEach((child, i) => animateEntrance(child, start + i * step))
}

/**
 * Page-change entrance: header first, then each panel of a two-column stage
 * grid, in reading order.
 */
export function animateView(view) {
  if (!view || reducedMotion()) return
  const items = []
  for (const child of view.children) {
    if (child.classList.contains('stage-grid') || child.classList.contains('dash-body')) items.push(...child.children)
    else items.push(child)
  }
  items.slice(0, 10).forEach((n, i) => animateEntrance(n, i * 70))
}

/**
 * Counts a number up inside `element`, formatting each frame with `format`.
 * Lands exactly on `to`. Reduced motion: writes the final value immediately.
 */
export function countUp(element, to, format = (n) => String(Math.round(n)), { duration = 900, from = 0 } = {}) {
  if (!element) return
  const target = Number(to) || 0
  if (reducedMotion() || target === from) { element.textContent = format(target); return }
  element.textContent = format(from)
  let start = null
  const ease = (t) => 1 - Math.pow(1 - t, 3)
  const tick = (now) => {
    if (start == null) start = now
    const t = Math.min(1, (now - start) / duration)
    element.textContent = format(t === 1 ? target : from + (target - from) * ease(t))
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function pulseEffect(element) {
  if (!element || reducedMotion()) return
  element.animate([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], { duration: 900, iterations: 2, easing: EASE })
}

/**
 * Toast notification (styles live in tokens.css: .toast-stack/.toast).
 * type: 'info' | 'success' | 'error'
 */
export function showToast(message, type = 'info', duration = 3200) {
  if (!message || String(message).trim().length < 3) return

  let stack = document.querySelector('.toast-stack')
  if (!stack) {
    stack = document.createElement('div')
    stack.className = 'toast-stack'
    stack.setAttribute('role', 'status')
    stack.setAttribute('aria-live', 'polite')
    document.body.appendChild(stack)
  }

  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.textContent = message
  stack.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('leaving')
    toast.addEventListener('animationend', () => toast.remove(), { once: true })
    setTimeout(() => toast.remove(), 600)
  }, duration)
}

/** Types text into an element. Returns a cancel function. */
export function typewriterEffect(element, text, speed = 30) {
  if (!element || !text) return () => {}
  if (reducedMotion()) {
    element.textContent = text
    return () => {}
  }
  element.textContent = ''
  let i = 0
  const timer = setInterval(() => {
    element.textContent += text.charAt(i)
    i++
    if (i >= text.length) clearInterval(timer)
  }, speed)
  return () => clearInterval(timer)
}

/**
 * Kept for backwards compatibility. The app has no particle backdrop, so
 * this is a no-op that returns a cleanup function.
 */
export function createParticleBackground() {
  return () => {}
}

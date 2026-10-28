/**
 * Motion + feedback helpers. Every effect respects prefers-reduced-motion
 * and reads colours from tokens.css (no raw hex here).
 */

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Fades/lifts an element in. Safe to call on detached nodes. */
export function animateEntrance(element, delay = 0) {
  if (!element || reducedMotion()) return
  element.animate(
    [
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 420, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
  )
}

/** Staggers the direct children of `parent`. */
export function staggerChildren(parent, { step = 40, start = 0, max = 12 } = {}) {
  if (!parent) return
  Array.from(parent.children).slice(0, max).forEach((child, i) => animateEntrance(child, start + i * step))
}

export function pulseEffect(element) {
  if (!element || reducedMotion()) return
  element.animate([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 900, iterations: 2 })
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
 * Kept for backwards compatibility. The editorial design has no particle
 * backdrop, so this is a no-op that returns a cleanup function.
 */
export function createParticleBackground() {
  return () => {}
}

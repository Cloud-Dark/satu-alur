/**
 * Scroll reveal: adds .is-in to every .reveal element inside `root` when it
 * enters the viewport. Stagger with style="--d: 120ms" (transition-delay).
 * Returns a cleanup function.
 */
export function observeReveal(root = document) {
  const items = root.querySelectorAll('.reveal:not(.is-in)')
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'))
    return () => {}
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const el = entry.target
      const delay = el.style.getPropertyValue('--d')
      if (delay) el.style.transitionDelay = delay
      el.classList.add('is-in')
      io.unobserve(el)
    })
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  items.forEach((el) => io.observe(el))
  return () => io.disconnect()
}

export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

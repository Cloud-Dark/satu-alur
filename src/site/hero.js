/**
 * Landing hero copy from stored values, built with DOM nodes only. Blank fields
 * are skipped: an existing element keeps its content (the landing's defaults).
 * Elements are found by class inside `container`, or created when missing.
 */
import { iconHTML } from '../ui/icons.js'

const blank = (s) => typeof s !== 'string' || !s.trim()

function slot(container, tag, cls) {
  let el = container.querySelector(`.${cls.split(' ').pop()}`)
  if (!el) {
    el = document.createElement(tag)
    el.className = cls
    container.append(el)
  }
  return el
}

// One "*word*" becomes <em>word</em>.
function fillTitle(el, title) {
  const m = /\*([^*]+)\*/.exec(title)
  if (!m) { el.textContent = title; return }
  const em = document.createElement('em')
  em.textContent = m[1]
  el.replaceChildren(title.slice(0, m.index), em, title.slice(m.index + m[0].length))
}

export function renderHero(container, hero = {}) {
  if (!blank(hero.badge)) {
    const el = slot(container, 'p', 'lp-hero-badge')
    const dot = document.createElement('span')
    dot.className = 'pulse-dot'
    dot.setAttribute('aria-hidden', 'true')
    el.replaceChildren(dot, hero.badge.trim())
  }
  if (!blank(hero.title)) fillTitle(slot(container, 'h1', 'display lp-hero-title'), hero.title.trim())
  if (!blank(hero.subtitle)) slot(container, 'p', 'lp-hero-sub').textContent = hero.subtitle.trim()
  const points = (Array.isArray(hero.points) ? hero.points : []).filter((p) => !blank(p))
  if (points.length) {
    const ul = slot(container, 'ul', 'lp-hero-points')
    ul.replaceChildren(...points.map((p) => {
      const li = document.createElement('li')
      const tick = document.createElement('span')
      tick.className = 'lp-tick'
      tick.innerHTML = iconHTML('check', { size: 12, stroke: 3 }) // static markup
      li.append(tick, p.trim())
      return li
    }))
  }
}

/**
 * One pricing card, built with DOM nodes only (stored strings never touch innerHTML).
 * Same markup/classes as the landing's built-in cards; used by the landing and the admin preview.
 */
import { icon } from '../ui/icons.js'
import { formatPrice } from './plan-rules.js'

function h(tag, className, ...children) {
  const n = document.createElement(tag)
  if (className) n.className = className
  n.append(...children.filter((c) => c !== null))
  return n
}

export function renderPlanCard(plan) {
  const { price, period } = formatPrice(plan)
  const recommended = Boolean(plan.recommended)
  const contact = plan.cta_kind === 'contact'
  const variant = recommended ? 'btn-accent' : contact ? 'btn-primary' : 'btn-soft'
  const nameId = `tier-${plan.slug || 'baru'}`

  const cta = h('a', `btn btn-lg ${variant} lp-tier-cta`, plan.cta_label || 'Pilih paket', ' ', icon(contact ? 'arrowUpRight' : 'arrowRight', { className: 'icon-trailing' }))
  if (contact) {
    cta.setAttribute('href', '#')
    cta.setAttribute('data-placeholder', '')
    cta.setAttribute('aria-describedby', 'lp-contact-note')
    cta.addEventListener('click', (e) => e.preventDefault())
  } else {
    cta.setAttribute('href', '#/masuk')
  }

  const name = h('h3', 'lp-tier-name', plan.name || 'Nama paket')
  name.id = nameId
  const badge = recommended ? h('span', 'tag tag-accent lp-tier-badge', icon('sparkles', { size: 12, stroke: 2 }), plan.badge || 'Rekomendasi') : null
  const card = h('article', `lp-tier${recommended ? ' is-recommended' : ''}`,
    h('header', 'lp-tier-head', h('div', 'lp-tier-name-row', name, badge), h('p', 'lp-tier-tag', plan.tagline || '')),
    h('p', 'lp-tier-price', h('span', 'display lp-price', price), h('span', 'lp-period', period)),
    h('dl', 'lp-tier-limits', ...(plan.limits || []).map((l) => h('div', '', h('dt', '', l.label), h('dd', '', l.value)))),
    h('ul', 'lp-tier-features', ...(plan.features || []).map((f) => h('li', '', h('span', 'lp-tick', icon('check', { size: 12, stroke: 3 })), h('span', '', f)))),
    cta)
  card.setAttribute('aria-labelledby', nameId)
  return card
}

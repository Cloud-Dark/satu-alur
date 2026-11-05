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

/** Prices from Rp1.000.000 up ("Rp3.512.172") use a smaller size so they fit a four-column grid. */
export const isLongPrice = (price) => String(price).length > 9

export function renderPlanCard(plan) {
  const { price, period } = formatPrice(plan)
  const recommended = Boolean(plan.recommended)
  const contact = plan.cta_kind === 'contact'
  const variant = recommended ? 'btn-accent' : contact ? 'btn-primary' : 'btn-soft'
  const nameId = `tier-${plan.slug || 'baru'}`

  const cta = h('a', `btn btn-lg ${variant} lp-tier-cta`, plan.cta_label || 'Pilih paket', ' ', icon(contact ? 'arrowUpRight' : 'arrowRight', { className: 'icon-trailing' }))
  if (contact) {
    cta.setAttribute('href', '#/kontak')
    cta.setAttribute('aria-describedby', 'lp-contact-note')
  } else {
    cta.setAttribute('href', '#/masuk')
  }

  const name = h('h3', 'lp-tier-name', plan.name || 'Nama paket')
  name.id = nameId
  // The recommended plan always gets the accent badge; any other plan shows its badge (e.g. "NDA + SLA") as a quiet tag.
  const badge = recommended
    ? h('span', 'tag tag-accent lp-tier-badge', icon('sparkles', { size: 12, stroke: 2 }), plan.badge || 'Rekomendasi')
    : plan.badge ? h('span', 'tag lp-tier-pill', icon('shield', { size: 12, stroke: 2 }), plan.badge) : null
  const card = h('article', `lp-tier${recommended ? ' is-recommended' : ''}`,
    h('header', 'lp-tier-head', h('div', 'lp-tier-name-row', name, badge), h('p', 'lp-tier-tag', plan.tagline || '')),
    h('p', 'lp-tier-price', h('span', `display lp-price${isLongPrice(price) ? ' is-long' : ''}`, price), h('span', 'lp-period', period)),
    h('dl', 'lp-tier-limits', ...(plan.limits || []).map((l) => h('div', '', h('dt', '', l.label), h('dd', '', l.value)))),
    h('ul', 'lp-tier-features', ...(plan.features || []).map((f) => h('li', '', h('span', 'lp-tick', icon('check', { size: 12, stroke: 3 })), h('span', '', f)))),
    cta)
  card.setAttribute('aria-labelledby', nameId)
  return card
}

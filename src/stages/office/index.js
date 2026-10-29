import * as C from '../../ui/components.js'
import * as Influencers from './influencers.js'
import * as Requests from './requests.js'
import * as Landing from './site-landing.js'
import * as Doc from './site-doc.js'
import * as Plans from './plans.js'

const { el } = C
const STORE = 'satualur_office_section'
const GROUPS = [
  { title: 'Konten situs', items: [
    { key: 'landing', label: 'Landing page', draw: Landing.draw },
    { key: 'about', label: 'Tentang kami', draw: Doc.drawAbout },
    { key: 'legal', label: 'Legal', draw: Doc.drawLegal }] },
  { title: 'Bisnis', items: [
    { key: 'plans', label: 'Paket langganan', draw: Plans.draw },
    { key: 'gateway', label: 'Payment gateway', soon: true }] },
  { title: 'Pelanggan', items: [{ key: 'customers', label: 'Pelanggan & layanan', soon: true }] },
  { title: 'Agensi influencer', items: [
    { key: 'influencers', label: 'Influencer', draw: Influencers.draw },
    { key: 'requests', label: 'Permintaan', draw: Requests.draw }] },
]
const ITEMS = GROUPS.flatMap((g) => g.items)

function stored() {
  let k = null
  try { k = sessionStorage.getItem(STORE) } catch { /* storage unavailable */ }
  return ITEMS.some((i) => i.key === k && !i.soon) ? k : 'landing'
}

export async function render(container, ctx) {
  let current = stored()
  let dirty = false
  const host = el('div', { className: 'of-content' })

  const buttons = {}
  const nav = el('nav', { className: 'of-nav', 'aria-label': 'Bagian Kantor Satu Alur' }, ...GROUPS.map((g) =>
    el('div', { className: 'of-nav-group' }, el('h2', { className: 'of-nav-title' }, g.title),
      el('ul', {}, ...g.items.map((i) => {
        const b = el('button', { type: 'button', className: 'of-nav-item', disabled: Boolean(i.soon) }, el('span', {}, i.label), i.soon ? el('span', { className: 'of-soon' }, 'Segera') : null)
        buttons[i.key] = b
        b.addEventListener('click', () => go(i.key))
        return el('li', {}, b)
      })))))
  const selectId = 'of-section-select'
  const select = el('select', { id: selectId, className: 'input' }, ...ITEMS.map((i) => el('option', { value: i.key, disabled: Boolean(i.soon) }, i.soon ? `${i.label} (segera)` : i.label)))
  select.addEventListener('change', () => go(select.value))
  const mobile = el('div', { className: 'field of-nav-select' }, el('label', { className: 'field-label', htmlFor: selectId }, 'Bagian'), select)

  function show() {
    for (const [k, b] of Object.entries(buttons)) {
      if (k === current) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    }
    select.value = current
    dirty = false
    // Each section draws into its own box; a slow load from a section we left lands in a detached box.
    const box = el('div')
    host.replaceChildren(box)
    ITEMS.find((i) => i.key === current).draw(box, ctx, (d) => { if (box.parentNode === host) dirty = d })
  }
  function go(key) {
    if (key === current) return
    if (dirty && !confirm(Doc.LEAVE_MSG)) { select.value = current; return }
    current = key
    try { sessionStorage.setItem(STORE, key) } catch { /* storage unavailable */ }
    show()
  }

  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', onUnload)
  ctx.signal.addEventListener('abort', () => window.removeEventListener('beforeunload', onUnload))

  container.replaceChildren(
    C.pageHeader({ title: 'Kantor Satu Alur', description: 'Kelola konten situs, influencer, dan permintaan dari bisnis.' }),
    mobile, el('div', { className: 'of-layout' }, nav, host))
  show()
}

/**
 * Searchable dropdown that progressively enhances a native <select>.
 *
 * The native select stays in the DOM (visually hidden) as the source of truth:
 * stage code keeps reading `select.value`, listening for 'change', and
 * repopulating options. The combobox mirrors it via a MutationObserver and a
 * per-instance `value` setter, and writes back by setting the value and
 * dispatching 'input' + 'change'.
 */
import { icon } from './icons.js'
import '../styles/combobox.css'

let uid = 0
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function highlight(label, query) {
  const frag = document.createDocumentFragment()
  const q = fold(query).trim()
  if (!q) { frag.append(label); return frag }
  const i = fold(label).indexOf(q)
  if (i === -1) { frag.append(label); return frag }
  const mark = document.createElement('mark')
  mark.textContent = label.slice(i, i + q.length)
  frag.append(label.slice(0, i), mark, label.slice(i + q.length))
  return frag
}

export function enhanceSelect(select, { placeholder = 'Pilih…', searchPlaceholder = 'Cari…' } = {}) {
  if (!select || select.dataset.combo) return select
  select.dataset.combo = '1'
  const id = `combo-${++uid}`

  const wrap = document.createElement('div')
  wrap.className = 'combo'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'input combo-trigger'
  trigger.id = `${id}-trigger`
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', `${id}-list`)
  const labelSpan = document.createElement('span')
  labelSpan.className = 'combo-value'
  const chevron = icon('chevronDown', { size: 18 })
  chevron.classList.add('combo-chevron')
  trigger.append(labelSpan, chevron)

  // Re-point the field <label for> to the visible trigger.
  if (select.id) {
    const scope = select.closest('.field') || document
    const lbl = scope.querySelector(`label[for="${CSS.escape(select.id)}"]`)
    if (lbl) {
      lbl.htmlFor = trigger.id
      trigger.setAttribute('aria-labelledby', lbl.id || (lbl.id = `${id}-label`))
    }
  }
  const describedBy = select.getAttribute('aria-describedby')
  if (describedBy) trigger.setAttribute('aria-describedby', describedBy)

  select.parentNode.insertBefore(wrap, select)
  wrap.append(trigger, select)
  select.classList.add('combo-native')
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')

  // Popover lives on <body> so drawers with overflow don't clip it.
  const pop = document.createElement('div')
  pop.className = 'combo-pop'
  pop.hidden = true
  const searchWrap = document.createElement('div')
  searchWrap.className = 'combo-search'
  const search = document.createElement('input')
  search.type = 'text'
  search.className = 'combo-search-input'
  search.placeholder = searchPlaceholder
  search.autocomplete = 'off'
  search.spellcheck = false
  search.setAttribute('aria-label', searchPlaceholder)
  search.setAttribute('aria-controls', `${id}-list`)
  search.setAttribute('aria-autocomplete', 'list')
  searchWrap.append(icon('search', { size: 16 }), search)
  const list = document.createElement('ul')
  list.className = 'combo-list'
  list.id = `${id}-list`
  list.setAttribute('role', 'listbox')
  const empty = document.createElement('p')
  empty.className = 'combo-empty'
  empty.textContent = 'Tidak ada hasil.'
  const count = document.createElement('p')
  count.className = 'combo-count'
  pop.append(searchWrap, list, empty, count)

  let open = false
  let items = []
  let active = -1

  const options = () => Array.from(select.options)
  const selectable = () => options().filter((o) => o.value !== '')

  function syncTrigger() {
    const opt = select.selectedOptions[0]
    const isPlaceholder = !opt || opt.value === ''
    labelSpan.textContent = isPlaceholder ? (opt?.textContent || placeholder) : opt.textContent
    trigger.classList.toggle('is-placeholder', isPlaceholder)
    trigger.disabled = select.disabled
    if (!isPlaceholder) trigger.classList.remove('is-invalid')
  }

  function renderList() {
    const q = fold(search.value).trim()
    const all = selectable()
    const matches = q ? all.filter((o) => fold(o.textContent).includes(q)) : all
    list.replaceChildren()
    items = matches.map((o, i) => {
      const li = document.createElement('li')
      li.id = `${id}-opt-${i}`
      li.className = 'combo-option'
      li.setAttribute('role', 'option')
      li.dataset.value = o.value
      const selected = o.value === select.value
      li.setAttribute('aria-selected', String(selected))
      if (o.disabled) li.setAttribute('aria-disabled', 'true')
      const text = document.createElement('span')
      text.className = 'combo-option-label'
      text.append(highlight(o.textContent, search.value))
      li.append(text)
      if (selected) li.append(icon('check', { size: 16, stroke: 2.4 }))
      li.addEventListener('pointerdown', (e) => e.preventDefault())
      li.addEventListener('click', () => { if (!o.disabled) choose(o.value) })
      li.addEventListener('pointermove', () => setActive(i, false))
      list.append(li)
      return li
    })
    empty.hidden = items.length > 0
    count.textContent = q ? `${items.length} dari ${all.length} pilihan` : `${all.length} pilihan`
    const sel = items.findIndex((li) => li.dataset.value === select.value)
    setActive(sel >= 0 ? sel : items.length ? 0 : -1)
  }

  function setActive(i, scroll = true) {
    items.forEach((li, j) => li.classList.toggle('is-active', j === i))
    active = i
    if (i >= 0 && items[i]) {
      search.setAttribute('aria-activedescendant', items[i].id)
      if (scroll) items[i].scrollIntoView({ block: 'nearest' })
    } else {
      search.removeAttribute('aria-activedescendant')
    }
  }

  function position() {
    const r = trigger.getBoundingClientRect()
    const vh = window.innerHeight
    const below = vh - r.bottom
    const want = Math.min(360, pop.scrollHeight || 360)
    const up = below < want + 12 && r.top > below
    pop.style.left = `${Math.round(r.left)}px`
    pop.style.width = `${Math.round(Math.max(r.width, 240))}px`
    pop.style.top = up ? '' : `${Math.round(r.bottom + 6)}px`
    pop.style.bottom = up ? `${Math.round(vh - r.top + 6)}px` : ''
    pop.classList.toggle('is-up', up)
  }

  function openPop(seed = '') {
    if (open || select.disabled) return
    open = true
    document.body.append(pop)
    pop.hidden = false
    search.value = seed
    renderList()
    position()
    trigger.setAttribute('aria-expanded', 'true')
    wrap.classList.add('is-open')
    requestAnimationFrame(() => {
      pop.classList.add('is-in')
      search.focus({ preventScroll: true })
      const end = search.value.length
      search.setSelectionRange(end, end)
    })
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', onScroll, true)
  }

  function closePop(refocus = true) {
    if (!open) return
    open = false
    pop.classList.remove('is-in')
    pop.hidden = true
    pop.remove()
    trigger.setAttribute('aria-expanded', 'false')
    wrap.classList.remove('is-open')
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('resize', position)
    window.removeEventListener('scroll', onScroll, true)
    if (refocus) trigger.focus({ preventScroll: true })
  }

  function choose(value) {
    const changed = select.value !== value
    setNative(value)
    closePop()
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  const onOutside = (e) => {
    if (!pop.contains(e.target) && !wrap.contains(e.target)) closePop(false)
  }
  const onScroll = (e) => {
    if (pop.contains(e.target)) return
    if (!trigger.isConnected) { closePop(false); return }
    position()
  }

  trigger.addEventListener('click', () => (open ? closePop() : openPop()))
  trigger.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      openPop()
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      openPop(e.key)
    }
  })
  search.addEventListener('input', renderList)
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const li = items[active]
      if (li && li.getAttribute('aria-disabled') !== 'true') choose(li.dataset.value)
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop() }
    else if (e.key === 'Tab') closePop(false)
  })

  // Native validation: route the "required" error to the visible trigger.
  select.addEventListener('invalid', (e) => {
    e.preventDefault()
    trigger.classList.add('is-invalid')
    trigger.focus()
  })
  select.addEventListener('change', syncTrigger)

  // Keep the trigger in sync when code sets select.value directly.
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  const setNative = (v) => proto.set.call(select, v)
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return proto.get.call(select) },
    set(v) { proto.set.call(select, v); syncTrigger() },
  })

  const mo = new MutationObserver(() => {
    syncTrigger()
    if (open) renderList()
  })
  mo.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] })

  syncTrigger()
  return select
}

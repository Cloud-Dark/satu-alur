/**
 * Component factory for the Satu Alur application (design system v2 "Tumbuh").
 * Everything here builds DOM nodes; untrusted text is always set with
 * textContent (strings passed as children become text nodes).
 */
import { enhanceSelect } from './combobox.js'
import { VALIDATOR, CONTENT_GATE, solidColor, createSkeleton } from './antislop.js'
import { icon } from './icons.js'
import { countUp } from './animations.js'
import { PAGE_SIZES, GAP, pageCount, clampPage, pageWindow, pageBounds, rangeLabel, pageOfIndex, readPageSize, writePageSize } from './paging.js'

export { icon }

const BOOL_ATTRS = new Set(['required', 'disabled', 'checked', 'selected', 'readonly', 'hidden', 'multiple', 'autofocus', 'open', 'inert'])

/**
 * el(tag, attrs, ...children)
 * attrs: className, text, dataset {}, style (string), on<Event> handlers,
 * htmlFor, value, boolean attributes (true/false), aria-* etc.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue
    if (k === 'className') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (k === 'htmlFor') node.setAttribute('for', v)
    else if (k === 'value') node.value = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (BOOL_ATTRS.has(k)) {
      if (v) node.setAttribute(k, '')
      if (k in node) node[k] = Boolean(v)
    } else node.setAttribute(k, v)
  }
  append(node, children)
  return node
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c)
  }
}

/* ---------------------------------------------------------------- Format */

const rupiahFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const compactFmt = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 })
const numFmt = new Intl.NumberFormat('id-ID')

export const rupiah = (n) => rupiahFmt.format(Number(n) || 0)
export const rupiahCompact = (n) => `Rp${compactFmt.format(Number(n) || 0)}`
export const number = (n) => numFmt.format(Number(n) || 0)

export function toDate(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(v, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const d = toDate(v)
  return d ? d.toLocaleDateString('id-ID', opts) : '—'
}

export function formatDateTime(v) {
  const d = toDate(v)
  return d
    ? d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'
}

export function relativeTime(v, now = Date.now()) {
  const d = toDate(v)
  if (!d) return '—'
  const diff = now - d.getTime()
  const abs = Math.abs(diff)
  const past = diff >= 0
  const fmt = (n, unit) => (past ? `${n} ${unit} lalu` : `dalam ${n} ${unit}`)
  if (abs < 60000) return 'baru saja'
  if (abs < 3600000) return fmt(Math.round(abs / 60000), 'mnt')
  if (abs < 86400000) return fmt(Math.round(abs / 3600000), 'jam')
  const days = Math.round(abs / 86400000)
  if (days === 1) return past ? 'kemarin' : 'besok'
  if (days < 30) return fmt(days, 'hari')
  return formatDate(d)
}

/* ------------------------------------------------------------ Structure */

/**
 * Serif display title where `em` (a word or phrase inside `title`) is set in
 * italic — the v2 signature for headings.
 */
export function displayTitle(title, em) {
  const t = String(title ?? '')
  const i = em ? t.indexOf(em) : -1
  if (i < 0) return [t]
  return [t.slice(0, i), el('em', {}, em), t.slice(i + em.length)].filter((x) => x !== '')
}

/**
 * Page header. The visible page name and its hint live in the shell topbar
 * (see STAGES in shell.js), so this keeps the heading for screen readers and
 * focus, and only takes space when the page has actions.
 */
export function pageHeader({ title, em, actions, className = '' }) {
  return el('header', { className: `page-head is-slim ${actions ? 'has-actions' : ''} ${className}`.trim() },
    el('h1', { className: 'page-title sr-only', tabindex: '-1' }, displayTitle(title, em)),
    actions ? el('div', { className: 'page-head-actions' }, actions) : null,
  )
}

let tipSeq = 0
/**
 * Small "i" button with a tooltip. Shows on hover and keyboard focus; a tap
 * toggles it on touch screens. Escape closes it.
 */
export function infoTip(text, { label = 'Tentang halaman ini', className = '' } = {}) {
  const id = `tip-${++tipSeq}`
  const bubble = el('span', { className: 'info-tip-bubble', role: 'tooltip', id }, text)
  const btn = el('button', { type: 'button', className: `info-tip ${className}`.trim(), 'aria-label': label, 'aria-describedby': id, 'aria-expanded': 'false' },
    icon('info', { size: 16 }), bubble)
  const set = (open) => { btn.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)) }
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(!btn.classList.contains('is-open')) })
  btn.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false) })
  btn.addEventListener('blur', () => set(false))
  btn.addEventListener('pointerleave', () => set(false))
  return btn
}

/** Rounded surface panel with an optional header row. */
export function panel({ title, meta, raised = false, className = '', actions, id } = {}, ...children) {
  const head = title
    ? el('div', { className: 'panel-head' },
        el('div', { className: 'panel-head-text' },
          el('h2', { className: 'panel-title' }, title),
          meta ? el('span', { className: 'panel-meta' }, meta) : null,
        ),
        actions ? el('div', { className: 'panel-actions' }, actions) : null,
      )
    : null
  return el('section', { className: `panel ${raised ? 'is-raised' : ''} ${className}`.trim(), id },
    head,
    el('div', { className: 'panel-body' }, ...children),
  )
}

/** Legacy card API — now renders a panel. */
export function section(title, ...children) {
  CONTENT_GATE.scan(title, 'card-title')
  const card = panel({ title }, ...children)
  VALIDATOR.card(card, title)
  return card
}

export function skeleton({ type = 'text', lines = 3 } = {}) {
  return createSkeleton({ type, lines })
}

export function skeletonRows(rows = 4) {
  const wrap = el('div', { className: 'skel-rows', 'aria-busy': 'true', 'aria-label': 'Memuat data' })
  for (let i = 0; i < rows; i++) {
    wrap.appendChild(el('div', { className: 'skel-row' },
      el('span', { className: 'skel', style: 'width:18%' }),
      el('span', { className: 'skel', style: `width:${40 + ((i * 17) % 30)}%` }),
      el('span', { className: 'skel', style: 'width:14%' }),
    ))
  }
  return wrap
}

/* --------------------------------------------------------------- Buttons */

/**
 * button({label, icon, variant: 'primary'|'accent'|'soft'|'ghost'|'danger'|'', size: 'sm'|'lg', ...attrs})
 */
export function button({ label, icon: iconName, iconRight, variant = '', size = '', type = 'button', className = '', ...attrs } = {}) {
  if (label) CONTENT_GATE.buttonLabel(label)
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ')
  const b = el('button', { type, className: cls, ...attrs },
    iconName ? icon(iconName) : null,
    label ? el('span', { className: 'btn-label' }, label) : null,
    iconRight ? icon(iconRight, { className: 'icon-trailing' }) : null,
  )
  return b
}

export function iconButton({ iconName, label, className = '', ...attrs }) {
  return el('button', { type: 'button', className: `icon-btn ${className}`.trim(), 'aria-label': label, title: label, ...attrs }, icon(iconName))
}

/** Legacy API: btn(label, attrs). */
export function btn(label, attrs = {}) {
  CONTENT_GATE.buttonLabel(label)
  const { className = '', ...rest } = attrs
  return el('button', { type: 'button', className: `btn ${className}`.trim(), ...rest }, label)
}

/** Sets a button into a busy state and returns a restore function. */
export function setBusy(buttonEl, busyLabel) {
  const labelEl = buttonEl.querySelector('.btn-label')
  const prev = labelEl ? labelEl.textContent : buttonEl.textContent
  buttonEl.disabled = true
  buttonEl.setAttribute('aria-busy', 'true')
  if (busyLabel && labelEl) labelEl.textContent = busyLabel
  return () => {
    buttonEl.disabled = false
    buttonEl.removeAttribute('aria-busy')
    if (labelEl) labelEl.textContent = prev
  }
}

/* ----------------------------------------------------------------- Forms */

let fieldSeq = 0
const nextId = (prefix) => `${prefix}-${++fieldSeq}`

function fieldWrap({ id, label, required, hint, control, className = '' }) {
  const hintId = hint ? `${id}-hint` : null
  if (hintId) control.setAttribute('aria-describedby', hintId)
  return el('div', { className: `field ${className}`.trim() },
    el('label', { className: 'field-label', htmlFor: id },
      el('span', {}, label),
      required ? el('span', { className: 'field-req' }, 'Wajib') : null,
    ),
    control,
    hint ? el('span', { className: 'field-hint', id: hintId }, hint) : null,
  )
}

/** Generic input field. Returns { wrap, input }. */
export function field({ label, name, type = 'text', id, required = false, hint, placeholder, value, attrs = {} }) {
  const fid = id || nextId(name || 'f')
  const input = el('input', { id: fid, name: name || fid, type, required, placeholder, value, className: 'input', ...attrs })
  return { wrap: fieldWrap({ id: fid, label, required, hint, control: input }), input }
}

export function textarea({ label, name, id, required = false, hint, placeholder, value, rows = 4, attrs = {} }) {
  const fid = id || nextId(name || 'ta')
  const input = el('textarea', { id: fid, name: name || fid, required, placeholder, rows: String(rows), className: 'input', ...attrs })
  if (value) input.value = value
  return { wrap: fieldWrap({ id: fid, label, required, hint, control: input }), input }
}

/** options: [{value, label, disabled?}] */
export function select({ label, name, id, required = false, hint, options = [], value, attrs = {} }) {
  const fid = id || nextId(name || 'sel')
  const input = el('select', { id: fid, name: name || fid, required, className: 'input', ...attrs })
  setOptions(input, options, value)
  const wrap = fieldWrap({ id: fid, label, required, hint, control: input, className: 'field-select' })
  enhanceSelect(input)
  return { wrap, input }
}

export function setOptions(selectEl, options, value) {
  selectEl.replaceChildren(...options.map((o) => {
    const opt = el('option', { value: String(o.value ?? '') }, o.label)
    if (o.disabled) opt.disabled = true
    return opt
  }))
  if (value !== undefined && value !== null) selectEl.value = String(value)
}

/* Legacy field APIs (kept for compatibility). */
export function inputField({ label, type = 'text', id, placeholder, required = false, value = '', onInput }) {
  const f = field({ label, type, id, placeholder, required, value, attrs: onInput ? { onInput: (e) => onInput(e.target.value) } : {} })
  return f.wrap
}
export function selectField({ label, id, required = false, options = [], onChange }) {
  return select({ label, id, required, options, attrs: onChange ? { onChange: (e) => onChange(e.target.value) } : {} }).wrap
}
export function textareaField({ label, id, placeholder, required = false, value = '', rows = 4, onInput }) {
  return textarea({ label, id, placeholder, required, value, rows, attrs: onInput ? { onInput: (e) => onInput(e.target.value) } : {} }).wrap
}

/* -------------------------------------------------------------- Feedback */

/**
 * Inline message. type: 'ok' | 'danger' | 'info' | 'warn'.
 * Returns an element with .show(type, text, list?) and .hide().
 */
export function message() {
  const box = el('div', { className: 'note', role: 'status', 'aria-live': 'polite', hidden: true })
  box.show = (type, text, list) => {
    const iconName = type === 'ok' ? 'checkCircle' : type === 'danger' ? 'alert' : type === 'warn' ? 'alert' : 'info'
    box.className = `note note-${type}`
    box.replaceChildren(
      icon(iconName),
      el('div', { className: 'note-body' },
        el('p', {}, text),
        list && list.length ? el('ul', {}, list.map((t) => el('li', {}, t))) : null,
      ),
    )
    box.hidden = false
  }
  box.hide = () => { box.hidden = true }
  return box
}

/** Status pill: tone = ok | warn | danger | neutral | brand | live (accent) */
export function tag(text, tone = 'neutral') {
  return el('span', { className: `tag status status-${tone}` }, el('i', { className: 'status-dot', 'aria-hidden': 'true' }), String(text))
}

/** Legacy badge API mapped to tags. */
export function badge(text, variant = 'draft') {
  const map = { approved: 'ok', completed: 'ok', pending: 'warn', rejected: 'danger', draft: 'neutral' }
  return tag(text, map[variant] || 'neutral')
}

export function emptyState({ kicker = 'Kosong', title, body, action, iconName = 'sprout' }) {
  return el('div', { className: 'empty' },
    el('span', { className: 'empty-ico', 'aria-hidden': 'true' }, icon(iconName, { size: 20 })),
    el('span', { className: 'empty-label' }, kicker),
    el('p', { className: 'empty-title' }, title),
    body ? el('p', { className: 'empty-body' }, body) : null,
    action || null,
  )
}

export function errorState(text) {
  return el('div', { className: 'note note-danger' }, icon('alert'), el('div', { className: 'note-body' }, el('p', {}, text)))
}

/* ------------------------------------------------------------------ Data */

/**
 * Data table (rounded container, hairline rows).
 * columns: [{ key, label, align?: 'right', className?, render?(row) -> Node|string }]
 */
export function dataTable({ columns, rows, caption, rowAttrs }) {
  const thead = el('thead', {}, el('tr', {}, columns.map((c) =>
    el('th', { scope: 'col', className: [c.align === 'right' ? 'num' : '', c.className || ''].join(' ').trim() || undefined }, c.label))))
  const tbody = el('tbody', {}, rows.map((r) =>
    el('tr', rowAttrs ? rowAttrs(r) : {}, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key]
      return el('td', {
        className: [c.align === 'right' ? 'num' : '', c.className || ''].join(' ').trim() || undefined,
        'data-label': c.label,
      }, v == null || v === '' ? el('span', { className: 'muted nil' }, '—') : v)
    }))))
  return el('div', { className: 'table-wrap' },
    el('table', { className: 'data-table' }, caption ? el('caption', { className: 'sr-only' }, caption) : null, thead, tbody))
}

/** Two-line cell: strong primary + muted secondary. */
export function cellStack(primary, secondary) {
  return el('div', { className: 'cell-stack' },
    el('span', { className: 'cell-primary' }, primary || '—'),
    secondary ? el('span', { className: 'cell-secondary' }, secondary) : null,
  )
}

/** Definition list from [[label, value], ...] */
export function defList(pairs) {
  return el('dl', { className: 'deflist' }, pairs.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))
}

/**
 * KPI card. `hero` renders the brand-green feature card. When `countTo` is a
 * number the value counts up to it (formatted with `format`).
 */
export function kpi({ label, value, sub, delta, tone, hero = false, iconName, countTo, format, className = '' }) {
  const valueEl = el('span', { className: `kpi-value tnum ${hero ? 'display' : ''}`.trim() }, value)
  if (typeof countTo === 'number' && Number.isFinite(countTo)) countUp(valueEl, countTo, format || ((n) => number(Math.round(n))))
  const subContent = delta || sub
  return el('div', { className: `kpi ${hero ? 'is-hero' : ''} ${className}`.trim() },
    hero ? heroArt() : null,
    el('div', { className: 'kpi-top' },
      el('span', { className: 'kpi-label' }, label),
      iconName ? el('span', { className: 'kpi-ico', 'aria-hidden': 'true' }, icon(iconName, { size: 16 })) : null,
    ),
    valueEl,
    subContent ? el('span', { className: `kpi-sub ${tone ? `tone-${tone}` : ''}`.trim() }, subContent) : null,
  )
}

/** Decorative flowing line for the hero KPI card. */
function heroArt() {
  const tpl = document.createElement('template')
  tpl.innerHTML = '<svg class="kpi-art" viewBox="0 0 320 160" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="kpi-art-a" d="M-10 130 C 60 128, 90 70, 160 78 S 260 40, 330 14"/><path class="kpi-art-b" d="M-10 150 C 70 150, 120 104, 190 106 S 280 76, 330 60"/><circle class="kpi-art-seed" cx="292" cy="30" r="5"/></svg>'
  return tpl.content.firstElementChild
}

/** Legacy stat card API mapped to KPI cell. */
export function statCard({ label, value, delta }) {
  return kpi({ label, value, sub: delta })
}

export function solidText(text, colorName = 'text') {
  const span = el('span', {}, text)
  try { span.style.color = solidColor(colorName) } catch { span.style.color = 'var(--text)' }
  span.style.fontWeight = '800'
  return span
}

/* -------------------------------------------------------------- AI panel */

/**
 * Soft card for streaming AI output.
 * Returns { root, body, setStatus(text, live), write(text), writeHTML(html), done(), onStop(fn) }
 */
export function aiConsole({ model = 'AI' } = {}) {
  const status = el('span', { className: 'console-status' }, 'Siap')
  const meter = el('span', { className: 'console-meter tnum' }, '')
  const stopBtn = el('button', { type: 'button', className: 'console-stop', 'aria-label': 'Hentikan AI', title: 'Hentikan' }, icon('stop', { size: 14 }), el('span', { className: 'console-stop-label' }, 'Hentikan'))
  const body = el('div', { className: 'console-body', 'aria-live': 'polite', 'aria-busy': 'false' })
  const caret = el('span', { className: 'caret', 'aria-hidden': 'true' })
  const root = el('div', { className: 'console' },
    el('div', { className: 'console-head' },
      el('span', { className: 'console-badge', 'aria-hidden': 'true' }, icon('sparkles', { size: 16 })),
      el('span', { className: 'console-title' },
        el('b', {}, 'Asisten AI'),
        el('span', { className: 'console-model' }, model),
      ),
      status,
      meter,
      stopBtn,
    ),
    body,
  )
  let stopHandler = null
  stopBtn.addEventListener('click', () => stopHandler?.())
  const api = {
    root,
    body,
    setStatus(text, live = false) {
      status.textContent = text
      root.classList.toggle('is-live', live)
      body.setAttribute('aria-busy', live ? 'true' : 'false')
      stopBtn.hidden = !live
    },
    write(text) {
      body.classList.remove('is-prose')
      body.classList.add('is-code')
      body.textContent = text
      body.appendChild(caret)
      meter.textContent = text.length ? `${number(text.length)} karakter` : ''
      body.scrollTop = body.scrollHeight
    },
    writeHTML(html, { caretOn = true } = {}) {
      body.classList.remove('is-code')
      body.classList.add('is-prose')
      body.innerHTML = html
      if (caretOn) (body.lastElementChild || body).appendChild(caret)
      meter.textContent = `${number(body.textContent.length)} karakter`
    },
    done() { caret.remove() },
    onStop(fn) { stopHandler = fn },
  }
  api.setStatus('Siap', false)
  return api
}

/* ------------------------------------------------------------- Sanitizer */

const ALLOWED_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN', 'SMALL', 'A', 'DIV'])
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM'])

/** Sanitizes AI-generated HTML: whitelist of tags, no attributes except safe href. */
export function sanitizeHTML(html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = String(html || '').replace(/```(?:html)?/gi, '')
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const tagName = child.tagName
      if (DROP_WITH_CONTENT.has(tagName)) { child.remove(); continue }
      walk(child)
      if (!ALLOWED_TAGS.has(tagName)) {
        child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const keep = tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value.trim())
        if (!keep) child.removeAttribute(attr.name)
      }
      if (tagName === 'A') { child.setAttribute('rel', 'noopener noreferrer'); child.setAttribute('target', '_blank') }
    }
  }
  walk(tpl.content)
  const div = document.createElement('div')
  div.appendChild(tpl.content)
  return div.innerHTML
}

/* ------------------------------------------------------------ Segmented */

/** Segmented control. options: [{value,label}] -> element with .value */
export function segmented({ options, value, label, onChange }) {
  const wrap = el('div', { className: 'seg', role: 'radiogroup', 'aria-label': label })
  let current = value
  const buttons = options.map((o) => {
    const b = el('button', { type: 'button', role: 'radio', className: 'seg-btn', dataset: { value: o.value } }, o.label)
    b.addEventListener('click', () => {
      if (current === o.value) return
      current = o.value
      sync()
      onChange?.(o.value)
    })
    return b
  })
  const sync = () => buttons.forEach((b) => {
    const on = b.dataset.value === current
    b.setAttribute('aria-checked', on ? 'true' : 'false')
    b.tabIndex = on ? 0 : -1
  })
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
    const i = options.findIndex((o) => o.value === current)
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
    buttons.find((b) => b.dataset.value === next.value)?.click()
    buttons.find((b) => b.dataset.value === next.value)?.focus()
  })
  sync()
  wrap.append(...buttons)
  return wrap
}

/* ------------------------------------------------------------ Pagination */

/**
 * Display pagination for a list that is already fully loaded (filter and sort
 * first, then page). The stage keeps rendering its own rows:
 *
 *   const pg = C.pager({ key: 'requests', label: 'daftar permintaan', onChange: drawList, scrollTarget: listPanel })
 *   function drawList() {
 *     const pageRows = pg.slice(rows, { resetKey: query })   // new query -> page 1
 *     listBody.replaceChildren(table(pageRows), pg.root)
 *   }
 *
 * Options: key (remembers the page size per list in sessionStorage), label
 * (nav aria-label suffix), pageSize (default 10), sizes ([10, 25, 50]),
 * onChange() (called after page / size change: redraw), scrollTarget (element
 * or () => element brought into view on page change), unit (for the size
 * label), hideSize (no size select).
 *
 * slice(items, { resetKey, focusIndex }) -> items of the current page.
 *   resetKey: when it differs from the previous call the pager returns to
 *   page 1 (search, filter or sort changed). Data reloads with the same key
 *   keep the page (clamped). focusIndex: jump to the page holding that index.
 */
export function pager({ key, label = 'daftar', pageSize = 10, sizes = PAGE_SIZES, onChange, scrollTarget, hideSize = false, className = '' } = {}) {
  const sizeList = sizes.includes(pageSize) ? sizes : [...sizes, pageSize].sort((a, b) => a - b)
  let size = readPageSize(key, sizeList, pageSize)
  let page = 1
  let total = 0
  let lastKey
  let seenKey = false

  const info = el('p', { className: 'pager-info tnum' })
  const live = el('span', { className: 'sr-only', 'aria-live': 'polite' })
  const prev = el('button', { type: 'button', className: 'icon-btn pager-step', 'aria-label': 'Halaman sebelumnya', title: 'Halaman sebelumnya', dataset: { step: 'prev' } }, icon('chevronLeft', { size: 18 }))
  const next = el('button', { type: 'button', className: 'icon-btn pager-step', 'aria-label': 'Halaman berikutnya', title: 'Halaman berikutnya', dataset: { step: 'next' } }, icon('chevronRight', { size: 18 }))
  const list = el('ul', { className: 'pager-pages', role: 'list' })
  const where = el('span', { className: 'pager-where tnum', 'aria-hidden': 'true' })
  const ctrl = el('div', { className: 'pager-ctrl' }, prev, list, where, next)
  const sizeSel = hideSize ? null : select({
    label: 'Per halaman',
    name: key ? `pager-${key}` : undefined,
    options: sizeList.map((n) => ({ value: n, label: `${n} baris` })),
    value: size,
  })
  sizeSel?.wrap.classList.add('pager-size')
  const root = el('nav', { className: `pager ${className}`.trim(), 'aria-label': `Halaman ${label}` },
    el('div', { className: 'pager-bar' }, info, ctrl, sizeSel?.wrap), live)

  const pages = () => pageCount(total, size)

  function sync() {
    const n = pages()
    page = clampPage(page, n)
    const small = total <= Math.min(...sizeList)
    root.hidden = small
    info.textContent = rangeLabel(page, size, total, number)
    ctrl.hidden = n <= 1
    prev.disabled = page <= 1
    next.disabled = page >= n
    where.textContent = `${page} / ${n}`
    list.replaceChildren(...pageWindow(page, n).map((p) => {
      if (p === GAP) return el('li', { className: 'pager-gap', 'aria-hidden': 'true' }, '…')
      const on = p === page
      return el('li', {}, el('button', {
        type: 'button',
        className: `pager-num tnum ${on ? 'is-current' : ''}`.trim(),
        'aria-label': `Halaman ${p}`,
        'aria-current': on ? 'page' : null,
        dataset: { page: String(p) },
      }, number(p)))
    }))
  }

  function target() {
    return typeof scrollTarget === 'function' ? scrollTarget() : scrollTarget
  }

  function bringIntoView() {
    const t = target()
    if (!t?.isConnected) return
    t.setAttribute('data-pager-anchor', '')
    const r = t.getBoundingClientRect()
    const offset = (parseFloat(getComputedStyle(t).scrollMarginTop) || 80)
    if (r.top < offset - 4 || r.top > innerHeight * 0.5) t.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  function change(nextPage, focusSel) {
    const n = pages()
    const p = clampPage(nextPage, n)
    if (p === page) return
    page = p
    onChange?.()
    sync()
    live.textContent = `Halaman ${page} dari ${n}. ${info.textContent}.`
    bringIntoView()
    const f = (focusSel && !root.querySelector(focusSel)?.disabled ? root.querySelector(focusSel) : null) || root.querySelector('.pager-num[aria-current="page"]')
    f?.focus({ preventScroll: true })
  }

  prev.addEventListener('click', () => change(page - 1, '[data-step="prev"]'))
  next.addEventListener('click', () => change(page + 1, '[data-step="next"]'))
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.pager-num')
    if (b) change(Number(b.dataset.page), `.pager-num[data-page="${b.dataset.page}"]`)
  })
  ctrl.addEventListener('keydown', (e) => {
    if (e.target.closest('.pager-num, .pager-step') == null) return
    if (e.key === 'ArrowLeft' && page > 1) { e.preventDefault(); change(page - 1, '[data-step="prev"]') }
    else if (e.key === 'ArrowRight' && page < pages()) { e.preventDefault(); change(page + 1, '[data-step="next"]') }
    else if (e.key === 'Home' && page > 1) { e.preventDefault(); change(1) }
    else if (e.key === 'End' && page < pages()) { e.preventDefault(); change(pages()) }
  })
  sizeSel?.input.addEventListener('change', () => {
    const v = Number(sizeSel.input.value)
    if (!v || v === size) return
    const first = pageBounds(page, size, total).start
    size = v
    writePageSize(key, v)
    page = pageOfIndex(first, v)
    onChange?.()
    sync()
    live.textContent = `${v} baris per halaman. ${info.textContent}.`
  })

  sync()
  return {
    root,
    get page() { return page },
    get size() { return size },
    get pages() { return pages() },
    slice(items = [], { resetKey, focusIndex } = {}) {
      if (resetKey !== undefined) {
        const k = typeof resetKey === 'object' && resetKey !== null ? JSON.stringify(resetKey) : String(resetKey)
        if (seenKey && k !== lastKey) page = 1
        lastKey = k
        seenKey = true
      }
      total = items.length
      if (focusIndex != null && focusIndex >= 0) page = pageOfIndex(focusIndex, size)
      sync()
      const { start, end } = pageBounds(page, size, total)
      return items.slice(start, end)
    },
    /** Offset of the first item of the current page. */
    get start() { return pageBounds(page, size, total).start },
    goTo(p) { change(p) },
    reset() { page = 1 },
  }
}

/**
 * Convenience wrapper that also owns the body:
 *   const list = C.paginate({ key, label, render: (pageItems, { start }) => Node, ...pagerOpts })
 *   host.append(list.root); list.update(items, { resetKey })
 */
export function paginate({ items = [], render, ...opts } = {}) {
  const body = el('div', { className: 'paginate-body' })
  let current = items
  let pg = null
  const draw = (sliceOpts) => {
    const pageItems = pg.slice(current, sliceOpts)
    const node = render(pageItems, { start: pg.start, total: current.length })
    body.replaceChildren(...[node].flat().filter(Boolean))
  }
  const root = el('div', { className: 'paginate' }, body)
  pg = pager({ scrollTarget: root, ...opts, onChange: () => { draw(); opts.onChange?.() } })
  root.append(pg.root)
  draw()
  return {
    root,
    body,
    pager: pg,
    update(next, sliceOpts) { current = next || []; draw(sliceOpts) },
  }
}

/* ---------------------------------------------------------- Compact bits */

/**
 * Compact preview card: optional strong title, a row of icon chips and an
 * optional clamped note. chips: [{ icon, text, title? }]
 */
export function miniPreview({ title, chips = [], note, noteLines = 2, aside } = {}) {
  const list = chips.filter((c) => c && c.text != null && c.text !== '')
  return el('div', { className: 'mini-preview' },
    title || aside
      ? el('div', { className: 'mini-head' },
          title ? el('span', { className: 'mini-title' }, title) : null,
          aside ? el('span', { className: 'mini-aside' }, aside) : null)
      : null,
    list.length
      ? el('ul', { className: 'chips', role: 'list' }, list.map((c) =>
          el('li', { className: 'chip', title: c.title || String(c.text) },
            c.icon ? icon(c.icon, { size: 14 }) : null,
            el('span', { className: 'chip-text' }, String(c.text)))))
      : null,
    note ? clampText(note, noteLines) : null,
  )
}

/**
 * Text clamped to `lines` (2 | 3 | 4) with a "selengkapnya" toggle that only
 * appears when the text actually overflows.
 */
export function clampText(text, lines = 4) {
  const p = el('p', { className: `clamp clamp-${lines}` }, String(text ?? ''))
  const toggle = el('button', { type: 'button', className: 'clamp-toggle', hidden: true, 'aria-expanded': 'false' }, 'selengkapnya')
  const wrap = el('div', { className: 'clamp-wrap' }, p, toggle)
  let open = false
  toggle.addEventListener('click', () => {
    open = !open
    p.classList.toggle('is-open', open)
    toggle.textContent = open ? 'lebih sedikit' : 'selengkapnya'
    toggle.setAttribute('aria-expanded', String(open))
  })
  const measure = () => {
    if (open || !p.isConnected || !p.clientHeight) return
    toggle.hidden = p.scrollHeight <= p.clientHeight + 1
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(p)
  else requestAnimationFrame(measure)
  return wrap
}

/* ---------------------------------------------------------------- Wizard */

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The visible control for an input (the combobox trigger for enhanced selects). */
function visibleControl(input) {
  if (input?.classList?.contains('combo-native')) return input.closest('.combo')?.querySelector('.combo-trigger') || input
  return input
}

/**
 * Multi-step form card with a stepper header, one visible step and a sticky
 * footer action bar.
 *
 * wizard({ label, steps, className })
 *   steps: [{
 *     key, title, description?, content: Node,
 *     validate?(wiz) -> Array<string | { text, input }>   (empty = ok; may be async)
 *     primary?: { label, icon, iconRight, disabled } | (wiz) => that   (default "Lanjut")
 *     onPrimary?: async (wiz) => void      (default: advance to the next step)
 *     onEnter?(wiz, { from })              (after the step is shown)
 *   }]
 *
 * Returns an API: { root, msg, primary, back, index, key, go, next, prev,
 *   syncPrimary, setPrimaryDisabled, busy, invalid, clearErrors, complete, reset }
 */
export function wizard({ label = 'Formulir', steps, className = '' }) {
  const wid = nextId('wiz')
  const total = steps.length
  let index = 0
  let isBusy = false
  let isDone = false

  /* Stepper (desktop) */
  const navItems = steps.map((s, i) => {
    const num = el('span', { className: 'wiz-num', 'aria-hidden': 'true' })
    const b = el('button', { type: 'button', className: 'wiz-step', dataset: { index: String(i) } },
      num,
      el('span', { className: 'wiz-step-title' }, s.title),
      el('span', { className: 'sr-only wiz-step-state' }, ''),
    )
    b.addEventListener('click', () => { if (i < index && !isBusy && !isDone) go(i) })
    return { li: el('li', { className: 'wiz-step-li' }, b), b, num }
  })
  const nav = el('nav', { className: 'wiz-nav', 'aria-label': `Langkah ${label}` },
    el('ol', { className: 'wiz-steps' }, navItems.map((n) => n.li)))

  /* Compact header (mobile) */
  const compactText = el('span', { className: 'wiz-compact-text' })
  const bar = el('span', { className: 'wiz-bar-fill' })
  const compact = el('div', { className: 'wiz-compact', 'aria-hidden': 'true' },
    compactText,
    el('span', { className: 'wiz-bar' }, bar))

  /* Panes */
  const panes = steps.map((s, i) => {
    const hid = `${wid}-h${i}`
    const heading = el('h3', { className: 'wiz-pane-title', id: hid, tabindex: '-1' }, s.title)
    const pane = el('section', { className: 'wiz-pane', 'aria-labelledby': hid, hidden: i !== 0, dataset: { step: s.key } },
      el('header', { className: 'wiz-pane-head' },
        heading,
        s.description ? el('p', { className: 'wiz-pane-desc' }, s.description) : null),
      el('div', { className: 'wiz-pane-body' }, s.content),
    )
    pane.addEventListener('animationend', () => pane.classList.remove('wiz-in-next', 'wiz-in-prev'))
    return { pane, heading }
  })
  const msg = message()
  const body = el('div', { className: 'wiz-body' }, panes.map((p) => p.pane), msg)

  /* Footer */
  const back = button({ label: 'Kembali', icon: 'arrowLeft', variant: 'ghost', className: 'wiz-back' })
  const primary = el('button', { type: 'submit', className: 'btn btn-primary wiz-primary' })
  const foot = el('div', { className: 'wiz-foot' }, back, primary)

  /* Success state */
  const doneText = el('p', { className: 'wiz-done-text', tabindex: '-1' })
  const doneActions = el('div', { className: 'wiz-done-actions' })
  const doneBox = el('div', { className: 'wiz-done', hidden: true, role: 'status' },
    el('span', { className: 'wiz-done-ico', 'aria-hidden': 'true' }, icon('checkCircle', { size: 20 })),
    el('div', { className: 'wiz-done-body' }, doneText, doneActions))

  const root = el('form', { className: `panel is-raised form-panel wiz-panel ${className}`.trim(), 'aria-label': label, noValidate: true },
    el('div', { className: 'wiz-head' }, nav, compact),
    body, doneBox, foot)
  root.noValidate = true

  function syncNav() {
    navItems.forEach((n, i) => {
      const done = isDone || i < index
      const current = !isDone && i === index
      n.li.classList.toggle('is-done', done)
      n.li.classList.toggle('is-current', current)
      n.li.classList.toggle('is-future', !done && !current)
      n.num.replaceChildren(done ? icon('check', { size: 14 }) : String(i + 1))
      if (current) n.b.setAttribute('aria-current', 'step')
      else n.b.removeAttribute('aria-current')
      const clickable = done && !isDone && !isBusy
      n.b.disabled = !clickable && !current
      n.b.tabIndex = current && !clickable ? -1 : 0
      n.b.querySelector('.wiz-step-state').textContent = done ? ' (selesai)' : current ? ' (sekarang)' : ''
      n.b.title = clickable ? `Kembali ke langkah ${i + 1}` : ''
    })
    compactText.replaceChildren(...(isDone
      ? [el('b', {}, 'Selesai')]
      : [el('span', {}, `Langkah ${index + 1} dari ${total}`), el('span', { className: 'wiz-compact-sep' }, ' · '), el('b', {}, steps[index].title)]))
    bar.style.width = `${isDone ? 100 : ((index + 1) / total) * 100}%`
    back.hidden = index === 0 || isDone
    back.disabled = isBusy
  }

  function primaryCfg() {
    const s = steps[index]
    const cfg = typeof s.primary === 'function' ? s.primary(api) : s.primary
    return { label: 'Lanjut', iconRight: index < total - 1 ? 'arrowRight' : undefined, ...(cfg || {}) }
  }

  function syncPrimary() {
    if (isBusy) return
    const cfg = primaryCfg()
    primary.replaceChildren(...[
      cfg.icon ? icon(cfg.icon) : null,
      el('span', { className: 'btn-label' }, cfg.label),
      cfg.iconRight ? icon(cfg.iconRight, { className: 'icon-trailing' }) : null,
    ].filter(Boolean))
    primary.disabled = Boolean(cfg.disabled)
  }

  function scrollIntoViewIfNeeded() {
    const r = root.getBoundingClientRect()
    const topbar = parseFloat(getComputedStyle(root).scrollMarginTop) || 80
    const fits = r.height <= innerHeight - topbar
    if (r.top < topbar - 4 || r.top > innerHeight * 0.6 || (fits && r.bottom > innerHeight)) root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  function go(target, { focus = true, animate = true, force = false } = {}) {
    const i = typeof target === 'string' ? steps.findIndex((s) => s.key === target) : target
    if (i < 0 || i >= total || (i === index && !force)) return
    const from = index
    clearErrors()
    msg.hide()
    panes[from].pane.hidden = true
    index = i
    const p = panes[i].pane
    p.classList.remove('wiz-in-next', 'wiz-in-prev')
    p.hidden = false
    if (animate && !reducedMotion() && from !== i) {
      void p.offsetWidth
      p.classList.add(i > from ? 'wiz-in-next' : 'wiz-in-prev')
    }
    body.scrollTop = 0
    syncNav()
    syncPrimary()
    steps[i].onEnter?.(api, { from })
    if (focus) {
      panes[i].heading.focus({ preventScroll: true })
      scrollIntoViewIfNeeded()
    }
  }

  function clearErrors() {
    root.querySelectorAll('.field-error').forEach((n) => n.remove())
    root.querySelectorAll('[aria-invalid="true"]').forEach((n) => {
      n.removeAttribute('aria-invalid')
      n.classList.remove('is-invalid')
      const ids = (n.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && !x.endsWith('-err'))
      if (ids.length) n.setAttribute('aria-describedby', ids.join(' '))
      else n.removeAttribute('aria-describedby')
    })
  }

  /** Shows validation errors: inline under fields when `input` is given. */
  function invalid(errors) {
    clearErrors()
    const loose = []
    let first = null
    for (const e of errors) {
      const text = typeof e === 'string' ? e : e.text
      const input = typeof e === 'string' ? null : e.input
      const ctl = visibleControl(input)
      const fieldEl = input?.closest('.field')
      if (!ctl || !fieldEl) { loose.push(text); continue }
      const eid = `${ctl.id || nextId('ctl')}-err`
      if (!ctl.id) ctl.id = eid.replace(/-err$/, '')
      ctl.setAttribute('aria-invalid', 'true')
      ctl.classList.add('is-invalid')
      ctl.setAttribute('aria-describedby', [ctl.getAttribute('aria-describedby'), eid].filter(Boolean).join(' '))
      fieldEl.appendChild(el('span', { className: 'field-error', id: eid }, icon('alert', { size: 14 }), text))
      const clear = () => {
        ctl.removeAttribute('aria-invalid')
        ctl.classList.remove('is-invalid')
        document.getElementById(eid)?.remove()
      }
      input.addEventListener('input', clear, { once: true })
      input.addEventListener('change', clear, { once: true })
      first = first || ctl
    }
    if (loose.length) msg.show('danger', loose.length === 1 ? loose[0] : 'Periksa kembali isian berikut.', loose.length > 1 ? loose : undefined)
    if (first) first.focus()
    else if (loose.length) msg.scrollIntoView({ block: 'nearest' })
  }

  async function runPrimary() {
    if (isBusy || isDone || primary.disabled) return
    const s = steps[index]
    msg.hide()
    clearErrors()
    const errs = (await s.validate?.(api)) || []
    if (errs.length) { invalid(errs); return }
    if (s.onPrimary) await s.onPrimary(api)
    else go(index + 1)
  }
  root.addEventListener('submit', (e) => { e.preventDefault(); runPrimary() })
  back.addEventListener('click', () => { if (!isBusy) go(index - 1) })

  /** Marks the wizard busy; returns a restore function. */
  function busy(busyLabel) {
    const restore = setBusy(primary, busyLabel)
    isBusy = true
    syncNav()
    return () => {
      isBusy = false
      restore()
      syncNav()
      syncPrimary()
    }
  }

  /** Swaps the steps for a one-line success state with follow-up actions. */
  function complete({ text, actions = [] }) {
    isDone = true
    msg.hide()
    body.hidden = true
    foot.hidden = true
    doneText.textContent = text
    doneActions.replaceChildren(...actions)
    doneBox.hidden = false
    syncNav()
    if (!reducedMotion()) { doneBox.classList.remove('wiz-in-next'); void doneBox.offsetWidth; doneBox.classList.add('wiz-in-next') }
    doneText.focus({ preventScroll: true })
    scrollIntoViewIfNeeded()
  }

  /** Back to a step (default the first) after a success state or a cancel. */
  function reset({ to = 0, focus = true } = {}) {
    isDone = false
    doneBox.hidden = true
    body.hidden = false
    foot.hidden = false
    go(to, { focus, force: true, animate: true })
  }

  const api = {
    root, msg, primary, back,
    get index() { return index },
    get key() { return steps[index].key },
    get done() { return isDone },
    go,
    next: () => go(index + 1),
    prev: () => go(index - 1),
    syncPrimary,
    setPrimaryDisabled(v) { if (!isBusy) primary.disabled = Boolean(v) },
    busy,
    invalid,
    clearErrors,
    complete,
    reset,
  }
  syncNav()
  syncPrimary()
  queueMicrotask(() => steps[0].onEnter?.(api, { from: -1 }))
  return api
}

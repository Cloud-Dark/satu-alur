/**
 * Component factory for the Satu Alur application (design system v2 "Tumbuh").
 * Everything here builds DOM nodes; untrusted text is always set with
 * textContent (strings passed as children become text nodes).
 */
import { enhanceSelect } from './combobox.js'
import { VALIDATOR, CONTENT_GATE, solidColor, createSkeleton } from './antislop.js'
import { icon } from './icons.js'
import { countUp } from './animations.js'

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

/** Step indicator pill: six dots with the current stage filled. */
export function stepPill(num, label, total = 6) {
  const n = Number(num) || 0
  return el('span', { className: 'step-pill', 'aria-label': `Tahap ${n} dari ${total}: ${label}` },
    el('span', { className: 'step-dots', 'aria-hidden': 'true' },
      Array.from({ length: total }, (_, i) => el('i', { className: i + 1 < n ? 'is-past' : i + 1 === n ? 'is-now' : '' }))),
    el('span', { className: 'step-text', 'aria-hidden': 'true' }, `Tahap ${String(n).padStart(2, '0')}`, el('b', {}, label)),
  )
}

/** Page header: step pill + serif title (+ italic keyword) + description. */
export function pageHeader({ num, label, title, em, description, actions }) {
  return el('header', { className: 'page-head' },
    el('div', { className: 'page-head-text' },
      num ? stepPill(num, label) : null,
      el('h1', { className: 'page-title display', tabindex: '-1' }, displayTitle(title, em)),
      description ? el('p', { className: 'page-desc' }, description) : null,
    ),
    actions ? el('div', { className: 'page-head-actions' }, actions) : null,
  )
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

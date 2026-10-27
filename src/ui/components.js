import { TOKENS, VALIDATOR, CONTENT_GATE, solidColor, createSkeleton } from './antislop.js'

/**
 * AntiSlop-compliant component factory.
 * Semua elemen divalidasi terhadap design tokens dan content quality gates.
 */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') node.className = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else node.setAttribute(k, v)
  })
  children.forEach((c) => {
    if (c == null) return
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  })
  return node
}

/**
 * Card component dengan AntiSlop validation
 */
export function section(title, ...children) {
  CONTENT_GATE.scan(title, 'card-title')
  const card = el('section', { className: 'card' },
    el('h2', {}, title),
    ...children
  )
  VALIDATOR.card(card, title)
  return card
}

/**
 * Skeleton loader yang konsisten
 */
export function skeleton({ type = 'text', lines = 3 }) {
  return createSkeleton({ type, lines })
}

/**
 * Button dengan AntiSlop validation
 */
export function btn(label, attrs = {}) {
  CONTENT_GATE.buttonLabel(label)
  const button = el('button', { type: 'button', ...attrs }, label)
  requestAnimationFrame(() => VALIDATOR.button(button, label))
  return button
}

/**
 * Input field dengan label yang terhubung (A11y compliant)
 */
export function inputField({ label, type = 'text', id, placeholder, required = false, value = '', onInput }) {
  if (!id) throw new Error('[AntiSlop] Input WAJIB memiliki id untuk label association')
  const input = el('input', {
    id,
    type,
    placeholder: placeholder || '',
    required,
    value,
    onInput: onInput ? (e) => onInput(e.target.value) : undefined,
  })
  const labelEl = el('label', { htmlFor: id }, label, required ? el('span', { className: 'required' }, ' *') : '')
  requestAnimationFrame(() => {
    VALIDATOR.input(input, label)
    VALIDATOR.noPlaceholderLabel(input)
  })
  return el('div', { className: 'form-group' }, labelEl, input)
}

/**
 * Select field dengan label
 */
export function selectField({ label, id, required = false, options = [], onChange }) {
  if (!id) throw new Error('[AntiSlop] Select WAJIB memiliki id untuk label association')
  const select = el('select', {
    id,
    name: id,
    required,
    onChange: onChange ? (e) => onChange(e.target.value) : undefined,
  })
  options.forEach(opt => {
    select.appendChild(el('option', { value: opt.value }, opt.label))
  })
  const labelEl = el('label', { htmlFor: id }, label, required ? el('span', { className: 'required' }, ' *') : '')
  requestAnimationFrame(() => VALIDATOR.input(select, label))
  return el('div', { className: 'form-group' }, labelEl, select)
}

/**
 * Textarea field dengan label
 */
export function textareaField({ label, id, placeholder, required = false, value = '', rows = 4, onInput }) {
  if (!id) throw new Error('[AntiSlop] Textarea WAJIB memiliki id untuk label association')
  const textarea = el('textarea', {
    id,
    name: id,
    placeholder: placeholder || '',
    required,
    rows: String(rows),
    onInput: onInput ? (e) => onInput(e.target.value) : undefined,
  })
  if (value) textarea.value = value
  const labelEl = el('label', { htmlFor: id }, label, required ? el('span', { className: 'required' }, ' *') : '')
  requestAnimationFrame(() => VALIDATOR.input(textarea, label))
  return el('div', { className: 'form-group' }, labelEl, textarea)
}

/**
* Solid colored text (no gradients)
*/
export function solidText(text, colorName = 'primary') {
  const span = el('span', {}, text)
  span.style.color = solidColor(colorName)
  span.style.fontWeight = TOKENS.font.weights.extrabold
  return span
}

/**
* Badge dengan warna semantic yang valid
*/
export function badge(text, variant = 'draft') {
  const variants = {
    pending: { bg: 'rgba(243,156,18,0.12)', color: '#d68910' },
    approved: { bg: 'rgba(39,174,96,0.12)', color: '#1e8449' },
    rejected: { bg: 'rgba(192,57,43,0.12)', color: '#a93226' },
    completed: { bg: 'rgba(41,128,185,0.12)', color: '#2471a3' },
    draft: { bg: 'rgba(141,110,99,0.12)', color: '#6d4c41' },
  }
  const v = variants[variant] || variants.draft
  return el('span', {
    className: 'badge',
    style: `background:${v.bg};color:${v.color};`,
  }, text.toUpperCase())
}

/**
* Stat card dengan token-compliant styling
*/
export function statCard({ label, value, variant = 'orange', delta, deltaType = 'neutral' }) {
  const card = el('div', { className: `stat-card ${variant}` })
  const labelEl = el('div', { className: 'stat-label' }, label)
  const valueEl = el('div', { className: 'stat-value' }, value)
  card.appendChild(labelEl)
  card.appendChild(valueEl)
  if (delta) {
    const deltaEl = el('div', { className: `stat-delta ${deltaType}` }, delta)
    card.appendChild(deltaEl)
  }
  return card
}

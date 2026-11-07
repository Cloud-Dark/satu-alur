import '../../styles/landing.css'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { saveSite } from '../../site/api.js'
import { validateSiteContent, parseDoc } from '../../site/content-rules.js'
import { DOC_TITLES, blockNode } from '../../site/doc-page.js'
import { stampLine, loadOrRetry } from './site-landing.js'
import { t } from '../../i18n/index.js'

const { el } = C
const ROUTE = { about: '#/tentang', privacy: '#/privasi', terms: '#/syarat', cookies: '#/cookie' }
// Language is fixed per page load, so these can be resolved once.
const LEGAL = ['privacy', 'terms', 'cookies'].map((value) => ({ value, label: t(`office.doc.legal.${value}`) }))
export const LEAVE_MSG = t('office.common.leave')
let seq = 0

async function drawDoc(host, ctx, setDirty, key) {
  const mine = host.dataset.doc = key
  let row = await loadOrRetry(host, ctx, key, () => drawDoc(host, ctx, setDirty, key))
  if (!row || host.dataset.doc !== mine) return
  const state = { title: row?.value?.title ?? DOC_TITLES[key], body: row?.value?.body ?? '' }
  const snap = () => JSON.stringify(state)
  let saved = snap()
  const touch = () => setDirty(snap() !== saved)
  setDirty(false)
  const id = ++seq

  const title = C.field({ label: t('office.doc.title'), id: `of-doc-title-${id}`, value: state.title, attrs: { maxlength: '120' } })
  const body = C.textarea({ label: t('office.doc.body'), id: `of-doc-body-${id}`, value: state.body, rows: 16, attrs: { maxlength: '50000' },
    hint: t('office.doc.bodyHint') })
  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(row))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const pTitle = el('h1', { className: 'display doc-title' })
  const pBody = el('div', { className: 'doc-body' })
  const redraw = () => { pTitle.textContent = state.title; pBody.replaceChildren(...parseDoc(state.body).map(blockNode)) }
  title.input.addEventListener('input', () => { state.title = title.input.value; redraw(); touch() })
  body.input.addEventListener('input', () => { state.body = body.input.value; redraw(); touch() })

  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary' })
  save.addEventListener('click', async () => {
    err.textContent = ''
    let clean
    try { clean = validateSiteContent(key, state) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      row = await saveSite(key, clean)
      saved = snap()
      if (host.dataset.doc === mine) touch()
      stamp.textContent = stampLine(row)
      showToast(t('office.doc.saved'), 'success')
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  const view = el('a', { className: 'btn btn-ghost', href: ROUTE[key], target: '_blank', rel: 'noopener' }, t('office.doc.view'))

  host.replaceChildren(
    C.panel({ title: DOC_TITLES[key] }, title.wrap, body.wrap),
    C.panel({ title: t('office.common.preview') }, el('div', { className: 'lp doc-page of-preview' }, el('article', { className: 'doc-col' }, pTitle, pBody))),
    err, el('div', { className: 'of-actions' }, save, view), stamp)
  redraw()
}

export function drawAbout(host, ctx, setDirty) { return drawDoc(host, ctx, setDirty, 'about') }

export function drawLegal(host, ctx, setDirty) {
  let dirty = false
  const set = (d) => { dirty = d; setDirty(d) }
  const sub = el('div')
  const id = `of-legal-${++seq}`
  const select = el('select', { id, className: 'input' }, ...LEGAL.map((o) => el('option', { value: o.value }, o.label)))
  let current = LEGAL[0].value
  select.addEventListener('change', () => {
    if (dirty && !confirm(LEAVE_MSG)) { select.value = current; return }
    current = select.value
    set(false)
    drawDoc(sub, ctx, set, current)
  })
  host.replaceChildren(el('div', { className: 'field of-legal-pick' }, el('label', { className: 'field-label', htmlFor: id }, t('office.doc.document')), select), sub)
  drawDoc(sub, ctx, set, current)
}

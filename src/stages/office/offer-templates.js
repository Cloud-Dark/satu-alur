/**
 * Kantor › Bisnis › Template penawaran: the platform's ready-made offer types.
 * Admins create, edit, (de)activate and delete; businesses only pick them in the
 * offer wizard. Each template has a field builder (questions asked before the AI).
 */
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListTemplates, adminCreateTemplate, adminUpdateTemplate, adminDeleteTemplate } from '../../offer/api.js'
import { TEMPLATE_CATEGORIES, FIELD_TYPES, validateTemplate } from '../../offer/templates.js'
import { OFFICE_PAGE_SIZE } from '../../office/paging.js'
import { LEAVE_MSG } from './site-doc.js'
import '../../styles/offer-flow.css'
import { t } from '../../i18n/index.js'

const { el } = C
let seq = 0
// Categories and field types come from offer/templates.js (shared with the Worker): translate by value.
const catLabel = (v) => (TEMPLATE_CATEGORIES.some((c) => c.value === v) ? t(`office.templates.category.${v}`) : v)
const catOptions = () => TEMPLATE_CATEGORIES.map((c) => ({ value: c.value, label: catLabel(c.value) }))
const typeLabel = (v) => (FIELD_TYPES.some((x) => x.value === v) ? t(`office.templates.fieldType.${v}`) : v)
const typeOptions = () => FIELD_TYPES.map((x) => ({ value: x.value, label: typeLabel(x.value) }))
const priceRange = (tp) => (tp.price_hint_min || tp.price_hint_max
  ? `${tp.price_hint_min ? C.rupiah(tp.price_hint_min) : '…'} – ${tp.price_hint_max ? C.rupiah(tp.price_hint_max) : '…'}`
  : t('office.templates.noPriceRange'))

function fieldRow(f = {}, onChange) {
  const id = ++seq
  const label = C.field({ label: t('office.templates.question'), id: `ot-f-l-${id}`, value: f.label || '', attrs: { maxlength: '80', 'data-k': 'label' } })
  const type = C.select({ label: t('office.templates.fieldTypeLabel'), id: `ot-f-t-${id}`, value: f.type || 'text', options: typeOptions(), attrs: { 'data-k': 'type' } })
  const opts = C.textarea({ label: t('office.templates.options'), id: `ot-f-o-${id}`, rows: 3, value: (f.options || []).join('\n'), attrs: { 'data-k': 'options' } })
  const req = el('label', { className: 'check-inline' }, el('input', { type: 'checkbox', 'data-k': 'required', checked: Boolean(f.required) }), el('span', {}, t('office.templates.required')))
  const rm = C.button({ label: t('office.common.delete'), icon: 'trash', variant: 'ghost', size: 'sm' })
  const row = el('div', { className: 'ot-field' }, el('div', { className: 'form-row keep-row' }, label.wrap, type.wrap), opts.wrap, el('div', { className: 'ot-field-foot' }, req, rm))
  row.dataset.key = f.key || ''
  const syncOpts = () => { opts.wrap.hidden = type.input.value !== 'select' }
  type.input.addEventListener('change', () => { syncOpts(); onChange() })
  rm.addEventListener('click', () => { row.remove(); onChange() })
  syncOpts()
  row.read = () => ({
    key: row.dataset.key || undefined,
    label: label.input.value,
    type: type.input.value,
    required: req.querySelector('input').checked,
    options: opts.input.value,
  })
  return row
}

function previewNode(tp) {
  if (!tp.fields.length) return el('p', { className: 'muted small' }, t('office.templates.noQuestions'))
  return el('ul', { className: 'ot-preview' }, ...t.fields.map((f) => el('li', {},
    el('strong', {}, f.label), f.required ? ' *' : '', el('span', { className: 'muted small' }, ` · ${typeLabel(f.type)}${f.type === 'select' ? `: ${f.options.join(', ')}` : ''}`))))
}

function templateDialog(ctx, tpl, opener, onSaved, setDirty) {
  const id = ++seq
  const v = tpl || { category: 'jasa', fields: [], active: 1 }
  const name = C.field({ label: t('office.templates.name'), id: `ot-name-${id}`, value: v.name || '', required: true, attrs: { maxlength: '80' } })
  const cat = C.select({ label: t('office.templates.categoryLabel'), id: `ot-cat-${id}`, value: v.category, options: catOptions() })
  const desc = C.textarea({ label: t('office.templates.desc'), id: `ot-desc-${id}`, rows: 2, value: v.description || '', attrs: { maxlength: '400' } })
  const hint = C.textarea({ label: t('office.templates.hint'), id: `ot-hint-${id}`, rows: 3, value: v.prompt_hint || '', hint: t('office.templates.hintHint'), attrs: { maxlength: '1000' } })
  const terms = C.textarea({ label: t('office.templates.terms'), id: `ot-terms-${id}`, rows: 2, value: v.default_terms || '', attrs: { maxlength: '600' } })
  const min = C.field({ label: t('office.templates.min'), id: `ot-min-${id}`, type: 'number', value: v.price_hint_min ?? '', attrs: { min: '0', step: '1000' } })
  const max = C.field({ label: t('office.templates.max'), id: `ot-max-${id}`, type: 'number', value: v.price_hint_max ?? '', attrs: { min: '0', step: '1000' } })
  const sort = C.field({ label: t('office.templates.sort'), id: `ot-sort-${id}`, type: 'number', value: v.sort ?? 0, attrs: { step: '1' } })
  const vis = C.choiceGroup({ legend: t('office.common.status'), name: `ot-active-${id}`, options: [{ value: 'on', label: t('office.templates.activeLabel'), checked: v.active !== 0 }] })
  const fieldsBox = el('div', { className: 'ot-fields' })
  const preview = el('div', { className: 'ot-preview-box' })
  const err = el('p', { className: 'field-error', role: 'alert' })

  const gather = () => ({
    name: name.input.value, category: cat.input.value, description: desc.input.value, prompt_hint: hint.input.value, default_terms: terms.input.value,
    price_hint_min: min.input.value, price_hint_max: max.input.value, sort: sort.input.value, active: vis.inputs.on.checked,
    fields: [...fieldsBox.children].map((r) => r.read()),
  })
  const drawPreview = () => {
    try { preview.replaceChildren(el('span', { className: 'proposal-label' }, t('office.templates.preview')), previewNode(validateTemplate(gather()))) } catch (ex) { preview.replaceChildren(el('p', { className: 'muted small' }, ex.message)) }
  }
  let base = null
  const touch = () => { drawPreview(); if (base !== null) setDirty(JSON.stringify(gather()) !== base) }
  ;(v.fields || []).forEach((f) => fieldsBox.append(fieldRow(f, touch)))
  const addField = C.button({ label: t('office.templates.addQuestion'), icon: 'plus', variant: 'soft', size: 'sm' })
  addField.addEventListener('click', () => {
    if (fieldsBox.children.length >= 12) { err.textContent = t('office.templates.maxQuestions'); return }
    const r = fieldRow({}, touch)
    fieldsBox.append(r); touch()
    r.querySelector('input').focus()
  })
  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('office.common.cancel'), variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: tpl ? t('office.common.editName', { name: tpl.name }) : t('office.templates.add'),
    description: t('office.templates.dialogDesc'),
    wide: true,
    children: [name.wrap, el('div', { className: 'form-row' }, cat.wrap, sort.wrap), desc.wrap,
      el('h3', { className: 'field-label' }, t('office.templates.clientQuestions')), fieldsBox, addField, preview,
      el('h3', { className: 'field-label' }, t('office.templates.aiGuide')), hint.wrap, terms.wrap, el('div', { className: 'form-row' }, min.wrap, max.wrap), vis.wrap, err],
    actions: [cancel, save], opener,
  })
  base = JSON.stringify(gather())
  drawPreview()
  form.addEventListener('input', touch)
  form.addEventListener('change', touch)
  const dirty = () => base !== null && JSON.stringify(gather()) !== base
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let body
    try { body = validateTemplate(gather()) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      if (tpl) await adminUpdateTemplate(tpl.id, body)
      else await adminCreateTemplate(body)
      base = null
      close()
      showToast(t('office.templates.saved'), 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  const list = el('div', { className: 'ot-list' })
  let run = 0
  let q = ''
  const pg = C.pager({ label: t('office.templates.pagerLabel'), pageSize: OFFICE_PAGE_SIZE, sizes: [OFFICE_PAGE_SIZE], hideSize: true, onChange: () => load(pg.page), scrollTarget: () => list })
  const add = C.button({ label: t('office.templates.add'), icon: 'plus', variant: 'primary', size: 'sm' })
  const search = el('input', { type: 'search', className: 'input input-sm', placeholder: t('office.templates.search'), 'aria-label': t('office.templates.search') })
  let timer = null
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value; load(1) }, 250) })
  let meta = null

  async function load(page = 1) {
    const mine = ++run
    list.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await adminListTemplates({ page, per: OFFICE_PAGE_SIZE, q }) } catch (e) {
      if (!ctx.signal.aborted && mine === run) list.replaceChildren(C.errorState(e.message))
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    if (page === 1) pg.reset()
    pg.slice(new Array(data.total))
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    if (meta) meta.textContent = t('office.templates.count', { count: data.total })
    const reload = () => load(pg.page)
    list.replaceChildren(...(data.items.length ? data.items.map((tp) => {
      const edit = C.button({ label: t('office.common.edit'), variant: 'soft', size: 'sm' })
      edit.setAttribute('aria-label', t('office.common.editName', { name: tp.name }))
      edit.addEventListener('click', () => templateDialog(ctx, tp, edit, reload, setDirty))
      const toggle = C.button({ label: tp.active ? t('office.common.deactivate') : t('office.common.activate'), variant: 'ghost', size: 'sm' })
      toggle.setAttribute('aria-label', `${tp.active ? t('office.common.deactivate') : t('office.common.activate')} ${tp.name}`)
      toggle.addEventListener('click', async () => {
        const restore = C.setBusy(toggle, t('office.common.saving'))
        try { await adminUpdateTemplate(tp.id, { active: !tp.active }); showToast(tp.active ? t('office.templates.deactivated') : t('office.templates.activated'), 'success'); reload() } catch (ex) { restore(); showToast(ex.message, 'error') }
      })
      const del = C.button({ label: t('office.common.delete'), icon: 'trash', variant: 'ghost', size: 'sm' })
      del.setAttribute('aria-label', t('office.common.deleteName', { name: tp.name }))
      del.addEventListener('click', async () => {
        if (!confirm(t('office.templates.confirmDelete', { name: tp.name }))) return
        const restore = C.setBusy(del, t('office.common.deleting'))
        try { await adminDeleteTemplate(tp.id); showToast(t('office.templates.deleted'), 'success'); reload() } catch (ex) { restore(); showToast(ex.message, 'error') }
      })
      return el('article', { className: 'workspace-entry ot-entry', dataset: { id: String(tp.id) } },
        el('div', { className: 'workspace-entry-head' }, el('strong', {}, tp.name), C.tag(catLabel(tp.category), 'neutral'), tp.active ? C.tag(t('office.common.active'), 'ok') : C.tag(t('office.common.inactive'), 'neutral')),
        tp.description ? el('p', { className: 'muted small' }, tp.description) : null,
        el('p', { className: 'small' }, `${t('office.templates.questions', { count: tp.fields.length })} · ${priceRange(tp)}`),
        el('div', { className: 'of-row-actions' }, edit, toggle, del))
    }) : [C.emptyState({ title: q ? t('office.templates.noMatch') : t('office.templates.empty'), iconName: 'fileText' })]))
  }
  add.addEventListener('click', () => templateDialog(ctx, null, add, () => load(1), setDirty))
  host.replaceChildren(C.panel({ title: t('office.menu.offerTemplates'), meta: t('office.common.loadingLower'), actions: el('div', { className: 'ot-actions' }, el('label', { className: 'search-box' }, C.icon('search', { size: 16 }), search), add) },
    el('p', { className: 'muted small' }, t('office.templates.lead')), list, pg.root))
  meta = host.querySelector('.panel-meta')
  load(1)
}

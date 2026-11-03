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

const { el } = C
let seq = 0
const catLabel = (v) => TEMPLATE_CATEGORIES.find((c) => c.value === v)?.label || v
const priceRange = (t) => (t.price_hint_min || t.price_hint_max
  ? `${t.price_hint_min ? C.rupiah(t.price_hint_min) : '…'} – ${t.price_hint_max ? C.rupiah(t.price_hint_max) : '…'}`
  : 'Tanpa kisaran harga')

function fieldRow(f = {}, onChange) {
  const id = ++seq
  const label = C.field({ label: 'Pertanyaan', id: `ot-f-l-${id}`, value: f.label || '', attrs: { maxlength: '80', 'data-k': 'label' } })
  const type = C.select({ label: 'Jenis isian', id: `ot-f-t-${id}`, value: f.type || 'text', options: FIELD_TYPES, attrs: { 'data-k': 'type' } })
  const opts = C.textarea({ label: 'Opsi (satu per baris)', id: `ot-f-o-${id}`, rows: 3, value: (f.options || []).join('\n'), attrs: { 'data-k': 'options' } })
  const req = el('label', { className: 'check-inline' }, el('input', { type: 'checkbox', 'data-k': 'required', checked: Boolean(f.required) }), el('span', {}, 'Wajib diisi'))
  const rm = C.button({ label: 'Hapus', icon: 'trash', variant: 'ghost', size: 'sm' })
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

function previewNode(t) {
  if (!t.fields.length) return el('p', { className: 'muted small' }, 'Template tanpa pertanyaan tambahan.')
  return el('ul', { className: 'ot-preview' }, ...t.fields.map((f) => el('li', {},
    el('strong', {}, f.label), f.required ? ' *' : '', el('span', { className: 'muted small' }, ` · ${FIELD_TYPES.find((x) => x.value === f.type)?.label}${f.type === 'select' ? `: ${f.options.join(', ')}` : ''}`))))
}

function templateDialog(ctx, tpl, opener, onSaved, setDirty) {
  const id = ++seq
  const v = tpl || { category: 'jasa', fields: [], active: 1 }
  const name = C.field({ label: 'Nama template', id: `ot-name-${id}`, value: v.name || '', required: true, attrs: { maxlength: '80' } })
  const cat = C.select({ label: 'Kategori', id: `ot-cat-${id}`, value: v.category, options: TEMPLATE_CATEGORIES })
  const desc = C.textarea({ label: 'Deskripsi singkat', id: `ot-desc-${id}`, rows: 2, value: v.description || '', attrs: { maxlength: '400' } })
  const hint = C.textarea({ label: 'Arahan untuk AI', id: `ot-hint-${id}`, rows: 3, value: v.prompt_hint || '', hint: 'Apa saja yang harus dirinci AI di penawaran.', attrs: { maxlength: '1000' } })
  const terms = C.textarea({ label: 'Ketentuan bawaan', id: `ot-terms-${id}`, rows: 2, value: v.default_terms || '', attrs: { maxlength: '600' } })
  const min = C.field({ label: 'Harga minimum (Rp)', id: `ot-min-${id}`, type: 'number', value: v.price_hint_min ?? '', attrs: { min: '0', step: '1000' } })
  const max = C.field({ label: 'Harga maksimum (Rp)', id: `ot-max-${id}`, type: 'number', value: v.price_hint_max ?? '', attrs: { min: '0', step: '1000' } })
  const sort = C.field({ label: 'Urutan', id: `ot-sort-${id}`, type: 'number', value: v.sort ?? 0, attrs: { step: '1' } })
  const vis = C.choiceGroup({ legend: 'Status', name: `ot-active-${id}`, options: [{ value: 'on', label: 'Aktif (bisa dipilih bisnis)', checked: v.active !== 0 }] })
  const fieldsBox = el('div', { className: 'ot-fields' })
  const preview = el('div', { className: 'ot-preview-box' })
  const err = el('p', { className: 'field-error', role: 'alert' })

  const gather = () => ({
    name: name.input.value, category: cat.input.value, description: desc.input.value, prompt_hint: hint.input.value, default_terms: terms.input.value,
    price_hint_min: min.input.value, price_hint_max: max.input.value, sort: sort.input.value, active: vis.inputs.on.checked,
    fields: [...fieldsBox.children].map((r) => r.read()),
  })
  const drawPreview = () => {
    try { preview.replaceChildren(el('span', { className: 'proposal-label' }, 'Pratinjau pertanyaan'), previewNode(validateTemplate(gather()))) } catch (ex) { preview.replaceChildren(el('p', { className: 'muted small' }, ex.message)) }
  }
  let base = null
  const touch = () => { drawPreview(); if (base !== null) setDirty(JSON.stringify(gather()) !== base) }
  ;(v.fields || []).forEach((f) => fieldsBox.append(fieldRow(f, touch)))
  const addField = C.button({ label: 'Tambah pertanyaan', icon: 'plus', variant: 'soft', size: 'sm' })
  addField.addEventListener('click', () => {
    if (fieldsBox.children.length >= 12) { err.textContent = 'Maksimal 12 pertanyaan.'; return }
    const r = fieldRow({}, touch)
    fieldsBox.append(r); touch()
    r.querySelector('input').focus()
  })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: tpl ? `Ubah ${tpl.name}` : 'Tambah template',
    description: 'Bisnis memilih template ini di tahap Penawaran, lalu menjawab pertanyaannya sebelum AI menyusun penawaran.',
    wide: true,
    children: [name.wrap, el('div', { className: 'form-row' }, cat.wrap, sort.wrap), desc.wrap,
      el('h3', { className: 'field-label' }, 'Pertanyaan untuk klien'), fieldsBox, addField, preview,
      el('h3', { className: 'field-label' }, 'Panduan AI'), hint.wrap, terms.wrap, el('div', { className: 'form-row' }, min.wrap, max.wrap), vis.wrap, err],
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
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      if (tpl) await adminUpdateTemplate(tpl.id, body)
      else await adminCreateTemplate(body)
      base = null
      close()
      showToast('Template tersimpan.', 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  const list = el('div', { className: 'ot-list' })
  let run = 0
  let q = ''
  const pg = C.pager({ label: 'template penawaran', pageSize: OFFICE_PAGE_SIZE, sizes: [OFFICE_PAGE_SIZE], hideSize: true, onChange: () => load(pg.page), scrollTarget: () => list })
  const add = C.button({ label: 'Tambah template', icon: 'plus', variant: 'primary', size: 'sm' })
  const search = el('input', { type: 'search', className: 'input input-sm', placeholder: 'Cari template', 'aria-label': 'Cari template' })
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
    if (meta) meta.textContent = `${data.total} template`
    const reload = () => load(pg.page)
    list.replaceChildren(...(data.items.length ? data.items.map((t) => {
      const edit = C.button({ label: 'Ubah', variant: 'soft', size: 'sm' })
      edit.setAttribute('aria-label', `Ubah ${t.name}`)
      edit.addEventListener('click', () => templateDialog(ctx, t, edit, reload, setDirty))
      const toggle = C.button({ label: t.active ? 'Nonaktifkan' : 'Aktifkan', variant: 'ghost', size: 'sm' })
      toggle.setAttribute('aria-label', `${t.active ? 'Nonaktifkan' : 'Aktifkan'} ${t.name}`)
      toggle.addEventListener('click', async () => {
        const restore = C.setBusy(toggle, 'Menyimpan…')
        try { await adminUpdateTemplate(t.id, { active: !t.active }); showToast(t.active ? 'Template dinonaktifkan.' : 'Template diaktifkan.', 'success'); reload() } catch (ex) { restore(); showToast(ex.message, 'error') }
      })
      const del = C.button({ label: 'Hapus', icon: 'trash', variant: 'ghost', size: 'sm' })
      del.setAttribute('aria-label', `Hapus ${t.name}`)
      del.addEventListener('click', async () => {
        if (!confirm(`Hapus template "${t.name}"? Penawaran yang sudah memakainya tidak berubah.`)) return
        const restore = C.setBusy(del, 'Menghapus…')
        try { await adminDeleteTemplate(t.id); showToast('Template dihapus.', 'success'); reload() } catch (ex) { restore(); showToast(ex.message, 'error') }
      })
      return el('article', { className: 'workspace-entry ot-entry', dataset: { id: String(t.id) } },
        el('div', { className: 'workspace-entry-head' }, el('strong', {}, t.name), C.tag(catLabel(t.category), 'neutral'), t.active ? C.tag('Aktif', 'ok') : C.tag('Nonaktif', 'neutral')),
        t.description ? el('p', { className: 'muted small' }, t.description) : null,
        el('p', { className: 'small' }, `${t.fields.length} pertanyaan · ${priceRange(t)}`),
        el('div', { className: 'of-row-actions' }, edit, toggle, del))
    }) : [C.emptyState({ title: q ? 'Tidak ada template yang cocok' : 'Belum ada template', iconName: 'fileText' })]))
  }
  add.addEventListener('click', () => templateDialog(ctx, null, add, () => load(1), setDirty))
  host.replaceChildren(C.panel({ title: 'Template penawaran', meta: 'memuat…', actions: el('div', { className: 'ot-actions' }, el('label', { className: 'search-box' }, C.icon('search', { size: 16 }), search), add) },
    el('p', { className: 'muted small' }, 'Bisnis memakai template ini saat membuat penawaran. Hanya tim Satu Alur yang bisa mengubahnya.'), list, pg.root))
  meta = host.querySelector('.panel-meta')
  load(1)
}

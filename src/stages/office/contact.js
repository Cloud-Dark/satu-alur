import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListContact, adminUpdateContact, PAGE_SIZE } from '../../customers/api.js'
import { CONTACT_STATUS_LABEL, mailtoHref } from '../../customers/rules.js'

const { el } = C
const FILTERS = [...Object.entries(CONTACT_STATUS_LABEL).map(([value, label]) => ({ value, label })), { value: 'all', label: 'Semua' }]
const TONE = { new: 'brand', read: 'neutral', replied: 'ok', archived: 'neutral' }
let filter = 'new'

// One message: a header button opens it (a new message becomes Dibaca), the body is plain text.
function item(r, { onChanged, onSaved, signal }) {
  const id = `of-ct-${r.id}`
  const statusTag = el('span', {}, C.tag(CONTACT_STATUS_LABEL[r.status], TONE[r.status]))
  const status = C.select({ label: 'Status', id: `${id}-status`, value: r.status, options: Object.entries(CONTACT_STATUS_LABEL).map(([value, label]) => ({ value, label })) })
  const note = C.textarea({ label: 'Catatan internal', id: `${id}-note`, rows: 3, value: r.staff_note || '', attrs: { maxlength: '2000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', size: 'sm' })
  const href = mailtoHref(r.email, r.subject)
  const reply = href ? el('a', { className: 'btn btn-soft btn-sm', href }, 'Balas lewat email') : null
  const detail = el('div', { className: 'of-contact-detail', id: `${id}-detail`, hidden: true },
    el('p', { className: 'muted small' }, `${r.email}${r.phone ? ` · ${r.phone}` : ''}`),
    el('p', { className: 'of-contact-msg' }, r.message),
    reply, status.wrap, note.wrap, err, save)
  const head = el('button', { type: 'button', className: 'of-cust', 'aria-expanded': 'false', 'aria-controls': detail.id },
    el('span', { className: 'of-cust-main' }, el('strong', {}, r.subject), el('span', { className: 'muted small' }, r.name)),
    el('span', { className: 'of-cust-meta' }, statusTag, el('span', { className: 'muted small' }, C.formatDateTime(r.created_at))))

  head.addEventListener('click', async () => {
    const open = head.getAttribute('aria-expanded') !== 'true'
    head.setAttribute('aria-expanded', String(open))
    detail.hidden = !open
    if (!open || r.status !== 'new') return
    try {
      await adminUpdateContact(r.id, { status: 'read' })
      r.status = 'read'
      statusTag.replaceChildren(C.tag(CONTACT_STATUS_LABEL.read, TONE.read))
      status.input.value = 'read'
      if (!signal.aborted) onChanged()
    } catch (ex) { showToast(ex.message, 'error') }
  })
  save.addEventListener('click', async () => {
    err.textContent = ''
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await adminUpdateContact(r.id, { status: status.input.value, staff_note: note.input.value })
      showToast('Pesan diperbarui.', 'success')
      if (!signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  return el('article', { className: 'of-contact', dataset: { id: String(r.id) } }, head, detail)
}

/** onChanged() tells the section list to refresh the "new" badge. */
export function draw(host, ctx, setDirty, onChanged = () => {}) {
  let run = 0
  const pg = C.pager({ label: 'daftar pesan', pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const body = el('div', { 'aria-live': 'polite' })
  const seg = C.segmented({ options: FILTERS, value: filter, label: 'Filter status', onChange: (v) => { filter = v; pg.reset(); load(1) } })
  seg.classList.add('of-seg-wrap') // five options: wrap instead of overflowing at 360px
  host.replaceChildren(C.panel({ title: 'Contact Us' }, seg, body, pg.root))

  async function load(page) {
    const mine = ++run
    body.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await adminListContact({ status: filter, page }) } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => load(page))
      body.replaceChildren(C.errorState(e.message), again)
      pg.root.hidden = true
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    onChanged()
    pg.slice(new Array(data.total))
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    if (!data.items.length) {
      body.replaceChildren(C.emptyState({ title: 'Tidak ada pesan', body: 'Belum ada pesan dengan status ini.', iconName: 'inbox' }))
      return
    }
    const opts = { onChanged, onSaved: () => { onChanged(); load(pg.page) }, signal: ctx.signal }
    body.replaceChildren(el('div', { className: 'of-cust-list' }, ...data.items.map((r) => item(r, opts))))
  }
  load(1)
}

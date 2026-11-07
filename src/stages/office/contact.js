import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListContact, adminUpdateContact, PAGE_SIZE } from '../../customers/api.js'
import { CONTACT_STATUS_LABEL, mailtoHref } from '../../customers/rules.js'
import { t } from '../../i18n/index.js'

const { el } = C
const statusLabel = (s) => (CONTACT_STATUS_LABEL[s] ? t(`office.contact.status.${s}`) : s)
const statusOptions = () => Object.keys(CONTACT_STATUS_LABEL).map((value) => ({ value, label: statusLabel(value) }))
const FILTERS = [...statusOptions(), { value: 'all', label: t('office.common.all') }]
const TONE = { new: 'brand', read: 'neutral', replied: 'ok', archived: 'neutral' }
let filter = 'new'

// One message: a header button opens it (a new message becomes Dibaca), the body is plain text.
function item(r, { onChanged, onSaved, signal, setDirty }) {
  const id = `of-ct-${r.id}`
  const statusTag = el('span', {}, C.tag(statusLabel(r.status), TONE[r.status]))
  const status = C.select({ label: t('office.common.status'), id: `${id}-status`, value: r.status, options: statusOptions() })
  const note = C.textarea({ label: t('office.common.internalNote'), id: `${id}-note`, rows: 3, value: r.staff_note || '', attrs: { maxlength: '2000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', size: 'sm' })
  // Unsaved note or status marks the section dirty, so switching sections asks first (office/index.js).
  note.input.addEventListener('input', () => setDirty(true))
  status.input.addEventListener('change', () => setDirty(true))
  const href = mailtoHref(r.email, r.subject)
  const reply = href ? el('a', { className: 'btn btn-soft btn-sm', href }, t('office.contact.replyEmail')) : null
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
      statusTag.replaceChildren(C.tag(statusLabel('read'), TONE.read))
      status.input.value = 'read'
      if (!signal.aborted) onChanged()
    } catch (ex) { showToast(ex.message, 'error') }
  })
  save.addEventListener('click', async () => {
    err.textContent = ''
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      await adminUpdateContact(r.id, { status: status.input.value, staff_note: note.input.value })
      showToast(t('office.contact.updated'), 'success')
      setDirty(false)
      if (!signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  return el('article', { className: 'of-contact', dataset: { id: String(r.id) } }, head, detail)
}

/** onChanged() tells the section list to refresh the "new" badge. */
export function draw(host, ctx, setDirty, onChanged = () => {}) {
  let run = 0
  const pg = C.pager({ label: t('office.contact.pagerLabel'), pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const body = el('div', { 'aria-live': 'polite' })
  const seg = C.segmented({ options: FILTERS, value: filter, label: t('office.common.filterStatus'), onChange: (v) => { filter = v; pg.reset(); load(1) } })
  seg.classList.add('of-seg-wrap') // five options: wrap instead of overflowing at 360px
  host.replaceChildren(C.panel({ title: t('office.menu.contact') }, seg, body, pg.root))

  async function load(page) {
    const mine = ++run
    setDirty(false)
    body.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await adminListContact({ status: filter, page }) } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
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
      body.replaceChildren(C.emptyState({ title: t('office.contact.empty'), body: t('office.contact.emptyBody'), iconName: 'inbox' }))
      return
    }
    const opts = { onChanged, onSaved: () => { onChanged(); load(pg.page) }, signal: ctx.signal, setDirty }
    body.replaceChildren(el('div', { className: 'of-cust-list' }, ...data.items.map((r) => item(r, opts))))
  }
  load(1)
}

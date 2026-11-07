import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListTickets, adminGetTicket, adminReplyTicket, adminUpdateTicket, PAGE_SIZE } from '../../customers/api.js'
import { TICKET_STATUS_LABEL } from '../../support/rules.js'
import { statusTag, replyForm, threadView, staleReply } from '../../support/page.js'
import { LEAVE_MSG } from './site-doc.js'
import { t } from '../../i18n/index.js'

const { el } = C
const STATUS_OPTIONS = Object.keys(TICKET_STATUS_LABEL).map((value) => ({ value, label: t(`support.status.${value}`) }))
const FILTERS = [{ value: 'all', label: t('office.common.all') }, ...STATUS_OPTIONS]
let filter = 'all'

const waiting = (tk) => (tk.status === 'open' || tk.status === 'in_progress') && tk.last_reply_by === 'customer'

/** Pengaduan CS: inbox by status → thread with a reply box and a status select. onChanged() refreshes the badge. */
export function draw(host, ctx, setDirty, onChanged = () => {}) {
  let run = 0
  let hasDraft = false
  const setDraft = (has) => { hasDraft = has; setDirty(has) }
  const live = (mine) => !ctx.signal.aborted && mine === run
  const view = el('div')
  const pg = C.pager({ label: t('office.tickets.pagerLabel'), pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const body = el('div', { 'aria-live': 'polite' })
  const seg = C.segmented({ options: FILTERS, value: filter, label: t('office.common.filterStatus'), onChange: (v) => { filter = v; pg.reset(); load(1) } })
  seg.classList.add('of-seg-wrap') // five options: wrap instead of overflowing at 360px
  host.replaceChildren(C.panel({ title: t('office.menu.tickets') }, view))

  function row(tk) {
    const b = el('button', { type: 'button', className: 'of-cust of-ticket' },
      el('span', { className: 'of-cust-main' }, el('strong', { className: 'sp-subject' }, tk.subject),
        tk.company ? el('span', { className: 'small' }, tk.company) : null,
        el('span', { className: 'muted small' }, tk.email)),
      el('span', { className: 'of-cust-meta' }, statusTag(tk.status), waiting(tk) ? C.tag(t('office.tickets.waiting'), 'warn') : null,
        el('span', { className: 'muted small' }, C.formatDateTime(tk.updated_at))))
    b.addEventListener('click', () => showThread(tk.id))
    return b
  }

  async function load(page) {
    const mine = ++run
    setDraft(false)
    view.replaceChildren(seg, body, pg.root)
    body.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await adminListTickets({ status: filter, page }) } catch (e) {
      if (!live(mine)) return
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => load(page))
      body.replaceChildren(C.errorState(e.message), again)
      pg.root.hidden = true
      return
    }
    if (!live(mine)) return
    onChanged()
    pg.slice(new Array(data.total))
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    body.replaceChildren(data.items.length
      ? el('div', { className: 'of-cust-list' }, ...data.items.map(row))
      : C.emptyState({ title: t('office.tickets.empty'), body: t('office.tickets.emptyBody'), iconName: 'inbox' }))
  }

  async function showThread(id, draft = '') {
    const mine = ++run
    setDraft(!!draft.trim()) // a draft carried over a reload still counts until it is sent
    view.replaceChildren(C.skeletonRows(3))
    let th
    try { th = await adminGetTicket(id) } catch (e) {
      if (!live(mine)) return
      const back = C.button({ label: t('office.tickets.back'), icon: 'arrowLeft', variant: 'ghost', size: 'sm' })
      back.addEventListener('click', () => load(pg.page))
      view.replaceChildren(back, C.errorState(e.message))
      return
    }
    if (!live(mine)) return
    // keep: reply text to carry into the redrawn form (a status save must not wipe an unsent reply)
    const drawThread = ({ ticket: tk, messages }, keep = '') => {
      const status = C.select({ label: t('office.common.status'), id: `of-tk-${tk.id}-status`, value: tk.status, options: STATUS_OPTIONS })
      const save = C.button({ label: t('office.tickets.saveStatus'), icon: 'save', variant: 'soft', size: 'sm' })
      const err = el('p', { className: 'field-error', role: 'alert' })
      save.addEventListener('click', async () => {
        err.textContent = ''
        const restore = C.setBusy(save, t('office.common.saving'))
        try {
          const next = await adminUpdateTicket(tk.id, { status: status.input.value })
          showToast(t('office.tickets.statusUpdated'), 'success')
          if (live(mine)) { drawThread(next, reply.querySelector('textarea').value); onChanged() }
        } catch (ex) { err.textContent = ex.message } finally { restore() }
      })
      // Unsent text marks the section dirty, so switching sections asks first (office/index.js).
      const reply = replyForm(async (text) => {
        let next
        try { next = await adminReplyTicket(tk.id, { body: text }) } catch (ex) {
          if (!staleReply(ex)) throw ex
          showToast(ex.message, 'error')
          if (live(mine)) showThread(tk.id, text)
          return
        }
        if (!live(mine)) return
        drawThread(next)
        onChanged()
        showToast(t('office.tickets.replySent'), 'success')
      }, { draft: keep, onDraft: setDraft })
      const who = el('span', { className: 'muted small' }, [tk.company, tk.email].filter(Boolean).join(' · '))
      view.replaceChildren(threadView(tk, {
        onBack: () => { if (!hasDraft || confirm(LEAVE_MSG)) load(pg.page) }, messages, meta: who,
        foot: el('div', { className: 'sp-staff-foot' }, reply, el('div', { className: 'sp-status' }, status.wrap, save), err),
      }))
    }
    drawThread(th, draft)
  }

  load(1)
}

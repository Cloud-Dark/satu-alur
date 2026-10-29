import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListTickets, adminGetTicket, adminReplyTicket, adminUpdateTicket, PAGE_SIZE } from '../../customers/api.js'
import { TICKET_STATUS_LABEL } from '../../support/rules.js'
import { statusTag, replyForm, threadView } from '../../support/page.js'

const { el } = C
const STATUS_OPTIONS = Object.entries(TICKET_STATUS_LABEL).map(([value, label]) => ({ value, label }))
const FILTERS = [{ value: 'all', label: 'Semua' }, ...STATUS_OPTIONS]
let filter = 'all'

const waiting = (t) => (t.status === 'open' || t.status === 'in_progress') && t.last_reply_by === 'customer'

/** Pengaduan CS: inbox by status → thread with a reply box and a status select. onChanged() refreshes the badge. */
export function draw(host, ctx, setDirty, onChanged = () => {}) {
  let run = 0
  const live = (mine) => !ctx.signal.aborted && mine === run
  const view = el('div')
  const pg = C.pager({ label: 'daftar tiket', pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const body = el('div', { 'aria-live': 'polite' })
  const seg = C.segmented({ options: FILTERS, value: filter, label: 'Filter status', onChange: (v) => { filter = v; pg.reset(); load(1) } })
  seg.classList.add('of-seg-wrap') // five options: wrap instead of overflowing at 360px
  host.replaceChildren(C.panel({ title: 'Pengaduan CS' }, view))

  function row(t) {
    const b = el('button', { type: 'button', className: 'of-cust of-ticket' },
      el('span', { className: 'of-cust-main' }, el('strong', { className: 'sp-subject' }, t.subject),
        t.company ? el('span', { className: 'small' }, t.company) : null,
        el('span', { className: 'muted small' }, t.email)),
      el('span', { className: 'of-cust-meta' }, statusTag(t.status), waiting(t) ? C.tag('Menunggu balasan', 'warn') : null,
        el('span', { className: 'muted small' }, C.formatDateTime(t.updated_at))))
    b.addEventListener('click', () => showThread(t.id))
    return b
  }

  async function load(page) {
    const mine = ++run
    view.replaceChildren(seg, body, pg.root)
    body.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await adminListTickets({ status: filter, page }) } catch (e) {
      if (!live(mine)) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
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
      : C.emptyState({ title: 'Tidak ada tiket', body: 'Belum ada tiket dengan status ini.', iconName: 'inbox' }))
  }

  async function showThread(id) {
    const mine = ++run
    view.replaceChildren(C.skeletonRows(3))
    let th
    try { th = await adminGetTicket(id) } catch (e) {
      if (!live(mine)) return
      const back = C.button({ label: 'Kembali ke daftar tiket', icon: 'arrowLeft', variant: 'ghost', size: 'sm' })
      back.addEventListener('click', () => load(pg.page))
      view.replaceChildren(back, C.errorState(e.message))
      return
    }
    if (!live(mine)) return
    const drawThread = ({ ticket: t, messages }) => {
      const status = C.select({ label: 'Status', id: `of-tk-${t.id}-status`, value: t.status, options: STATUS_OPTIONS })
      const save = C.button({ label: 'Simpan status', icon: 'save', variant: 'soft', size: 'sm' })
      const err = el('p', { className: 'field-error', role: 'alert' })
      save.addEventListener('click', async () => {
        err.textContent = ''
        const restore = C.setBusy(save, 'Menyimpan…')
        try {
          const next = await adminUpdateTicket(t.id, { status: status.input.value })
          showToast('Status tiket diperbarui.', 'success')
          if (live(mine)) { drawThread(next); onChanged() }
        } catch (ex) { err.textContent = ex.message } finally { restore() }
      })
      const reply = replyForm(async (text) => {
        const next = await adminReplyTicket(t.id, { body: text })
        if (!live(mine)) return
        drawThread(next)
        onChanged()
        showToast('Balasan terkirim.', 'success')
      })
      const who = el('span', { className: 'muted small' }, [t.company, t.email].filter(Boolean).join(' · '))
      view.replaceChildren(threadView(t, {
        onBack: () => load(pg.page), messages, meta: who,
        foot: el('div', { className: 'sp-staff-foot' }, reply, el('div', { className: 'sp-status' }, status.wrap, save), err),
      }))
    }
    drawThread(th)
  }

  load(1)
}

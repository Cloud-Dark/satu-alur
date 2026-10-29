/**
 * Bantuan: a signed-in business raises after-sales tickets and follows each thread with the Satu Alur team.
 * Deep link: #/support?tiket=<id> (ui/app.js opens this stage and keeps the query).
 * messageList, replyForm and statusTag are shared with Kantor Satu Alur › Pengaduan CS.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { listTickets, getTicket, createTicket, replyTicket } from '../customers/api.js'
import { TICKET_STATUS_LABEL, TICKET_CATEGORY_LABEL, TICKET_CLOSED_MESSAGE, validateTicket, validateReply } from './rules.js'

const { el } = C
const TONE = { open: 'brand', in_progress: 'warn', resolved: 'ok', closed: 'neutral' }
const LEAVE = 'Tiket belum dikirim. Tutup tanpa mengirim?'
let seq = 0

export const statusTag = (s) => C.tag(TICKET_STATUS_LABEL[s] || s, TONE[s])

/** Oldest first; every stored string is a text node, line breaks kept by .sp-msg-body (pre-wrap). */
export function messageList(messages) {
  return el('ol', { className: 'sp-msgs' }, ...messages.map((m) =>
    el('li', { className: `sp-msg is-${m.author === 'staff' ? 'staff' : 'customer'}` },
      el('p', { className: 'sp-msg-head' },
        el('strong', { className: 'sp-msg-author' }, m.author_name),
        el('span', { className: 'muted small' }, C.formatDateTime(m.created_at))),
      el('p', { className: 'sp-msg-body' }, m.body))))
}

/** A reply that lost a race (409) or hit a ticket closed meanwhile: show why, then reload the thread. */
export const staleReply = (ex) => ex?.status === 409 || ex?.message === TICKET_CLOSED_MESSAGE

/**
 * Reply box; onSend(body) saves and redraws the thread (errors show under the box).
 * draft: initial text (kept across a reload); onDraft(hasText) reports unsent text for leave guards.
 */
export function replyForm(onSend, { draft = '', onDraft = () => {} } = {}) {
  const box = C.textarea({ label: 'Balasan', id: `sp-reply-${++seq}`, rows: 4, required: true, value: draft, attrs: { maxlength: '3000' } })
  box.input.addEventListener('input', () => onDraft(box.input.value.trim() !== ''))
  onDraft(draft.trim() !== '')
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim balasan', icon: 'send', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'form sp-reply', noValidate: true }, box.wrap, err, send)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let body
    try { body = validateReply({ body: box.input.value }) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(send, 'Mengirim…')
    try { await onSend(body) } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  return form
}

/** Back button, subject, category + status, the messages, then `foot` (reply box, note or staff controls). */
export function threadView(t, { onBack, messages, meta, foot }) {
  const back = C.button({ label: 'Kembali ke daftar tiket', icon: 'arrowLeft', variant: 'ghost', size: 'sm' })
  back.addEventListener('click', onBack)
  const hid = `sp-thread-title-${++seq}`
  return el('section', { className: 'sp-thread', dataset: { id: String(t.id) }, 'aria-labelledby': hid },
    back,
    el('h2', { className: 'sp-subject', id: hid }, t.subject),
    el('p', { className: 'sp-meta' }, el('span', { className: 'muted small' }, TICKET_CATEGORY_LABEL[t.category] || t.category), statusTag(t.status), meta || null),
    messageList(messages), foot)
}

function openCreate(opener, onCreated) {
  const id = ++seq
  const cat = C.select({ label: 'Kategori', id: `sp-cat-${id}`, value: 'teknis',
    options: Object.entries(TICKET_CATEGORY_LABEL).map(([value, label]) => ({ value, label })) })
  const subject = C.field({ label: 'Subjek', id: `sp-subject-${id}`, required: true, attrs: { maxlength: '120' } })
  const msg = C.textarea({ label: 'Pesan', id: `sp-body-${id}`, required: true, rows: 6, attrs: { maxlength: '3000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim tiket', icon: 'send', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost' })
  const { dialog, form, close } = C.modal({
    title: 'Buat tiket', description: 'Ceritakan kendalanya. Tim Satu Alur membalas di halaman ini.',
    children: [cat.wrap, subject.wrap, msg.wrap, err], actions: [cancel, send], opener,
  })
  // Unsent text asks first (Escape fires `cancel`; Batal asks too), like the office dialogs.
  const dirty = () => Boolean(subject.input.value.trim() || msg.input.value.trim())
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE)) e.preventDefault() })
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validateTicket({ category: cat.input.value, subject: subject.input.value, body: msg.input.value }) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(send, 'Mengirim…')
    try {
      const th = await createTicket(clean)
      close()
      showToast('Tiket terkirim.', 'success')
      onCreated(th.ticket.id)
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export async function render(container, ctx) {
  const body = el('div', { className: 'sp-body', 'aria-live': 'polite' })
  container.replaceChildren(
    C.pageHeader({ title: 'Bantuan', description: 'Ada kendala teknis, tagihan, atau akun? Buat tiket dan ikuti balasan tim Satu Alur di sini.' }),
    body)
  let run = 0
  const live = (mine) => !ctx.signal.aborted && mine === run

  function row(t) {
    const b = el('button', { type: 'button', className: 'of-cust sp-ticket' },
      el('span', { className: 'of-cust-main' }, el('strong', { className: 'sp-subject' }, t.subject),
        el('span', { className: 'muted small' }, TICKET_CATEGORY_LABEL[t.category] || t.category)),
      el('span', { className: 'of-cust-meta' }, statusTag(t.status), el('span', { className: 'muted small' }, `Diperbarui ${C.formatDateTime(t.updated_at)}`)))
    b.addEventListener('click', () => showThread(t.id))
    return b
  }

  async function showList() {
    const mine = ++run
    hasDraft = false
    const add = C.button({ label: 'Buat tiket', icon: 'plus', variant: 'primary', size: 'sm' })
    add.addEventListener('click', () => openCreate(add, (id) => { if (!ctx.signal.aborted) showThread(id) }))
    const panel = (...kids) => C.panel({ title: 'Tiket saya', actions: add }, ...kids)
    body.replaceChildren(panel(C.skeletonRows(3)))
    let rows
    try { rows = await listTickets() } catch (e) {
      if (!live(mine)) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', showList)
      body.replaceChildren(panel(C.errorState(e.message), again))
      return
    }
    if (!live(mine)) return
    body.replaceChildren(panel(rows.length
      ? el('div', { className: 'of-cust-list' }, ...rows.map(row))
      : C.emptyState({ title: 'Belum ada tiket', body: 'Buat tiket bila ada kendala teknis, tagihan, atau akun.', iconName: 'inbox' })))
  }

  async function showThread(id, draft = '') {
    const mine = ++run
    hasDraft = false
    body.replaceChildren(C.skeletonRows(3))
    let th
    try { th = await getTicket(id) } catch (e) {
      if (!live(mine)) return
      const back = C.button({ label: 'Kembali ke daftar tiket', icon: 'arrowLeft', variant: 'ghost', size: 'sm' })
      back.addEventListener('click', showList)
      body.replaceChildren(el('div', { className: 'sp-thread-error' }, back, C.errorState(e.message)))
      return
    }
    if (!live(mine)) return
    const draw = ({ ticket: t, messages }) => {
      const foot = t.status === 'closed'
        ? el('p', { className: 'note sp-closed' }, 'Tiket ditutup. Buat tiket baru bila masih butuh bantuan.')
        : replyForm(async (text) => {
          let next
          try { next = await replyTicket(t.id, { body: text }) } catch (ex) {
            if (!staleReply(ex)) throw ex
            showToast(ex.message, 'error')
            if (live(mine)) showThread(t.id, text)
            return
          }
          if (!live(mine)) return
          draw(next)
          showToast('Balasan terkirim.', 'success')
        }, { draft, onDraft: (has) => { hasDraft = has } })
      if (t.status === 'closed') hasDraft = false
      draft = ''
      body.replaceChildren(threadView(t, { onBack: showList, foot, messages }))
    }
    draw(th)
  }

  // The shell has no shared leave guard, so an unsent reply only guards closing or reloading the tab.
  let hasDraft = false
  const onUnload = (e) => { if (hasDraft) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', onUnload)
  ctx.signal.addEventListener('abort', () => window.removeEventListener('beforeunload', onUnload))

  // A deep link opens that ticket once; drop the query so a reload shows the list.
  const deep = new URLSearchParams(location.hash.split('?')[1] || '').get('tiket')
  if (deep !== null) history.replaceState(null, '', '#/app')
  if (deep) showThread(deep)
  else showList()
}

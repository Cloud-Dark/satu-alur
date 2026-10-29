import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListUsers, adminSuspendUser, adminRestoreUser, adminRevokeUserSessions, PAGE_SIZE } from '../../customers/api.js'
import { validateSuspendReason } from '../../customers/rules.js'
import { LEAVE_MSG } from './site-doc.js'

const { el } = C
let seq = 0

function suspendDialog(ctx, u, opener, onDone, setDirty) {
  const reason = C.textarea({ label: 'Alasan', id: `of-us-reason-${++seq}`, rows: 3, hint: 'Dicatat untuk tim. Pengguna langsung keluar dari semua sesi.', attrs: { maxlength: '300' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Tangguhkan', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: 'Tangguhkan pengguna', description: u.email, opener, actions: [cancel, save], children: [reason.wrap, err],
  })
  const dirty = () => reason.input.value.trim() !== ''
  form.addEventListener('input', () => setDirty(dirty()))
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validateSuspendReason({ reason: reason.input.value }) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, 'Menangguhkan…')
    try {
      await adminSuspendUser(u.id, clean)
      close()
      showToast('Pengguna ditangguhkan.', 'success')
      if (!ctx.signal.aborted) onDone()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  let query = ''
  let timer
  const pg = C.pager({ label: 'daftar pengguna', pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const search = C.field({ label: 'Cari pengguna', id: 'of-us-search', type: 'search', hint: 'Email atau nama.', attrs: { maxlength: '100', autocomplete: 'off' } })
  const body = el('div', { 'aria-live': 'polite' })
  const panel = C.panel({ title: 'Pengguna' }, search.wrap, body, pg.root)
  ctx.signal.addEventListener('abort', () => clearTimeout(timer))
  search.input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (search.input.value.trim() === query) return
      query = search.input.value.trim()
      pg.reset()
      load(1)
    }, 300)
  })
  host.replaceChildren(panel)

  // Pulihkan / Akhiri sesi: one request, a toast, then a fresh list.
  async function act(btn, busyLabel, fn, done) {
    const restore = C.setBusy(btn, busyLabel)
    try {
      await fn()
      showToast(done, 'success')
      if (!ctx.signal.aborted) load(pg.page)
    } catch (ex) { showToast(ex.message, 'error') } finally { restore() }
  }

  function row(u) {
    const actions = el('span', { className: 'of-cust-meta' })
    if (u.suspended) {
      const b = C.button({ label: 'Pulihkan', variant: 'soft', size: 'sm' })
      b.addEventListener('click', () => act(b, 'Memulihkan…', () => adminRestoreUser(u.id), 'Pengguna dipulihkan.'))
      actions.append(b)
    } else if (!u.demo) { // shared demo accounts can't be suspended (Worker answers 400)
      const b = C.button({ label: 'Tangguhkan', variant: 'soft', size: 'sm' })
      b.addEventListener('click', () => suspendDialog(ctx, u, b, () => load(pg.page), setDirty))
      actions.append(b)
    }
    const end = C.button({ label: 'Akhiri sesi', variant: 'ghost', size: 'sm' })
    end.addEventListener('click', () => {
      if (!confirm(`Akhiri semua sesi ${u.email}? Pengguna harus masuk lagi.`)) return
      act(end, 'Mengakhiri…', () => adminRevokeUserSessions(u.id), 'Sesi pengguna diakhiri.')
    })
    actions.append(end)
    return el('div', { className: 'of-user' },
      el('span', { className: 'of-cust-main' },
        el('strong', {}, u.email),
        el('span', { className: 'muted small' }, u.name || '—'),
        u.suspended ? el('span', { className: 'small of-user-reason' }, `Alasan: ${u.reason || '—'}`) : null),
      el('span', { className: 'of-cust-meta' },
        u.demo ? C.tag('Demo', 'neutral') : null,
        u.suspended ? C.tag('Ditangguhkan', 'danger') : null,
        el('span', { className: 'small' }, `Sesi aktif: ${u.active_sessions}`),
        el('span', { className: 'muted small' }, u.last_session_at ? `Terakhir masuk ${C.formatDate(u.last_session_at)}` : '')),
      actions)
  }

  async function load(page) {
    const mine = ++run
    body.replaceChildren(C.skeletonRows(4))
    let data
    try { data = await adminListUsers({ q: query, page }) } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => load(page))
      body.replaceChildren(C.errorState(e.message), again)
      pg.root.hidden = true
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    pg.slice(new Array(data.total))
    // The list shrank under us (page now past the end): show the last page that exists.
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    if (!data.items.length) {
      body.replaceChildren(C.emptyState({ title: query ? 'Tidak ada yang cocok' : 'Belum ada pengguna', body: query ? 'Coba kata kunci lain.' : 'Bisnis yang mendaftar akan muncul di sini.', iconName: 'sprout' }))
      return
    }
    body.replaceChildren(el('div', { className: 'of-cust-list' }, ...data.items.map(row)))
  }
  load(1)
}

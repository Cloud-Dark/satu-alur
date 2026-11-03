import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListUsers, adminSuspendUser, adminRestoreUser, adminRevokeUserSessions, PAGE_SIZE } from '../../customers/api.js'
import { validateSuspendReason } from '../../customers/rules.js'
import { LEAVE_MSG } from './site-doc.js'
import { getUserDetail, setUserTier } from '../../admin/api.js'
import { PLANS, PLAN_LABELS } from '../../business/plan-access.js'

const { el } = C
let seq = 0

// Sample sign-ups from seeds/office.sql: fictional admin-panel rows, never a real business.
const isSampleEmail = (email) => String(email || '').toLowerCase().endsWith('@contoh.satualur.id')

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

const FEATURE_LABEL = (f) => (f.startsWith('byo_') ? `${f.slice(4)} (penyedia sendiri)` : f)

// Detail: tier (skala akun), subscription, AI usage this month, credit, integrations, recent emails.
async function detailDialog(ctx, u, opener, onDone) {
  let d
  try { d = await getUserDetail(u.id) } catch (ex) { showToast(ex.message, 'error'); return }
  if (ctx.signal.aborted) return
  const tier = C.select({ label: 'Skala akun', id: `of-us-tier-${++seq}`, options: PLANS.map((p) => ({ value: p, label: PLAN_LABELS[p] || p })), value: d.tier,
    hint: d.demo ? 'Akun demo mengikuti skalanya sendiri.' : 'Membuka atau mengunci fitur (mis. integrasi ERP untuk Enterprise).' })
  if (d.demo) tier.input.disabled = true
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan skala', variant: 'primary', type: 'submit' })
  const close = C.button({ label: 'Tutup', variant: 'ghost', dismiss: true })
  const usage = d.usage.length
    ? el('ul', { className: 'of-us-usage' }, d.usage.map((r) => el('li', {}, `${FEATURE_LABEL(r.feature)}: ${C.number(r.count)}`)))
    : el('span', { className: 'muted' }, 'Belum ada')
  const { form, close: done } = C.modal({
    title: 'Detail pengguna', description: d.user.email, opener, wide: true, actions: [close, d.demo ? null : save].filter(Boolean),
    children: [
      C.defList([
        ['Nama', d.user.name || '—'],
        ['Terdaftar', C.formatDate(d.user.created_at)],
        ['Terakhir masuk', d.user.last_login_at ? C.formatDateTime(d.user.last_login_at) : (d.sessions.last ? C.formatDateTime(d.sessions.last) : '—')],
        ['Paket', d.subscription?.plan_name ? `${d.subscription.plan_name} (${d.subscription.status})` : 'Free'],
        ['Saldo AI', C.rupiah(d.credit_idr)],
        ['Pemakaian AI bulan ini', usage],
        ['Email', d.integrations.email_mode === 'smtp' ? `SMTP sendiri (${d.integrations.smtp_host})` : 'Layanan Satu Alur'],
        ['Mesin AI', d.integrations.ai_mode === 'builtin' ? 'Bawaan' : `${d.integrations.ai_mode} · ${d.integrations.ai_model || ''}`],
        ['Status', d.suspended ? `Ditangguhkan: ${d.reason || '—'}` : 'Aktif'],
      ]),
      tier.wrap, err,
    ],
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await setUserTier(u.id, tier.input.value)
      showToast('Skala akun disimpan.', 'success')
      done()
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
    const det = C.button({ label: 'Detail', variant: 'ghost', size: 'sm' })
    det.addEventListener('click', () => detailDialog(ctx, u, det, () => load(pg.page)))
    actions.prepend(det)
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
        isSampleEmail(u.email) ? C.tag('Contoh', 'neutral') : null,
        u.suspended ? C.tag('Ditangguhkan', 'danger') : null,
        u.tier ? C.tag(PLAN_LABELS[u.tier] || u.tier, 'brand') : null,
        u.plan_name ? el('span', { className: 'small' }, `Paket ${u.plan_name}`) : null,
        u.ai_calls_month ? el('span', { className: 'small' }, `AI bulan ini: ${C.number(u.ai_calls_month)}`) : null,
        u.credit_idr ? el('span', { className: 'small' }, `Saldo ${C.rupiah(u.credit_idr)}`) : null,
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

import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListCustomers, adminGetCustomer, adminSaveCustomer, PAGE_SIZE } from '../../customers/api.js'
import { adminListPlans } from '../../business/api.js'
import { CUSTOMER_STATUS_LABEL, validateCustomer } from '../../customers/rules.js'
import { stampLine } from './site-landing.js'
import { LEAVE_MSG } from './site-doc.js'
import { adminCustomerQuota, adminGrantCredit } from '../../quota/api.js'
import { rupiah } from '../../quota/rules.js'

const { el } = C
const TONE = { trial: 'brand', active: 'ok', past_due: 'warn', cancelled: 'neutral' }
const statusTag = (s) => (s ? C.tag(CUSTOMER_STATUS_LABEL[s], TONE[s]) : C.tag('Belum diatur', 'neutral'))
let seq = 0
const REASON = { voucher: 'Voucher', staff: 'Tim', refund: 'Dikembalikan' }

// AI usage this month, credit balance and a staff top-up. Loads on its own so the dialog opens at once.
function quotaSection(c, id) {
  const box = el('div', { className: 'of-cu-quota', 'aria-live': 'polite' }, C.skeletonRows(2))
  const amount = C.field({ label: 'Tambah / kurangi saldo AI (Rp)', id: `of-cu-credit-${id}`, type: 'number', hint: 'Negatif untuk koreksi. Tercatat atas nama Anda.', attrs: { step: '1000' } })
  const note = C.field({ label: 'Alasan', id: `of-cu-credit-note-${id}`, attrs: { maxlength: '200' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const apply = C.button({ label: 'Terapkan saldo', icon: 'wallet', variant: 'soft', size: 'sm' })
  const drawQuota = (q) => box.replaceChildren(
    el('p', { className: 'small' }, `Paket berlaku: ${q.plan.name}${q.demo ? ' (akun demo, tanpa batas)' : ''} · saldo AI `, el('strong', { className: 'tnum' }, rupiah(q.credit_idr))),
    el('ul', { className: 'of-cu-usage small' }, ...q.usage.map((u) => el('li', {}, `${u.label}: `, el('span', { className: 'tnum' }, u.limit === null ? `${u.used} (tanpa batas)` : `${u.used} / ${u.limit}`)))),
    q.entries?.length
      ? el('ul', { className: 'of-cu-entries muted small' }, ...q.entries.slice(0, 5).map((e) => el('li', {},
        `${C.formatDateTime(e.created_at)} · ${REASON[e.reason] || 'Pemakaian'} · `, el('span', { className: 'tnum' }, `${e.amount_idr > 0 ? '+' : '−'}${rupiah(Math.abs(e.amount_idr))}`), e.ref ? ` · ${e.ref}` : '')))
      : '')
  adminCustomerQuota(c.id).then(drawQuota).catch((ex) => box.replaceChildren(C.errorState(ex.message)))
  apply.addEventListener('click', async () => {
    err.textContent = ''
    const n = Number(amount.input.value)
    if (!Number.isInteger(n) || n === 0) { err.textContent = 'Isi jumlah saldo (bilangan bulat, bukan nol).'; return }
    const restore = C.setBusy(apply, 'Menyimpan…')
    try {
      drawQuota(await adminGrantCredit(c.id, n, note.input.value.trim()))
      amount.input.value = ''
      note.input.value = ''
      showToast('Saldo AI diperbarui.', 'success')
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  return el('section', { className: 'of-cu-quota-wrap' },
    el('h3', { className: 'field-label' }, 'Kuota & saldo AI'), box,
    el('div', { className: 'form-row' }, amount.wrap, note.wrap), err, el('div', { className: 'form-actions' }, apply))
}

function customerDialog(ctx, c, plans, opener, onSaved, setDirty) {
  const id = ++seq
  const planOptions = [{ value: '', label: 'Belum ada paket' }, ...plans.map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (nonaktif)` }))]
  const company = C.field({ label: 'Perusahaan', id: `of-cu-company-${id}`, value: c.company || '', attrs: { maxlength: '120' } })
  const phone = C.field({ label: 'Telepon', id: `of-cu-phone-${id}`, value: c.phone || '', attrs: { maxlength: '30', inputmode: 'tel' } })
  const plan = C.select({ label: 'Paket', id: `of-cu-plan-${id}`, options: planOptions, value: c.plan_id ?? '' })
  const status = C.select({ label: 'Status', id: `of-cu-status-${id}`, value: c.status || 'trial', options: Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({ value, label })) })
  const end = C.field({ label: 'Berlaku sampai', id: `of-cu-end-${id}`, type: 'date', value: c.period_end || '' })
  const notes = C.textarea({ label: 'Catatan internal', id: `of-cu-notes-${id}`, rows: 4, value: c.notes || '', attrs: { maxlength: '2000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(c))
  const gather = () => ({
    plan_id: plan.input.value === '' ? null : Number(plan.input.value), status: status.input.value, period_end: end.input.value,
    company: company.input.value, phone: phone.input.value, notes: notes.input.value,
  })
  const base = JSON.stringify(gather())
  const dirty = () => JSON.stringify(gather()) !== base

  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: 'Kelola pelanggan', description: `${c.email}${c.name ? ` · ${c.name}` : ''}`, wide: true, opener, actions: [cancel, save],
    children: [el('div', { className: 'form-row' }, company.wrap, phone.wrap), el('div', { className: 'form-row' }, plan.wrap, status.wrap), end.wrap, notes.wrap, stamp, err, quotaSection(c, id)],
  })
  const touch = () => setDirty(dirty())
  form.addEventListener('input', touch)
  form.addEventListener('change', touch)
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validateCustomer(gather()) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await adminSaveCustomer(c.id, clean)
      close()
      showToast('Pelanggan tersimpan.', 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  let query = ''
  let timer
  const pg = C.pager({ label: 'daftar pelanggan', pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const search = C.field({ label: 'Cari pelanggan', id: 'of-cu-search', type: 'search', hint: 'Email, nama, atau perusahaan.', attrs: { maxlength: '100', autocomplete: 'off' } })
  const body = el('div', { 'aria-live': 'polite' })
  const panel = C.panel({ title: 'Pelanggan & mitra' }, search.wrap, body, pg.root)
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

  async function open(row, opener) {
    try {
      const [c, plans] = await Promise.all([adminGetCustomer(row.id), adminListPlans()])
      if (!ctx.signal.aborted) customerDialog(ctx, c, plans, opener, () => load(pg.page), setDirty)
    } catch (ex) { showToast(ex.message, 'error') }
  }

  async function load(page) {
    const mine = ++run
    body.replaceChildren(C.skeletonRows(4))
    let data
    try { data = await adminListCustomers({ q: query, page }) } catch (e) {
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
      body.replaceChildren(C.emptyState({ title: query ? 'Tidak ada yang cocok' : 'Belum ada pelanggan', body: query ? 'Coba kata kunci lain.' : 'Bisnis yang mendaftar akan muncul di sini.', iconName: 'sprout' }))
      return
    }
    body.replaceChildren(el('div', { className: 'of-cust-list' }, ...data.items.map((r) => {
      const b = el('button', { type: 'button', className: 'of-cust' },
        el('span', { className: 'of-cust-main' },
          el('strong', {}, r.email),
          el('span', { className: 'muted small' }, r.company || r.name || '—')),
        el('span', { className: 'of-cust-meta' },
          r.demo ? C.tag('Demo', 'neutral') : null,
          statusTag(r.status),
          el('span', { className: 'small' }, r.plan_name || 'Tanpa paket'),
          el('span', { className: 'muted small' }, r.period_end ? `s.d. ${C.formatDate(r.period_end)}` : '')))
      b.addEventListener('click', () => open(r, b))
      return b
    })))
  }
  load(1)
}

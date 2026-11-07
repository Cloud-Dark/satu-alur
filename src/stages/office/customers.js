import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListCustomers, adminGetCustomer, adminSaveCustomer, PAGE_SIZE } from '../../customers/api.js'
import { adminListPlans } from '../../business/api.js'
import { CUSTOMER_STATUS_LABEL, validateCustomer } from '../../customers/rules.js'
import { stampLine } from './site-landing.js'
import { LEAVE_MSG } from './site-doc.js'
import { adminCustomerQuota, adminGrantCredit } from '../../quota/api.js'
import { rupiah } from '../../quota/rules.js'
import { t } from '../../i18n/index.js'
import { featureLabel } from '../../quota/labels.js'

const { el } = C
const TONE = { trial: 'brand', active: 'ok', past_due: 'warn', cancelled: 'neutral' }
const statusLabel = (s) => (CUSTOMER_STATUS_LABEL[s] ? t(`office.customers.status.${s}`) : s)
const statusTag = (s) => (s ? C.tag(statusLabel(s), TONE[s]) : C.tag(t('office.customers.notSet'), 'neutral'))
let seq = 0
const REASON = ['voucher', 'staff', 'refund']

// AI usage this month, credit balance and a staff top-up. Loads on its own so the dialog opens at once.
function quotaSection(c, id) {
  const box = el('div', { className: 'of-cu-quota', 'aria-live': 'polite' }, C.skeletonRows(2))
  const amount = C.field({ label: t('office.customers.creditAmount'), id: `of-cu-credit-${id}`, type: 'number', hint: t('office.customers.creditHint'), attrs: { step: '1000' } })
  const note = C.field({ label: t('office.customers.reasonLabel'), id: `of-cu-credit-note-${id}`, attrs: { maxlength: '200' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const apply = C.button({ label: t('office.customers.applyCredit'), icon: 'wallet', variant: 'soft', size: 'sm' })
  const drawQuota = (q) => box.replaceChildren(
    el('p', { className: 'small' }, t(q.demo ? 'office.customers.activePlanDemo' : 'office.customers.activePlan', { plan: q.plan.name }), el('strong', { className: 'tnum' }, rupiah(q.credit_idr))),
    el('ul', { className: 'of-cu-usage small' }, ...q.usage.map((u) => el('li', {}, `${featureLabel(u.key, u.label)}: `, el('span', { className: 'tnum' }, u.limit === null ? t('office.customers.unlimitedUsed', { used: u.used }) : `${u.used} / ${u.limit}`)))),
    q.entries?.length
      ? el('ul', { className: 'of-cu-entries muted small' }, ...q.entries.slice(0, 5).map((e) => el('li', {},
        `${C.formatDateTime(e.created_at)} · ${t(`office.customers.reason.${REASON.includes(e.reason) ? e.reason : 'usage'}`)} · `, el('span', { className: 'tnum' }, `${e.amount_idr > 0 ? '+' : '−'}${rupiah(Math.abs(e.amount_idr))}`), e.ref ? ` · ${e.ref}` : '')))
      : '')
  adminCustomerQuota(c.id).then(drawQuota).catch((ex) => box.replaceChildren(C.errorState(ex.message)))
  apply.addEventListener('click', async () => {
    err.textContent = ''
    const n = Number(amount.input.value)
    if (!Number.isInteger(n) || n === 0) { err.textContent = t('office.customers.creditInvalid'); return }
    const restore = C.setBusy(apply, t('office.common.saving'))
    try {
      drawQuota(await adminGrantCredit(c.id, n, note.input.value.trim()))
      amount.input.value = ''
      note.input.value = ''
      showToast(t('office.customers.creditUpdated'), 'success')
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  return el('section', { className: 'of-cu-quota-wrap' },
    el('h3', { className: 'field-label' }, t('office.customers.quotaTitle')), box,
    el('div', { className: 'form-row' }, amount.wrap, note.wrap), err, el('div', { className: 'form-actions' }, apply))
}

function customerDialog(ctx, c, plans, opener, onSaved, setDirty) {
  const id = ++seq
  const planOptions = [{ value: '', label: t('office.customers.noPlanYet') }, ...plans.map((p) => ({ value: p.id, label: p.active ? p.name : t('office.common.inactiveSuffix', { name: p.name }) }))]
  const company = C.field({ label: t('office.customers.company'), id: `of-cu-company-${id}`, value: c.company || '', attrs: { maxlength: '120' } })
  const phone = C.field({ label: t('office.customers.phone'), id: `of-cu-phone-${id}`, value: c.phone || '', attrs: { maxlength: '30', inputmode: 'tel' } })
  const plan = C.select({ label: t('office.customers.plan'), id: `of-cu-plan-${id}`, options: planOptions, value: c.plan_id ?? '' })
  const status = C.select({ label: t('office.common.status'), id: `of-cu-status-${id}`, value: c.status || 'trial', options: Object.keys(CUSTOMER_STATUS_LABEL).map((value) => ({ value, label: statusLabel(value) })) })
  const end = C.field({ label: t('office.customers.validUntil'), id: `of-cu-end-${id}`, type: 'date', value: c.period_end || '' })
  const notes = C.textarea({ label: t('office.common.internalNote'), id: `of-cu-notes-${id}`, rows: 4, value: c.notes || '', attrs: { maxlength: '2000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(c))
  const gather = () => ({
    plan_id: plan.input.value === '' ? null : Number(plan.input.value), status: status.input.value, period_end: end.input.value,
    company: company.input.value, phone: phone.input.value, notes: notes.input.value,
  })
  const base = JSON.stringify(gather())
  const dirty = () => JSON.stringify(gather()) !== base

  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('office.common.cancel'), variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: t('office.customers.manage'), description: `${c.email}${c.name ? ` · ${c.name}` : ''}`, wide: true, opener, actions: [cancel, save],
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
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      await adminSaveCustomer(c.id, clean)
      close()
      showToast(t('office.customers.saved'), 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  let query = ''
  let timer
  const pg = C.pager({ label: t('office.customers.pagerLabel'), pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const search = C.field({ label: t('office.customers.search'), id: 'of-cu-search', type: 'search', hint: t('office.customers.searchHint'), attrs: { maxlength: '100', autocomplete: 'off' } })
  const body = el('div', { 'aria-live': 'polite' })
  const panel = C.panel({ title: t('office.menu.customers') }, search.wrap, body, pg.root)
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
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
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
      body.replaceChildren(C.emptyState({ title: query ? t('office.common.noMatch') : t('office.customers.empty'), body: query ? t('office.common.tryOther') : t('office.common.signupsAppear'), iconName: 'sprout' }))
      return
    }
    body.replaceChildren(el('div', { className: 'of-cust-list' }, ...data.items.map((r) => {
      const b = el('button', { type: 'button', className: 'of-cust' },
        el('span', { className: 'of-cust-main' },
          el('strong', {}, r.email),
          el('span', { className: 'muted small' }, r.company || r.name || '—')),
        el('span', { className: 'of-cust-meta' },
          r.demo ? C.tag(t('office.common.demo'), 'neutral') : null,
          statusTag(r.status),
          el('span', { className: 'small' }, r.plan_name || t('office.customers.noPlan')),
          el('span', { className: 'muted small' }, r.period_end ? t('office.customers.until', { date: C.formatDate(r.period_end) }) : '')))
      b.addEventListener('click', () => open(r, b))
      return b
    })))
  }
  load(1)
}

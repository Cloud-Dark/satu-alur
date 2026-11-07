import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListVouchers, adminCreateVoucher, adminUpdateVoucher, adminListRedemptions } from '../../quota/api.js'
import { adminListPlans } from '../../business/api.js'
import { validateVoucher, voucherValue, VOUCHER_TYPE_LABEL, MAX_VOUCHER_CREDIT, rupiah, todayWib } from '../../quota/rules.js'
import { LEAVE_MSG } from './site-doc.js'
import { t } from '../../i18n/index.js'

const { el } = C
// VOUCHER_TYPE_LABEL lives in quota/rules.js (shared with the Worker): translate by key.
const typeLabel = (v) => (VOUCHER_TYPE_LABEL[v] ? t(`plan.voucherType.${v}`) : v)
const TYPE_OPTIONS = Object.keys(VOUCHER_TYPE_LABEL).map((value) => ({ value, label: typeLabel(value) }))
let seq = 0

function status(v, today) {
  if (!v.active) return C.tag(t('office.common.inactive'), 'neutral')
  if (v.expires_on && v.expires_on < today) return C.tag(t('office.vouchers.expired'), 'warn')
  if (v.max_redemptions !== null && v.redeemed_count >= v.max_redemptions) return C.tag(t('office.vouchers.usedUp'), 'warn')
  return C.tag(t('office.common.active'), 'ok')
}

function voucherDialog(plans, opener, onSaved, setDirty) {
  const id = ++seq
  const type = C.select({ label: t('office.vouchers.type'), id: `of-vc-type-${id}`, options: TYPE_OPTIONS, value: 'plan' })
  const code = C.field({ label: t('office.vouchers.code'), id: `of-vc-code-${id}`, hint: t('office.vouchers.codeHint'), attrs: { maxlength: '32', autocomplete: 'off', spellcheck: 'false' } })
  const plan = C.select({ label: t('office.customers.plan'), id: `of-vc-plan-${id}`, options: plans.map((p) => ({ value: String(p.id), label: p.name })), value: String((plans.find((p) => p.slug === 'pro') || plans[0])?.id ?? '') })
  const days = C.field({ label: t('office.vouchers.days'), id: `of-vc-days-${id}`, type: 'number', value: '30', attrs: { min: '1', max: '366', step: '1' } })
  const credit = C.field({ label: t('office.vouchers.credit'), id: `of-vc-credit-${id}`, type: 'number', value: '50000', hint: t('office.vouchers.creditHint', { max: rupiah(MAX_VOUCHER_CREDIT) }), attrs: { min: '1000', step: '1000' } })
  const max = C.field({ label: t('office.vouchers.max'), id: `of-vc-max-${id}`, type: 'number', value: '20', hint: t('office.plans.unlimitedHint'), attrs: { min: '1', step: '1' } })
  const exp = C.field({ label: t('office.customers.validUntil'), id: `of-vc-exp-${id}`, type: 'date', hint: t('office.vouchers.noExpiryHint') })
  const note = C.field({ label: t('office.common.internalNote'), id: `of-vc-note-${id}`, hint: t('office.vouchers.noteHint'), attrs: { maxlength: '200' } })
  const planRow = el('div', { className: 'form-row' }, plan.wrap, days.wrap)
  const err = el('p', { className: 'field-error', role: 'alert' })
  const sync = () => {
    planRow.hidden = type.input.value === 'credit'
    credit.wrap.hidden = type.input.value === 'plan'
  }
  type.input.addEventListener('change', sync)
  sync()

  const gather = () => ({
    type: type.input.value, code: code.input.value, plan_id: Number(plan.input.value), plan_days: Number(days.input.value),
    credit_idr: Number(credit.input.value), max_redemptions: max.input.value.trim() === '' ? null : Number(max.input.value),
    expires_on: exp.input.value || null, note: note.input.value,
  })
  const save = C.button({ label: t('office.vouchers.create'), icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('office.common.cancel'), variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: t('office.vouchers.create'), opener, actions: [cancel, save],
    description: t('office.vouchers.dialogDesc'),
    children: [type.wrap, code.wrap, planRow, credit.wrap, el('div', { className: 'form-row' }, max.wrap, exp.wrap), note.wrap, err],
  })
  const base = JSON.stringify(gather())
  const dirty = () => JSON.stringify(gather()) !== base
  form.addEventListener('input', () => setDirty(dirty()))
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validateVoucher(gather(), plans.map((p) => p.id)) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      const v = await adminCreateVoucher(clean)
      close()
      showToast(t('office.vouchers.created', { code: v.code }), 'success')
      onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  async function load() {
    const mine = ++run
    setDirty(false)
    host.replaceChildren(C.panel({ title: t('office.menu.vouchers') }, C.skeletonRows(4)))
    let rows; let plans; let reds
    try {
      [rows, plans, reds] = await Promise.all([adminListVouchers(), adminListPlans(), adminListRedemptions()])
    } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', load)
      host.replaceChildren(C.panel({ title: t('office.menu.vouchers') }, C.errorState(e.message), again))
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    const today = todayWib()
    const planName = (pid) => plans.find((p) => p.id === pid)?.name || t('office.customers.plan')
    const add = C.button({ label: t('office.vouchers.create'), icon: 'plus', variant: 'primary', size: 'sm', disabled: !plans.length })
    add.addEventListener('click', () => voucherDialog(plans, add, () => { if (!ctx.signal.aborted) load() }, setDirty))

    const toggle = (v) => {
      const b = C.button({ label: v.active ? t('office.common.deactivate') : t('office.common.activate'), variant: v.active ? 'ghost' : 'soft', size: 'sm', 'aria-label': `${v.active ? t('office.common.deactivate') : t('office.common.activate')} ${v.code}` })
      b.addEventListener('click', async () => {
        const restore = C.setBusy(b, t('office.common.saving'))
        try {
          await adminUpdateVoucher(v.id, { active: v.active ? 0 : 1 })
          showToast(v.active ? t('office.vouchers.deactivated', { code: v.code }) : t('office.vouchers.reactivated', { code: v.code }), 'success')
          if (!ctx.signal.aborted) load()
        } catch (ex) { restore(); showToast(ex.message, 'error') }
      })
      return b
    }
    const list = rows.length
      ? C.paginate({ key: 'office-vouchers', label: t('office.vouchers.pagerLabel'), pageSize: 10, items: rows, render: (pageRows) => C.dataTable({
        caption: t('office.vouchers.list'),
        columns: [
          { label: t('office.vouchers.code'), render: (v) => C.cellStack(el('span', { className: 'of-voucher-code' }, v.code), v.note || null) },
          { label: t('office.vouchers.typeCol'), render: (v) => typeLabel(v.type) },
          { label: t('office.vouchers.value'), render: (v) => voucherValue(v, planName) },
          { label: t('office.vouchers.redeemed'), align: 'right', render: (v) => el('span', { className: 'tnum' }, `${v.redeemed_count}${v.max_redemptions !== null ? ` / ${v.max_redemptions}` : ''}`) },
          { label: t('office.customers.validUntil'), render: (v) => (v.expires_on ? C.formatDate(v.expires_on) : t('office.vouchers.noLimit')) },
          { label: t('office.common.status'), render: (v) => status(v, today) },
          { label: t('office.common.action'), render: toggle },
        ],
        rows: pageRows,
        rowAttrs: (v) => ({ dataset: { code: v.code } }),
      }) }).root
      : C.emptyState({ title: t('office.vouchers.empty'), body: t('office.vouchers.emptyBody'), iconName: 'sprout' })

    const redList = reds.length
      ? C.paginate({ key: 'office-redemptions', label: t('office.vouchers.redPager'), pageSize: 10, items: reds, render: (pageRows) => C.dataTable({
        caption: t('office.vouchers.redCaption'),
        columns: [
          { label: t('office.common.time'), render: (r) => C.formatDateTime(r.redeemed_at) },
          { label: t('office.vouchers.code'), render: (r) => el('span', { className: 'of-voucher-code' }, r.code) },
          { label: t('office.menu.users'), render: (r) => C.cellStack(r.name || r.email, r.name ? r.email : null) },
          { label: t('office.vouchers.business'), render: (r) => C.cellStack(r.company || null, r.phone || null) },
          { label: t('office.vouchers.followUp'), render: (r) => (r.email ? el('a', { className: 'btn btn-ghost btn-sm', href: `mailto:${r.email}?subject=${encodeURIComponent('Voucher Satu Alur')}` }, 'Email') : null) },
        ],
        rows: pageRows,
      }) }).root
      : C.emptyState({ title: t('office.vouchers.noReds'), body: t('office.vouchers.noRedsBody'), iconName: 'inbox' })

    host.replaceChildren(
      C.panel({ title: t('office.menu.vouchers'), meta: t('office.vouchers.count', { count: rows.length }), actions: add },
        el('p', { className: 'muted small' }, t('office.vouchers.lead')),
        list),
      C.panel({ title: t('office.vouchers.recent'), meta: t('office.vouchers.redemptions', { count: reds.length }) }, redList))
  }
  load()
}

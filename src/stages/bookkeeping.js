/**
 * 05 — Pembukuan: post revenue and cost entries for one completed job
 * (#/app/pembukuan?penyelesaian=<id>), with that job's journal below. Every job is listed in
 * Alur kerja; the totals of all jobs are in Laporan.
 */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel, LEDGER_CATEGORIES, categoryLabel, isRevenue, ledgerDate, totals } from './data.js'
import { jobHeader, solo, pickFromWorkflow, workflowLink } from './job.js'
import { t, has, locale } from '../i18n/index.js'

// Category labels live in domain/model.js (shared with the worker); translate by value.
const catLabel = (c) => (has(`bookkeeping.category.${c}`) ? t(`bookkeeping.category.${c}`) : categoryLabel(c))

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}
  if (params.completionId == null) {
    container.replaceChildren(C.pageHeader({ title: t('bookkeeping.title') }),
      pickFromWorkflow(navigate, { filter: 'book', body: t('bookkeeping.pickBody') }))
    return
  }

  const complSel = C.select({ label: t('bookkeeping.form.job'), name: 'completion_id', required: true, hint: t('bookkeeping.form.jobHint'), options: [{ value: '', label: t('bookkeeping.loading') }] })
  const preview = el('div', { hidden: true })
  const ctxBox = el('div', {})
  const category = C.select({ label: t('bookkeeping.form.category'), name: 'category', required: true, options: [{ value: '', label: t('bookkeeping.form.chooseCategory') }, ...LEDGER_CATEGORIES.map((c) => ({ ...c, label: catLabel(c.value) }))] })
  const amount = C.field({ label: t('bookkeeping.form.amount'), name: 'amount', type: 'number', required: true, placeholder: '1500000', attrs: { min: '1', step: '1', inputmode: 'numeric' } })
  // Optional link to a VAS catalog item: this is what makes "Porsi VAS" measurable
  // instead of a guess. Only revenue entries can carry it.
  const vasSel = C.select({
    label: t('bookkeeping.form.vas'), name: 'vas_item_id',
    hint: t('bookkeeping.form.vasHint'),
    options: [{ value: '', label: t('bookkeeping.form.notVas') }],
  })
  vasSel.wrap.hidden = true
  let vasItems = null
  async function ensureVasOptions() {
    if (vasItems) return
    const { data, error } = await getCloud().database.from('vas_items').select('id,name,status')
    if (error) { msg.show('danger', t('bookkeeping.form.vasError', { error: error.message })); return }
    if (ctx.signal?.aborted) return
    vasItems = (data || []).filter((v) => v.status === 'active')
    C.setOptions(vasSel.input, [
      { value: '', label: t('bookkeeping.form.notVas') },
      ...vasItems.map((v) => ({ value: v.id, label: v.name })),
    ], vasSel.input.value)
  }
  const fillBtn = el('button', { type: 'button', className: 'link-btn', hidden: true }, '')
  amount.wrap.appendChild(fillBtn)
  const reviewBox = el('div', { className: 'proposal' })

  const summary = el('div', { className: 'kpis kpis-3' })
  const listBody = el('div', {}, C.skeletonRows(6))
  const listPanel = C.panel({ title: t('bookkeeping.list.title'), meta: t('bookkeeping.list.loading'), className: 'list-panel' }, summary, listBody)
  const headSlot = el('div', {})

  let flow = null
  const selected = () => flow?.completion(complSel.input.value) || null
  const amountValue = () => Number(amount.input.value)
  // One revenue entry per completion; costs can be posted as many times as needed.
  const revenueTaken = () => {
    const c = selected()
    return Boolean(c && category.input.value === 'pendapatan' && flow?.ledgerOf(c.id).some(isRevenue))
  }

  const wiz = C.wizard({
    label: t('bookkeeping.wiz.label'),
    steps: [
      {
        key: 'pick',
        title: t('bookkeeping.wiz.pick'),
        description: t('bookkeeping.wiz.pickDesc'),
        content: [complSel.wrap, preview],
        validate: () => (selected() ? [] : [{ text: t('bookkeeping.error.pick'), input: complSel.input }]),
        primary: () => ({ disabled: !flow?.completions.length }),
      },
      {
        key: 'entry',
        title: t('bookkeeping.wiz.entry'),
        description: t('bookkeeping.wiz.entryDesc'),
        content: [ctxBox, category.wrap, vasSel.wrap, amount.wrap],
        validate: () => {
          const errs = []
          if (!category.input.value) errs.push({ text: t('bookkeeping.error.category'), input: category.input })
          const amt = amountValue()
          if (!amount.input.value || !Number.isFinite(amt) || amt <= 0) errs.push({ text: t('bookkeeping.error.amount'), input: amount.input })
          if (revenueTaken()) errs.push({ text: t('bookkeeping.error.revenueTakenLong'), input: category.input })
          return errs
        },
        onEnter: () => drawContext(),
      },
      {
        key: 'review',
        title: t('bookkeeping.wiz.review'),
        description: t('bookkeeping.wiz.reviewDesc'),
        content: reviewBox,
        primary: { label: t('bookkeeping.wiz.label'), icon: 'ledger', iconRight: undefined },
        validate: () => {
          const errs = []
          if (!selected()) errs.push(t('bookkeeping.error.pick'))
          if (!category.input.value) errs.push(t('bookkeeping.error.category'))
          if (!(amountValue() > 0)) errs.push(t('bookkeeping.error.amount'))
          if (revenueTaken()) errs.push(t('bookkeeping.error.revenueTaken'))
          return errs
        },
        onPrimary: () => save(),
        onEnter: () => drawReview(),
      },
    ],
  })
  const msg = wiz.msg

  container.replaceChildren(
    C.pageHeader({ title: t('bookkeeping.title') }),
    solo(headSlot, wiz.root, listPanel, workflowLink(navigate)),
  )

  const offerPrice = (c) => Number(flow?.offerOfCompletion(c)?.validated_price) || 0

  const completionPreview = (c) => {
    const n = flow.ledgerOf(c.id).length
    const a = flow.assignmentOfCompletion(c)
    return C.miniPreview({
      title: customerLabel(flow.requestOfCompletion(c)),
      aside: C.rupiah(offerPrice(c)),
      chips: [
        a?.worker_name ? { icon: 'users', text: a.worker_name } : null,
        { icon: 'calendar', text: C.formatDate(c.completed_at || c.created_at), title: t('bookkeeping.preview.doneDate') },
        { icon: 'ledger', text: n ? t('bookkeeping.entries', { count: n }) : t('bookkeeping.notBooked') },
      ],
    })
  }

  function syncFill() {
    const c = selected()
    const price = c ? offerPrice(c) : 0
    if (c && price && category.input.value === 'pendapatan') {
      fillBtn.textContent = t('bookkeeping.form.fillOffer', { price: C.rupiah(price) })
      fillBtn.hidden = false
    } else {
      fillBtn.hidden = true
    }
  }
  fillBtn.addEventListener('click', () => {
    const c = selected()
    if (c) {
      amount.input.value = String(offerPrice(c))
      amount.input.dispatchEvent(new Event('input'))
      amount.input.focus()
    }
  })
  complSel.input.addEventListener('change', () => { msg.hide(); syncFill(); showPreview() })
  category.input.addEventListener('change', () => {
    syncFill()
    const revenue = category.input.value === 'pendapatan'
    vasSel.wrap.hidden = !revenue
    if (revenue) ensureVasOptions()
    else vasSel.input.value = ''
    if (revenue && !amount.input.value) {
      const c = selected()
      if (c && offerPrice(c)) amount.input.value = String(offerPrice(c))
    }
  })

  function showPreview() {
    const c = selected()
    if (!c) { preview.hidden = true; return }
    preview.replaceChildren(completionPreview(c))
    preview.hidden = false
  }

  function drawContext() {
    const c = selected()
    ctxBox.replaceChildren(c ? completionPreview(c) : '')
    syncFill()
  }

  function drawReview() {
    const c = selected()
    if (!c) { reviewBox.replaceChildren(); return }
    const rev = isRevenue({ category: category.input.value })
    const amt = amountValue()
    reviewBox.replaceChildren(
      el('dl', { className: 'sum-grid' },
        el('div', { className: 'is-wide' }, el('dt', {}, t('bookkeeping.review.job')), el('dd', {}, customerLabel(flow.requestOfCompletion(c)))),
        el('div', {}, el('dt', {}, t('bookkeeping.form.category')), el('dd', {}, catLabel(category.input.value))),
        el('div', {}, el('dt', {}, rev ? t('bookkeeping.col.in') : t('bookkeeping.col.out')), el('dd', {}, el('span', { className: `tnum strong ${rev ? 'amt-in' : 'amt-out'}` }, `${rev ? '+' : '−'}${C.rupiah(amt)}`))),
        el('div', {}, el('dt', {}, t('bookkeeping.review.offerValue')), el('dd', {}, el('span', { className: 'tnum' }, C.rupiah(offerPrice(c))))),
        el('div', {}, el('dt', {}, t('bookkeeping.review.previous')), el('dd', {}, String(flow.ledgerOf(c.id).length))),
      ),
    )
  }

  let firstFill = true
  function fillCompletions() {
    // Only this job.
    const all = flow.completions.filter((c) => String(c.id) === String(params.completionId))
    const unbooked = all.filter((c) => !flow.ledgerOf(c.id).length)
    const booked = all.filter((c) => flow.ledgerOf(c.id).length)
    const label = (c) => `${customerLabel(flow.requestOfCompletion(c))} — ${C.rupiah(offerPrice(c))}`
    const opts = [{ value: '', label: all.length ? t('bookkeeping.form.chooseJob') : t('bookkeeping.form.noJobs') }]
    unbooked.forEach((c) => opts.push({ value: c.id, label: label(c) }))
    booked.forEach((c) => opts.push({ value: c.id, label: `${label(c)} (${t('bookkeeping.entries', { count: flow.ledgerOf(c.id).length })})` }))
    const keep = complSel.input.value || (firstFill && params.completionId != null ? String(params.completionId) : '')
    C.setOptions(complSel.input, opts, keep)
    if (!all.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', t('bookkeeping.notFound'))
      const go = C.button({ label: t('bookkeeping.toWorkflow'), iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('workflow'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    syncFill()
    showPreview()
    wiz.syncPrimary()
    if (firstFill && params.completionId != null && selected()) wiz.go('entry', { focus: false, animate: false })
    firstFill = false
  }

  async function save() {
    const c = selected()
    const amt = amountValue()
    const restore = wiz.busy(t('bookkeeping.posting'))
    try {
      const { error } = await getCloud().database.from('ledger_entries').insert({
        completion_id: Number(c.id),
        vas_item_id: category.input.value === 'pendapatan' && vasSel.input.value ? Number(vasSel.input.value) : null,
        amount: Math.round(amt),
        category: category.input.value,
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      restore()
      const catText = catLabel(category.input.value)
      const clearEntry = () => {
        amount.input.value = ''
        category.input.value = ''
        category.input.dispatchEvent(new Event('change'))
      }
      const more = C.button({ label: t('bookkeeping.done.more'), icon: 'plus', size: 'sm', variant: 'primary' })
      more.addEventListener('click', () => { clearEntry(); wiz.reset({ to: 1 }) })
      const other = C.button({ label: t('bookkeeping.done.other'), icon: 'activity', size: 'sm', variant: 'soft' })
      other.addEventListener('click', () => navigate('workflow', { filter: 'book' }))
      const report = C.button({ label: t('bookkeeping.done.report'), iconRight: 'arrowRight', size: 'sm', variant: 'ghost' })
      report.addEventListener('click', () => navigate('report'))
      const bill = C.button({ label: t('bookkeeping.done.invoice'), icon: 'receipt', size: 'sm', variant: 'soft' })
      bill.addEventListener('click', () => navigate('invoice', { completionId: c.id }))
      wiz.complete({ text: t('bookkeeping.done.text', { category: catText, amount: C.rupiah(amt), name: customerLabel(flow.requestOfCompletion(c)) }), actions: [more, other, bill, report] })
      showToast(t('bookkeeping.done.toast'), 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      msg.show('danger', t('bookkeeping.postError', { error: err.message }))
    }
  }

  async function loadList() {
    try {
      flow = await loadFlow()
    } catch (err) {
      listBody.replaceChildren(C.errorState(t('bookkeeping.loadError', { error: err.message })))
      return
    }
    if (ctx.signal?.aborted) return
    const c = flow.completion(params.completionId)
    const r = c ? flow.requestOfCompletion(c) : null
    const n = c ? flow.ledgerOf(c.id).length : 0
    headSlot.replaceChildren(r ? jobHeader(r, { tag: n ? C.tag(t('bookkeeping.booked'), 'ok') : C.tag(t('bookkeeping.notBooked'), 'warn'), note: t('bookkeeping.offerValueNote', { price: C.rupiah(offerPrice(c)) }) }) : '')
    fillCompletions()
    drawList()
  }

  function drawList() {
    const job = flow.completion(params.completionId)
    const ledger = job ? flow.ledgerOf(job.id) : []
    const sum = totals(ledger)
    summary.replaceChildren(
      C.kpi({ label: t('bookkeeping.kpi.revenue'), iconName: 'wallet', value: C.rupiah(sum.revenue) }),
      C.kpi({ label: t('bookkeeping.kpi.cost'), iconName: 'receipt', value: C.rupiah(sum.cost) }),
      C.kpi({ label: sum.profit >= 0 ? t('bookkeeping.kpi.profit') : t('bookkeeping.kpi.loss'), iconName: 'sprout', value: C.rupiah(sum.profit), sub: sum.revenue > 0 ? t('bookkeeping.kpi.margin', { pct: ((sum.profit / sum.revenue) * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : t('bookkeeping.kpi.marginNone'), tone: sum.revenue > 0 ? (sum.profit >= 0 ? 'ok' : 'danger') : null }),
    )
    listPanel.querySelector('.panel-meta').textContent = t('bookkeeping.entries', { count: ledger.length })

    if (!ledger.length) {
      listBody.replaceChildren(C.emptyState({ kicker: t('bookkeeping.list.emptyKicker'), title: t('bookkeeping.list.emptyTitle'), body: t('bookkeeping.list.emptyBody') }))
      return
    }
    // Running balance, oldest first; displayed newest first.
    const asc = [...ledger].sort((a, b) => (C.toDate(ledgerDate(a)) || 0) - (C.toDate(ledgerDate(b)) || 0) || (Number(a.id) - Number(b.id)))
    let bal = 0
    const balance = new Map()
    for (const l of asc) {
      bal += isRevenue(l) ? Number(l.amount) || 0 : -(Number(l.amount) || 0)
      balance.set(l, bal)
    }
    const rows = asc.reverse()
    listBody.replaceChildren(C.dataTable({
      caption: t('bookkeeping.list.title'),
      rows,
      columns: [
        { label: t('bookkeeping.col.date'), className: 'col-date', render: (l) => el('time', { className: 'tnum', datetime: ledgerDate(l) || '', title: C.formatDateTime(ledgerDate(l)) }, C.formatDate(ledgerDate(l))) },
        { label: t('bookkeeping.col.desc'), render: (l) => C.cellStack(customerLabel(flow.requestOfLedger(l)), catLabel(l.category)) },
        { label: t('bookkeeping.col.in'), align: 'right', render: (l) => (isRevenue(l) ? el('span', { className: 'tnum amt-in' }, `+${C.rupiah(l.amount)}`) : el('span', { className: 'muted nil' }, '—')) },
        { label: t('bookkeeping.col.out'), align: 'right', render: (l) => (!isRevenue(l) ? el('span', { className: 'tnum amt-out' }, `−${C.rupiah(l.amount)}`) : el('span', { className: 'muted nil' }, '—')) },
        { label: t('bookkeeping.col.balance'), align: 'right', render: (l) => { const b = balance.get(l); return el('span', { className: `tnum strong ${b < 0 ? 'amt-neg' : ''}` }, C.rupiah(b)) } },
      ],
    }))
  }

  await loadList()
}

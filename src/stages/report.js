/** 06 — Laporan: period figures computed from the ledger + AI explanation. */
import { sendBusinessEmail } from '../integrations/api.js'
import * as C from '../ui/components.js'
import { explainReport } from '../ai/agent.js'
import { showToast } from '../ui/animations.js'
import { resolveModel, abortable } from './offer.js'
import { loadFlow, totals, ledgerDate, isRevenue, categoryLabel, customerLabel, customerKey, localDate } from './data.js'
import { t, has, locale } from '../i18n/index.js'

const catLabel = (c) => (has(`bookkeeping.category.${c}`) ? t(`bookkeeping.category.${c}`) : categoryLabel(c))

const { el } = C
const DAY = 86400000

const PERIODS = [
  { value: '30d' },
  { value: 'month' },
  { value: 'prev' },
  { value: 'all' },
]

const monthName = (d) => d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })

/** Returns { from, to, label, prev: {from,to,label}|null } as Date objects. */
export function periodRange(kind, now = new Date(), ledger = []) {
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0)
  const tomorrow = new Date(startToday.getTime() + DAY)
  if (kind === '30d') {
    const from = new Date(tomorrow.getTime() - 30 * DAY)
    const pf = new Date(from.getTime() - 30 * DAY)
    return { from, to: tomorrow, label: `${C.formatDate(from)} – ${C.formatDate(startToday)}`, prev: { from: pf, to: from, label: t('report.period.prev30') } }
  }
  if (kind === 'month' || kind === 'prev') {
    const offset = kind === 'month' ? 0 : -1
    const from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
    const pf = new Date(now.getFullYear(), now.getMonth() + offset - 1, 1)
    return { from, to: kind === 'month' ? tomorrow : to, label: monthName(from), prev: { from: pf, to: from, label: monthName(pf) } }
  }
  const dates = ledger.map((l) => C.toDate(ledgerDate(l))).filter(Boolean).sort((a, b) => a - b)
  const from = dates[0] || startToday
  return { from, to: tomorrow, label: dates.length ? `${C.formatDate(from)} – ${C.formatDate(dates[dates.length - 1])}` : t('report.period.noData'), prev: null }
}

const inRange = (l, r) => { const t = C.toDate(ledgerDate(l))?.getTime(); return t != null && t >= r.from.getTime() && t < r.to.getTime() }

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  let period = '30d'

  const seg = C.segmented({ label: t('report.period.aria'), value: period, options: PERIODS.map((p) => ({ ...p, label: t(`report.period.${p.value}`) })), onChange: (v) => { period = v; draw() } })
  const periodLine = el('p', { className: 'period-line' }, C.icon('calendar', { size: 15 }), el('span', {}, t('report.loading')))
  const kpis = el('div', { className: 'kpis' }, [0, 1, 2, 3].map((i) => el('div', { className: `kpi ${i === 0 ? 'is-hero' : ''}`.trim() }, C.skeleton({ lines: 2 }))))
  const catBody = el('div', {}, C.skeletonRows(4))
  const custBody = el('div', {}, C.skeletonRows(4))
  const catPanel = C.panel({ title: t('report.cat.title'), meta: '—', className: 'span-7' }, catBody)
  const custPanel = C.panel({ title: t('report.cust.title'), meta: t('report.cust.meta'), className: 'span-5' }, custBody)

  const explainBtn = C.button({ label: t('report.ai.explain'), icon: 'sparkles', variant: 'primary' })
  const mailBtn = C.button({ label: t('report.mail.button'), icon: 'mail', variant: 'soft', disabled: true })
  let lastExplanation = ''
  const modelNote = el('span', { className: 'model-note', hidden: true })
  const msg = C.message()
  const aiOut = el('div', { className: 'report-ai-out' })
  const aiPanel = C.panel({ title: t('report.ai.title'), meta: t('report.ai.meta'), raised: true, className: 'ai-panel' },
    el('p', { className: 'panel-lead' }, t('report.ai.lead')),
    el('div', { className: 'form-actions' }, explainBtn, mailBtn, modelNote),
    msg,
    aiOut,
  )

  container.replaceChildren(
    C.pageHeader({ title: t('report.title'), actions: seg }),
    periodLine,
    kpis,
    el('div', { className: 'dash-grid is-stretch' }, catPanel, custPanel),
    aiPanel,
  )

  let model = null
  const modelReady = resolveModel()
    .then((m) => { model = m; if (!m) { modelNote.textContent = t('report.ai.unavailableShort'); modelNote.hidden = false } })
    .catch((err) => { modelNote.textContent = t('report.ai.unavailableShort'); modelNote.hidden = false })

  let flow
  try {
    flow = await loadFlow()
  } catch (err) {
    kpis.replaceChildren(C.errorState(t('report.loadError', { error: err.message })))
    return
  }
  if (ctx.signal?.aborted) return

  let report = null

  function draw() {
    const r = periodRange(period, new Date(), flow.ledger)
    const entries = flow.ledger.filter((l) => inRange(l, r))
    const tot = totals(entries)
    const prevT = r.prev ? totals(flow.ledger.filter((l) => inRange(l, r.prev))) : null
    const margin = tot.revenue > 0 ? (tot.profit / tot.revenue) * 100 : null

    periodLine.lastChild.textContent = t('report.period.line', { label: r.label, count: entries.length }) + (r.prev ? t('report.period.compare', { label: r.prev.label }) : '')

    const cmp = (cur, prev, invert = false) => {
      if (!prevT || !(prev > 0)) return { sub: prevT ? `${r.prev.label}: ${C.rupiah(prev || 0)}` : null, tone: null }
      const pct = ((cur - prev) / prev) * 100
      const good = invert ? pct < 0 : pct > 0
      return { sub: `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toLocaleString(locale(), { maximumFractionDigits: 1 })}% vs ${r.prev.label}`, tone: pct === 0 ? null : good ? 'ok' : 'danger' }
    }
    const cRev = cmp(tot.revenue, prevT?.revenue)
    const cCost = cmp(tot.cost, prevT?.cost, true)
    const cProfit = cmp(tot.profit, prevT?.profit)
    kpis.replaceChildren(
      C.kpi({ label: t('report.kpi.profit'), hero: true, iconName: 'sprout', value: C.rupiah(tot.profit), countTo: tot.profit, format: C.rupiah, sub: cProfit.sub, tone: cProfit.tone }),
      C.kpi({ label: t('report.kpi.revenue'), iconName: 'wallet', value: C.rupiah(tot.revenue), countTo: tot.revenue, format: C.rupiah, sub: cRev.sub, tone: cRev.tone }),
      C.kpi({ label: t('report.kpi.cost'), iconName: 'receipt', value: C.rupiah(tot.cost), countTo: tot.cost, format: C.rupiah, sub: cCost.sub, tone: cCost.tone }),
      C.kpi({ label: t('report.kpi.margin'), iconName: 'activity', value: margin == null ? '—' : `${margin.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`, sub: margin == null ? t('report.kpi.noRevenue') : t('report.kpi.costShare', { pct: Math.round((tot.cost / tot.revenue) * 100) }) }),
    )

    // Categories
    const byCat = new Map()
    for (const l of entries) {
      const cur = byCat.get(l.category) || { amount: 0, n: 0 }
      cur.amount += Number(l.amount) || 0
      cur.n += 1
      byCat.set(l.category, cur)
    }
    const cats = [...byCat.entries()].map(([cat, v]) => ({ cat, ...v })).sort((a, b) => (a.cat === 'pendapatan' ? -1 : b.cat === 'pendapatan' ? 1 : b.amount - a.amount))
    catPanel.querySelector('.panel-meta').textContent = t('report.cat.count', { count: cats.length })
    const max = Math.max(1, ...cats.map((c) => c.amount))
    catBody.replaceChildren(cats.length
      ? C.dataTable({
          caption: t('report.cat.title'),
          rows: cats,
          columns: [
            { label: t('report.cat.category'), render: (c) => el('span', { className: c.cat === 'pendapatan' ? 'strong' : '' }, catLabel(c.cat)) },
            { label: t('report.cat.entries'), align: 'right', render: (c) => el('span', { className: 'tnum' }, String(c.n)) },
            { label: t('report.cat.share'), className: 'col-bar', render: (c) => el('span', { className: `bars-track ${c.cat === 'pendapatan' ? 'is-rev' : ''}` }, el('span', { className: 'bars-fill', style: `width:${(c.amount / max) * 100}%` })) },
            { label: t('report.cat.amount'), align: 'right', render: (c) => el('span', { className: 'tnum' }, C.rupiah(c.amount)) },
          ],
        })
      : emptyForPeriod())

    // Customers
    const byCust = new Map()
    for (const l of entries.filter(isRevenue)) {
      const req = flow.requestOfLedger(l)
      const k = customerKey(req)
      const cur = byCust.get(k) || { name: customerLabel(req), services: new Set(), amount: 0 }
      if (req?.service_type) cur.services.add(req.service_type)
      cur.service = [...cur.services].slice(0, 2).join(', ') + (cur.services.size > 2 ? ` +${cur.services.size - 2}` : '')
      cur.amount += Number(l.amount) || 0
      byCust.set(k, cur)
    }
    const custs = [...byCust.values()].sort((a, b) => b.amount - a.amount).slice(0, 5)
    custBody.replaceChildren(custs.length
      ? el('ol', { className: 'rank' }, custs.map((c, i) => el('li', { className: 'rank-row' },
          el('span', { className: 'rank-num tnum' }, String(i + 1)),
          C.cellStack(c.name, c.service),
          el('span', { className: 'tnum strong' }, C.rupiah(c.amount)),
        )))
      : C.emptyState({ kicker: t('report.cust.emptyKicker'), title: t('report.cust.emptyTitle') }))

    report = {
      period: r.label,
      period_start: localDate(r.from),
      period_end: localDate(r.to.getTime() - 1),
      total_revenue: tot.revenue,
      total_cost: tot.cost,
      net_profit: tot.profit,
      margin_pct: margin == null ? null : Number(margin.toFixed(1)),
      previous_period: prevT ? { label: r.prev.label, total_revenue: prevT.revenue, total_cost: prevT.cost, net_profit: prevT.profit } : null,
      by_category: cats.map((c) => ({ category: c.cat, label: categoryLabel(c.cat), amount: c.amount, entries: c.n })),
      top_customers: custs.map((c) => ({ name: c.name, service: c.service, revenue: c.amount })),
      entries: entries.map((l) => ({ id: l.id, category: l.category, amount: Number(l.amount) || 0, posted_at: ledgerDate(l) })),
    }
    explainBtn.disabled = entries.length === 0
    mailBtn.disabled = entries.length === 0
    lastExplanation = ''
    if (!entries.length) msg.show('info', t('report.ai.nothing'))
    else msg.hide()
  }

  function emptyForPeriod() {
    const box = C.emptyState({ kicker: t('report.empty.kicker'), title: t('report.empty.title'), body: flow.ledger.length ? t('report.empty.tryOther') : t('report.empty.post') })
    if (!flow.ledger.length) {
      const go = C.button({ label: t('report.empty.toBook'), iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
      go.addEventListener('click', () => navigate('workflow', { filter: 'book' }))
      box.appendChild(go)
    }
    return box
  }

  /* ------------------------------------------------------- AI explain */
  let current = null
  ctx.signal?.addEventListener('abort', () => current?.abort())

  explainBtn.addEventListener('click', async () => {
    msg.hide()
    if (!model) { try { await modelReady } catch { /* reported below */ } }
    if (!model) { msg.show('danger', t('report.ai.unavailable')); return }
    if (!report) return
    current?.abort()
    const ac = new AbortController()
    current = ac
    const restore = C.setBusy(explainBtn, t('report.ai.analyzing'))
    const ui = C.aiConsole({ model: t('report.ai.model') })
    ui.onStop(() => ac.abort())
    ui.setStatus(t('report.ai.writing'), true)
    ui.write('')
    aiOut.replaceChildren(ui.root)
    try {
      const html = await abortable(explainReport({
        report,
        modelId: model.id,
        signal: ac.signal,
        onChunk: (_d, full) => { if (!ac.signal.aborted) ui.writeHTML(C.sanitizeHTML(full)) },
      }), ac.signal)
      ui.writeHTML(C.sanitizeHTML(html), { caretOn: false })
      lastExplanation = ui.body?.textContent || ''
      ui.setStatus(t('report.ai.done'), false)
      showToast(t('report.ai.doneToast'), 'success')
    } catch (err) {
      ui.done()
      if (err.name === 'AbortError') {
        ui.setStatus(t('report.ai.stopped'), false)
        msg.show('info', t('report.ai.stoppedMsg'))
      } else {
        ui.setStatus(t('report.ai.failed'), false)
        msg.show('danger', err.message)
      }
    } finally {
      if (current === ac) current = null
      restore()
      explainBtn.disabled = !report?.entries.length
    }
  })

  // Report email to the signed-in owner: the period's figures plus the latest AI explanation.
  mailBtn.addEventListener('click', async () => {
    if (!report) return
    const lines = [
      t('report.mail.heading', { period: report.period }),
      '',
      t('report.mail.revenue', { amount: C.rupiah(report.total_revenue) }),
      t('report.mail.cost', { amount: C.rupiah(report.total_cost) }),
      t('report.mail.profit', { amount: C.rupiah(report.net_profit) }) + (report.margin_pct == null ? '' : t('report.mail.margin', { pct: report.margin_pct })),
      report.previous_period ? t('report.mail.compare', { label: report.previous_period.label, amount: C.rupiah(report.previous_period.net_profit) }) : null,
      lastExplanation ? `\n${t('report.mail.ai')}\n${lastExplanation.trim()}` : null,
    ].filter((l) => l !== null)
    const restore = C.setBusy(mailBtn, t('report.mail.sending'))
    try {
      const r = await sendBusinessEmail({ kind: 'report', subject: t('report.mail.subject', { period: report.period }), body: lines.join('\n') })
      showToast(r.simulated ? t('report.mail.simulated') : t('report.mail.sent', { to: r.to }), 'success')
    } catch (err) { msg.show('danger', err.message) } finally { restore() }
  })

  draw()
}

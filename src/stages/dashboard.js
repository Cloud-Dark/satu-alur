/**
 * 00 — Ringkasan. Every number on this page is computed from the flow
 * tables; nothing is hardcoded. Deltas appear only when computable.
 */
import * as C from '../ui/components.js'
import { staggerChildren } from '../ui/animations.js'
import { loadFlow, totals, ledgerDate, isRevenue, categoryLabel, customerLabel } from './data.js'
import { progressOf } from '../domain/progress.js'
import { t, locale, has } from '../i18n/index.js'

/** Funnel step -> Alur kerja filter (posisi). */
const FUNNEL_FILTER = { request: 'all', offer: 'offer', assign: 'assign', complete: 'work', bookkeeping: 'book' }

const { el, icon } = C
const DAY = 86400000

const STEPS = [
  { key: 'request', num: '01', icon: 'inbox' },
  { key: 'offer', num: '02', icon: 'sparkles' },
  { key: 'assign', num: '03', icon: 'users' },
  { key: 'complete', num: '04', icon: 'checkCircle' },
  { key: 'bookkeeping', num: '05', icon: 'ledger' },
  { key: 'report', num: '06', icon: 'chart' },
]
/** Step with its label and description in the current language (read at render time). */
const stepAt = (i) => ({ ...STEPS[i], label: t(`dashboard.steps.${STEPS[i].key}.label`), desc: t(`dashboard.steps.${STEPS[i].key}.desc`) })
const progressText = (v) => t(`assign.progress.${v}`)
const catLabel = (c) => (has(`bookkeeping.category.${c}`) ? t(`bookkeeping.category.${c}`) : categoryLabel(c))
const STEP_ICON = Object.fromEntries(STEPS.map((st) => [st.num, st.icon]))

function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 11) return t('dashboard.greeting.morning')
  if (h < 15) return t('dashboard.greeting.afternoon')
  if (h < 18) return t('dashboard.greeting.evening')
  return t('dashboard.greeting.night')
}

function displayName(user) {
  const raw = (user?.name && user.name.trim()) || (user?.email || '').split('@')[0] || ''
  if (!raw) return ''
  return raw.split(/[\s._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d }

/** Sum of a ledger subset inside [from, to). */
function windowTotals(ledger, from, to) {
  return totals(ledger.filter((l) => {
    const t = C.toDate(ledgerDate(l))?.getTime()
    return t != null && t >= from && t < to
  }))
}

/** "+34% vs 7 hari sebelumnya" or null when not computable. */
function deltaText(cur, prev) {
  if (prev > 0) {
    const pct = ((cur - prev) / prev) * 100
    const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±'
    return { pct, value: `${sign}${Math.abs(pct).toLocaleString(locale(), { maximumFractionDigits: 1 })}%`, text: t('dashboard.kpi.vsPrev7') }
  }
  return null
}

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const now = new Date()

  /* ---------------------------------------------------------- Header */
  const syncLine = el('span', { className: 'sync-line' },
    el('span', { className: 'pulse-dot', 'aria-hidden': 'true' }),
    el('span', {}, t('dashboard.loading')),
  )
  const refreshBtn = C.button({ label: t('dashboard.refresh'), icon: 'refresh', size: 'sm', variant: 'ghost' })
  const name = displayName(ctx.user)
  const head = C.pageHeader({ title: `${greeting(now)}${name ? `, ${name}` : ''}`, actions: [syncLine, refreshBtn], className: 'dash-head' })

  const body = el('div', { className: 'dash-body' })
  container.replaceChildren(head, body)
  refreshBtn.addEventListener('click', () => render(container, ctx))

  body.replaceChildren(
    el('div', { className: 'kpis is-loading' }, [0, 1, 2, 3].map((i) => el('div', { className: `kpi ${i === 0 ? 'is-hero' : ''}`.trim() }, C.skeleton({ lines: 2 })))),
    el('div', { className: 'dash-grid' },
      C.panel({ title: t('dashboard.chart.title'), className: 'span-7' }, C.skeletonRows(5)),
      C.panel({ title: t('dashboard.pipeline.title'), className: 'span-5' }, C.skeletonRows(4)),
    ),
  )

  let m
  try {
    m = await loadFlow()
  } catch (err) {
    if (ctx.signal?.aborted) return
    body.replaceChildren(C.errorState(err.message))
    return
  }
  if (ctx.signal?.aborted) return

  const syncedAt = new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  syncLine.lastChild.textContent = t('dashboard.updatedAt', { time: syncedAt })

  const isEmpty = !m.requests.length && !m.offers.length && !m.assignments.length && !m.completions.length && !m.ledger.length

  const sections = [renderKpis(m, now)]
  if (isEmpty) {
    sections.push(renderOnboarding(navigate))
  } else {
    sections.push(el('div', { className: 'dash-grid' },
      renderChart(m, ctx),
      renderPipeline(m, navigate),
    ))
    sections.push(el('div', { className: 'dash-grid' },
      renderActions(m, navigate),
      renderActivity(m),
    ))
    sections.push(el('div', { className: 'dash-grid' },
      renderComposition(m),
      renderStatusMix(m),
    ))
  }
  body.replaceChildren(...sections)
  staggerChildren(body, { step: 80 })
}

/* ================================================================ KPIs */

function renderKpis(m, now) {
  const all = totals(m.ledger)
  const nowMs = now.getTime()
  const cur = windowTotals(m.ledger, nowMs - 7 * DAY, nowMs + 1)
  const prev = windowTotals(m.ledger, nowMs - 14 * DAY, nowMs - 7 * DAY)

  const deltaNode = (key, { invert = false } = {}) => {
    const d = deltaText(cur[key], prev[key])
    if (d) {
      const up = d.pct > 0
      const good = invert ? !up : up
      const tone = d.pct === 0 ? null : good ? 'ok' : 'danger'
      return {
        node: [
          el('span', { className: 'delta' }, icon(up ? 'trendingUp' : d.pct < 0 ? 'trendingDown' : 'minus', { size: 14 }), el('span', { className: 'tnum' }, d.value)),
          el('span', { className: 'delta-note' }, d.text),
        ],
        tone,
      }
    }
    if (cur[key] > 0) return { node: t('dashboard.kpi.last7', { amount: C.rupiahCompact(cur[key]) }), tone: null }
    if (!m.ledger.length) return { node: t('dashboard.kpi.noLedger'), tone: null }
    return { node: t('dashboard.kpi.noTx7'), tone: null }
  }

  const rev = deltaNode('revenue')
  const cost = deltaNode('cost', { invert: true })
  const margin = all.revenue > 0 ? (all.profit / all.revenue) * 100 : null

  const doneAssign = m.assignments.filter((a) => a.status === 'done' || m.completionsOf(a.id).length > 0).length
  const rate = m.assignments.length ? Math.round((doneAssign / m.assignments.length) * 100) : null

  const pct = (n) => `${Math.round(n)}%`
  return el('div', { className: 'kpis', role: 'group', 'aria-label': t('dashboard.kpi.aria') },
    C.kpi({
      label: t('dashboard.kpi.profit'),
      hero: true,
      iconName: 'sprout',
      value: C.rupiah(all.profit),
      countTo: all.profit,
      format: C.rupiah,
      sub: margin == null ? t('dashboard.kpi.marginNone') : t('dashboard.kpi.margin', { pct: margin.toLocaleString(locale(), { maximumFractionDigits: 1 }) }),
      tone: margin == null ? null : all.profit >= 0 ? 'ok' : 'danger',
    }),
    C.kpi({ label: t('dashboard.word.revenue'), iconName: 'wallet', value: C.rupiah(all.revenue), countTo: all.revenue, format: C.rupiah, delta: rev.node, tone: rev.tone }),
    C.kpi({ label: t('dashboard.word.cost'), iconName: 'receipt', value: C.rupiah(all.cost), countTo: all.cost, format: C.rupiah, delta: cost.node, tone: cost.tone }),
    C.kpi({
      label: t('dashboard.kpi.completionRate'),
      iconName: 'checkCircle',
      value: rate == null ? '—' : `${rate}%`,
      countTo: rate == null ? undefined : rate,
      format: pct,
      sub: m.assignments.length ? t('dashboard.kpi.doneOf', { done: doneAssign, total: m.assignments.length }) : t('dashboard.kpi.noAssignments'),
    }),
  )
}

/* ============================================================ Pipeline */

function renderPipeline(m, navigate) {
  const reqTotal = m.requests.length
  const stages = m.requests.map((r) => m.requestStage(r).key)
  const reached = (keys) => stages.filter((k) => keys.includes(k)).length
  const months = new Set(m.ledger.map((l) => { const d = C.toDate(ledgerDate(l)); return d ? `${d.getFullYear()}-${d.getMonth()}` : null }).filter(Boolean))
  const weekAgo = Date.now() - 7 * DAY

  const cells = [
    { ...stepAt(0), count: reqTotal, sub: t('dashboard.pipeline.sub.request', { count: m.requests.filter((r) => (C.toDate(r.created_at)?.getTime() || 0) > weekAgo).length }), reach: reqTotal },
    { ...stepAt(1), count: m.offers.length, sub: t('dashboard.pipeline.sub.offer', { count: m.offers.filter((o) => o.status === 'approved').length }), reach: reached(['offered', 'draft', 'assigned', 'done', 'booked']) },
    { ...stepAt(2), count: m.assignments.length, sub: t('dashboard.pipeline.sub.assign', { count: m.activeAssignments().length }), reach: reached(['assigned', 'done', 'booked']) },
    { ...stepAt(3), count: m.completions.length, sub: t('dashboard.pipeline.sub.complete', { count: m.completionsWithoutLedger().length }), reach: reached(['done', 'booked']) },
    { ...stepAt(4), count: m.ledger.length, sub: t('dashboard.pipeline.sub.bookkeeping', { amount: C.rupiahCompact(totals(m.ledger).revenue) }), reach: reached(['booked']) },
    { ...stepAt(5), count: months.size, sub: t('dashboard.pipeline.sub.report'), reach: reached(['booked']), unit: 'periode' },
  ]

  const list = el('ol', { className: 'funnel' }, cells.map((c, i) => {
    const pct = reqTotal ? Math.round((c.reach / reqTotal) * 100) : 0
    const b = el('button', { type: 'button', className: 'funnel-row', 'aria-label': t('dashboard.pipeline.rowAria', { num: c.num, label: c.label, count: c.count, pct }) },
      el('span', { className: 'funnel-top' },
        el('span', { className: 'funnel-num tnum' }, c.num),
        el('span', { className: 'funnel-label' }, c.label),
        el('span', { className: 'funnel-count tnum' }, C.number(c.count)),
      ),
      el('span', { className: 'funnel-track', 'aria-hidden': 'true' },
        el('span', { className: `funnel-fill f-${i + 1}`, style: `--w:${Math.max(pct, 2)}%` })),
      el('span', { className: 'funnel-meta' },
        el('span', {}, c.sub),
        el('span', { className: 'funnel-pct tnum' }, `${pct}%`),
      ),
    )
    // Each row opens Alur kerja filtered to the jobs at that step (the one list of jobs).
    b.addEventListener('click', () => navigate('workflow', { filter: FUNNEL_FILTER[c.key] }))
    return el('li', {}, b)
  }))

  return C.panel({ title: t('dashboard.pipeline.title'), meta: t('dashboard.pipeline.meta', { count: reqTotal }), className: 'span-5 funnel-panel' }, list)
}

/* =============================================================== Chart */

function renderChart(m, ctx) {
  let range = 30
  const wrap = el('div', { className: 'chart-wrap' })
  const summary = el('p', { className: 'chart-summary' })
  const legend = el('div', { className: 'chart-legend' },
    el('span', {}, el('i', { className: 'lg lg-rev' }), t('dashboard.word.revenue')),
    el('span', {}, el('i', { className: 'lg lg-cost' }), t('dashboard.word.cost')),
    el('span', { className: 'chart-legend-note' }, t('dashboard.chart.cumulative')),
  )
  const seg = C.segmented({
    label: t('dashboard.chart.rangeLabel'),
    value: '30',
    options: [{ value: '14', label: t('dashboard.chart.days', { n: 14 }) }, { value: '30', label: t('dashboard.chart.days', { n: 30 }) }],
    onChange: (v) => { range = Number(v); draw() },
  })
  const p = C.panel({ title: t('dashboard.chart.title'), className: 'span-7 chart-panel', actions: seg }, legend, wrap, summary)

  function series() {
    const end = startOfDay(Date.now())
    const days = []
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * DAY)
      days.push({ date: d, key: dayKey(d), rev: 0, cost: 0 })
    }
    const idx = new Map(days.map((d, i) => [d.key, i]))
    for (const l of m.ledger) {
      const d = C.toDate(ledgerDate(l))
      if (!d) continue
      const i = idx.get(dayKey(d))
      if (i == null) continue
      if (isRevenue(l)) days[i].rev += Number(l.amount) || 0
      else days[i].cost += Number(l.amount) || 0
    }
    let cr = 0
    let cc = 0
    for (const d of days) { cr += d.rev; cc += d.cost; d.cumRev = cr; d.cumCost = cc }
    return days
  }

  function draw() {
    const days = series()
    const sumRev = days.reduce((s, d) => s + d.rev, 0)
    const sumCost = days.reduce((s, d) => s + d.cost, 0)
    if (sumRev === 0 && sumCost === 0) {
      wrap.replaceChildren(C.emptyState({
        kicker: t('dashboard.chart.lastDays', { n: range }),
        title: t('dashboard.chart.emptyTitle'),
        body: t('dashboard.chart.emptyBody'),
        iconName: 'chart',
      }))
      summary.textContent = ''
      return
    }
    summary.textContent = t('dashboard.chart.summary', { n: range, revenue: C.rupiah(sumRev), cost: C.rupiah(sumCost), profit: C.rupiah(sumRev - sumCost) })
    const width = Math.max(280, Math.round(wrap.clientWidth || 640))
    const height = width >= 560 ? 392 : 264
    wrap.replaceChildren(buildAreaChart(days, width, height, summary.textContent))
  }

  // Draw once attached (needs width), then follow container resizes.
  let lastW = 0
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width)
    if (w && Math.abs(w - lastW) > 8) { lastW = w; draw() }
  })
  ro.observe(wrap)
  ctx.signal?.addEventListener('abort', () => ro.disconnect())
  requestAnimationFrame(() => { if (!lastW) draw() })
  return p
}

const SVGNS = 'http://www.w3.org/2000/svg'
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  children.forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c))
  return n
}

/** A "nice" axis: step from {1,1.5,2,2.5,3,4,5,6,8}×10^n so that ≤4 steps cover v. */
function niceScale(v) {
  if (v <= 0) return { max: 1, step: 0.25, ticks: 4 }
  const raw = v / 4
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((f) => f * exp).find((x) => x >= raw)
  const ticks = Math.max(1, Math.ceil(v / step))
  return { max: step * ticks, step, ticks }
}

/**
 * Smooth path through points using monotone cubic interpolation
 * (Fritsch–Carlson): no overshoot, so a cumulative series never dips.
 */
function smoothPath(pts) {
  const n = pts.length
  if (n < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  const dx = []
  const slope = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const t = [slope[0]]
  for (let i = 1; i < n - 1; i++) t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2)
  t.push(slope[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / slope[i]
    const b = t[i + 1] / slope[i]
    const h = a * a + b * b
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * slope[i]; t[i + 1] = k * b * slope[i] }
  }
  const f = (v) => Math.round(v * 10) / 10
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`
  }
  return d
}

let chartSeq = 0
function buildAreaChart(days, width, height, label) {
  const narrow = width < 480
  const mg = { t: 16, r: narrow ? 10 : 16, b: 30, l: narrow ? 48 : 60 }
  const iw = width - mg.l - mg.r
  const ih = height - mg.t - mg.b
  const scale = niceScale(Math.max(...days.map((d) => Math.max(d.cumRev, d.cumCost))))
  const max = scale.max
  const y = (v) => mg.t + ih - (v / max) * ih
  const step = days.length > 1 ? iw / (days.length - 1) : iw
  const x = (i) => mg.l + i * step
  const gid = `chart-fill-${++chartSeq}`

  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': label })
  svg.appendChild(s('defs', {},
    s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0%', class: 'fill-stop-a' }),
      s('stop', { offset: '100%', class: 'fill-stop-b' })),
  ))

  // Grid + y labels
  for (let i = 0; i <= scale.ticks; i++) {
    const v = scale.step * i
    const yy = Math.round(y(v)) + 0.5
    svg.appendChild(s('line', { x1: mg.l, x2: width - mg.r, y1: yy, y2: yy, class: i === 0 ? 'axis' : 'grid' }))
    svg.appendChild(s('text', { x: mg.l - 10, y: yy + 4, class: 'tick', 'text-anchor': 'end' }, i === 0 ? '0' : C.rupiahCompact(v)))
  }

  // X labels
  const every = Math.max(days.length <= 14 ? 2 : 5, Math.ceil(70 / step))
  days.forEach((d, i) => {
    const isLast = i === days.length - 1
    if ((days.length - 1 - i) % every !== 0) return
    svg.appendChild(s('text', { x: x(i), y: height - 8, class: `tick ${isLast ? 'tick-strong' : ''}`, 'text-anchor': isLast ? 'end' : 'middle' },
      isLast ? t('dashboard.chart.today') : d.date.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })))
  })

  const revPts = days.map((d, i) => [x(i), y(d.cumRev)])
  const costPts = days.map((d, i) => [x(i), y(d.cumCost)])
  const revLine = smoothPath(revPts)
  const base = Math.round(y(0))
  svg.appendChild(s('path', { d: `${revLine} L${x(days.length - 1)},${base} L${x(0)},${base} Z`, class: 'area-rev', fill: `url(#${gid})` }))
  svg.appendChild(s('path', { d: smoothPath(costPts), class: 'line-cost', pathLength: 1 }))
  svg.appendChild(s('path', { d: revLine, class: 'line-rev', pathLength: 1 }))
  const lastI = days.length - 1
  svg.appendChild(s('circle', { cx: x(lastI), cy: y(days[lastI].cumRev), r: 4.5, class: 'end-dot end-rev' }))

  // Hover guide + markers
  const guide = s('line', { class: 'guide', x1: 0, x2: 0, y1: mg.t, y2: mg.t + ih, visibility: 'hidden' })
  const dotRev = s('circle', { r: 5, class: 'hover-dot dot-rev', visibility: 'hidden' })
  const dotCost = s('circle', { r: 4.5, class: 'hover-dot dot-cost', visibility: 'hidden' })
  svg.append(guide, dotCost, dotRev)

  // Tooltip
  const tip = el('div', { className: 'chart-tip', hidden: true })
  const hit = s('rect', { x: mg.l - step / 2, y: mg.t, width: iw + step, height: ih, class: 'hit' })
  svg.appendChild(hit)
  const show = (vis) => [guide, dotRev, dotCost].forEach((n) => n.setAttribute('visibility', vis))
  const move = (e) => {
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.min(days.length - 1, Math.max(0, Math.round((px - mg.l) / step)))
    const d = days[i]
    const cx = x(i)
    guide.setAttribute('x1', cx); guide.setAttribute('x2', cx)
    dotRev.setAttribute('cx', cx); dotRev.setAttribute('cy', y(d.cumRev))
    dotCost.setAttribute('cx', cx); dotCost.setAttribute('cy', y(d.cumCost))
    show('visible')
    tip.replaceChildren(
      el('span', { className: 'tip-date' }, d.date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short' })),
      el('span', { className: 'tip-row' }, el('i', { className: 'lg lg-rev' }), t('dashboard.word.revenue'), el('b', { className: 'tnum' }, C.rupiah(d.rev))),
      el('span', { className: 'tip-row' }, el('i', { className: 'lg lg-cost' }), t('dashboard.word.cost'), el('b', { className: 'tnum' }, C.rupiah(d.cost))),
      el('span', { className: 'tip-row tip-total' }, t('dashboard.chart.profitToday'), el('b', { className: 'tnum' }, C.rupiah(d.rev - d.cost))),
      el('span', { className: 'tip-row tip-cum' }, t('dashboard.chart.cumProfit'), el('b', { className: 'tnum' }, C.rupiah(d.cumRev - d.cumCost))),
    )
    tip.hidden = false
    const tw = 212
    const left = cx + 16 + tw > width ? cx - 16 - tw : cx + 16
    tip.style.left = `${Math.max(0, left)}px`
  }
  hit.addEventListener('pointermove', move)
  hit.addEventListener('pointerleave', () => { tip.hidden = true; show('hidden') })

  // Screen reader data table
  const table = el('table', { className: 'sr-only' },
    el('caption', {}, t('dashboard.chart.tableCaption')),
    el('thead', {}, el('tr', {}, el('th', {}, t('dashboard.chart.date')), el('th', {}, t('dashboard.word.revenue')), el('th', {}, t('dashboard.word.cost')))),
    el('tbody', {}, days.filter((d) => d.rev || d.cost).map((d) =>
      el('tr', {}, el('td', {}, C.formatDate(d.date)), el('td', {}, C.rupiah(d.rev)), el('td', {}, C.rupiah(d.cost))))),
  )

  return el('div', { className: 'chart-box' }, svg, tip, table)
}

/* ============================================================= Actions */

export function overdueLabel(ms) {
  const days = Math.floor(ms / DAY)
  return days >= 1 ? t('dashboard.actions.overdueDays', { count: days }) : t('dashboard.actions.overdue')
}

function renderActions(m, navigate) {
  const now = Date.now()
  const items = []
  const cust = (r) => customerLabel(r)

  for (const c of m.completionsWithoutLedger()) {
    const r = m.requestOfCompletion(c)
    items.push({ rank: 1, num: '05', type: t('dashboard.actions.type.bookkeeping'), title: t('dashboard.actions.title.bookkeeping', { name: cust(r) }), meta: t('dashboard.actions.meta.done', { time: C.relativeTime(c.completed_at || c.created_at) }), to: 'bookkeeping', params: { completionId: c.id }, cta: t('dashboard.actions.cta.bookkeeping') })
  }
  for (const a of m.activeAssignments()) {
    const r = m.requestOfAssignment(a)
    const sched = C.toDate(a.scheduled_at)
    // Work already started or on hold is not "late"; its progress is shown instead.
    const prog = progressOf(a, false)
    const overdue = prog === 'belum' && sched && sched.getTime() < now
    items.push({
      rank: overdue ? 0 : 2, num: '04', type: t('dashboard.actions.type.complete'), title: t('dashboard.actions.title.complete', { name: cust(r) }),
      meta: `${t('dashboard.actions.meta.assign', { worker: a.worker_name || t('dashboard.noName'), date: C.formatDate(a.scheduled_at) })}${prog !== 'belum' ? ` · ${progressText(prog)}` : ''}`,
      flag: overdue ? overdueLabel(now - sched.getTime()) : prog === 'ditunda' ? progressText('ditunda') : null,
      to: 'complete', params: { assignmentId: a.id }, cta: t('dashboard.actions.cta.complete'),
    })
  }
  for (const o of m.approvedWithoutAssignment()) {
    const r = m.requestOfOffer(o)
    items.push({ rank: 3, num: '03', type: t('dashboard.actions.type.assign'), title: t('dashboard.actions.title.assign', { name: cust(r) }), meta: t('dashboard.actions.meta.approved', { price: C.rupiah(o.validated_price), time: C.relativeTime(o.created_at) }), to: 'assign', params: { offerId: o.id }, cta: t('dashboard.actions.cta.assign') })
  }
  for (const o of m.draftOffers()) {
    const r = m.requestOfOffer(o)
    items.push({ rank: 4, num: '02', type: t('dashboard.actions.type.approval'), title: t('dashboard.actions.title.review', { name: cust(r) }), meta: t('dashboard.actions.meta.created', { price: C.rupiah(o.validated_price), time: C.relativeTime(o.created_at) }), to: 'offer', params: { offerId: o.id }, cta: t('dashboard.actions.cta.review') })
  }
  for (const r of m.requestsWithoutOffer()) {
    items.push({ rank: 5, num: '02', type: t('dashboard.actions.type.offer'), title: t('dashboard.actions.title.offer', { name: cust(r) }), meta: t('dashboard.actions.meta.received', { service: r.service_type || t('dashboard.actions.service'), time: C.relativeTime(r.created_at) }), to: 'offer', params: { requestId: r.id }, cta: t('dashboard.actions.cta.offer') })
  }
  items.sort((a, b) => a.rank - b.rank)

  const content = items.length
    ? C.paginate({ key: 'dash-todo', label: t('dashboard.actions.pageLabel'), pageSize: 5, sizes: [5], hideSize: true, items, render: (shown) => el('ol', { className: 'todo' }, shown.map((it) => {
        const b = C.button({ label: it.cta, iconRight: 'arrowRight', size: 'sm', variant: 'soft', className: 'todo-btn' })
        b.setAttribute('aria-label', `${it.cta}: ${it.title}`)
        b.addEventListener('click', () => navigate(it.to, it.params))
        return el('li', { className: `todo-item ${it.flag ? 'is-overdue' : ''}`.trim() },
          el('span', { className: 'todo-ico', 'aria-hidden': 'true' }, icon(STEP_ICON[it.num] || 'circleDot', { size: 16 })),
          el('div', { className: 'todo-text' },
            el('span', { className: 'todo-type' }, el('span', { className: 'tnum' }, t('dashboard.actions.stage', { num: it.num })), ` · ${it.type}`, it.flag ? C.tag(it.flag, 'warn') : null),
            el('span', { className: 'todo-title' }, it.title),
            el('span', { className: 'todo-meta' }, it.meta),
          ),
          b,
        )
      })) }).root
    : C.emptyState({ kicker: t('dashboard.actions.emptyKicker'), title: t('dashboard.actions.emptyTitle'), body: t('dashboard.actions.emptyBody'), iconName: 'checkCircle' })

  return C.panel({
    title: t('dashboard.actions.title.panel'),
    meta: items.length ? t('dashboard.actions.meta.panel', { count: C.number(items.length) }) : t('dashboard.actions.meta.empty'),
    className: 'span-7 todo-panel',
  }, content)
}

/* ============================================================ Activity */

function renderActivity(m) {
  const ev = []
  for (const r of m.requests) ev.push({ at: r.created_at, num: '01', title: t('dashboard.activity.request'), text: `${customerLabel(r)} — ${r.service_type || t('dashboard.activity.service')}` })
  for (const o of m.offers) {
    const r = m.requestOfOffer(o)
    ev.push({ at: o.created_at, num: '02', title: o.status === 'approved' ? t('dashboard.activity.offerApproved') : t('dashboard.activity.offerDraft'), text: `${customerLabel(r)} · ${C.rupiah(o.validated_price)}` })
  }
  for (const a of m.assignments) {
    const r = m.requestOfAssignment(a)
    ev.push({ at: a.created_at, num: '03', title: t('dashboard.activity.assigned'), text: `${a.worker_name || t('dashboard.noName')} → ${customerLabel(r)}` })
  }
  for (const c of m.completions) {
    const r = m.requestOfCompletion(c)
    ev.push({ at: c.completed_at || c.created_at, num: '04', title: t('dashboard.activity.done'), text: customerLabel(r) })
  }
  for (const l of m.ledger) {
    const r = m.requestOfLedger(l)
    ev.push({ at: ledgerDate(l), num: '05', title: isRevenue(l) ? t('dashboard.activity.revenuePosted') : t('dashboard.activity.costPosted'), text: `${catLabel(l.category)} · ${C.rupiah(l.amount)}${r ? ` · ${customerLabel(r)}` : ''}` })
  }
  const recent = ev.filter((e) => C.toDate(e.at)).sort((a, b) => C.toDate(b.at) - C.toDate(a.at))

  const list = C.paginate({ key: 'dash-feed', label: t('dashboard.activity.pageLabel'), pageSize: 6, sizes: [6], hideSize: true, items: recent, render: (shown) => el('ol', { className: 'feed' }, shown.map((e) =>
    el('li', { className: 'feed-item' },
      el('span', { className: 'feed-node', 'aria-hidden': 'true' }, icon(STEP_ICON[e.num] || 'circleDot', { size: 14 })),
      el('div', { className: 'feed-text' },
        el('span', { className: 'feed-title' }, e.title),
        el('span', { className: 'feed-desc' }, e.text),
      ),
      el('time', { className: 'feed-time', datetime: C.toDate(e.at).toISOString(), title: C.formatDateTime(e.at) }, C.relativeTime(e.at)),
    ))) }).root
  return C.panel({ title: t('dashboard.activity.title'), meta: t('dashboard.activity.meta', { count: C.number(recent.length) }), className: 'span-5 feed-panel' }, list)
}

/* ========================================================= Composition */

function renderComposition(m) {
  const byCat = new Map()
  for (const l of m.ledger) byCat.set(l.category, (byCat.get(l.category) || 0) + (Number(l.amount) || 0))
  const rows = [...byCat.entries()].sort((a, b) => (a[0] === 'pendapatan' ? -1 : b[0] === 'pendapatan' ? 1 : b[1] - a[1]))
  const max = Math.max(1, ...rows.map((r) => r[1]))
  const tt = totals(m.ledger)

  const content = rows.length
    ? el('div', {},
        el('ul', { className: 'bars' }, rows.map(([cat, amt]) =>
          el('li', { className: `bars-row ${cat === 'pendapatan' ? 'is-rev' : ''}` },
            el('span', { className: 'bars-label' }, catLabel(cat)),
            el('span', { className: 'bars-val tnum' }, C.rupiah(amt)),
            el('span', { className: 'bars-track', 'aria-hidden': 'true' }, el('span', { className: 'bars-fill', style: `width:${(amt / max) * 100}%` })),
          ))),
        el('p', { className: 'bars-foot' }, tt.revenue > 0
          ? t('dashboard.composition.costShare', { pct: Math.round((tt.cost / tt.revenue) * 100) })
          : t('dashboard.composition.noRevenue')),
      )
    : C.emptyState({ kicker: t('dashboard.composition.emptyKicker'), title: t('dashboard.composition.emptyTitle'), body: t('dashboard.composition.emptyBody'), iconName: 'ledger' })

  return C.panel({ title: t('dashboard.composition.title'), meta: t('dashboard.composition.meta', { count: m.ledger.length }), className: 'span-7' }, content)
}

/* ========================================================== Status mix */

function renderStatusMix(m) {
  const ORDER = ['new', 'draft', 'rejected', 'offered', 'assigned', 'done', 'booked'].map((k) => [k, t(`dashboard.mix.${k}`)])
  const counts = new Map(ORDER.map(([k]) => [k, 0]))
  for (const r of m.requests) { const k = m.requestStage(r).key; counts.set(k, (counts.get(k) || 0) + 1) }
  const total = m.requests.length || 1
  const strip = el('div', { className: 'mix-strip', 'aria-hidden': 'true' },
    ORDER.filter(([k]) => counts.get(k)).map(([k]) => el('span', { className: `mix-seg mix-${k}`, style: `flex-grow:${counts.get(k)}` })))
  const legend = el('ul', { className: 'mix-legend' }, ORDER.map(([k, label]) =>
    el('li', { className: counts.get(k) ? '' : 'is-zero' },
      el('i', { className: `mix-key mix-${k}` }),
      el('span', {}, label),
      el('b', { className: 'tnum' }, String(counts.get(k))),
    )))
  return C.panel({ title: t('dashboard.mix.title'), meta: t('dashboard.mix.meta', { count: m.requests.length }), className: 'span-5' },
    m.requests.length ? el('div', {}, strip, legend) : C.emptyState({ kicker: t('dashboard.mix.emptyKicker'), title: t('dashboard.mix.emptyTitle') }),
    el('p', { className: 'sr-only' }, ORDER.map(([k, label]) => `${label}: ${counts.get(k)}`).join(', ') + t('dashboard.mix.ofTotal', { total })),
  )
}

/* ========================================================== Onboarding */

function renderOnboarding(navigate) {
  const cta = C.button({ label: t('dashboard.onboard.cta'), icon: 'plus', variant: 'primary', size: 'lg' })
  cta.addEventListener('click', () => navigate('request'))
  return el('section', { className: 'onboard' },
    el('div', { className: 'onboard-intro' },
      el('span', { className: 'tag tag-accent' }, icon('sprout', { size: 14 }), t('dashboard.onboard.tag')),
      el('h2', { className: 'onboard-title display' }, t('dashboard.onboard.titleBefore'), el('em', {}, t('dashboard.onboard.titleEm')), t('dashboard.onboard.titleAfter')),
      el('p', { className: 'onboard-body' }, t('dashboard.onboard.body')),
      cta,
    ),
    el('ol', { className: 'onboard-steps' }, STEPS.map((_, i) => stepAt(i)).map((st, i) =>
      el('li', { className: `onboard-step ${i === 0 ? 'is-next' : ''}` },
        el('span', { className: 'onboard-node', 'aria-hidden': 'true' }, icon(st.icon, { size: 16 })),
        el('span', { className: 'onboard-text' },
          el('span', { className: 'onboard-label' }, el('span', { className: 'onboard-num tnum' }, st.num), st.label),
          el('span', { className: 'onboard-desc' }, st.desc),
        ),
        i === 0 ? el('span', { className: 'onboard-next' }, t('dashboard.onboard.start')) : null,
      ))),
  )
}

/**
 * 00 — Ringkasan. Every number on this page is computed from the flow
 * tables; nothing is hardcoded. Deltas appear only when computable.
 */
import * as C from '../ui/components.js'
import { staggerChildren } from '../ui/animations.js'
import { loadFlow, totals, ledgerDate, isRevenue, categoryLabel, customerLabel } from './data.js'

const { el, icon } = C
const DAY = 86400000

const STEPS = [
  { key: 'request', num: '01', label: 'Permintaan', desc: 'Catat kebutuhan pelanggan.' },
  { key: 'offer', num: '02', label: 'Penawaran', desc: 'AI menyusun, aturan memvalidasi.' },
  { key: 'assign', num: '03', label: 'Penugasan', desc: 'Jadwalkan tenaga pelaksana.' },
  { key: 'complete', num: '04', label: 'Penyelesaian', desc: 'Catat hasil pekerjaan.' },
  { key: 'bookkeeping', num: '05', label: 'Pembukuan', desc: 'Posting pendapatan dan biaya.' },
  { key: 'report', num: '06', label: 'Laporan', desc: 'AI menjelaskan angka Anda.' },
]

function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 11) return 'Selamat pagi'
  if (h < 15) return 'Selamat siang'
  if (h < 18) return 'Selamat sore'
  return 'Selamat malam'
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
    return { pct, text: `${sign}${Math.abs(pct).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% vs 7 hari sebelumnya` }
  }
  return null
}

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const now = new Date()

  /* ---------------------------------------------------------- Header */
  const syncLine = el('span', { className: 'live-line mono' },
    el('span', { className: 'live-dot', 'aria-hidden': 'true' }),
    el('span', {}, `${ctx.isMock ? 'Mode demo · data lokal' : 'Cloudflare D1'} · memuat…`),
  )
  const refreshBtn = C.iconButton({ iconName: 'refresh', label: 'Muat ulang data' })
  const head = el('header', { className: 'dash-head' },
    el('div', { className: 'dash-head-text' },
      el('span', { className: 'kicker' }, `00 — ${now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`),
      el('h1', { className: 'page-title', tabindex: '-1' }, `${greeting(now)}${displayName(ctx.user) ? `, ${displayName(ctx.user)}` : ''}.`),
      syncLine,
    ),
    el('div', { className: 'dash-head-actions' }, refreshBtn),
  )

  const body = el('div', { className: 'dash-body' })
  container.replaceChildren(head, body)
  refreshBtn.addEventListener('click', () => render(container, ctx))

  body.replaceChildren(
    el('div', { className: 'kpis is-loading' }, [0, 1, 2, 3].map(() => el('div', { className: 'kpi' }, C.skeleton({ lines: 2 })))),
    el('div', { className: 'dash-grid' },
      C.panel({ title: 'Memuat alur', className: 'span-7' }, C.skeletonRows(5)),
      C.panel({ title: 'Perlu tindakan', className: 'span-5' }, C.skeletonRows(4)),
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

  const syncedAt = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  syncLine.lastChild.textContent = `${ctx.isMock ? 'Mode demo · data lokal' : 'Terhubung · Cloudflare D1'} · sinkron ${syncedAt}`

  const isEmpty = !m.requests.length && !m.offers.length && !m.assignments.length && !m.completions.length && !m.ledger.length

  const sections = [renderKpis(m, now)]
  if (isEmpty) {
    sections.push(renderOnboarding(navigate))
  } else {
    sections.push(renderPipeline(m, navigate))
    sections.push(el('div', { className: 'dash-grid' },
      renderChart(m, ctx),
      renderActions(m, navigate),
    ))
    sections.push(el('div', { className: 'dash-grid' },
      renderActivity(m),
      renderComposition(m),
    ))
  }
  body.replaceChildren(...sections)
  staggerChildren(body, { step: 60 })
}

/* ================================================================ KPIs */

function renderKpis(m, now) {
  const all = totals(m.ledger)
  const t = now.getTime()
  const cur = windowTotals(m.ledger, t - 7 * DAY, t + 1)
  const prev = windowTotals(m.ledger, t - 14 * DAY, t - 7 * DAY)

  const deltaNode = (key, { invert = false } = {}) => {
    const d = deltaText(cur[key], prev[key])
    if (d) {
      const up = d.pct > 0
      const good = invert ? !up : up
      const tone = d.pct === 0 ? null : good ? 'ok' : 'danger'
      return { node: el('span', { className: 'delta' }, icon(up ? 'trendingUp' : d.pct < 0 ? 'trendingDown' : 'minus', { size: 14 }), d.text), tone }
    }
    if (cur[key] > 0) return { node: `${C.rupiahCompact(cur[key])} dalam 7 hari terakhir`, tone: null }
    if (!m.ledger.length) return { node: 'Belum ada jurnal', tone: null }
    return { node: 'Tidak ada transaksi 7 hari terakhir', tone: null }
  }

  const rev = deltaNode('revenue')
  const cost = deltaNode('cost', { invert: true })
  const margin = all.revenue > 0 ? (all.profit / all.revenue) * 100 : null

  const doneAssign = m.assignments.filter((a) => a.status === 'done' || m.completionsOf(a.id).length > 0).length
  const rate = m.assignments.length ? Math.round((doneAssign / m.assignments.length) * 100) : null

  return el('div', { className: 'kpis', role: 'group', 'aria-label': 'Indikator utama' },
    C.kpi({ label: 'Pendapatan', value: C.rupiah(all.revenue), delta: rev.node, tone: rev.tone }),
    C.kpi({ label: 'Biaya', value: C.rupiah(all.cost), delta: cost.node, tone: cost.tone }),
    C.kpi({
      label: 'Laba bersih',
      value: C.rupiah(all.profit),
      sub: margin == null ? 'Margin — (belum ada pendapatan)' : `Margin ${margin.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`,
      tone: margin == null ? null : all.profit >= 0 ? 'ok' : 'danger',
    }),
    C.kpi({
      label: 'Tingkat penyelesaian',
      value: rate == null ? '—' : `${rate}%`,
      sub: m.assignments.length ? `${doneAssign} dari ${m.assignments.length} penugasan selesai` : 'Belum ada penugasan',
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
    { ...STEPS[0], count: reqTotal, sub: `${m.requests.filter((r) => (C.toDate(r.created_at)?.getTime() || 0) > weekAgo).length} masuk 7 hari terakhir`, reach: reqTotal },
    { ...STEPS[1], count: m.offers.length, sub: `${m.offers.filter((o) => o.status === 'approved').length} disetujui`, reach: reached(['offered', 'draft', 'assigned', 'done', 'booked']) },
    { ...STEPS[2], count: m.assignments.length, sub: `${m.activeAssignments().length} aktif`, reach: reached(['assigned', 'done', 'booked']) },
    { ...STEPS[3], count: m.completions.length, sub: `${m.completionsWithoutLedger().length} belum dibukukan`, reach: reached(['done', 'booked']) },
    { ...STEPS[4], count: m.ledger.length, sub: `${C.rupiahCompact(totals(m.ledger).revenue)} pendapatan`, reach: reached(['booked']) },
    { ...STEPS[5], count: months.size, sub: months.size === 1 ? 'periode bulanan' : 'periode bulanan', reach: reached(['booked']), unit: 'periode' },
  ]

  const list = el('ol', { className: 'pipeline' }, cells.map((c) => {
    const pct = reqTotal ? Math.round((c.reach / reqTotal) * 100) : 0
    const b = el('button', { type: 'button', className: 'pipe-cell', 'aria-label': `${c.num} ${c.label}: ${c.count}. ${pct}% permintaan mencapai tahap ini. Buka tahap.` },
      el('span', { className: 'pipe-top' },
        el('span', { className: 'pipe-num mono' }, c.num),
        el('span', { className: 'pipe-label' }, c.label),
        icon('arrowUpRight', { size: 14, className: 'pipe-go' }),
      ),
      el('span', { className: 'pipe-count tnum' }, C.number(c.count)),
      el('span', { className: 'pipe-sub' }, c.sub),
      el('span', { className: 'pipe-bar', 'aria-hidden': 'true' }, el('span', { className: 'pipe-fill', style: `width:${pct}%` })),
      el('span', { className: 'pipe-pct mono tnum' }, `${pct}% permintaan`),
    )
    b.addEventListener('click', () => navigate(c.key))
    return el('li', {}, b)
  }))

  return C.panel({ title: 'Alur kerja', meta: `${reqTotal} permintaan · konversi per tahap`, className: 'pipeline-panel' }, list)
}

/* =============================================================== Chart */

function renderChart(m, ctx) {
  let range = 30
  const wrap = el('div', { className: 'chart-wrap' })
  const summary = el('p', { className: 'chart-summary' })
  const legend = el('div', { className: 'chart-legend mono' },
    el('span', {}, el('i', { className: 'lg lg-rev' }), 'Pendapatan'),
    el('span', {}, el('i', { className: 'lg lg-cost' }), 'Biaya'),
  )
  const seg = C.segmented({
    label: 'Rentang grafik',
    value: '30',
    options: [{ value: '14', label: '14H' }, { value: '30', label: '30H' }],
    onChange: (v) => { range = Number(v); draw() },
  })
  const p = C.panel({ title: 'Pendapatan vs biaya', className: 'span-7 chart-panel', actions: seg }, legend, wrap, summary)

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
    return days
  }

  function draw() {
    const days = series()
    const sumRev = days.reduce((s, d) => s + d.rev, 0)
    const sumCost = days.reduce((s, d) => s + d.cost, 0)
    if (sumRev === 0 && sumCost === 0) {
      wrap.replaceChildren(C.emptyState({
        kicker: `${range} hari terakhir`,
        title: 'Belum ada jurnal di rentang ini.',
        body: 'Posting pendapatan dan biaya di tahap Pembukuan agar grafik terisi.',
      }))
      summary.textContent = ''
      return
    }
    summary.textContent = `${range} hari terakhir: pendapatan ${C.rupiah(sumRev)}, biaya ${C.rupiah(sumCost)}, laba ${C.rupiah(sumRev - sumCost)}.`
    const width = Math.max(280, Math.round(wrap.clientWidth || 640))
    wrap.replaceChildren(buildBarChart(days, width, summary.textContent))
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

function niceMax(v) {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

function buildBarChart(days, width, label) {
  const height = 232
  const mg = { t: 12, r: 8, b: 30, l: 58 }
  const iw = width - mg.l - mg.r
  const ih = height - mg.t - mg.b
  const max = niceMax(Math.max(...days.map((d) => Math.max(d.rev, d.cost))))
  const y = (v) => mg.t + ih - (v / max) * ih
  const gw = iw / days.length
  const bw = Math.max(2, Math.min(14, (gw * 0.72) / 2))

  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': label })
  svg.appendChild(s('defs', {},
    s('pattern', { id: 'hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 4, height: 4, class: 'hatch-bg' }),
      s('line', { x1: 0, y1: 0, x2: 0, y2: 4, class: 'hatch-line' })),
  ))

  // Grid + y labels
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    const yy = Math.round(y(v)) + 0.5
    svg.appendChild(s('line', { x1: mg.l, x2: width - mg.r, y1: yy, y2: yy, class: i === 0 ? 'axis' : 'grid' }))
    svg.appendChild(s('text', { x: mg.l - 8, y: yy + 3.5, class: 'tick', 'text-anchor': 'end' }, i === 0 ? '0' : C.rupiahCompact(v)))
  }

  const hover = s('rect', { class: 'hover-col', x: 0, y: mg.t, width: gw, height: ih, visibility: 'hidden' })
  svg.appendChild(hover)

  const every = days.length <= 14 ? 2 : 5
  days.forEach((d, i) => {
    const gx = mg.l + i * gw
    const cx = gx + gw / 2
    if (d.rev > 0) svg.appendChild(s('rect', { x: cx - bw - 0.5, y: y(d.rev), width: bw, height: Math.max(1, mg.t + ih - y(d.rev)), class: 'bar-rev' }))
    if (d.cost > 0) svg.appendChild(s('rect', { x: cx + 0.5, y: y(d.cost), width: bw, height: Math.max(1, mg.t + ih - y(d.cost)), class: 'bar-cost' }))
    const isLast = i === days.length - 1
    if ((days.length - 1 - i) % every === 0) {
      svg.appendChild(s('text', { x: cx, y: height - 10, class: `tick ${isLast ? 'tick-strong' : ''}`, 'text-anchor': isLast ? 'end' : 'middle', dx: isLast ? gw / 2 : 0 },
        isLast ? 'HARI INI' : d.date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }).toUpperCase()))
    }
  })

  // Tooltip
  const tip = el('div', { className: 'chart-tip', hidden: true })
  const hit = s('rect', { x: mg.l, y: mg.t, width: iw, height: ih, class: 'hit' })
  svg.appendChild(hit)
  const move = (e) => {
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.min(days.length - 1, Math.max(0, Math.floor((px - mg.l) / gw)))
    const d = days[i]
    hover.setAttribute('x', mg.l + i * gw)
    hover.setAttribute('visibility', 'visible')
    tip.replaceChildren(
      el('span', { className: 'tip-date mono' }, d.date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })),
      el('span', { className: 'tip-row' }, el('i', { className: 'lg lg-rev' }), 'Pendapatan', el('b', { className: 'tnum' }, C.rupiah(d.rev))),
      el('span', { className: 'tip-row' }, el('i', { className: 'lg lg-cost' }), 'Biaya', el('b', { className: 'tnum' }, C.rupiah(d.cost))),
      el('span', { className: 'tip-row tip-total' }, 'Laba', el('b', { className: 'tnum' }, C.rupiah(d.rev - d.cost))),
    )
    tip.hidden = false
    const tx = mg.l + i * gw + gw / 2
    const left = Math.min(Math.max(tx - 90, 0), width - 180)
    tip.style.left = `${left}px`
  }
  hit.addEventListener('pointermove', move)
  hit.addEventListener('pointerleave', () => { tip.hidden = true; hover.setAttribute('visibility', 'hidden') })

  // Screen reader data table
  const table = el('table', { className: 'sr-only' },
    el('caption', {}, 'Pendapatan dan biaya per hari'),
    el('thead', {}, el('tr', {}, el('th', {}, 'Tanggal'), el('th', {}, 'Pendapatan'), el('th', {}, 'Biaya'))),
    el('tbody', {}, days.filter((d) => d.rev || d.cost).map((d) =>
      el('tr', {}, el('td', {}, C.formatDate(d.date)), el('td', {}, C.rupiah(d.rev)), el('td', {}, C.rupiah(d.cost))))),
  )

  return el('div', { className: 'chart-box' }, svg, tip, table)
}

/* ============================================================= Actions */

export function overdueLabel(ms) {
  const days = Math.floor(ms / DAY)
  return days >= 1 ? `Lewat ${days} hari` : 'Lewat jadwal'
}

function renderActions(m, navigate) {
  const now = Date.now()
  const items = []
  const cust = (r) => customerLabel(r)

  for (const c of m.completionsWithoutLedger()) {
    const r = m.requestOfCompletion(c)
    items.push({ rank: 1, type: '05 Pembukuan', title: `Posting jurnal: ${cust(r)}`, meta: `Selesai ${C.relativeTime(c.completed_at || c.created_at)}`, to: 'bookkeeping', params: { completionId: c.id }, cta: 'Posting' })
  }
  for (const a of m.activeAssignments()) {
    const r = m.requestOfAssignment(a)
    const sched = C.toDate(a.scheduled_at)
    const overdue = sched && sched.getTime() < now
    items.push({
      rank: overdue ? 0 : 2, type: '04 Penyelesaian', title: `Konfirmasi selesai: ${cust(r)}`,
      meta: `${a.worker_name || 'Tanpa nama'} · jadwal ${C.formatDate(a.scheduled_at)}`,
      flag: overdue ? overdueLabel(now - sched.getTime()) : null,
      to: 'complete', params: { assignmentId: a.id }, cta: 'Tandai',
    })
  }
  for (const o of m.approvedWithoutAssignment()) {
    const r = m.requestOfOffer(o)
    items.push({ rank: 3, type: '03 Penugasan', title: `Tugaskan pekerja: ${cust(r)}`, meta: `${C.rupiah(o.validated_price)} · disetujui ${C.relativeTime(o.created_at)}`, to: 'assign', params: { offerId: o.id }, cta: 'Tugaskan' })
  }
  for (const o of m.draftOffers()) {
    const r = m.requestOfOffer(o)
    items.push({ rank: 4, type: '02 Persetujuan', title: `Tinjau penawaran draf: ${cust(r)}`, meta: `${C.rupiah(o.validated_price)} · dibuat ${C.relativeTime(o.created_at)}`, to: 'offer', params: { offerId: o.id }, cta: 'Tinjau' })
  }
  for (const r of m.requestsWithoutOffer()) {
    items.push({ rank: 5, type: '02 Penawaran', title: `Buat penawaran: ${cust(r)}`, meta: `${r.service_type || 'Layanan'} · masuk ${C.relativeTime(r.created_at)}`, to: 'offer', params: { requestId: r.id }, cta: 'Buat' })
  }
  items.sort((a, b) => a.rank - b.rank)

  const LIMIT = 6
  const shown = items.slice(0, LIMIT)
  const content = items.length
    ? el('ol', { className: 'todo' }, shown.map((it) => {
        const b = C.button({ label: it.cta, iconRight: 'arrowRight', size: 'sm', className: 'todo-btn' })
        b.setAttribute('aria-label', `${it.cta}: ${it.title}`)
        b.addEventListener('click', () => navigate(it.to, it.params))
        return el('li', { className: 'todo-item' },
          el('div', { className: 'todo-text' },
            el('span', { className: 'todo-type mono' }, it.type, it.flag ? el('span', { className: 'tag tag-warn' }, it.flag) : null),
            el('span', { className: 'todo-title' }, it.title),
            el('span', { className: 'todo-meta' }, it.meta),
          ),
          b,
        )
      }))
    : C.emptyState({ kicker: 'Antrian bersih', title: 'Tidak ada yang menunggu.', body: 'Semua permintaan sudah diproses sampai pembukuan.' })

  return C.panel({
    title: 'Perlu tindakan',
    meta: items.length ? `${items.length} item${items.length > LIMIT ? ` · ${LIMIT} teratas` : ''}` : 'kosong',
    className: 'span-5 todo-panel',
  }, content)
}

/* ============================================================ Activity */

function renderActivity(m) {
  const ev = []
  for (const r of m.requests) ev.push({ at: r.created_at, num: '01', title: 'Permintaan masuk', text: `${customerLabel(r)} — ${r.service_type || 'layanan'}` })
  for (const o of m.offers) {
    const r = m.requestOfOffer(o)
    ev.push({ at: o.created_at, num: '02', title: o.status === 'approved' ? 'Penawaran disetujui' : 'Penawaran draf', text: `${customerLabel(r)} · ${C.rupiah(o.validated_price)}` })
  }
  for (const a of m.assignments) {
    const r = m.requestOfAssignment(a)
    ev.push({ at: a.created_at, num: '03', title: 'Pekerja ditugaskan', text: `${a.worker_name || 'Tanpa nama'} → ${customerLabel(r)}` })
  }
  for (const c of m.completions) {
    const r = m.requestOfCompletion(c)
    ev.push({ at: c.completed_at || c.created_at, num: '04', title: 'Pekerjaan selesai', text: customerLabel(r) })
  }
  for (const l of m.ledger) {
    const r = m.requestOfLedger(l)
    ev.push({ at: ledgerDate(l), num: '05', title: isRevenue(l) ? 'Pendapatan diposting' : 'Biaya diposting', text: `${categoryLabel(l.category)} · ${C.rupiah(l.amount)}${r ? ` · ${customerLabel(r)}` : ''}` })
  }
  const recent = ev.filter((e) => C.toDate(e.at)).sort((a, b) => C.toDate(b.at) - C.toDate(a.at)).slice(0, 8)

  const list = el('ol', { className: 'feed' }, recent.map((e) =>
    el('li', { className: 'feed-item' },
      el('time', { className: 'feed-time mono', datetime: C.toDate(e.at).toISOString(), title: C.formatDateTime(e.at) }, C.relativeTime(e.at)),
      el('span', { className: 'feed-node', 'aria-hidden': 'true' }),
      el('div', { className: 'feed-text' },
        el('span', { className: 'feed-title' }, el('span', { className: 'mono feed-num' }, e.num), e.title),
        el('span', { className: 'feed-desc' }, e.text),
      ),
    )))
  return C.panel({ title: 'Aktivitas terbaru', meta: `${recent.length} dari ${ev.length} peristiwa`, className: 'span-7' }, list)
}

/* ========================================================= Composition */

function renderComposition(m) {
  const byCat = new Map()
  for (const l of m.ledger) byCat.set(l.category, (byCat.get(l.category) || 0) + (Number(l.amount) || 0))
  const rows = [...byCat.entries()].sort((a, b) => (a[0] === 'pendapatan' ? -1 : b[0] === 'pendapatan' ? 1 : b[1] - a[1]))
  const max = Math.max(1, ...rows.map((r) => r[1]))
  const t = totals(m.ledger)

  const content = rows.length
    ? el('div', {},
        el('ul', { className: 'bars' }, rows.map(([cat, amt]) =>
          el('li', { className: `bars-row ${cat === 'pendapatan' ? 'is-rev' : ''}` },
            el('span', { className: 'bars-label' }, categoryLabel(cat)),
            el('span', { className: 'bars-val tnum' }, C.rupiah(amt)),
            el('span', { className: 'bars-track', 'aria-hidden': 'true' }, el('span', { className: 'bars-fill', style: `width:${(amt / max) * 100}%` })),
          ))),
        el('p', { className: 'bars-foot mono' }, t.revenue > 0
          ? `Biaya = ${Math.round((t.cost / t.revenue) * 100)}% dari pendapatan`
          : 'Belum ada pendapatan tercatat'),
      )
    : C.emptyState({ kicker: 'Pembukuan', title: 'Belum ada jurnal.', body: 'Komposisi muncul setelah jurnal pertama diposting.' })

  return C.panel({ title: 'Komposisi buku besar', meta: `${m.ledger.length} jurnal`, className: 'span-5' }, content)
}

/* ========================================================== Onboarding */

function renderOnboarding(navigate) {
  const cta = C.button({ label: 'Buat permintaan pertama', icon: 'plus', variant: 'ink', size: 'lg' })
  cta.addEventListener('click', () => navigate('request'))
  return el('section', { className: 'onboard' },
    el('div', { className: 'onboard-intro' },
      el('span', { className: 'kicker' }, 'Akun baru'),
      el('h2', { className: 'onboard-title' }, 'Alur Anda masih kosong.'),
      el('p', { className: 'onboard-body' }, 'Semua angka di halaman ini dihitung dari data Anda sendiri. Mulai dengan satu permintaan pelanggan, lalu bawa sampai ke laporan. Setiap tahap membuka tahap berikutnya.'),
      cta,
    ),
    el('ol', { className: 'onboard-steps' }, STEPS.map((st, i) =>
      el('li', { className: `onboard-step ${i === 0 ? 'is-next' : ''}` },
        el('span', { className: 'mono onboard-num' }, st.num),
        el('span', { className: 'onboard-label' }, st.label),
        el('span', { className: 'onboard-desc' }, st.desc),
      ))),
  )
}

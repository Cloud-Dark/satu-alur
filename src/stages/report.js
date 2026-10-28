/** 06 — Laporan: period figures computed from the ledger + AI explanation. */
import * as C from '../ui/components.js'
import { explainReport } from '../ai/agent.js'
import { showToast } from '../ui/animations.js'
import { resolveModel, abortable } from './offer.js'
import { loadFlow, totals, ledgerDate, isRevenue, categoryLabel, customerLabel } from './data.js'

const { el } = C
const DAY = 86400000

const PERIODS = [
  { value: '30d', label: '30 hari' },
  { value: 'month', label: 'Bulan ini' },
  { value: 'prev', label: 'Bulan lalu' },
  { value: 'all', label: 'Semua' },
]

const monthName = (d) => d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

/** Returns { from, to, label, prev: {from,to,label}|null } as Date objects. */
export function periodRange(kind, now = new Date(), ledger = []) {
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0)
  const tomorrow = new Date(startToday.getTime() + DAY)
  if (kind === '30d') {
    const from = new Date(tomorrow.getTime() - 30 * DAY)
    const pf = new Date(from.getTime() - 30 * DAY)
    return { from, to: tomorrow, label: `${C.formatDate(from)} – ${C.formatDate(startToday)}`, prev: { from: pf, to: from, label: '30 hari sebelumnya' } }
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
  return { from, to: tomorrow, label: dates.length ? `${C.formatDate(from)} – ${C.formatDate(dates[dates.length - 1])}` : 'Belum ada data', prev: null }
}

const inRange = (l, r) => { const t = C.toDate(ledgerDate(l))?.getTime(); return t != null && t >= r.from.getTime() && t < r.to.getTime() }

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  let period = '30d'

  const seg = C.segmented({ label: 'Periode laporan', value: period, options: PERIODS, onChange: (v) => { period = v; draw() } })
  const periodLine = el('p', { className: 'period-line' }, C.icon('calendar', { size: 15 }), el('span', {}, 'Memuat…'))
  const kpis = el('div', { className: 'kpis' }, [0, 1, 2, 3].map((i) => el('div', { className: `kpi ${i === 0 ? 'is-hero' : ''}`.trim() }, C.skeleton({ lines: 2 }))))
  const catBody = el('div', {}, C.skeletonRows(4))
  const custBody = el('div', {}, C.skeletonRows(4))
  const catPanel = C.panel({ title: 'Rincian kategori', meta: '—', className: 'span-7' }, catBody)
  const custPanel = C.panel({ title: 'Pelanggan teratas', meta: 'berdasarkan pendapatan', className: 'span-5' }, custBody)

  const explainBtn = C.button({ label: 'Jelaskan dengan AI', icon: 'sparkles', variant: 'primary' })
  const modelNote = el('span', { className: 'model-note' }, 'Model: memuat…')
  const msg = C.message()
  const aiOut = el('div', { className: 'report-ai-out' })
  const aiPanel = C.panel({ title: 'Penjelasan AI', meta: 'Bahasa Indonesia · HTML tersanitasi', raised: true, className: 'ai-panel' },
    el('p', { className: 'panel-lead' }, 'AI membaca angka periode terpilih, membandingkannya dengan periode sebelumnya, lalu memberi ringkasan dan rekomendasi. Angka di atas tetap menjadi acuan.'),
    el('div', { className: 'form-actions' }, explainBtn, modelNote),
    msg,
    aiOut,
  )

  container.replaceChildren(
    C.pageHeader({ num: '06', label: 'Laporan', title: 'Laporan keuangan', em: 'keuangan', description: 'Angka dihitung langsung dari buku besar. Pilih periode, lalu minta AI menjelaskannya.', actions: seg }),
    periodLine,
    kpis,
    el('div', { className: 'dash-grid is-stretch' }, catPanel, custPanel),
    aiPanel,
  )

  let model = null
  resolveModel()
    .then((m) => { model = m; modelNote.textContent = m ? `Model: ${m.id}` : 'Model: tidak tersedia' })
    .catch((err) => { modelNote.textContent = `Model: ${err.message}` })

  let flow
  try {
    flow = await loadFlow()
  } catch (err) {
    kpis.replaceChildren(C.errorState(`Gagal memuat buku besar: ${err.message}`))
    return
  }
  if (ctx.signal?.aborted) return

  let report = null

  function draw() {
    const r = periodRange(period, new Date(), flow.ledger)
    const entries = flow.ledger.filter((l) => inRange(l, r))
    const t = totals(entries)
    const prevT = r.prev ? totals(flow.ledger.filter((l) => inRange(l, r.prev))) : null
    const margin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : null

    periodLine.lastChild.textContent = `Periode ${r.label} · ${entries.length} jurnal${r.prev ? ` · pembanding: ${r.prev.label}` : ''}`

    const cmp = (cur, prev, invert = false) => {
      if (!prevT || !(prev > 0)) return { sub: prevT ? `${r.prev.label}: ${C.rupiah(prev || 0)}` : null, tone: null }
      const pct = ((cur - prev) / prev) * 100
      const good = invert ? pct < 0 : pct > 0
      return { sub: `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% vs ${r.prev.label}`, tone: pct === 0 ? null : good ? 'ok' : 'danger' }
    }
    const cRev = cmp(t.revenue, prevT?.revenue)
    const cCost = cmp(t.cost, prevT?.cost, true)
    const cProfit = cmp(t.profit, prevT?.profit)
    kpis.replaceChildren(
      C.kpi({ label: 'Laba bersih', hero: true, iconName: 'sprout', value: C.rupiah(t.profit), countTo: t.profit, format: C.rupiah, sub: cProfit.sub, tone: cProfit.tone }),
      C.kpi({ label: 'Pendapatan', iconName: 'wallet', value: C.rupiah(t.revenue), countTo: t.revenue, format: C.rupiah, sub: cRev.sub, tone: cRev.tone }),
      C.kpi({ label: 'Biaya', iconName: 'receipt', value: C.rupiah(t.cost), countTo: t.cost, format: C.rupiah, sub: cCost.sub, tone: cCost.tone }),
      C.kpi({ label: 'Margin', iconName: 'activity', value: margin == null ? '—' : `${margin.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`, sub: margin == null ? 'Belum ada pendapatan' : `Biaya ${Math.round((t.cost / t.revenue) * 100)}% dari pendapatan` }),
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
    catPanel.querySelector('.panel-meta').textContent = `${cats.length} kategori`
    const max = Math.max(1, ...cats.map((c) => c.amount))
    catBody.replaceChildren(cats.length
      ? C.dataTable({
          caption: 'Rincian kategori',
          rows: cats,
          columns: [
            { label: 'Kategori', render: (c) => el('span', { className: c.cat === 'pendapatan' ? 'strong' : '' }, categoryLabel(c.cat)) },
            { label: 'Jurnal', align: 'right', render: (c) => el('span', { className: 'tnum' }, String(c.n)) },
            { label: 'Porsi', className: 'col-bar', render: (c) => el('span', { className: `bars-track ${c.cat === 'pendapatan' ? 'is-rev' : ''}` }, el('span', { className: 'bars-fill', style: `width:${(c.amount / max) * 100}%` })) },
            { label: 'Jumlah', align: 'right', render: (c) => el('span', { className: 'tnum' }, C.rupiah(c.amount)) },
          ],
        })
      : emptyForPeriod())

    // Customers
    const byCust = new Map()
    for (const l of entries.filter(isRevenue)) {
      const req = flow.requestOfLedger(l)
      const k = req ? String(req.id) : 'x'
      const cur = byCust.get(k) || { name: customerLabel(req), service: req?.service_type, amount: 0 }
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
      : C.emptyState({ kicker: 'Kosong', title: 'Belum ada pendapatan di periode ini.' }))

    report = {
      period: r.label,
      period_start: r.from.toISOString().slice(0, 10),
      period_end: new Date(r.to.getTime() - 1).toISOString().slice(0, 10),
      total_revenue: t.revenue,
      total_cost: t.cost,
      net_profit: t.profit,
      margin_pct: margin == null ? null : Number(margin.toFixed(1)),
      previous_period: prevT ? { label: r.prev.label, total_revenue: prevT.revenue, total_cost: prevT.cost, net_profit: prevT.profit } : null,
      by_category: cats.map((c) => ({ category: c.cat, label: categoryLabel(c.cat), amount: c.amount, entries: c.n })),
      top_customers: custs.map((c) => ({ name: c.name, service: c.service, revenue: c.amount })),
      entries: entries.map((l) => ({ id: l.id, category: l.category, amount: Number(l.amount) || 0, posted_at: ledgerDate(l) })),
    }
    explainBtn.disabled = entries.length === 0
    if (!entries.length) msg.show('info', 'Tidak ada jurnal di periode ini, jadi belum ada yang bisa dijelaskan.')
    else msg.hide()
  }

  function emptyForPeriod() {
    const box = C.emptyState({ kicker: 'Periode kosong', title: 'Tidak ada jurnal di periode ini.', body: flow.ledger.length ? 'Coba periode lain, atau posting jurnal baru.' : 'Posting jurnal di tahap 05 agar laporan terisi.' })
    if (!flow.ledger.length) {
      const go = C.button({ label: 'Ke pembukuan', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
      go.addEventListener('click', () => navigate('bookkeeping'))
      box.appendChild(go)
    }
    return box
  }

  /* ------------------------------------------------------- AI explain */
  let current = null
  ctx.signal?.addEventListener('abort', () => current?.abort())

  explainBtn.addEventListener('click', async () => {
    msg.hide()
    if (!model) { msg.show('danger', 'Model AI tidak tersedia. Periksa koneksi lalu muat ulang halaman.'); return }
    if (!report) return
    current?.abort()
    const ac = new AbortController()
    current = ac
    const restore = C.setBusy(explainBtn, 'Menganalisis…')
    const ui = C.aiConsole({ model: model.id })
    ui.onStop(() => ac.abort())
    ui.setStatus('Menulis…', true)
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
      ui.setStatus('Selesai', false)
      showToast('Penjelasan laporan selesai.', 'success')
    } catch (err) {
      ui.done()
      if (err.name === 'AbortError') {
        ui.setStatus('Dihentikan', false)
        msg.show('info', 'Penjelasan dihentikan.')
      } else {
        ui.setStatus('Gagal', false)
        msg.show('danger', err.message)
      }
    } finally {
      if (current === ac) current = null
      restore()
      explainBtn.disabled = !report?.entries.length
    }
  })

  draw()
}

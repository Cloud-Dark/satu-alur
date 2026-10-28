/**
 * Deterministic tools for the AI business adviser. Everything here is pure:
 * it turns the user's own flow data (requests → ledger) into numbers and text
 * the model receives as grounding context. Nothing is invented: when data is
 * missing the snapshot says so instead of guessing.
 */
import { totals, ledgerDate, isRevenue, categoryLabel, customerLabel } from '../stages/data.js'

const DAY = 86400000
const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
export const rp = (n) => idr.format(Math.round(Number(n) || 0))
export const pct = (n, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: digits })}%`)
export const pctPlain = (n, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n.toLocaleString('id-ID', { maximumFractionDigits: digits })}%`)
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthName = (d) => d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
const monthShort = (d) => d.toLocaleDateString('id-ID', { month: 'short' })
const toDate = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null }
const growth = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)

/** Counts distinct jobs among revenue entries (one completion = one job). */
function jobCount(entries) {
  const ids = new Set()
  let loose = 0
  for (const l of entries) {
    if (!isRevenue(l)) continue
    if (l.completion_id != null) ids.add(String(l.completion_id))
    else loose++
  }
  return ids.size + loose
}

function sumBy(rows, keyFn, valFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    const cur = m.get(k) || { key: k, amount: 0, n: 0 }
    cur.amount += valFn(r)
    cur.n += 1
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}

/**
 * Builds the business snapshot from the joined flow model (stages/data.js).
 * All money is in Rupiah, all percentages are numbers (12.5 = 12,5%).
 */
export function buildSnapshot(flow, now = new Date()) {
  const ledger = (flow?.ledger || []).filter((l) => toDate(ledgerDate(l)))
  const requests = flow?.requests || []
  const offers = flow?.offers || []
  const assignments = flow?.assignments || []
  const completions = flow?.completions || []
  const at = (l) => toDate(ledgerDate(l)).getTime()

  /* Months: the current (partial) month and the five before it. */
  const months = []
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const rows = ledger.filter((l) => at(l) >= start.getTime() && at(l) < end.getTime())
    const t = totals(rows)
    months.push({ key: monthKey(start), label: monthName(start), short: monthShort(start), partial: i === 0, ...t, jobs: jobCount(rows), entries: rows.length })
  }
  for (let i = 1; i < months.length; i++) months[i].growth = growth(months[i].revenue, months[i - 1].revenue)
  const current = months[months.length - 1]
  const lastFull = months[months.length - 2]
  const prevFull = months[months.length - 3]
  const momGrowth = growth(lastFull.revenue, prevFull.revenue)

  // Compound monthly growth across the full months that have revenue.
  const full = months.slice(0, -1)
  const firstIdx = full.findIndex((m) => m.revenue > 0)
  let cmgr = null
  let cmgrSpan = 0
  if (firstIdx >= 0 && firstIdx < full.length - 1 && full[full.length - 1].revenue > 0) {
    cmgrSpan = full.length - 1 - firstIdx
    if (cmgrSpan >= 2) cmgr = (Math.pow(full[full.length - 1].revenue / full[firstIdx].revenue, 1 / cmgrSpan) - 1) * 100
  }

  /* Rolling 30-day windows (work even when months are sparse). */
  const endT = now.getTime()
  const win = (fromDays, toDays) => ledger.filter((l) => at(l) > endT - fromDays * DAY && at(l) <= endT - toDays * DAY)
  const last30Rows = win(30, 0)
  const prev30Rows = win(60, 30)
  const last30 = { ...totals(last30Rows), jobs: jobCount(last30Rows) }
  const prev30 = { ...totals(prev30Rows), jobs: jobCount(prev30Rows) }
  const growth30 = growth(last30.revenue, prev30.revenue)

  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const runRate = current.revenue > 0 ? (current.revenue / now.getDate()) * dim : 0

  const all = totals(ledger)
  const allJobs = jobCount(ledger)
  const avgJob = allJobs > 0 ? all.revenue / allJobs : 0
  const margin = all.revenue > 0 ? (all.profit / all.revenue) * 100 : null
  const margin30 = last30.revenue > 0 ? (last30.profit / last30.revenue) * 100 : null

  // Baseline monthly revenue for the growth calculator.
  let base = { revenue: 0, label: 'belum ada pendapatan' }
  if (lastFull.revenue > 0) base = { revenue: lastFull.revenue, label: `bulan lalu (${lastFull.label})` }
  else if (last30.revenue > 0) base = { revenue: last30.revenue, label: '30 hari terakhir' }
  else if (all.revenue > 0) base = { revenue: all.revenue, label: 'total tercatat' }

  /* Funnel */
  const withOffer = requests.filter((r) => flow.offersOf(r.id).length > 0).length
  const approved = offers.filter((o) => o.status === 'approved')
  const approvedAssigned = approved.filter((o) => flow.assignmentsOf(o.id).length > 0).length
  const assignmentsDone = assignments.filter((a) => flow.completionsOf(a.id).length > 0).length
  const booked = completions.filter((c) => flow.ledgerOf(c.id).length > 0).length
  const rate = (a, b) => (b > 0 ? (a / b) * 100 : null)
  const conversion = {
    requests: requests.length,
    requestToOffer: rate(withOffer, requests.length),
    offerApproved: rate(approved.length, offers.length),
    approvedToAssigned: rate(approvedAssigned, approved.length),
    assignedToDone: rate(assignmentsDone, assignments.length),
    doneToBooked: rate(booked, completions.length),
  }
  const offerPrice = (o) => Number(o.validated_price ?? o.ai_proposal_json?.price) || 0
  const avgOffer = approved.length ? approved.reduce((s, o) => s + offerPrice(o), 0) / approved.length : 0

  /* Mix */
  const revRows = ledger.filter(isRevenue)
  const reqOf = (l) => flow.requestOfLedger?.(l) || null
  const services = sumBy(revRows, (l) => reqOf(l)?.service_type || 'Tidak diketahui', (l) => Number(l.amount) || 0)
    .slice(0, 4).map((s) => ({ name: s.key, revenue: s.amount, jobs: s.n, share: all.revenue > 0 ? (s.amount / all.revenue) * 100 : null }))
  const demand = sumBy(requests, (r) => r.service_type || 'Lainnya', () => 1).slice(0, 4).map((s) => ({ name: s.key, requests: s.n }))
  const customers = sumBy(revRows, (l) => customerLabel(reqOf(l)), (l) => Number(l.amount) || 0)
    .slice(0, 4).map((c) => ({ name: c.key, revenue: c.amount, share: all.revenue > 0 ? (c.amount / all.revenue) * 100 : null }))
  const costMix = sumBy(ledger.filter((l) => !isRevenue(l)), (l) => l.category, (l) => Number(l.amount) || 0)
    .map((c) => ({ category: c.key, label: categoryLabel(c.key), amount: c.amount, ofRevenue: all.revenue > 0 ? (c.amount / all.revenue) * 100 : null, ofCost: all.cost > 0 ? (c.amount / all.cost) * 100 : null }))

  const byCustomer = new Map()
  for (const r of requests) {
    const k = String(r.customer_name || '').trim().toLowerCase()
    if (k) byCustomer.set(k, (byCustomer.get(k) || 0) + 1)
  }
  const repeat = { customers: byCustomer.size, returning: [...byCustomer.values()].filter((n) => n > 1).length }

  /* Pending work */
  const drafts = flow.draftOffers ? flow.draftOffers() : []
  const pending = {
    requestsWithoutOffer: flow.requestsWithoutOffer ? flow.requestsWithoutOffer().length : 0,
    draftOffers: drafts.length,
    draftValue: drafts.reduce((s, o) => s + offerPrice(o), 0),
    approvedWithoutAssignment: flow.approvedWithoutAssignment ? flow.approvedWithoutAssignment().length : 0,
    activeAssignments: flow.activeAssignments ? flow.activeAssignments().length : 0,
    completionsWithoutLedger: flow.completionsWithoutLedger ? flow.completionsWithoutLedger().length : 0,
  }

  return {
    asOf: now.toISOString(),
    asOfLabel: now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    hasLedger: ledger.length > 0,
    hasData: ledger.length > 0 || requests.length > 0,
    counts: { requests: requests.length, offers: offers.length, assignments: assignments.length, completions: completions.length, ledger: ledger.length },
    months, current, lastFull, prevFull, momGrowth, cmgr, cmgrSpan,
    last30, prev30, growth30, runRate,
    all, allJobs, avgJob, margin, margin30, base,
    conversion, avgOffer, services, demand, customers, costMix, repeat, pending,
  }
}

/** Compact Indonesian text block the model receives as grounding. */
export function snapshotToContext(s) {
  const L = []
  L.push('[DATA BISNIS PENGGUNA — dihitung otomatis dari database Satu Alur. Pakai angka ini apa adanya; jangan mengarang angka lain.]')
  L.push(`Tanggal hari ini: ${s.asOfLabel}`)
  if (!s.hasData) {
    L.push('Status data: belum ada data (belum ada permintaan maupun jurnal). Beri saran umum yang tetap konkret dan minta pengguna mulai mencatat permintaan, penawaran, dan jurnal agar saran berikutnya berbasis angka.')
    return L.join('\n')
  }
  L.push(`Jumlah data: ${s.counts.requests} permintaan, ${s.counts.offers} penawaran, ${s.counts.assignments} penugasan, ${s.counts.completions} penyelesaian, ${s.counts.ledger} jurnal.`)
  if (s.hasLedger) {
    L.push('Pendapatan per bulan (pendapatan / biaya / laba / pekerjaan):')
    for (const m of s.months) {
      if (!m.entries && m !== s.current) continue
      L.push(`- ${m.label}${m.partial ? ' (berjalan)' : ''}: ${rp(m.revenue)} / ${rp(m.cost)} / ${rp(m.profit)} / ${m.jobs} pekerjaan${m.growth != null ? `; pendapatan ${pct(m.growth)} vs bulan sebelumnya` : ''}`)
    }
    L.push(`Pertumbuhan bulan ke bulan (${s.prevFull.label} ke ${s.lastFull.label}): ${s.momGrowth == null ? 'belum bisa dihitung (bulan pembanding tanpa pendapatan)' : pct(s.momGrowth)}`)
    if (s.cmgr != null) L.push(`Rata-rata pertumbuhan majemuk per bulan (${s.cmgrSpan} bulan): ${pct(s.cmgr)}`)
    L.push(`Pendapatan 30 hari terakhir: ${rp(s.last30.revenue)} (30 hari sebelumnya: ${rp(s.prev30.revenue)}${s.growth30 != null ? `, ${pct(s.growth30)}` : ''})`)
    L.push(`Laba 30 hari terakhir: ${rp(s.last30.profit)}${s.margin30 != null ? `; margin ${pctPlain(s.margin30)}` : ''}`)
    if (s.runRate > 0) L.push(`Proyeksi linear bulan berjalan: ${rp(s.runRate)}`)
    L.push(`Total tercatat: pendapatan ${rp(s.all.revenue)}, biaya ${rp(s.all.cost)}, laba ${rp(s.all.profit)}${s.margin != null ? `, margin ${pctPlain(s.margin)}` : ''}`)
    L.push(`Rata-rata nilai pekerjaan: ${s.avgJob > 0 ? rp(s.avgJob) : '—'} (${s.allJobs} pekerjaan terbukukan)`)
  } else {
    L.push('Belum ada jurnal pembukuan, jadi pendapatan dan biaya belum bisa dihitung.')
  }
  if (s.avgOffer > 0) L.push(`Rata-rata nilai penawaran disetujui: ${rp(s.avgOffer)}`)
  const c = s.conversion
  L.push(`Konversi: permintaan→penawaran ${pctPlain(c.requestToOffer, 0)}, penawaran disetujui ${pctPlain(c.offerApproved, 0)}, disetujui→ditugaskan ${pctPlain(c.approvedToAssigned, 0)}, ditugaskan→selesai ${pctPlain(c.assignedToDone, 0)}, selesai→dibukukan ${pctPlain(c.doneToBooked, 0)}`)
  if (s.services.length) L.push(`Layanan teratas (pendapatan): ${s.services.map((x) => `${x.name} ${rp(x.revenue)}${x.share != null ? ` (${pctPlain(x.share, 0)})` : ''}`).join('; ')}`)
  if (s.demand.length) L.push(`Layanan paling banyak diminta: ${s.demand.map((x) => `${x.name} (${x.requests} permintaan)`).join('; ')}`)
  if (s.customers.length) L.push(`Pelanggan teratas: ${s.customers.map((x) => `${x.name} ${rp(x.revenue)}${x.share != null ? ` (${pctPlain(x.share, 0)})` : ''}`).join('; ')}`)
  if (s.repeat.customers) L.push(`Pelanggan berulang: ${s.repeat.returning} dari ${s.repeat.customers} pelanggan`)
  if (s.costMix.length) {
    const top = s.costMix[0]
    L.push(`Biaya terbesar: ${top.label} ${rp(top.amount)}${top.ofRevenue != null ? ` (${pctPlain(top.ofRevenue)} dari pendapatan)` : ''}`)
    L.push(`Komposisi biaya: ${s.costMix.map((x) => `${x.label} ${rp(x.amount)}${x.ofCost != null ? ` (${pctPlain(x.ofCost, 0)} biaya)` : ''}`).join('; ')}`)
  }
  const p = s.pending
  L.push(`Pekerjaan tertunda: ${p.requestsWithoutOffer} permintaan belum ditawar, ${p.draftOffers} draf penawaran${p.draftValue ? ` senilai ${rp(p.draftValue)}` : ''}, ${p.approvedWithoutAssignment} penawaran disetujui belum ditugaskan, ${p.activeAssignments} penugasan berjalan, ${p.completionsWithoutLedger} penyelesaian belum dibukukan`)
  return L.join('\n')
}

/* ------------------------------------------------------- Growth target */

export const GROWTH_PRESETS = [1, 2, 5, 10]

/** Plain-language tier for a monthly growth target. */
export function growthTier(p) {
  if (!(p > 0)) return { tone: 'neutral', label: 'Isi target pertumbuhan per bulan.' }
  if (p <= 2) return { tone: 'ok', label: 'Realistis untuk usaha perorangan dan UKM (1–2% per bulan).' }
  if (p < 5) return { tone: 'brand', label: 'Di atas rata-rata UKM: butuh dorongan pemasaran yang konsisten.' }
  if (p <= 10) return { tone: 'warn', label: 'Agresif, setara target enterprise (5–10% per bulan): butuh investasi pemasaran dan kapasitas tim.' }
  return { tone: 'danger', label: 'Sangat agresif: pastikan kapasitas, kas, dan kualitas siap menampung.' }
}

/**
 * Projects monthly revenue at a compound monthly growth rate.
 * Returns the 12-month series plus milestone rows for months 3, 6 and 12.
 */
export function growthProjection({ base, pct: p, avgJob, horizon = 12 }) {
  const b = Math.max(0, Number(base) || 0)
  const g = (Number(p) || 0) / 100
  const job = Math.max(0, Number(avgJob) || 0)
  const series = Array.from({ length: horizon + 1 }, (_, m) => ({ month: m, revenue: b * Math.pow(1 + g, m) }))
  const baseJobs = job > 0 ? b / job : null
  const rows = [3, 6, 12].filter((m) => m <= horizon).map((m) => {
    const revenue = series[m].revenue
    return {
      month: m,
      revenue,
      delta: revenue - b,
      jobs: job > 0 ? revenue / job : null,
      extraJobs: job > 0 ? (revenue - b) / job : null,
    }
  })
  const cumulativeExtra = series.slice(1).reduce((s, x) => s + (x.revenue - b), 0)
  return {
    base: b, pct: Number(p) || 0, avgJob: job, baseJobs,
    series, rows,
    annualPct: (Math.pow(1 + g, 12) - 1) * 100,
    cumulativeExtra,
    nextMonthExtraJobs: job > 0 ? (b * g) / job : null,
  }
}

/** Text block for the model, so advice quotes the same calculator numbers. */
export function projectionToContext(proj, { source = 'kalkulator' } = {}) {
  if (!(proj.base > 0)) return `[KALKULATOR TARGET — ${source}] Target ${pctPlain(proj.pct)} per bulan, tetapi pendapatan dasar belum ada sehingga proyeksi belum bisa dihitung.`
  const L = [`[KALKULATOR TARGET — ${source}, dihitung deterministik di aplikasi]`]
  L.push(`Target pertumbuhan: ${pctPlain(proj.pct)} per bulan (setara ${pctPlain(proj.annualPct)} per tahun); pendapatan dasar ${rp(proj.base)} per bulan${proj.avgJob > 0 ? `; rata-rata nilai pekerjaan ${rp(proj.avgJob)}` : ''}.`)
  for (const r of proj.rows) {
    L.push(`- Bulan ke-${r.month}: ${rp(r.revenue)} per bulan (tambahan ${rp(r.delta)}${r.extraJobs != null ? `; perlu ±${fmtJobs(r.jobs)} pekerjaan per bulan, tambahan ${fmtJobs(r.extraJobs)} pekerjaan` : ''})`)
  }
  if (proj.nextMonthExtraJobs != null) L.push(`Bulan depan saja: tambahan ${rp(proj.base * proj.pct / 100)} atau ±${fmtJobs(proj.nextMonthExtraJobs)} pekerjaan.`)
  L.push(`Tambahan pendapatan kumulatif 12 bulan: ${rp(proj.cumulativeExtra)}.`)
  return L.join('\n')
}

export function fmtJobs(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('id-ID', { maximumFractionDigits: n < 1 ? 2 : n < 10 ? 1 : 0 })
}

/** Finds a monthly growth target in a question ("naik 2%", "5 persen"). */
export function parseTargetPct(text) {
  const m = String(text || '').match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|persen)/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return n > 0 && n <= 100 ? n : null
}

/**
 * Radar peluang — deterministic opportunity detection over the account's own
 * flow data (requests → offers → assignments → completions → ledger).
 *
 * Pure functions only: no DOM, no network, no imports. `buildRadar(flow, { now })`
 * accepts the loadFlow() model from stages/data.js or a plain object with the
 * same arrays ({ requests, offers, assignments, completions, ledger | ledger_entries }),
 * so it runs unchanged in the browser and in node:test.
 *
 * Nothing here is invented: every opportunity carries the rows it was derived
 * from (evidence), each score is a weighted sum of named factors, and success
 * rates come from the account's own history with the sample size attached.
 * When a sample is too small the rate is reported as unavailable.
 */

export const DAY = 86400000

/* ----------------------------------------------------------- Constants */

/** Opportunity types. Order = default display order of the filter. */
export const OPP_TYPES = {
  due: { label: 'Layanan berulang', short: 'Jatuh tempo', icon: 'refresh', tone: 'brand' },
  churn: { label: 'Risiko churn', short: 'Risiko churn', icon: 'trendingDown', tone: 'danger' },
  upsell: { label: 'Upsell kontrak', short: 'Upsell', icon: 'handshake', tone: 'live' },
  cross: { label: 'Cross-sell', short: 'Cross-sell', icon: 'layers', tone: 'brand' },
  pending: { label: 'Penawaran tertunda', short: 'Tertunda', icon: 'clock', tone: 'warn' },
  reapproach: { label: 'Tawarkan ulang', short: 'Tawarkan ulang', icon: 'send', tone: 'neutral' },
  season: { label: 'Musiman', short: 'Musiman', icon: 'calendar', tone: 'live' },
}
export const OPP_TYPE_KEYS = Object.keys(OPP_TYPES)

export const RULES = {
  mergeGapDays: 7, // requests closer than this count as one visit
  minIntervalDays: 14,
  maxIntervalDays: 400,
  dueAheadDays: 14, // show "due" this many days before the expected date
  dueMaxRatio: 1.5, // beyond 1.5× the usual interval it becomes churn
  churnRatio: 1.5,
  churnMinJobs: 3,
  churnMinGapDays: 21,
  churnMaxDays: 365,
  upsellJobs: 3,
  upsellWindowDays: 180,
  crossMinSupport: 4,
  crossMinConf: 0.25,
  crossMinLift: 1.2,
  crossActiveDays: 180,
  pendingDays: 3,
  pendingMaxDays: 90, // older open requests/offers are treated as stale, not opportunities
  reapproachDays: 365,
  seasonHorizonDays: 120,
  seasonMinRequests: 5,
  seasonMinUplift: 0.15,
  minRepurchase: 0.1, // a service counts as recurring only if ≥10% of visits are repeated in time
  minSample: 8, // below this a historical rate is "belum cukup data"
  highScore: 70,
  midScore: 50,
}

/**
 * Seasonal windows (Indonesia). Dates are approximate calendar knowledge, not
 * account data; the account's own history decides whether a window matters.
 * `keywords` are used only when the account has no history for that window.
 */
export const SEASONS = [
  {
    id: 'hujan', label: 'Musim hujan', note: 'perkiraan umum November–Maret',
    range: (y) => [`${y}-11-01`, `${y + 1}-03-31`],
    keywords: /bocor|atap|waterproof|talang|rayap|nyamuk|fogging|hama|pest|korsleting|listrik|pompa|kiloan|laundry|disinfeksi|sanitasi|banjir|genset/i,
  },
  {
    id: 'akhir-tahun', label: 'Akhir tahun', note: 'persiapan Natal–Tahun Baru dan serapan anggaran, ±10–23 Desember',
    range: (y) => [`${y}-12-10`, `${y}-12-23`],
    keywords: /deep clean|bersih|cat|pengecatan|gorden|karpet|kaca|fasad|renovasi|kantor|hotel/i,
  },
  {
    id: 'lebaran', label: 'Ramadan & menjelang Lebaran', note: 'perkiraan awal Ramadan sampai H-5 Idulfitri; cek kalender resmi',
    // Approximate (hisab): Ramadan start → five days before Idulfitri.
    range: (y) => ({
      2025: ['2025-03-01', '2025-03-25'],
      2026: ['2026-02-18', '2026-03-15'],
      2027: ['2027-02-08', '2027-03-05'],
      2028: ['2028-01-28', '2028-02-21'],
    })[y] || null,
    keywords: /ac|cuci|bersih|cat|karpet|gorden|sofa|deep|kaca|bed cover/i,
  },
  {
    id: 'libur-sekolah', label: 'Libur sekolah', note: 'perkiraan pertengahan Juni–pertengahan Juli',
    range: (y) => [`${y}-06-15`, `${y}-07-15`],
    keywords: /hotel|linen|sekolah|mal|villa|kolam/i,
  },
  {
    id: 'kemarau', label: 'Puncak kemarau', note: 'perkiraan Juli–Oktober',
    range: (y) => [`${y}-07-01`, `${y}-10-31`],
    keywords: /\bac\b|cat|eksterior|waterproof|coating|taman|kolam/i,
  },
]

const OFFER_STATUS = { draft: 'draf', pending: 'menunggu', pending_approval: 'menunggu persetujuan', approved: 'disetujui', rejected: 'ditolak' }
const ROUTINE_RE = /kontrak|langganan|berlangganan|tagihan|rekap/i
const AGGREGATE_RE = /walk-?in|pelanggan umum|tanpa nama|kasir harian/i

/* ------------------------------------------------------------- Helpers */

const toDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
const key = (v) => (v == null ? '' : String(v))
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const round = (n, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f }
const days = (ms) => ms / DAY

export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Same grouping as stages/data.js customerKey (name, case/space-insensitive). */
export function customerKeyOf(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}
const serviceKeyOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** 32-bit FNV-1a hex — stable, short ids for opportunity keys. */
export function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
const oppKey = (type, ...parts) => `${type}:${hash(parts.map((p) => key(p)).join('|'))}`

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
export const rp = (n) => idr.format(Math.round(Number(n) || 0))
export const fmtDate = (d) => (toDate(d) ? toDate(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtDays = (n) => `${Math.round(n).toLocaleString('id-ID')} hari`
export const pctText = (r, digits = 0) => (r == null || !Number.isFinite(r) ? '—' : `${(r * 100).toLocaleString('id-ID', { maximumFractionDigits: digits })}%`)
const ymd = (d) => toDate(d).toISOString().slice(0, 10)

/** Wilson 95% interval for a proportion. */
export function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return null
  const p = k / n
  const den = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / den
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) }
}

/** A historical rate with its sample; `enough` is false when n < minSample. */
export function rate(k, n, basis, minSample = RULES.minSample) {
  const enough = n >= minSample
  const ci = wilson(k, n)
  return { k, n, rate: n > 0 ? k / n : null, enough, lo: ci?.lo ?? null, hi: ci?.hi ?? null, basis }
}

const offerPrice = (o) => {
  const v = Number(o?.validated_price ?? o?.ai_proposal_json?.price)
  return Number.isFinite(v) && v > 0 ? v : 0
}
const isApproved = (o) => o?.status === 'approved'
const isRejected = (o) => o?.status === 'rejected'
const isOpenOffer = (o) => o && !isApproved(o) && !isRejected(o)

/* ------------------------------------------------------------ Prepare */

/**
 * Normalises the flow into per-request facts, customers and services.
 * Exported for tests and the Prediksi tab.
 */
export function prepare(flow, now = new Date()) {
  const requests = flow?.requests || []
  const offers = flow?.offers || []
  const assignments = flow?.assignments || []
  const completions = flow?.completions || []
  const ledger = flow?.ledger || flow?.ledger_entries || []
  const nowT = toDate(now).getTime()

  const group = (rows, col) => {
    const m = new Map()
    for (const r of rows) {
      const k = key(r[col])
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return m
  }
  const offersByReq = group(offers, 'request_id')
  const assignsByOffer = group(assignments, 'offer_id')
  const complByAssign = group(completions, 'assignment_id')
  const ledgerByCompl = group(ledger, 'completion_id')

  const facts = []
  for (const r of requests) {
    const at = toDate(r.created_at)
    if (!at || at.getTime() > nowT) continue
    const offs = (offersByReq.get(key(r.id)) || []).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    const approved = offs.filter(isApproved)
    const rejected = offs.filter(isRejected)
    const open = offs.filter(isOpenOffer)
    let revenue = 0
    let completed = false
    for (const o of offs) {
      for (const a of assignsByOffer.get(key(o.id)) || []) {
        for (const c of complByAssign.get(key(a.id)) || []) {
          completed = true
          for (const l of ledgerByCompl.get(key(c.id)) || []) {
            if (l.category === 'pendapatan') revenue += Number(l.amount) || 0
          }
        }
      }
    }
    const price = approved.length ? offerPrice(approved[approved.length - 1]) : 0
    const status = approved.length || completed ? 'job' : offs.length && rejected.length === offs.length ? 'rejected' : open.length ? 'open' : offs.length ? 'open' : 'new'
    const service = String(r.service_type || '').trim() || 'Layanan'
    const custName = String(r.customer_name || '').trim()
    const routine = ROUTINE_RE.test(service) || /tagihan kontrak/i.test(String(r.description || ''))
    facts.push({
      id: r.id,
      req: r,
      at,
      t: at.getTime(),
      service,
      sKey: serviceKeyOf(service),
      cKey: customerKeyOf(custName),
      name: custName || 'Pelanggan tidak dikenal',
      phone: r.phone || null,
      location: r.location || null,
      status, // job | rejected | open | new
      offers: offs,
      openOffers: open,
      rejectedOffers: rejected,
      revenue,
      value: revenue > 0 ? revenue : price,
      routine,
      aggregate: !custName || AGGREGATE_RE.test(custName),
    })
  }
  facts.sort((a, b) => a.t - b.t)

  /* Customers */
  const customers = new Map()
  for (const f of facts) {
    if (f.aggregate) continue
    let c = customers.get(f.cKey)
    if (!c) {
      c = { key: f.cKey, name: f.name, phone: null, location: null, facts: [], jobs: [], services: new Map(), routine: false, revenue: 0 }
      customers.set(f.cKey, c)
    }
    c.name = f.name
    if (f.phone) c.phone = f.phone
    if (f.location) c.location = f.location
    c.facts.push(f)
    if (f.status === 'job') {
      c.jobs.push(f)
      c.revenue += f.value
      if (f.routine) c.routine = true
      if (!c.services.has(f.sKey)) c.services.set(f.sKey, { key: f.sKey, name: f.service, jobs: [] })
      c.services.get(f.sKey).jobs.push(f)
    }
  }
  for (const c of customers.values()) {
    c.visits = visitsOf(c.jobs)
    c.intervals = intervalsOf(c.visits)
    c.lastJob = c.jobs[c.jobs.length - 1] || null
    c.lastFact = c.facts[c.facts.length - 1] || null
    for (const s of c.services.values()) {
      s.visits = visitsOf(s.jobs)
      s.intervals = intervalsOf(s.visits)
      s.avgValue = mean(s.jobs.map((j) => j.value).filter((v) => v > 0))
    }
    c.avgValue = mean(c.jobs.map((j) => j.value).filter((v) => v > 0))
  }

  /* Services (account-wide) */
  const services = new Map()
  for (const f of facts) {
    if (f.aggregate) continue
    let s = services.get(f.sKey)
    if (!s) {
      s = { key: f.sKey, name: f.service, routine: f.routine, requests: 0, jobs: 0, values: [], intervals: [], customers: new Set(), repeatCustomers: 0 }
      services.set(f.sKey, s)
    }
    s.requests++
    if (f.status === 'job') {
      s.jobs++
      if (f.value > 0) s.values.push(f.value)
      s.customers.add(f.cKey)
    }
    if (f.routine) s.routine = true
  }
  for (const c of customers.values()) {
    for (const cs of c.services.values()) {
      const s = services.get(cs.key)
      if (!s) continue
      s.intervals.push(...cs.intervals)
      if (cs.visits.length > 1) s.repeatCustomers++
    }
  }
  for (const s of services.values()) {
    s.medianValue = median(s.values)
    s.medianInterval = median(s.intervals)
    // Candidate only; conversionStats() confirms it with the repurchase rate.
    s.recurrent = !s.routine && s.intervals.length >= 5 && s.repeatCustomers >= 3 &&
      s.medianInterval >= RULES.minIntervalDays && s.medianInterval <= RULES.maxIntervalDays
  }

  const jobValues = facts.filter((f) => f.status === 'job' && f.value > 0 && !f.aggregate).map((f) => f.value).sort((a, b) => a - b)
  const first = facts[0]?.at || null

  return { facts, customers, services, jobValues, first, now: toDate(now), nowT }
}

/** Merge jobs closer than mergeGapDays into one visit (survey + job, split invoices). */
function visitsOf(jobs) {
  const out = []
  for (const j of jobs) {
    const last = out[out.length - 1]
    if (last && j.t - last.t < RULES.mergeGapDays * DAY) { last.jobs.push(j); continue }
    out.push({ t: j.t, at: j.at, jobs: [j] })
  }
  return out
}
const intervalsOf = (visits) => visits.slice(1).map((v, i) => days(v.t - visits[i].t))

/** Share of account job values at or below v (0..1). */
function percentile(sorted, v) {
  if (!sorted.length || !(v > 0)) return 0
  let lo = 0
  let hi = sorted.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m }
  return lo / sorted.length
}

/* -------------------------------------------------------- Conversion */

/**
 * Historical conversion rates from the account's own offers and visits.
 * Used both for the Prediksi tab and for each opportunity's success estimate.
 */
export function conversionStats(P) {
  const { facts, customers, services, nowT } = P
  const decided = (f) => f.offers.filter((o) => isApproved(o) || isRejected(o))

  // Offers: overall, per service, new vs returning (returning = had an earlier job).
  const seenJob = new Map() // cKey -> Set(service keys) of jobs so far
  const tally = () => ({ k: 0, n: 0 })
  const overall = tally()
  const byService = new Map()
  const newCust = tally()
  const returning = tally()
  const returningNewService = tally()
  const returningSameService = tally()
  for (const f of facts) {
    if (f.aggregate) continue
    const prior = seenJob.get(f.cKey)
    for (const o of decided(f)) {
      const ok = isApproved(o) ? 1 : 0
      overall.n++; overall.k += ok
      if (!byService.has(f.sKey)) byService.set(f.sKey, { name: f.service, ...tally() })
      const s = byService.get(f.sKey); s.n++; s.k += ok
      if (!prior) { newCust.n++; newCust.k += ok }
      else {
        returning.n++; returning.k += ok
        if (prior.has(f.sKey)) { returningSameService.n++; returningSameService.k += ok }
        else { returningNewService.n++; returningNewService.k += ok }
      }
    }
    if (f.status === 'job') {
      if (!seenJob.has(f.cKey)) seenJob.set(f.cKey, new Set())
      seenJob.get(f.cKey).add(f.sKey)
    }
  }

  // Natural repurchase: share of visits of a recurrent service followed by
  // another visit of that service within 1.5× its median interval.
  const repurchase = new Map()
  for (const s of services.values()) {
    if (!s.recurrent) continue
    const W = s.medianInterval * RULES.dueMaxRatio
    let n = 0
    let k = 0
    let nr = 0
    let kr = 0
    for (const c of customers.values()) {
      const cs = c.services.get(s.key)
      if (!cs) continue
      cs.visits.forEach((v, i) => {
        if (v.t > nowT - W * DAY) return
        const next = cs.visits[i + 1]
        const back = next && days(next.t - v.t) <= W ? 1 : 0
        n++; k += back
        if (i >= 2) { nr++; kr += back } // the customer already had two earlier visits
      })
    }
    const all = rate(k, n, `kunjungan ${s.name} yang diikuti kunjungan ulang dalam ${fmtDays(W)}`)
    if (!(all.enough && all.rate >= RULES.minRepurchase)) s.recurrent = false
    repurchase.set(s.key, {
      name: s.name, window: W, ...all,
      regular: rate(kr, nr, `kunjungan ${s.name} pelanggan rutin (≥3 kunjungan) yang diikuti kunjungan ulang dalam ${fmtDays(W)}`),
    })
  }

  // Win-back: long gaps (> churnRatio × usual) that ended with a return,
  // versus long gaps still open today.
  let closed = 0
  let open = 0
  for (const c of customers.values()) {
    const iv = c.intervals
    for (let i = 1; i < iv.length; i++) {
      const usual = median(iv.slice(0, i))
      if (usual && iv[i] > RULES.churnRatio * usual && iv[i] >= RULES.churnMinGapDays) closed++
    }
    if (c.visits.length >= RULES.churnMinJobs) {
      const usual = median(iv)
      const gap = days(nowT - c.visits[c.visits.length - 1].t)
      if (usual && gap > RULES.churnRatio * usual && gap >= RULES.churnMinGapDays) open++
    }
  }

  // Contract adoption: share of frequent customers that hold a routine contract.
  const frequent = [...customers.values()].filter((c) => c.visits.length >= RULES.upsellJobs)
  const hasContracts = [...services.values()].some((s) => s.routine && s.jobs > 0)
  const adopted = frequent.filter((c) => c.routine).length

  // Rejection → later purchase.
  let rejCust = 0
  let rejBack = 0
  for (const c of customers.values()) {
    const firstRej = c.facts.find((f) => f.rejectedOffers.length)
    if (!firstRej) continue
    rejCust++
    if (c.jobs.some((j) => j.t > firstRej.t)) rejBack++
  }

  const asRate = (t, basis) => rate(t.k, t.n, basis)
  return {
    overall: asRate(overall, 'semua penawaran yang sudah diputuskan'),
    byService: new Map([...byService].map(([k, v]) => [k, { name: v.name, ...asRate(v, `penawaran ${v.name} yang sudah diputuskan`) }])),
    newCustomer: asRate(newCust, 'penawaran ke pelanggan baru'),
    returning: asRate(returning, 'penawaran ke pelanggan lama'),
    returningSameService: asRate(returningSameService, 'penawaran layanan yang sama ke pelanggan lama'),
    returningNewService: asRate(returningNewService, 'penawaran layanan baru ke pelanggan lama'),
    repurchase,
    winback: rate(closed, closed + open, 'jeda panjang pelanggan rutin yang berakhir dengan order lagi'),
    contract: hasContracts ? rate(adopted, frequent.length, `pelanggan dengan ≥${RULES.upsellJobs} kunjungan yang memakai kontrak/langganan`) : null,
    rejectionReturn: rate(rejBack, rejCust, 'pelanggan yang pernah menolak lalu membeli lagi'),
  }
}

/* ------------------------------------------------------------ Scoring */

/**
 * Weighted factor score. factors: [{ key, label, value (0..1), weight, detail }]
 * Factors with value == null are skipped and the weights renormalised.
 */
export function scoreOf(factors) {
  const used = factors.filter((f) => f.value != null && Number.isFinite(f.value))
  const W = used.reduce((s, f) => s + f.weight, 0)
  if (!W) return { score: 0, factors }
  let total = 0
  for (const f of factors) {
    if (f.value == null || !Number.isFinite(f.value)) { f.contribution = null; f.share = null; continue }
    f.value = clamp01(f.value)
    f.share = f.weight / W
    f.contribution = 100 * f.share * f.value
    total += f.contribution
  }
  return { score: Math.round(total), factors }
}

export function tierOf(score) {
  if (score >= RULES.highScore) return { key: 'high', label: 'Prioritas tinggi', tone: 'ok' }
  if (score >= RULES.midScore) return { key: 'mid', label: 'Prioritas sedang', tone: 'warn' }
  return { key: 'low', label: 'Prioritas rendah', tone: 'neutral' }
}

const W = { timing: 0.3, frequency: 0.15, value: 0.2, confidence: 0.15, chance: 0.2 }

/**
 * Historical success rate as a factor. Without enough history it counts as a
 * neutral 50 (marked `neutral`), so missing data neither boosts nor sinks a card.
 */
function chanceFactor(pred) {
  if (!pred) return { key: 'chance', label: 'Peluang historis', value: 0.5, neutral: true, weight: W.chance, detail: 'Tidak ada riwayat pembanding; dihitung netral (50).' }
  if (!pred.enough) return { key: 'chance', label: 'Peluang historis', value: 0.5, neutral: true, weight: W.chance, detail: `Belum cukup data (${pred.n} sampel, minimal ${RULES.minSample}); dihitung netral (50).` }
  return { key: 'chance', label: 'Peluang historis', value: pred.rate, weight: W.chance, detail: `${pctText(pred.rate)} dari ${pred.n} ${pred.basis}.` }
}
function valueText(P, v) {
  const p = percentile(P.jobValues, v)
  if (!P.jobValues.length) return `${rp(v)}; belum ada nilai pekerjaan pembanding.`
  return p >= 0.995 ? `${rp(v)}, setara pekerjaan dengan nilai tertinggi di akun ini.` : `${rp(v)}, lebih besar dari ${pctText(p)} pekerjaan di akun ini.`
}
const valueFactor = (P, v, detail) => ({ key: 'value', label: 'Nilai', value: percentile(P.jobValues, v), weight: W.value, detail: detail || valueText(P, v) })
const freqFactor = (n, detail) => ({ key: 'frequency', label: 'Frekuensi', value: clamp01(n / 5), weight: W.frequency, detail: detail || `${n} kunjungan tercatat (penuh pada 5).` })
const confFactor = (value, detail) => ({ key: 'confidence', label: 'Keyakinan data', value, weight: W.confidence, detail })
const timeFactor = (value, detail) => ({ key: 'timing', label: 'Waktu', value, weight: W.timing, detail })

/** Regularity: 1 when intervals are steady, lower when they vary a lot. */
function regularity(iv) {
  if (iv.length < 2) return 0.5
  const m = mean(iv)
  const sd = Math.sqrt(mean(iv.map((x) => (x - m) ** 2)))
  return Math.max(0.3, 1 - Math.min(0.7, sd / m / 1.5))
}

const ev = (f, extra = {}) => ({
  date: f.at.toISOString(),
  label: f.service,
  amount: f.value || null,
  status: { job: 'Selesai/dibayar', rejected: 'Ditolak', open: 'Penawaran terbuka', new: 'Belum ditawar' }[f.status],
  requestId: f.id,
  ...extra,
})

function customerRef(c) {
  return { key: c.key, name: c.name, phone: c.phone, location: c.location }
}
function prefillFor(c, service, note) {
  return { customer_name: c.name, phone: c.phone || '', location: c.location || '', service_type: service || '', description: note || '' }
}

/* ------------------------------------------------------------ Detect */

function detectDueAndChurn(P, S, out) {
  const { customers, services, nowT } = P
  for (const c of customers.values()) {
    if (!c.jobs.length) continue
    const lastAny = c.lastFact
    const activeNow = lastAny && lastAny.status !== 'job' && lastAny.status !== 'rejected' && nowT - lastAny.t < 60 * DAY // open request in the pipeline
    const lastVisit = c.visits[c.visits.length - 1]
    const gap = days(nowT - lastVisit.t)

    /* Churn: regular customer gone quiet. */
    let churned = false
    if (!activeNow && c.visits.length >= RULES.churnMinJobs) {
      const usual = median(c.intervals)
      const ratio = usual ? gap / usual : 0
      if (usual && ratio > RULES.churnRatio && gap >= RULES.churnMinGapDays && gap <= Math.max(RULES.churnMaxDays, usual * 4)) {
        churned = true
        const value = c.routine ? (mean(c.jobs.filter((j) => j.routine).map((j) => j.value).filter((v) => v > 0)) || c.avgValue || 0) : (c.avgValue || 0)
        const perYear = 365 / usual
        const pred = S.winback
        const reg = regularity(c.intervals)
        const m = c.intervals.length
        const timing = ratio <= 2 ? 1 : Math.max(0.3, 1 - (ratio - 2) * 0.25)
        const { score, factors } = scoreOf([
          timeFactor(timing, `${fmtDays(gap)} sejak kunjungan terakhir, ${round(ratio, 1).toLocaleString('id-ID')}× jarak biasanya (${fmtDays(usual)}). Makin lama, makin sulit kembali.`),
          freqFactor(c.visits.length),
          valueFactor(P, value),
          confFactor((m / (m + 2)) * reg, `${m} jarak antar-kunjungan; keteraturan ${pctText(reg)}.`),
          chanceFactor(pred),
        ])
        out.push({
          key: oppKey('churn', c.key, ymd(lastVisit.at)),
          type: 'churn',
          customer: customerRef(c),
          service: c.lastJob.service,
          title: c.name,
          why: `Biasanya order tiap ±${fmtDays(usual)}, sudah ${fmtDays(gap)} sejak terakhir (${round(ratio, 1).toLocaleString('id-ID')}×).`,
          action: c.routine ? 'Hubungi PIC: tanyakan apakah kontrak berhenti dan apa yang perlu diperbaiki.' : 'Sapa kembali, tanyakan kepuasan, dan tawarkan jadwal kunjungan berikutnya.',
          score, factors,
          value, valueLabel: c.routine ? 'Tagihan rutin per periode' : 'Nilai rata-rata per kunjungan',
          valueBasis: `Rata-rata ${c.jobs.length} pekerjaan pelanggan ini. Setahun ±${rp(value * perYear)} berisiko hilang.`,
          atRiskYear: value * perYear,
          prediction: pred,
          anchor: lastVisit.at.toISOString(),
          actBy: P.now.toISOString(),
          evidence: c.jobs.slice(-8).map((j) => ev(j)).reverse(),
          facts: { usualDays: usual, gapDays: gap, ratio, visits: c.visits.length, routine: c.routine },
          nav: navForCustomer(c, c.lastJob.service, `Pelanggan lama (terakhir ${fmtDate(lastVisit.at)}).`),
        })
      }
    }
    if (churned || activeNow) continue

    /* Due: per service the customer has bought. */
    for (const cs of c.services.values()) {
      const s = services.get(cs.key)
      if (!s || s.routine) continue
      const last = cs.visits[cs.visits.length - 1]
      const reopened = c.facts.some((f) => f.sKey === cs.key && f.t > last.t && f.status !== 'rejected')
      if (reopened) continue
      const own = cs.intervals
      let interval = null
      let source = ''
      if (own.length >= 2) { interval = median(own); source = 'customer' }
      else if (own.length === 1 && s.recurrent) { interval = (own[0] + s.medianInterval) / 2; source = 'blend' }
      else if (s.recurrent) { interval = s.medianInterval; source = 'service' }
      if (!interval || interval < RULES.minIntervalDays || interval > RULES.maxIntervalDays) continue
      const elapsed = days(nowT - last.t)
      const dueT = last.t + interval * DAY
      const untilDue = days(dueT - nowT)
      const ratio = elapsed / interval
      if (untilDue > RULES.dueAheadDays || ratio > RULES.dueMaxRatio) continue

      const value = cs.avgValue || s.medianValue || 0
      const rep = S.repurchase.get(cs.key) || null
      const pred = rep && source === 'customer' && rep.regular?.enough ? rep.regular : rep
      const m = own.length
      const conf = source === 'customer' ? (m / (m + 2)) * regularity(own)
        : source === 'blend' ? 0.45
          : Math.min(0.4, s.intervals.length / (s.intervals.length + 20))
      const sourceText = source === 'customer' ? `dari ${m} jarak kunjungan pelanggan ini sendiri`
        : source === 'blend' ? `rata-rata jarak pelanggan ini (${fmtDays(own[0])}) dan median akun (${fmtDays(s.medianInterval)})`
          : `median akun untuk ${s.name} (${s.intervals.length} jarak dari ${s.repeatCustomers} pelanggan)`
      // Timing peaks around the expected date and stays high until 1.25×.
      const timing = untilDue > 0 ? 0.55 + 0.45 * (1 - untilDue / RULES.dueAheadDays) : ratio <= 1.25 ? 1 : Math.max(0.5, 1 - (ratio - 1.25) * 2)
      const { score, factors } = scoreOf([
        timeFactor(timing, untilDue > 0 ? `Jatuh tempo dalam ${fmtDays(untilDue)} (${fmtDate(dueT)}).` : `Lewat ${fmtDays(-untilDue)} dari perkiraan (${fmtDate(dueT)}).`),
        freqFactor(cs.visits.length, `${cs.visits.length} kunjungan ${s.name} tercatat (penuh pada 5).`),
        valueFactor(P, value),
        confFactor(conf, `Jarak ±${fmtDays(interval)} ${sourceText}.`),
        chanceFactor(pred),
      ])
      out.push({
        key: oppKey('due', c.key, cs.key, ymd(last.at)),
        type: 'due',
        customer: customerRef(c),
        service: s.name,
        title: c.name,
        why: `${s.name} terakhir ${fmtDate(last.at)}, ${source === 'service' ? `pelanggan ${s.name} umumnya kembali tiap` : 'biasanya tiap'} ±${fmtDays(interval)}: ${untilDue > 0 ? `jatuh tempo ${fmtDate(dueT)}` : `lewat ${fmtDays(-untilDue)}`}.`,
        action: `Hubungi untuk menjadwalkan ${s.name} berikutnya.`,
        score, factors,
        value, valueLabel: 'Perkiraan nilai kunjungan berikutnya',
        valueBasis: cs.avgValue ? `Rata-rata ${cs.jobs.length} pekerjaan ${s.name} pelanggan ini.` : `Median ${s.name} di akun ini (${s.values.length} pekerjaan).`,
        prediction: pred,
        anchor: last.at.toISOString(),
        actBy: new Date(dueT).toISOString(),
        evidence: cs.jobs.slice(-8).map((j) => ev(j)).reverse(),
        facts: { intervalDays: interval, source, dueDate: new Date(dueT).toISOString(), elapsedDays: elapsed, ratio },
        nav: navForCustomer(c, s.name, `Kunjungan rutin ${s.name}; terakhir ${fmtDate(last.at)}.`),
      })
    }
  }
}

function detectUpsell(P, S, out) {
  const { customers, nowT } = P
  const yearRevenue = (c) => c.jobs.filter((j) => j.t > nowT - 365 * DAY).reduce((s, j) => s + j.value, 0)
  const spends = [...customers.values()].map(yearRevenue).filter((v) => v > 0).sort((a, b) => a - b)
  const p90 = spends.length >= 10 ? spends[Math.floor(spends.length * 0.9)] : Infinity
  const contractNames = [...P.services.values()].filter((s) => s.routine && s.jobs > 0).map((s) => s.name)
  for (const c of customers.values()) {
    if (c.routine || !c.jobs.length) continue
    const recent = c.visits.filter((v) => v.t > nowT - RULES.upsellWindowDays * DAY)
    const yearJobs = c.jobs.filter((j) => j.t > nowT - 365 * DAY)
    const spend = yearRevenue(c)
    const frequent = recent.length >= RULES.upsellJobs
    const big = spend >= p90 && c.visits.filter((v) => v.t > nowT - 365 * DAY).length >= 2
    if (!frequent && !big) continue
    const avg = mean(yearJobs.map((j) => j.value).filter((v) => v > 0)) || c.avgValue || 0
    const recentJobs = c.jobs.filter((j) => j.t > nowT - RULES.upsellWindowDays * DAY).length
    const perYear = Math.max(recentJobs * (365 / RULES.upsellWindowDays), yearJobs.length)
    const annual = avg * perYear
    const lastT = c.visits[c.visits.length - 1].t
    const since = days(nowT - lastT)
    const pred = S.contract
    const topService = [...c.services.values()].sort((a, b) => b.jobs.length - a.jobs.length)[0]
    const { score, factors } = scoreOf([
      timeFactor(since <= 30 ? 1 : Math.max(0.3, 1 - (since - 30) / 200), `Kunjungan terakhir ${fmtDays(since)} lalu; makin baru makin mudah ditawari.`),
      freqFactor(recent.length, `${recent.length} kunjungan dalam ${RULES.upsellWindowDays} hari terakhir (penuh pada 5).`),
      valueFactor(P, avg, `Rata-rata ${rp(avg)} per pekerjaan; ${rp(spend)} dalam 12 bulan.`),
      confFactor(Math.min(1, yearJobs.length / 6), `${yearJobs.length} pekerjaan dalam 12 bulan sebagai dasar estimasi.`),
      chanceFactor(pred),
    ])
    out.push({
      key: oppKey('upsell', c.key, P.now.getFullYear()),
      type: 'upsell',
      customer: customerRef(c),
      service: topService?.name || c.lastJob.service,
      title: c.name,
      why: frequent
        ? `${recent.length} kunjungan dalam 6 bulan, rata-rata ${rp(avg)} per pekerjaan.`
        : `Belanja ${rp(spend)} dalam 12 bulan, termasuk 10% pelanggan teratas.`,
      action: contractNames.length
        ? `Tawarkan kontrak berkala (seperti ${contractNames.slice(0, 2).join(', ')}) dengan jadwal tetap.`
        : `Tawarkan paket berkala ${topService?.name || ''} dengan jadwal tetap dan harga terkunci.`.replace(/\s+/g, ' '),
      score, factors,
      value: annual, valueLabel: 'Estimasi nilai paket 12 bulan',
      valueBasis: `${rp(avg)} rata-rata × ±${round(perYear, 1).toLocaleString('id-ID')} pekerjaan per tahun (pola 6–12 bulan terakhir), tanpa diskon.`,
      prediction: pred,
      anchor: new Date(lastT).toISOString(),
      actBy: null,
      evidence: c.jobs.slice(-8).map((j) => ev(j)).reverse(),
      facts: { recentVisits: recent.length, yearSpend: spend, avg, perYear, p90: Number.isFinite(p90) ? p90 : null },
      nav: navForCustomer(c, `Paket berkala ${topService?.name || ''}`.trim(), `Usulan paket 12 bulan: ±${round(perYear, 1)} pekerjaan, rata-rata ${rp(avg)} per kunjungan.`),
    })
  }
}

/** Co-occurrence of services among the same customers. */
export function servicePairs(P) {
  const { customers, services } = P
  const real = [...customers.values()].filter((c) => c.jobs.length)
  const N = real.length
  const has = new Map() // service key -> Set(customer keys)
  for (const c of real) {
    for (const s of c.services.keys()) {
      const svc = services.get(s)
      if (!svc || svc.routine) continue
      if (!has.has(s)) has.set(s, new Set())
      has.get(s).add(c.key)
    }
  }
  const pairs = []
  for (const [a, A] of has) {
    if (A.size < 5) continue
    for (const [b, B] of has) {
      if (a === b || B.size < 5) continue
      let both = 0
      for (const x of A) if (B.has(x)) both++
      const conf = both / A.size
      const lift = N ? conf / (B.size / N) : 0
      if (both >= RULES.crossMinSupport && conf >= RULES.crossMinConf && lift >= RULES.crossMinLift) {
        pairs.push({ a, b, aName: services.get(a).name, bName: services.get(b).name, both, aCount: A.size, bCount: B.size, conf, lift })
      }
    }
  }
  return pairs.sort((p, q) => q.conf - p.conf)
}

function detectCross(P, S, out, pairs) {
  const { customers, services, nowT } = P
  const byA = new Map()
  for (const p of pairs) {
    if (!byA.has(p.a)) byA.set(p.a, [])
    byA.get(p.a).push(p)
  }
  for (const c of customers.values()) {
    if (!c.jobs.length) continue
    const lastT = c.visits[c.visits.length - 1].t
    const since = days(nowT - lastT)
    if (since > RULES.crossActiveDays) continue
    let best = null
    for (const s of c.services.keys()) {
      for (const p of byA.get(s) || []) {
        if (c.services.has(p.b)) continue
        if (c.facts.some((f) => f.sKey === p.b)) continue // already asked about it
        if (!best || p.conf > best.conf) best = p
      }
    }
    if (!best) continue
    const B = services.get(best.b)
    const value = B.medianValue || 0
    const pred = rate(best.both, best.aCount, `pelanggan ${best.aName} yang juga membeli ${best.bName}`)
    const { score, factors } = scoreOf([
      timeFactor(since <= 30 ? 1 : Math.max(0.3, 1 - (since - 30) / 150), `Kunjungan terakhir ${fmtDays(since)} lalu.`),
      freqFactor(c.visits.length),
      valueFactor(P, value, `Median ${best.bName} di akun ini ${rp(value)} (${B.values.length} pekerjaan).`),
      confFactor(Math.min(1, best.both / 15), `${best.both} pelanggan membeli keduanya; lift ${round(best.lift, 1).toLocaleString('id-ID')}×.`),
      chanceFactor(S.returningNewService.enough ? S.returningNewService : pred),
    ])
    const aJobs = c.services.get(best.a).jobs
    out.push({
      key: oppKey('cross', c.key, best.b),
      type: 'cross',
      customer: customerRef(c),
      service: best.bName,
      title: c.name,
      why: `Membeli ${best.aName}; ${pctText(best.conf)} pelanggan ${best.aName} juga membeli ${best.bName}.`,
      action: `Tawarkan ${best.bName} saat menghubungi atau pada kunjungan berikutnya.`,
      score, factors,
      value, valueLabel: `Median nilai ${best.bName}`,
      valueBasis: `Median ${B.values.length} pekerjaan ${best.bName} di akun ini.`,
      prediction: pred,
      anchor: new Date(lastT).toISOString(),
      actBy: null,
      evidence: aJobs.slice(-6).map((j) => ev(j)).reverse(),
      facts: { pair: best },
      nav: navForCustomer(c, best.bName, `Cross-sell: pelanggan ${best.aName}.`),
    })
  }
}

function detectPending(P, S, out) {
  const { facts, nowT, services } = P
  for (const f of facts) {
    if (f.aggregate || f.status === 'job' || f.status === 'rejected') continue
    const age = days(nowT - f.t)
    const offer = f.openOffers[f.openOffers.length - 1] || null
    const since0 = offer ? days(nowT - (toDate(offer.created_at)?.getTime() || f.t)) : age
    if (since0 < RULES.pendingDays || age > RULES.pendingMaxDays) continue
    const svc = services.get(f.sKey)
    const value = offer ? offerPrice(offer) || svc?.medianValue || 0 : svc?.medianValue || 0
    const since = offer ? days(nowT - (toDate(offer.created_at)?.getTime() || f.t)) : age
    const svcRate = S.byService.get(f.sKey)
    const pred = svcRate?.enough ? svcRate : S.overall
    const timing = since < 7 ? 0.6 + 0.4 * (since / 7) : since <= 30 ? 1 : Math.max(0.35, 1 - (since - 30) / 60)
    const { score, factors } = scoreOf([
      timeFactor(timing, `${offer ? 'Draf penawaran' : 'Permintaan tanpa penawaran'} sejak ${fmtDays(since)}. Setelah 30 hari minat biasanya turun.`),
      freqFactor(P.customers.get(f.cKey)?.visits.length || 0, `${P.customers.get(f.cKey)?.visits.length || 0} pekerjaan sebelumnya dari pelanggan ini.`),
      valueFactor(P, value),
      confFactor(1, 'Data langsung dari penawaran/permintaan yang tercatat.'),
      chanceFactor(pred),
    ])
    const c = P.customers.get(f.cKey)
    out.push({
      key: offer ? oppKey('pending', 'offer', offer.id) : oppKey('pending', 'request', f.id),
      type: 'pending',
      customer: c ? customerRef(c) : { key: f.cKey, name: f.name, phone: f.phone, location: f.location },
      service: f.service,
      title: f.name,
      why: offer ? `Penawaran ${rp(value)} masih ${offer.status === 'draft' ? 'draf' : 'menunggu persetujuan'} sejak ${fmtDays(since)}.` : `Permintaan ${f.service} belum ditawar sejak ${fmtDays(age)}.`,
      action: offer ? 'Konfirmasi ke pelanggan, lalu setujui atau perbarui penawaran.' : 'Buat penawaran sebelum pelanggan mencari penyedia lain.',
      score, factors,
      value, valueLabel: offer ? 'Nilai penawaran' : `Median nilai ${f.service}`,
      valueBasis: offer ? 'Harga pada penawaran yang tersimpan.' : `Belum ada harga; median ${f.service} di akun ini.`,
      prediction: pred,
      anchor: f.at.toISOString(),
      actBy: P.now.toISOString(),
      evidence: [ev(f, { amount: value || null, offerId: offer?.id ?? null, status: offer ? `Penawaran ${OFFER_STATUS[offer.status] || offer.status}` : 'Belum ditawar' })],
      facts: { ageDays: age, offerId: offer?.id ?? null, offerStatus: offer?.status || null },
      nav: offer ? { stage: 'offer', params: { offerId: offer.id } } : { stage: 'offer', params: { requestId: f.id } },
    })
  }
}

function detectReapproach(P, S, out) {
  const { customers, nowT } = P
  for (const c of customers.values()) {
    const rejected = c.facts.filter((f) => f.rejectedOffers.length && !f.routine && f.t > nowT - RULES.reapproachDays * DAY)
    if (!rejected.length) continue
    const r = rejected[rejected.length - 1]
    const later = c.jobs.filter((j) => j.t > r.t)
    if (!later.length) continue
    if (later.some((j) => j.sKey === r.sKey)) continue // bought the same service after all
    if (c.facts.some((f) => f.t > r.t && f.sKey === r.sKey && f.status !== 'rejected')) continue
    const offer = r.rejectedOffers[r.rejectedOffers.length - 1]
    const value = offerPrice(offer) || P.services.get(r.sKey)?.medianValue || 0
    const back = later[later.length - 1]
    const since = days(nowT - back.t)
    const pred = S.returningNewService.enough ? S.returningNewService : S.rejectionReturn
    const { score, factors } = scoreOf([
      timeFactor(since <= 30 ? 0.9 : Math.max(0.3, 0.9 - (since - 30) / 200), `Terakhir membeli ${fmtDays(since)} lalu; hubungan sedang hangat.`),
      freqFactor(later.length, `${later.length} pekerjaan setelah penolakan.`),
      valueFactor(P, value),
      confFactor(0.6, 'Satu penawaran ditolak; alasan penolakan tidak tercatat.'),
      chanceFactor(pred),
    ])
    out.push({
      key: oppKey('reapproach', offer.id),
      type: 'reapproach',
      customer: customerRef(c),
      service: r.service,
      title: c.name,
      why: `Menolak ${r.service} (${fmtDate(r.at)}), tetapi kembali membeli ${back.service} (${fmtDate(back.at)}).`,
      action: `Tanyakan alasan penolakan dulu, lalu tawarkan ulang ${r.service} dengan ruang lingkup yang disesuaikan.`,
      score, factors,
      value, valueLabel: 'Nilai penawaran yang ditolak',
      valueBasis: 'Harga pada penawaran yang ditolak; sesuaikan bila ruang lingkup berubah.',
      prediction: pred,
      anchor: r.at.toISOString(),
      actBy: null,
      evidence: [ev(r, { amount: value || null, offerId: offer.id, status: 'Ditolak' }), ...later.slice(-4).map((j) => ev(j)).reverse()],
      facts: { rejectedOfferId: offer.id },
      nav: navForCustomer(c, r.service, `Penawaran sebelumnya ditolak (${fmtDate(r.at)}); sesuaikan ruang lingkup.`),
    })
  }
}

function occurrence(season, nowT) {
  // Upcoming/current occurrence and the most recent completed one.
  const y = new Date(nowT).getFullYear()
  const list = []
  for (let yy = y - 2; yy <= y + 1; yy++) {
    const r = season.range(yy)
    if (!r) continue
    const s = new Date(`${r[0]}T00:00:00`).getTime()
    const e = new Date(`${r[1]}T23:59:59`).getTime()
    list.push({ start: s, end: e, year: yy })
  }
  list.sort((a, b) => a.start - b.start)
  const next = list.find((o) => o.end >= nowT) || null
  const prev = [...list].reverse().find((o) => o.end < nowT && (!next || o.start < next.start)) || null
  return { next, prev }
}

/** Seasonal uplift per service in a past window, from the account's own requests. */
export function seasonalUplift(P, win) {
  const rows = P.facts.filter((f) => !f.aggregate && !f.routine)
  const inWin = rows.filter((f) => f.t >= win.start && f.t <= win.end)
  const outWin = rows.filter((f) => f.t < win.start || f.t > win.end)
  // The whole window must be observed, plus enough rows outside it as baseline.
  const covered = P.first && P.first.getTime() <= win.start + 7 * DAY && win.end < P.nowT && outWin.length >= 20
  if (!covered || !inWin.length) return { covered: Boolean(covered), services: [], inCount: inWin.length }
  const count = (list) => {
    const m = new Map()
    for (const f of list) m.set(f.sKey, (m.get(f.sKey) || 0) + 1)
    return m
  }
  const ci = count(inWin)
  const co = count(outWin)
  const multi = co.size >= 2
  const winDays = days(win.end - win.start) + 1
  const outDays = Math.max(1, days(P.nowT - P.first.getTime()) - winDays)
  const services = []
  for (const [s, nIn] of ci) {
    if (nIn < RULES.seasonMinRequests) continue
    const nOut = co.get(s) || 0
    let uplift
    let expected
    if (multi) {
      const shareOut = nOut / outWin.length
      expected = shareOut * inWin.length
      uplift = shareOut > 0 ? (nIn / inWin.length) / shareOut - 1 : null
    } else {
      expected = (nOut / outDays) * winDays
      uplift = expected > 0 ? nIn / expected - 1 : null
    }
    if (uplift == null) continue
    const svc = P.services.get(s)
    const revenue = inWin.filter((f) => f.sKey === s && f.status === 'job').reduce((t, f) => t + f.value, 0)
    services.push({ key: s, name: svc?.name || s, nIn, expected, uplift, extra: Math.max(0, nIn - expected), medianValue: svc?.medianValue || 0, revenue, method: multi ? 'share' : 'rate' })
  }
  services.sort((a, b) => b.uplift - a.uplift)
  return { covered: true, services, inCount: inWin.length, multi }
}

function detectSeason(P, out) {
  const { nowT } = P
  const svcNames = [...P.services.values()].filter((s) => !s.routine && s.requests > 0)
  for (const season of SEASONS) {
    const { next, prev } = occurrence(season, nowT)
    if (!next) continue
    const until = days(next.start - nowT)
    const inProgress = until <= 0
    if (until > RULES.seasonHorizonDays) continue
    if (inProgress && days(next.end - nowT) < 14) continue // too late to prepare
    const timing = inProgress ? 1 : Math.max(0.2, 1 - until / RULES.seasonHorizonDays)
    const when = inProgress ? `sedang berlangsung sampai ${fmtDate(next.end)}` : `mulai ${fmtDate(next.start)} (${fmtDays(until)} lagi)`
    const up = prev ? seasonalUplift(P, prev) : { covered: false, services: [] }
    const hits = up.services.filter((s) => s.uplift >= RULES.seasonMinUplift)
    if (up.covered) {
      if (!hits.length) continue // history says this window does not lift demand here
      const top = hits.slice(0, 3)
      const value = top.reduce((t, s) => t + s.extra * s.medianValue, 0)
      const nIn = top.reduce((t, s) => t + s.nIn, 0)
      const { score, factors } = scoreOf([
        timeFactor(timing, `${season.label} ${when}. Persiapan promosi dan kapasitas perlu 2–4 minggu.`),
        { key: 'lift', label: 'Kenaikan tahun lalu', value: clamp01(top[0].uplift), weight: W.frequency, detail: `${top[0].name} ${pctText(top[0].uplift)} di atas biasanya (penuh pada +100%).` },
        valueFactor(P, top[0].medianValue, `Median ${top[0].name} ${rp(top[0].medianValue)}.`),
        confFactor(Math.min(1, nIn / 60) * (up.multi ? 1 : 0.7), `${nIn} permintaan dalam jendela tahun lalu${up.multi ? '' : '; hanya satu jenis layanan, jadi tren pertumbuhan ikut terhitung'}.`),
      ])
      const prevLabel = `${fmtDate(prev.start)}–${fmtDate(prev.end)}`
      out.push({
        key: oppKey('season', season.id, next.year),
        type: 'season',
        customer: null,
        service: top.map((s) => s.name).join(', '),
        title: `${season.label}: ${top[0].name}`,
        why: `${season.label} ${when}; tahun lalu ${top[0].method === 'share' ? `porsi ${top[0].name} dari semua permintaan naik` : `permintaan ${top[0].name} naik`} ${pctText(top[0].uplift)}.`,
        action: `Siapkan promosi ${top.map((s) => s.name).join(', ')} ke pelanggan lama dan atur kapasitas tim sebelum ${fmtDate(next.start)}.`,
        score, factors,
        value, valueLabel: 'Tambahan permintaan tahun lalu',
        valueBasis: `±${round(top.reduce((t, s) => t + s.extra, 0), 0)} permintaan di atas biasanya × median nilai layanan (periode ${prevLabel}). Tidak dijumlahkan ke pipeline.`,
        prediction: null,
        season: { id: season.id, label: season.label, note: season.note, start: new Date(next.start).toISOString(), end: new Date(next.end).toISOString(), prevStart: new Date(prev.start).toISOString(), prevEnd: new Date(prev.end).toISOString(), source: 'history' },
        anchor: new Date(next.start).toISOString(),
        actBy: new Date(Math.max(nowT, next.start - 14 * DAY)).toISOString(),
        evidence: top.map((s) => ({ date: new Date(prev.start).toISOString(), label: s.name, amount: s.revenue || null, status: `${s.nIn} permintaan vs ±${round(s.expected, 1).toLocaleString('id-ID')} biasanya (${pctText(s.uplift)})`, requestId: null })),
        facts: { uplift: top, method: up.multi ? 'share' : 'rate' },
        nav: { stage: 'social', params: {} },
        inPipeline: false,
      })
    } else {
      // No history for this window: general calendar, only for matching services and only when close.
      if (until > 60) continue
      const match = svcNames.filter((s) => season.keywords.test(s.name)).sort((a, b) => b.requests - a.requests).slice(0, 3)
      if (!match.length) continue
      const { score, factors } = scoreOf([
        timeFactor(timing, `${season.label} ${when}.`),
        { key: 'lift', label: 'Kenaikan tahun lalu', value: 0, weight: W.frequency, detail: 'Belum ada data musim ini di akun Anda.' },
        { key: 'value', label: 'Nilai', value: 0, weight: W.value, detail: 'Belum bisa diperkirakan tanpa riwayat.' },
        confFactor(0.15, `Belum ada data tahun lalu; berdasarkan kalender umum (${season.note}).`),
      ])
      out.push({
        key: oppKey('season', season.id, next.year),
        type: 'season',
        customer: null,
        service: match.map((s) => s.name).join(', '),
        title: `${season.label}: ${match[0].name}`,
        why: `${season.label} ${when}. Kalender umum, belum ada data tahun lalu di akun ini.`,
        action: `Uji promosi kecil ${match[0].name} dan catat hasilnya agar tahun depan ada pembanding.`,
        score, factors,
        value: 0, valueLabel: 'Belum bisa diperkirakan',
        valueBasis: 'Tidak ada riwayat musim ini di akun Anda.',
        prediction: null,
        season: { id: season.id, label: season.label, note: season.note, start: new Date(next.start).toISOString(), end: new Date(next.end).toISOString(), source: 'calendar' },
        anchor: new Date(next.start).toISOString(),
        actBy: new Date(Math.max(nowT, next.start - 14 * DAY)).toISOString(),
        evidence: [],
        facts: {},
        nav: { stage: 'social', params: {} },
        inPipeline: false,
      })
    }
  }
}

/** Where "Buat penawaran" should go: an untouched request of this customer, else a prefilled new request. */
function navForCustomer(c, service, note) {
  const open = [...c.facts].reverse().find((f) => f.status === 'new')
  if (open) return { stage: 'offer', params: { requestId: open.id } }
  return { stage: 'request', params: { prefill: prefillFor(c, service, note) } }
}

/* ---------------------------------------------------------------- API */

/**
 * Builds the radar. Returns:
 * { asOf, opportunities[], pairs[], stats, summary, hasData, counts }
 * Each opportunity: { key, type, typeLabel, customer, service, title, why,
 *   action, score, tier, factors[], value, valueLabel, valueBasis, prediction,
 *   evidence[], anchor, actBy, nav, inPipeline }
 */
export function buildRadar(flow, { now = new Date() } = {}) {
  const P = prepare(flow, now)
  const S = conversionStats(P)
  const pairs = servicePairs(P)
  const out = []
  detectDueAndChurn(P, S, out)
  detectUpsell(P, S, out)
  detectCross(P, S, out, pairs)
  detectPending(P, S, out)
  detectReapproach(P, S, out)
  detectSeason(P, out)

  // One card per customer+type+service; keep the best score.
  const seen = new Map()
  for (const o of out) {
    const k = o.key
    if (!seen.has(k) || seen.get(k).score < o.score) seen.set(k, o)
  }
  const opportunities = [...seen.values()].map((o) => ({
    ...o,
    typeLabel: OPP_TYPES[o.type].label,
    tier: tierOf(o.score),
    inPipeline: o.inPipeline !== false,
    value: Math.round(o.value || 0),
  }))
  opportunities.sort((a, b) => b.score - a.score || b.value - a.value)

  return {
    asOf: P.now.toISOString(),
    hasData: P.facts.length > 0,
    counts: { requests: P.facts.length, customers: P.customers.size, jobs: P.facts.filter((f) => f.status === 'job').length },
    opportunities,
    pairs,
    stats: S,
    services: [...P.services.values()].map((s) => ({ key: s.key, name: s.name, routine: s.routine, recurrent: s.recurrent, requests: s.requests, jobs: s.jobs, medianInterval: s.medianInterval, intervals: s.intervals.length, medianValue: s.medianValue, repeatCustomers: s.repeatCustomers })),
    summary: summarize(opportunities, P.now),
  }
}

/** Summary over a (filtered) list of opportunities. */
export function summarize(list, now = new Date()) {
  const inPipe = list.filter((o) => o.inPipeline)
  const byType = {}
  for (const t of OPP_TYPE_KEYS) byType[t] = 0
  for (const o of list) byType[o.type]++
  return {
    count: list.length,
    value: inPipe.reduce((s, o) => s + (o.value || 0), 0),
    pipelineCount: inPipe.length,
    high: list.filter((o) => o.tier?.key === 'high').length,
    thisWeek: thisWeek(list, now).length,
    byType,
  }
}

/** Opportunities whose action date falls before the end of the next 7 days. */
export function thisWeek(list, now = new Date()) {
  const end = toDate(now).getTime() + 7 * DAY
  return list.filter((o) => o.actBy && toDate(o.actBy).getTime() <= end && o.score >= RULES.midScore)
    .sort((a, b) => String(a.actBy).localeCompare(String(b.actBy)) || b.score - a.score)
}

/**
 * Applies persisted states (opportunity_states rows) to a list.
 * done/dismissed hide the card; snoozed hides it until `until`.
 */
export function applyStates(list, states = [], now = new Date()) {
  const nowT = toDate(now).getTime()
  const byKey = new Map()
  for (const s of states) {
    const prev = byKey.get(s.opp_key)
    if (!prev || String(s.created_at || '') > String(prev.created_at || '')) byKey.set(s.opp_key, s)
  }
  const visible = []
  const hidden = []
  for (const o of list) {
    const s = byKey.get(o.key)
    const active = s && (s.status === 'done' || s.status === 'dismissed' || (s.status === 'snoozed' && toDate(s.until) && toDate(s.until).getTime() > nowT))
    if (active) hidden.push({ ...o, state: s })
    else visible.push(o)
  }
  return { visible, hidden }
}

/** Compact Indonesian grounding text for the AI (evidence only, no extra facts). */
export function opportunityContext(o, { maxEvidence = 8 } = {}) {
  const L = []
  L.push(`Jenis peluang: ${o.typeLabel}`)
  if (o.customer) {
    L.push(`Pelanggan: ${o.customer.name}`)
    if (o.customer.location) L.push(`Lokasi: ${o.customer.location}`)
  }
  if (o.service) L.push(`Layanan: ${o.service}`)
  L.push(`Alasan sekarang: ${o.why}`)
  L.push(`Saran tindakan: ${o.action}`)
  if (o.value > 0) L.push(`${o.valueLabel}: ${rp(o.value)} (${o.valueBasis})`)
  if (o.prediction) L.push(`Peluang historis: ${o.prediction.enough ? `${pctText(o.prediction.rate)} dari ${o.prediction.n} ${o.prediction.basis}` : `belum cukup data (${o.prediction.n} sampel)`}`)
  L.push(`Skor: ${o.score}/100 (${o.tier?.label || ''})`)
  if (o.evidence?.length) {
    L.push('Bukti dari riwayat:')
    for (const e of o.evidence.slice(0, maxEvidence)) {
      L.push(`- ${fmtDate(e.date)}: ${e.label}${e.amount ? ` ${rp(e.amount)}` : ''} (${e.status})`)
    }
  }
  return L.join('\n')
}

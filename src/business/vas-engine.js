/**
 * VAS (Value Added Service) engine.
 *
 * Two jobs, both deterministic and client-side so the numbers can be trusted:
 *   1. discoverOpportunities(model) — mines the user's own requests,
 *      completions and ledger for add-on revenue that is already within reach.
 *   2. catalog maths — margin, attach value and projected revenue per item.
 *
 * Nothing here calls a model. The AI layer (ai/teams.js) receives these
 * numbers as context and argues about them; it never invents them.
 */

import { VAS_CATEGORY_KEYS, VAS_STATUS_KEYS } from '../pendapatan/rules.js'

const CATEGORY_LABELS = {
  perawatan: 'Perawatan berkala',
  perlindungan: 'Perlindungan & garansi',
  peningkatan: 'Peningkatan kualitas',
  kecepatan: 'Kecepatan & prioritas',
  paket: 'Paket & langganan',
  lain: 'Lain-lain',
}
const STATUS_LABELS = { active: 'Aktif', draft: 'Draf', retired: 'Dihentikan' }

// Order and labels come from the shared rules so a new category cannot be
// accepted by the database and missing from this form.
export const VAS_CATEGORIES = VAS_CATEGORY_KEYS.map((value) => ({ value, label: CATEGORY_LABELS[value] }))
export const VAS_STATUSES = VAS_STATUS_KEYS.map((value) => ({ value, label: STATUS_LABELS[value] }))

export const categoryLabel = (v) => VAS_CATEGORIES.find((c) => c.value === v)?.label || 'Lain-lain'
export const statusLabel = (v) => VAS_STATUSES.find((s) => s.value === v)?.label || 'Draf'

/** Margin of one catalog item, in Rupiah and percent. */
export function itemEconomics(item) {
  const price = Number(item?.price) || 0
  const cost = Number(item?.cost) || 0
  const margin = price - cost
  const marginPct = price > 0 ? (margin / price) * 100 : 0
  return { price, cost, margin, marginPct }
}

/**
 * Attach rate as a 0..1 fraction. Stored as a whole percent (e.g. 25) so the
 * form can stay human; src/pendapatan/rules.js normalises it on write.
 */
export function attachRate(item) {
  const r = Number(item?.attach_rate)
  if (!Number.isFinite(r)) return 0.25
  // Stored as a whole percent; a legacy 0.4 still reads as 40%.
  const pct = r > 0 && r < 1 ? r * 100 : r
  return Math.min(1, Math.max(0, pct / 100))
}

/** Attach value: what one item is worth per month at a given attach rate. */
export function projectedMonthly(item, matchingJobs, rate) {
  const jobs = Math.max(0, Number(matchingJobs) || 0)
  const share = Math.min(1, Math.max(0, Number(rate) || 0))
  const { margin } = itemEconomics(item)
  return { jobs: jobs * share, margin: margin * jobs * share }
}

/* ------------------------------------------------------------- Discovery */

const DAY = 86400000
const daysBetween = (a, b) => Math.floor((b - a) / DAY)

/** Median of a numeric list (0 for an empty list). */
function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!list.length) return 0
  const mid = Math.floor(list.length / 2)
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2
}

const rupiahRound = (n) => Math.round((Number(n) || 0) / 5000) * 5000

/**
 * How much a rule is worth believing, given how much history exists.
 * Thin data returns a lower confidence instead of a confident guess.
 */
function confidenceFrom(sample, needed) {
  if (sample <= 0) return 0.3
  return Math.min(0.95, 0.45 + 0.5 * Math.min(1, sample / needed))
}

/**
 * Scans the flow model and returns ranked VAS opportunities.
 *
 * Each opportunity is a *hypothesis with a number attached*, not a promise:
 * `potential` is monthly gross margin if the attach estimate holds, and
 * `basis` explains which rows produced it so the user can check.
 */
export function discoverOpportunities(model, { catalog = [], now = Date.now() } = {}) {
  if (!model) return []
  const requests = model.requests || []
  const completions = model.completions || []
  const ledger = model.ledger || []
  const offers = model.offers || []

  const revenue = ledger.filter((l) => l.category === 'pendapatan').reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const jobCount = completions.length
  const avgJob = jobCount ? revenue / jobCount : 0

  // Which service types already have an active VAS attached to them.
  const covered = new Set(
    catalog.filter((i) => i.status === 'active' && i.attach_to).map((i) => String(i.attach_to).toLowerCase()),
  )
  const out = []

  /* Rule 1 — repeat customers without a subscription product. */
  const byCustomer = new Map()
  for (const r of requests) {
    const key = String(r.customer_name || '').trim().toLowerCase()
    if (!key) continue
    if (!byCustomer.has(key)) byCustomer.set(key, [])
    byCustomer.get(key).push(r)
  }
  const repeat = [...byCustomer.entries()].filter(([, rows]) => rows.length >= 2)
  if (repeat.length) {
    const price = rupiahRound(Math.max(150000, avgJob * 0.18))
    out.push({
      id: 'rule:langganan',
      kind: 'langganan',
      title: 'Kontrak perawatan bulanan untuk pelanggan berulang',
      why: `${repeat.length} pelanggan sudah memesan lebih dari sekali. Mereka membeli ulang secara manual — kontrak bulanan mengubahnya menjadi pendapatan tetap dan mengunci jadwal.`,
      price,
      attachRate: 0.35,
      jobsPerMonth: repeat.length,
      potential: rupiahRound(price * 0.85 * repeat.length * 0.35),
      confidence: confidenceFrom(repeat.length, 6),
      effort: 'Sedang',
      owner: 'Keuangan + Operasional',
      basis: repeat.slice(0, 4).map(([name, rows]) => `${name} (${rows.length} permintaan)`).join(', '),
    })
  }

  /* Rule 2 — jobs that are due for a follow-up but nobody booked one. */
  const due = []
  for (const c of completions) {
    const when = new Date(c.completed_at || c.created_at || 0).getTime()
    if (!when) continue
    const age = daysBetween(when, now)
    if (age < 30 || age > 150) continue
    const req = model.requestOfCompletion ? model.requestOfCompletion(c) : null
    const customer = String(req?.customer_name || '').trim()
    if (!customer) continue
    // Already re-booked?
    const rebooked = requests.some((r) => String(r.customer_name || '').trim().toLowerCase() === customer.toLowerCase()
      && new Date(r.created_at || 0).getTime() > when)
    if (!rebooked) due.push({ customer, service: req?.service_type || 'layanan', age })
  }
  if (due.length) {
    const price = rupiahRound(Math.max(120000, avgJob * 0.12))
    out.push({
      id: 'rule:berkala',
      kind: 'berkala',
      title: 'Servis berkala untuk pekerjaan yang lewat 30 hari',
      why: `${due.length} pekerjaan selesai lebih dari sebulan lalu dan pelanggannya belum memesan lagi. Servis berkala adalah alasan alami untuk menghubungi mereka.`,
      price,
      attachRate: 0.25,
      jobsPerMonth: due.length,
      potential: rupiahRound(price * 0.8 * due.length * 0.25),
      confidence: confidenceFrom(due.length, 8),
      effort: 'Ringan',
      owner: 'Marketing + Operasional',
      basis: due.slice(0, 4).map((d) => `${d.customer} — ${d.service}, ${d.age} hari lalu`).join('; '),
    })
  }

  /* Rule 3 — high-value jobs with no protection product attached. */
  const bigJobs = completions.filter((c) => {
    const offer = model.offerOfCompletion ? model.offerOfCompletion(c) : null
    const value = Number(offer?.validated_price) || 0
    return avgJob > 0 && value > avgJob * 1.5
  })
  if (bigJobs.length) {
    const price = rupiahRound(Math.max(250000, avgJob * 0.15))
    out.push({
      id: 'rule:garansi',
      kind: 'garansi',
      title: 'Perpanjangan garansi untuk pekerjaan bernilai besar',
      why: `${bigJobs.length} pekerjaan bernilai di atas rata-rata. Pada nilai sebesar itu, pelanggan biasanya mau membayar untuk ketenangan — dan biaya klaim Anda rendah karena pekerjaannya baru.`,
      price,
      attachRate: 0.4,
      jobsPerMonth: bigJobs.length,
      potential: rupiahRound(price * 0.9 * bigJobs.length * 0.4),
      confidence: confidenceFrom(bigJobs.length, 5),
      effort: 'Ringan',
      owner: 'Keuangan + Marketing',
      basis: `${bigJobs.length} pekerjaan di atas Rp${Math.round(avgJob * 1.5).toLocaleString('id-ID')}`,
    })
  }

  /* Rule 4 — service types with no bundled add-on in the catalog. */
  const typeCount = new Map()
  for (const r of requests) {
    const t = String(r.service_type || '').trim()
    if (t) typeCount.set(t, (typeCount.get(t) || 0) + 1)
  }
  const uncovered = [...typeCount.entries()].filter(([t]) => !covered.has(t.toLowerCase()))
  if (uncovered.length && requests.length) {
    const [topType, topCount] = uncovered.sort((a, b) => b[1] - a[1])[0]
    const price = rupiahRound(Math.max(100000, avgJob * 0.1))
    out.push({
      id: 'rule:bundling',
      kind: 'bundling',
      title: `Paket tambahan untuk "${topType}"`,
      why: `"${topType}" adalah layanan Anda yang paling sering diminta tanpa produk tambahan menempel padanya. Satu add-on kecil di setiap penawaran menaikkan nilai tanpa menambah kunjungan.`,
      price,
      attachRate: 0.3,
      jobsPerMonth: topCount,
      potential: rupiahRound(price * 0.75 * topCount * 0.3),
      confidence: confidenceFrom(topCount, 5),
      effort: 'Sedang',
      owner: 'Kreatif + Keuangan',
      basis: `${topCount} permintaan "${topType}" belum punya VAS aktif`,
    })
  }

  /* Rule 5 — stalled offers: a VAS can rescue a deal that has gone quiet. */
  const stalled = offers.filter((o) => o.status !== 'approved' && o.status !== 'rejected'
    && daysBetween(new Date(o.created_at || 0).getTime(), now) > 3)
  if (stalled.length) {
    const price = rupiahRound(Math.max(75000, avgJob * 0.08))
    out.push({
      id: 'rule:tertahan',
      kind: 'tertahan',
      title: 'Buka penawaran tertahan dengan bonus kecil',
      why: `${stalled.length} penawaran belum dijawab lebih dari 3 hari. Tambahan bernilai kecil yang diberikan gratis bersyarat sering menghidupkan kembali percakapan yang berhenti.`,
      price,
      attachRate: 0.2,
      jobsPerMonth: stalled.length,
      potential: rupiahRound(price * 0.6 * stalled.length * 0.2),
      confidence: confidenceFrom(stalled.length, 4),
      effort: 'Ringan',
      owner: 'Marketing',
      basis: `${stalled.length} penawaran menunggu jawaban`,
    })
  }

  /* Rule 6 — the catalog itself may hold dead weight. */
  const weak = catalog.filter((i) => i.status === 'active' && Number(i.price) > 0 && itemEconomics(i).marginPct < 25)
  if (weak.length) {
    out.push({
      id: 'rule:marginkatalog',
      kind: 'marginkatalog',
      title: 'Perbaiki margin item VAS yang tipis',
      why: `${weak.length} item aktif bermargin di bawah 25%. Menaikkan harga atau menurunkan biaya pada item yang sudah terjual lebih mudah daripada mencari pelanggan baru.`,
      price: 0,
      attachRate: 0,
      jobsPerMonth: 0,
      potential: rupiahRound(weak.reduce((s, i) => s + Math.max(0, Number(i.price) * 0.1), 0)),
      confidence: 0.8,
      effort: 'Ringan',
      owner: 'Keuangan',
      basis: weak.map((i) => i.name).slice(0, 3).join(', '),
    })
  }

  return out.sort((a, b) => b.potential - a.potential)
}

/** Total monthly margin the catalog could add at its own attach rates. */
export function catalogPotential(items) {
  const active = items.filter((i) => i.status === 'active')
  const monthly = active.reduce((s, i) => {
    const { margin } = itemEconomics(i)
    return s + margin * attachRate(i)
  }, 0)
  return { active: active.length, monthly: Math.round(monthly) }
}

/** Share of revenue that currently comes from VAS postings in the ledger. */
export function vasRevenueShare(ledger, catalog) {
  const names = new Set(catalog.map((i) => String(i.name || '').toLowerCase()).filter(Boolean))
  const revenue = ledger.filter((l) => l.category === 'pendapatan').reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const vas = ledger.filter((l) => l.category === 'pendapatan' && l.vas_item_id != null).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  void names
  return { revenue, vas, share: revenue > 0 ? (vas / revenue) * 100 : 0 }
}

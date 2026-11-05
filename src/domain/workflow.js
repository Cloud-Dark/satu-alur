/**
 * Alur kerja (pure; no I/O): one row per permintaan that follows the job from
 * request to bookkeeping, so the owner sees in one table how far each customer's
 * job has gone and what the next step is.
 *
 * Input: the joined model from buildModel() (stages/data.js) and, optionally,
 * the invoice rows. When a request has several offers, the row follows the one
 * that went furthest (an approved offer with a completion beats a draft).
 */
import { progressChip } from './progress.js'

/** The five steps every job walks through, in order. */
export const STEPS = [
  { key: 'request', label: 'Permintaan', stage: 'request' },
  { key: 'offer', label: 'Penawaran', stage: 'offer' },
  { key: 'assign', label: 'Penugasan', stage: 'assign' },
  { key: 'complete', label: 'Penyelesaian', stage: 'complete' },
  { key: 'bookkeeping', label: 'Pembukuan', stage: 'bookkeeping' },
]

/**
 * Where a job sits. `step` is the index in STEPS of the furthest step reached;
 * `filter` groups positions for the filter tabs on the page.
 */
export const POSITIONS = {
  new: { step: 0, label: 'Belum ada penawaran', tone: 'neutral', filter: 'request' },
  draft: { step: 1, label: 'Penawaran draf', tone: 'warn', filter: 'offer' },
  rejected: { step: 1, label: 'Penawaran ditolak', tone: 'danger', filter: 'offer' },
  approved: { step: 1, label: 'Disetujui, belum ditugaskan', tone: 'brand', filter: 'assign' },
  working: { step: 2, label: 'Sedang dikerjakan', tone: 'brand', filter: 'work' },
  completed: { step: 3, label: 'Selesai, belum dibukukan', tone: 'warn', filter: 'book' },
  booked: { step: 4, label: 'Selesai & dibukukan', tone: 'ok', filter: 'done' },
}

/** Filter tabs, in flow order. */
export const FILTERS = [
  { value: 'all', label: 'Semua' },
  { value: 'request', label: 'Permintaan' },
  { value: 'offer', label: 'Penawaran' },
  { value: 'assign', label: 'Perlu penugasan' },
  { value: 'work', label: 'Dikerjakan' },
  { value: 'book', label: 'Perlu dibukukan' },
  { value: 'done', label: 'Selesai' },
]

const RANK = { new: 0, rejected: 1, draft: 2, approved: 3, working: 4, completed: 5, booked: 6 }
const str = (v) => (v == null ? '' : String(v))
const latest = (rows) => rows.slice().sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)) || Number(b.id) - Number(a.id))[0] || null

/** Position of one offer (and the chain below it). */
function offerChain(m, offer) {
  const assignments = m.assignmentsOf(offer.id)
  const completions = assignments.flatMap((a) => m.completionsOf(a.id))
  const ledger = completions.flatMap((c) => m.ledgerOf(c.id))
  let key
  if (ledger.length) key = 'booked'
  else if (completions.length) key = 'completed'
  else if (assignments.length) key = 'working'
  else if (offer.status === 'approved') key = 'approved'
  else if (offer.status === 'rejected') key = 'rejected'
  else key = 'draft'
  // The assignment / completion the row points at: the one that went furthest.
  const completion = latest(completions.filter((c) => m.ledgerOf(c.id).length)) || latest(completions)
  const assignment = (completion && m.assignmentOfCompletion(completion)) || latest(assignments)
  return { key, offer, assignment, completion, assignments, completions, ledger }
}

export const offerPrice = (o) => {
  const v = Number(o?.validated_price ?? o?.ai_proposal_json?.price)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** The next step for a job: label for the button plus the stage and params to open. */
export function nextAction(row) {
  const { key, request, offer, assignment, completion, invoice } = row
  switch (key) {
    case 'new': return { label: 'Buat penawaran', stage: 'offer', params: { requestId: request.id } }
    case 'draft': return { label: 'Tinjau penawaran', stage: 'offer', params: { offerId: offer.id } }
    case 'rejected': return { label: 'Buat penawaran ulang', stage: 'offer', params: { requestId: request.id } }
    case 'approved': return { label: 'Tugaskan petugas', stage: 'assign', params: { offerId: offer.id } }
    case 'working': return { label: 'Tandai selesai', stage: 'complete', params: { assignmentId: assignment.id } }
    case 'completed': return { label: 'Bukukan', stage: 'bookkeeping', params: { completionId: completion.id } }
    case 'booked':
      if (!invoice) return { label: 'Buat invoice', stage: 'invoice', params: { completionId: completion.id }, optional: true }
      return { label: 'Lihat invoice', stage: 'invoice', params: { completionId: completion.id }, optional: true }
    default: return null
  }
}

/**
 * One row per request. invoices: optional invoice rows (status 'batal' ignored).
 * now: for the overdue check on scheduled assignments.
 */
export function workflowRows(m, { invoices = [], now = Date.now() } = {}) {
  const invoiceByCompletion = new Map()
  for (const inv of invoices || []) {
    if (!inv || inv.status === 'batal' || inv.completion_id == null) continue
    const k = str(inv.completion_id)
    const prev = invoiceByCompletion.get(k)
    if (!prev || str(inv.created_at) > str(prev.created_at)) invoiceByCompletion.set(k, inv)
  }

  return m.requests.map((request) => {
    const chains = m.offersOf(request.id).map((o) => offerChain(m, o))
    // Furthest chain wins; ties go to the newest offer.
    const best = chains.sort((a, b) => RANK[b.key] - RANK[a.key] || str(b.offer.created_at).localeCompare(str(a.offer.created_at)))[0] || null
    const key = best ? best.key : 'new'
    const pos = POSITIONS[key]
    const offer = best?.offer || null
    const assignment = best?.assignment || null
    const completion = best?.completion || null
    const ledger = best?.ledger || []
    const invoice = completion ? invoiceByCompletion.get(str(completion.id)) || null : null

    let status = { label: pos.label, tone: pos.tone }
    if (key === 'working') {
      const chip = progressChip(assignment, { now })
      status = { label: chip.label === 'Belum dikerjakan' ? 'Ditugaskan, belum mulai' : chip.label, tone: chip.tone === 'neutral' ? 'brand' : chip.tone }
    }

    const dates = [request.created_at, offer?.created_at, assignment?.created_at, completion?.created_at, ...ledger.map((l) => l.created_at), invoice?.created_at]
      .filter(Boolean).map(str).sort()
    const row = {
      id: request.id,
      key,
      step: pos.step,
      filter: pos.filter,
      status,
      request,
      offer,
      assignment,
      completion,
      ledger,
      invoice,
      offers: chains.length,
      customer: request.customer_name || 'Pelanggan tidak dikenal',
      service: request.service_type || '',
      location: request.location || '',
      worker: assignment?.worker_name || '',
      price: offerPrice(offer),
      updatedAt: dates[dates.length - 1] || request.created_at || null,
      done: key === 'booked',
    }
    row.next = nextAction(row)
    return row
  })
}

/** Rows per filter tab (for the counts on the tabs). */
export function filterCounts(rows) {
  const out = Object.fromEntries(FILTERS.map((f) => [f.value, 0]))
  for (const r of rows) { out.all++; out[r.filter]++ }
  return out
}

/** Search across customer, service, location, worker and the request number. */
export function matchesQuery(row, q) {
  const s = String(q || '').trim().toLowerCase().replace(/^#/, '')
  if (!s) return true
  return [row.customer, row.service, row.location, row.worker, str(row.id), row.status.label]
    .some((v) => String(v || '').toLowerCase().includes(s))
}

/**
 * Detail timeline for one job: each step with state ('done' | 'current' |
 * 'todo'), a date and a one-line note.
 */
export function timeline(row) {
  const { key, request, offer, assignment, completion, ledger, invoice } = row
  const revenue = ledger.filter((l) => l.category === 'pendapatan').reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const cost = ledger.filter((l) => l.category !== 'pendapatan').reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const items = [
    { ...STEPS[0], date: request.created_at, note: [request.service_type, request.location].filter(Boolean).join(' · ') || 'Permintaan tercatat', params: {} },
    { ...STEPS[1], date: offer?.created_at || null, note: offer ? (offer.status === 'approved' ? 'Disetujui' : offer.status === 'rejected' ? 'Ditolak' : 'Masih draf') : 'Belum dibuat', params: offer ? { offerId: offer.id } : { requestId: request.id }, money: offerPrice(offer) },
    { ...STEPS[2], date: assignment?.created_at || null, note: assignment ? `Petugas: ${assignment.worker_name || '—'}` : 'Belum ditugaskan', params: offer ? { offerId: offer.id } : {} },
    { ...STEPS[3], date: completion?.created_at || null, note: completion ? (completion.notes || 'Pekerjaan selesai') : 'Belum selesai', params: assignment ? { assignmentId: assignment.id } : {} },
    { ...STEPS[4], date: ledger.length ? ledger.map((l) => str(l.posted_at || l.created_at)).sort()[0] : null, note: ledger.length ? `${ledger.length} catatan` : 'Belum dibukukan', params: completion ? { completionId: completion.id } : {}, revenue: ledger.length ? revenue : null, cost: ledger.length ? cost : null },
  ]
  const currentStep = key === 'booked' ? -1 : key === 'new' ? 1 : key === 'approved' ? 2 : key === 'working' ? 3 : key === 'completed' ? 4 : 1
  items.forEach((it, i) => {
    it.state = currentStep === -1 || i < currentStep ? 'done' : i === currentStep ? 'current' : 'todo'
    if (i === 1 && (key === 'draft' || key === 'rejected')) it.state = 'current'
  })
  return { items, invoice }
}

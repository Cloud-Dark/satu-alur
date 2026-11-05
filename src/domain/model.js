/**
 * The joined flow model (pure; no I/O): requests -> offers -> assignments ->
 * completions -> ledger, with lookups both ways and the work queues. Shared by
 * the app (src/stages/data.js loads the tables) and the Worker's MCP server
 * (worker/mcp-server.js loads them from D1).
 */

export const LEDGER_CATEGORIES = [
  { value: 'pendapatan', label: 'Pendapatan' },
  { value: 'biaya_tenaga', label: 'Biaya tenaga kerja' },
  { value: 'biaya_bahan', label: 'Biaya bahan / material' },
  { value: 'biaya_transport', label: 'Biaya transportasi' },
  { value: 'biaya_lain', label: 'Biaya lain-lain' },
]

export function categoryLabel(cat) {
  return LEDGER_CATEGORIES.find((c) => c.value === cat)?.label || String(cat || '—').replace(/_/g, ' ')
}

export const isRevenue = (entry) => entry.category === 'pendapatan'
export const ledgerDate = (entry) => entry.posted_at || entry.created_at
const key = (v) => (v == null ? '' : String(v))

export function buildModel({ requests = [], offers = [], assignments = [], completions = [], ledger_entries: ledger = [] }) {
  const byId = (rows) => new Map(rows.map((r) => [key(r.id), r]))
  const groupBy = (rows, col) => {
    const m = new Map()
    for (const r of rows) {
      const k = key(r[col])
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return m
  }

  const reqById = byId(requests)
  const offerById = byId(offers)
  const assignById = byId(assignments)
  const complById = byId(completions)
  const offersByReq = groupBy(offers, 'request_id')
  const assignsByOffer = groupBy(assignments, 'offer_id')
  const complByAssign = groupBy(completions, 'assignment_id')
  const ledgerByCompl = groupBy(ledger, 'completion_id')

  const m = {
    requests, offers, assignments, completions, ledger,
    request: (id) => reqById.get(key(id)) || null,
    offer: (id) => offerById.get(key(id)) || null,
    assignment: (id) => assignById.get(key(id)) || null,
    completion: (id) => complById.get(key(id)) || null,
    offersOf: (reqId) => offersByReq.get(key(reqId)) || [],
    assignmentsOf: (offerId) => assignsByOffer.get(key(offerId)) || [],
    completionsOf: (assignId) => complByAssign.get(key(assignId)) || [],
    ledgerOf: (complId) => ledgerByCompl.get(key(complId)) || [],
  }

  // Walk up the chain to the originating request.
  m.requestOfOffer = (o) => (o ? m.request(o.request_id) : null)
  m.offerOfAssignment = (a) => (a ? m.offer(a.offer_id) : null)
  m.requestOfAssignment = (a) => m.requestOfOffer(m.offerOfAssignment(a))
  m.assignmentOfCompletion = (c) => (c ? m.assignment(c.assignment_id) : null)
  m.offerOfCompletion = (c) => m.offerOfAssignment(m.assignmentOfCompletion(c))
  m.requestOfCompletion = (c) => m.requestOfAssignment(m.assignmentOfCompletion(c))
  m.requestOfLedger = (l) => m.requestOfCompletion(l ? m.completion(l.completion_id) : null)

  /** Furthest stage a request has reached, derived from the data. */
  m.requestStage = (r) => {
    const offs = m.offersOf(r.id)
    if (!offs.length) return { key: 'new', label: 'Baru', tone: 'neutral' }
    const assigns = offs.flatMap((o) => m.assignmentsOf(o.id))
    const compls = assigns.flatMap((a) => m.completionsOf(a.id))
    const posted = compls.some((c) => m.ledgerOf(c.id).length > 0)
    if (posted) return { key: 'booked', label: 'Terbukukan', tone: 'ok' }
    if (compls.length) return { key: 'done', label: 'Selesai', tone: 'ok' }
    if (assigns.length) return { key: 'assigned', label: 'Ditugaskan', tone: 'brand' }
    if (offs.some((o) => o.status === 'approved')) return { key: 'offered', label: 'Ditawarkan', tone: 'brand' }
    if (offs.every((o) => o.status === 'rejected')) return { key: 'rejected', label: 'Ditolak', tone: 'danger' }
    return { key: 'draft', label: 'Draf penawaran', tone: 'warn' }
  }

  // Work queues ("perlu tindakan")
  m.requestsWithoutOffer = () => requests.filter((r) => m.offersOf(r.id).length === 0)
  m.draftOffers = () => offers.filter((o) => o.status !== 'approved' && o.status !== 'rejected')
  m.approvedWithoutAssignment = () => offers.filter((o) => o.status === 'approved' && m.assignmentsOf(o.id).length === 0)
  m.activeAssignments = () => assignments.filter((a) => a.status !== 'done' && m.completionsOf(a.id).length === 0)
  m.completionsWithoutLedger = () => completions.filter((c) => m.ledgerOf(c.id).length === 0)

  return m
}

/** Sum ledger amounts into { revenue, cost, profit } */
export function totals(entries) {
  let revenue = 0
  let cost = 0
  for (const l of entries) {
    const amt = Number(l.amount) || 0
    if (isRevenue(l)) revenue += amt
    else cost += amt
  }
  return { revenue, cost, profit: revenue - cost }
}

/** Grouping key for "the same customer" across requests (name, case-insensitive). */
export function customerKey(r) {
  return String(r?.customer_name || '').trim().toLowerCase().replace(/\s+/g, ' ') || 'x'
}

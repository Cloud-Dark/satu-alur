/**
 * Pencari prospek — background search job and the per-user result store.
 *
 * The job (place search + AI ranking) lives at module level, not in the page,
 * so it keeps running when the user opens another page. The page subscribes
 * to `satualur:leads-job` events and redraws from getLeadJob(). Finished
 * searches are written to localStorage (last result + a short history), so a
 * page visit or reload restores them without a new request.
 */
import { searchLeads } from './api.js'
import { heuristicRank } from './scoring.js'
import { rankLeads } from '../ai/leads-agent.js'
import { abortable } from '../stages/offer.js'
import { showToast } from '../ui/animations.js'

export const JOB_EVENT = 'satualur:leads-job'
export const HISTORY_MAX = 8
export const STORED_LEADS_MAX = 300
const STORE_PREFIX = 'satualur_leads_v1:'

/* ---------------------------------------------------------------- Store */

const storeKey = (owner) => `${STORE_PREFIX}${owner || 'anon'}`
const emptyStore = () => ({ lastId: null, history: [] })

/** Keeps only what the page needs to redraw a search. */
export function makeEntry({ id, at, criteria, search, leads, rankBasis }) {
  const { results: _drop, ...meta } = search || {}
  return {
    id: id || `s${Date.now().toString(36)}`,
    at: at || new Date().toISOString(),
    criteria: {
      point: criteria.point,
      pointLabel: criteria.pointLabel || '',
      radiusKm: criteria.radiusKm,
      keywords: [...(criteria.keywords || [])],
      source: criteria.source || 'osm',
    },
    search: meta,
    leads: (leads || []).slice(0, STORED_LEADS_MAX),
    rankBasis: rankBasis || null,
  }
}

/** Newest first, one entry per id, at most `max`. */
export function pushHistory(data, entry, max = HISTORY_MAX) {
  const history = [entry, ...(data?.history || []).filter((e) => e && e.id !== entry.id)].slice(0, max)
  return { lastId: entry.id, history }
}

export function removeHistory(data, id) {
  const history = (data?.history || []).filter((e) => e.id !== id)
  const lastId = data?.lastId === id ? (history[0]?.id ?? null) : data?.lastId ?? null
  return { lastId, history }
}

export function loadLeadsStore(owner) {
  try {
    const raw = localStorage.getItem(storeKey(owner))
    const data = raw ? JSON.parse(raw) : null
    if (!data || !Array.isArray(data.history)) return emptyStore()
    return { lastId: data.lastId ?? null, history: data.history.filter((e) => e && e.id && Array.isArray(e.leads)) }
  } catch {
    return emptyStore()
  }
}

/** Saves; on a full quota, drops the oldest history entries until it fits. */
export function saveLeadsStore(owner, data) {
  let next = { lastId: data.lastId, history: [...data.history] }
  for (;;) {
    try {
      localStorage.setItem(storeKey(owner), JSON.stringify(next))
      return next
    } catch {
      if (next.history.length <= 1) {
        try { localStorage.removeItem(storeKey(owner)) } catch { /* storage unavailable */ }
        return emptyStore()
      }
      next = { ...next, history: next.history.slice(0, -1) }
    }
  }
}

export function lastEntry(data) {
  return data.history.find((e) => e.id === data.lastId) || data.history[0] || null
}

/* ------------------------------------------------------------------ Job */

let job = null // one job at a time, across pages
let pageMounted = false

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(JOB_EVENT, { detail: job }))
}

/** The page tells the job whether it is on screen (for the "done" toast). */
export function setLeadsPageMounted(on) { pageMounted = Boolean(on) }

export function getLeadJob(owner) {
  return job && job.owner === (owner || 'anon') ? job : null
}

export const isJobRunning = (j) => Boolean(j && (j.status === 'fetching' || j.status === 'ranking'))

export function cancelLeadJob() {
  if (isJobRunning(job)) job.ctl.abort()
}

/**
 * Starts a search. `prepare()` resolves { services, model } (business context
 * and AI model) and is awaited only after the places came back.
 */
export function startLeadJob({ owner, criteria, isMock = false, prepare }) {
  cancelLeadJob()
  const ctl = new AbortController()
  const j = {
    id: `s${Date.now().toString(36)}`,
    owner: owner || 'anon',
    criteria: { ...criteria, keywords: [...criteria.keywords] },
    status: 'fetching',
    search: null,
    leads: [],
    rankBasis: null,
    aiText: '',
    aiTotal: 0,
    aiCount: 0,
    error: null,
    entry: null,
    ctl,
  }
  job = j
  emit()
  run(j, { isMock, prepare }).finally(() => { if (job === j) emit() })
  return j
}

async function run(j, { isMock, prepare }) {
  const { signal } = j.ctl
  const c = j.criteria
  const finish = (status, extra = {}) => { Object.assign(j, { status }, extra) }
  let res
  try {
    res = await searchLeads({ lat: c.point.lat, lon: c.point.lon, radiusKm: c.radiusKm, keywords: c.keywords, source: isMock ? 'osm' : c.source, signal })
  } catch (err) {
    finish(err.name === 'AbortError' ? 'cancelled' : 'error', { error: err.name === 'AbortError' ? null : err.message })
    return
  }
  j.search = res
  const raw = res.results || []
  let ctx = { services: [], model: null }
  try { ctx = (await prepare?.()) || ctx } catch { /* heuristics only */ }
  const svcNames = (ctx.services || []).map((s) => s.name)
  j.leads = raw.map((l) => ({ ...l, ai: heuristicRank(l, svcNames) }))
  j.rankBasis = 'heuristik'

  if (raw.length && ctx.model && !signal.aborted) {
    j.status = 'ranking'
    j.aiTotal = raw.length
    emit()
    try {
      const ranked = await abortable(rankLeads({
        leads: raw, services: ctx.services, criteria: c.keywords, modelId: ctx.model.id, signal,
        onChunk: (_d, full) => { if (!signal.aborted) { j.aiText = full; emit() } },
      }), signal)
      j.aiCount = ranked.aiCount
      if (ranked.aiCount > 0) {
        j.leads = ranked.leads
        j.rankBasis = ranked.aiCount < raw.length ? 'mixed' : 'ai'
      }
    } catch (err) {
      if (err.name !== 'AbortError') j.error = err.message
    }
  }
  if (signal.aborted) { finish('cancelled'); return }

  j.entry = makeEntry({ id: j.id, criteria: c, search: res, leads: j.leads, rankBasis: j.rankBasis })
  saveLeadsStore(j.owner, pushHistory(loadLeadsStore(j.owner), j.entry))
  finish('done')
  if (!pageMounted) {
    const n = j.leads.filter((l) => l.ai?.keep !== false).length
    showToast(`Pencarian prospek selesai: ${n} usaha.`, 'success', 5000)
  }
}

/** Test hook: forget the current job. */
export function _resetLeadJob() { job = null; pageMounted = false }

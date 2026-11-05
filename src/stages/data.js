/**
 * Shared data access for the stages: fetch the flow tables in parallel and
 * join them in memory (replaces the per-row N+1 lookups the stages used to do).
 */
import { getCloud } from '../cloud.js'
import { buildModel } from '../domain/model.js'

// Pure parts (also imported by the Worker's MCP server) live in src/domain/model.js.
export { LEDGER_CATEGORIES, categoryLabel, isRevenue, ledgerDate, buildModel, totals, customerKey } from '../domain/model.js'

export const TABLES = ['requests', 'offers', 'assignments', 'completions', 'ledger_entries']

const PAGE = 5000 // matches the Worker's per-request cap
const MAX_PAGES = 20
const CACHE_MS = 15000

// Shell counters and the active stage load the same tables at the same time;
// share in-flight and very recent loads. Any write clears the cache.
const cache = new Map() // table -> { at, promise }
function invalidate() { cache.clear() }
if (typeof window !== 'undefined') {
  window.addEventListener('satualur:db-write', invalidate)
  window.addEventListener('satualur:data-changed', invalidate)
}

function cachedTable(name) {
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise
  const promise = fetchTable(name)
  cache.set(name, { at: Date.now(), promise })
  promise.catch(() => { if (cache.get(name)?.promise === promise) cache.delete(name) })
  return promise
}

/**
 * Loads every row of a table, newest first. Pages by id (keyset: id > last)
 * instead of OFFSET, so D1 only reads the rows it returns.
 */
async function fetchTable(name) {
  const rows = []
  let last = null
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = getCloud().database.from(name).select('*')
    if (last !== null) q = q.gt('id', last)
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE)
    if (error) throw new Error(`Gagal memuat ${name}: ${error.message}`)
    const batch = data || []
    rows.push(...batch)
    if (batch.length < PAGE) break
    last = batch[batch.length - 1].id
  }
  return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

/** Fetches the given tables in parallel and returns a joined model. */
export async function loadFlow(tables = TABLES) {
  const results = await Promise.all(tables.map(cachedTable))
  const raw = Object.fromEntries(tables.map((t, i) => [t, results[i]]))
  return buildModel(raw)
}

/** Notifies the shell (nav counters, etc.) that flow data changed. */
export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent('satualur:data-changed'))
}

/** YYYY-MM-DD in the viewer's local timezone (not UTC). */
export function localDate(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/** Display name for a request (falls back gracefully). */
export function customerLabel(r) {
  return r?.customer_name || 'Pelanggan tidak dikenal'
}

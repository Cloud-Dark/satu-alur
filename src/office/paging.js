// Server-side paging for Kantor lists (shared by the Worker, the mock cloud and tests).
export const OFFICE_PAGE_SIZE = 20

/** Reads ?page= (1-based) and ?size= from a URL; size is clamped to 5–100. */
export function parsePage(searchParams, { size = OFFICE_PAGE_SIZE } = {}) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(searchParams.get('page') || '1', 10) || 1))
  const raw = Number.parseInt(searchParams.get('size') || '', 10)
  const limit = Number.isFinite(raw) ? Math.max(5, Math.min(100, raw)) : size
  return { page, limit, offset: (page - 1) * limit, paged: searchParams.has('page') }
}

/** Slices an in-memory list the same way (mock cloud). */
export function pageOf(rows, { page = 1, size = OFFICE_PAGE_SIZE } = {}) {
  const limit = Math.max(5, Math.min(100, size))
  const p = Math.max(1, page)
  return { items: rows.slice((p - 1) * limit, p * limit), total: rows.length, page: p, size: limit }
}

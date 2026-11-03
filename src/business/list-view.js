/**
 * Small, pure list helpers shared by the two Pendapatan tables.
 *
 * Kept out of the stages so the paging and CSV rules can be unit-tested
 * without a DOM, and so both pages behave identically as data grows.
 */

/** Case-insensitive "contains", whitespace-collapsed, null-safe. */
export function matchesQuery(row, query, fields) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => String(row?.[f] ?? '').toLowerCase().includes(needle))
}

/**
 * filterRows(rows, { query, fields, filters })
 *   filters: { key: value | 'all' } — equality on that column, 'all' = no filter.
 */
export function filterRows(rows, { query = '', fields = [], filters = {} } = {}) {
  const active = Object.entries(filters).filter(([, v]) => v && v !== 'all')
  return (rows || []).filter((row) => {
    if (!matchesQuery(row, query, fields)) return false
    return active.every(([key, value]) => String(row?.[key] ?? '') === String(value))
  })
}

export const PAGE_SIZE = 10

/** Trailing-edge debounce for the search box (typing must not redraw per key). */
export function debounce(fn, ms = 150) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; fn(...args) }, ms)
  }
}

const csvCell = (value) => {
  const raw = value === null || value === undefined ? '' : String(value)
  const text = typeof value === 'string' && /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * CSV from column definitions: [{ label, value(row) }].
 * CRLF line endings and a quoted header, which is what Excel expects.
 */
export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(',')
  const body = (rows || []).map((row) => columns.map((c) => csvCell(c.value ? c.value(row) : row[c.key])).join(','))
  return [head, ...body].join('\r\n')
}

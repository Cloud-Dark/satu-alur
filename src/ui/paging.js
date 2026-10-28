/**
 * Pure helpers for display pagination (no DOM): page window with ellipsis,
 * clamping, slicing and the per-list page-size memory in sessionStorage.
 * The DOM component lives in components.js (`pager`, `paginate`).
 */

export const PAGE_SIZES = [10, 25, 50]
export const GAP = '…'
const SIZE_KEY = 'satualur_pagesize:'

/** Number of pages for `total` items (at least 1). */
export function pageCount(total, size) {
  const t = Math.max(0, Number(total) || 0)
  const s = Math.max(1, Number(size) || 1)
  return Math.max(1, Math.ceil(t / s))
}

/** Clamps `page` (1-based) into [1, pages]. */
export function clampPage(page, pages) {
  const p = Math.floor(Number(page) || 1)
  return Math.min(Math.max(1, p), Math.max(1, pages))
}

/**
 * Compact page list with ellipsis, always 7 slots once there are more than 7
 * pages, so the control keeps its width while paging:
 *   pageWindow(5, 25)  -> [1, '…', 4, 5, 6, '…', 25]
 *   pageWindow(2, 25)  -> [1, 2, 3, 4, 5, '…', 25]
 *   pageWindow(24, 25) -> [1, '…', 21, 22, 23, 24, 25]
 */
export function pageWindow(page, pages) {
  const n = Math.max(1, Math.floor(Number(pages) || 1))
  const p = clampPage(page, n)
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  if (p <= 4) return [1, 2, 3, 4, 5, GAP, n]
  if (p >= n - 3) return [1, GAP, n - 4, n - 3, n - 2, n - 1, n]
  return [1, GAP, p - 1, p, p + 1, GAP, n]
}

/** { start, end } (0-based, end exclusive) of a page. */
export function pageBounds(page, size, total) {
  const s = Math.max(1, Number(size) || 1)
  const t = Math.max(0, Number(total) || 0)
  const start = Math.min((clampPage(page, pageCount(t, s)) - 1) * s, t)
  return { start, end: Math.min(start + s, t) }
}

/** "Menampilkan 1–10 dari 248" (or the empty / single forms). */
export function rangeLabel(page, size, total, fmt = (n) => String(n)) {
  const t = Math.max(0, Number(total) || 0)
  if (!t) return 'Tidak ada data'
  const { start, end } = pageBounds(page, size, t)
  return end - start === t ? `Menampilkan ${fmt(t)} dari ${fmt(t)}` : `Menampilkan ${fmt(start + 1)}–${fmt(end)} dari ${fmt(t)}`
}

/** Page (1-based) that contains item `index` (0-based). */
export function pageOfIndex(index, size) {
  return Math.floor(Math.max(0, Number(index) || 0) / Math.max(1, Number(size) || 1)) + 1
}

/** Remembered page size for a list key (falls back to `fallback`). */
export function readPageSize(key, sizes, fallback) {
  if (!key) return fallback
  try {
    const v = Number(sessionStorage.getItem(SIZE_KEY + key))
    return sizes.includes(v) ? v : fallback
  } catch { return fallback }
}

export function writePageSize(key, size) {
  if (!key) return
  try { sessionStorage.setItem(SIZE_KEY + key, String(size)) } catch { /* storage unavailable */ }
}

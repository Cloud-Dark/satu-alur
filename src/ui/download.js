/**
 * Client-side file download (no server round-trip).
 * Used by the two Pendapatan tables to export what the user is looking at.
 */

/** Downloads `text` as a file. A BOM keeps Excel from mangling Indonesian text. */
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([`\ufeff${text}`], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** `katalog-2026-10-31.csv` */
export function datedName(prefix, ext = 'csv') {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`
}

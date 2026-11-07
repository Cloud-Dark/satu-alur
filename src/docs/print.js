/**
 * Printable documents in the Tumbuh brand (offers now; invoices and delivery
 * notes can reuse it). Opens the document in a new window and starts the
 * browser's print dialog, where "Simpan sebagai PDF" produces the file.
 */

import { getLang } from '../i18n/index.js'

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const BASE_CSS = `
@page { size: A4; margin: 16mm 16mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #1B2420; font-size: 10.5pt; line-height: 1.55; background: #fff; }
.doc { max-width: 178mm; margin: 0 auto; }
.doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; padding-bottom: 6mm; border-bottom: 2px solid #16392E; }
.brand { display: flex; align-items: center; gap: 4mm; }
.mark { width: 13mm; height: 13mm; border-radius: 3.5mm; background: #16392E; color: #F6F1E7; display: grid; place-items: center; font-weight: 700; font-size: 13pt; letter-spacing: .02em; }
.brand-name { font-weight: 700; font-size: 13pt; }
.brand-sub { color: #5C6B63; font-size: 9pt; }
.doc-title { text-align: right; }
.doc-title h1 { margin: 0; font-family: Georgia, 'Instrument Serif', serif; font-weight: 400; font-size: 24pt; color: #16392E; line-height: 1.1; }
.doc-title .meta { color: #5C6B63; font-size: 9pt; margin-top: 2mm; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 7mm 0; }
.box { border: 1px solid #E7DFCF; border-radius: 3mm; padding: 4mm 5mm; background: #FBF8F2; }
.label { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #2B7560; font-weight: 700; margin-bottom: 1.5mm; }
h2 { font-size: 11pt; margin: 6mm 0 2mm; color: #16392E; }
p { margin: 0 0 2.5mm; white-space: pre-wrap; }
.total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6mm; padding: 5mm 6mm; border-radius: 3mm; background: #16392E; color: #F6F1E7; }
.total b { font-size: 16pt; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 16mm; }
.sign div { border-top: 1px solid #1B2420; padding-top: 2mm; font-size: 9pt; color: #5C6B63; }
.foot { margin-top: 10mm; font-size: 8pt; color: #5C6B63; border-top: 1px solid #EFE8DA; padding-top: 3mm; }
@media screen { body { background: #F6F1E7; padding: 10mm 0; } .doc { background: #fff; padding: 14mm; border-radius: 4mm; box-shadow: 0 8px 30px rgba(22,57,46,.12); } }
`

/** A full HTML page for `html` (already escaped by the caller). */
export function printableDocument({ title, html }) {
  return `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body><div class="doc">${html}</div></body></html>`
}

/**
 * Opens the document and the print dialog. Returns the window, or null when the
 * browser blocked the pop-up (the caller then offers a download link instead).
 */
export function openPrintable({ title, html, filename }) {
  const page = printableDocument({ title: filename || title, html })
  const win = window.open('', '_blank')
  if (!win) {
    // Pop-up blocked: download the HTML so it can still be printed or saved as PDF.
    const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${(filename || title || 'dokumen').replace(/[^\w.-]+/g, '-')}.html` })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return null
  }
  win.document.open()
  win.document.write(page)
  win.document.close()
  win.focus()
  setTimeout(() => { try { win.print() } catch { /* closed */ } }, 350)
  return win
}

/** Two-letter initials for the document mark. */
export function initials(name) {
  const parts = String(name || 'Satu Alur').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || 'S') + (parts[1]?.[0] || parts[0]?.[1] || 'A')).toUpperCase()
}

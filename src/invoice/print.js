/**
 * Branded printable invoice. Opens a new window with a standalone A4 HTML
 * document and calls print(), so "Unduh PDF" works through the browser's
 * "Simpan sebagai PDF" on desktop and phone without a PDF library.
 */
import { lineAmount, statusLabel } from './rules.js'
import { t, has, locale, getLang } from '../i18n/index.js'

// Node tests import this module without the Vite dictionaries: then the Indonesian text below is used.
const ready = () => has('invoice.title')
const tx = (key, id, vars = {}) => (ready() ? t(key, vars) : id.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)))
const loc = () => (ready() ? locale() : 'id-ID')
const statusText = (s) => (ready() && has(`invoice.status.${s}`) ? t(`invoice.status.${s}`) : statusLabel(s))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const rp = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString(loc())}`
const qtyFmt = (n) => Number(n || 0).toLocaleString(loc(), { maximumFractionDigits: 2 })
function dateFmt(iso) {
  if (!iso) return '—'
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' })
}

export function invoiceHtml(inv, items, { businessName = tx('invoice.print.yourBusiness', 'Usaha Anda'), businessEmail = '', demo = false } = {}) {
  const rows = (items || []).map((it, i) => `<tr><td class="n">${i + 1}</td><td>${esc(it.description)}</td><td class="r">${qtyFmt(it.qty)}</td><td class="r">${rp(it.unit_price)}</td><td class="r">${rp(lineAmount(it))}</td></tr>`).join('')
  const paid = inv.status === 'lunas'
  return `<!doctype html><html lang="${ready() ? getLang() : 'id'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inv.number)} · ${esc(businessName)}</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.5 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1b2420; background: #fff; }
.doc { max-width: 760px; margin: 0 auto; padding: 24px 20px; }
.top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 3px solid #16392e; padding-bottom: 14px; }
.brand { font-weight: 700; font-size: 18px; color: #16392e; }
.muted { color: #5c6b63; }
h1 { margin: 0; font: 400 30px/1.1 Georgia, 'Instrument Serif', serif; color: #16392e; text-align: right; }
.meta { text-align: right; font-size: 12px; }
.chip { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; background: ${paid ? '#e3f2ea' : '#f6f1e7'}; color: ${paid ? '#1f6b45' : '#5c6b63'}; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0; }
.label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #5c6b63; margin-bottom: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #5c6b63; border-bottom: 1px solid #d9d2c3; padding: 8px 6px; }
td { padding: 9px 6px; border-bottom: 1px solid #eee7da; vertical-align: top; }
td.r, th.r { text-align: right; white-space: nowrap; }
td.n { width: 28px; color: #5c6b63; }
.totals { margin-left: auto; width: min(320px, 100%); margin-top: 12px; }
.totals div { display: flex; justify-content: space-between; padding: 4px 0; }
.totals .grand { border-top: 2px solid #16392e; margin-top: 4px; padding-top: 8px; font-weight: 700; font-size: 16px; color: #16392e; }
.box { margin-top: 18px; padding: 12px 14px; background: #f6f1e7; border-radius: 10px; white-space: pre-wrap; }
.foot { margin-top: 26px; font-size: 11px; color: #5c6b63; text-align: center; }
.demo { margin-top: 10px; text-align: center; font-size: 11px; color: #b5651d; }
@media (max-width: 520px) { .parties { grid-template-columns: 1fr; } h1 { font-size: 24px; } .top { flex-direction: column; } h1, .meta { text-align: left; } }
@media print { .doc { padding: 0; } }
</style></head><body><div class="doc">
<div class="top">
  <div><div class="brand">${esc(businessName)}</div>${businessEmail ? `<div class="muted">${esc(businessEmail)}</div>` : ''}</div>
  <div><h1>Invoice</h1><div class="meta"><strong>${esc(inv.number)}</strong><br>${esc(tx('invoice.print.date', 'Tanggal:'))} ${dateFmt(inv.issue_date)}<br>${esc(tx('invoice.print.due', 'Jatuh tempo:'))} ${dateFmt(inv.due_date)}<br><span class="chip">${esc(statusText(inv.status))}</span></div></div>
</div>
<div class="parties">
  <div><div class="label">${esc(tx('invoice.print.billTo', 'Ditagihkan kepada'))}</div><strong>${esc(inv.customer_name)}</strong>${inv.customer_address ? `<br>${esc(inv.customer_address)}` : ''}${inv.customer_phone ? `<br>${esc(inv.customer_phone)}` : ''}${inv.customer_email ? `<br>${esc(inv.customer_email)}` : ''}</div>
  <div>${paid && inv.paid_at ? `<div class="label">${esc(tx('invoice.print.paid', 'Dibayar'))}</div>${dateFmt(inv.paid_at)}` : ''}</div>
</div>
<table><thead><tr><th>#</th><th>${esc(tx('invoice.print.desc', 'Keterangan'))}</th><th class="r">${esc(tx('invoice.print.qty', 'Jumlah'))}</th><th class="r">${esc(tx('invoice.print.price', 'Harga'))}</th><th class="r">${esc(tx('invoice.print.subtotal', 'Subtotal'))}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
  <div><span>${esc(tx('invoice.print.subtotal', 'Subtotal'))}</span><span>${rp(inv.subtotal)}</span></div>
  ${Number(inv.discount) > 0 ? `<div><span>${esc(tx('invoice.print.discount', 'Diskon'))}</span><span>−${rp(inv.discount)}</span></div>` : ''}
  ${Number(inv.tax_amount) > 0 ? `<div><span>${esc(tx('invoice.print.tax', 'PPN {rate}%', { rate: qtyFmt(inv.tax_rate) }))}</span><span>${rp(inv.tax_amount)}</span></div>` : ''}
  <div class="grand"><span>Total</span><span>${rp(inv.total)}</span></div>
</div>
${inv.payment_info ? `<div class="box"><div class="label">${esc(tx('invoice.print.payment', 'Cara pembayaran'))}</div>${esc(inv.payment_info)}</div>` : ''}
${inv.notes ? `<div class="box"><div class="label">${esc(tx('invoice.print.notes', 'Catatan'))}</div>${esc(inv.notes)}</div>` : ''}
${demo ? `<div class="demo">${esc(tx('invoice.print.demo', 'Dokumen contoh dari akun demo — data fiktif.'))}</div>` : ''}
<div class="foot">${esc(tx('invoice.print.foot', 'Dibuat dengan Satu Alur'))}</div>
</div></body></html>`
}

/** Opens the printable document; returns false when the browser blocked the window. */
export function printInvoice(inv, items, opts = {}) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(invoiceHtml(inv, items, opts))
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* closed */ } }, 300)
  return true
}

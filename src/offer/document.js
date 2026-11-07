/** The branded offer document ("PDF penawaran"), rendered through src/docs/print.js. */
import { esc, initials, openPrintable } from '../docs/print.js'
import { t, has, locale } from '../i18n/index.js'

// Node tests import this module without the Vite dictionaries: then the Indonesian text below is used.
const ready = () => has('offer.title')
const tx = (key, id, vars = {}) => (ready() ? t(key, vars) : id.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)))
const loc = () => (ready() ? locale() : 'id-ID')
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString(loc())}`
const day = (d) => new Date(d).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' })
const dayTime = (d) => new Date(d).toLocaleString(loc(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const OFFER_VALID_DAYS = 14

/** Document number like PNW-20261104-0042 (date + request id). */
export function offerNumber({ requestId, date = new Date() }) {
  const d = new Date(date)
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `PNW-${ymd}-${String(requestId ?? 0).padStart(4, '0').slice(-6)}`
}

export function offerDocumentHTML({ businessName, request = {}, offer = {}, schedule = null, templateName = null, date = new Date() }) {
  const number = offerNumber({ requestId: request.id, date })
  const valid = new Date(new Date(date).getTime() + OFFER_VALID_DAYS * 86400000)
  const biz = businessName || tx('offer.doc.yourBusiness', 'Usaha Anda')
  return `
<header class="doc-head">
  <div class="brand"><div class="mark">${esc(initials(biz))}</div><div><div class="brand-name">${esc(biz)}</div><div class="brand-sub">${esc(tx('offer.doc.sub', 'Penawaran layanan'))}</div></div></div>
  <div class="doc-title"><h1>${esc(tx('offer.doc.title', 'Penawaran'))}</h1><div class="meta">${esc(tx('offer.doc.number', 'No. {number}', { number }))}<br>${esc(tx('offer.doc.date', 'Tanggal {date}', { date: day(date) }))}<br>${esc(tx('offer.doc.validUntil', 'Berlaku sampai {date}', { date: day(valid) }))}</div></div>
</header>
<div class="grid">
  <div class="box"><div class="label">${esc(tx('offer.doc.to', 'Untuk'))}</div><p><b>${esc(request.customer_name || '—')}</b>${request.location ? `\n${esc(request.location)}` : ''}${request.phone ? `\n${esc(request.phone)}` : ''}</p></div>
  <div class="box"><div class="label">${esc(tx('offer.doc.service', 'Layanan'))}</div><p><b>${esc(request.service_type || '—')}</b>${templateName ? `\n${esc(templateName)}` : ''}${schedule ? `\n${esc(tx('offer.doc.schedule', 'Jadwal: {date}', { date: dayTime(schedule) }))}` : ''}</p></div>
</div>
<h2>${esc(tx('offer.field.scope', 'Ruang lingkup'))}</h2><p>${esc(offer.scope || '—')}</p>
<h2>${esc(tx('offer.field.terms', 'Ketentuan'))}</h2><p>${esc(offer.terms || '—')}</p>
${offer.notes ? `<h2>${esc(tx('offer.field.notes', 'Catatan'))}</h2><p>${esc(offer.notes)}</p>` : ''}
<div class="total"><span>${esc(tx('offer.doc.total', 'Total harga'))}</span><b>${esc(rp(offer.price))}</b></div>
<div class="sign"><div>${esc(tx('offer.doc.regards', 'Hormat kami,'))}<br><br><br>${esc(biz)}</div><div>${esc(tx('offer.doc.approvedBy', 'Disetujui oleh,'))}<br><br><br>${esc(request.customer_name || tx('offer.doc.customer', 'Pelanggan'))}</div></div>
<div class="foot">${esc(tx('offer.doc.foot', 'Penawaran ini dibuat dengan Satu Alur. Harga dalam Rupiah. Balas pesan ini untuk menyetujui atau bertanya.'))}</div>`
}

export function openOfferDocument(args) {
  const number = offerNumber({ requestId: args.request?.id, date: args.date })
  return openPrintable({ title: `${tx('offer.doc.title', 'Penawaran')} ${args.request?.customer_name || ''}`.trim(), filename: number, html: offerDocumentHTML(args) })
}

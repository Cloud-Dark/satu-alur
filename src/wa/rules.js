/**
 * WhatsApp rules shared by the Worker (worker/whatsapp.js), the client (src/wa/api.js) and the
 * demo store. Pure functions only.
 *
 * Every business sends from its OWN WAPilot or WAConsole account. A daily cap per business is a
 * safety net against a runaway loop or a mistaken bulk send.
 */

export const WA_LIMITS = {
  perUserDay: 200,     // messages one business may send per day (Jakarta time)
  textMax: 1500,
}

// '0812-3456 7890', '+62 812…', '62812…', '812…' -> '628123456789'; null when it is not an Indonesian mobile number.
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/[\s().-]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (!/^\d+$/.test(d)) return null
  if (d.startsWith('0')) d = `62${d.slice(1)}`
  else if (d.startsWith('8')) d = `62${d}`
  if (!/^628\d{7,12}$/.test(d)) return null
  return d
}

// '628123456789' -> '62812****789' (stored in the audit log instead of the number).
export function maskPhone(phone) {
  const p = String(phone || '')
  if (p.length < 8) return '****'
  return `${p.slice(0, 5)}${'*'.repeat(Math.max(4, p.length - 8))}${p.slice(-3)}`
}

// Jakarta calendar day, 'YYYY-MM-DD'.
export function dayWib(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

export function validateText(text) {
  const t = String(text ?? '').trim()
  if (!t) return { error: 'Isi pesan tidak boleh kosong.' }
  if (t.length > WA_LIMITS.textMax) return { error: `Pesan maksimal ${WA_LIMITS.textMax} karakter.` }
  return { text: t }
}

const rupiah = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`

// Message for an approved offer: who it is for, what, how much, and the terms.
export function offerMessage({ customer, service, scope, price, terms, business }) {
  return [
    `Halo ${customer || 'Bapak/Ibu'},`,
    '',
    `Berikut penawaran ${service ? `untuk ${service} ` : ''}dari ${business || 'kami'}:`,
    scope ? `• Lingkup: ${scope}` : null,
    `• Harga: ${rupiah(price)}`,
    terms ? `• Syarat: ${terms}` : null,
    '',
    'Balas pesan ini bila setuju atau ada yang ingin ditanyakan. Terima kasih.',
  ].filter((l) => l !== null).join('\n')
}

// Short follow-up for a new request.
export function followUpMessage({ customer, service, business }) {
  return [
    `Halo ${customer || 'Bapak/Ibu'},`,
    '',
    `Terima kasih sudah menghubungi ${business || 'kami'}${service ? ` untuk ${service}` : ''}. Permintaan Anda sudah kami catat dan penawaran akan segera kami kirim.`,
    '',
    'Bila ada detail tambahan (alamat, jadwal yang diinginkan, foto lokasi), silakan balas pesan ini.',
  ].join('\n')
}

// The cap message when the business has used its daily allowance, else null.
export function capProblem({ user = 0 }) {
  if (user >= WA_LIMITS.perUserDay) return `Batas ${WA_LIMITS.perUserDay} pesan WhatsApp per hari untuk usaha Anda tercapai. Coba lagi besok.`
  return null
}

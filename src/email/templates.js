/**
 * Email templates in the Tumbuh style (forest green on cream). Every template
 * returns { subject, html, text }; values are HTML-escaped. Inline styles only,
 * because mail clients ignore <style> blocks.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>')

function layout({ preheader = '', title, bodyHtml, footer = 'Email ini dikirim otomatis oleh Satu Alur.' }) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F6F1E7;font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif;color:#1B2420">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F1E7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #E7DFCF">
<tr><td style="background:#16392E;padding:22px 28px;color:#F6F1E7;font-size:17px;font-weight:700;letter-spacing:-0.01em">Satu <span style="font-weight:500;color:#E7A13A">Alur</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-family:Georgia,'Instrument Serif',serif;font-weight:400;font-size:26px;line-height:1.2;color:#16392E">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px 24px;color:#5C6B63;font-size:12px;line-height:1.5;border-top:1px solid #EFE8DA">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`
}

const p = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1B2420">${html}</p>`

export function otpEmail({ code, minutes = 10 }) {
  const digits = String(code).split('').join(' ')
  return {
    subject: `Kode masuk Satu Alur: ${code}`,
    text: `Kode masuk Satu Alur Anda: ${code}\n\nBerlaku ${minutes} menit dan hanya sekali pakai. Jangan bagikan kode ini kepada siapa pun.\nJika Anda tidak meminta kode ini, abaikan email ini.`,
    html: layout({
      preheader: `Kode masuk Anda: ${code}`,
      title: 'Kode masuk Anda',
      bodyHtml: p('Masukkan kode berikut di halaman masuk Satu Alur:')
        + `<div style="margin:6px 0 18px;padding:18px;border-radius:14px;background:#EDF5F0;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#16392E;font-family:Menlo,Consolas,monospace">${esc(digits)}</div>`
        + p(`Berlaku <strong>${minutes} menit</strong> dan hanya sekali pakai. Jangan bagikan kode ini kepada siapa pun.`)
        + `<p style="margin:0;font-size:13px;color:#5C6B63">Tidak merasa meminta kode? Abaikan email ini; akun Anda tetap aman.</p>`,
    }),
  }
}

export function testEmail({ via }) {
  return {
    subject: 'Email uji Satu Alur',
    text: `Email uji berhasil. Pengiriman lewat: ${via}.`,
    html: layout({ title: 'Email uji berhasil', bodyHtml: p(`Pengaturan email sudah bekerja. Dikirim lewat <strong>${esc(via)}</strong>.`) }),
  }
}

/** Free-form message written (and possibly edited) by the business, e.g. an offer. */
export function businessEmail({ subject, body, businessName }) {
  return {
    subject,
    text: `${body}\n\n— ${businessName || 'Dikirim lewat Satu Alur'}`,
    html: layout({
      title: subject,
      bodyHtml: p(nl2br(body)),
      footer: businessName ? `Dikirim oleh ${businessName} lewat Satu Alur.` : 'Dikirim lewat Satu Alur.',
    }),
  }
}

/** Default text of an offer email, which the user can edit before sending. */
export function offerEmailDraft({ customer, service, price, scope, terms, businessName }) {
  const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`
  const lines = [
    `Halo ${customer || 'Bapak/Ibu'},`,
    '',
    `Terima kasih atas permintaan ${service || 'layanan'} Anda. Berikut penawaran kami:`,
    '',
    scope ? `Ruang lingkup:\n${scope}` : null,
    price ? `Harga: ${rp(price)}` : null,
    terms ? `Syarat:\n${terms}` : null,
    '',
    'Balas email ini untuk menyetujui atau bertanya.',
    '',
    `Salam,\n${businessName || ''}`.trim(),
  ].filter((l) => l !== null)
  return { subject: `Penawaran ${service || 'layanan'}${customer ? ` untuk ${customer}` : ''}`, body: lines.join('\n') }
}

/**
 * Resend REST client (https://resend.com/docs/api-reference/emails/send-email).
 * The API key comes only from the Worker env (RESEND_API_KEY); `fetchImpl` is injectable for tests.
 */
export const RESEND_URL = 'https://api.resend.com/emails'

export class EmailError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function sendResend({ apiKey, from, to, subject, html, text, replyTo }, fetchImpl = fetch) {
  if (!apiKey) throw new EmailError('Pengiriman email belum dikonfigurasi.', 503)
  let res
  try {
    res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    })
  } catch {
    throw new EmailError('Layanan email tidak bisa dihubungi.', 502)
  }
  let body = null
  try { body = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const detail = String(body?.message || body?.error || `HTTP ${res.status}`).slice(0, 200)
    if (res.status === 401 || res.status === 403) throw new EmailError(`Kunci layanan email ditolak. ${detail}`, 502)
    if (res.status === 422) throw new EmailError(`Email ditolak: ${detail}`, 400)
    if (res.status === 429) throw new EmailError('Terlalu banyak email terkirim. Coba lagi sebentar.', 429)
    throw new EmailError(`Email gagal dikirim. ${detail}`, 502)
  }
  return { id: body?.id || null }
}

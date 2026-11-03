/**
 * Email building blocks shared by the Worker SMTP client and the tests:
 * RFC 5322 message with a multipart/alternative text + HTML body, RFC 2047
 * encoded-words for non-ASCII headers, base64 bodies wrapped at 76 columns,
 * SMTP dot-stuffing and reply parsing. Pure functions, no I/O.
 */

const enc = new TextEncoder()

export function b64(text) {
  const bytes = enc.encode(String(text))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export const wrap76 = (s) => s.replace(/.{1,76}/g, (m) => `${m}\r\n`).replace(/\r\n$/, '')

const ASCII_SAFE = /^[\x20-\x7e]*$/

/** RFC 2047 "B" encoded-word for a header value, only when it is not plain ASCII. */
export function encodeHeaderWord(value) {
  const v = String(value ?? '').replace(/[\r\n]+/g, ' ')
  if (ASCII_SAFE.test(v)) return v
  return `=?UTF-8?B?${b64(v)}?=`
}

/** "Name <email>" with the display name encoded when needed. */
export function formatAddress(email, name) {
  const addr = String(email).trim()
  if (!name) return addr
  const n = String(name).replace(/[\r\n"<>]+/g, ' ').trim()
  return ASCII_SAFE.test(n) ? `"${n}" <${addr}>` : `${encodeHeaderWord(n)} <${addr}>`
}

/** Splits `Satu Alur <noreply@apipedia.id>` into { name, email }. */
export function parseAddress(text) {
  const s = String(text || '').trim()
  const m = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(s)
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || null, email: m[2].trim() }
  return { name: null, email: s }
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim())

/**
 * Full RFC 5322 message (CRLF line endings) with text and optional HTML parts.
 * `date` and `boundary` are injectable so tests can compare exact output.
 */
export function buildMessage({ from, fromName, to, subject, text, html, replyTo, date = new Date(), boundary, messageId }) {
  const b = boundary || `sa-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const domain = String(from).split('@')[1] || 'localhost'
  const headers = [
    `From: ${formatAddress(from, fromName)}`,
    `To: ${Array.isArray(to) ? to.join(', ') : to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId || `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${domain}`}>`,
    'MIME-Version: 1.0',
  ]
  if (replyTo) headers.push(`Reply-To: ${replyTo}`)
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(text || ''))].join('\r\n')
  if (!html) return [...headers, textPart].join('\r\n')
  const htmlPart = ['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(html))].join('\r\n')
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${b}"`,
    '',
    `--${b}`,
    textPart,
    `--${b}`,
    htmlPart,
    `--${b}--`,
    '',
  ].join('\r\n')
}

/** SMTP DATA transparency (RFC 5321 4.5.2): a line starting with "." gets one more. */
export function dotStuff(message) {
  return String(message).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
}

/**
 * Reads complete SMTP replies out of a text buffer. Returns { replies, rest } where each
 * reply is { code, lines } and multi-line replies ("250-...", last "250 ...") are joined.
 */
export function parseReplies(buffer) {
  const replies = []
  let lines = []
  let start = 0 // where the reply being collected began; an unfinished one stays in `rest`
  let pos = 0
  for (;;) {
    const i = buffer.indexOf('\n', pos)
    if (i < 0) break
    const line = buffer.slice(pos, i).replace(/\r$/, '')
    pos = i + 1
    const m = /^(\d{3})([ -])?(.*)$/.exec(line)
    if (!m) continue
    lines.push(m[3])
    if (m[2] !== '-') {
      replies.push({ code: Number(m[1]), lines })
      lines = []
      start = pos
    }
  }
  return { replies, rest: buffer.slice(lines.length ? start : pos) }
}

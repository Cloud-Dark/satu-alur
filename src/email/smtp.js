/**
 * Minimal SMTP submission client for the Worker (cloudflare:sockets).
 *   port 465 / 2465  implicit TLS   (secure 'tls')
 *   port 587 / 2587  STARTTLS        (secure 'starttls')
 * EHLO, AUTH PLAIN (falls back to AUTH LOGIN), MAIL FROM, RCPT TO, DATA, QUIT.
 * `connect` is injected (cloudflare:sockets in the Worker, a fake in tests).
 */
import { b64, buildMessage, dotStuff, parseReplies } from './mime.js'

export const SMTP_PORTS = [465, 587, 2465, 2587]
export const secureForPort = (port) => ([465, 2465].includes(Number(port)) ? 'tls' : 'starttls')

export class SmtpError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

const STEP_MESSAGES = {
  greeting: 'Server SMTP tidak merespons dengan benar.',
  ehlo: 'Server SMTP menolak sapaan (EHLO).',
  starttls: 'Server SMTP tidak mendukung STARTTLS. Coba port 465.',
  auth: 'Login SMTP ditolak. Periksa username dan password.',
  mail: 'Alamat pengirim ditolak server SMTP.',
  rcpt: 'Alamat penerima ditolak server SMTP.',
  data: 'Server SMTP menolak isi email.',
}

/**
 * Sends one message. cfg: { host, port, secure, user, pass, from, fromName, replyTo?, to, subject, text, html }.
 * Resolves { accepted: true, response } or throws SmtpError with an Indonesian message.
 */
export async function sendSmtp(cfg, { connect, timeoutMs = 20000, hostname = 'satualur.local' } = {}) {
  const secure = cfg.secure || secureForPort(cfg.port)
  let socket
  try {
    socket = connect({ hostname: cfg.host, port: Number(cfg.port) }, { secureTransport: secure === 'tls' ? 'on' : 'starttls', allowHalfOpen: false })
  } catch {
    throw new SmtpError('Tidak bisa terhubung ke server SMTP.')
  }
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  let reader = socket.readable.getReader()
  let writer = socket.writable.getWriter()
  let buffer = ''
  const queue = []

  const deadline = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new SmtpError('Server SMTP terlalu lama merespons.')), timeoutMs)),
  ])
  async function reply() {
    while (!queue.length) {
      const { value, done } = await deadline(reader.read())
      if (done) throw new SmtpError('Koneksi SMTP terputus.')
      buffer += dec.decode(value, { stream: true })
      const { replies, rest } = parseReplies(buffer)
      buffer = rest
      queue.push(...replies)
    }
    return queue.shift()
  }
  const send = (line) => writer.write(enc.encode(`${line}\r\n`))
  async function expect(step, codes, line) {
    if (line !== undefined) await send(line)
    const r = await reply()
    if (!codes.includes(r.code)) throw new SmtpError(`${STEP_MESSAGES[step]} (${r.code} ${r.lines.join(' ').slice(0, 160)})`, r.code)
    return r
  }

  try {
    await expect('greeting', [220])
    let ehlo = await expect('ehlo', [250], `EHLO ${hostname}`)
    if (secure === 'starttls') {
      if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError(STEP_MESSAGES.starttls)
      await expect('starttls', [220], 'STARTTLS')
      reader.releaseLock()
      writer.releaseLock()
      socket = socket.startTls()
      reader = socket.readable.getReader()
      writer = socket.writable.getWriter()
      ehlo = await expect('ehlo', [250], `EHLO ${hostname}`)
    }
    if (cfg.user) {
      const authLine = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) || 'AUTH PLAIN LOGIN'
      if (/\bPLAIN\b/i.test(authLine)) {
        await expect('auth', [235], `AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass || ''}`)}`)
      } else {
        await expect('auth', [334], 'AUTH LOGIN')
        await expect('auth', [334], b64(cfg.user))
        await expect('auth', [235], b64(cfg.pass || ''))
      }
    }
    await expect('mail', [250], `MAIL FROM:<${cfg.from}>`)
    await expect('rcpt', [250, 251], `RCPT TO:<${cfg.to}>`)
    await expect('data', [354], 'DATA')
    const message = buildMessage({ from: cfg.from, fromName: cfg.fromName, to: cfg.to, subject: cfg.subject, text: cfg.text, html: cfg.html, replyTo: cfg.replyTo })
    const done = await expect('data', [250], `${dotStuff(message)}\r\n.`)
    try { await send('QUIT') } catch { /* closing anyway */ }
    return { accepted: true, response: done.lines.join(' ') }
  } finally {
    try { await socket.close() } catch { /* already closed */ }
  }
}

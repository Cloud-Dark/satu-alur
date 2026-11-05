/**
 * #/izin-ai?req=<id>: "Izinkan Claude mengakses data usaha Anda (hanya baca)?"
 *
 * Step 2 of the OAuth login for the remote MCP server (worker/oauth.js). Claude sends the owner to
 * /oauth/authorize, which parks the request server-side and redirects here. The router
 * (src/ui/app.js) only renders this page with a session: signed out, it goes through #/masuk and
 * comes back. Everything shown comes from GET /api/oauth/request (never from the URL), and the
 * answer goes to POST /api/oauth/decision, whose `redirect` sends the browser back to Claude.
 */
import '../styles/landing.css'
import '../styles/ai-access.css'
import * as C from '../ui/components.js'
import { docShell } from '../site/doc-page.js'
import { signOut } from '../auth/auth.js'
import { getAuthRequest, decideAuthRequest } from './api.js'

const { el, icon } = C

const reqFromHash = () => new URLSearchParams(location.hash.split('?')[1] || '').get('req') || ''

function notice(tone, text) {
  return el('p', { className: `consent-note is-${tone}`, role: tone === 'error' ? 'alert' : 'status' }, text)
}

export function renderConsentPage(root, ctx) {
  let disposed = false
  const { body, close } = docShell(root, 'Hubungkan Claude', 'Izin Akses AI')
  const card = el('section', { className: 'consent-card', 'aria-busy': 'true', 'aria-live': 'polite' },
    el('p', { className: 'consent-loading' }, 'Memuat permintaan izin…'))
  body.append(card)

  const req = reqFromHash()
  const failed = (message) => {
    const home = el('a', { className: 'btn btn-ghost btn-sm', href: '#/' }, 'Ke beranda')
    card.setAttribute('aria-busy', 'false')
    card.replaceChildren(
      el('h2', { className: 'consent-title' }, 'Permintaan izin tidak bisa dibuka'),
      notice('error', message),
      el('p', { className: 'consent-muted' }, 'Kembali ke Claude lalu hubungkan Satu Alur sekali lagi.'),
      el('div', { className: 'consent-actions' }, home),
    )
  }
  if (!req) { failed('Tautan izin ini tidak lengkap.'); return () => { disposed = true; close() } }

  getAuthRequest(req).then((info) => {
    if (disposed) return
    draw(info)
  }).catch((ex) => { if (!disposed) failed(ex.message) })

  function draw(info) {
    const who = info.account?.company || info.account?.name
    const tools = el('ul', { className: 'consent-tools' }, ...(info.tools || []).map((t) =>
      el('li', { 'data-tool': t.name }, icon('check', { size: 14 }), el('span', {}, el('strong', {}, t.title), ` — ${t.summary}`))))
    const allow = C.button({ label: 'Izinkan', icon: 'check', variant: 'primary', 'data-consent': 'allow' })
    const deny = C.button({ label: info.refused ? 'Tolak dan kembali ke Claude' : 'Tolak', variant: 'ghost', 'data-consent': 'deny' })
    const status = el('p', { className: 'consent-status', role: 'status', hidden: true })
    const switchUser = el('button', { type: 'button', className: 'consent-link' }, 'Bukan Anda? Masuk dengan akun lain')
    switchUser.addEventListener('click', () => { signOut().catch(() => {}) })

    async function answer(approve) {
      allow.disabled = true
      deny.disabled = true
      const restore = C.setBusy(approve ? allow : deny, approve ? 'Mengizinkan…' : 'Menolak…')
      try {
        const { redirect } = await decideAuthRequest(req, approve)
        if (disposed) return
        status.hidden = false
        status.textContent = approve ? 'Diizinkan. Mengembalikan Anda ke Claude…' : 'Ditolak. Mengembalikan Anda ke Claude…'
        window.location.assign(redirect)
      } catch (ex) {
        if (disposed) return
        restore()
        allow.disabled = Boolean(info.refused)
        deny.disabled = false
        status.hidden = false
        status.textContent = ex.message
        status.dataset.tone = 'error'
      }
    }
    allow.addEventListener('click', () => answer(true))
    deny.addEventListener('click', () => answer(false))
    if (info.refused) allow.disabled = true

    card.setAttribute('aria-busy', 'false')
    card.replaceChildren(...[
      el('p', { className: 'consent-eyebrow' }, icon('shield', { size: 14 }), 'Akses AI (MCP) · hanya baca'),
      el('h2', { className: 'consent-title' }, `Izinkan ${info.client_name} mengakses data usaha Anda (hanya baca)?`),
      el('p', { className: 'consent-account' },
        'Masuk sebagai ', el('strong', {}, info.account?.email || '—'), who ? ` (${who})` : '', '. ', switchUser),
      info.refused ? notice('warn', info.refused) : null,
      el('h3', { className: 'consent-sub' }, `Yang bisa dibaca ${info.client_name}:`),
      tools,
      el('p', { className: 'consent-muted' },
        `${info.client_name} tidak bisa mengubah, menghapus, atau mengirim apa pun. Anda bisa memutuskan koneksi ini kapan saja di Pengaturan › Akses AI (MCP).`),
      info.redirect_host ? el('p', { className: 'consent-muted' }, 'Setelah menjawab, Anda dikembalikan ke ', el('strong', { className: 'consent-host' }, info.redirect_host), '.') : null,
      el('div', { className: 'consent-actions' }, allow, deny),
      status,
    ].filter(Boolean))
    if (!info.refused) allow.focus({ preventScroll: true })
  }

  return () => { disposed = true; close() }
}

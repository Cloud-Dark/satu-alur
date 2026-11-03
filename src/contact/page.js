/**
 * Public contact page (#/kontak): renderContactPage(root) -> cleanup.
 *
 * The public pages do not load the app shell, so the app's `.field`/`.input`
 * styles (all scoped to `.app-shell`) never apply here. Everything below is
 * therefore styled by `.contact-page` rules in landing.css — tokens only.
 *
 * Layout: intro column (what this form is for, what happens next) + a form card.
 * The hidden `website` field is a honeypot for bots: off-screen, never display:none.
 */
import '../styles/landing.css'
import * as C from '../ui/components.js'
import { iconHTML } from '../ui/icons.js'
import { docShell } from '../site/doc-page.js'
import { sendContact } from '../customers/api.js'
import { validateContact } from '../customers/rules.js'

const { el } = C

/** Decorative icon span (static markup from our own icon set). */
function iconSpan(name, className, size = 16) {
  const span = el('span', { className, 'aria-hidden': 'true' })
  span.innerHTML = iconHTML(name, { size, stroke: 1.9 })
  return span
}

const POINTS = [
  { icon: 'mail', text: 'Balasan dikirim ke email yang Anda tulis di formulir ini.' },
  { icon: 'users', text: 'Untuk pertanyaan paket, kerja sama, atau kebutuhan Enterprise.' },
  { icon: 'shield', text: 'Data hanya dipakai untuk membalas pesan Anda, tidak untuk hal lain.' },
]

export function renderContactPage(root) {
  let disposed = false
  const { body, close } = docShell(root, 'Hubungi kami', 'Kontak')

  /* ---------------------------------------------------------------- Fields */
  const f = {
    name: C.field({ label: 'Nama', id: 'ct-name', required: true, placeholder: 'Nama lengkap Anda', attrs: { maxlength: '80', autocomplete: 'name' } }),
    email: C.field({ label: 'Email', id: 'ct-email', type: 'email', required: true, placeholder: 'nama@perusahaan.id', attrs: { maxlength: '120', autocomplete: 'email' } }),
    phone: C.field({ label: 'Telepon (opsional)', id: 'ct-phone', type: 'tel', placeholder: '08xx xxxx xxxx', attrs: { maxlength: '30', autocomplete: 'tel' } }),
    subject: C.field({ label: 'Subjek', id: 'ct-subject', required: true, placeholder: 'Misalnya: tanya paket UKM', attrs: { maxlength: '120' } }),
    message: C.textarea({ label: 'Pesan', id: 'ct-message', required: true, rows: 6, placeholder: 'Ceritakan kebutuhan Anda — jenis jasa, jumlah tim, atau pertanyaan spesifik.', attrs: { maxlength: '3000' } }),
  }
  f.message.wrap.classList.add('field-full')
  const trap = C.field({ label: 'Situs web', id: 'ct-website', attrs: { tabindex: '-1', autocomplete: 'off' } })
  const hp = el('div', { className: 'contact-hp', 'aria-hidden': 'true' }, trap.wrap)

  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim pesan', variant: 'primary', type: 'submit' })

  const actions = el('div', { className: 'contact-actions' },
    send,
    el('p', { className: 'contact-actions-note' }, 'Kami membalas lewat email. Tidak ada langganan otomatis.'),
  )

  const form = el('form', { className: 'contact-form', noValidate: true },
    f.name.wrap, f.email.wrap, f.phone.wrap, f.subject.wrap, f.message.wrap,
    hp, err, actions,
  )

  /* --------------------------------------------------------------- Success */
  const again = C.button({ label: 'Kirim pesan lain', variant: 'soft' })
  const done = el('div', { className: 'contact-done', role: 'status' })
  again.addEventListener('click', () => {
    form.reset()
    done.replaceWith(form)
    err.textContent = ''
    f.name.input.focus()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const data = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.input.value])), website: trap.input.value }
    try { validateContact(data) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(send, 'Mengirim…')
    try {
      const msg = await sendContact(data)
      if (disposed) return
      done.replaceChildren(
        iconSpan('check', 'contact-done-ic', 18),
        el('p', {}, msg),
        again,
      )
      form.replaceWith(done)
      done.tabIndex = -1
      done.focus()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })

  /* ----------------------------------------------------------------- Frame */
  const intro = el('aside', { className: 'contact-intro' },
    el('p', { className: 'contact-lede' }, 'Pertanyaan soal paket, kerja sama, atau Enterprise? Tulis di sini dan tim Satu Alur akan membalas lewat email.'),
    el('ul', { className: 'contact-points' }, ...POINTS.map((p) => el('li', {},
      iconSpan(p.icon, 'contact-point-ic'),
      el('span', {}, p.text),
    ))),
  )

  const head = el('div', { className: 'contact-card-head' },
    el('h2', { className: 'contact-card-title' }, 'Kirim pesan'),
    el('p', { className: 'contact-card-note' }, 'Kolom bertanda Wajib harus diisi.'),
  )
  const card = el('div', { className: 'contact-card' }, head, form)

  body.append(el('div', { className: 'contact-page' }, intro, card))
  return () => { disposed = true; close() }
}

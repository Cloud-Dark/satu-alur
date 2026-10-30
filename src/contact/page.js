/**
 * Public contact page (#/kontak): renderContactPage(root) -> cleanup.
 * Same frame as the document pages. The hidden `website` field is a honeypot for bots.
 */
import '../styles/landing.css'
import * as C from '../ui/components.js'
import { docShell } from '../site/doc-page.js'
import { sendContact } from '../customers/api.js'
import { validateContact } from '../customers/rules.js'

const { el } = C

export function renderContactPage(root) {
  let disposed = false
  const { body, close } = docShell(root, 'Hubungi kami', 'Kontak')
  const f = {
    name: C.field({ label: 'Nama', id: 'ct-name', required: true, attrs: { maxlength: '80', autocomplete: 'name' } }),
    email: C.field({ label: 'Email', id: 'ct-email', type: 'email', required: true, attrs: { maxlength: '120', autocomplete: 'email' } }),
    phone: C.field({ label: 'Telepon (opsional)', id: 'ct-phone', type: 'tel', attrs: { maxlength: '30', autocomplete: 'tel' } }),
    subject: C.field({ label: 'Subjek', id: 'ct-subject', required: true, attrs: { maxlength: '120' } }),
    message: C.textarea({ label: 'Pesan', id: 'ct-message', required: true, rows: 6, attrs: { maxlength: '3000' } }),
  }
  const trap = C.field({ label: 'Situs web', id: 'ct-website', attrs: { tabindex: '-1', autocomplete: 'off' } })
  const hp = el('div', { className: 'contact-hp', 'aria-hidden': 'true' }, trap.wrap)
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim pesan', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'contact-form', noValidate: true }, f.name.wrap, f.email.wrap, f.phone.wrap, f.subject.wrap, f.message.wrap, hp, err, send)

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
      done.replaceChildren(el('p', {}, msg), again)
      form.replaceWith(done)
      done.tabIndex = -1
      done.focus()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })

  body.append(el('p', {}, 'Pertanyaan soal paket, kerja sama, atau Enterprise? Tulis di sini dan tim Satu Alur akan membalas lewat email.'), form)
  return () => { disposed = true; close() }
}

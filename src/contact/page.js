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
import { t } from '../i18n/index.js'

const { el } = C

/** Decorative icon span (static markup from our own icon set). */
function iconSpan(name, className, size = 16) {
  const span = el('span', { className, 'aria-hidden': 'true' })
  span.innerHTML = iconHTML(name, { size, stroke: 1.9 })
  return span
}

const POINTS = [
  { icon: 'mail', key: 'reply' },
  { icon: 'users', key: 'topics' },
  { icon: 'shield', key: 'privacy' },
]

// Messages from customers/rules.js (shared with the worker, so written in Indonesian) shown in the current language.
const FIELD_KEYS = { Nama: 'name', Telepon: 'phone', Subjek: 'subject', Pesan: 'message' }
function localError(msg) {
  const m = String(msg || '')
  let r = /^(\S+) wajib diisi\.$/.exec(m)
  if (r && FIELD_KEYS[r[1]]) return t('contact.errors.required', { field: t(`contact.fields.${FIELD_KEYS[r[1]]}`) })
  r = /^(\S+) maksimal (\d+) karakter\.$/.exec(m)
  if (r && FIELD_KEYS[r[1]]) return t('contact.errors.tooLong', { field: t(`contact.fields.${FIELD_KEYS[r[1]]}`), max: r[2] })
  if (m === 'Email tidak valid.') return t('contact.errors.email')
  if (m === 'Terlalu banyak pesan. Coba lagi nanti.') return t('contact.errors.limit')
  if (m === 'Pesan terkirim. Tim Satu Alur akan membalas lewat email.') return t('contact.sent')
  return m
}

export function renderContactPage(root) {
  let disposed = false
  const { body, close } = docShell(root, t('contact.heading'), t('contact.docTitle'))

  /* ---------------------------------------------------------------- Fields */
  const f = {
    name: C.field({ label: t('contact.fields.name'), id: 'ct-name', required: true, placeholder: t('contact.placeholders.name'), attrs: { maxlength: '80', autocomplete: 'name' } }),
    email: C.field({ label: t('contact.fields.email'), id: 'ct-email', type: 'email', required: true, placeholder: t('contact.placeholders.email'), attrs: { maxlength: '120', autocomplete: 'email' } }),
    phone: C.field({ label: t('contact.fields.phoneOptional'), id: 'ct-phone', type: 'tel', placeholder: '08xx xxxx xxxx', attrs: { maxlength: '30', autocomplete: 'tel' } }),
    subject: C.field({ label: t('contact.fields.subject'), id: 'ct-subject', required: true, placeholder: t('contact.placeholders.subject'), attrs: { maxlength: '120' } }),
    message: C.textarea({ label: t('contact.fields.message'), id: 'ct-message', required: true, rows: 6, placeholder: t('contact.placeholders.message'), attrs: { maxlength: '3000' } }),
  }
  f.message.wrap.classList.add('field-full')
  const trap = C.field({ label: t('contact.fields.website'), id: 'ct-website', attrs: { tabindex: '-1', autocomplete: 'off' } })
  const hp = el('div', { className: 'contact-hp', 'aria-hidden': 'true' }, trap.wrap)

  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: t('contact.send'), variant: 'primary', type: 'submit' })

  const actions = el('div', { className: 'contact-actions' },
    send,
    el('p', { className: 'contact-actions-note' }, t('contact.actionsNote')),
  )

  const form = el('form', { className: 'contact-form', noValidate: true },
    f.name.wrap, f.email.wrap, f.phone.wrap, f.subject.wrap, f.message.wrap,
    hp, err, actions,
  )

  /* --------------------------------------------------------------- Success */
  const again = C.button({ label: t('contact.sendAnother'), variant: 'soft' })
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
    try { validateContact(data) } catch (ex) { err.textContent = localError(ex.message); return }
    const restore = C.setBusy(send, t('contact.sending'))
    try {
      const msg = await sendContact(data)
      if (disposed) return
      done.replaceChildren(
        iconSpan('check', 'contact-done-ic', 18),
        el('p', {}, localError(msg)),
        again,
      )
      form.replaceWith(done)
      done.tabIndex = -1
      done.focus()
    } catch (ex) { err.textContent = localError(ex.message) } finally { restore() }
  })

  /* ----------------------------------------------------------------- Frame */
  const intro = el('aside', { className: 'contact-intro' },
    el('p', { className: 'contact-lede' }, t('contact.lede')),
    el('ul', { className: 'contact-points' }, ...POINTS.map((p) => el('li', {},
      iconSpan(p.icon, 'contact-point-ic'),
      el('span', {}, t(`contact.points.${p.key}`)),
    ))),
  )

  const head = el('div', { className: 'contact-card-head' },
    el('h2', { className: 'contact-card-title' }, t('contact.cardTitle')),
    el('p', { className: 'contact-card-note' }, t('contact.cardNote')),
  )
  const card = el('div', { className: 'contact-card' }, head, form)

  body.append(el('div', { className: 'contact-page' }, intro, card))
  return () => { disposed = true; close() }
}

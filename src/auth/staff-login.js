/**
 * /super-admin-login — Satu Alur staff sign-in (username + password).
 * Not linked anywhere. Accounts are created with `npm run staff` (scripts/staff.mjs);
 * a successful login is the only way to open Kantor Satu Alur.
 */
import '../styles/auth.css'
import { staffLogin } from './auth.js'
import { logoLink } from '../ui/brand.js'
import { themeToggleButton } from '../ui/theme.js'
import { iconHTML } from '../ui/icons.js'

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return el
}

export function renderStaffLogin(root, ctx = {}) {
  let disposed = false
  const field = (id, label, attrs) => {
    const input = h('input', { id, class: 'auth-input', required: true, ...attrs })
    return { input, wrap: h('div', { class: 'auth-field' }, h('label', { for: id, class: 'auth-label' }, label), input) }
  }
  const user = field('staff-username', 'Username', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', maxlength: '32' })
  const pass = field('staff-password', 'Password', { type: 'password', name: 'password', autocomplete: 'current-password', maxlength: '128' })
  const label = h('span', { class: 'auth-btn-label' }, 'Masuk')
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg auth-primary' },
    label, h('span', { class: 'auth-btn-icon', 'aria-hidden': 'true', html: iconHTML('arrowRight', { size: 18, stroke: 2 }) }))
  const message = h('p', { class: 'auth-msg', role: 'alert', hidden: true })
  const say = (text, tone = 'error') => { message.hidden = !text; message.textContent = text; message.dataset.tone = tone }

  const form = h('form', { class: 'auth-form', novalidate: true, 'aria-labelledby': 'staff-title' }, user.wrap, pass.wrap, submit)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (submit.disabled) return
    if (!user.input.value.trim() || !pass.input.value) {
      say('Isi username dan password.')
      ;(user.input.value.trim() ? pass.input : user.input).focus()
      return
    }
    say('')
    submit.disabled = true
    label.textContent = 'Memeriksa…'
    try {
      const res = await staffLogin(user.input.value.trim(), pass.input.value)
      if (disposed) return
      say('Berhasil. Membuka Kantor Satu Alur…', 'ok')
      ctx.onSignedIn?.(res?.user)
    } catch (err) {
      if (disposed) return
      say(err.message || 'Gagal masuk. Coba lagi.')
      pass.input.value = ''
      pass.input.focus()
      submit.disabled = false
      label.textContent = 'Masuk'
    }
  })

  const card = h('div', { class: 'auth-card surface' },
    h('p', { class: 'eyebrow auth-eyebrow' }, 'Akses staf'),
    h('h1', { class: 'auth-title display', id: 'staff-title', html: 'Masuk <em>staf</em> Satu Alur.' }),
    h('p', { class: 'auth-helper' }, 'Khusus tim internal Satu Alur. Akun dibuat oleh admin sistem.'),
    form, message,
    h('p', { class: 'auth-privacy' }, h('span', { html: iconHTML('shield', { size: 14 }) }),
      'Akun terkunci 15 menit setelah 5 kali salah password.'))
  root.replaceChildren(h('div', { class: 'auth auth-staff' },
    h('header', { class: 'auth-bar' }, logoLink({ size: 28 }), themeToggleButton()),
    h('main', { class: 'auth-main', id: 'konten' }, card),
    h('footer', { class: 'auth-foot' }, h('p', {}, 'Halaman internal. Jangan bagikan alamat ini.'), h('p', {}, '© 2026 Satu Alur'))))
  user.input.focus()
  return () => { disposed = true }
}

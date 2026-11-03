/**
 * Topbar profile menu: the avatar is a button that opens a small accessible menu
 * (name, email, account badge, plan, Profil saya, Paket & kuota, Pengaturan,
 * Kantor switch for email admins, theme, Keluar). Escape and outside clicks close
 * it; arrow keys move between items. Returns { button, destroy }.
 */
import { el, button, modal, field } from './components.js'
import { icon } from './icons.js'
import { getTheme, toggleTheme } from './theme.js'
import { showToast } from './animations.js'
import { profileMenuItems, cleanProfileName } from '../auth/profile-rules.js'
import { isDemoEmail } from '../auth/demo-accounts.js'
import { getCloud } from '../cloud.js'
import { getMyPlan } from '../quota/api.js'

let seq = 0

export function profileMenu({ user, initials, isAdmin = false, adminVia = null, inOffice = false, onPlan, onSettings, onSwitchOffice, onSignOut }) {
  const id = `profile-menu-${++seq}`
  const demo = isDemoEmail(user.email)
  const { items, badge, canEditProfile } = profileMenuItems({ demo, isAdmin, adminVia, inOffice })
  const avatarText = el('span', { className: 'avatar', 'aria-hidden': 'true' }, initials)
  const btn = el('button', {
    type: 'button', className: 'avatar-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': id,
    'aria-label': `Menu akun ${user.email || ''}`.trim(), title: user.email || 'Akun',
  }, avatarText)

  const nameEl = el('span', { className: 'pm-name' }, (user.name && user.name.trim()) || 'Pengguna')
  const planEl = el('span', { className: 'pm-plan muted' })
  const head = el('div', { className: 'pm-head' },
    el('span', { className: 'avatar avatar-sm', 'aria-hidden': 'true' }, initials),
    el('span', { className: 'pm-id' }, nameEl, el('span', { className: 'pm-email', title: user.email || '' }, user.email || ''),
      el('span', { className: 'pm-meta' }, el('span', { className: `tag pm-badge pm-badge-${badge.toLowerCase()}` }, badge), planEl)))

  const themeLabel = () => (getTheme() === 'dark' ? 'Mode terang' : 'Mode gelap')
  const defs = {
    profile: { label: 'Profil saya', icon: 'users', run: openProfile },
    plan: { label: 'Paket & kuota', icon: 'wallet', run: () => onPlan?.() },
    settings: { label: 'Pengaturan', icon: 'settings', run: () => onSettings?.() },
    office: { label: 'Kantor Satu Alur', icon: 'shield', run: () => onSwitchOffice?.() },
    back: { label: 'Kembali ke usaha saya', icon: 'home', run: () => onSwitchOffice?.() },
    theme: { label: themeLabel(), icon: getTheme() === 'dark' ? 'sun' : 'moon', run: () => { toggleTheme(); refreshTheme() }, keepOpen: true },
    signout: { label: 'Keluar', icon: 'logout', run: () => onSignOut?.(), danger: true },
  }
  const itemEls = items.map((k) => {
    const d = defs[k]
    const b = el('button', { type: 'button', role: 'menuitem', tabindex: '-1', className: `pm-item${d.danger ? ' is-danger' : ''}`, dataset: { item: k } },
      icon(d.icon, { size: 16 }), el('span', { className: 'pm-item-label' }, d.label))
    b.addEventListener('click', () => {
      if (!d.keepOpen) close(false)
      d.run()
    })
    return b
  })
  const themeBtn = itemEls[items.indexOf('theme')]
  function refreshTheme() {
    themeBtn.replaceChildren(icon(getTheme() === 'dark' ? 'sun' : 'moon', { size: 16 }), el('span', { className: 'pm-item-label' }, themeLabel()))
  }

  const menu = el('div', { className: 'pm', id, role: 'menu', 'aria-label': 'Menu akun', hidden: true }, head,
    el('div', { className: 'pm-list' }, itemEls.slice(0, -1)),
    el('div', { className: 'pm-sep', role: 'separator' }), itemEls[itemEls.length - 1])
  const wrap = el('div', { className: 'pm-wrap' }, btn, menu)

  let planLoaded = false
  function loadPlan() {
    if (planLoaded || !items.includes('plan')) return
    planLoaded = true
    getMyPlan().then((p) => { planEl.textContent = `Paket ${p?.plan?.name || 'Free'}` }).catch(() => { planLoaded = false })
  }

  const focusAt = (i) => itemEls[(i + itemEls.length) % itemEls.length].focus()
  function open() {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    wrap.classList.add('is-open')
    loadPlan()
    requestAnimationFrame(() => focusAt(0))
    document.addEventListener('pointerdown', onOutside, true)
  }
  function close(refocus = true) {
    if (menu.hidden) return
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    wrap.classList.remove('is-open')
    document.removeEventListener('pointerdown', onOutside, true)
    if (refocus) btn.focus()
  }
  const onOutside = (e) => { if (!wrap.contains(e.target)) close(false) }
  btn.addEventListener('click', () => (menu.hidden ? open() : close()))
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (menu.hidden) open() }
  })
  menu.addEventListener('keydown', (e) => {
    const i = itemEls.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0) }
    else if (e.key === 'End') { e.preventDefault(); focusAt(itemEls.length - 1) }
    else if (e.key === 'Tab') close(false)
  })

  function openProfile() {
    const f = field({ label: 'Nama tampilan', id: `pm-name-${seq}`, value: (user.name || '').trim(), attrs: { maxlength: '60', autocomplete: 'name', ...(canEditProfile ? {} : { readonly: true }) } })
    const email = field({ label: 'Email', id: `pm-email-${seq}`, type: 'email', value: user.email || '', hint: 'Email dipakai untuk masuk dan tidak bisa diubah.', attrs: { readonly: true } })
    const err = el('p', { className: 'field-error', role: 'alert' })
    const save = button({ label: 'Simpan', icon: 'save', variant: 'primary' })
    const cancel = button({ label: canEditProfile ? 'Batal' : 'Tutup', variant: 'ghost' })
    cancel.dataset.dismiss = ''
    const m = modal({
      title: 'Profil saya',
      description: canEditProfile ? 'Nama ini tampil di aplikasi dan di email yang Anda kirim.' : 'Akun demo memakai profil contoh dan tidak bisa diubah.',
      children: [f.wrap, email.wrap, err], actions: canEditProfile ? [cancel, save] : [cancel], opener: btn,
    })
    save.addEventListener('click', async () => {
      err.textContent = ''
      let name
      try { name = cleanProfileName(f.input.value) } catch (ex) { err.textContent = ex.message; f.input.focus(); return }
      save.disabled = true
      try {
        await getCloud().auth.updateProfile({ name })
        user.name = name
        nameEl.textContent = name
        document.querySelectorAll('.side-user-name').forEach((n) => { n.textContent = name })
        showToast('Profil disimpan.', 'success')
        m.close()
      } catch (ex) { err.textContent = ex.message } finally { save.disabled = false }
    })
  }

  return { button: wrap, destroy: () => document.removeEventListener('pointerdown', onOutside, true) }
}

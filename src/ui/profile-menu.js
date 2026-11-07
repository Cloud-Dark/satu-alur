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
import { t } from '../i18n/index.js'

// cleanProfileName (shared with the worker) throws Indonesian text; show it in the page language.
const NAME_ERRORS = { 'Nama minimal 2 karakter.': 'ui.profile.nameTooShort', 'Nama maksimal 60 karakter.': 'ui.profile.nameTooLong' }

let seq = 0

export function profileMenu({ user, initials, isAdmin = false, adminVia = null, inOffice = false, onPlan, onSettings, onSwitchOffice, onSignOut }) {
  const id = `profile-menu-${++seq}`
  const demo = isDemoEmail(user.email)
  const { items, badge, canEditProfile } = profileMenuItems({ demo, isAdmin, adminVia, inOffice })
  const avatarText = el('span', { className: 'avatar', 'aria-hidden': 'true' }, initials)
  const btn = el('button', {
    type: 'button', className: 'avatar-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': id,
    'aria-label': t('ui.profile.menuFor', { email: user.email || '' }).trim(), title: user.email || t('ui.profile.account'),
  }, avatarText)

  const nameEl = el('span', { className: 'pm-name' }, (user.name && user.name.trim()) || t('ui.profile.user'))
  const planEl = el('span', { className: 'pm-plan muted' })
  const head = el('div', { className: 'pm-head' },
    el('span', { className: 'avatar avatar-sm', 'aria-hidden': 'true' }, initials),
    el('span', { className: 'pm-id' }, nameEl, el('span', { className: 'pm-email', title: user.email || '' }, user.email || ''),
      el('span', { className: 'pm-meta' }, el('span', { className: `tag pm-badge pm-badge-${badge.toLowerCase()}` }, t(`ui.profile.badge.${badge}`)), planEl)))

  const themeLabel = () => (getTheme() === 'dark' ? t('ui.profile.lightMode') : t('ui.profile.darkMode'))
  const defs = {
    profile: { label: t('ui.profile.myProfile'), icon: 'users', run: openProfile },
    plan: { label: t('ui.profile.plan'), icon: 'wallet', run: () => onPlan?.() },
    settings: { label: t('ui.profile.settings'), icon: 'settings', run: () => onSettings?.() },
    office: { label: t('ui.profile.office'), icon: 'shield', run: () => onSwitchOffice?.() },
    back: { label: t('ui.profile.back'), icon: 'home', run: () => onSwitchOffice?.() },
    theme: { label: themeLabel(), icon: getTheme() === 'dark' ? 'sun' : 'moon', run: () => { toggleTheme(); refreshTheme() }, keepOpen: true },
    signout: { label: t('ui.profile.signOut'), icon: 'logout', run: () => onSignOut?.(), danger: true },
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

  const menu = el('div', { className: 'pm', id, role: 'menu', 'aria-label': t('ui.profile.menu'), hidden: true }, head,
    el('div', { className: 'pm-list' }, itemEls.slice(0, -1)),
    el('div', { className: 'pm-sep', role: 'separator' }), itemEls[itemEls.length - 1])
  const wrap = el('div', { className: 'pm-wrap' }, btn, menu)

  let planLoaded = false
  function loadPlan() {
    if (planLoaded || !items.includes('plan')) return
    planLoaded = true
    getMyPlan().then((p) => { planEl.textContent = t('ui.profile.planName', { name: p?.plan?.name || 'Free' }) }).catch(() => { planLoaded = false })
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
    const f = field({ label: t('ui.profile.displayName'), id: `pm-name-${seq}`, value: (user.name || '').trim(), attrs: { maxlength: '60', autocomplete: 'name', ...(canEditProfile ? {} : { readonly: true }) } })
    const email = field({ label: t('ui.profile.email'), id: `pm-email-${seq}`, type: 'email', value: user.email || '', hint: t('ui.profile.emailHint'), attrs: { readonly: true } })
    const err = el('p', { className: 'field-error', role: 'alert' })
    const save = button({ label: t('ui.profile.save'), icon: 'save', variant: 'primary' })
    const cancel = button({ label: canEditProfile ? t('ui.profile.cancel') : t('ui.profile.close'), variant: 'ghost' })
    cancel.dataset.dismiss = ''
    const m = modal({
      title: t('ui.profile.myProfile'),
      description: canEditProfile ? t('ui.profile.editDesc') : t('ui.profile.demoDesc'),
      children: [f.wrap, email.wrap, err], actions: canEditProfile ? [cancel, save] : [cancel], opener: btn,
    })
    save.addEventListener('click', async () => {
      err.textContent = ''
      let name
      try { name = cleanProfileName(f.input.value) } catch (ex) { err.textContent = NAME_ERRORS[ex.message] ? t(NAME_ERRORS[ex.message]) : ex.message; f.input.focus(); return }
      save.disabled = true
      try {
        await getCloud().auth.updateProfile({ name })
        user.name = name
        nameEl.textContent = name
        document.querySelectorAll('.side-user-name').forEach((n) => { n.textContent = name })
        showToast(t('ui.profile.saved'), 'success')
        m.close()
      } catch (ex) { err.textContent = ex.message } finally { save.disabled = false }
    })
  }

  return { button: wrap, destroy: () => document.removeEventListener('pointerdown', onOutside, true) }
}

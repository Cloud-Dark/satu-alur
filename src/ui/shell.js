/**
 * Application shell: sidebar flow nav, sticky topbar, stage host and the
 * settings drawer. renderShell(root, ctx) returns a cleanup function.
 */
import { logoLink } from './brand.js'
import { themeToggleButton } from './theme.js'
import { icon } from './icons.js'
import { el, button } from './components.js'
import { animateView } from './animations.js'
import { isUsingMockCloud } from '../cloud.js'
import { loadFlow } from '../stages/data.js'

import * as StageDashboard from '../stages/dashboard.js'
import * as StageRequest from '../stages/request.js'
import * as StageOffer from '../stages/offer.js'
import * as StageAssign from '../stages/assign.js'
import * as StageComplete from '../stages/complete.js'
import * as StageBookkeeping from '../stages/bookkeeping.js'
import * as StageReport from '../stages/report.js'
import * as StageSettings from '../stages/settings.js'
import * as StageAdvisor from '../stages/advisor.js'
import * as StageRadar from '../stages/radar.js'
import * as StageLeads from '../stages/leads.js'

import * as StageAIAssistant from '../stages/ai-assistant.js'
import * as StageSocialMedia from '../stages/social-media.js'
import * as StagePertumbuhan from '../stages/pertumbuhan.js'
import * as StageOffice from '../stages/office.js'

export const STAGES = [
  { key: 'dashboard', num: '00', label: 'Ringkasan', icon: 'home', module: StageDashboard,
    action: { label: 'Permintaan baru', icon: 'plus', to: 'request', primary: true } },
  { key: 'request', num: '01', label: 'Permintaan', icon: 'inbox', module: StageRequest,
    action: { label: 'Ke penawaran', iconRight: 'arrowRight', to: 'offer' } },
  { key: 'offer', num: '02', label: 'Penawaran', icon: 'sparkles', module: StageOffer,
    action: { label: 'Ke penugasan', iconRight: 'arrowRight', to: 'assign' } },
  { key: 'assign', num: '03', label: 'Penugasan', icon: 'users', module: StageAssign,
    action: { label: 'Ke penyelesaian', iconRight: 'arrowRight', to: 'complete' } },
  { key: 'complete', num: '04', label: 'Penyelesaian', icon: 'checkCircle', module: StageComplete,
    action: { label: 'Ke pembukuan', iconRight: 'arrowRight', to: 'bookkeeping' } },
  { key: 'bookkeeping', num: '05', label: 'Pembukuan', icon: 'ledger', module: StageBookkeeping,
    action: { label: 'Lihat laporan', iconRight: 'arrowRight', to: 'report' } },
  { key: 'report', num: '06', label: 'Laporan', icon: 'chart', module: StageReport,
    action: { label: 'Permintaan baru', icon: 'plus', to: 'request' } },
  { key: 'radar', group: 'growth', label: 'Radar peluang', sub: 'Peluang dari transaksi', icon: 'radar', module: StageRadar,
    action: { label: 'Tanya penasihat', icon: 'bot', to: 'advisor' } },
  { key: 'leads', group: 'growth', label: 'Pencari prospek', sub: 'Peta & radius', icon: 'mapPin', module: StageLeads,
    action: { label: 'Ke penawaran', iconRight: 'arrowRight', to: 'offer' } },
  { key: 'social-media', group: 'growth', label: 'Media Sosial', sub: 'Konten & jadwal', icon: 'megaphone', module: StageSocialMedia,
    action: { label: 'Tanya penasihat', icon: 'bot', to: 'advisor' } },
  { key: 'advisor', group: 'growth', label: 'Penasihat AI', sub: 'Multi-agen bisnis', icon: 'bot', module: StageAdvisor,
    action: { label: 'Ke ringkasan', icon: 'home', to: 'dashboard' } },

  { key: 'ai-assistant', group: 'growth', label: 'AI Superpowers', icon: 'bot', module: StageAIAssistant,
    action: { label: 'Media Sosial', icon: 'megaphone', to: 'social-media' } },
  { key: 'pertumbuhan', group: 'growth', label: 'Pertumbuhan', icon: 'trendingUp', module: StagePertumbuhan,
    action: { label: 'AI Superpowers', icon: 'bot', to: 'ai-assistant' } },
  { key: 'office', group: 'growth', label: 'Kantor Satu Alur', sub: 'Influencer & permintaan', icon: 'users', module: StageOffice, adminOnly: true,
    action: { label: 'Ke ringkasan', icon: 'home', to: 'dashboard' } },
]

const STAGE_KEY = 'satualur_stage'
const COLLAPSE_KEY = 'satualur_sidebar_collapsed'
const DESKTOP = '(min-width: 1024px)'

const store = {
  get(s, k) { try { return s.getItem(k) } catch { return null } },
  set(s, k, v) { try { s.setItem(k, v) } catch { /* storage unavailable */ } },
}

function initials(user) {
  const source = (user?.name && user.name.trim()) || (user?.email || '').split('@')[0] || 'P'
  const parts = source.replace(/[._-]+/g, ' ').trim().split(/\s+/)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
  return letters.toUpperCase()
}

export function renderShell(root, ctx) {
  const user = ctx.user || {}
  const stages = STAGES.filter((s) => !s.adminOnly || ctx.isAdmin)
  const prevTitle = document.title
  const isMock = isUsingMockCloud()
  const mq = window.matchMedia(DESKTOP)
  const disposers = []
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts)
    disposers.push(() => target.removeEventListener(type, fn, opts))
  }

  let current = store.get(sessionStorage, STAGE_KEY)
  if (!stages.some((s) => s.key === current)) current = 'dashboard'
  let viewCtl = null
  let lastFocus = null

  /* ------------------------------------------------------------ Sidebar */

  const navButtons = new Map()
  const navCounts = new Map()

  const navItem = (s) => {
    const count = el('span', { className: 'flow-count tnum', hidden: true })
    const isStage = s.key !== 'dashboard' && !s.group
    const sub = isStage ? `Tahap ${s.num}` : s.sub
    const b = el('button', {
      type: 'button',
      className: `flow-item ${isStage ? 'is-stage' : ''}`.trim(),
      dataset: { stage: s.key },
      title: isStage ? `Tahap ${s.num} · ${s.label}` : s.label,
    },
      el('span', { className: 'flow-node', 'aria-hidden': 'true' }, icon(s.icon, { size: 16 })),
      el('span', { className: 'flow-label' },
        el('span', { className: 'flow-name' }, s.label),
        sub ? el('span', { className: 'flow-step tnum' }, sub) : null,
      ),
      count,
      el('span', { className: 'flow-dot', 'aria-hidden': 'true' }),
    )
    b.addEventListener('click', () => show(s.key, {}, { focus: true }))
    navButtons.set(s.key, b)
    navCounts.set(s.key, count)
    return el('li', {}, b)
  }

  const collapseBtn = el('button', {
    type: 'button', className: 'icon-btn side-collapse', 'aria-label': 'Ciutkan sidebar', title: 'Ciutkan sidebar',
  }, icon('panelLeft'))
  const closeDrawerBtn = el('button', {
    type: 'button', className: 'icon-btn side-close', 'aria-label': 'Tutup menu', title: 'Tutup menu',
  }, icon('x'))

  const modeBadge = el('div', { className: `mode-badge ${isMock ? 'is-demo' : 'is-live'}` },
    el('span', { className: 'pulse-dot mode-dot', 'aria-hidden': 'true' }),
    el('span', { className: 'mode-text' }, isMock ? 'Mode demo · data lokal' : 'Terhubung · Cloudflare D1'),
  )
  modeBadge.title = isMock ? 'Data tersimpan lokal di browser ini' : 'Terhubung ke Cloudflare Worker + D1'

  const settingsBtn = el('button', { type: 'button', className: 'side-row', title: 'Pengaturan' },
    icon('settings'), el('span', { className: 'side-row-label' }, 'Pengaturan'))

  const signOutBtn = el('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Keluar', title: 'Keluar' }, icon('logout'))
  signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true
    try { await ctx.signOut() } finally { signOutBtn.disabled = false }
  })

  const [dash, ...rest] = stages
  const flow = rest.filter((s) => !s.group)
  const growth = rest.filter((s) => s.group === 'growth')
  const sidebar = el('aside', { className: 'side', id: 'app-sidebar', 'aria-label': 'Navigasi alur' },
    el('div', { className: 'side-head' }, logoLink({ size: 28, href: '#/' }), collapseBtn, closeDrawerBtn),
    el('nav', { className: 'side-nav', 'aria-label': 'Tahap alur' },
      el('ol', { className: 'flow-list flow-list-top' }, navItem(dash)),
      el('div', { className: 'side-label' }, el('span', {}, 'Alur kerja'), el('span', { className: 'side-label-count tnum' }, '6 tahap')),
      el('ol', { className: 'flow-list flow-list-stages' }, flow.map(navItem)),
      el('div', { className: 'side-label' }, el('span', {}, 'Pertumbuhan'), el('span', { className: 'side-label-count tnum' }, 'AI')),
      el('ol', { className: 'flow-list flow-list-growth' }, growth.map(navItem)),
    ),
    el('div', { className: 'side-foot' },
      settingsBtn,
      modeBadge,
      el('div', { className: 'side-user' },
        el('span', { className: 'avatar avatar-sm', 'aria-hidden': 'true' }, initials(user)),
        el('span', { className: 'side-user-text' },
          el('span', { className: 'side-user-name' }, (user.name && user.name.trim()) || 'Pengguna'),
          el('span', { className: 'side-user-email', title: user.email || '' }, user.email || ''),
        ),
        signOutBtn,
      ),
    ),
  )

  const scrim = el('div', { className: 'scrim', hidden: true })

  /* ------------------------------------------------------------- Topbar */

  const menuBtn = el('button', {
    type: 'button', className: 'icon-btn topbar-menu', 'aria-label': 'Buka menu', 'aria-controls': 'app-sidebar', 'aria-expanded': 'false',
  }, icon('menu'))
  const crumbNum = el('span', { className: 'crumb-pre' })
  const crumbTitle = el('span', { className: 'crumb-title' })
  const actionSlot = el('div', { className: 'topbar-action' })
  const avatar = el('span', { className: 'avatar', role: 'img', title: user.email || '', 'aria-label': `Masuk sebagai ${user.email || 'pengguna'}` }, initials(user))

  const topbar = el('header', { className: 'topbar' },
    menuBtn,
    el('div', { className: 'crumb' }, crumbNum, el('span', { className: 'crumb-sep', 'aria-hidden': 'true' }, icon('chevronRight', { size: 14 })), crumbTitle),
    el('div', { className: 'topbar-right' }, themeToggleButton(), actionSlot, avatar),
  )

  const host = el('main', { className: 'stage-host', id: 'main', tabindex: '-1' })

  /* ------------------------------------------------------ Settings drawer */

  const drawerBody = el('div', { className: 'drawer-body' })
  const drawerClose = el('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Tutup pengaturan', title: 'Tutup (Esc)' }, icon('x'))
  const drawer = el('div', {
    className: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title', hidden: true,
  },
    el('div', { className: 'drawer-head' },
      el('div', {},
        el('span', { className: 'drawer-pre' }, 'Konfigurasi ruang kerja'),
        el('h2', { id: 'drawer-title', className: 'drawer-title display' }, 'Peng', el('em', {}, 'aturan')),
      ),
      drawerClose,
    ),
    drawerBody,
    el('div', { className: 'drawer-foot' },
      el('span', { className: 'drawer-foot-note' }, icon('save', { size: 14 }), 'Perubahan tersimpan otomatis di browser ini.'),
      button({ label: 'Selesai', variant: 'primary', size: 'sm', onClick: () => closeSettings() }),
    ),
  )
  const drawerScrim = el('div', { className: 'scrim scrim-drawer', hidden: true })

  /* ------------------------------------------------------------- Layout */

  const shell = el('div', { className: 'app-shell' },
    el('a', { className: 'skip-link', href: '#main', onClick: (e) => { e.preventDefault(); host.focus() } }, 'Lewati ke konten'),
    el('div', { className: 'side-rail' }, sidebar),
    scrim,
    el('div', { className: 'main-col' }, topbar, host),
    drawerScrim,
    drawer,
  )
  if (store.get(localStorage, COLLAPSE_KEY) === '1') shell.classList.add('is-collapsed')
  root.appendChild(shell)
  document.body.classList.add('in-app')

  /* ---------------------------------------------------------- Behaviour */

  function syncCollapseLabel() {
    const collapsed = shell.classList.contains('is-collapsed')
    const label = collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'
    collapseBtn.setAttribute('aria-label', label)
    collapseBtn.title = label
    collapseBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false')
  }
  collapseBtn.addEventListener('click', () => {
    shell.classList.toggle('is-collapsed')
    store.set(localStorage, COLLAPSE_KEY, shell.classList.contains('is-collapsed') ? '1' : '0')
    syncCollapseLabel()
  })
  syncCollapseLabel()

  function openNav() {
    if (mq.matches) return
    lastFocus = document.activeElement
    shell.classList.add('nav-open')
    scrim.hidden = false
    menuBtn.setAttribute('aria-expanded', 'true')
    document.body.classList.add('scroll-lock')
    navButtons.get(current)?.focus()
  }
  function closeNav({ restore = true } = {}) {
    if (!shell.classList.contains('nav-open')) return
    shell.classList.remove('nav-open')
    scrim.hidden = true
    menuBtn.setAttribute('aria-expanded', 'false')
    document.body.classList.remove('scroll-lock')
    if (restore) lastFocus?.focus?.()
  }
  menuBtn.addEventListener('click', openNav)
  closeDrawerBtn.addEventListener('click', () => closeNav())
  scrim.addEventListener('click', () => closeNav())
  on(mq, 'change', () => closeNav({ restore: false }))

  let settingsReturn = null
  function openSettings() {
    settingsReturn = document.activeElement
    closeNav({ restore: false })
    StageSettings.render(drawerBody)
    drawer.hidden = false
    drawerScrim.hidden = false
    document.body.classList.add('scroll-lock')
    requestAnimationFrame(() => {
      drawer.classList.add('is-open')
      drawerScrim.classList.add('is-open')
      drawerClose.focus()
    })
  }
  function closeSettings() {
    if (drawer.hidden) return
    drawer.classList.remove('is-open')
    drawerScrim.classList.remove('is-open')
    document.body.classList.remove('scroll-lock')
    const finish = () => { drawer.hidden = true; drawerScrim.hidden = true }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) finish()
    else setTimeout(finish, 280)
    settingsReturn?.focus?.()
  }
  settingsBtn.addEventListener('click', openSettings)
  drawerClose.addEventListener('click', closeSettings)
  drawerScrim.addEventListener('click', closeSettings)

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  function trapFocus(container, e) {
    const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  on(document, 'keydown', (e) => {
    const drawerOpen = !drawer.hidden
    const navOpen = shell.classList.contains('nav-open')
    if (e.key === 'Escape') {
      if (drawerOpen) { e.preventDefault(); closeSettings() }
      else if (navOpen) { e.preventDefault(); closeNav() }
    } else if (e.key === 'Tab') {
      if (drawerOpen) trapFocus(drawer, e)
      else if (navOpen) trapFocus(sidebar, e)
    }
  })

  /* ------------------------------------------------------- Nav counters */

  let countsSeq = 0
  async function refreshCounts() {
    const seq = ++countsSeq
    try {
      const m = await loadFlow()
      if (seq !== countsSeq) return
      const pending = {
        offer: m.requestsWithoutOffer().length + m.draftOffers().length,
        assign: m.approvedWithoutAssignment().length,
        complete: m.activeAssignments().length,
        bookkeeping: m.completionsWithoutLedger().length,
      }
      for (const [k, countEl] of navCounts) {
        const n = pending[k] || 0
        countEl.hidden = n === 0
        countEl.textContent = String(n)
        navButtons.get(k).classList.toggle('has-pending', n > 0)
        countEl.title = n ? `${n} menunggu tindakan` : ''
      }
    } catch { /* counters are best-effort */ }
  }
  on(window, 'satualur:data-changed', refreshCounts)

  /* -------------------------------------------------------- Stage switch */

  function setTopbar(stage) {
    crumbNum.textContent = stage.key === 'dashboard' ? 'Satu Alur' : stage.group ? 'Pertumbuhan' : `Tahap ${stage.num}`
    crumbTitle.textContent = stage.label
    const a = stage.action
    const b = button({
      label: a.label, icon: a.icon, iconRight: a.iconRight, size: 'sm',
      variant: a.primary ? 'primary' : 'soft', className: 'topbar-cta',
      onClick: () => show(a.to, {}, { focus: true }),
    })
    b.setAttribute('aria-label', a.label)
    actionSlot.replaceChildren(b)
  }

  async function show(key, params = {}, { focus = false } = {}) {
    const stage = stages.find((s) => s.key === key) || stages[0]
    viewCtl?.abort()
    viewCtl = new AbortController()
    const signal = viewCtl.signal
    current = stage.key
    store.set(sessionStorage, STAGE_KEY, stage.key)

    for (const [k, b] of navButtons) {
      const active = k === stage.key
      b.classList.toggle('is-active', active)
      if (active) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    }
    setTopbar(stage)
    document.title = `${stage.label} — Satu Alur`
    closeNav({ restore: false })

    const view = el('div', { className: `view view-${stage.key}` })
    host.replaceChildren(view)
    window.scrollTo({ top: 0, behavior: 'instant' })

    const stageCtx = {
      user,
      signal,
      params,
      isMock,
      navigate: (to, p) => show(to, p, { focus: true }),
      openSettings,
    }
    try {
      const done = stage.module.render(view, stageCtx)
      animateView(view)
      await done
    } catch (err) {
      if (signal.aborted) return
      console.error(err)
      view.replaceChildren(el('div', { className: 'note note-danger' }, icon('alert'),
        el('div', { className: 'note-body' }, el('p', {}, `Gagal memuat tahap ${stage.label}: ${err.message}`))))
    }
    if (focus && !signal.aborted) {
      const h = view.querySelector('.page-title, h1')
      ;(h || host).focus({ preventScroll: true })
    }
  }

  show(current)
  refreshCounts()

  return () => {
    viewCtl?.abort()
    disposers.forEach((d) => d())
    document.body.classList.remove('in-app', 'scroll-lock')
    document.title = prevTitle
  }
}

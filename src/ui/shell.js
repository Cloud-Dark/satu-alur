/**
 * Application shell: sidebar flow nav, sticky topbar, stage host and the
 * settings drawer. renderShell(root, ctx) returns a cleanup function.
 *
 * Every page has its own URL (#/app/…, see ./routes.js). Moving inside the app pushes a history
 * entry, so Back/Forward work; app.js hands #/app/… hash changes to the handler registered here
 * through ctx.setRouteHandler, and a reload or a deep link opens exactly that page.
 */
import { logoLink } from './brand.js'
import { themeToggleButton } from './theme.js'
import { langToggleButton } from '../i18n/switcher.js'
import { t } from '../i18n/index.js'
import { profileMenu } from './profile-menu.js'
import { icon } from './icons.js'
import { el, button, infoTip } from './components.js'
import { animateView } from './animations.js'
import { isUsingMockCloud } from '../cloud.js'
import { loadFlow } from '../stages/data.js'
import { setOwner as setAiOwner } from '../ai/superpowers.js'
import { parseAppRoute, formatAppRoute, resolveStage } from './routes.js'

import * as StageDashboard from '../stages/dashboard.js'
import * as StageWorkflow from '../stages/workflow.js'
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
import * as StageVas from '../stages/vas.js'
import * as StageZeroWaste from '../stages/zero-waste.js'
import * as StageInvoice from '../stages/invoice.js'
import * as Office from '../stages/office/index.js'
import * as StageSupport from '../support/page.js'
import * as StagePlan from '../quota/page.js'
import { mountUpsell } from '../quota/upsell.js'

export const STAGES = [
  { key: 'dashboard', num: '00', label: t('shell.stages.dashboard.label'), icon: 'home',
    hint: t('shell.stages.dashboard.hint'), module: StageDashboard,
    action: { label: t('shell.stages.dashboard.action'), iconRight: 'arrowRight', to: 'workflow', primary: true } },
  // One menu for the whole job flow: a table with one row per job. The five stage
  // pages below are opened from that table (parent: 'workflow') and stay out of the sidebar.
  { key: 'workflow', group: 'main', label: t('shell.stages.workflow.label'), sub: t('shell.stages.workflow.sub'), icon: 'activity',
    hint: t('shell.stages.workflow.hint'),
    module: StageWorkflow,
    action: { label: t('shell.stages.workflow.action'), icon: 'plus', to: 'request', primary: true } },
  { key: 'request', parent: 'workflow', num: '01', label: t('shell.stages.request.label'), icon: 'inbox',
    hint: t('shell.stages.request.hint'), module: StageRequest,
    action: { label: t('shell.stages.request.action'), iconRight: 'arrowRight', to: 'offer' } },
  { key: 'offer', parent: 'workflow', num: '02', label: t('shell.stages.offer.label'), icon: 'sparkles',
    hint: t('shell.stages.offer.hint'), module: StageOffer,
    action: { label: t('shell.stages.offer.action'), iconRight: 'arrowRight', to: 'assign' } },
  { key: 'assign', parent: 'workflow', num: '03', label: t('shell.stages.assign.label'), icon: 'users',
    hint: t('shell.stages.assign.hint'), module: StageAssign,
    action: { label: t('shell.stages.assign.action'), iconRight: 'arrowRight', to: 'complete' } },
  { key: 'complete', parent: 'workflow', num: '04', label: t('shell.stages.complete.label'), icon: 'checkCircle',
    hint: t('shell.stages.complete.hint'), module: StageComplete,
    action: { label: t('shell.stages.complete.action'), iconRight: 'arrowRight', to: 'bookkeeping' } },
  { key: 'bookkeeping', parent: 'workflow', num: '05', label: t('shell.stages.bookkeeping.label'), icon: 'ledger',
    hint: t('shell.stages.bookkeeping.hint'), module: StageBookkeeping,
    action: { label: t('shell.stages.bookkeeping.action'), iconRight: 'arrowRight', to: 'report' } },
  { key: 'report', group: 'main', label: t('shell.stages.report.label'), sub: t('shell.stages.report.sub'), icon: 'chart',
    hint: t('shell.stages.report.hint'), module: StageReport,
    action: { label: t('shell.stages.report.action'), icon: 'plus', to: 'request' } },
  { key: 'invoice', group: 'income', label: t('shell.stages.invoice.label'), sub: t('shell.stages.invoice.sub'), icon: 'receipt',
    hint: t('shell.stages.invoice.hint'),
    module: StageInvoice, action: { label: t('shell.stages.invoice.action'), iconRight: 'arrowRight', to: 'report' } },
  { key: 'vas', group: 'income', label: t('shell.stages.vas.label'), sub: t('shell.stages.vas.sub'), icon: 'layers',
    hint: t('shell.stages.vas.hint'),
    module: StageVas,
    action: { label: t('shell.stages.vas.action'), iconRight: 'arrowRight', to: 'zero-waste' } },
  { key: 'zero-waste', group: 'income', label: t('shell.stages.zeroWaste.label'), sub: t('shell.stages.zeroWaste.sub'), icon: 'sprout',
    hint: t('shell.stages.zeroWaste.hint'),
    module: StageZeroWaste,
    action: { label: t('shell.stages.zeroWaste.action'), iconRight: 'arrowRight', to: 'vas' } },
  { key: 'radar', group: 'growth', label: t('shell.stages.radar.label'), sub: t('shell.stages.radar.sub'), icon: 'radar',
    hint: t('shell.stages.radar.hint'), module: StageRadar,
    action: { label: t('shell.stages.radar.action'), icon: 'bot', to: 'advisor' } },
  { key: 'leads', group: 'growth', label: t('shell.stages.leads.label'), sub: t('shell.stages.leads.sub'), icon: 'mapPin',
    hint: t('shell.stages.leads.hint'), module: StageLeads,
    action: { label: t('shell.stages.leads.action'), iconRight: 'arrowRight', to: 'offer' } },
  { key: 'social-media', group: 'growth', label: t('shell.stages.socialMedia.label'), sub: t('shell.stages.socialMedia.sub'), icon: 'megaphone',
    hint: t('shell.stages.socialMedia.hint'), module: StageSocialMedia,
    action: { label: t('shell.stages.socialMedia.action'), icon: 'bot', to: 'advisor' } },
  { key: 'advisor', group: 'growth', label: t('shell.stages.advisor.label'), sub: t('shell.stages.advisor.sub'), icon: 'bot',
    hint: t('shell.stages.advisor.hint'), module: StageAdvisor,
    action: { label: t('shell.stages.advisor.action'), icon: 'home', to: 'dashboard' } },

  { key: 'ai-assistant', group: 'growth', label: t('shell.stages.aiAssistant.label'), sub: t('shell.stages.aiAssistant.sub'), icon: 'bot',
    hint: t('shell.stages.aiAssistant.hint'), module: StageAIAssistant,
    action: { label: t('shell.stages.aiAssistant.action'), icon: 'megaphone', to: 'social-media' } },
  { key: 'pertumbuhan', group: 'growth', label: t('shell.stages.pertumbuhan.label'), icon: 'trendingUp', module: StagePertumbuhan,
    action: { label: t('shell.stages.pertumbuhan.action'), icon: 'bot', to: 'ai-assistant' } },
  { key: 'plan', group: 'help', label: t('shell.stages.plan.label'), sub: t('shell.stages.plan.sub'), icon: 'wallet',
    hint: t('shell.stages.plan.hint'), module: StagePlan,
    action: { label: t('shell.stages.plan.action'), icon: 'home', to: 'dashboard' } },
  // Every signed-in user (staff too, harmless); drawn last in the nav, just above Pengaturan.
  { key: 'support', group: 'help', label: t('shell.stages.support.label'), sub: t('shell.stages.support.sub'), icon: 'message',
    hint: t('shell.stages.support.hint'), module: StageSupport,
    action: { label: t('shell.stages.support.action'), icon: 'home', to: 'dashboard' } },
]

// Staff (admin sessions) see only the office sections, one sidebar item each.
const STAFF_STAGES = Office.ITEMS.map((i) => ({
  key: i.key, group: i.group, label: i.label, icon: i.icon, module: { render: (view, c) => Office.render(view, c, i.key) },
}))

const STAGE_KEY = 'satualur_stage'
const STAFF_KEY = 'satualur_office_section'
const ADMIN_VIEW_KEY = 'satualur_admin_view'
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
  setAiOwner(user.id) // AI chat memory is per account, never shared on a device
  // Staff sessions only ever see the office. Email admins (ADMIN_EMAILS) also run a business, so
  // they switch between their app and Kantor Satu Alur; the choice is kept for this tab.
  const emailAdmin = ctx.isAdmin === true && ctx.adminVia === 'email'
  const route0 = parseAppRoute(location.hash) || { bare: true, params: {} }
  // An office URL opens Kantor Satu Alur for an email admin, a business URL their own app.
  if (emailAdmin && route0.office) store.set(sessionStorage, ADMIN_VIEW_KEY, 'office')
  else if (emailAdmin && !route0.bare && !route0.settings) store.set(sessionStorage, ADMIN_VIEW_KEY, 'app')
  const staff = ctx.isAdmin === true && (!emailAdmin || store.get(sessionStorage, ADMIN_VIEW_KEY) === 'office')
  const stages = staff ? STAFF_STAGES : STAGES
  const storeKey = staff ? STAFF_KEY : STAGE_KEY
  const prevTitle = document.title
  const isMock = isUsingMockCloud()
  const mq = window.matchMedia(DESKTOP)
  const disposers = []
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts)
    disposers.push(() => target.removeEventListener(type, fn, opts))
  }

  const hasStage = (key) => stages.some((s) => s.key === key)
  // The URL names the page; a bare #/app reopens the last page of this tab.
  let current = null
  let initialParams = {}
  if (staff ? route0.office && hasStage(route0.stage) : !route0.office && !route0.bare && !route0.settings && hasStage(route0.stage)) {
    current = route0.stage
    initialParams = route0.params || {}
  }
  if (!current) current = store.get(sessionStorage, storeKey)
  if (!hasStage(current)) current = stages[0].key
  let viewCtl = null
  let leaveGuard = null
  let lastFocus = null

  /* ------------------------------------------------------------ Sidebar */

  const navButtons = new Map()
  const navCounts = new Map()

  const navItem = (s) => {
    const count = el('span', { className: 'flow-count tnum', hidden: true })
    const isStage = s.key !== 'dashboard' && !s.group
    const sub = isStage ? t('shell.nav.stage', { num: s.num }) : s.sub
    const b = el('button', {
      type: 'button',
      className: `flow-item ${isStage ? 'is-stage' : ''}`.trim(),
      dataset: { stage: s.key },
      title: isStage ? t('shell.nav.stageTitle', { num: s.num, label: s.label }) : s.label,
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
    type: 'button', className: 'icon-btn side-collapse', 'aria-label': t('shell.nav.collapse'), title: t('shell.nav.collapse'),
  }, icon('panelLeft'))
  const closeDrawerBtn = el('button', {
    type: 'button', className: 'icon-btn side-close', 'aria-label': t('shell.nav.closeMenu'), title: t('shell.nav.closeMenu'),
  }, icon('x'))

  const settingsBtn = el('button', { type: 'button', className: 'side-row', title: t('shell.nav.settings') },
    icon('settings'), el('span', { className: 'side-row-label' }, t('shell.nav.settings')))

  const officeSwitch = emailAdmin
    ? el('button', { type: 'button', className: 'side-row side-row-office', title: staff ? t('shell.nav.backToBusiness') : t('shell.nav.office') },
      icon(staff ? 'home' : 'shield'), el('span', { className: 'side-row-label' }, staff ? t('shell.nav.backToBusiness') : t('shell.nav.office')))
    : null
  officeSwitch?.addEventListener('click', () => switchOffice())

  const signOutBtn = el('button', { type: 'button', className: 'icon-btn', 'aria-label': t('shell.nav.signOut'), title: t('shell.nav.signOut') }, icon('logout'))
  signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true
    try { await ctx.signOut() } finally { signOutBtn.disabled = false }
  })

  const [dash, ...rest] = stages
  const main = rest.filter((s) => s.group === 'main')
  const income = rest.filter((s) => s.group === 'income')
  const growth = rest.filter((s) => s.group === 'growth')
  const help = rest.filter((s) => s.group === 'help')
  const navLists = staff
    ? Office.GROUPS.map((g) => [
      el('div', { className: 'side-label' }, el('span', {}, g.title)),
      el('ol', { className: 'flow-list' }, stages.filter((s) => s.group === g.title).map(navItem))])
    : [
      el('ol', { className: 'flow-list flow-list-top' }, navItem(dash), main.map(navItem)),
      el('div', { className: 'side-label' }, el('span', {}, t('shell.nav.income')), el('span', { className: 'side-label-count tnum' }, t('shell.nav.incomeCount'))),
      el('ol', { className: 'flow-list flow-list-income' }, income.map(navItem)),
      el('div', { className: 'side-label' }, el('span', {}, t('shell.nav.growth')), el('span', { className: 'side-label-count tnum' }, t('shell.nav.growthCount'))),
      el('ol', { className: 'flow-list flow-list-growth' }, growth.map(navItem)),
      el('ol', { className: 'flow-list flow-list-help' }, help.map(navItem))]
  const sidebar = el('aside', { className: 'side', id: 'app-sidebar', 'aria-label': staff ? t('shell.nav.officeMenu') : t('shell.nav.flowNav') },
    el('div', { className: 'side-head' }, logoLink({ size: 28, href: '#/' }), collapseBtn, closeDrawerBtn),
    el('nav', { className: 'side-nav', 'aria-label': staff ? t('shell.nav.officeSections') : t('shell.nav.flowStages') }, ...navLists.flat()),
    el('div', { className: 'side-foot' },
      officeSwitch,
      staff ? null : settingsBtn,
      el('div', { className: 'side-user' },
        el('span', { className: 'avatar avatar-sm', 'aria-hidden': 'true' }, initials(user)),
        el('span', { className: 'side-user-text' },
          el('span', { className: 'side-user-name' }, (user.name && user.name.trim()) || t('shell.nav.user')),
          el('span', { className: 'side-user-email', title: user.email || '' }, user.email || ''),
        ),
        signOutBtn,
      ),
    ),
  )

  const scrim = el('div', { className: 'scrim', hidden: true })

  /* ------------------------------------------------------------- Topbar */

  const menuBtn = el('button', {
    type: 'button', className: 'icon-btn topbar-menu', 'aria-label': t('shell.nav.openMenu'), 'aria-controls': 'app-sidebar', 'aria-expanded': 'false',
  }, icon('menu'))
  const crumbNum = el('span', { className: 'crumb-pre' })
  const crumbTitle = el('span', { className: 'crumb-title' })
  const crumbTip = el('span', { className: 'crumb-tip' })
  const actionSlot = el('div', { className: 'topbar-action' })
  const switchOffice = () => {
    store.set(sessionStorage, ADMIN_VIEW_KEY, staff ? 'app' : 'office')
    ctx.navigate(staff ? '/app' : '/app/kantor')
  }
  const profile = profileMenu({
    user, initials: initials(user), isAdmin: ctx.isAdmin === true, adminVia: ctx.adminVia || null, inOffice: staff,
    onPlan: () => show('plan', {}, { focus: true }),
    onSettings: () => openSettings(),
    onSwitchOffice: switchOffice,
    onSignOut: () => ctx.signOut(),
  })
  disposers.push(profile.destroy)
  const avatar = profile.button

  const topbar = el('header', { className: 'topbar' },
    menuBtn,
    el('div', { className: 'crumb' }, crumbNum, el('span', { className: 'crumb-sep', 'aria-hidden': 'true' }, icon('chevronRight', { size: 14 })), crumbTitle, crumbTip),
    el('div', { className: 'topbar-right' }, langToggleButton(), themeToggleButton(), actionSlot, avatar),
  )

  const host = el('main', { className: 'stage-host', id: 'main', tabindex: '-1' })

  /* ------------------------------------------------------ Settings drawer */

  const drawerBody = el('div', { className: 'drawer-body' })
  const drawerClose = el('button', { type: 'button', className: 'icon-btn', 'aria-label': t('shell.drawer.close'), title: t('shell.drawer.closeTitle') }, icon('x'))
  const drawer = el('div', {
    className: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title', hidden: true,
  },
    el('div', { className: 'drawer-head' },
      el('div', {},
        el('span', { className: 'drawer-pre' }, t('shell.drawer.pre')),
        el('h2', { id: 'drawer-title', className: 'drawer-title display', html: t('shell.drawer.title') }),
      ),
      drawerClose,
    ),
    drawerBody,
    el('div', { className: 'drawer-foot' },
      el('span', { className: 'drawer-foot-note' }, icon('save', { size: 14 }), t('shell.drawer.note')),
      button({ label: t('shell.drawer.done'), variant: 'primary', size: 'sm', onClick: () => closeSettings() }),
    ),
  )
  const drawerScrim = el('div', { className: 'scrim scrim-drawer', hidden: true })

  /* ------------------------------------------------------------- Layout */

  const shell = el('div', { className: 'app-shell' },
    el('a', { className: 'skip-link', href: '#main', onClick: (e) => { e.preventDefault(); host.focus() } }, t('shell.nav.skip')),
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
    const label = collapsed ? t('shell.nav.expand') : t('shell.nav.collapse')
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

  /* --------------------------------------------------------------- URLs */

  const routeFor = (key, params = {}) => formatAppRoute(staff ? { stage: key, office: true } : { stage: key, params })
  let stageHash = null // URL of the page on screen (without its dialog or the settings drawer)
  let lastHash = null // URL this shell wrote last
  let routeDialog = null // { dialog } of the open dialog that has its own URL
  function writeHash(hash, { replace = false } = {}) {
    lastHash = hash
    if (location.hash === hash) return
    if (replace) history.replaceState(null, '', hash)
    else history.pushState(null, '', hash)
  }

  let settingsReturn = null
  let settingsPushed = false
  function openSettings({ fromUrl = false } = {}) {
    if (staff) return
    if (!drawer.hidden) return
    if (!fromUrl) {
      const hash = formatAppRoute({ settings: true })
      settingsPushed = location.hash !== hash
      writeHash(hash)
    } else settingsPushed = false
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
  function closeSettings({ fromUrl = false } = {}) {
    if (drawer.hidden) return
    // Closing goes back to the page's own URL (Back when opening it added the history entry).
    if (!fromUrl && parseAppRoute(location.hash)?.settings && stageHash) {
      if (settingsPushed) { lastHash = stageHash; history.back() } else writeHash(stageHash, { replace: true })
    }
    settingsPushed = false
    drawer.classList.remove('is-open')
    drawerScrim.classList.remove('is-open')
    document.body.classList.remove('scroll-lock')
    const finish = () => { drawer.hidden = true; drawerScrim.hidden = true }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) finish()
    else setTimeout(finish, 280)
    settingsReturn?.focus?.()
  }
  settingsBtn.addEventListener('click', () => openSettings())
  drawerClose.addEventListener('click', () => closeSettings())
  drawerScrim.addEventListener('click', () => closeSettings())

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
      const m = staff ? null : await loadFlow()
      const pending = staff ? await Office.badgeCounts() : {
        offer: m.requestsWithoutOffer().length + m.draftOffers().length,
        assign: m.approvedWithoutAssignment().length,
        complete: m.activeAssignments().length,
        bookkeeping: m.completionsWithoutLedger().length,
      }
      if (!staff) pending.workflow = pending.offer + pending.assign + pending.complete + pending.bookkeeping
      if (seq !== countsSeq) return
      for (const [k, countEl] of navCounts) {
        const n = pending[k] || 0
        countEl.hidden = n === 0
        countEl.textContent = String(n)
        navButtons.get(k).classList.toggle('has-pending', n > 0)
        countEl.title = n ? (staff ? Office.BADGE_TITLES[k](n) : t('shell.nav.pending', { n })) : ''
        // The count is a bare number; staff items also announce what it counts.
        if (staff) {
          const btn = navButtons.get(k)
          if (n) btn.setAttribute('aria-label', `${btn.querySelector('.flow-name').textContent}, ${Office.BADGE_TITLES[k](n)}`)
          else btn.removeAttribute('aria-label')
        }
      }
    } catch { /* counters are best-effort */ }
  }
  on(window, 'satualur:data-changed', refreshCounts)

  /* -------------------------------------------------------- Stage switch */

  function setTopbar(stage) {
    const groupLabel = { main: t('shell.crumb.home'), income: t('shell.nav.income'), growth: t('shell.nav.growth'), help: t('shell.crumb.home') }[stage.group]
    crumbNum.textContent = staff ? stage.group : stage.key === 'dashboard' ? t('shell.crumb.home') : stage.parent ? t('shell.crumb.workflow') : groupLabel || t('shell.crumb.home')
    crumbTitle.textContent = stage.label
    crumbTip.replaceChildren(stage.hint ? infoTip(stage.hint, { label: t('shell.crumb.about', { label: stage.label }) }) : '')
    // A stage page opened from the Alur kerja table leads back to it.
    const a = stage.parent ? { label: t('shell.crumb.backToWorkflow'), icon: 'arrowLeft', to: stage.parent } : stage.action
    if (!a) { actionSlot.replaceChildren(); return }
    const b = button({
      label: a.label, icon: a.icon, iconRight: a.iconRight, size: 'sm',
      variant: a.primary ? 'primary' : 'soft', className: 'topbar-cta',
      onClick: () => show(a.to, {}, { focus: true }),
    })
    b.setAttribute('aria-label', a.label)
    actionSlot.replaceChildren(b)
  }

  /**
   * Opens a page. fromUrl: the URL already changed (Back/Forward, a link, a deep link), so it is
   * only normalised; otherwise the page's URL is pushed as a new history entry.
   */
  async function show(key, params = {}, { focus = false, fromUrl = false } = {}) {
    const stage = stages.find((s) => s.key === resolveStage(key)) || stages[0]
    params = params || {}
    // The current stage may veto leaving (unsaved changes); it registers the guard through ctx.setLeaveGuard.
    if (leaveGuard && !leaveGuard()) {
      closeNav({ restore: false })
      if (fromUrl && lastHash) history.replaceState(null, '', lastHash) // stay: put the address back
      return
    }
    leaveGuard = null
    viewCtl?.abort()
    viewCtl = new AbortController()
    const signal = viewCtl.signal
    current = stage.key
    store.set(sessionStorage, storeKey, stage.key)
    routeDialog = null
    // The query the page was opened with (OAuth returns carry keys the route table does not know).
    const query = new URLSearchParams(fromUrl ? location.hash.split('?')[1] || '' : '')
    stageHash = routeFor(stage.key, params)
    writeHash(stageHash, { replace: fromUrl })

    const navKey = stage.parent || stage.key
    for (const [k, b] of navButtons) {
      const active = k === navKey
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
      query,
      isMock,
      navigate: (to, p) => show(to, p, { focus: true }),
      openSettings: () => openSettings(),
      setLeaveGuard: (fn) => { if (!signal.aborted) leaveGuard = fn },
      refreshBadges: refreshCounts,
      /** Updates this page's URL (filters, search…) without a new history entry or a re-render. */
      setRoute: (p = {}) => {
        if (signal.aborted) return
        stageHash = routeFor(stage.key, p)
        writeHash(stageHash, { replace: true })
      },
      /**
       * Gives an open dialog its own URL (e.g. #/app/alur-kerja/12): pushed now; closing the dialog
       * goes Back to the page URL, and Back while it is open closes it.
       */
      routeDialog: (dialog, p = {}) => {
        if (signal.aborted || !dialog) return
        const hash = routeFor(stage.key, p)
        if (hash === stageHash) return
        const base = stageHash
        const pushed = location.hash !== hash
        writeHash(hash)
        routeDialog = { dialog }
        dialog.addEventListener('close', () => {
          if (routeDialog?.dialog === dialog) routeDialog = null
          // Deferred: a button that closes the dialog and then opens another page has pushed it by now.
          setTimeout(() => {
            if (signal.aborted || location.hash !== hash) return
            if (pushed) { lastHash = base; history.back() } else writeHash(base, { replace: true })
          }, 0)
        }, { once: true })
      },
    }
    try {
      const done = stage.module.render(view, stageCtx)
      animateView(view)
      await done
    } catch (err) {
      if (signal.aborted) return
      console.error(err)
      view.replaceChildren(el('div', { className: 'note note-danger' }, icon('alert'),
        el('div', { className: 'note-body' }, el('p', {}, t('shell.loadFailed', { label: stage.label, error: err.message })))))
    }
    if (focus && !signal.aborted) {
      const h = staff ? null : view.querySelector('.page-title, h1')
      ;(h || host).focus({ preventScroll: true })
    }
  }

  /** Follows a #/app/… hash change; false asks app.js to render the shell again. */
  function onRoute(hash) {
    if (hash === lastHash) return true
    const r = parseAppRoute(hash) || { bare: true, params: {} }
    if (emailAdmin) {
      const wantOffice = r.office || (r.bare ? store.get(sessionStorage, ADMIN_VIEW_KEY) === 'office' : r.settings ? staff : false)
      if (wantOffice !== staff) { store.set(sessionStorage, ADMIN_VIEW_KEY, wantOffice ? 'office' : 'app'); return false }
    }
    if (r.settings) {
      if (staff) writeHash(stageHash, { replace: true })
      else { lastHash = hash; openSettings({ fromUrl: true }) }
      return true
    }
    if (!drawer.hidden) closeSettings({ fromUrl: true })
    if (hash === stageHash) {
      // Back from a dialog's URL: close the dialog, keep the page.
      lastHash = hash
      const d = routeDialog?.dialog
      routeDialog = null
      if (d?.open) d.close()
      return true
    }
    let key = 'dashboard'
    let params = {}
    if (staff) key = r.office && hasStage(r.stage) ? r.stage : current
    else if (!r.office && !r.bare && hasStage(r.stage)) { key = r.stage; params = r.params || {} }
    show(key, params, { focus: true, fromUrl: true })
    return true
  }
  ctx.setRouteHandler?.(onRoute)

  show(current, initialParams, { fromUrl: true })
  if (route0.settings && !staff) openSettings()
  refreshCounts()
  // A used-up AI quota anywhere opens one upsell dialog (plans / voucher / contact).
  if (!staff) disposers.push(mountUpsell((to, p) => show(to, p, { focus: true })))
  // "Tanya Waguri" floating assistant: reads this account's data and opens stages for it.
  // Loaded after the first stage so it never delays the app; staff (office) sessions get none.
  if (!staff) {
    let unmountWaguri = null
    let gone = false
    import('../waguri/widget.js').then(({ mountWaguri }) => {
      if (gone) return
      unmountWaguri = mountWaguri({ mode: 'app', user, navigate: (to, p) => show(to, p, { focus: true }) })
    }).catch((e) => console.warn('Waguri gagal dimuat:', e?.message))
    disposers.push(() => { gone = true; unmountWaguri?.() })
  }

  return () => {
    viewCtl?.abort()
    disposers.forEach((d) => d())
    document.body.classList.remove('in-app', 'scroll-lock')
    document.title = prevTitle
  }
}

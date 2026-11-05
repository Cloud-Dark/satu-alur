import { getSession, onAuthStateChange, restoreAuth, signOut } from '../auth/auth.js'
import { renderLanding } from '../landing/landing.js'
import { renderLoginPage } from '../auth/login-page.js'
import { renderStaffLogin } from '../auth/staff-login.js'
import { renderShell } from './shell.js'
import { renderDocPage } from '../site/doc-page.js'
import { renderContactPage } from '../contact/page.js'
import { renderConsentPage } from '../ai-access/consent-page.js'
import { isAppHash } from './routes.js'

/**
 * Hash router:
 *   #/        landing page (public)
 *   #/masuk   login page (redirects to #/app when already signed in)
 *   #/app     application shell (requires a session); every page in it has its own
 *             #/app/… route (see ./routes.js), handled by the shell without a re-render
 *   #/izin-ai?req=…  "Izinkan Claude?" consent page of the OAuth login for /mcp (worker/oauth.js);
 *             requires a session: signed out, it goes through #/masuk and comes back
 *   /super-admin-login   staff login, username + password (real path; lands on Kantor Satu Alur)
 *
 * Every page renderer receives (root, ctx) and may return a cleanup function
 * that is called before the next page renders (stop WebGL loops, observers…).
 */

// Satu Alur staff sign in here with username + password (a real path, not linked anywhere);
// only these sessions can open Kantor Satu Alur.
const STAFF_PATH = '/super-admin-login'

const ROUTES = {
  '/': renderLanding,
  '/masuk': renderLoginPage,
  '/app': renderShell,
  '/tentang': (root, ctx) => renderDocPage(root, ctx, 'about'),
  '/privasi': (root, ctx) => renderDocPage(root, ctx, 'privacy'),
  '/syarat': (root, ctx) => renderDocPage(root, ctx, 'terms'),
  '/cookie': (root, ctx) => renderDocPage(root, ctx, 'cookies'),
  '/kontak': renderContactPage,
  '/izin-ai': renderConsentPage,
  [STAFF_PATH]: renderStaffLogin,
}

let currentUser = null
let currentIsAdmin = false
let currentAdminVia = null // 'staff' | 'email' | null
let cleanup = null
let rootEl = null
let waguri = null // { path, unmount } for the public pages' assistant
let waguriSeq = 0
let renderedPath = null // the page rendered last ('/app' while the shell is up)
let appRouteHandler = null // the shell's handler for in-app hash changes
// A signed-out visit to a deep app link (or the Claude consent page) logs in first, then opens that link.
const AFTER_LOGIN_KEY = 'satualur_after_login'
const session = {
  get(k) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

const CONSENT_RE = /^#\/izin-ai\?/
const onStaffPath = () => location.pathname.replace(/\/+$/, '') === STAFF_PATH

export function navigate(path) {
  // Leaving /super-admin-login: drop the path so the hash router takes over again.
  if (onStaffPath()) { history.replaceState(null, '', `/#${path}`); render() }
  else if (location.hash === `#${path}`) render()
  else location.hash = path
}

function currentPath() {
  if (onStaffPath()) return STAFF_PATH
  if (isAppHash(location.hash)) return '/app'
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/'
  return ROUTES[path] ? path : '/'
}

// After signing in: the app link that was opened while signed out, else #/app.
function appTarget() {
  const saved = session.get(AFTER_LOGIN_KEY)
  session.set(AFTER_LOGIN_KEY, null)
  return saved && (isAppHash(saved) || CONSENT_RE.test(saved)) ? saved.replace(/^#/, '') : '/app'
}

// Staff sessions get the office menu in the shell, on the remembered section.
function openOffice() {
  navigate('/app')
}

function render({ force = false } = {}) {
  // The Meta OAuth callback returns to #/social-media?...; #/support?tiket=<id> links a ticket.
  // Open that stage inside the app, keeping the query for the stage to read.
  const back = /^#\/(social-media|support)(\?.*)?$/.exec(location.hash)
  if (back) history.replaceState(null, '', `#/app/${back[1] === 'support' ? 'bantuan' : 'media-sosial'}${back[2] || ''}`)
  let path = currentPath()
  if (path === STAFF_PATH) {
    if (currentIsAdmin) { openOffice(); return }
  } else {
    if (path === '/app' && !currentUser) {
      if (location.hash.replace(/\/$/, '') !== '#/app') session.set(AFTER_LOGIN_KEY, location.hash)
      path = '/masuk'
    }
    if (path === '/izin-ai' && !currentUser) {
      if (CONSENT_RE.test(location.hash)) session.set(AFTER_LOGIN_KEY, location.hash)
      path = '/masuk'
    }
    if (path === '/masuk' && currentUser) path = '/app'
    // Compare paths only, so a query such as #/masuk?demo survives; any #/app/… route is the shell's.
    const hashPath = location.hash.replace(/^#/, '').split('?')[0]
    const sameApp = path === '/app' && isAppHash(location.hash)
    if (!sameApp && (hashPath || '/') !== path && !(path === '/' && !location.hash)) {
      history.replaceState(null, '', `#${path}`)
    }
  }

  // Moving between pages of the signed-in app: the shell switches the page itself (no re-render),
  // unless it asks for one (e.g. an email admin switching between the app and the office).
  if (!force && path === '/app' && renderedPath === '/app' && appRouteHandler) {
    if (appRouteHandler(location.hash) !== false) return
  }
  appRouteHandler = null

  if (typeof cleanup === 'function') {
    try { cleanup() } catch (e) { console.warn('Cleanup error:', e) }
  }
  cleanup = null
  rootEl.replaceChildren()
  document.body.dataset.page = path === '/' ? 'landing' : path.slice(1)
  window.scrollTo(0, 0)

  renderedPath = path
  const ctx = {
    user: currentUser,
    isAdmin: currentIsAdmin,
    adminVia: currentAdminVia,
    navigate,
    // The shell registers how it follows #/app/… hash changes (Back/Forward, links, deep links).
    setRouteHandler(fn) { appRouteHandler = fn },
    async onSignedIn(user) {
      currentUser = user
      await loadAdmin()
      if (path === STAFF_PATH && currentIsAdmin) { session.set(AFTER_LOGIN_KEY, null); openOffice() }
      else navigate(appTarget())
    },
    async signOut() {
      await signOut()
      currentUser = null
      currentIsAdmin = false
      currentAdminVia = null
      navigate('/')
    },
  }
  cleanup = ROUTES[path](rootEl, ctx) || null
  mountPublicWaguri(path)
  if (cleanup && typeof cleanup.then === 'function') {
    cleanup.then((fn) => { cleanup = fn || null })
  }
}

// "Tanya Waguri" on every public page (landing, masuk, tentang, kontak, …): public knowledge
// only, never account data. The signed-in shell mounts its own (src/ui/shell.js); the staff
// login page gets none. Loaded lazily so it never delays the first paint.
function mountPublicWaguri(path) {
  const wanted = path !== '/app' && path !== STAFF_PATH && path !== '/izin-ai'
  if (wanted && waguri) return // stays open across public pages
  waguri?.unmount?.()
  waguri = null
  if (!wanted) return
  const mine = ++waguriSeq
  waguri = { unmount: null }
  import('../waguri/widget.js').then(({ mountWaguri }) => {
    if (mine !== waguriSeq || !waguri) return
    waguri.unmount = mountWaguri({ mode: 'public', navigate })
  }).catch((e) => console.warn('Waguri gagal dimuat:', e?.message))
}

// UX only: the worker enforces admin rights on every /api/office/admin call.
async function loadAdmin() {
  try {
    const data = (await getSession()).data
    currentIsAdmin = data?.is_admin === true
    currentAdminVia = currentIsAdmin ? data?.admin_via || 'staff' : null
  } catch { currentIsAdmin = false; currentAdminVia = null }
}

export async function mountApp(root) {
  rootEl = root

  try {
    const oauthResult = await restoreAuth()
    if (oauthResult?.type === 'oauth') currentUser = oauthResult.session.user
  } catch (e) {
    console.warn('OAuth restore error:', e.message)
  }

  try {
    const { data: session } = await getSession()
    currentUser = session?.user ?? null
    currentIsAdmin = session?.is_admin === true
    currentAdminVia = currentIsAdmin ? session?.admin_via || 'staff' : null
  } catch {
    currentUser = null
  }

  window.addEventListener('hashchange', () => render())
  render()

  try {
    onAuthStateChange(async (_event, session) => {
      const next = session?.user ?? null
      const changed = (next?.id ?? null) !== (currentUser?.id ?? null)
      currentUser = next
      if (next) await loadAdmin()
      else { currentIsAdmin = false; currentAdminVia = null }
      // The login page shows its own success state and navigates via ctx.onSignedIn.
      if (changed && !(next && (currentPath() === '/masuk' || currentPath() === STAFF_PATH))) render({ force: true })
    })
  } catch (e) {
    console.warn('Auth state observer error:', e.message)
  }
}

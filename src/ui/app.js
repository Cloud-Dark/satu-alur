import { getSession, onAuthStateChange, restoreAuth, signOut } from '../auth/auth.js'
import { renderLanding } from '../landing/landing.js'
import { renderLoginPage } from '../auth/login-page.js'
import { renderStaffLogin } from '../auth/staff-login.js'
import { renderShell } from './shell.js'
import { renderDocPage } from '../site/doc-page.js'
import { renderContactPage } from '../contact/page.js'

/**
 * Hash router:
 *   #/        landing page (public)
 *   #/masuk   login page (redirects to #/app when already signed in)
 *   #/app     application shell (requires a session)
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
  [STAFF_PATH]: renderStaffLogin,
}

let currentUser = null
let currentIsAdmin = false
let currentAdminVia = null // 'staff' | 'email' | null
let cleanup = null
let rootEl = null

const onStaffPath = () => location.pathname.replace(/\/+$/, '') === STAFF_PATH

export function navigate(path) {
  // Leaving /super-admin-login: drop the path so the hash router takes over again.
  if (onStaffPath()) { history.replaceState(null, '', `/#${path}`); render() }
  else if (location.hash === `#${path}`) render()
  else location.hash = path
}

function currentPath() {
  if (onStaffPath()) return STAFF_PATH
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/'
  return ROUTES[path] ? path : '/'
}

// Staff sessions get the office menu in the shell, on the remembered section.
function openOffice() {
  navigate('/app')
}

function render() {
  // The Meta OAuth callback returns to #/social-media?...; #/support?tiket=<id> links a ticket.
  // Open that stage inside the app, keeping the query for the stage to read.
  const back = /^#\/(social-media|support)(\?.*)?$/.exec(location.hash)
  if (back) {
    try { sessionStorage.setItem('satualur_stage', back[1]) } catch { /* storage unavailable */ }
    history.replaceState(null, '', `#/app${back[2] || ''}`)
  }
  let path = currentPath()
  if (path === STAFF_PATH) {
    if (currentIsAdmin) { openOffice(); return }
  } else {
    if (path === '/app' && !currentUser) path = '/masuk'
    if (path === '/masuk' && currentUser) path = '/app'
    // Compare paths only, so a query such as #/masuk?demo survives.
    const hashPath = location.hash.replace(/^#/, '').split('?')[0]
    if ((hashPath || '/') !== path && !(path === '/' && !location.hash)) {
      history.replaceState(null, '', `#${path}`)
    }
  }

  if (typeof cleanup === 'function') {
    try { cleanup() } catch (e) { console.warn('Cleanup error:', e) }
  }
  cleanup = null
  rootEl.replaceChildren()
  document.body.dataset.page = path === '/' ? 'landing' : path.slice(1)
  window.scrollTo(0, 0)

  const ctx = {
    user: currentUser,
    isAdmin: currentIsAdmin,
    adminVia: currentAdminVia,
    navigate,
    async onSignedIn(user) {
      currentUser = user
      await loadAdmin()
      if (path === STAFF_PATH && currentIsAdmin) openOffice()
      else navigate('/app')
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
  if (cleanup && typeof cleanup.then === 'function') {
    cleanup.then((fn) => { cleanup = fn || null })
  }
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

  window.addEventListener('hashchange', render)
  render()

  try {
    onAuthStateChange(async (_event, session) => {
      const next = session?.user ?? null
      const changed = (next?.id ?? null) !== (currentUser?.id ?? null)
      currentUser = next
      if (next) await loadAdmin()
      else { currentIsAdmin = false; currentAdminVia = null }
      // The login page shows its own success state and navigates via ctx.onSignedIn.
      if (changed && !(next && (currentPath() === '/masuk' || currentPath() === STAFF_PATH))) render()
    })
  } catch (e) {
    console.warn('Auth state observer error:', e.message)
  }
}

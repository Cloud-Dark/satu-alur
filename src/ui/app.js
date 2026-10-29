import { getSession, onAuthStateChange, restoreAuth, signOut } from '../auth/auth.js'
import { renderLanding } from '../landing/landing.js'
import { renderLoginPage } from '../auth/login-page.js'
import { renderStaffLogin } from '../auth/staff-login.js'
import { renderShell } from './shell.js'
import { renderDocPage } from '../site/doc-page.js'

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
  [STAFF_PATH]: renderStaffLogin,
}

let currentUser = null
let currentIsAdmin = false
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

function openOffice() {
  try { sessionStorage.setItem('satualur_stage', 'office') } catch { /* storage unavailable */ }
  navigate('/app')
}

function render() {
  // The Meta OAuth callback returns to #/social-media?...: open that stage inside the app, keeping the query.
  const back = /^#\/social-media(\?.*)?$/.exec(location.hash)
  if (back) {
    try { sessionStorage.setItem('satualur_stage', 'social-media') } catch { /* storage unavailable */ }
    history.replaceState(null, '', `#/app${back[1] || ''}`)
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
  try { currentIsAdmin = (await getSession()).data?.is_admin === true } catch { currentIsAdmin = false }
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
      else currentIsAdmin = false
      // The login page shows its own success state and navigates via ctx.onSignedIn.
      if (changed && !(next && (currentPath() === '/masuk' || currentPath() === STAFF_PATH))) render()
    })
  } catch (e) {
    console.warn('Auth state observer error:', e.message)
  }
}

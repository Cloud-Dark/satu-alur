import { getSession, onAuthStateChange, restoreAuth, signOut } from '../auth/auth.js'
import { renderLanding } from '../landing/landing.js'
import { renderLoginPage } from '../auth/login-page.js'
import { renderShell } from './shell.js'

/**
 * Hash router:
 *   #/        landing page (public)
 *   #/masuk   login page (redirects to #/app when already signed in)
 *   #/app     application shell (requires a session)
 *
 * Every page renderer receives (root, ctx) and may return a cleanup function
 * that is called before the next page renders (stop WebGL loops, observers…).
 */

const ROUTES = {
  '/': renderLanding,
  '/masuk': renderLoginPage,
  '/app': renderShell,
}

let currentUser = null
let cleanup = null
let rootEl = null

export function navigate(path) {
  if (location.hash === `#${path}`) render()
  else location.hash = path
}

function currentPath() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/'
  return ROUTES[path] ? path : '/'
}

function render() {
  let path = currentPath()
  if (path === '/app' && !currentUser) path = '/masuk'
  if (path === '/masuk' && currentUser) path = '/app'
  if (location.hash.replace(/^#/, '') !== path && !(path === '/' && !location.hash)) {
    history.replaceState(null, '', `#${path}`)
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
    navigate,
    onSignedIn(user) {
      currentUser = user
      navigate('/app')
    },
    async signOut() {
      await signOut()
      currentUser = null
      navigate('/')
    },
  }
  cleanup = ROUTES[path](rootEl, ctx) || null
  if (cleanup && typeof cleanup.then === 'function') {
    cleanup.then((fn) => { cleanup = fn || null })
  }
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
  } catch {
    currentUser = null
  }

  window.addEventListener('hashchange', render)
  render()

  try {
    onAuthStateChange((_event, session) => {
      const next = session?.user ?? null
      const changed = (next?.id ?? null) !== (currentUser?.id ?? null)
      currentUser = next
      // The login page shows its own success state and navigates via ctx.onSignedIn.
      if (changed && !(next && currentPath() === '/masuk')) render()
    })
  } catch (e) {
    console.warn('Auth state observer error:', e.message)
  }
}

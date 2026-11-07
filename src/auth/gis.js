/**
 * Google Identity Services (GIS) for the login page: the official "Sign in with Google" button
 * and One Tap, both on FedCM where the browser supports it. Loaded lazily, only on the login page
 * and only when the server says Google sign-in is configured. If the script can't load (blocked,
 * offline, unsupported browser) the caller keeps its redirect button as the fallback.
 *
 * In mock mode (providers().gis_mock) a local stand-in renders a lookalike button and hands back
 * a fake credential, so dev and e2e never touch Google.
 */
import { GIS_SCRIPT_URL } from './google.js'
import { t, getLang } from '../i18n/index.js'

const LOAD_TIMEOUT_MS = 8000
const DISMISS_KEY = 'satualur_gis_dismissed'
let loading = null

/** Loads https://accounts.google.com/gsi/client once; resolves google.accounts.id or rejects. */
export function loadGis({ timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.defer = true
    const timer = setTimeout(() => fail(new Error('GIS timeout')), timeoutMs)
    function fail(err) {
      clearTimeout(timer)
      script.remove()
      loading = null
      reject(err)
    }
    script.onload = () => {
      clearTimeout(timer)
      if (window.google?.accounts?.id) resolve(window.google.accounts.id)
      else fail(new Error('GIS unavailable'))
    }
    script.onerror = () => fail(new Error('GIS blocked'))
    document.head.appendChild(script)
  })
  return loading
}

/** Stand-in for google.accounts.id used in mock mode (no network). */
export function mockGis() {
  let config = null
  const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))))
  return {
    initialize(c) { config = c },
    renderButton(el, opts = {}) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'gis-mock-btn'
      btn.dataset.theme = opts.theme || 'outline'
      btn.textContent = t('auth.google.mockButton')
      btn.addEventListener('click', () => {
        const payload = { email: 'pengguna.google@contoh.satualur.id', name: 'Pengguna Google', email_verified: true, nonce: config?.nonce }
        config?.callback?.({ credential: `mockgis.${b64(payload)}`, select_by: 'btn' })
      })
      el.replaceChildren(btn)
    },
    prompt() {},
    cancel() {},
    disableAutoSelect() {},
  }
}

const promptDismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false } }
const rememberDismissed = () => { try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* storage off */ } }

/** 'filled_black' on the dark theme, 'outline' otherwise (GIS has no automatic theme). */
export function gisTheme() {
  const t = document.documentElement.dataset.theme
  const dark = t ? t === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return dark ? 'filled_black' : 'outline'
}

/**
 * Renders the GIS button into `container` and shows One Tap once per browser session.
 *   getNonce()          → Promise<string> single-use nonce from the server (fresh per attempt)
 *   onCredential(c, n)  → called with the ID token and the nonce it was issued for
 * Returns { cancel(), retry() }: cancel on page leave; retry re-initialises with a new nonce
 * after a failed attempt (the old nonce is spent).
 */
export async function mountGoogleIdentity({ container, clientId, mock = false, getNonce, onCredential, onDismiss }) {
  const id = mock ? mockGis() : await loadGis()
  let alive = true

  async function init({ prompt }) {
    const nonce = await getNonce()
    if (!alive) return
    id.initialize({
      client_id: clientId,
      nonce,
      callback: (res) => { if (alive && res?.credential) onCredential(res.credential, nonce) },
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
      itp_support: true,
      use_fedcm_for_prompt: true,
      use_fedcm_for_button: true,
    })
    const box = container.clientWidth || container.parentElement?.clientWidth || 320
    // A little under the box: the personalised button adds its own margin around the pill.
    const width = Math.round(Math.min(400, Math.max(220, box - 12)))
    id.renderButton(container, {
      type: 'standard', theme: gisTheme(), size: 'large', text: 'continue_with',
      shape: 'pill', logo_alignment: 'left', locale: getLang(), width,
    })
    if (prompt && !promptDismissed()) {
      // With FedCM most moment notifications are gone; skipped/dismissed still arrive.
      id.prompt((n) => {
        if (n?.isSkippedMoment?.() || n?.isDismissedMoment?.()) { rememberDismissed(); onDismiss?.() }
      })
    }
  }

  await init({ prompt: true })
  return {
    cancel() { alive = false; try { id.cancel() } catch { /* already gone */ } },
    retry() { return alive ? init({ prompt: false }) : Promise.resolve() },
  }
}

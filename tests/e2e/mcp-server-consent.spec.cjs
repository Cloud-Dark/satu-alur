// E2E: Akses AI by login, consent page #/izin-ai (worker/oauth.js redirects here from /oauth/authorize).
// Signed out -> #/masuk (with a hint) -> back to the consent card; Izinkan -> the client's redirect_uri
// with code + state; Tolak -> error=access_denied + state; an unknown request shows an error.
// Mock mode: src/mock/mock-cloud.js `aiOAuth.startRequest` stands in for /oauth/authorize, and the
// redirect target (claude.ai) is intercepted so nothing leaves the test.
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

async function startRequest(p, state) {
  return p.evaluate(async ({ cb, st }) => {
    const { getCloud } = await import('/src/cloud.js')
    return getCloud().aiOAuth.startRequest({ client_name: 'Claude', redirect_uri: cb, state: st })
  }, { cb: CALLBACK, st: state })
}

/** Signs in on the login page the router opened (mock email + OTP), without leaving the page. */
async function signInHere(p, email = 'qa@satualur.id') {
  await p.waitForSelector('#auth-email')
  await p.fill('#auth-email', email)
  await p.click('.auth-form-email button[type=submit]')
  await p.waitForSelector('.auth-demo:not([hidden])', { timeout: 10000 })
  await p.click('.auth-demo-fill')
}

module.exports = async function mcpServerConsent(t) {
  const p = await t.page()
  await p.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>callback</title><p>ok</p>' }))

  // Signed out: the consent link goes through the login page and comes back
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  const req = await startRequest(p, 'st-allow')
  await p.evaluate((r) => { location.hash = `#/izin-ai?req=${r}` }, req)
  await p.waitForFunction(() => location.hash.startsWith('#/masuk'), null, { timeout: 8000 })
  t.check(true, 'signed out: #/izin-ai opens the login page')
  await p.waitForSelector('.auth-message:not([hidden]), [data-tone]', { timeout: 5000 }).catch(() => {})
  t.check((await p.textContent('body')).includes('Masuk ke Satu Alur untuk menghubungkan Claude'), 'login page says why (connect Claude)')
  await signInHere(p)
  await p.waitForFunction((r) => location.hash === `#/izin-ai?req=${r}`, req, { timeout: 10000 })
  t.check(true, 'after login: back on the consent page with the same request')
  await p.waitForSelector('.consent-card[aria-busy="false"] [data-consent="allow"]', { timeout: 8000 })
  const title = (await p.textContent('.consent-title')).trim()
  t.check(title === 'Izinkan Claude mengakses data usaha Anda (hanya baca)?', 'consent question', title)
  t.check(await p.locator('.consent-tools li').count() === 6, 'lists the six read-only tools')
  t.check((await p.textContent('.consent-account')).includes('qa@satualur.id'), 'shows the signed-in account')
  t.check((await p.textContent('.consent-host')).trim() === 'claude.ai', 'shows where the answer goes')
  t.check(await p.getByRole('button', { name: 'Tolak' }).count() === 1, 'has a Tolak button')
  t.check(!(await p.locator('[data-consent="allow"]').isDisabled()), 'Izinkan enabled for a business account')
  await t.shot(p, 'consent')

  // Phone width: no horizontal scroll
  await p.setViewportSize({ width: 390, height: 844 })
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  t.check(overflow <= 1, 'consent page: no horizontal scroll on a phone', overflow)
  await p.setViewportSize({ width: 1440, height: 900 })

  // Izinkan -> back to Claude with a code and the same state
  await p.click('[data-consent="allow"]')
  await p.waitForURL((u) => u.href.startsWith(CALLBACK), { timeout: 8000 })
  const ok = new URL(p.url())
  t.check(Boolean(ok.searchParams.get('code')), 'Izinkan: redirect_uri gets a code', p.url())
  t.check(ok.searchParams.get('state') === 'st-allow', 'Izinkan: state echoed back')
  t.check(!ok.searchParams.get('error'), 'Izinkan: no error')

  // Signed out again (new page load), Tolak -> access_denied
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  const req2 = await startRequest(p, 'st-deny')
  await p.evaluate((r) => { location.hash = `#/izin-ai?req=${r}` }, req2)
  await p.waitForFunction(() => location.hash.startsWith('#/masuk'), null, { timeout: 8000 })
  await signInHere(p)
  await p.waitForSelector('.consent-card[aria-busy="false"] [data-consent="deny"]', { timeout: 10000 })
  await p.click('[data-consent="deny"]')
  await p.waitForURL((u) => u.href.startsWith(CALLBACK), { timeout: 8000 })
  const no = new URL(p.url())
  t.check(no.searchParams.get('error') === 'access_denied', 'Tolak: error=access_denied', p.url())
  t.check(no.searchParams.get('state') === 'st-deny', 'Tolak: state echoed back')
  t.check(!no.searchParams.get('code'), 'Tolak: no code')

  // An answered (or unknown) request cannot be reused
  await p.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await signInHere(p)
  await p.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 10000 })
  await p.evaluate((r) => { location.hash = `#/izin-ai?req=${r}` }, req2)
  await p.waitForSelector('.consent-card[aria-busy="false"]', { timeout: 8000 })
  t.check((await p.textContent('.consent-card')).includes('Permintaan izin tidak bisa dibuka'), 'answered request shows an error, no buttons')
  t.check(await p.locator('[data-consent]').count() === 0, 'no Izinkan/Tolak for an answered request')
  await t.noErrors(p)
}

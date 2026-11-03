// E2E: Google Identity Services on the login page (mock mode).
// satualur_mock_google=1 → simulated GIS button signs in; ='script' with the GIS script blocked
// → the redirect "Masuk dengan Google" button stays as the fallback.
module.exports = async function gis(t) {
  const p = await t.page()
  await p.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await p.evaluate(() => localStorage.setItem('satualur_mock_google', '1'))
  await p.reload({ waitUntil: 'load' })
  await p.waitForSelector('#auth-email')
  await p.waitForSelector('.auth-gis .gis-mock-btn', { timeout: 8000 })
  t.check(await p.locator('.auth-google-box').isVisible(), 'GIS: Google area visible when configured')
  t.check(await p.locator('.auth-google').isHidden(), 'GIS: redirect button hidden once the GIS button renders')
  t.check(await p.locator('.auth-gis').getAttribute('aria-label') === 'Masuk dengan Google', 'GIS: button group is labelled')
  await p.click('.auth-gis .gis-mock-btn')
  await p.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 10000 })
  await p.waitForSelector('.app-shell', { timeout: 10000 })
  const who = await p.evaluate(() => document.querySelector('.app-shell')?.textContent || '')
  t.check(/pengguna\.google@contoh\.satualur\.id|Pengguna Google/.test(who), 'GIS: simulated Google sign-in lands in the app as that user')
  await t.noErrors(p)
  await p.close()

  // Fallback: real GIS script requested but blocked → the redirect button stays.
  const f = await t.page()
  let requested = false
  await f.route('https://accounts.google.com/gsi/client**', (route) => { requested = true; return route.abort() })
  await f.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await f.evaluate(() => localStorage.setItem('satualur_mock_google', 'script'))
  await f.reload({ waitUntil: 'load' })
  await f.waitForSelector('#auth-email')
  await f.waitForFunction(() => !document.querySelector('.auth-gis'), null, { timeout: 12000 })
  t.check(requested, 'GIS fallback: the GIS script was requested')
  t.check(await f.locator('.auth-google').isVisible(), 'GIS fallback: "Masuk dengan Google" redirect button shown when the script is blocked')
  t.check(await f.locator('.auth-google').getAttribute('href') === '/api/auth/google/start', 'GIS fallback: button points to the redirect flow')
  await f.close()
}

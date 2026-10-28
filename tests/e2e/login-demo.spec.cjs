// E2E: login "Akun demo" mode — mode switch (click + arrow keys), scale/account
// comboboxes (search + keyboard), preview card, deep link #/masuk?demo, enter app. TC-DEM-*.
const { waitDashboard, norm } = require('./lib.cjs')

module.exports = async function loginDemo(t) {
  const p = await t.page()
  await p.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await p.waitForSelector('#auth-mode-demo')

  // mode switch by click and by keyboard
  await p.click('#auth-mode-demo')
  await p.waitForTimeout(300)
  t.check(await p.getAttribute('#auth-mode-demo', 'aria-selected') === 'true', 'click "Akun demo" selects demo tab')
  t.check(await p.isVisible('#auth-demo-form') && !(await p.isVisible('#auth-live')), 'demo form shown, live panel hidden')
  await p.focus('#auth-mode-demo')
  await p.keyboard.press('ArrowLeft')
  await p.waitForTimeout(200)
  t.check(await p.getAttribute('#auth-mode-live', 'aria-selected') === 'true', 'ArrowLeft switches back to Live')
  await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(200)
  t.check(await p.getAttribute('#auth-mode-demo', 'aria-selected') === 'true', 'ArrowRight switches to demo')
  t.check(/dipakai bersama/.test(await p.textContent('.auth-demo-shared')), 'shared-account warning visible')

  // scale combobox: 3 scales
  const scaleTrigger = p.locator('.auth-form-demo .combo-trigger').nth(0)
  const acctTrigger = p.locator('.auth-form-demo .combo-trigger').nth(1)
  await scaleTrigger.click()
  await p.waitForSelector('.combo-pop:not([hidden]) .combo-option')
  const scales = await p.$$eval('.combo-pop:not([hidden]) .combo-option', (els) => els.map((e) => e.textContent.trim()))
  t.check(scales.join('|') === 'Sole Trader|UKM|Enterprise', 'scale options: Sole Trader, UKM, Enterprise', scales.join('|'))
  await p.keyboard.type('enter')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(250)
  t.check(await p.$eval('#auth-demo-scale', (s) => s.value) === 'enterprise', 'typing "enter" + Enter picks Enterprise')
  t.check(norm(await scaleTrigger.textContent()) === 'Enterprise', 'scale trigger shows Enterprise')

  // account combobox follows the scale
  await acctTrigger.click()
  await p.waitForSelector('.combo-pop:not([hidden]) .combo-option')
  const accts = await p.$$eval('.combo-pop:not([hidden]) .combo-option', (els) => els.map((e) => e.textContent.trim()))
  t.check(accts.length === 3 && accts.some((a) => /Arunika/.test(a)) && accts.some((a) => /Prima Layanan/.test(a)) && accts.some((a) => /Sehat Bersih/.test(a)), 'enterprise scale lists the 3 enterprise accounts', accts.join(' | '))
  await p.keyboard.type('fasilitas')
  await p.waitForTimeout(150)
  const filtered = await p.$$eval('.combo-pop:not([hidden]) .combo-option', (els) => els.map((e) => e.textContent.trim()))
  t.check(filtered.length === 1 && /Prima Layanan Fasilitas/.test(filtered[0]), 'search "fasilitas" filters to PT Prima Layanan Fasilitas', filtered.join(' | '))
  t.check(await p.locator('.combo-pop:not([hidden]) mark').count() >= 1, 'search match highlighted')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(250)
  t.check(await p.$eval('#auth-demo-account', (s) => s.value) === 'demo-fm@satualur.id', 'account select value = demo-fm@satualur.id')
  const preview = norm(await p.textContent('.auth-demo-preview'))
  t.check(/PT Prima Layanan Fasilitas/.test(preview) && /9 wilayah/.test(preview) && /5–10%/.test(preview), 'preview shows name, city and 5–10% target', preview)

  // switch to Sole Trader resets account list
  await scaleTrigger.click()
  await p.keyboard.type('sole')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(250)
  const soleAcct = await p.$eval('#auth-demo-account', (s) => s.value)
  t.check(['demo-ac@satualur.id', 'demo-cleaning@satualur.id', 'demo-listrik@satualur.id'].includes(soleAcct), 'changing scale re-populates accounts (sole)', soleAcct)
  t.check(/1–2%/.test(await p.textContent('.auth-demo-preview')), 'sole preview shows 1–2% target')

  // enter the app
  await p.click('.auth-form-demo button[type=submit]')
  await p.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 15000 })
  await waitDashboard(p)
  t.check(norm(await p.textContent('.side-user-email')) === soleAcct, 'signed in as the chosen demo account', await p.textContent('.side-user-email'))
  await t.noErrors(p)

  // deep link opens demo mode directly
  const d = await t.page({ width: 390, height: 844 })
  await d.goto(`${t.base}/#/masuk?demo`, { waitUntil: 'load' })
  await d.waitForSelector('#auth-mode-demo')
  await d.waitForTimeout(400)
  // BUG-01: ui/app.js render() normalises the hash to "#/masuk" (history.replaceState) before the
  // login page reads "?demo" from location.hash, so the deep link opens Live mode.
  t.bug(await d.getAttribute('#auth-mode-demo', 'aria-selected') === 'true', '#/masuk?demo opens demo mode', 'BUG-01', `hash now ${await d.evaluate(() => location.hash)}`)
  t.check(await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile login: no horizontal scroll')
  await t.noErrors(d)
}

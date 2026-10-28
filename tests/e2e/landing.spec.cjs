// E2E: landing page (#/) — sections, in-page anchors keep the router hash, FAQ,
// theme toggle (persisted), mobile menu, CTA to login. Manual cases: TC-LND-*.
module.exports = async function landing(t) {
  /* ---------------- desktop ---------------- */
  const p = await t.page({ width: 1440, height: 900 })
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.waitForSelector('.lp-hero')
  t.check(await p.evaluate(() => document.body.dataset.page) === 'landing', 'body[data-page=landing]')
  for (const id of ['alur', 'fitur-ai', 'ide-besar', 'harga', 'faq']) {
    t.check(await p.locator(`#${id}`).count() === 1, `section #${id} present`)
  }
  t.check(await p.locator('.lp-cta-wrap').count() === 1, 'closing CTA section present')
  const pricing = await p.textContent('#harga')
  t.check(/Sole Trader/.test(pricing) && /UKM/.test(pricing) && /Enterprise/.test(pricing), 'pricing shows Sole Trader, UKM, Enterprise')

  // anchor scroll keeps the hash router route
  await p.click('.lp-nav a[data-scroll="harga"]')
  await p.waitForTimeout(1500)
  const afterAnchor = await p.evaluate(() => ({ hash: location.hash, y: scrollY, top: Math.round(document.getElementById('harga').getBoundingClientRect().top) }))
  t.check(afterAnchor.hash === '#/' || afterAnchor.hash === '', 'anchor click keeps hash on the landing route', afterAnchor.hash)
  t.check(afterAnchor.y > 500 && Math.abs(afterAnchor.top) < 160, 'anchor click scrolls #harga to the top', JSON.stringify(afterAnchor))
  t.check(await p.locator('.lp-nav a[data-nav="harga"].is-active').count() === 1, 'active nav link follows the section')

  // FAQ accordion
  await p.click('.lp-nav a[data-scroll="faq"]')
  await p.waitForTimeout(1200)
  const q0 = p.locator('#faq-q-0')
  const before = await q0.getAttribute('aria-expanded')
  await q0.click()
  await p.waitForTimeout(300)
  t.check(before === 'false' && (await q0.getAttribute('aria-expanded')) === 'true', 'FAQ item expands (aria-expanded)')
  t.check(await p.evaluate(() => document.getElementById('faq-a-0').inert === false), 'expanded FAQ answer is not inert')
  await q0.click()
  t.check((await q0.getAttribute('aria-expanded')) === 'false', 'FAQ item collapses again')

  // back to top
  t.check(await p.evaluate(() => document.querySelector('[data-totop]').classList.contains('is-visible')), 'back-to-top visible after scrolling')
  await p.click('[data-totop]')
  await p.waitForTimeout(1500)
  t.check(await p.evaluate(() => scrollY) < 50, 'back-to-top returns to the top')

  // theme toggle + persistence
  const theme0 = await p.evaluate(() => document.documentElement.dataset.theme || 'light')
  await p.click('.lp-header .theme-toggle')
  await p.waitForTimeout(300)
  const theme1 = await p.evaluate(() => document.documentElement.dataset.theme)
  t.check(theme0 === 'light' && theme1 === 'dark', 'theme toggle switches light -> dark', `${theme0} -> ${theme1}`)
  t.check(await p.evaluate(() => localStorage.getItem('theme')) === 'dark', 'theme stored in localStorage')
  t.check(/terang/i.test(await p.getAttribute('.lp-header .theme-toggle', 'aria-label')), 'toggle label offers the other theme')
  await p.reload({ waitUntil: 'load' })
  t.check(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme survives reload')
  await p.click('.lp-header .theme-toggle')

  // CTA -> login
  await p.click('.lp-header a[href="#/masuk"] >> nth=0')
  await p.waitForSelector('#auth-email', { timeout: 8000 })
  t.check(await p.evaluate(() => location.hash) === '#/masuk', '"Masuk" goes to #/masuk')
  await p.click('.auth-back')
  await p.waitForSelector('.lp-hero')
  t.check(await p.evaluate(() => document.querySelectorAll('.lp-hero').length) === 1, 'back to landing renders once (cleanup ok)')
  await t.noErrors(p)

  /* ---------------- mobile ---------------- */
  const m = await t.page({ width: 375, height: 812 })
  await m.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await m.waitForSelector('.lp-hero')
  t.check(await m.isVisible('[data-menu-open]'), 'mobile: burger button visible')
  t.check(!(await m.isVisible('.lp-nav')), 'mobile: desktop nav hidden')
  t.check(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile: no horizontal scroll')
  await m.click('[data-menu-open]')
  await m.waitForTimeout(400)
  t.check(!(await m.evaluate(() => document.querySelector('[data-menu]').hidden)), 'mobile: menu opens')
  t.check(await m.getAttribute('[data-menu-open]', 'aria-expanded') === 'true', 'mobile: burger aria-expanded=true')
  t.check(await m.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Tutup menu', 'mobile: focus moves to close button')
  await m.keyboard.press('Escape')
  await m.waitForTimeout(500)
  t.check(await m.evaluate(() => document.querySelector('[data-menu]').hidden), 'mobile: Escape closes menu')
  await m.click('[data-menu-open]')
  await m.waitForTimeout(400)
  await m.click('.lp-menu-nav a[data-scroll="harga"]')
  await m.waitForTimeout(1500)
  const mm = await m.evaluate(() => ({ hidden: document.querySelector('[data-menu]').hidden, hash: location.hash, y: scrollY, lock: document.documentElement.classList.contains('lp-lock') }))
  t.check(mm.hidden && !mm.lock, 'mobile: menu link closes menu and unlocks scroll', JSON.stringify(mm))
  t.check(mm.y > 500 && (mm.hash === '#/' || mm.hash === ''), 'mobile: menu link scrolls and keeps hash', JSON.stringify(mm))
  await t.noErrors(m)
}

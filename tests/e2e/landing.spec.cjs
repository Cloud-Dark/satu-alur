// E2E: landing page (#/) — sections, in-page anchors keep the router hash, FAQ,
// theme toggle (persisted), mobile menu, CTA to login. Manual cases: TC-LND-*.
module.exports = async function landing(t) {
  /* ---------------- desktop ---------------- */
  const p = await t.page({ width: 1440, height: 900 })
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.waitForSelector('.lp-hero')
  t.check(await p.evaluate(() => document.body.dataset.page) === 'landing', 'body[data-page=landing]')
  t.check(/layanan tambahan/.test(await p.locator('.lp-hero-sub').textContent()), 'hero: updated default copy is rendered')
  for (const id of ['alur', 'pendapatan', 'pertumbuhan', 'fitur-ai', 'ide-besar', 'harga', 'faq']) {
    t.check(await p.locator(`#${id}`).count() === 1, `section #${id} present`)
  }
  t.check(await p.locator('.lp-cta-wrap').count() === 1, 'closing CTA section present')

  /* ---------------- Pendapatan: the two money engines ---------------- */
  t.check(await p.locator('.lp-nav a[data-nav="pendapatan"]').count() === 1, 'nav: Pendapatan link')
  t.check(await p.locator('.lp-nav a[data-nav="pertumbuhan"]').count() === 1, 'nav: Pertumbuhan link')
  t.check(await p.locator('#pendapatan .lp-inc-engine').count() === 2, 'pendapatan: two engine cards')
  const incText = await p.textContent('#pendapatan')
  t.check(/Layanan tambahan/.test(incText) && /Tanpa limbah/.test(incText), 'pendapatan: both menus named')
  t.check(await p.locator('#pendapatan .lp-vas-rows li').count() === 3, 'pendapatan: add-on preview rows')
  t.check(await p.locator('#pendapatan .lp-zw-ring').count() === 1, 'pendapatan: waste-free ring')
  t.check(await p.locator('#pendapatan .lp-inc-teams li').count() === 5, 'pendapatan: five AI teams')
  t.check(/Pimpinan optimasi/.test(incText), 'pendapatan: lead synthesis named')

  /* ---------------- Pertumbuhan: the growth menus ---------------- */
  t.check(await p.locator('#pertumbuhan .lp-grow-card').count() === 4, 'pertumbuhan: four menu cards')
  t.check(await p.locator('#pertumbuhan .lp-grow-assist').count() === 2, 'pertumbuhan: two assistant cards')
  const growText = await p.textContent('#pertumbuhan')
  for (const label of ['Radar peluang', 'Pencari prospek', 'Media Sosial', 'Penasihat AI', 'AI Superpowers']) {
    t.check(growText.includes(label), `pertumbuhan: ${label} described`)
  }
  t.check(await p.locator('#pertumbuhan .lp-grow-leads li').count() === 2, 'pertumbuhan: lead preview rows')
  t.check(await p.locator('#pertumbuhan .tag').count() === 4, 'pertumbuhan: all illustrative numbers and sample answers are labelled')
  t.check(/data demonstrasi/.test(growText), 'pertumbuhan: predictions are identified as demo data')

  const pricing = await p.textContent('#harga')
  t.check(/Sole Trader/.test(pricing) && /UKM/.test(pricing) && /Enterprise/.test(pricing), 'pricing shows Sole Trader, UKM, Enterprise')

  // anchor scroll keeps the hash router route
  await p.click('.lp-nav a[data-scroll="harga"]')
  await p.waitForTimeout(1500)
  const afterAnchor = await p.evaluate(() => ({ hash: location.hash, y: scrollY, top: Math.round(document.getElementById('harga').getBoundingClientRect().top) }))
  t.check(afterAnchor.hash === '#/' || afterAnchor.hash === '', 'anchor click keeps hash on the landing route', afterAnchor.hash)
  t.check(afterAnchor.y > 500 && Math.abs(afterAnchor.top) < 160, 'anchor click scrolls #harga to the top', JSON.stringify(afterAnchor))
  t.check(await p.locator('.lp-nav a[data-nav="harga"].is-active').count() === 1, 'active nav link follows the section')

  // the new sections are reachable from the nav and mark themselves active
  await p.click('.lp-nav a[data-scroll="pendapatan"]')
  await p.waitForTimeout(1400)
  const incTop = await p.evaluate(() => Math.round(document.getElementById('pendapatan').getBoundingClientRect().top))
  t.check(Math.abs(incTop) < 200, 'anchor click scrolls #pendapatan into view', incTop)
  t.check(await p.locator('.lp-nav a[data-nav="pendapatan"].is-active').count() === 1, 'Pendapatan nav link becomes active')

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
  // Smooth scroll starts after the menu's close transition; wait for it instead of a fixed delay.
  await m.waitForFunction(() => scrollY > 500, null, { timeout: 5000 }).catch(() => {})
  const mm = await m.evaluate(() => ({ hidden: document.querySelector('[data-menu]').hidden, hash: location.hash, y: scrollY, lock: document.documentElement.classList.contains('lp-lock') }))
  t.check(mm.hidden && !mm.lock, 'mobile: menu link closes menu and unlocks scroll', JSON.stringify(mm))
  t.check(mm.y > 500 && (mm.hash === '#/' || mm.hash === ''), 'mobile: menu link scrolls and keeps hash', JSON.stringify(mm))
  await t.noErrors(m)

  // Check both sides of the navigation breakpoint and the narrow card layout.
  const responsive = await t.page({ reducedMotion: 'reduce' })
  await responsive.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await responsive.waitForSelector('.lp-inc-engine')
  for (const width of [1440, 1024, 960, 959, 390, 320]) {
    await responsive.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      const layout = await responsive.evaluate((theme) => {
        document.documentElement.dataset.theme = theme
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
        const nav = rect('.lp-nav')
        const brand = rect('.lp-header .brand-link')
        const actions = rect('.lp-header-actions')
        return {
          fits: document.documentElement.scrollWidth <= innerWidth,
          navFits: innerWidth < 960 || (nav.left >= brand.right && nav.right <= actions.left),
          visible: [...document.querySelectorAll('.lp-inc-engine, .lp-grow-card')].every((el) => getComputedStyle(el).opacity === '1'),
          pulseDuration: parseFloat(getComputedStyle(document.querySelector('.lp-inc-teams li'), '::before').animationDuration),
        }
      }, theme)
      t.check(layout.fits && layout.navFits, `${width}px ${theme}: content fits and header links do not overlap`, JSON.stringify(layout))
      t.check(layout.visible && layout.pulseDuration < 0.001, `${width}px ${theme}: reduced motion keeps cards visible and suppresses team pulses`)
    }
  }
  await t.noErrors(responsive)
}

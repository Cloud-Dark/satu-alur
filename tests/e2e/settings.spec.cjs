// E2E: Pengaturan drawer — open/close (Esc, focus return, focus trap), tabs Konektor /
// Agen AI, edits persist in localStorage, "Kembalikan default", mobile sidebar,
// sidebar collapse. TC-SET-*, FR-020.
const { loginLive, norm } = require('./lib.cjs')

module.exports = async function settings(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  await p.click('.side-row')
  await p.waitForSelector('.drawer.is-open', { timeout: 5000 })
  t.check(await p.getAttribute('.drawer', 'role') === 'dialog' && await p.getAttribute('.drawer', 'aria-modal') === 'true', 'drawer is a modal dialog')
  t.check(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Tutup pengaturan', 'focus moves to the close button')
  const tabs = await p.$$eval('.drawer .seg-btn', (b) => b.map((x) => x.textContent.trim()))
  t.check(tabs.join('|') === 'Konektor|Agen AI', 'tabs Konektor, Agen AI (no technical Cloud tab)', tabs.join('|'))

  // Konektor: WhatsApp toggle persists
  await p.click('label[for="whatsapp-enabled"]')
  await p.waitForTimeout(150)
  const mcp = await p.evaluate(() => JSON.parse(localStorage.getItem('satualur_settings_mcp') || '{}'))
  t.check(mcp.whatsapp?.enabled === true, 'WhatsApp "Aktif" saved to localStorage')

  // Agen AI: prompt edit + reset
  await p.click('.drawer .seg-btn[data-value="agent"]')
  await p.waitForSelector('#offer-prompt')
  await p.fill('#offer-prompt', 'Prompt uji E2E untuk penawaran.')
  await p.waitForTimeout(150)
  const agent = await p.evaluate(() => JSON.parse(localStorage.getItem('satualur_settings_agent') || '{}'))
  t.check(agent.offerPrompt === 'Prompt uji E2E untuk penawaran.', 'edited offer prompt saved')
  t.check(await p.locator('#agent-temp').count() === 1 && await p.locator('#agent-tokens').count() === 1, 'temperature and max-token sliders present')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
  t.check(await p.evaluate(() => document.querySelector('.drawer').hidden), 'Escape closes the drawer')
  t.check(await p.evaluate(() => document.activeElement?.classList.contains('side-row')), 'focus returns to "Pengaturan"')
  await p.click('.side-row')
  await p.waitForSelector('.drawer.is-open')
  t.check(await p.getAttribute('.drawer .seg-btn[data-value="agent"]', 'aria-checked') === 'true', 'drawer reopens on the last tab')
  t.check(await p.inputValue('#offer-prompt') === 'Prompt uji E2E untuk penawaran.', 'edited prompt shown after reopen')
  await p.getByRole('button', { name: 'Kembalikan default' }).first().click()
  await p.waitForTimeout(300)
  t.check(/agen penawaran/i.test(await p.inputValue('#offer-prompt')), '"Kembalikan default" restores the default prompt')

  t.check(!/Cloudflare|localStorage|JSON|MCP/.test(norm(await p.textContent('.drawer'))), 'drawer has no technical wording')

  // focus trap: Tab stays inside the drawer
  for (let i = 0; i < 15; i++) await p.keyboard.press('Tab')
  t.check(await p.evaluate(() => document.querySelector('.drawer').contains(document.activeElement)), 'Tab keeps focus inside the drawer')
  await p.click('.scrim-drawer', { position: { x: 10, y: 10 } }).catch(() => {})
  await p.waitForTimeout(500)
  t.check(await p.evaluate(() => document.querySelector('.drawer').hidden), 'clicking the scrim closes the drawer')

  // sidebar collapse (desktop)
  await p.click('.side-collapse')
  await p.waitForTimeout(300)
  t.check(await p.evaluate(() => /collapsed/.test(document.querySelector('.app-shell').className) || document.querySelector('.side-collapse').getAttribute('aria-label') !== 'Ciutkan sidebar'), 'sidebar collapses')
  await p.click('.side-collapse')
  await t.noErrors(p)

  // mobile: sidebar is a drawer opened by the menu button
  const m = await t.page({ width: 390, height: 844 })
  await loginLive(m, t.base)
  t.check(!(await m.isVisible('.flow-item[data-stage="request"]')), 'mobile: sidebar hidden by default')
  await m.click('.topbar-menu')
  await m.waitForTimeout(400)
  t.check(await m.isVisible('.flow-item[data-stage="request"]') && await m.getAttribute('.topbar-menu', 'aria-expanded') === 'true', 'mobile: menu button opens the sidebar')
  await m.keyboard.press('Escape')
  await m.waitForTimeout(400)
  t.check(!(await m.isVisible('.flow-item[data-stage="request"]')), 'mobile: Escape closes the sidebar')
  t.check(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile app: no horizontal scroll')
  await t.noErrors(m)
}

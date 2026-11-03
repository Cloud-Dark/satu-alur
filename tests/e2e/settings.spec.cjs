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
  t.check(tabs.join('|') === 'Konektor|ERP & Integrasi|Migrasi|Log|Agen AI', 'tabs Konektor, ERP & Integrasi, Migrasi, Log, Agen AI', tabs.join('|'))

  // Konektor: the business's own WAPilot key, saved and shown only as the last 4 characters
  await p.evaluate(() => localStorage.setItem('satualur_settings_mcp', JSON.stringify({ whatsapp: { apiKey: 'lama', wapilotEndpoint: 'x' } })))
  await p.click('.drawer .seg-btn[data-value="agent"]')
  await p.click('.drawer .seg-btn[data-value="mcp"]')
  await p.waitForSelector('#ig-wapilot-token', { timeout: 8000 })
  const legacy = await p.evaluate(() => JSON.parse(localStorage.getItem('satualur_settings_mcp') || '{}'))
  t.check(!('whatsapp' in legacy), 'old browser-stored WhatsApp key removed')
  t.check(await p.locator('.ig-card[data-provider="waconsole"] #ig-waconsole-app_key').count() === 1 && await p.locator('#ig-repliz-access_key').count() === 1, 'WAConsole and Repliz key forms shown')
  await p.fill('#ig-wapilot-token', 'aica_0123456789abcdef')
  await p.getByRole('button', { name: 'Hubungkan WAPilot' }).click()
  await p.locator('.ig-card[data-provider="wapilot"] .status', { hasText: '…cdef' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await p.locator('.ig-card[data-provider="wapilot"]', { hasText: 'Terhubung • …cdef' }).count() === 1, 'WAPilot connected, key shown only as …cdef')
  t.check(!(await p.evaluate(() => JSON.stringify(localStorage))).includes('aica_0123456789abcdef'), 'the key itself is not kept in the browser')

  // ERP & Integrasi tab: connector grid and template cards (loaded async)
  await p.click('.drawer .seg-btn[data-value="erp"]')
  await p.waitForSelector('.mcp-connector-grid', { timeout: 8000 })
  t.check(await p.locator('.mcp-connector-grid').count() === 1, 'ERP tab: connector grid present')
  t.check(await p.locator('.mcp-template-card').count() >= 4, 'ERP tab: template cards present')

  // Migrasi tab: migration list and info box
  await p.click('.drawer .seg-btn[data-value="migration"]')
  await p.waitForSelector('.mcp-migration-list', { timeout: 8000 })
  t.check(await p.locator('.mcp-migration-list').count() === 1, 'Migrasi tab: migration list present')
  t.check(await p.locator('.mcp-info-box').count() === 1, 'Migrasi tab: info box present')

  // Log tab: log table
  await p.click('.drawer .seg-btn[data-value="logs"]')
  await p.waitForSelector('.mcp-log-table', { timeout: 8000 })
  t.check(await p.locator('.mcp-log-table').count() === 1, 'Log tab: log table present')

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

  // Enterprise gate: the same account on a lower tier sees a locked panel
  // instead of a form whose requests would all come back 403. The plan is read
  // on every tab draw, so switching tabs re-evaluates it without a reload
  // (a reload would drop the in-memory mock session).
  await p.evaluate(() => localStorage.setItem('satualur_plan', 'sole'))
  await p.click('.side-row')
  await p.waitForSelector('.drawer.is-open', { timeout: 5000 })
  await p.click('.drawer .seg-btn[data-value="erp"]')
  await p.waitForSelector('.mcp-locked', { timeout: 8000 })
  t.check(await p.locator('.mcp-locked').count() === 1, 'ERP tab: locked panel shown for a non-enterprise plan')
  t.check(await p.locator('.mcp-connector-grid').count() === 0, 'ERP tab: connector grid hidden when locked')
  t.check(/Enterprise/.test(await p.locator('.mcp-locked').innerText()), 'locked panel names the Enterprise tier')
  await p.click('.drawer .seg-btn[data-value="migration"]')
  await p.waitForSelector('.mcp-locked', { timeout: 8000 })
  t.check(await p.locator('.mcp-migration-list').count() === 0, 'Migrasi tab: gated on the same rule')
  await p.evaluate(() => localStorage.removeItem('satualur_plan'))
  await p.click('.drawer .seg-btn[data-value="erp"]')
  await p.waitForSelector('.mcp-connector-grid', { timeout: 8000 })
  t.check(await p.locator('.mcp-locked').count() === 0, 'Enterprise plan: the gate opens again')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
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

// E2E: searchable combobox (src/ui/combobox.js) on the Penawaran request picker —
// open by keyboard, type-to-filter with highlight, count, arrow/Home/End, Enter
// selects (native <select> stays source of truth), Escape/outside click close. TC-CMB-*.
const { loginLive, goStage, norm } = require('./lib.cjs')

module.exports = async function combobox(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  await goStage(p, 'offer')
  await p.waitForSelector('.combo:has(select[name="request_id"]) .combo-trigger')
  const trigger = p.locator('.combo:has(select[name="request_id"]) .combo-trigger')
  const native = p.locator('select[name="request_id"]')
  const opts = () => p.$$eval('.combo-pop:not([hidden]) .combo-option', (els) => els.map((e) => e.textContent.trim()))
  const activeText = () => p.$eval('.combo-pop:not([hidden]) .combo-option.is-active', (e) => e.textContent.trim()).catch(() => null)

  t.check(await trigger.getAttribute('role') === 'combobox' && await trigger.getAttribute('aria-expanded') === 'false', 'trigger has role=combobox, collapsed')
  t.check(await native.getAttribute('aria-hidden') === 'true', 'native select hidden from AT but kept in DOM')

  // keyboard open
  await trigger.focus()
  await p.keyboard.press('ArrowDown')
  await p.waitForSelector('.combo-pop:not([hidden])')
  t.check(await trigger.getAttribute('aria-expanded') === 'true', 'ArrowDown opens the list (aria-expanded=true)')
  await p.waitForTimeout(100)
  t.check(await p.evaluate(() => document.activeElement?.classList.contains('combo-search-input')), 'focus moves to the search box')
  const all = await opts()
  t.check(all.length >= 1, 'options listed (requests without offer)', all.length)
  t.check(/\d+ pilihan/.test(await p.textContent('.combo-pop .combo-count')), 'count line shows total')

  // arrows / Home / End
  if (all.length > 1) {
    const first = await activeText()
    await p.keyboard.press('ArrowDown')
    t.check((await activeText()) !== first, 'ArrowDown moves the active option')
    await p.keyboard.press('End')
    t.check((await activeText()) === all.at(-1), 'End jumps to the last option')
    await p.keyboard.press('Home')
    t.check((await activeText()) === all[0], 'Home jumps to the first option')
  }
  t.check(Boolean(await p.getAttribute('.combo-search-input', 'aria-activedescendant')), 'aria-activedescendant tracks the active option')

  // filter
  await p.keyboard.type('hotel')
  await p.waitForTimeout(150)
  const filtered = await opts()
  t.check(filtered.length >= 1 && filtered.every((x) => /hotel/i.test(x)), 'typing "hotel" filters options', filtered.join(' | '))
  t.check(/dari/.test(await p.textContent('.combo-pop .combo-count')) && await p.locator('.combo-pop mark').count() >= 1, 'filtered count "N dari M" and <mark> highlight')
  await p.fill('.combo-search-input', 'zzzz-tidak-ada')
  await p.waitForTimeout(150)
  t.check(await p.isVisible('.combo-pop .combo-empty') && /Tidak ada hasil/.test(await p.textContent('.combo-pop .combo-empty')), 'no match -> "Tidak ada hasil."')
  await p.fill('.combo-search-input', 'HOTEL') // case-insensitive
  await p.waitForTimeout(150)
  const pick = (await opts())[0]
  t.check(Boolean(pick), 'search is case-insensitive')

  // Enter selects and writes back to the native select
  // register the listener (awaited) before pressing Enter, so the key cannot win the race
  await p.evaluate(() => { window.__comboChanged = 0; document.querySelector('select[name="request_id"]').addEventListener('change', () => { window.__comboChanged++ }, { once: true }) })
  await p.keyboard.press('Enter')
  await p.waitForFunction(() => window.__comboChanged > 0, null, { timeout: 2000 }).catch(() => {})
  t.check(await p.evaluate(() => window.__comboChanged) === 1, 'Enter dispatches change on the native select')
  t.check(await p.locator('.combo-pop').count() === 0 || !(await p.isVisible('.combo-pop')), 'list closes after choosing')
  t.check(norm(await trigger.textContent()) === norm(pick), 'trigger shows the chosen label', `${await trigger.textContent()} vs ${pick}`)
  t.check(Boolean(await native.inputValue()), 'native select has a value')
  t.check(await p.evaluate(() => document.activeElement?.classList.contains('combo-trigger')), 'focus returns to the trigger')

  // Escape and outside click close without changing the value
  const before = await native.inputValue()
  await trigger.focus()
  await p.keyboard.press('ArrowDown') // ArrowDown (not Enter) so a stray key can never submit the wizard
  await p.waitForSelector('.combo-pop:not([hidden])')
  await p.waitForTimeout(100)
  await p.keyboard.press('ArrowDown')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  t.check(await trigger.getAttribute('aria-expanded') === 'false' && (await native.inputValue()) === before, 'Escape closes without changing the value')
  await trigger.click()
  await p.waitForSelector('.combo-pop:not([hidden])')
  await p.mouse.click(5, 5)
  await p.waitForTimeout(150)
  t.check(await trigger.getAttribute('aria-expanded') === 'false', 'outside click closes the list')

  // printable key on the trigger opens with that seed
  await trigger.focus()
  await p.keyboard.press('p')
  await p.waitForSelector('.combo-pop:not([hidden])')
  t.check(await p.inputValue('.combo-search-input') === 'p', 'typing on the trigger opens with the typed seed')
  await p.keyboard.press('Escape')
  await t.noErrors(p)
}

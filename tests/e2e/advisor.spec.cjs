// E2E: Penasihat AI (mock AI) — auto-routing with hint, suggestion chips, fixed agent,
// stop mid-stream, growth calculator presets, clear conversation (2-click), memory
// survives reload. Adapted from the ad-hoc advisor-test.cjs. TC-ADV-*.
const { loginLive, goStage, norm } = require('./lib.cjs')

module.exports = async function advisor(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  t.check(await goStage(p, 'advisor'), 'sidebar has "Penasihat AI"')
  await p.waitForSelector('.adv-grid')
  await p.waitForTimeout(600)
  const waitIdle = () => p.waitForFunction(() => document.querySelector('.adv-stop')?.hidden === true, null, { timeout: 30000 })
  const lastBadge = () => p.$$eval('.adv-msg.is-assistant .adv-badge', (b) => b.at(-1)?.textContent.trim())
  const count = () => p.locator('.adv-msg').count()
  // The agent picker is a popover in the chat header: open it, then choose.
  const pick = async (key) => {
    if (!(await p.isVisible(`.adv-agent[data-agent="${key}"]`))) await p.click('.adv-agent-trigger')
    await p.click(`.adv-agent[data-agent="${key}"]`)
    await p.waitForTimeout(150)
    return (await p.getAttribute('.adv-agent-trigger', 'aria-expanded')) === 'false'
  }

  t.check(await p.locator('.adv-agent').count() === 6, 'agent picker: Otomatis + 5 agents')
  t.check(await p.isHidden('.adv-agent-pop'), 'agent picker is a closed popover in the chat header')
  t.check(await p.locator('.adv-tab').count() === 3, 'side panel tabs: Snapshot, Kalkulator, Statistik')
  const vh = await p.evaluate(() => [document.documentElement.scrollHeight, innerHeight])
  t.check(vh[0] <= vh[1] + 40, 'advisor fits one viewport at 1440x900', `${vh[0]} vs ${vh[1]}`)

  // auto routing
  t.check(await pick('auto'), 'choosing an agent closes the picker')
  await p.fill('.adv-input', 'Bagaimana naik 2% bulan depan?')
  await p.waitForTimeout(200)
  const hint = norm(await p.textContent('.adv-route-hint'))
  t.check(/Strategi pertumbuhan/.test(hint), 'route hint predicts "Strategi pertumbuhan" while typing', hint)
  const n0 = await count()
  await p.press('.adv-input', 'Enter')
  await waitIdle()
  t.check(await count() === n0 + 2, 'Enter sends: question + answer added')
  t.check(/Strategi pertumbuhan/.test(await lastBadge()), 'auto-routed answer badge = Strategi pertumbuhan', await lastBadge())
  const route = norm(await p.$$eval('.adv-route', (r) => r.at(-1)?.textContent || ''))
  t.check(/Dipilih otomatis dari kata/.test(route), 'routing reason shown', route)
  const answer = norm(await p.$$eval('.adv-msg.is-assistant .adv-bubble', (x) => x.at(-1)?.textContent || ''))
  t.check(/Rp/.test(answer), 'answer quotes Rupiah numbers from the snapshot', answer.slice(0, 120))

  // suggestion chip -> keuangan
  await p.locator('.adv-chip', { hasText: 'Biaya mana' }).first().click()
  await waitIdle()
  t.check(/Analis keuangan/.test(await lastBadge()), 'chip "Biaya mana…" routes to Analis keuangan', await lastBadge())

  // fixed agent
  await pick('pemasaran')
  await p.waitForTimeout(300)
  await p.fill('.adv-input', 'Apa langkah pertama yang sebaiknya saya ambil?')
  await p.click('.adv-send')
  await waitIdle()
  t.check(/Pemasaran/.test(await lastBadge()), 'selected agent answers (Pemasaran)', await lastBadge())

  // stop
  await p.fill('.adv-input', 'Bagaimana membuat pelanggan kembali lagi?')
  await p.press('.adv-input', 'Enter')
  await p.waitForTimeout(700)
  await p.click('.adv-stop').catch(() => {})
  await waitIdle()
  const flags = await p.$$eval('.adv-flag', (f) => f.map((x) => x.textContent.trim()))
  t.check(flags.some((f) => /henti/i.test(f)), 'stopped answer flagged', flags.join(' | '))

  // leaving the page mid-answer: the answer keeps streaming and is there on return
  const nBg = await count()
  await p.fill('.adv-input', 'Pekerjaan mana yang tertahan paling lama?')
  await p.press('.adv-input', 'Enter')
  await p.waitForTimeout(250)
  await goStage(p, 'dashboard')
  await p.waitForTimeout(400)
  await goStage(p, 'advisor')
  await p.waitForSelector('.adv-grid')
  const resumed = await p.evaluate(() => Boolean(document.querySelector('.adv-msg.is-assistant[aria-busy="true"]')) || document.querySelector('.adv-stop')?.hidden === false)
  await waitIdle()
  await p.waitForTimeout(300)
  t.check(await count() === nBg + 2, 'answer finished in the background while away (question + answer shown on return)', `${await count()} vs ${nBg + 2}, resumedMidStream=${resumed}`)
  const stored = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('satualur_advisor_v1:')).map((k) => JSON.parse(localStorage.getItem(k)).length))
  t.check(stored.length === 1 && stored[0] >= nBg + 2, 'conversation stored in the browser under a per-user key', JSON.stringify(stored))
  const foot = norm(await p.$$eval('.adv-msg-foot', (f) => f.map((x) => x.textContent).join(' | ')))
  t.check(!/@cf\/|llama|mock-/i.test(foot), 'no model ids shown under answers', foot.slice(0, 120))

  // calculator (side panel tab)
  await p.click('.adv-tab[data-tab="calc"]')
  t.check(await p.isVisible('.adv-preset[data-pct="2"]') && !(await p.isVisible('.adv-snap')), 'Kalkulator tab shows the calculator and hides the snapshot')
  const calc = {}
  for (const v of ['1', '2', '5', '10']) {
    await p.click(`.adv-preset[data-pct="${v}"]`)
    await p.waitForTimeout(150)
    calc[v] = norm(await p.textContent('.adv-calc-big'))
  }
  t.check(new Set(Object.values(calc)).size === 4 && Object.values(calc).every((x) => /Rp/.test(x)), 'calculator presets 1/2/5/10% give 4 different Rupiah projections', JSON.stringify(calc))

  // clear (two clicks) only clears the selected agent
  const beforeClear = await count()
  await p.click('.adv-clear')
  t.check(/yakin|lagi|Hapus\?|Konfirmasi/i.test(norm(await p.textContent('.adv-clear'))), 'clear asks for confirmation', norm(await p.textContent('.adv-clear')))
  await p.click('.adv-clear')
  await p.waitForTimeout(600)
  t.check(await count() < beforeClear && (await p.isVisible('.adv-empty')), 'clear empties the Pemasaran conversation')
  await pick('auto')
  await p.waitForTimeout(300)
  const autoCount = await count()
  t.check(autoCount >= 4, 'other agents keep their messages (Otomatis view)', autoCount)
  t.check(/\d/.test(norm(await p.textContent('.adv-stat-row').catch(() => ''))), 'usage stats shown')

  // memory survives reload (browser storage)
  await p.reload({ waitUntil: 'load' })
  await loginLive(p, t.base)
  await goStage(p, 'advisor')
  await p.waitForSelector('.adv-grid')
  await p.waitForTimeout(800)
  await pick('auto')
  await p.waitForTimeout(300)
  t.check(await count() === autoCount, 'conversation reloaded from storage', `${await count()} vs ${autoCount}`)
  await t.noErrors(p)
}

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

  t.check(await p.locator('.adv-agent').count() === 6, 'agent picker: Otomatis + 5 agents')

  // auto routing
  await p.click('.adv-agent[data-agent="auto"]')
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
  await p.click('.adv-agent[data-agent="pemasaran"]')
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

  // calculator
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
  await p.click('.adv-agent[data-agent="auto"]')
  await p.waitForTimeout(300)
  const autoCount = await count()
  t.check(autoCount >= 4, 'other agents keep their messages (Otomatis view)', autoCount)
  t.check(/\d/.test(norm(await p.textContent('.adv-stat-row').catch(() => ''))), 'usage stats shown')

  // memory survives reload (mock D1 in localStorage)
  await p.reload({ waitUntil: 'load' })
  await loginLive(p, t.base)
  await goStage(p, 'advisor')
  await p.waitForSelector('.adv-grid')
  await p.waitForTimeout(800)
  await p.click('.adv-agent[data-agent="auto"]')
  await p.waitForTimeout(300)
  t.check(await count() === autoCount, 'conversation reloaded from storage', `${await count()} vs ${autoCount}`)
  await t.noErrors(p)
}

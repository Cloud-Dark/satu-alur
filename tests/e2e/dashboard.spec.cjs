// E2E: dashboard (Ringkasan) KPIs against the mock seed — 8 permintaan, 7 penawaran,
// 6 penugasan, 4 penyelesaian, 12 jurnal; pendapatan 9.750.000, biaya 3.800.000, laba 5.950.000.
// Plus funnel, "Perlu tindakan", chart range, empty account onboarding. TC-DSH-*, FR-017.
const { loginLive, kpiValue, goStage, norm } = require('./lib.cjs')

const rp = (s) => norm(s).replace(/\s/g, '')

module.exports = async function dashboard(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  t.check(/Mode demo · data lokal/.test(await p.textContent('.sync-line')), 'sync line says "Mode demo · data lokal"')
  t.check(await p.locator('.kpis .kpi').count() === 4, 'four KPI cards')
  t.check(rp(await kpiValue(p, 'Laba sebelum pajak')) === 'Rp5.950.000', 'Laba sebelum pajak = Rp5.950.000', await kpiValue(p, 'Laba sebelum pajak'))
  t.check(rp(await kpiValue(p, 'Pendapatan')) === 'Rp9.750.000', 'Pendapatan = Rp9.750.000', await kpiValue(p, 'Pendapatan'))
  t.check(rp(await kpiValue(p, 'Biaya')) === 'Rp3.800.000', 'Biaya = Rp3.800.000', await kpiValue(p, 'Biaya'))
  t.check(norm(await kpiValue(p, 'Tingkat penyelesaian')) === '67%', 'Tingkat penyelesaian = 67% (4 of 6)', await kpiValue(p, 'Tingkat penyelesaian'))
  const heroSub = norm(await p.textContent('.kpi.is-hero .kpi-sub'))
  t.check(/^Margin 61%/.test(heroSub), 'hero KPI shows margin ≈61%', heroSub)

  const funnel = await p.$$eval('.funnel-row', (rows) => rows.map((r) => [r.querySelector('.funnel-label').textContent.trim(), r.querySelector('.funnel-count').textContent.trim()]))
  const f = Object.fromEntries(funnel)
  t.check(f.Permintaan === '8' && f.Penawaran === '7' && f.Penugasan === '6' && f.Penyelesaian === '4' && f.Pembukuan === '12', 'funnel counts 8/7/6/4/12', JSON.stringify(funnel))

  const todos = await p.$$eval('.todo .todo-title', (els) => els.map((e) => e.textContent.trim()))
  t.check(todos.length > 0, '"Perlu tindakan" lists work items', todos.length)
  t.check(await p.locator('.feed-item').count() > 0, '"Aktivitas terbaru" has events')
  t.check(await p.locator('.chart-panel svg').count() >= 1, 'revenue vs cost chart rendered')
  const seg = p.locator('.chart-panel .seg-btn')
  if (await seg.count() > 1) {
    await seg.nth(1).click()
    await p.waitForTimeout(300)
    t.check(await seg.nth(1).getAttribute('aria-checked') === 'true', 'chart range toggle switches')
  }

  // nav counter badges reflect queues; funnel row opens the stage
  await p.locator('.funnel-row').nth(1).click()
  await p.waitForTimeout(700)
  t.check(await p.locator('.flow-item[data-stage="offer"][aria-current="page"], .flow-item[data-stage="offer"].is-active').count() === 1, 'funnel row opens Penawaran stage')
  await goStage(p, 'dashboard')
  await t.noErrors(p)

  // empty account: onboarding instead of KPIs
  const e = await t.page()
  await e.addInitScript(() => { if (!sessionStorage.getItem('wiped')) { sessionStorage.setItem('wiped', '1'); localStorage.setItem('satualur_mock_v1', JSON.stringify({ _seeded: true })) } })
  await e.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await e.fill('#auth-email', 'kosong@usaha.id')
  await e.click('.auth-form-email button[type=submit]')
  await e.waitForSelector('.auth-demo:not([hidden])')
  await e.click('.auth-demo-fill')
  await e.waitForSelector('.app-shell')
  await e.waitForSelector('.onboard, .kpis:not(.is-loading)', { timeout: 15000 })
  t.check(await e.locator('.onboard').count() === 1, 'empty account shows onboarding ("Alur Anda masih kosong")')
  await t.noErrors(e)
}

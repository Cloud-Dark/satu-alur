// E2E: demo accounts are fully demo, live accounts never get sample content.
// Demo: lead search returns "Data contoh (akun demo)" results offline, and the
// Pertumbuhan page is labelled as sample content. Live (OTP) account: the
// Pertumbuhan page shows no fixed sample opportunities.
const { loginLive, waitDashboard, goStage, norm } = require('./lib.cjs')

module.exports = async function demoLive(t) {
  // --- Demo account
  const d = await t.page()
  const external = []
  d.on('request', (r) => { if (/overpass|nominatim|googleapis\.com\/.*places/i.test(r.url())) external.push(r.url()) })
  await d.goto(`${t.base}/#/masuk?demo`, { waitUntil: 'load' })
  await d.waitForSelector('#auth-mode-demo')
  await d.waitForTimeout(400)
  await d.click('.auth-form-demo button[type=submit]')
  await d.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 60000 })
  await waitDashboard(d)
  const demoEmail = norm(await d.textContent('.side-user-email'))
  t.check(/^demo-.*@satualur\.id$/.test(demoEmail), 'signed in with a demo account', demoEmail)

  await goStage(d, 'leads')
  await d.waitForSelector('.ld-map .leaflet-container, .ld-map.leaflet-container', { timeout: 15000 })
  t.check(/akun demo/i.test(norm(await d.textContent('.ld-source'))), 'demo hint shown next to the search controls')
  await d.fill('#ld-addr', 'Bandung')
  await d.waitForSelector('#ld-addr-list .ld-suggest-item', { timeout: 5000 })
  t.check(/\(contoh\)/.test(norm(await d.textContent('#ld-addr-list'))), 'address suggestions come from the demo gazetteer')
  await d.click('#ld-addr-list .ld-suggest-item')
  await d.click('.ld-search-btn')
  await d.waitForFunction(() => {
    const busy = document.querySelector('.ld-map-busy')
    return document.querySelectorAll('.ld-card').length > 0 && (!busy || busy.hidden)
  }, null, { timeout: 30000 })
  const info = norm(await d.textContent('.view'))
  t.check(/Data contoh \(akun demo\)/.test(info), 'results labelled "Data contoh (akun demo)"')
  t.check(await d.locator('.ld-card .tag', { hasText: 'contoh' }).count() > 0, 'result cards carry the "contoh" tag')
  t.check(external.length === 0, 'no request to OpenStreetMap, Nominatim or Google', external.join(' '))

  if (await goStage(d, 'pertumbuhan')) {
    await d.waitForTimeout(400)
    t.check(/Data contoh \(akun demo\)/.test(norm(await d.textContent('.view'))), 'demo Pertumbuhan page is labelled as sample content')
  }
  await t.noErrors(d)

  // --- Live account (email OTP)
  const p = await t.page()
  await loginLive(p, t.base, 'pemilik.baru@contoh-usaha.id')
  if (await goStage(p, 'pertumbuhan')) {
    await p.waitForTimeout(400)
    const view = norm(await p.textContent('.view'))
    t.check(/dari data Anda sendiri/.test(view), 'live Pertumbuhan page points to features computed from own data')
    t.check(!/Hotel Horizon|Rp 106\.3 juta|Klinik Sehat Sentosa/.test(view), 'live account sees no fixed sample opportunities')
    t.check(!/akun demo/i.test(view), 'live page carries no demo label')
  }
  await t.noErrors(p)
}

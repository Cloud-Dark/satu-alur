// E2E: Pencari prospek ('leads') in demo mode. Covers: map and controls are
// locked while a search runs, the search keeps running when the user opens
// another page, and the result + history survive navigation and reload
// (localStorage).
const { loginLive, goStage, norm } = require('./lib.cjs')

async function waitDone(p, ms = 30000) {
  await p.waitForFunction(() => {
    const busy = document.querySelector('.ld-map-busy')
    return document.querySelectorAll('.ld-card').length > 0 && (!busy || busy.hidden)
  }, null, { timeout: ms })
}

module.exports = async function leads(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  t.check(norm(await p.textContent('.flow-item[data-stage="leads"]')).includes('Pencari prospek'), 'sidebar label "Pencari prospek"')
  await goStage(p, 'leads')
  await p.waitForSelector('.ld-map .leaflet-container, .ld-map.leaflet-container', { timeout: 15000 })
  const view = norm(await p.textContent('.view'))
  t.check(!/Gagal memuat|Terjadi kesalahan/i.test(view), 'no load error shown')
  t.check(!/OpenStreetMap|Overpass|Nominatim|Google Places/.test(view.replace(norm(await p.textContent('.leaflet-control-attribution')), '')), 'no technical source names outside the map attribution')
  t.check(await p.locator('.ld-history').isHidden(), 'history hidden before any search')

  // Pick a point through the (offline demo) address search.
  await p.fill('#ld-addr', 'Bekasi')
  await p.waitForSelector('#ld-addr-list .ld-suggest-item', { timeout: 5000 })
  await p.click('#ld-addr-list .ld-suggest-item')
  t.check(norm(await p.textContent('.ld-point')).includes('Bekasi'), 'point set from address')

  // Start the search: everything is locked while it runs.
  await p.click('.ld-search-btn')
  await t.shot(p, 'locked')
  t.check(await p.locator('.ld-map-busy').isVisible(), 'map overlay shown while searching')
  t.check(await p.getAttribute('.ld-map-wrap', 'aria-busy') === 'true', 'map wrap aria-busy=true')
  t.check(await p.locator('.ld-fieldset').evaluate((f) => f.disabled), 'controls fieldset disabled')
  t.check(await p.locator('.ld-search-btn').isDisabled(), 'search button disabled')
  t.check(await p.locator('#ld-addr').isDisabled(), 'address input disabled')
  t.check(await p.locator('.ld-map-wrap.is-locked').count() === 1, 'map marked locked')

  // Leave while it runs, come back: the job kept going.
  await goStage(p, 'dashboard')
  await goStage(p, 'leads')
  await waitDone(p)
  const cards = await p.locator('.ld-card').count()
  t.check(cards > 0, 'results arrived after navigating away and back', `${cards} cards`)
  t.check(await p.locator('.ld-map-busy').isHidden(), 'map overlay gone after the search')
  t.check(!(await p.locator('.ld-fieldset').evaluate((f) => f.disabled)), 'controls enabled again')
  await t.shot(p, 'done')
  t.check(await p.locator('.ld-history-item').count() === 1, 'one history entry')

  // Navigate away and back: restored from storage, no new search.
  const firstName = norm(await p.locator('.ld-card .ld-card-title').first().textContent())
  await goStage(p, 'report')
  await goStage(p, 'leads')
  await p.waitForSelector('.ld-card', { timeout: 5000 })
  t.check(norm(await p.locator('.ld-card .ld-card-title').first().textContent()) === firstName, 'same results after navigation', firstName)
  t.check(await p.locator('.ld-map-busy').isHidden(), 'no new search started on return')

  // Reload: still there (localStorage). Sign in again if the session was lost.
  await p.reload({ waitUntil: 'load' })
  await p.waitForSelector('.app-shell, #auth-email', { timeout: 15000 })
  if (await p.locator('#auth-email').count()) await loginLive(p, t.base)
  if (!(await p.locator('.ld-wrap').count())) await goStage(p, 'leads')
  await p.waitForSelector('.ld-card', { timeout: 8000 })
  t.check(await p.locator('.ld-card').count() === cards, 'results restored after reload')
  await p.click('.ld-history-item')
  t.check(await p.locator('.ld-history-item.is-active').count() === 1, 'history item restores and is marked active')
  const stored = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('satualur_leads_v1:')).length)
  t.check(stored === 1, 'one per-user leads store key')
  await t.noErrors(p)
}

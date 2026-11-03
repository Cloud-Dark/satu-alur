// E2E (mock, 390px): login puts Google above the email form; Penugasan › Tim has
// no stray "null", skills are managed (add inline / rename / delete) and used on a
// new petugas; Penugasan › Peta is a Leaflet (OpenStreetMap) map with markers.
const { loginLive, goStage } = require('./lib.cjs')

module.exports = async function petugas(t) {
  // Login order: Google (mock button) → "atau dengan email" → email stepper/form.
  const l = await t.page({ width: 390, height: 844 })
  await l.addInitScript(() => localStorage.setItem('satualur_mock_google', '1'))
  await l.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await l.waitForSelector('.auth-google-box:not([hidden])', { timeout: 10000 })
  const order = await l.evaluate(() => {
    const g = document.querySelector('.auth-google-box')
    const f = document.querySelector('.auth-form-email')
    return Boolean(g.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) && g.getBoundingClientRect().bottom <= f.getBoundingClientRect().top
  })
  t.check(order, 'login: Google sign-in sits above the email form')
  await l.close()

  const p = await t.page({ width: 390, height: 844 })
  await loginLive(p, t.base, 'tim-petugas@contoh.id')
  await goStage(p, 'assign')
  await p.locator('.seg-btn[data-value="team"]').click()
  await p.waitForSelector('.skills-panel')
  const text = await p.evaluate(() => document.querySelector('.view').innerText)
  t.check(!/(^|\s)(null|undefined)(\s|$)/.test(text), 'Tim: no stray "null"/"undefined" text', text.match(/.{0,30}(null|undefined).{0,30}/)?.[0])
  t.check(await p.locator('.view fieldset').count() === 0, 'Tim: no browser-default fieldset left')

  // Skills manager: add, rename.
  const panel = p.locator('.skills-panel')
  await panel.getByRole('textbox', { name: 'Nama keahlian baru' }).fill('Instalasi CCTV')
  await panel.getByRole('button', { name: 'Tambah' }).click()
  await p.waitForFunction(() => [...document.querySelectorAll('.skills-panel .skill-name')].some((n) => n.textContent === 'Instalasi CCTV'), null, { timeout: 8000 })
  t.check(true, 'Keahlian: a new skill is added to the list')
  await p.locator('.skills-panel').getByRole('textbox', { name: 'Nama keahlian baru' }).fill('instalasi cctv')
  await p.locator('.skills-panel').getByRole('button', { name: 'Tambah' }).click()
  await p.waitForTimeout(500)
  t.check(/sudah ada/.test(await p.locator('.view .note, .view [role="alert"], .view .msg').allTextContents().then((a) => a.join(' '))), 'Keahlian: duplicate names (any case) are refused')
  const row = p.locator('.skill-row', { hasText: 'Instalasi CCTV' })
  await row.getByRole('button', { name: 'Ubah' }).click()
  await p.locator('.skill-row input').fill('CCTV & Alarm')
  await p.locator('.skill-row').getByRole('button', { name: 'Simpan' }).click()
  await p.waitForFunction(() => [...document.querySelectorAll('.skills-panel .skill-name')].some((n) => n.textContent === 'CCTV & Alarm'), null, { timeout: 8000 })
  t.check(true, 'Keahlian: rename in place')

  // New petugas with chips: pick the renamed skill + add one inline (auto-selected).
  await p.getByRole('button', { name: 'Tambah petugas' }).first().click()
  const dlg = p.locator('dialog[open]')
  await dlg.locator('input[name="name"]').fill('Joko Teknisi')
  await dlg.locator('input[name="address"]').fill('Jl. Melati 3, Bekasi')
  await dlg.getByRole('button', { name: 'CCTV & Alarm' }).click()
  t.check(await dlg.getByRole('button', { name: 'CCTV & Alarm' }).getAttribute('aria-pressed') === 'true', 'form: skill chip toggles on')
  await dlg.getByRole('textbox', { name: 'Nama keahlian baru' }).fill('Pompa Air')
  await dlg.getByRole('button', { name: 'Tambah', exact: true }).click()
  await p.waitForFunction(() => document.querySelector('dialog[open] .chip-toggle.is-on:nth-of-type(n)') && [...document.querySelectorAll('dialog[open] .chip-toggle')].some((b) => b.textContent.includes('Pompa Air') && b.getAttribute('aria-pressed') === 'true'), null, { timeout: 8000 })
  t.check(true, 'form: a skill added inline is saved and selected')
  await dlg.getByRole('button', { name: 'Tambah petugas' }).click()
  await p.waitForSelector('.workspace-entry:has-text("Joko Teknisi")', { timeout: 10000 })
  const card = p.locator('.workspace-entry', { hasText: 'Joko Teknisi' })
  const tags = (await card.locator('.tag').allTextContents()).join('|')
  t.check(/CCTV & Alarm/.test(tags) && /Pompa Air/.test(tags), 'new petugas shows both skills', tags)
  t.check(/Bekasi/.test(await card.textContent()), 'address is geocoded to a zone (Bekasi)')

  // Delete a skill in use: confirm, then it disappears from the petugas.
  p.once('dialog', (d) => d.accept())
  await p.locator('.skill-row', { hasText: 'Pompa Air' }).getByRole('button', { name: 'Hapus' }).click()
  await p.waitForFunction(() => ![...document.querySelectorAll('.skills-panel .skill-name')].some((n) => n.textContent === 'Pompa Air'), null, { timeout: 8000 })
  const tagsAfter = (await p.locator('.workspace-entry', { hasText: 'Joko Teknisi' }).locator('.tag').allTextContents()).join('|')
  t.check(!/Pompa Air/.test(tagsAfter), 'deleting a skill removes it from petugas', tagsAfter)

  // Peta: Leaflet map with a marker per located petugas.
  await p.locator('.seg-btn[data-value="map"]').click()
  await p.waitForSelector('.worker-lmap.leaflet-container', { timeout: 15000 })
  await p.waitForTimeout(800)
  const markers = await p.locator('.worker-lmap .leaflet-marker-icon').count()
  t.check(markers >= 2, 'Peta: Leaflet map shows petugas markers', markers)
  t.check(await p.locator('.worker-lmap .leaflet-control-attribution').textContent().then((s) => /OpenStreetMap/.test(s)), 'Peta: OpenStreetMap attribution')
  await p.locator('.worker-lmap').scrollIntoViewIfNeeded()
  await p.locator('.worker-lmap .leaflet-marker-icon').first().click({ force: true })
  await p.waitForTimeout(300)
  t.check(await p.locator('.leaflet-popup-content').count() === 1, 'Peta: marker popup opens')
  t.check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Peta: no horizontal scroll at 390px')
  await t.noErrors(p)
}

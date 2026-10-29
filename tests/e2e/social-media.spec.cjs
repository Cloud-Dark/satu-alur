// E2E: Social Media menu (#/social-media) — Akun + Konten tabs on the mock cloud (demo mode).
const { loginLive, goStage } = require('./lib.cjs')

module.exports = async function socialMedia(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  t.check(await goStage(p, 'social-media'), 'sidebar has "Social Media"')
  const tab = (name) => p.getByRole('radio', { name, exact: true })
  await p.waitForSelector('.workspace-tabs .seg-btn')
  const labels = await p.$$eval('.workspace-tabs .seg-btn', (b) => b.map((x) => x.textContent.trim()))
  t.check(labels.join(',') === 'Akun,Konten,Jadwal,Brainstorm,Iklan,Kolaborasi', 'six tabs in order', labels.join(','))

  // OAuth return: query is shown as a message, opens Akun, then stripped
  await p.evaluate(() => { location.hash = '#/social-media?social_error=Izin%20ditolak%20Meta' })
  await p.locator('.note-danger', { hasText: 'Izin ditolak Meta' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await p.locator('.note-danger', { hasText: 'Izin ditolak Meta' }).count() === 1, 'social_error shown as danger message')
  const hash = await p.evaluate(() => location.hash)
  t.check(!hash.includes('social_error'), 'query stripped from hash', hash)
  t.check(await tab('Akun').getAttribute('aria-checked') === 'true', 'Akun tab opened by social_error')

  // legacy import
  await p.evaluate(() => {
    localStorage.setItem('satualur_saved_content', JSON.stringify([{ id: 1, content: 'Ide lama satu', type: 'brainstorm' }, { id: 2, content: 'Caption lama', type: 'caption' }]))
    localStorage.setItem('satualur_schedules', JSON.stringify([{ id: 3, content: 'Jadwal lama' }]))
  })
  await tab('Konten').click()
  await tab('Akun').click()
  await p.getByRole('button', { name: 'Pindahkan ke akun' }).click()
  await p.waitForFunction(() => localStorage.getItem('satualur_social_migrated') === '1', null, { timeout: 8000 }).catch(() => {})
  t.check(await p.evaluate(() => localStorage.getItem('satualur_social_migrated')) === '1', 'import sets migrated flag')
  t.check(await p.evaluate(() => Boolean(localStorage.getItem('satualur_saved_content'))), 'import keeps old keys')

  // connect (demo connects immediately)
  await p.getByRole('button', { name: 'Hubungkan Facebook & Instagram' }).click()
  await p.waitForSelector('text=Demo Page', { timeout: 8000 })
  t.check(true, 'Akun shows "Demo Page" after connecting')
  t.check(await p.getByRole('button', { name: 'Putuskan' }).count() === 1, 'Putuskan button shown')

  // Konten: generate, save, share
  await tab('Konten').click()
  await p.waitForSelector('#sm-topic')
  const opts = (await p.locator('#sm-platform option').allTextContents()).join(',')
  t.check(opts === 'Instagram,Facebook', 'platform choices are Instagram, Facebook', opts)
  await p.fill('#sm-topic', 'Perawatan AC rumah')
  await p.getByRole('button', { name: 'Buat konten' }).click()
  await p.waitForSelector('.workspace-output .sm-composer', { timeout: 25000 })
  const out = p.locator('.workspace-output .sm-composer')
  await out.getByRole('button', { name: 'Simpan', exact: true }).click()
  await p.waitForSelector('.workspace-library .sm-composer', { timeout: 8000 })
  t.check(true, 'saved content appears in the library')
  const item = p.locator('.workspace-library .sm-composer').first()
  await item.getByLabel('Isi konten').fill('Tips E2E: bersihkan filter AC.')
  await item.getByRole('button', { name: 'Simpan', exact: true }).click()
  const ig = item.locator('input[value=instagram]')
  t.check(await ig.isDisabled(), 'Instagram checkbox disabled without image')
  t.check(await item.getByText('Instagram wajib memakai gambar.').count() >= 1, 'Instagram reason shown as hint')
  await item.locator('input[value=facebook]').check()
  await item.getByRole('button', { name: 'Bagikan sekarang' }).click()
  await p.locator('.toast', { hasText: 'Tayang di Facebook' }).first().waitFor({ timeout: 10000 }).catch(() => {})
  t.check(await p.locator('.toast', { hasText: 'Tayang di Facebook' }).count() >= 1, 'toast "Tayang di Facebook"')

  // share without platform
  await item.locator('input[value=facebook]').uncheck()
  await item.getByRole('button', { name: 'Bagikan sekarang' }).click()
  t.check(await p.locator('.note-danger', { hasText: 'Pilih minimal satu platform' }).count() === 1, 'share without platform is refused')

  // image makes Instagram eligible
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await item.getByLabel('Gambar (opsional)').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png })
  await p.waitForFunction(() => !document.querySelector('.workspace-library .sm-composer input[value=instagram]')?.disabled, null, { timeout: 8000 }).catch(() => {})
  t.check(await ig.isEnabled(), 'Instagram checkbox enabled after adding a 1:1 image')

  // Brainstorm reuses the generator and saves automatically
  await tab('Brainstorm').click()
  await p.fill('#sm-topic', 'Musim hujan')
  await p.getByRole('button', { name: 'Mulai brainstorm' }).click()
  await p.waitForSelector('.workspace-library .workspace-entry', { timeout: 25000 })
  t.check(true, 'brainstorm result saved to the library')
  await t.noErrors(p)
}

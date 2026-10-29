// E2E: Kantor Satu Alur (staff-only stage) on the mock cloud. run.cjs defines one staff
// account in VITE_STAFF_USERS (staff / rahasia-staf-123). Office access needs a
// username + password sign-in at /super-admin-login; the normal #/masuk login never grants it.
const { loginLive, goStage } = require('./lib.cjs')

async function staffLogin(page, base, username, password) {
  await page.goto(`${base}/super-admin-login`, { waitUntil: 'load' })
  await page.waitForSelector('#staff-username')
  await page.fill('#staff-username', username)
  await page.fill('#staff-password', password)
  await page.getByRole('button', { name: 'Masuk' }).click()
}

module.exports = async function office(t) {
  // regular business user: no menu entry, and the URL falls back to the dashboard
  const u = await t.page()
  await loginLive(u, t.base, 'pemilik@usaha.id')
  t.check(await u.locator('.flow-item[data-stage="office"]').count() === 0, 'regular user: no "Kantor Satu Alur" in the menu')
  await u.evaluate(() => sessionStorage.setItem('satualur_stage', 'office'))
  await u.goto(`${t.base}/#/app`)
  await u.waitForSelector('.app-shell')
  await u.waitForTimeout(800)
  t.check(await u.locator('.flow-item[aria-current="page"]').getAttribute('data-stage') === 'dashboard', 'regular user: stored office stage falls back to the dashboard')
  t.check(await u.getByRole('heading', { name: 'Kantor Satu Alur' }).count() === 0, 'regular user: office page never renders')
  await u.close()

  // the staff user's own email through the normal OTP login stays a regular user
  const n = await t.page()
  await loginLive(n, t.base, 'staff@staff.satualur.internal')
  t.check(await n.locator('.flow-item[data-stage="office"]').count() === 0, 'staff email via #/masuk: no "Kantor Satu Alur"')
  await n.close()

  // staff page: username + password only; empty form, wrong password, unknown user
  const x = await t.page()
  await x.goto(`${t.base}/super-admin-login`, { waitUntil: 'load' })
  await x.waitForSelector('#staff-username')
  t.check(await x.locator('#staff-password').getAttribute('type') === 'password', 'staff page asks for username + password')
  t.check(await x.locator('#auth-email, .auth-mode, .auth-demo').count() === 0, 'staff page has no email code or demo accounts')
  await x.getByRole('button', { name: 'Masuk' }).click()
  t.check(await x.getByText('Isi username dan password.').count() === 1, 'empty form asks for username and password')
  await staffLogin(x, t.base, 'staff', 'password-salah-123')
  await x.getByText('Username atau password salah.').first().waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await x.getByText('Username atau password salah.').count() === 1, 'wrong password is refused')
  t.check(await x.locator('#staff-password').inputValue() === '', 'password field cleared after a failure')
  await staffLogin(x, t.base, 'bukanstaf', 'rahasia-staf-123')
  await x.getByText('Username atau password salah.').first().waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await x.locator('.app-shell').count() === 0, 'unknown username is refused with the same message')
  await x.close()

  // staff sign-in lands on Kantor Satu Alur
  const p = await t.page()
  await staffLogin(p, t.base, 'staff', 'rahasia-staf-123')
  await p.waitForFunction(() => location.pathname === '/' && location.hash.startsWith('#/app'), null, { timeout: 10000 })
  await p.waitForSelector('.app-shell')
  await p.waitForTimeout(800)
  t.check(await p.locator('.flow-item[aria-current="page"]').getAttribute('data-stage') === 'office', 'staff login lands on Kantor Satu Alur')
  const radio = (name) => p.getByRole('radio', { name, exact: true })
  const kolaborasi = async () => {
    await goStage(p, 'social-media')
    await radio('Kolaborasi').click()
    await p.waitForSelector('.sm-inf-card')
  }

  t.check(await p.locator('.flow-item[data-stage="office"]', { hasText: 'Kantor Satu Alur' }).count() === 1, 'nav shows "Kantor Satu Alur" for an admin')

  // business sends a collab request first
  await kolaborasi()
  t.check(await p.locator('.sm-inf-card').count() === 6, 'Kolaborasi starts with 6 cards')
  await p.locator('.sm-inf-card').first().getByRole('button', { name: 'Ajukan kolaborasi' }).click()
  const cd = p.getByRole('dialog', { name: /Ajukan kolaborasi/ })
  await cd.getByLabel('Ceritakan kampanye Anda').fill('Promosi kedai baru')
  await cd.getByLabel('Kisaran anggaran').fill('Rp2-5 juta')
  await cd.getByLabel('Waktu kampanye').fill('Desember 2026')
  await cd.getByRole('button', { name: 'Kirim permintaan' }).click()
  await cd.waitFor({ state: 'hidden' })
  await p.locator('.sm-request', { hasText: 'Baru' }).first().waitFor({ timeout: 8000 })

  // add an influencer
  await goStage(p, 'office')
  await p.getByRole('button', { name: 'Tambah influencer' }).click()
  const dlg = p.getByRole('dialog', { name: 'Tambah influencer' })
  await dlg.getByRole('button', { name: 'Simpan' }).click()
  t.check(await dlg.locator('.field-error').first().textContent() === 'Nama wajib diisi.', 'dialog shows the validator message')
  await dlg.getByLabel('Nama').fill('Rina')
  await dlg.getByLabel('Niche').fill('Kuliner')
  await dlg.getByLabel('Kota').fill('Bandung')
  await dlg.getByLabel('Pengikut Instagram').fill('12000')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await dlg.getByLabel('Foto').setInputFiles({ name: 'rina.png', mimeType: 'image/png', buffer: png })
  const preview = dlg.locator('img[alt="Pratinjau foto"]')
  await preview.waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await preview.isVisible() && (await preview.getAttribute('src') || '').startsWith('blob:'), 'photo upload shows a preview')
  t.check(await dlg.locator('.field-error').first().textContent() === '', 'photo upload shows no error')
  await dlg.getByRole('button', { name: 'Simpan' }).click()
  await dlg.waitFor({ state: 'hidden' })
  await p.locator('.of-inf', { hasText: 'Rina' }).waitFor({ timeout: 8000 })
  t.check(await p.locator('.of-inf', { hasText: 'Rina' }).count() === 1, 'Rina listed in the Influencer tab')
  await kolaborasi()
  t.check(await p.locator('.sm-inf-card').count() === 7, 'Kolaborasi shows 7 cards after adding Rina')

  // hide Rina
  await goStage(p, 'office')
  await p.getByRole('button', { name: 'Ubah Rina' }).click()
  const ed = p.getByRole('dialog', { name: 'Ubah Rina' })
  await ed.getByLabel('Tampilkan di katalog').uncheck()
  await ed.getByRole('button', { name: 'Simpan' }).click()
  await ed.waitFor({ state: 'hidden' })
  await p.locator('.of-inf', { hasText: 'Disembunyikan' }).waitFor({ timeout: 8000 })
  t.check(await p.locator('.of-inf', { hasText: 'Rina' }).locator('.tag', { hasText: 'Disembunyikan' }).count() === 1, 'hidden influencer is tagged Disembunyikan')
  await kolaborasi()
  t.check(await p.locator('.sm-inf-card').count() === 6, 'hidden influencer is gone from Kolaborasi')

  // process the request
  await goStage(p, 'office')
  await radio('Permintaan').click()
  const req = p.locator('.of-request').first()
  await req.waitFor({ timeout: 8000 })
  t.check((await req.textContent()).includes('Promosi kedai baru'), 'request shows its payload fields')
  await req.locator('.combo-trigger').click()
  await p.locator('.combo-pop:not([hidden]) .combo-option', { hasText: 'Diproses' }).click()
  await req.getByLabel('Catatan untuk bisnis').fill('Kami hubungi lusa')
  await req.getByRole('button', { name: 'Simpan' }).click()
  await p.waitForFunction(() => !document.querySelector('.of-request'), null, { timeout: 8000 }).catch(() => {})
  t.check(await p.locator('.of-request').count() === 0, 'processed request leaves the Baru filter')
  await radio('Diproses').click()
  await p.locator('.of-request').first().waitFor({ timeout: 8000 })
  t.check(await p.locator('.of-request').count() === 1, 'Diproses filter lists it')

  await kolaborasi()
  await p.locator('.sm-request', { hasText: 'Diproses' }).first().waitFor({ timeout: 8000 })
  t.check((await p.locator('.sm-request').first().textContent()).includes('Kami hubungi lusa'), 'business sees Diproses and the admin note')
  await t.noErrors(p)
}

// E2E: Kantor Satu Alur (admin stage) on the mock cloud, where the demo user is an admin.
const { loginLive, goStage } = require('./lib.cjs')

module.exports = async function office(t) {
  const p = await t.page()
  await loginLive(p, t.base)
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

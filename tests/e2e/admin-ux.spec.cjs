// E2E: profile menu (business user + email admin), Kantor paging, admin SMTP transport,
// and "Cari dari peta" in the Permintaan wizard. Mock cloud; boss@contoh.id is an admin.
const { loginLive, goStage } = require('./lib.cjs')

module.exports = async function adminUx(t) {
  // ---------------------------------------------------------------- business user
  const p = await t.page()
  await loginLive(p, t.base, 'pemilik@usaha.id')
  const avatar = p.locator('.topbar .avatar-btn')
  t.check(await avatar.count() === 1 && await avatar.getAttribute('aria-haspopup') === 'menu', 'topbar avatar is a menu button')
  await avatar.click()
  const menu = p.getByRole('menu', { name: 'Menu akun' })
  await menu.waitFor({ timeout: 3000 })
  const labels = await menu.getByRole('menuitem').allTextContents()
  t.check(labels.join('|') === 'Profil saya|Paket & kuota|Pengaturan|Mode gelap|Keluar' || labels.join('|') === 'Profil saya|Paket & kuota|Pengaturan|Mode terang|Keluar', 'business menu items', labels.join('|'))
  t.check(await menu.locator('.pm-badge').textContent() === 'Live', 'business user badge: Live')
  t.check(await p.evaluate(() => document.activeElement?.getAttribute('role')) === 'menuitem', 'focus moves into the menu')
  await p.keyboard.press('ArrowDown')
  t.check(await p.evaluate(() => document.activeElement?.textContent) === 'Paket & kuota', 'ArrowDown moves to the next item')
  await p.keyboard.press('Escape')
  t.check(await menu.isHidden() && await p.evaluate(() => document.activeElement?.classList.contains('avatar-btn')), 'Escape closes and returns focus to the avatar')
  await avatar.click()
  await p.mouse.click(5, 400)
  t.check(await menu.isHidden(), 'outside click closes the menu')
  await avatar.click()
  await menu.getByRole('menuitem', { name: 'Paket & kuota' }).click()
  await p.waitForTimeout(500)
  t.check(await p.locator('.flow-item[aria-current="page"]').getAttribute('data-stage') === 'plan', '"Paket & kuota" opens the plan page')
  await avatar.click()
  await menu.getByRole('menuitem', { name: 'Profil saya' }).click()
  const dlg = p.getByRole('dialog', { name: 'Profil saya' })
  await dlg.waitFor({ timeout: 3000 })
  t.check(await dlg.getByLabel('Email').getAttribute('readonly') !== null, 'profile: email is read-only')
  await dlg.getByLabel('Nama tampilan').fill('Ibu Pemilik Usaha')
  await dlg.getByRole('button', { name: 'Simpan' }).click()
  await p.waitForTimeout(400)
  t.check(await dlg.isHidden() && (await p.locator('.side-user-name').textContent()) === 'Ibu Pemilik Usaha', 'profile: name saved and shown in the sidebar')

  // ---------------------------------------------------------- Cari dari peta (wizard)
  await goStage(p, 'request')
  await p.getByRole('button', { name: 'Cari dari peta' }).click()
  const mp = p.getByRole('dialog', { name: 'Cari pelanggan dari peta' })
  await mp.waitFor({ timeout: 3000 })
  await mp.getByLabel('Nama atau jenis usaha').fill('hotel')
  await mp.getByLabel('Kota atau area').fill('Bekasi')
  // While searching every control but "Batalkan pencarian" is locked.
  const lockState = () => mp.evaluate((d) => {
    const stop = d.querySelector('.mp-stop')
    const others = [...d.querySelectorAll('button')].filter((b) => b !== stop)
    return {
      allDisabled: others.length > 0 && others.every((b) => b.disabled),
      noneDisabled: others.every((b) => !b.disabled),
      stopShown: !!stop && !stop.hidden && !stop.disabled,
      inputsReadOnly: [...d.querySelectorAll('.mp-form input')].every((i) => i.readOnly),
      mapInert: d.querySelector('.mp-map').inert,
      busy: d.getAttribute('aria-busy'),
    }
  })
  await mp.getByRole('button', { name: 'Cari' }).click()
  let lk = await lockState()
  t.check(lk.allDisabled && lk.stopShown && lk.inputsReadOnly && lk.mapInert && lk.busy === 'true', 'map picker: buttons, inputs and map locked while searching', JSON.stringify(lk))
  await mp.getByRole('button', { name: 'Batalkan pencarian' }).click()
  await p.waitForTimeout(150)
  lk = await lockState()
  t.check(lk.noneDisabled && !lk.stopShown && !lk.inputsReadOnly && /dibatalkan/i.test(await mp.textContent()), 'map picker: cancelling the search unlocks the dialog', JSON.stringify(lk))
  await mp.getByRole('button', { name: 'Cari' }).click()
  await mp.getByRole('button', { name: 'Cari' }).click({ force: true, timeout: 500 }).catch(() => {})
  await mp.locator('.mp-item').first().waitFor({ timeout: 8000 })
  lk = await lockState()
  t.check(lk.noneDisabled && !lk.stopShown && lk.busy === 'false', 'map picker: everything re-enabled once results show', JSON.stringify(lk))
  const withEmail = mp.locator('.mp-item').filter({ has: p.locator('.mp-item-contacts', { hasText: /[^\s·]+@[^\s·]+\./ }) }).first()
  t.check(await withEmail.count() === 1 && (await mp.locator('.mp-item-desc').first().textContent()).length > 0, 'map picker: rows show description and contacts')
  const first = await withEmail.locator('strong').textContent()
  const rowEmail = (await withEmail.locator('.mp-item-contacts').textContent()).match(/[^\s·]+@[^\s·]+\.[^\s·]+/)[0]
  t.check(await mp.locator('.mp-item').count() > 0 && /peta terbuka/i.test(await mp.locator('.mp-note').textContent()) && /belum lengkap/i.test(await mp.locator('.mp-note').textContent()), 'map picker: results listed, open-map source and incompleteness noted')
  await withEmail.getByRole('button', { name: /^Pilih / }).click()
  await p.waitForTimeout(300)
  t.check(await mp.isHidden(), 'map picker closes after picking')
  t.check(await p.inputValue('input[name="customer_name"]') === first && (await p.inputValue('input[name="location"]')).length > 0, 'picked business fills name and location', first)
  t.check(await p.inputValue('input[name="email"]') === rowEmail, 'picked business fills email', rowEmail)
  t.check((await p.inputValue('textarea[name="description"]')).length > 0, 'picked business seeds the empty description')
  t.check(await p.locator('.req-picked').isVisible(), 'picked note shown')
  await p.getByRole('button', { name: 'Isi manual' }).click()
  t.check(await p.locator('.req-picked').isHidden() && await p.evaluate(() => document.activeElement?.name) === 'customer_name', '"Isi manual" focuses the name field')
  await t.shot?.(p, 'ux-wizard')
  await p.close()

  // ------------------------------------------------------------------- email admin
  const a = await t.page()
  await loginLive(a, t.base, 'boss@contoh.id')
  // Seed 25 Kantor requests so the list needs more than one page.
  await a.evaluate(() => {
    const key = 'satualur_social_demo_v1'
    const s = JSON.parse(localStorage.getItem(key) || 'null') || { seq: 100, account: null, posts: [], requests: [], influencers: [] }
    s.influencers = s.influencers || []
    s.requests = s.requests || []
    for (let i = 0; i < 25; i++) {
      s.requests.push({ id: 5000 + i, owner_id: 'x', kind: 'ads', influencer_id: null, influencer_name: null, payload: { service: `Layanan ${i}`, location: 'Bandung' }, status: 'new', admin_note: '', created_at: new Date(Date.now() - i * 60000).toISOString(), updated_at: new Date().toISOString() })
    }
    localStorage.setItem(key, JSON.stringify(s))
  })
  const av = a.locator('.topbar .avatar-btn')
  await av.click()
  const am = a.getByRole('menu', { name: 'Menu akun' })
  t.check(await am.locator('.pm-badge').textContent() === 'Admin' && await am.getByRole('menuitem', { name: 'Kantor Satu Alur' }).count() === 1, 'admin menu: Admin badge and "Kantor Satu Alur"')
  await am.getByRole('menuitem', { name: 'Kantor Satu Alur' }).click()
  await a.waitForSelector('.flow-item[data-stage="sys-overview"]', { timeout: 8000 })
  await a.locator('.topbar .avatar-btn').click()
  t.check(await a.getByRole('menu', { name: 'Menu akun' }).getByRole('menuitem', { name: 'Kembali ke usaha saya' }).count() === 1, 'in Kantor the menu offers "Kembali ke usaha saya"')
  await a.keyboard.press('Escape')

  // Kantor › Permintaan: server-side pager, 20 per page
  await a.click('.flow-item[data-stage="requests"]')
  await a.locator('.of-request').first().waitFor({ timeout: 8000 })
  const page1 = await a.locator('.of-request').count()
  const pager = a.getByRole('navigation', { name: 'Halaman daftar permintaan' })
  t.check(page1 === 20 && await pager.isVisible(), 'Kantor Permintaan: 20 rows and a pager', String(page1))
  const firstId = await a.locator('.of-request').first().getAttribute('data-id')
  await pager.getByRole('button', { name: 'Halaman 2' }).click()
  await a.waitForTimeout(500)
  const page2 = await a.locator('.of-request').count()
  t.check(page2 >= 5 && await a.locator('.of-request').first().getAttribute('data-id') !== firstId, 'page 2 shows the remaining requests', String(page2))
  await t.shot?.(a, 'ux-kantor-requests')

  // Sistem › Email: platform SMTP transport
  await a.click('.flow-item[data-stage="sys-email"]')
  await a.getByText('Transport email platform').first().waitFor({ timeout: 8000 })
  await a.getByRole('radio', { name: 'SMTP kustom' }).click()
  await a.getByLabel('Host SMTP').fill('smtp.resend.com')
  await a.getByLabel('Username').fill('resend')
  await a.getByLabel('Password').fill('re_rahasia_1234')
  await a.getByLabel('Email pengirim').fill('noreply@apipedia.id')
  await a.getByRole('button', { name: 'Pakai transport ini' }).click()
  await a.waitForTimeout(400)
  const st = await a.evaluate(() => JSON.parse(localStorage.getItem('satualur_system_demo_v1') || '{}').transport)
  t.check(st?.mode === 'smtp' && st.host === 'smtp.resend.com' && st.pass_last4 === '1234', 'admin SMTP transport saved', JSON.stringify(st))
  t.check(/Tersimpan • …1234/.test(await a.locator('.field-hint', { hasText: 'Tersimpan' }).textContent()) && await a.getByLabel('Password').inputValue() === '', 'password cleared and shown only as last 4')
  await a.getByRole('button', { name: 'Kirim email uji' }).click()
  await a.getByText(/lewat SMTP platform/).waitFor({ timeout: 5000 }).catch(() => {})
  t.check(await a.getByText(/lewat SMTP platform/).count() === 1, 'test email goes through the platform SMTP (simulated)')

  // Sistem › Mesin AI: platform provider (simulated list, test, then save)
  await a.click('.flow-item[data-stage="sys-ai"]')
  await a.getByText('Penyedia AI platform').first().waitFor({ timeout: 8000 })
  await a.getByRole('radio', { name: 'Anthropic-compatible' }).click()
  t.check(await a.getByLabel('Alamat API').inputValue() === 'https://api.anthropic.com', 'Anthropic default base URL filled')
  await a.getByLabel('API key').fill('sk-ant-demo-9876')
  await a.getByRole('button', { name: 'Ambil daftar model' }).click()
  await a.getByText(/model ditemukan/).waitFor({ timeout: 5000 })
  await a.getByRole('combobox', { name: 'Pilih dari daftar model' }).click()
  await a.locator('.combo-pop:not([hidden]) .combo-option', { hasText: 'claude-sonnet-4-5' }).click()
  t.check(await a.getByLabel('Model', { exact: true }).inputValue() === 'claude-sonnet-4-5', 'picking from the model list fills the model')
  await a.getByRole('button', { name: 'Uji', exact: true }).click()
  await a.getByText(/menjawab "OK \(simulasi\)"/).waitFor({ timeout: 5000 })
  await a.getByRole('button', { name: 'Simpan penyedia' }).click()
  await a.waitForTimeout(400)
  const ap = await a.evaluate(() => JSON.parse(localStorage.getItem('satualur_system_demo_v1') || '{}').aiProvider)
  t.check(ap?.mode === 'anthropic' && ap.model === 'claude-sonnet-4-5' && ap.key_last4 === '9876' && !JSON.stringify(ap).includes('sk-ant'), 'platform AI provider saved after a passing test', JSON.stringify(ap))
  await t.shot?.(a, 'ux-ai-provider')
  await t.noErrors(a)
  await a.close()

  // ------------------------------------------------------------- mobile profile menu
  const m = await t.page({ width: 360, height: 800 })
  await loginLive(m, t.base, 'pemilik@usaha.id')
  await goStage(m, 'request')
  const gap = await m.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect()
    const cta = r('.topbar-cta'); const av = r('.topbar .avatar-btn'); const th = r('.topbar .theme-toggle'); const cr = r('.crumb')
    return { ctaAv: av.left - cta.right, thCta: cta.left - th.right, crTh: th.left - cr.right, right: av.right }
  })
  t.check(gap.ctaAv >= 4 && gap.thCta >= 4 && gap.crTh >= 0 && gap.right <= 360, 'mobile 360px: topbar CTA, theme and avatar do not overlap', JSON.stringify(gap))
  await m.locator('.topbar .avatar-btn').click()
  const mm = m.getByRole('menu', { name: 'Menu akun' })
  await mm.waitFor({ timeout: 3000 })
  const box = await mm.boundingBox()
  t.check(box && box.x >= 0 && box.x + box.width <= 360, 'mobile: profile menu fits the screen', JSON.stringify(box))
  t.check(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile: no horizontal scroll with the menu open')
  await t.shot?.(m, 'ux-profile-menu')
  await t.noErrors(m)
}

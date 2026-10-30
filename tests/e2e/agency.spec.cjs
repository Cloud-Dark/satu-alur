// E2E: Agensi influencer campaigns on the mock cloud. Business A, staff and business B are pages in one
// context (one demo store, three in-memory sessions), like support.spec.
const { loginLive, goStage } = require('./lib.cjs')

async function samePage(page) {
  const p = await page.context().newPage()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(String(e)))
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()) })
  return p
}
// Selects are enhanced into a combobox; set the native value like support.spec does.
const pick = (loc, value) => loc.evaluate((sel, v) => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })) }, value)
const kolaborasi = async (p) => {
  await goStage(p, 'dashboard')
  await goStage(p, 'social-media')
  await p.getByRole('radio', { name: 'Kolaborasi', exact: true }).click()
  await p.waitForSelector('.sm-inf-card')
}
const LINK = 'https://instagram.com/p/demo1'
const FEE = ['9750000', '9.750.000']
const PAYOUT = ['1234567', '1.234.567']

module.exports = async function agency(t) {
  // business A sends a collab request
  const a = await t.page()
  await loginLive(a, t.base, 'pemilik@usaha.id')
  await kolaborasi(a)
  await a.locator('.sm-inf-card').first().getByRole('button', { name: 'Ajukan kolaborasi' }).click()
  const cd = a.getByRole('dialog', { name: /Ajukan kolaborasi/ })
  await cd.getByLabel('Ceritakan kampanye Anda').fill('Promosi kedai A')
  await cd.getByLabel('Kisaran anggaran').fill('Rp5-10 juta')
  await cd.getByLabel('Waktu kampanye').fill('Desember 2026')
  await cd.getByRole('button', { name: 'Kirim permintaan' }).click()
  await cd.waitFor({ state: 'hidden' })
  await a.locator('.sm-request', { hasText: 'Baru' }).first().waitFor({ timeout: 8000 })
  t.check(await a.getByRole('button', { name: 'Lihat progres' }).count() === 0, 'business: no "Lihat progres" before a campaign exists')

  // staff: Permintaan › Buat kampanye (double-click → one campaign)
  const s = await samePage(a)
  await s.goto(`${t.base}/super-admin-login`, { waitUntil: 'load' })
  await s.waitForSelector('#staff-username')
  await s.fill('#staff-username', 'staff')
  await s.fill('#staff-password', 'rahasia-staf-123')
  await s.getByRole('button', { name: 'Masuk' }).click()
  await s.waitForSelector('.side .flow-item[data-stage="campaigns"]')
  t.check(await s.locator('.flow-item[data-stage="campaigns"] .flow-name', { hasText: 'Kampanye' }).count() === 1 && await s.locator('.side-label', { hasText: 'Agensi Influencer' }).count() === 1, 'staff: Kampanye is in the Agensi influencer group')
  await s.getByRole('button', { name: 'Permintaan', exact: true }).click()
  const req = s.locator('.of-request', { hasText: 'Promosi kedai A' })
  await req.waitFor({ timeout: 8000 })
  await req.getByRole('button', { name: 'Buat kampanye' }).dblclick()
  const dlg = s.getByRole('dialog')
  await dlg.waitFor({ timeout: 8000 })
  await s.waitForTimeout(400)
  const count = await s.evaluate(() => JSON.parse(localStorage.getItem('satualur_agency_demo_v1')).campaigns.length)
  t.check(count === 1, 'double-click on "Buat kampanye" creates exactly one campaign', count)
  t.check(await s.getByRole('dialog').count() === 1, 'one editor opens')
  t.check(await dlg.getByLabel('Judul').inputValue() === 'Promosi kedai A', 'editor: title taken from the request')
  const aulia = dlg.locator('.ag-inf', { hasText: 'Aulia Rahma' })
  t.check(await aulia.count() === 1, 'editor: the requested influencer is pre-assigned')

  // header: client fee; influencer payout; summary line
  await dlg.getByLabel('Biaya klien (Rp)').fill(FEE[0])
  await dlg.getByRole('button', { name: 'Simpan kampanye' }).click()
  await s.getByText('Kampanye tersimpan.').first().waitFor({ timeout: 8000 })
  await aulia.getByLabel('Bayaran (Rp)').fill(PAYOUT[0])
  await aulia.getByRole('button', { name: 'Simpan bayaran' }).click()
  await dlg.locator('.ag-summary', { hasText: 'Bayaran Rp 1.234.567' }).waitFor({ timeout: 8000 }).catch(() => {})
  const sum = (await dlg.locator('.ag-summary').textContent()).replace(/\s/g, ' ')
  t.check(/Biaya klien Rp\s?9\.750\.000 · Bayaran Rp\s?1\.234\.567 · Margin Rp\s?8\.515\.433/.test(sum), 'summary: fee, payout and margin', sum)

  // add a second influencer from the catalogue
  const addSel = dlg.locator('select[id^="ag-add-inf-"]')
  const opts = await addSel.locator('option').allTextContents()
  t.check(!opts.includes('Aulia Rahma') && opts.includes('Bima Pratama'), 'add list: catalogue minus the assigned influencer', opts.join(','))
  await pick(addSel, await addSel.locator('option', { hasText: 'Bima Pratama' }).getAttribute('value'))
  await dlg.getByRole('button', { name: 'Tambahkan' }).click()
  await dlg.locator('.ag-inf', { hasText: 'Bima Pratama' }).waitFor({ timeout: 8000 })
  t.check(await dlg.locator('.ag-inf').count() === 2, 'second influencer added')
  const bima = dlg.locator('.ag-inf', { hasText: 'Bima Pratama' })
  await bima.getByLabel('Bayaran (Rp)').fill('555000') // left unsaved while other rows save

  // two deliverables for Aulia; published needs a link
  for (const kind of ['reel', 'story']) {
    await dlg.getByRole('button', { name: 'Tambah konten untuk Aulia Rahma' }).click()
    const row = dlg.locator('.ag-del.is-new').last()
    await pick(row.locator('select[data-k=kind]'), kind)
    await row.getByLabel('Tenggat').fill('2026-12-05')
    await row.getByRole('button', { name: 'Simpan' }).click()
    await dlg.locator('.ag-del.is-new').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  }
  const dels = dlg.locator('.ag-group', { hasText: 'Aulia Rahma' }).locator('.ag-del')
  t.check(await dels.count() === 2, 'two deliverables listed under Aulia Rahma', await dels.count())
  t.check(await bima.getByLabel('Bayaran (Rp)').inputValue() === '555000', 'unsaved payout in another row survives deliverable saves')
  // header save keeps unsaved rows (a new deliverable row and the unsaved payout)
  await dlg.getByRole('button', { name: 'Tambah konten untuk Aulia Rahma' }).click()
  await dlg.getByLabel('Brief').fill('Brief baru')
  await dlg.getByRole('button', { name: 'Simpan kampanye' }).click()
  await s.waitForTimeout(600)
  t.check(await dlg.locator('.ag-del.is-new').count() === 1 && await bima.getByLabel('Bayaran (Rp)').inputValue() === '555000', 'header save keeps unsaved row edits')
  await dlg.locator('.ag-del.is-new').getByRole('button', { name: 'Batal' }).click()
  // a structural change (remove an influencer) asks first while another row has unsaved edits
  let askedRemove = false
  s.once('dialog', (d) => { askedRemove = true; d.dismiss() })
  await aulia.getByRole('button', { name: 'Hapus Aulia Rahma dari kampanye' }).click()
  await s.waitForTimeout(300)
  t.check(askedRemove && await bima.getByLabel('Bayaran (Rp)').inputValue() === '555000' && await dlg.locator('.ag-inf').count() === 2, 'remove with another row unsaved: asks first; cancel keeps everything')
  // a failed refresh after a save keeps the rows and their unsaved values, and says so in a toast
  const second = dels.nth(1)
  await second.getByLabel('Catatan').fill('draf belum disimpan')
  await s.evaluate(() => localStorage.setItem('satualur_agency_fail', '1'))
  await bima.getByRole('button', { name: 'Simpan bayaran' }).click()
  await s.getByText('Gagal memuat kampanye. Coba lagi.').first().waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await s.getByText('Gagal memuat kampanye. Coba lagi.').count() >= 1 && await second.getByLabel('Catatan').inputValue() === 'draf belum disimpan'
    && await dlg.locator('.ag-inf').count() === 2 && await dlg.locator('.ag-del').count() === 2, 'failed refresh after a save: toast, rows and unsaved values kept')
  await s.evaluate(() => localStorage.removeItem('satualur_agency_fail'))
  await second.getByLabel('Catatan').fill('')
  // Enter in a row saves that row, not the campaign header
  await dlg.getByLabel('Brief').fill('Brief belum disimpan')
  await bima.getByLabel('Bayaran (Rp)').fill('600000')
  await bima.getByLabel('Bayaran (Rp)').press('Enter')
  await s.waitForTimeout(600)
  const stored = await s.evaluate(() => { const a = JSON.parse(localStorage.getItem('satualur_agency_demo_v1')); return { brief: a.campaigns[0].brief, pay: a.links.find((l) => l.influencer_id === 2)?.payout_idr } })
  t.check(stored.pay === 600000 && stored.brief === 'Brief baru' && await s.getByRole('dialog').count() === 1, 'Enter in a payout row saves that row only (header untouched, editor open)', JSON.stringify(stored))
  await dlg.getByLabel('Brief').fill('Brief baru')
  const first = dels.first()
  await pick(first.locator('select[data-k=status]'), 'published')
  await first.getByRole('button', { name: 'Simpan' }).click()
  await first.locator('.field-error', { hasText: 'Tambahkan tautan konten yang sudah tayang.' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await first.locator('.field-error').textContent() === 'Tambahkan tautan konten yang sudah tayang.', 'published without a link is refused')
  await first.getByLabel('Tautan').fill(LINK)
  await first.getByLabel('Catatan').fill('catatan internal staf')
  await first.getByRole('button', { name: 'Simpan' }).click()
  await s.getByText('Konten tersimpan.').first().waitFor({ timeout: 8000 })
  t.check(await dlg.locator('.ag-del select[data-k=status]').evaluateAll((x) => x.map((n) => n.value).join(',')) === 'published,planned', 'statuses saved: Tayang + Direncanakan')

  // removing an influencer that still has deliverables is refused
  await aulia.getByRole('button', { name: 'Hapus Aulia Rahma dari kampanye' }).click()
  await aulia.locator('.field-error', { hasText: 'Hapus atau pindahkan' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await aulia.locator('.field-error').textContent() === 'Hapus atau pindahkan konten influencer ini terlebih dahulu.', 'remove with deliverables: refused with the message')
  await dlg.locator('.ag-inf', { hasText: 'Bima Pratama' }).getByRole('button', { name: 'Hapus Bima Pratama dari kampanye' }).click()
  await dlg.locator('.ag-inf', { hasText: 'Bima Pratama' }).waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  t.check(await dlg.locator('.ag-inf').count() === 1, 'an influencer without deliverables can be removed')

  // dirty guard: an unsaved title asks before closing
  await dlg.getByLabel('Judul').fill('Judul belum disimpan')
  let asked = false
  s.once('dialog', (d) => { asked = true; d.dismiss() })
  await dlg.getByRole('button', { name: 'Tutup' }).click()
  await s.waitForTimeout(200)
  t.check(asked && await s.getByRole('dialog').count() === 1, 'unsaved title: closing asks first')
  await dlg.getByLabel('Judul').fill('Promosi kedai A')
  await dlg.getByRole('button', { name: 'Tutup' }).click()
  await dlg.waitFor({ state: 'hidden' })
  await s.waitForTimeout(400)
  t.check(await req.count() === 0, 'the request moved out of Baru (now Diproses)')
  await s.getByRole('radio', { name: 'Diproses', exact: true }).click()
  await req.getByRole('button', { name: 'Lihat kampanye' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await req.getByRole('button', { name: 'Lihat kampanye' }).count() === 1 && await req.getByRole('button', { name: 'Buat kampanye' }).count() === 0, 'request card now offers "Lihat kampanye"')
  await s.getByRole('button', { name: 'Kampanye', exact: true }).click()
  await s.locator('.ag-campaign', { hasText: 'Promosi kedai A' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await s.locator('.ag-campaign', { hasText: 'Promosi kedai A' }).count() === 1, 'Kampanye section lists the campaign')

  // while the campaign is a draft the business sees nothing
  await kolaborasi(a)
  await a.locator('.sm-request', { hasText: 'Promosi kedai A' }).waitFor({ timeout: 8000 })
  await a.waitForTimeout(300)
  t.check(await a.getByRole('button', { name: 'Lihat progres' }).count() === 0, 'draft campaign: business sees no "Lihat progres"')
  // staff sets it to Berjalan
  await s.locator('.ag-campaign', { hasText: 'Promosi kedai A' }).click()
  const dlg2 = s.getByRole('dialog')
  await dlg2.getByLabel('Judul').waitFor({ timeout: 8000 })
  await dlg2.locator('.ag-inf').first().waitFor({ timeout: 8000 })
  await pick(dlg2.locator('select[id^="ag-status-"]'), 'active')
  await dlg2.getByRole('button', { name: 'Simpan kampanye' }).click()
  await s.waitForFunction(() => JSON.parse(localStorage.getItem('satualur_agency_demo_v1')).campaigns[0].status === 'active', null, { timeout: 8000 }).catch(() => {})
  await dlg2.getByRole('button', { name: 'Tutup' }).click()
  await dlg2.waitFor({ state: 'hidden' })

  // business A: Lihat progres shows the projection, never money or notes
  await kolaborasi(a)
  const mine = a.locator('.sm-request', { hasText: 'Promosi kedai A' })
  await mine.getByRole('button', { name: 'Lihat progres' }).click()
  const prog = mine.locator('.sm-progress')
  await prog.locator('.ag-check li').first().waitFor({ timeout: 8000 }).catch(() => {})
  const text = await prog.textContent()
  t.check(text.includes('Promosi kedai A') && text.includes('Berjalan') && text.includes('Aulia Rahma'), 'progress: title, status and influencer name', text.slice(0, 200))
  t.check(await prog.locator('.ag-check li').count() === 2 && text.includes('Tayang') && text.includes('Direncanakan'), 'progress: checklist with both statuses')
  const link = prog.getByRole('link', { name: 'Lihat konten ↗' })
  t.check(await link.count() === 1 && await link.getAttribute('href') === LINK && await link.getAttribute('rel') === 'noopener noreferrer' && await link.getAttribute('target') === '_blank', 'progress: the published link opens safely in a new tab')
  const html = await a.content()
  t.check(![...FEE, ...PAYOUT, 'catatan internal staf'].some((x) => html.includes(x)), 'business DOM has no fee, payout or staff note')
  await a.setViewportSize({ width: 360, height: 800 })
  await a.waitForTimeout(300)
  t.check(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '360px: progress view has no horizontal scroll')

  // business B: neither the request nor its campaign
  const b = await samePage(a)
  await loginLive(b, t.base, 'lain@usaha.id')
  await kolaborasi(b)
  await b.waitForTimeout(500)
  t.check(await b.locator('.sm-request').count() === 0, 'business B: A\'s request is not listed')
  const rid = await b.evaluate(() => JSON.parse(localStorage.getItem('satualur_social_demo_v1')).requests[0].id)
  const res = await b.evaluate((id) => import('/src/agency/api.js').then((m) => m.getRequestCampaign(id)).then(() => 'terlihat', (e) => e.message), rid)
  t.check(res === 'Kampanye tidak ditemukan.', 'business B: A\'s campaign reads as not found', res)

  await t.noErrors(a, 'business A: no page errors')
  await t.noErrors(s, 'staff: no page errors')
}

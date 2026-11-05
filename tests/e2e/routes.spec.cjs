// E2E: every app page has its own URL (#/app/…, src/ui/routes.js). Clicking around changes the
// address, Back/Forward follow it, deep links open the page with its filters, a reload (which
// signs a mock session out) comes back to the same page after logging in, and the one-job stage
// pages show only that job.
const { loginLive, goHash, norm } = require('./lib.cjs')

const hash = (p) => p.evaluate(() => location.hash)
const crumb = (p) => p.textContent('.crumb-title').then(norm)
const waitHash = (p, re, timeout = 8000) => p.waitForFunction((src) => new RegExp(src).test(location.hash), re.source, { timeout }).catch(() => {})

module.exports = async function routes(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  t.check(await hash(p) === '#/app' && await crumb(p) === 'Ringkasan', 'Ringkasan lives at #/app', await hash(p))

  // Sidebar: Alur kerja gets its own URL.
  await p.click('.flow-item[data-stage="workflow"]')
  await p.waitForSelector('.wf-row', { timeout: 15000 })
  t.check(await hash(p) === '#/app/alur-kerja', 'sidebar "Alur kerja" -> #/app/alur-kerja', await hash(p))

  // Filter and search are in the URL (replaced, not new history entries).
  await p.click('.wf-filter[data-filter="offer"]')
  await p.waitForTimeout(200)
  t.check(await hash(p) === '#/app/alur-kerja?posisi=offer', 'filter -> ?posisi=offer', await hash(p))
  await p.fill('.wf-panel input[type=search]', 'pt maju')
  await p.waitForTimeout(200)
  t.check(await hash(p) === '#/app/alur-kerja?posisi=offer&q=pt%20maju', 'search -> &q=pt%20maju', await hash(p))
  await p.fill('.wf-panel input[type=search]', '')
  await p.waitForTimeout(200)

  // Job detail dialog: its own URL; closing returns to the list URL; Forward reopens it.
  const firstId = await p.locator('.wf-row').first().getAttribute('data-id')
  await p.locator('.wf-row').first().locator('.wf-open').click()
  await p.waitForSelector('dialog.wf-detail[open]')
  t.check(await hash(p) === `#/app/alur-kerja/${firstId}?posisi=offer`, 'detail dialog -> #/app/alur-kerja/<id>', await hash(p))
  await p.keyboard.press('Escape')
  await waitHash(p, /^#\/app\/alur-kerja\?posisi=offer$/)
  t.check(await hash(p) === '#/app/alur-kerja?posisi=offer' && await p.locator('dialog[open]').count() === 0, 'closing the dialog returns to #/app/alur-kerja?posisi=offer', await hash(p))
  await p.goForward()
  await p.waitForSelector('dialog.wf-detail[open]', { timeout: 8000 }).catch(() => {})
  t.check(await p.locator(`dialog.wf-detail[open][data-id="${firstId}"]`).count() === 1, 'Forward reopens the same job detail')
  await p.goBack()
  await p.waitForTimeout(500)
  t.check(await p.locator('dialog[open]').count() === 0 && await hash(p) === '#/app/alur-kerja?posisi=offer' && await p.locator('.wf-row').count() > 0, 'Back closes it again, the table stays')

  // Next step -> one offer, at #/app/penawaran/<id> (a draft) or the wizard for the request.
  const row = p.locator('.wf-row[data-position="draft"]').first()
  const name = norm(await row.locator('.wf-open').textContent()).replace(/^#\d+\s*/, '')
  await row.locator('.wf-next').click()
  await waitHash(p, /^#\/app\/penawaran\/\d+$/)
  const offerHash = await hash(p)
  t.check(/^#\/app\/penawaran\/\d+$/.test(offerHash) && await crumb(p) === 'Penawaran', '"Tinjau penawaran" -> #/app/penawaran/<id>', offerHash)
  await p.waitForSelector('.view .job-head-name')
  t.check(norm(await p.textContent('.view .job-head-name')) === name && /#\d+/.test(await p.textContent('.view .job-head-id')), 'offer page names the job (customer + #id)', name)
  t.check(await p.locator('.view .offer-detail').count() === 1 && await p.locator('.view .list-panel, .view .wiz-panel').count() === 0, 'offer page shows only that offer (no list, no wizard)')
  t.check(await p.getByRole('button', { name: 'Setujui' }).count() === 1 && await p.getByRole('button', { name: 'Email' }).count() === 1, 'draft offer: Setujui and Email actions')

  // Back / Forward between pages.
  await p.goBack()
  await p.waitForSelector('.wf-row', { timeout: 10000 })
  t.check(await hash(p) === '#/app/alur-kerja?posisi=offer' && await crumb(p) === 'Alur kerja' && await p.locator('.wf-filter[data-filter="offer"]').getAttribute('aria-pressed') === 'true', 'Back returns to Alur kerja with the filter')
  await p.goForward()
  await p.waitForSelector('.view .offer-detail', { timeout: 10000 }).catch(() => {})
  t.check(await hash(p) === offerHash && await p.locator('.view .offer-detail').count() === 1, 'Forward opens the offer again')

  // Settings drawer has a URL; closing it goes back to the page.
  await p.getByRole('button', { name: 'Pengaturan' }).first().click()
  await p.waitForTimeout(400)
  t.check(await hash(p) === '#/app/pengaturan' && await p.locator('.drawer.is-open').count() === 1, 'Pengaturan -> #/app/pengaturan')
  await p.keyboard.press('Escape')
  await waitHash(p, /^#\/app\/penawaran\/\d+$/)
  t.check(await hash(p) === offerHash && await p.locator('.view .offer-detail').count() === 1, 'closing Pengaturan returns to the offer URL, page kept')

  // Deep link from outside the app (full render): filters applied.
  await goHash(p, '#/')
  await p.waitForSelector('.lp-hero')
  await goHash(p, '#/app/alur-kerja?posisi=offer')
  await p.waitForSelector('.wf-row', { timeout: 15000 })
  const positions = await p.$$eval('.wf-row', (r) => r.map((x) => x.dataset.position))
  t.check(await p.locator('.wf-filter[data-filter="offer"]').getAttribute('aria-pressed') === 'true' && positions.every((x) => x === 'draft' || x === 'rejected'), 'deep link ?posisi=offer filters the table', positions.join())
  // In-app link to another page.
  await goHash(p, '#/app/laporan')
  t.check(await crumb(p) === 'Laporan', '#/app/laporan opens Laporan')
  await goHash(p, '#/app/tidak-ada/9')
  t.check(await crumb(p) === 'Ringkasan' && await hash(p) === '#/app', 'unknown route falls back to Ringkasan at #/app', await hash(p))
  await goHash(p, `#/app/alur-kerja/${firstId}`)
  await p.waitForSelector('dialog.wf-detail[open]', { timeout: 10000 }).catch(() => {})
  t.check(await p.locator(`dialog.wf-detail[open][data-id="${firstId}"]`).count() === 1, 'deep link #/app/alur-kerja/<id> opens that job detail')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  t.check(/^#\/app\/alur-kerja(\?|$)/.test(await hash(p)) && await p.locator('dialog[open]').count() === 0, 'closing it leaves #/app/alur-kerja', await hash(p))

  // Permintaan baru: the form only.
  await p.click('.flow-item[data-stage="workflow"]')
  await p.waitForTimeout(500)
  await p.getByRole('button', { name: 'Permintaan baru' }).first().click()
  await p.waitForTimeout(600)
  t.check(await hash(p) === '#/app/permintaan/baru', 'topbar "Permintaan baru" -> #/app/permintaan/baru', await hash(p))
  t.check(await p.locator('.view .wiz-panel').count() === 1 && await p.locator('.view .list-panel').count() === 0 && await p.getByText('Daftar permintaan').count() === 0, 'request page: the wizard without the request list')
  t.check(await p.getByRole('button', { name: 'Lihat semua di Alur kerja' }).count() === 1, 'request page links to Alur kerja')
  const box = await p.locator('.view .wiz-panel').boundingBox()
  t.check(box && box.width >= 500 && box.width <= 800, 'request form at a comfortable width', JSON.stringify(box))

  // A plain #/app reopens the last page of the tab.
  await goHash(p, '#/')
  await p.waitForSelector('.lp-hero')
  await goHash(p, '#/app')
  t.check(await crumb(p) === 'Permintaan' && await hash(p) === '#/app/permintaan/baru', 'plain #/app reopens the last page (Permintaan) with its URL', await hash(p))

  // Reload: the mock session ends, login comes back to the same offer.
  await goHash(p, offerHash)
  await p.waitForSelector('.view .offer-detail', { timeout: 10000 })
  await p.reload({ waitUntil: 'load' })
  await p.waitForFunction(() => location.hash.startsWith('#/masuk') || document.querySelector('.app-shell'), null, { timeout: 10000 })
  if (await p.locator('.app-shell').count() === 0) {
    await p.waitForSelector('#auth-email')
    await p.fill('#auth-email', 'qa@satualur.id')
    await p.click('.auth-form-email button[type=submit]')
    await p.waitForSelector('.auth-demo:not([hidden])', { timeout: 10000 })
    await p.click('.auth-demo-fill')
  }
  await p.waitForSelector('.view .offer-detail', { timeout: 15000 }).catch(() => {})
  t.check(await hash(p) === offerHash && norm(await p.textContent('.view .job-head-name').catch(() => '')) === name, 'reload (login again) reopens the same offer', await hash(p))

  // Office routes stay closed to a business account.
  await goHash(p, '#/app/kantor/kontak')
  t.check(await crumb(p) === 'Ringkasan' && await p.locator('.flow-item[data-stage="contact"]').count() === 0, 'business user: #/app/kantor/… falls back to Ringkasan')

  await t.noErrors(p)
}

// E2E: full six-stage flow through the wizards (mock AI):
// Permintaan -> Penawaran AI (stream, rule check, save) -> Penugasan -> Penyelesaian
// -> Pembukuan (pendapatan + biaya) -> Laporan "Jelaskan dengan AI" (+ stop) -> Ringkasan.
// Adapted from the ad-hoc wiz-flow.cjs. TC-REQ/OFR/ASG/CMP/BKP/RPT-*, FR-010..FR-016.
const { loginLive, goStage, kpiValue, norm } = require('./lib.cjs')

const CUSTOMER = 'CV Uji Alur E2E'

module.exports = async function flow(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  const step = () => p.$eval('.wiz-pane:not([hidden])', (x) => x.dataset.step).catch(() => null)
  const primary = () => p.click('.wiz-primary', { timeout: 8000 })
  const done = () => p.waitForSelector('.wiz-done:not([hidden])', { timeout: 15000 })
  const rowsWith = (text) => p.$$eval('.list-panel tbody tr', (r, s) => r.filter((x) => x.textContent.includes(s)).map((x) => x.textContent.replace(/\s+/g, ' ')), text)
  const errorsShown = () => p.$$eval('.field-error', (e) => e.filter((x) => x.offsetParent !== null && x.textContent.trim()).map((x) => x.textContent.trim()))

  /* ---- 01 Permintaan ---- */
  await goStage(p, 'request')
  t.check(await step() === 'customer', 'request wizard starts at step "customer"', await step())
  await primary()
  await p.waitForTimeout(200)
  const reqErr = await errorsShown()
  t.check(reqErr.length > 0, 'empty customer name -> inline error', reqErr.join('; '))
  t.check(await p.evaluate(() => document.activeElement?.name) === 'customer_name', 'focus moves to the invalid field')
  await p.fill('input[name="customer_name"]', CUSTOMER)
  await p.fill('input[name="location"]', 'Bekasi')
  await p.fill('input[name="phone"]', '0812 7777 1234')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(400)
  t.check(await step() === 'need', 'Enter submits step 1 -> step "need"', await step())
  await p.fill('input[name="service_type"]', 'Servis AC kantor')
  await p.fill('textarea[name="description"]', 'Servis 8 unit AC split 1 PK di kantor dua lantai, termasuk isi freon bila perlu. Dikerjakan hari Sabtu.')
  await primary()
  t.check(await step() === 'review', 'step "review" shown')
  const review = norm(await p.textContent('.wiz-pane:not([hidden])'))
  t.check(review.includes(CUSTOMER) && review.includes('0812 7777 1234') && review.includes('Bekasi'), 'review shows entered data (name, phone, location)')
  await primary()
  await done()
  t.check((await rowsWith(CUSTOMER)).length === 1, 'new request appears in the list')
  await p.click('.wiz-done-actions .btn-primary') // Buat penawaran
  await p.waitForTimeout(900)

  /* ---- 02 Penawaran AI ---- */
  t.check(await step() === 'compose', 'offer opens on "compose" with the new request preselected', await step())
  const selLabel = norm(await p.textContent('.combo-trigger').catch(() => ''))
  t.check(selLabel.includes(CUSTOMER), 'request combobox preselected', selLabel)
  await primary() // Hasilkan penawaran
  await p.waitForTimeout(400)
  t.check(await p.locator('.console').count() >= 1, 'AI console appears while streaming')
  await p.waitForFunction(() => document.querySelector('.wiz-pane:not([hidden])')?.dataset.step === 'review', null, { timeout: 30000 })
  t.check(true, 'AI proposal streamed and reached review')
  const price0 = await p.inputValue('input[name="validated_price"]')
  t.check(Number(price0) >= 10000, 'AI price prefilled in "Harga final"', price0)
  await p.click('.raw-json summary').catch(() => {})
  t.check(/"scope"/.test(await p.textContent('.raw-json').catch(() => '')), 'raw JSON available for inspection')
  await p.fill('input[name="validated_price"]', '100')
  await p.waitForTimeout(150)
  t.check(await p.$eval('.wiz-primary', (b) => b.disabled), 'price Rp100 violates rule -> save disabled')
  t.check(await p.locator('.chip.is-bad').count() >= 1, 'failing rule highlighted')
  await p.fill('input[name="validated_price"]', '1750000')
  await p.waitForTimeout(150)
  t.check(!(await p.$eval('.wiz-primary', (b) => b.disabled)), 'valid price re-enables save')
  await primary()
  await done()
  const offerRows = await rowsWith(CUSTOMER)
  t.check(offerRows.length === 1 && /Disetujui/.test(offerRows[0]) && /1\.750\.000/.test(offerRows[0]), 'saved offer listed as Disetujui with Rp1.750.000', offerRows[0])
  await p.click('.wiz-done-actions .btn-primary') // Tugaskan pekerja
  await p.waitForTimeout(900)

  /* ---- 03 Penugasan ---- */
  t.check(await step() === 'who', 'assign opens on "who" with the offer preselected', await step())
  await primary()
  await p.waitForTimeout(200)
  t.check((await errorsShown()).length > 0, 'empty worker -> inline error')
  await p.fill('input[name="worker_name"]', 'Rudi & Tim')
  await primary()
  t.check(await step() === 'confirm', 'assign step "confirm"')
  await primary()
  await done()
  t.check((await rowsWith('Rudi & Tim')).length >= 1, 'assignment listed')
  await p.click('.wiz-done-actions .btn-primary')
  await p.waitForTimeout(900)

  /* ---- 04 Penyelesaian ---- */
  t.check(await step() === 'notes', 'complete opens on "notes"', await step())
  await p.fill('textarea[name="notes"]', 'Delapan unit dibersihkan, dua unit isi freon. Pelanggan puas.')
  await primary()
  await done()
  t.check((await rowsWith(CUSTOMER)).length >= 1, 'completion listed')
  await p.click('.wiz-done-actions .btn-primary')
  await p.waitForTimeout(900)

  /* ---- 05 Pembukuan ---- */
  t.check(await step() === 'entry', 'bookkeeping opens on "entry"', await step())
  await p.selectOption('select[name="category"]', 'pendapatan')
  await p.waitForTimeout(150)
  const amt = await p.inputValue('input[name="amount"]')
  t.check(amt === '1750000', 'revenue amount prefilled from the offer price', amt)
  await primary()
  t.check(await step() === 'review', 'bookkeeping review step')
  await primary()
  await done()
  await p.click('.wiz-done-actions .btn-primary') // Tambah jurnal
  await p.waitForTimeout(500)
  await p.selectOption('select[name="category"]', 'biaya_tenaga')
  await p.fill('input[name="amount"]', '250000')
  await primary(); await primary()
  await done()
  const led = await rowsWith(CUSTOMER)
  t.check(led.length === 2, 'two ledger rows (pendapatan + biaya tenaga) for the customer', led.join(' || '))

  /* ---- 06 Laporan ---- */
  await goStage(p, 'report')
  await p.waitForSelector('.view .kpis .kpi-value', { timeout: 15000 })
  await p.click('.view .seg-btn[data-value="all"]')
  await p.waitForTimeout(400)
  const profit = norm(await kpiValue(p, 'Laba bersih')).replace(/\s/g, '')
  t.check(profit === 'Rp7.450.000', 'report "Semua": laba = 5.950.000 + 1.750.000 − 250.000', profit)
  await p.waitForFunction(() => /Model: (?!memuat)/.test(document.querySelector('.model-note')?.textContent || ''), null, { timeout: 10000 })
  await p.getByRole('button', { name: 'Jelaskan dengan AI' }).click()
  await p.waitForSelector('.report-ai-out .console', { timeout: 8000 })
  await p.waitForFunction(() => /Selesai|Dihentikan|Gagal/.test(document.querySelector('.report-ai-out .console-status')?.textContent || ''), null, { timeout: 40000 })
  const status = norm(await p.textContent('.report-ai-out .console-status'))
  const bodyLen = (await p.textContent('.report-ai-out .console-body')).trim().length
  t.check(status === 'Selesai' && bodyLen > 80, 'AI explanation streamed to "Selesai"', `${status} ${bodyLen}`)
  t.check(await p.locator('.report-ai-out .console-body script').count() === 0, 'AI HTML sanitised (no <script>)')
  // stop mid-stream
  await p.getByRole('button', { name: 'Jelaskan dengan AI' }).click()
  await p.waitForTimeout(500)
  await p.click('.report-ai-out .console-stop').catch(() => {})
  await p.waitForFunction(() => /Selesai|Dihentikan/.test(document.querySelector('.report-ai-out .console-status')?.textContent || ''), null, { timeout: 15000 })
  t.check(norm(await p.textContent('.report-ai-out .console-status')) === 'Dihentikan', '"Hentikan" stops the stream')

  /* ---- 00 Ringkasan reflects the new job ---- */
  await goStage(p, 'dashboard')
  await p.waitForSelector('.kpis:not(.is-loading) .kpi-value')
  t.check(norm(await kpiValue(p, 'Pendapatan')).replace(/\s/g, '') === 'Rp11.500.000', 'dashboard revenue includes the new job (9.750.000 + 1.750.000)', await kpiValue(p, 'Pendapatan'))
  t.check((await p.textContent('.view')).includes(CUSTOMER), 'dashboard activity mentions the customer')
  await t.noErrors(p)
}

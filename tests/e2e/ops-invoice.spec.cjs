// E2E (mock, 390px): a demo account sees petugas in Tim and the assign form; the assign
// picker hides offers that already have a penugasan; progress goes Belum → Sedang
// dikerjakan → Ditunda → Selesai (Selesai through Penyelesaian, no duplicate); an invoice
// is created from the finished job, edited, printed (stubbed), sent (simulated) and
// marked paid — the revenue lands in Pembukuan exactly once.
const { goStage, waitDashboard } = require('./lib.cjs')

const mockState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('satualur_mock_v1') || '{}'))

module.exports = async function opsInvoice(t) {
  const p = await t.page({ width: 390, height: 844 })
  await p.goto(`${t.base}/#/masuk?demo`, { waitUntil: 'load' })
  await p.waitForSelector('#auth-mode-demo')
  await p.click('.auth-form-demo button[type=submit]')
  await p.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 40000 })
  await waitDashboard(p)

  // ---- Tim + assign form have petugas
  await goStage(p, 'assign')
  await p.locator('.seg-btn[data-value="team"]').click()
  await p.waitForTimeout(600)
  const teamText = await p.evaluate(() => document.querySelector('.view').innerText)
  t.check(!/Belum ada petugas aktif/.test(teamText) && await p.locator('.workspace-entry').count() >= 3, 'demo: Tim lists petugas', String(await p.locator('.workspace-entry').count()))
  await p.locator('.seg-btn[data-value="assign"]').click()
  await p.waitForTimeout(600)
  t.check(/Pilih pekerjaan dari Alur kerja/.test(await p.evaluate(() => document.querySelector('.view').innerText)), 'assign tab without a job points to Alur kerja')

  // ---- one job per page: an approved offer without a team gets the form, for that offer only
  // A draft offer: its page approves it, then "Tugaskan" opens the form for that offer only.
  const draft = await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('satualur_mock_v1') || '{}')
    const assigned = new Set((s.assignments || []).map((a) => String(a.offer_id)))
    return (s.offers || []).find((o) => o.status === 'draft' && !assigned.has(String(o.id)))?.id ?? null
  })
  await goStage(p, 'offer', { offerId: draft })
  await p.getByRole('button', { name: 'Setujui' }).click()
  await p.getByRole('button', { name: 'Tugaskan', exact: true }).waitFor({ timeout: 8000 })
  await p.getByRole('button', { name: 'Tugaskan', exact: true }).click()
  await p.waitForSelector('select[name="offer_id"]', { state: 'attached', timeout: 8000 })
  t.check(await p.evaluate(() => location.hash) === `#/app/penugasan?penawaran=${draft}`, 'approved offer: "Tugaskan" opens #/app/penugasan?penawaran=<id>')
  t.check(!/Belum ada petugas aktif/.test(await p.evaluate(() => document.querySelector('.view').innerText)), 'demo: assign form has petugas to pick')
  const pick = await p.evaluate(() => [...document.querySelectorAll('select[name="offer_id"] option')].filter((o) => o.value).map((o) => o.value))
  t.check(pick.length === 1 && pick[0] === String(draft), 'assign picker: only this job\'s offer', pick.join())

  // ---- a job that has a team: its page shows the team and its progress
  const busy = await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('satualur_mock_v1') || '{}')
    const done = new Set((s.completions || []).map((c) => String(c.assignment_id)))
    return (s.assignments || []).find((a) => !done.has(String(a.id)))?.offer_id ?? null
  })
  await goStage(p, 'assign', { offerId: busy })

  // ---- progress: Belum → Sedang dikerjakan → Ditunda → Selesai
  const chip = p.locator('.progress-chip').first()
  await chip.waitFor({ timeout: 8000 })
  const rowCustomer = await p.locator('table tbody tr', { has: p.locator('.progress-chip') }).first().locator('td').first().innerText()
  const setProgress = async (label, note) => {
    await p.locator('table tbody tr', { hasText: rowCustomer.split('\n')[0] }).locator('.progress-chip').first().click()
    const dlg = p.locator('dialog[open]')
    await dlg.locator('.progress-opt', { hasText: label }).click()
    if (note) await dlg.getByLabel('Catatan (opsional)').fill(note)
    await dlg.getByRole('button', { name: 'Simpan progres' }).click()
  }
  await setProgress('Sedang dikerjakan', 'Tim sudah di lokasi')
  await p.waitForSelector('table tbody tr .tag:has-text("Sedang dikerjakan")', { timeout: 8000 })
  t.check(true, 'progress: set to Sedang dikerjakan')
  await setProgress('Ditunda', 'Menunggu sparepart')
  await p.waitForSelector('table tbody tr .tag:has-text("Ditunda")', { timeout: 8000 })
  const log = (await mockState(p)).assignment_progress_log || []
  t.check(log.filter((x) => x.progress === 'dikerjakan' || x.progress === 'ditunda').length >= 2, 'progress: history rows written', String(log.length))
  // history shows in the dialog
  await p.locator('table tbody tr', { hasText: rowCustomer.split('\n')[0] }).locator('.progress-chip').first().click()
  await p.waitForSelector('dialog[open] .progress-log li', { timeout: 8000 })
  t.check(await p.locator('dialog[open] .progress-log li').count() >= 2, 'progress: dialog shows the history')
  const dlg = p.locator('dialog[open]')
  await dlg.locator('.progress-opt', { hasText: 'Selesai' }).click()
  await dlg.getByRole('button', { name: 'Simpan progres' }).click()
  await p.waitForTimeout(800)
  const cur = await p.evaluate(() => ({ stage: document.querySelector('.crumb-title')?.textContent === 'Penyelesaian' && document.querySelector('.flow-item[aria-current="page"]')?.dataset.stage === 'workflow' ? 'complete' : document.querySelector('.crumb-title')?.textContent, dlg: !!document.querySelector('dialog[open]'), err: document.querySelector('dialog[open] .field-error')?.textContent }))
  t.check(cur.stage === 'complete', 'progress: Selesai opens Penyelesaian', JSON.stringify(cur))
  const before = ((await mockState(p)).completions || []).length
  await p.getByRole('button', { name: 'Tandai selesai' }).first().click()
  await p.waitForSelector('text=ditandai selesai', { timeout: 10000 })
  const st = await mockState(p)
  t.check((st.completions || []).length === before + 1, 'Penyelesaian: exactly one completion added')

  // ---- invoice from the finished job
  await p.getByRole('button', { name: 'Buat invoice' }).first().click()
  await p.waitForSelector('dialog[open] .inv-line', { timeout: 10000 })
  const inv = p.locator('dialog[open]')
  t.check(await inv.locator('.inv-line').count() === 1, 'invoice: draft starts with the offer as one line')
  await inv.getByLabel('Jumlah baris 1').fill('2')
  await inv.getByRole('button', { name: 'Tambah baris' }).click()
  await inv.getByLabel('Keterangan baris 2').fill('Freon tambahan')
  await inv.getByLabel('Jumlah baris 2').fill('1')
  await inv.getByLabel('Harga baris 2').fill('150000')
  await inv.locator('.inv-ppn input[type=checkbox]').check()
  await inv.getByLabel('Cara pembayaran').fill('Transfer BCA 1234567890 a.n. Usaha Contoh')
  const grand = await inv.locator('.inv-grand dd').innerText()
  t.check(/Rp/.test(grand), 'invoice: totals update', grand)
  await inv.getByRole('button', { name: 'Simpan invoice' }).click()
  await p.waitForFunction(() => !document.querySelector('dialog[open]') || document.querySelector('dialog[open] .note-danger'), null, { timeout: 10000 })
  const saveErr = await p.evaluate(() => document.querySelector('dialog[open] .note-danger')?.innerText || '')
  t.check(!saveErr, 'invoice: saved without validation errors', saveErr)
  await p.waitForSelector('table tbody tr', { timeout: 8000 })
  const listText = await p.locator('table tbody').innerText()
  t.check(/INV-\d{4}-0001/.test(listText), 'invoice: saved with number INV-YYYY-0001', listText.slice(0, 80))
  const s2 = await mockState(p)
  const saved = (s2.invoices || [])[0]
  t.check(saved && (s2.invoice_items || []).filter((x) => String(x.invoice_id) === String(saved.id)).length === 2 && Number(saved.tax_rate) === 11, 'invoice: two lines and PPN stored')

  // open it: PDF (stubbed window), WA dialog, email (simulated), mark paid
  await p.evaluate(() => { window.__printed = 0; window.open = () => ({ document: { open() {}, write(h) { window.__printedHtml = h }, close() {} }, focus() {}, print() { window.__printed++ } }) })
  await p.locator('table tbody tr').first().getByRole('button', { name: 'Buka', exact: true }).click()
  await p.waitForSelector('dialog[open] .inv-line', { timeout: 8000 })
  const ed = p.locator('dialog[open]')
  await ed.getByRole('button', { name: 'Unduh PDF' }).click()
  await p.waitForFunction(() => window.__printed === 1, null, { timeout: 5000 })
  t.check(await p.evaluate(() => /INV-\d{4}-0001/.test(window.__printedHtml || '')), 'invoice: printable document has the number')
  await ed.getByRole('button', { name: 'Kirim WhatsApp' }).click()
  await p.waitForSelector('dialog[open] textarea', { timeout: 5000 })
  t.check(/INV-\d{4}-0001/.test(await p.locator('dialog[open]').last().locator('textarea').inputValue()), 'invoice: WhatsApp text includes the invoice')
  await p.locator('dialog[open]').last().getByRole('button', { name: 'Batal' }).click()
  await ed.getByRole('button', { name: 'Kirim email' }).click()
  const mail = p.locator('dialog[open]').last()
  await mail.getByLabel('Email pelanggan').fill('pelanggan@contoh.id')
  await mail.getByRole('button', { name: 'Kirim email' }).click()
  await p.waitForSelector('.toast:has-text("email")', { timeout: 6000 })
  t.check(true, 'invoice: email send (simulated) confirmed')
  p.once('dialog', (d) => d.accept())
  await ed.getByRole('button', { name: 'Tandai lunas' }).click()
  await p.waitForSelector('.toast:has-text("Lunas")', { timeout: 8000 })
  const s3 = await mockState(p)
  const paid = (s3.invoices || []).find((i) => String(i.id) === String(saved.id))
  const revenue = (s3.ledger_entries || []).filter((l) => String(l.completion_id) === String(paid.completion_id) && l.category === 'pendapatan')
  t.check(paid.status === 'lunas' && revenue.length === 1, 'mark paid: invoice Lunas and revenue posted once', `${paid.status} ${revenue.length}`)
  t.check(Number(revenue[0]?.amount) === Number(paid.total) - Number(paid.tax_amount), 'mark paid: revenue excludes PPN', `${revenue[0]?.amount} vs ${paid.total}-${paid.tax_amount}`)
  t.check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'invoice page: no horizontal scroll at 390px')
  await t.noErrors(p)
}

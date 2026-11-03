// E2E (mock): request AI autofill, the six-step offer pipeline without raw JSON,
// PDF/email/WhatsApp drafts, editable review + save, and offer templates
// (admin CRUD in Kantor, a business uses one). Mobile width, as the user tests.
const { loginLive, goStage, norm } = require('./lib.cjs')

const CUSTOMER = 'Hotel Uji Alur Penawaran'
const TEMPLATE = 'Sewa tenda acara'

async function staffLogin(page, base) {
  await page.goto(`${base}/super-admin-login`, { waitUntil: 'load' })
  await page.waitForSelector('#staff-username')
  await page.fill('#staff-username', 'staff')
  await page.fill('#staff-password', 'rahasia-staf-123')
  await page.getByRole('button', { name: 'Masuk' }).click()
  await page.waitForSelector('.app-shell', { timeout: 10000 })
}

module.exports = async function offerFlow(t) {
  const p = await t.page({ width: 390, height: 844 })
  // Print window stub: record the document instead of opening a pop-up.
  await p.addInitScript(() => {
    window.__printed = []
    window.open = () => ({ document: { open() {}, write(h) { window.__printed.push(h) }, close() {} }, focus() {}, print() {} })
  })
  const step = () => p.$eval('.wiz-pane:not([hidden])', (x) => x.dataset.step).catch(() => null)
  const primary = () => p.click('.wiz-primary', { timeout: 8000 })

  /* ---- Kantor: create, edit and deactivate templates (desktop) ---- */
  await p.setViewportSize({ width: 1280, height: 900 })
  await staffLogin(p, t.base)
  await p.locator('.side .flow-item[data-stage="offer-templates"]').click()
  await p.waitForSelector('.ot-entry', { timeout: 8000 })
  t.check(await p.locator('.ot-entry').count() >= 8, 'Kantor lists the built-in templates', String(await p.locator('.ot-entry').count()))
  await p.getByRole('button', { name: 'Tambah template' }).click()
  const dlg = p.getByRole('dialog', { name: 'Tambah template' })
  await dlg.getByLabel('Nama template').fill(TEMPLATE)
  await dlg.getByRole('button', { name: 'Tambah pertanyaan' }).click()
  await dlg.locator('.ot-field').nth(0).getByLabel('Pertanyaan').fill('Jumlah tamu')
  await dlg.locator('.ot-field').nth(0).locator('[data-k="required"]').check()
  await dlg.getByRole('button', { name: 'Tambah pertanyaan' }).click()
  await dlg.locator('.ot-field').nth(1).getByLabel('Pertanyaan').fill('Jenis tenda')
  await dlg.locator('.ot-field').nth(1).locator('select[data-k="type"]').evaluate((s) => { s.value = 'select'; s.dispatchEvent(new Event('change', { bubbles: true })) })
  await dlg.locator('.ot-field').nth(1).locator('[data-k="options"]').fill('Dome\nSarnafil')
  await dlg.getByLabel('Arahan untuk AI').fill('Rinci ukuran tenda, jumlah kursi, dan biaya pasang-bongkar.')
  await dlg.getByLabel('Harga minimum (Rp)').fill('2000000')
  await dlg.getByLabel('Harga maksimum (Rp)').fill('20000000')
  t.check(/Jumlah tamu/.test(await dlg.locator('.ot-preview-box').textContent()), 'field builder shows a live preview')
  await dlg.getByRole('button', { name: 'Simpan' }).click()
  await p.waitForTimeout(500)
  const created = p.locator('.ot-entry', { hasText: TEMPLATE })
  t.check(await created.count() === 1, 'admin created a template', String(await created.count()))
  t.check(/2 pertanyaan/.test(await created.textContent()), 'template shows its question count')
  await created.getByRole('button', { name: `Ubah ${TEMPLATE}` }).click()
  const ed = p.getByRole('dialog', { name: `Ubah ${TEMPLATE}` })
  await ed.getByLabel('Deskripsi singkat').fill('Tenda untuk pernikahan dan acara kantor.')
  await ed.getByRole('button', { name: 'Simpan' }).click()
  await p.waitForTimeout(500)
  t.check(/pernikahan/.test(await p.locator('.ot-entry', { hasText: TEMPLATE }).textContent()), 'admin edited the template')
  const desain = p.locator('.ot-entry', { hasText: 'Desain grafis' })
  await desain.getByRole('button', { name: 'Nonaktifkan Desain grafis' }).click()
  await p.waitForTimeout(500)
  t.check(/Nonaktif/.test(await p.locator('.ot-entry', { hasText: 'Desain grafis' }).textContent()), 'admin deactivated a template')

  /* ---- 01 Permintaan: AI autofill (phone width) ---- */
  await p.getByRole('button', { name: 'Keluar' }).first().click()
  await p.waitForTimeout(600)
  await p.setViewportSize({ width: 390, height: 844 })
  await loginLive(p, t.base)
  await goStage(p, 'request')
  await p.fill('input[name="customer_name"]', CUSTOMER)
  await p.fill('input[name="location"]', 'Bandung')
  await p.fill('input[name="phone"]', '0812 0000 7788')
  await primary()
  await p.waitForTimeout(300)
  t.check(await step() === 'need', 'request reaches the needs step')
  t.check(await p.locator('input[name="requested_at"]').count() === 0, 'requested schedule moved out of the request form')
  await p.fill('textarea[name="ai_hint"]', 'Sewa tenda untuk 150 tamu resepsi hari Sabtu')
  await p.getByRole('button', { name: 'Isi otomatis dengan AI' }).click()
  await p.waitForFunction(() => /Terisi|Gagal|Dihentikan/.test(document.querySelector('.ai-fill-status')?.textContent || ''), null, { timeout: 20000 })
  const svc = await p.inputValue('input[name="service_type"]')
  const desc = await p.inputValue('textarea[name="description"]')
  t.check(svc.length > 2 && desc.length > 40, 'AI autofill filled service type and description', `${svc} | ${desc.slice(0, 60)}`)
  t.check(!/[{}]/.test(desc), 'autofilled description is prose, not JSON')
  await p.fill('input[name="service_type"]', 'Sewa tenda acara')
  await primary()
  await p.waitForTimeout(300)
  await primary()
  await p.waitForSelector('.wiz-done:not([hidden])', { timeout: 10000 })
  await p.click('.wiz-done-actions .btn-primary') // Buat penawaran
  await p.waitForTimeout(900)

  /* ---- 02 Penawaran: template, pipeline, review ---- */
  t.check(await step() === 'compose', 'offer opens on the AI step')
  await p.getByRole('button', { name: 'Kembali' }).click()
  await p.waitForTimeout(400)
  t.check(await step() === 'pick', 'back to step 1 to choose a template')
  await p.getByRole('combobox', { name: 'Template penawaran' }).click()
  await p.waitForTimeout(250)
  const opts = await p.$$eval('.combo-pop:not([hidden]) .combo-option', (xs) => xs.map((x) => x.textContent.trim()))
  t.check(opts.includes(TEMPLATE) && !opts.includes('Desain grafis'), 'business sees active templates only (new one in, deactivated one out)', opts.join('|'))
  await p.keyboard.type('tenda'); await p.keyboard.press('Enter')
  await p.waitForTimeout(300)
  await primary()
  await p.waitForTimeout(300)
  t.check(await step() === 'pick' && (await p.locator('.field-error').allTextContents()).some((x) => /Jumlah tamu wajib/.test(x)), 'required template question is enforced')
  await p.fill('input[name="tf_jumlah_tamu"]', '150')
  await p.getByRole('combobox', { name: 'Jenis tenda' }).click()
  await p.keyboard.type('Sarnafil'); await p.keyboard.press('Enter')
  await primary()
  await p.waitForTimeout(400)
  await primary() // Hasilkan penawaran
  await p.waitForSelector('.pipe-step.is-running', { timeout: 8000 })
  t.check(await p.locator('.pipe-step').count() === 6, 'pipeline lists six steps')
  const labels = await p.$$eval('.pipe-label', (xs) => xs.map((x) => x.childNodes[0].textContent.trim()))
  t.check(labels.join('|') === 'Mengambil data klien|Menyesuaikan jadwal|Membuat penawaran berdasarkan kebutuhan klien|Membuat PDF penawaran|Membuat draf email & WhatsApp|Membuat draf tinjauan', 'pipeline steps in the requested order', labels.join('|'))
  let sawJson = false
  let sawLive = false
  for (let i = 0; i < 40 && (await step()) === 'compose'; i += 1) {
    const txt = await p.textContent('.pipe-box').catch(() => '')
    if (/"scope"|\{\s*"/.test(txt)) sawJson = true
    if (await p.locator('.live-field:not(.is-empty)').count()) sawLive = true
    await p.waitForTimeout(250)
  }
  await p.waitForFunction(() => document.querySelector('.wiz-pane:not([hidden])')?.dataset.step === 'review', null, { timeout: 30000 })
  t.check(!sawJson, 'no raw JSON on screen while the AI writes')
  t.check(sawLive, 'offer fields fill in progressively while streaming')
  const reviewText = await p.textContent('.wiz-pane:not([hidden])')
  t.check(!/"scope"|\{\s*"/.test(reviewText), 'no raw JSON in the review step')
  t.check(await p.inputValue('textarea[name="offer_scope"]').then((v) => v.length > 10), 'scope editable in review')
  t.check(await p.inputValue('input[name="offer_schedule_final"]').then((v) => /^\d{4}-\d{2}-\d{2}T/.test(v)), 'schedule carried into review')
  t.check(await p.locator('.review-note').count() >= 2, 'internal review draft shown')
  t.check(await p.locator('summary', { hasText: 'Draf email' }).count() === 1 && await p.locator('summary', { hasText: 'Draf WhatsApp' }).count() === 1, 'email and WhatsApp drafts present')
  await p.locator('summary', { hasText: 'Draf email' }).click()
  t.check(/Penawaran/.test(await p.inputValue('input[name="mail_subject"]')), 'email draft has a subject')
  await p.fill('textarea[name="offer_scope"]', 'Pasang tenda sarnafil untuk 150 tamu, termasuk kursi dan bongkar.')
  t.check(/150 tamu/.test(await p.inputValue('textarea[name="mail_body"]')), 'email draft follows the edited scope')
  await p.getByRole('button', { name: 'Unduh PDF' }).click()
  await p.waitForTimeout(300)
  const doc = await p.evaluate(() => window.__printed.at(-1) || '')
  t.check(/Penawaran/.test(doc) && /150 tamu/.test(doc) && /PNW-\d{8}-/.test(doc), 'PDF document built with the edited content and a number')
  await p.fill('input[name="validated_price"]', '100')
  await p.waitForTimeout(150)
  t.check(await p.$eval('.wiz-primary', (b) => b.disabled) && await p.locator('.chip.is-bad').count() >= 1, 'domain rule blocks a too-low price')
  await p.fill('input[name="validated_price"]', '8500000')
  await p.waitForTimeout(150)
  await primary()
  await p.waitForSelector('.wiz-done:not([hidden])', { timeout: 10000 })
  const row = await p.$$eval('.list-panel tbody tr', (r, s) => r.filter((x) => x.textContent.includes(s)).map((x) => x.textContent.replace(/\s+/g, ' ')), CUSTOMER)
  t.check(row.length === 1 && /8\.500\.000/.test(row[0]) && /150 tamu/.test(row[0]), 'saved offer has the edited price and scope', row[0])
  const saved = await p.evaluate((name) => {
    const st = JSON.parse(localStorage.getItem('satualur_mock_v1') || '{}')
    const req = (st.requests || []).find((r) => r.customer_name === name)
    const off = (st.offers || []).find((o) => String(o.request_id) === String(req?.id))
    return { tpl: off?.template_id, answers: off?.template_answers_json, sched: req?.requested_at }
  }, CUSTOMER)
  t.check(saved.tpl != null && saved.answers?.jumlah_tamu === '150', 'offer stores the template and its answers', JSON.stringify(saved))
  t.check(Boolean(saved.sched), 'schedule saved back on the request')
  await p.waitForTimeout(1200) // let the save toast and the done animation settle
  const over = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, el: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && true).slice(0, 4).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`).join(' ; ') }))
  t.check(over.sw <= over.w, 'no horizontal overflow at 390px', JSON.stringify(over))
  await t.noErrors(p)
}

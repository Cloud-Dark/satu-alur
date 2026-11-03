// E2E: Pendapatan › Layanan tambahan (VAS) and Tanpa limbah, on the mock cloud.
// Covers the production paths added for launch: search/filter, paging, CRUD,
// duplicate-aware import, CSV export and the five-team optimization room.
const { loginLive, goStage, norm } = require('./lib.cjs')

const rows = (p) => p.locator('.data-table tbody tr').count()
// Toasts stack; the newest one is the one this step produced.
const toast = async (p) => norm(await p.locator('.toast').last().textContent().catch(() => ''))

module.exports = async function pendapatan(t) {
  const p = await t.page()
  await loginLive(p, t.base)

  /* ---------------------------------------------------------- Navigation */
  t.check(await p.locator('.flow-item[data-stage="vas"]').count() === 1, 'sidebar: Layanan tambahan exists')
  t.check(await p.locator('.flow-item[data-stage="zero-waste"]').count() === 1, 'sidebar: Tanpa limbah exists')
  t.check(norm(await p.locator('.flow-item[data-stage="vas"]').textContent()).includes('Layanan tambahan'), 'sidebar: VAS label')

  /* --------------------------------------------------------- VAS › Peluang */
  await goStage(p, 'vas')
  await p.locator('.vas-opp').first().waitFor({ timeout: 10000 })
  t.check(await p.locator('.vas-opp').count() > 0, 'peluang: opportunity cards render from demo data')
  t.check(await p.locator('.kpi').count() >= 4, 'peluang: four KPIs')
  t.check(!/Gagal memuat|Terjadi kesalahan/i.test(await p.textContent('.view')), 'peluang: no load error')

  /* --------------------------------------------------------- VAS › Katalog */
  await p.locator('.seg-btn', { hasText: 'Katalog' }).click()
  await p.locator('.data-table').waitFor({ timeout: 8000 })
  const seeded = await rows(p)
  t.check(seeded === 7, 'katalog: seven seeded items', seeded)
  t.check(await p.locator('.pd-search').count() === 1, 'katalog: search box present')
  t.check(await p.locator('.pd-filter').count() === 1, 'katalog: status filter present')

  await p.locator('.pd-search').fill('karpet')
  await p.waitForTimeout(400)
  t.check(await rows(p) === 2, 'katalog: search narrows to two rows', await rows(p))

  await p.locator('.pd-search').fill('')
  await p.locator('.pd-filter').selectOption('draft')
  await p.waitForTimeout(300)
  t.check(await rows(p) === 1, 'katalog: draft filter shows one row', await rows(p))
  t.check(norm(await p.locator('.vas-toolbar-note').textContent()).startsWith('1 dari 7'), 'katalog: count line follows the filter')

  await p.locator('.pd-search').fill('tidak-ada-yang-cocok')
  await p.waitForTimeout(400)
  t.check(await p.locator('.pd-none').count() === 1, 'katalog: empty search shows a no-match message')
  await p.locator('.pd-search').fill('')
  await p.locator('.pd-filter').selectOption('all')
  await p.waitForTimeout(300)

  // Create
  await p.getByRole('button', { name: 'Tambah item' }).first().click()
  const dlg = p.getByRole('dialog')
  await dlg.waitFor()
  await dlg.locator('#vas-name').fill('Uji e2e item')
  await dlg.locator('#vas-price').fill('123000')
  await dlg.locator('#vas-cost').fill('23000')
  await dlg.getByRole('button', { name: 'Tambah item' }).click()
  await dlg.waitFor({ state: 'hidden' })
  await p.waitForTimeout(800)
  t.check(await rows(p) === seeded + 1, 'katalog: a new item is saved', await rows(p))
  t.check((await toast(p)).includes('Item ditambahkan'), 'katalog: success toast')

  // Short name is rejected by the shared rules, inside the dialog
  await p.getByRole('button', { name: 'Tambah item' }).first().click()
  const dlg2 = p.getByRole('dialog')
  await dlg2.locator('#vas-name').fill('A')
  await dlg2.locator('#vas-price').fill('50000')
  await dlg2.getByRole('button', { name: 'Tambah item' }).click()
  await p.waitForTimeout(500)
  t.check(norm(await dlg2.locator('.note').textContent()).includes('minimal 2 karakter'), 'katalog: shared validator message in the dialog')
  await dlg2.getByRole('button', { name: 'Batal' }).click()
  await dlg2.waitFor({ state: 'hidden' })
  t.check(await p.locator('dialog[open]').count() === 0, 'katalog: Batal closes the dialog')

  // Import with a duplicate: only the new row is written
  await p.getByRole('button', { name: 'Impor massal' }).click()
  const bulk = p.getByRole('dialog')
  await bulk.waitFor()
  await bulk.locator('textarea').fill([
    'Uji e2e item | 123000 | 23000 | peningkatan | Pembersihan AC | 10',
    'Deep clean outdoor | 650000 | 180000 | peningkatan | Pembersihan AC | 20',
  ].join('\n'))
  await p.waitForTimeout(300)
  t.check(/1 item baru · 1 sudah ada/.test(norm(await bulk.locator('.vas-bulk-preview').textContent())), 'import: duplicate detected before writing')
  await bulk.getByRole('button', { name: 'Impor', exact: true }).click()
  await bulk.waitFor({ state: 'hidden' })
  await p.waitForTimeout(900)
  t.check(await rows(p) === seeded + 2, 'import: only the new row was added', await rows(p))
  t.check((await toast(p)).includes('1 dilewati'), 'import: toast reports the skipped duplicate')

  // Export
  await p.getByRole('button', { name: 'Ekspor CSV' }).click()
  await p.waitForTimeout(400)
  t.check(/diekspor ke CSV/.test(await toast(p)), 'katalog: CSV export confirms')

  // Paging appears once the list passes the page size
  await p.getByRole('button', { name: 'Impor massal' }).click()
  const bulk2 = p.getByRole('dialog')
  await bulk2.waitFor()
  await bulk2.locator('textarea').fill(Array.from({ length: 5 }, (_, i) => `Uji halaman ${i + 1} | 90000 | 10000 | lain |  | 10`).join('\n'))
  await bulk2.getByRole('button', { name: 'Impor', exact: true }).click()
  await bulk2.waitFor({ state: 'hidden' })
  await p.waitForTimeout(900)
  t.check(await p.locator('.pager').isVisible(), 'katalog: pager appears past ten rows')
  t.check(/1–10 dari/.test(norm(await p.locator('.pager-info').textContent())), 'katalog: page one of the pager')
  await p.locator('.pager-step[data-step="next"]').click()
  await p.waitForTimeout(400)
  t.check(/11–/.test(norm(await p.locator('.pager-info').textContent())), 'katalog: next page shows the tail')

  /* ------------------------------------------------------ Zero waste */
  await goStage(p, 'zero-waste')
  await p.locator('.zw-stream').first().waitFor({ timeout: 10000 })
  t.check(await p.locator('.zw-stream').count() === 5, 'limbah: five streams')
  t.check(/%/.test(norm(await p.locator('.zw-ring-value').textContent())), 'limbah: progress ring shows a percentage')
  t.check(await p.locator('.zw-plan-item').count() > 0, 'limbah: closure plan lists the biggest leaks')

  await p.locator('.seg-btn', { hasText: 'Tindakan' }).click()
  await p.locator('.data-table').waitFor({ timeout: 8000 })
  t.check(await rows(p) === 8, 'tindakan: eight seeded findings', await rows(p))
  t.check(await p.locator('.pd-filter').count() === 2, 'tindakan: stream and status filters')

  await p.locator('.pd-filter').first().selectOption('perjalanan')
  await p.waitForTimeout(300)
  t.check(await rows(p) === 2, 'tindakan: stream filter narrows to two rows', await rows(p))

  const openBefore = norm(await p.locator('.zw-toolbar-note').textContent())
  await p.locator('.data-table tbody tr').first().locator('.icon-btn[aria-label^="Tandai selesai"]').click()
  await p.waitForTimeout(900)
  const openAfter = norm(await p.locator('.zw-toolbar-note').textContent())
  t.check(openBefore !== openAfter, 'tindakan: marking done updates the open count', `${openBefore} → ${openAfter}`)
  t.check(/ditutup/.test(await toast(p)), 'tindakan: close toast')

  await p.getByRole('button', { name: 'Ekspor CSV' }).click()
  await p.waitForTimeout(300)
  t.check(/diekspor ke CSV/.test(await toast(p)), 'tindakan: CSV export confirms')
  await p.locator('.pd-filter').first().selectOption('all')

  /* -------------------------------------------------- Optimization room */
  await p.evaluate(() => localStorage.setItem('satualur_opt_run_v1:waste', JSON.stringify({
    brief: { problem: 'Private legacy account brief' }, lead: 'Private legacy account result',
  })))
  await p.locator('.seg-btn', { hasText: 'Ruang optimasi' }).click()
  await p.locator('.opt-team').first().waitFor({ timeout: 8000 })
  t.check(await p.locator('.opt-team').count() === 5, 'optimasi: five team cards')
  t.check(await p.locator('.opt-preset').count() === 3, 'optimasi: three one-tap briefs')
  t.check(await p.locator('.opt-facts li').count() >= 4, 'optimasi: teams are fed the business numbers')
  t.check(!/Private legacy account/.test(await p.locator('.view').textContent()), 'optimasi: unscoped legacy account history is not shown')

  await p.locator('.opt-preset').first().click()
  await p.getByRole('button', { name: 'Jalankan 5 tim' }).click()
  // The placeholder is also a <p>, so wait for a real synthesis (not the
  // "menyatukan" status line) before reading it.
  await p.waitForFunction(() => {
    const text = document.querySelector('.opt-lead .opt-md')?.textContent || ''
    return text.length > 80 && !text.includes('Menyatukan') && !text.includes('Kesimpulan muncul')
  }, null, { timeout: 60000 })
  const lead = norm(await p.locator('.opt-lead .opt-md').textContent())
  t.check(lead.length > 80, 'optimasi: lead synthesis rendered', lead.slice(0, 60))
  t.check(await p.locator('.opt-team[data-state="done"]').count() >= 3, 'optimasi: most teams reached done')
  t.check(await p.evaluate(() => Object.keys(localStorage).some((key) => (
    key.startsWith('satualur_opt_run_v1:') && key.endsWith(':waste')
  ))), 'optimasi: saved history is scoped to the signed-in user')

  // Test the new bookkeeping consumer directly; the older flow spec stops at assignment.
  await goStage(p, 'bookkeeping')
  const completion = p.locator('select[name="completion_id"]')
  await p.waitForFunction(() => document.querySelector('select[name="completion_id"] option[value]:not([value=""])'))
  const completionId = await completion.locator('option:not([value=""])').first().getAttribute('value')
  await completion.selectOption(completionId, { force: true })
  await p.locator('.wiz-primary').click()
  await p.locator('select[name="category"]').selectOption('pendapatan', { force: true })
  const vasSelect = p.locator('select[name="vas_item_id"]')
  await p.waitForFunction(() => document.querySelector('select[name="vas_item_id"] option[value="8001"]'))
  t.check(await vasSelect.locator('option').count() > 1, 'bookkeeping: revenue can be linked to a VAS item')
  t.check(await vasSelect.locator('option[value="8007"]').count() === 0, 'bookkeeping: draft catalog items are excluded')
  await vasSelect.selectOption('8001', { force: true })
  await p.locator('select[name="category"]').selectOption('biaya_bahan', { force: true })
  t.check(await vasSelect.inputValue() === '', 'bookkeeping: changing to a cost clears the VAS link')

  await t.noErrors(p)
}

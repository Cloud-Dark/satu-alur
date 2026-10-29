// E2E: Bantuan (business support tickets) and Kantor Satu Alur › Pengaduan CS on the mock cloud.
// Mock sessions live in each page's memory and localStorage is shared per context, so business A,
// staff and business B are separate pages in one context (one demo store, three sessions).
const { loginLive, goStage } = require('./lib.cjs')

const BODY = '<b>dobel</b>\nbaris dua'
// Selects are enhanced into a combobox; set the native value like office.spec does.
// A second page in the same context, collecting errors like t.page() does.
async function samePage(page) {
  const p = await page.context().newPage()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(String(e)))
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()) })
  return p
}
const pick = (loc, value) => loc.evaluate((sel, v) => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })) }, value)

module.exports = async function support(t) {
  const a = await t.page()
  await loginLive(a, t.base, 'pemilik@usaha.id')
  t.check(await a.locator('.flow-item[data-stage="support"]', { hasText: 'Bantuan' }).count() === 1, 'business: "Bantuan" is in the menu')
  await goStage(a, 'support')
  await a.getByRole('heading', { name: 'Bantuan' }).first().waitFor({ timeout: 8000 })
  await a.getByText('Belum ada tiket').first().waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await a.getByText('Belum ada tiket').count() === 1, 'business: empty list says "Belum ada tiket"')

  // Buat tiket: validator message, then a ticket with markup and a line break in the body
  await a.getByRole('button', { name: 'Buat tiket' }).click()
  const dlg = a.getByRole('dialog', { name: 'Buat tiket' })
  await dlg.getByRole('button', { name: 'Kirim tiket' }).click()
  t.check(await dlg.locator('.field-error').textContent() === 'Subjek wajib diisi.', 'create: validator message in the dialog')
  t.check(await dlg.locator('option').allTextContents().then((o) => o.join(',')) === 'Teknis,Tagihan,Akun,Lainnya', 'create: categories Teknis, Tagihan, Akun, Lainnya')
  await pick(dlg.locator('select[id^="sp-cat-"]'), 'tagihan')
  await dlg.getByLabel('Subjek').fill('Tagihan ganda')
  await dlg.getByLabel('Pesan').fill(BODY)
  await dlg.getByRole('button', { name: 'Kirim tiket' }).click()
  await dlg.waitFor({ state: 'hidden' })
  const thread = a.locator('.sp-thread')
  await thread.waitFor({ timeout: 8000 })
  const id = await thread.getAttribute('data-id')
  t.check(/^\d+$/.test(id || ''), 'create: the new ticket opens in a thread view', id)
  t.check(await thread.locator('.sp-msg-body').first().textContent() === BODY && await thread.locator('b').count() === 0, 'thread: the body is text (no <b> element)')
  t.check(await thread.locator('.sp-msg-body').first().evaluate((n) => getComputedStyle(n).whiteSpace) === 'pre-wrap', 'thread: line breaks kept (pre-wrap)')
  t.check(await thread.locator('.tag', { hasText: 'Terbuka' }).count() === 1, 'thread: status Terbuka')
  await a.getByRole('button', { name: 'Kembali ke daftar tiket' }).click()
  const row = a.locator('.sp-ticket', { hasText: 'Tagihan ganda' })
  await row.waitFor({ timeout: 8000 })
  t.check(await row.getByText('Tagihan', { exact: true }).count() === 1 && await row.locator('.tag', { hasText: 'Terbuka' }).count() === 1, 'list: subject, category label and status tag')

  // staff: badge, thread, reply → Diproses
  const s = await samePage(a)
  await s.goto(`${t.base}/super-admin-login`, { waitUntil: 'load' })
  await s.waitForSelector('#staff-username')
  await s.fill('#staff-username', 'staff')
  await s.fill('#staff-password', 'rahasia-staf-123')
  await s.getByRole('button', { name: 'Masuk' }).click()
  await s.waitForSelector('.of-nav')
  const navBtn = s.getByRole('button', { name: /^Pengaduan CS/ })
  await s.waitForFunction(() => /1\s*tiket menunggu/.test(document.querySelector('.of-nav')?.textContent || ''), null, { timeout: 8000 }).catch(() => {})
  t.check(await navBtn.isEnabled() && /tiket menunggu/.test(await navBtn.textContent()), 'staff: Pengaduan CS is enabled with a badge of 1')
  await navBtn.click()
  const srow = s.locator('.of-ticket', { hasText: 'Tagihan ganda' })
  await srow.waitFor({ timeout: 8000 })
  t.check(await srow.getByText('pemilik@usaha.id').count() === 1, 'staff: the inbox shows the business email')
  await srow.click()
  const sthread = s.locator('.sp-thread')
  await sthread.waitFor({ timeout: 8000 })
  t.check(await sthread.locator('.sp-msg-body').first().textContent() === BODY, 'staff: sees the customer message as text')
  await sthread.getByLabel('Balasan').fill('Kami cek dulu.')
  await sthread.getByRole('button', { name: 'Kirim balasan' }).click()
  await sthread.locator('.sp-msg.is-staff').waitFor({ timeout: 8000 })
  t.check(await sthread.locator('.sp-msg.is-staff .sp-msg-author').textContent() === 'Tim Satu Alur (staff)', 'staff: reply signed "Tim Satu Alur (staff)", never the email')
  t.check(await sthread.locator('select[id$="-status"]').inputValue() === 'in_progress', 'staff: a reply on Terbuka moves it to Diproses')
  await s.waitForFunction(() => !/tiket menunggu/.test(document.querySelector('.of-nav')?.textContent || ''), null, { timeout: 8000 }).catch(() => {})
  t.check(!/tiket menunggu/.test(await s.locator('.of-nav').textContent()), 'staff: the badge clears once staff replied')

  // business sees the reply and Diproses
  await row.click()
  await thread.waitFor({ timeout: 8000 })
  await thread.locator('.sp-msg.is-staff').waitFor({ timeout: 8000 })
  t.check(await thread.locator('.sp-msg-author').allTextContents().then((x) => x.join('|')) === 'pemilik|Tim Satu Alur (staff)', 'business: messages in time order with author names')
  t.check(await thread.locator('.tag', { hasText: 'Diproses' }).count() === 1, 'business: status Diproses')

  // staff marks it Selesai; a customer reply reopens it
  const setStatus = async (value) => {
    await pick(sthread.locator('select[id$="-status"]'), value)
    await sthread.getByRole('button', { name: 'Simpan status' }).click()
    await s.getByText('Status tiket diperbarui.').first().waitFor({ timeout: 8000 })
  }
  await setStatus('resolved')
  await a.getByRole('button', { name: 'Kembali ke daftar tiket' }).click()
  await row.locator('.tag', { hasText: 'Selesai' }).waitFor({ timeout: 8000 })
  await row.click()
  await thread.getByLabel('Balasan').fill('Masih dobel.')
  await thread.getByRole('button', { name: 'Kirim balasan' }).click()
  await thread.locator('.tag', { hasText: 'Terbuka' }).waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await thread.locator('.sp-msg').count() === 3 && await thread.locator('.tag', { hasText: 'Terbuka' }).count() === 1, 'business: a reply on Selesai reopens the ticket (Terbuka)')

  // staff closes it; the business has no reply box
  await setStatus('closed')
  await a.getByRole('button', { name: 'Kembali ke daftar tiket' }).click()
  await row.locator('.tag', { hasText: 'Ditutup' }).waitFor({ timeout: 8000 })
  await row.click()
  await thread.waitFor({ timeout: 8000 })
  t.check(await thread.getByLabel('Balasan').count() === 0 && await thread.getByText('Tiket ditutup. Buat tiket baru bila masih butuh bantuan.').count() === 1, 'business: a closed ticket shows "Tiket ditutup" instead of the reply box')

  // a deep link opens the thread for its owner
  await a.evaluate(() => { location.hash = '#/' })
  await a.waitForSelector('.lp-hero')
  await a.evaluate((x) => { location.hash = `#/support?tiket=${x}` }, id)
  await thread.waitFor({ timeout: 8000 })
  t.check(await thread.getAttribute('data-id') === id, 'deep link #/support?tiket= opens the owner\'s ticket')

  // 360px: no sideways scroll on the thread
  await a.setViewportSize({ width: 360, height: 800 })
  await a.waitForTimeout(400)
  t.check(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '360px: no horizontal scroll')

  // business B: never sees A's ticket, even by id
  const b = await samePage(a)
  await loginLive(b, t.base, 'lain@usaha.id')
  await goStage(b, 'support')
  await b.getByText('Belum ada tiket').first().waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await b.getByText('Belum ada tiket').count() === 1 && await b.getByText('Tagihan ganda').count() === 0, 'business B: the list does not include A\'s ticket')
  await b.evaluate(() => { location.hash = '#/' })
  await b.waitForSelector('.lp-hero')
  await b.evaluate((x) => { location.hash = `#/support?tiket=${x}` }, id)
  await b.getByText('Tiket tidak ditemukan.').first().waitFor({ timeout: 8000 }).catch(() => {})
  t.check(await b.getByText('Tiket tidak ditemukan.').count() === 1 && await b.getByText('Tagihan ganda').count() === 0, 'business B: A\'s ticket id says "Tiket tidak ditemukan."')

  await t.noErrors(a)
  await t.noErrors(s, 'staff page: no uncaught errors')
  await t.noErrors(b, 'business B: no uncaught errors')
}

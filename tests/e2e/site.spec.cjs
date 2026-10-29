// E2E: editable site content — public about/legal pages and the landing reading stored content.
const DEMO = 'satualur_site_demo_v1'
const PAGES = [['tentang', 'Tentang Satu Alur'], ['privasi', 'Kebijakan Privasi'], ['syarat', 'Syarat & Ketentuan'], ['cookie', 'Kebijakan Cookie']]

module.exports = async function site(t) {
  const p = await t.page({ width: 1280, height: 900 })
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.evaluate(() => { localStorage.removeItem('satualur_site_demo_v1'); localStorage.removeItem('satualur_site_fail') })
  await p.reload({ waitUntil: 'load' })
  await p.waitForSelector('.lp-hero')

  // footer links open the four pages, each empty
  for (const [path, title] of PAGES) {
    await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
    await p.waitForSelector('.lp-hero')
    await p.click(`.lp-footer a[href="#/${path}"]`)
    await p.waitForSelector('.doc-page h1')
    t.check(await p.evaluate(() => location.hash) === `#/${path}`, `footer link opens #/${path}`)
    t.check((await p.textContent('.doc-page h1')) === title, `#/${path} default title`, await p.textContent('.doc-page h1'))
    await p.waitForSelector('.doc-empty')
    t.check(/Dokumen ini sedang disiapkan\./.test(await p.textContent('.doc-page')), `#/${path} shows the empty notice`)
  }

  // seeded about doc: heading, list, script text stays literal
  await p.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify({ about: { value: { title: 'Siapa Kami', body: '## Visi\n\nSatu alur untuk semua.\n\n- Satu\n- Dua\n\n<script>alert(1)</script>' }, updated_at: '2026-10-01T00:00:00Z', updated_by: 'tim' } }))
  }, DEMO)
  await p.goto(`${t.base}/#/tentang`, { waitUntil: 'load' })
  await p.waitForSelector('.doc-page h2')
  t.check((await p.textContent('.doc-page h1')) === 'Siapa Kami', 'seeded title shown')
  t.check((await p.textContent('.doc-page h2')) === 'Visi', 'heading rendered')
  t.check(await p.locator('.doc-page ul li').count() === 2, 'list rendered')
  t.check((await p.textContent('.doc-page')).includes('<script>alert(1)</script>'), 'script text is visible as literal text')
  t.check(await p.locator('.doc-page script').count() === 0, 'no script element injected')
  t.check(/Terakhir diperbarui/.test(await p.textContent('.doc-page')), 'shows last updated')
  t.check(await p.locator('.doc-page a[href="#/"]').count() >= 1, 'link back to Beranda')

  // seeded landing: hero + faq replaced; blanks fall back
  await p.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify({ landing: { value: { hero: { badge: 'Badge uji', title: 'Judul *baru* uji', subtitle: '', points: ['Poin A', ''] }, faqs: [{ q: 'Tanya <b>x</b>?', a: 'Jawab' }, { q: '', a: '' }] }, updated_at: 'x', updated_by: 'tim' } }))
  }, DEMO)
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.waitForSelector('.lp-hero')
  await p.waitForFunction(() => /Badge uji/.test(document.querySelector('.lp-hero-badge')?.textContent || ''))
  t.check((await p.textContent('.lp-hero-title')).trim() === 'Judul baru uji', 'hero title replaced')
  t.check((await p.textContent('.lp-hero-title em')) === 'baru', 'title emphasis is <em>')
  t.check(/Satu Alur menyatukan/.test(await p.textContent('.lp-hero-sub')), 'blank subtitle falls back to default')
  t.check(await p.locator('.lp-hero-points li').count() === 1, 'blank points filtered')
  t.check(await p.locator('.lp-faq-item').count() === 1, 'blank FAQ rows filtered')
  t.check((await p.textContent('#faq-q-0')).includes('Tanya <b>x</b>?') && await p.locator('#faq-q-0 b').count() === 0, 'faq text stays literal')
  await p.click('#faq-q-0')
  t.check(await p.getAttribute('#faq-q-0', 'aria-expanded') === 'true', 'replaced FAQ still toggles')

  // API down: landing keeps defaults
  await p.evaluate(() => localStorage.setItem('satualur_site_fail', '1'))
  await p.goto(`${t.base}/#/tentang`, { waitUntil: 'load' })
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.waitForSelector('.lp-hero')
  await p.waitForTimeout(500)
  t.check(/tumbuh/.test(await p.textContent('.lp-hero-title')) && !/Badge uji/.test(await p.textContent('.lp-hero-badge')), 'API down: default hero stays')
  t.check(await p.locator('.lp-faq-item').count() > 1, 'API down: default FAQ stays')
  await p.evaluate(() => localStorage.removeItem('satualur_site_fail'))

  // direct open + back
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.goto(`${t.base}/#/privasi`, { waitUntil: 'load' })
  await p.waitForSelector('.doc-page h1')
  t.check((await p.textContent('.doc-page h1')) === 'Kebijakan Privasi', 'direct #/privasi works')
  await p.goBack()
  await p.waitForSelector('.lp-hero')
  t.check(true, 'back returns to the landing')

  // contact form: footer Kontak opens it; validation, honeypot, success, rate limit
  await p.evaluate(() => localStorage.removeItem('satualur_customers_demo_v1'))
  await p.reload({ waitUntil: 'load' })
  await p.waitForSelector('.lp-hero')
  await p.click('.lp-footer a[href="#/kontak"]')
  await p.waitForSelector('.contact-form')
  t.check(await p.evaluate(() => location.hash) === '#/kontak' && /Kontak/.test(await p.title()), 'footer Kontak opens #/kontak')
  const hp = p.locator('#ct-website')
  t.check(await hp.getAttribute('tabindex') === '-1' && await hp.getAttribute('autocomplete') === 'off' && await p.locator('.contact-hp[aria-hidden="true"]').count() === 1 && await hp.isVisible(), 'honeypot: tabindex -1, autocomplete off, aria-hidden wrapper, not display:none')
  t.check(await p.getByLabel('Telepon (opsional)').count() === 1 && await p.locator('#ct-name').count() === 1, 'form has Nama, Email, Telepon (opsional), Subjek, Pesan')
  const fill = async (subject, message) => {
    await p.locator('#ct-name').fill('Budi')
    await p.locator('#ct-email').fill('budi@contoh.id')
    await p.locator('#ct-subject').fill(subject)
    await p.locator('#ct-message').fill(message)
  }
  await p.getByRole('button', { name: 'Kirim pesan' }).click()
  t.check(/Nama wajib diisi/.test(await p.locator('.contact-form .field-error').textContent()), 'empty submit shows an inline error')
  await fill('Bot', 'spam')
  await hp.fill('http://spam.example')
  await p.getByRole('button', { name: 'Kirim pesan' }).click()
  await p.waitForSelector('.contact-done')
  t.check(/Pesan terkirim\. Tim Satu Alur akan membalas lewat email\./.test(await p.textContent('.contact-done')), 'honeypot: looks like a success')
  const stored = () => p.evaluate(() => (JSON.parse(localStorage.getItem('satualur_customers_demo_v1') || '{}').contact || []).length)
  t.check(await stored() === 0, 'honeypot: nothing stored')
  await p.getByRole('button', { name: 'Kirim pesan lain' }).click()
  await p.waitForSelector('.contact-form')
  t.check(await p.locator('#ct-name').inputValue() === '', 'Kirim pesan lain brings back an empty form')
  await fill('Tanya paket', 'Halo\nbaris dua')
  await p.getByRole('button', { name: 'Kirim pesan' }).click()
  await p.waitForSelector('.contact-done')
  t.check(await stored() === 1 && await p.locator('.contact-form').count() === 0, 'real message: stored once; the form is replaced by the success message')
  for (let i = 2; i <= 6; i++) {
    await p.getByRole('button', { name: 'Kirim pesan lain' }).click()
    await fill(`Pesan ${i}`, 'isi')
    await p.getByRole('button', { name: 'Kirim pesan' }).click()
    if (i < 6) await p.waitForSelector('.contact-done')
  }
  await p.getByText('Terlalu banyak pesan. Coba lagi nanti.').waitFor({ timeout: 5000 })
  t.check(await stored() === 5 && await p.locator('.contact-form .field-error').textContent() === 'Terlalu banyak pesan. Coba lagi nanti.', 'rate limit: the 6th message is refused inline, 5 stored')
  await p.setViewportSize({ width: 360, height: 800 })
  t.check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '360px: contact page has no horizontal scroll')
  await t.noErrors(p)
}

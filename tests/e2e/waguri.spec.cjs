// E2E: "Tanya Waguri" floating assistant — landing (public skills, simulated AI) and the
// signed-in app (deterministic "Cek progres proyek" on the mock seed), consent, full-body
// view, clear chat, Esc, phone layout. Mock seed: Apartemen GreenView has a draft offer;
// PT Maju Jaya is done and booked.
const { loginLive, norm } = require('./lib.cjs')

const FAB = '[data-waguri-fab]'
const PANEL = '[data-waguri-panel]'

async function ask(p, text) {
  await p.fill('[data-waguri-input]', text)
  await p.keyboard.press('Enter')
}
const lastBot = (p) => p.locator(`${PANEL} .wg-msg.is-bot:not(.is-typing)`).last()

module.exports = async function waguri(t) {
  /* ---------------- landing (public) ---------------- */
  const p = await t.page({ width: 1440, height: 900 })
  await p.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await p.waitForSelector(FAB, { timeout: 15000 })
  t.check(norm(await p.textContent(FAB)) === 'Tanya Waguri', 'landing: FAB "Tanya Waguri" shown')
  const fabBox = await p.locator(FAB).boundingBox()
  t.check(fabBox && fabBox.x + fabBox.width > 1300 && fabBox.y + fabBox.height > 820, 'FAB sits bottom-right', JSON.stringify(fabBox))
  t.check(await p.locator('[data-waguri] .wg-online').count() >= 1, 'FAB avatar has an online dot')

  await p.click(FAB)
  await p.waitForSelector(`${PANEL}:not([hidden])`)
  t.check(await p.getAttribute(FAB, 'aria-expanded') === 'true', 'FAB aria-expanded=true when open')
  t.check(await p.getAttribute(PANEL, 'role') === 'dialog', 'panel is a dialog')
  t.check(/Yuk, mulai dari kebutuhanmu\./.test(await p.textContent(PANEL)), 'first open shows the consent screen')
  t.check(/Obrolan pribadi/.test(await p.textContent(PANEL)), 'consent: "Obrolan pribadi" chip')
  t.check(await p.locator(`${PANEL} .wg-points li`).count() === 3, 'consent: three bullet points')
  t.check(await p.evaluate(() => document.activeElement?.hasAttribute('data-waguri-consent')), 'focus moves to the consent button')
  await p.click('[data-waguri-consent]')
  t.check(await p.evaluate(() => localStorage.getItem('satualur_waguri_consent')) === '1', 'consent stored on this device')

  const skills = await p.$$eval(`${PANEL} .wg-skill`, (bs) => bs.map((b) => b.textContent.trim()))
  t.check(JSON.stringify(skills) === JSON.stringify(['Tentang Satu Alur', 'Harga & paket', 'Cara mulai']), 'landing: public skills only', skills.join(', '))
  t.check(/COBA TANYAKAN/i.test(await p.textContent(`${PANEL} .wg-suggest`)), 'suggestion chips under "Coba tanyakan"')
  t.check(await p.locator(`${PANEL} .wg-msg.is-bot`).count() === 1, 'greeting bubble shown')

  await p.click(`${PANEL} .wg-skill[data-skill="pricing"]`)
  await ask(p, 'Berapa harga paketnya?')
  await p.waitForFunction(() => /Sole Trader|Paket Satu Alur/.test(document.querySelector('[data-waguri-panel] .wg-msg.is-bot:not(.is-typing):last-child')?.textContent || ''), null, { timeout: 10000 }).catch(() => {})
  const priceText = await lastBot(p).textContent()
  t.check(/Paket Satu Alur/.test(priceText) && /Sole Trader/.test(priceText), 'pricing answer from public knowledge', priceText.slice(0, 120))
  t.check(await lastBot(p).locator('.wg-action', { hasText: 'Lihat harga' }).count() === 1, 'pricing answer links to the pricing section')

  // A question the knowledge base cannot answer outright goes to the (simulated) public AI.
  await p.click(`${PANEL} .wg-skill[data-skill="about"]`)
  await ask(p, 'Apakah cocok untuk laundry kiloan?')
  await p.waitForFunction(() => /simulasi/.test(document.querySelector('[data-waguri-panel] .wg-msg.is-bot:not(.is-typing):last-child')?.textContent || ''), null, { timeout: 15000 }).catch(() => {})
  t.check(/Jawaban simulasi/.test(await lastBot(p).textContent()), 'open question answered by the simulated public AI')

  await p.keyboard.press('Escape')
  t.check(await p.locator(`${PANEL}[hidden]`).count() === 1, 'Esc closes the panel')
  t.check(await p.evaluate(() => document.activeElement?.hasAttribute('data-waguri-fab')), 'focus returns to the FAB')
  await p.click(FAB)
  t.check(await p.locator(`${PANEL} .wg-msg.is-user`).count() === 2, 'history kept after reopening')
  t.check(await p.locator('[data-waguri-consent]').count() === 0, 'consent not asked twice')
  await t.shot(p, 'landing-open')
  await t.noErrors(p, 'landing: no page errors')

  /* ---------------- app (signed in) ---------------- */
  const a = await t.page({ width: 1440, height: 900 })
  await loginLive(a, t.base)
  await a.waitForSelector(FAB, { timeout: 15000 })
  t.check(await a.locator('[data-waguri]').count() === 1, 'app: exactly one Waguri (public one unmounted)')
  t.check(await a.getAttribute('[data-waguri]', 'data-waguri') === 'app', 'app: Waguri in app mode')
  await a.click(FAB)
  await a.click('[data-waguri-consent]')
  const appSkills = await a.$$eval(`${PANEL} .wg-skill`, (bs) => bs.map((b) => b.textContent.trim()))
  t.check(JSON.stringify(appSkills) === JSON.stringify(['Cek progres proyek', 'Panduan Satu Alur', 'Ringkas keuangan', 'Bantu tulis pesan']), 'app: four skills', appSkills.join(', '))

  await a.click(`${PANEL} .wg-skill[data-skill="progress"]`)
  await ask(a, 'proyek dengan apartemen greenview sudah sampai mana?')
  await a.waitForSelector(`${PANEL} [data-waguri-card]`, { timeout: 10000 }).catch(() => {})
  const card = a.locator(`${PANEL} [data-waguri-card]`).last()
  const cardText = norm(await card.textContent().catch(() => ''))
  t.check(/Apartemen GreenView/.test(cardText) && /#1005/.test(cardText), 'progress: finds the customer (case-insensitive)', cardText)
  t.check(/Penawaran/.test(cardText) && /Penawaran draf/.test(cardText), 'progress: position = Penawaran, status draft', cardText)
  t.check(/Langkah berikutnya: tinjau penawaran/.test(await lastBot(a).textContent()), 'progress: deterministic next step in the answer')
  t.check(await card.locator('.wg-step.is-done').count() === 1 && await card.locator('.wg-step.is-current').count() === 1, 'progress: mini stepper 1 done, 1 current')

  await ask(a, 'progres PT Maju Jaya')
  await a.waitForFunction(() => /PT Maju Jaya/.test(document.querySelector('[data-waguri-panel] .wg-msg.is-bot:not(.is-typing):last-child')?.textContent || ''), null, { timeout: 10000 }).catch(() => {})
  t.check(/sudah selesai dan dibukukan/.test(await lastBot(a).textContent()), 'progress: booked job reads as done')

  // "Buka di Alur kerja" opens the table filtered to that customer.
  await lastBot(a).locator('.wg-action', { hasText: 'Buka di Alur kerja' }).click()
  await a.waitForSelector('.view-workflow input[type=search]', { timeout: 10000 }).catch(() => {})
  t.check(await a.inputValue('.view-workflow input[type=search]').catch(() => '') === 'PT Maju Jaya', 'action opens Alur kerja searched for the customer')

  // Card button opens the stage of the next step.
  await a.locator(`${PANEL} [data-waguri-card="1005"] .wg-next`).first().click()
  await a.waitForTimeout(700)
  t.check(norm(await a.textContent('.crumb-title')) === 'Penawaran', 'next-step button opens the Penawaran stage')

  // Finance skill: deterministic totals from the seed ledger.
  await a.click(`${PANEL} .wg-skill[data-skill="finance"]`)
  await ask(a, 'Ringkas keuangan saya')
  await a.waitForFunction(() => /buku besar/.test(document.querySelector('[data-waguri-panel] .wg-msg.is-bot:not(.is-typing):last-child')?.textContent || ''), null, { timeout: 10000 }).catch(() => {})
  t.check(/pendapatan Rp9\.750\.000, biaya Rp3\.800\.000, laba Rp5\.950\.000/.test(norm(await lastBot(a).textContent())), 'finance: totals match the ledger')

  // Full-body view from the header avatar.
  await a.click(`${PANEL} .wg-head-ava`)
  await a.waitForSelector('[data-waguri-full]')
  const fullText = norm(await a.textContent('[data-waguri-full]'))
  t.check(/Waguri/.test(fullText) && /Asisten AI Satu Alur/.test(fullText) && /Kembali ke chat/.test(fullText), 'full-body view: name, subtitle, back button')
  t.check(await a.locator('[data-waguri-full] .wg-full-img').count() === 1, 'full-body view: picture (image or SVG fallback)')
  await a.waitForTimeout(400)
  await t.shot(a, 'app-full')
  await a.keyboard.press('Escape')
  t.check(await a.locator('[data-waguri-full]').count() === 0 && await a.locator(`${PANEL}:not([hidden])`).count() === 1, 'Esc leaves the full view, panel stays open')
  await a.click(`${PANEL} .wg-head-ava`)
  await a.click('[data-waguri-full] .wg-full-back')
  t.check(await a.locator('[data-waguri-full]').count() === 0, '"Kembali ke chat" returns to the chat')

  // Clear chat: confirm sheet, Batal keeps, Akhiri clears.
  await a.click(`${PANEL} .wg-head [aria-label="Hapus obrolan"]`)
  t.check(/Akhiri obrolan ini\?/.test(await a.textContent(`${PANEL} .wg-sheet`)), 'trash asks "Akhiri obrolan ini?"')
  await a.click(`${PANEL} .wg-sheet .wg-ghost`)
  t.check(await a.locator(`${PANEL} .wg-msg.is-user`).count() === 3, 'Batal keeps the conversation')
  await a.click(`${PANEL} .wg-head [aria-label="Hapus obrolan"]`)
  await a.click('[data-waguri-end]')
  t.check(await a.locator(`${PANEL} .wg-msg.is-user`).count() === 0 && await a.locator(`${PANEL} .wg-msg.is-bot`).count() === 1, 'Akhiri clears the chat (greeting only)')
  t.check(await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('satualur_waguri_chat:app')).length) === 0, 'cleared history removed from storage')
  await t.shot(a, 'app-open')
  await t.noErrors(a, 'app: no page errors')

  /* ---------------- phone ---------------- */
  const m = await t.page({ width: 390, height: 844, theme: 'dark' })
  await m.goto(`${t.base}/#/`, { waitUntil: 'load' })
  await m.waitForSelector(FAB, { timeout: 15000 })
  await m.click(FAB)
  await m.waitForSelector(`${PANEL}:not([hidden])`)
  await m.waitForTimeout(400) // open transition
  const box = await m.locator(PANEL).boundingBox()
  t.check(box && Math.round(box.width) === 390 && box.x === 0, 'phone: panel is a full-width sheet', JSON.stringify(box))
  t.check(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no horizontal scroll')
  await m.click('[data-waguri-consent]')
  await t.shot(m, 'phone-dark')
  await m.click(`${PANEL} .wg-head [aria-label="Tutup Waguri"]`)
  t.check(await m.locator(`${PANEL}[hidden]`).count() === 1, 'phone: close button closes the sheet')
  await t.noErrors(m, 'phone: no page errors')
}

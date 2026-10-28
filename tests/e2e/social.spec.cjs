// E2E: Media sosial workspace (mock AI) — tabs (keyboard), generate content,
// hashtag tool, save to library, schedule + mark posted + delete, ideas, library
// filter/search. Adapted from the ad-hoc social-test.cjs. TC-SOC-*.
const { loginLive, goStage, norm } = require('./lib.cjs')

module.exports = async function social(t) {
  const p = await t.page({ permissions: ['clipboard-read', 'clipboard-write'] })
  await loginLive(p, t.base)
  t.check(await goStage(p, 'social'), 'sidebar has "Media sosial"')
  await p.waitForSelector('#sm-panel-content')
  const tab = (name) => p.getByRole('tab', { name, exact: true })
  const selectedTab = () => p.$eval('[role=tab][aria-selected=true]', (e) => e.textContent.trim())
  const waitResult = async (panel) => { await p.waitForSelector(`#sm-panel-${panel} .sm-result`, { timeout: 25000 }); await p.waitForTimeout(500) }

  // tabs keyboard
  await tab('Konten').focus()
  await p.keyboard.press('ArrowRight')
  const second = await selectedTab()
  t.check(second !== 'Konten', 'ArrowRight moves to the next tab', second)
  await p.keyboard.press('Home')
  t.check(await selectedTab() === 'Konten', 'Home returns to the first tab')

  // content generation
  await p.click('#sm-panel-content .sm-chip')
  t.check((await p.inputValue('#sm-panel-content input[name=topic]')).length > 0, 'topic chip fills the topic field')
  await p.getByRole('button', { name: 'Buat konten' }).click()
  await waitResult('content')
  const body = norm(await p.textContent('#sm-panel-content .sm-result'))
  t.check(body.length > 40, 'content generated (mock AI)', body.length)
  t.check(await p.locator('#sm-panel-content .sm-hashtag').count() > 0, 'hashtags rendered as chips')
  t.check(/\d/.test(await p.textContent('#sm-panel-content .sm-count').catch(() => '')), 'character counter shown')
  await p.locator('#sm-panel-content').getByRole('button', { name: 'Simpan ke pustaka' }).click()
  await p.waitForSelector('#sm-panel-content .is-saved', { timeout: 5000 })
  t.check(true, '"Simpan ke pustaka" marks the result saved')

  // hashtag tool
  await p.fill('#sm-panel-content input[name=ht_topic]', 'cuci sofa bandung')
  await p.getByRole('button', { name: 'Buat hashtag' }).click()
  await p.waitForSelector('#sm-panel-content .sm-ht-result', { timeout: 15000 })
  const tags = await p.$$eval('.sm-ht-result .sm-hashtag', (els) => els.map((e) => e.textContent.trim()))
  t.check(tags.length > 0 && tags.every((x) => /^#\S+$/.test(x)), 'hashtag tool returns #tags without spaces', tags.slice(0, 5).join(' '))

  // schedule from content
  await p.locator('#sm-panel-content').getByRole('button', { name: 'Jadwalkan' }).click()
  await p.waitForTimeout(500)
  t.check(await selectedTab() === 'Jadwal', '"Jadwalkan" switches to the Jadwal tab')
  t.check((await p.inputValue('#sm-panel-schedule textarea[name=content]')).length > 20, 'schedule form prefilled with the content')
  const before = await p.locator('.sm-sched-item').count()
  await p.getByRole('button', { name: 'Tambah ke jadwal' }).click()
  await p.waitForTimeout(600)
  const d = new Date(Date.now() + 2 * 86400000)
  const pad = (n) => String(n).padStart(2, '0')
  await p.fill('#sm-panel-schedule textarea[name=content]', 'Tips E2E: bersihkan filter AC tiap dua minggu.')
  await p.fill('#sm-panel-schedule input[name=scheduled_at]', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`)
  await p.getByRole('button', { name: 'Tambah ke jadwal' }).click()
  await p.waitForTimeout(700)
  const after = await p.locator('.sm-sched-item').count()
  t.check(after === before + 2, 'two scheduled posts added', `${before} -> ${after}`)
  await p.locator('.sm-sched-item').first().getByRole('button', { name: 'Tandai terposting' }).click()
  await p.waitForTimeout(600)
  t.check(await p.locator('.sm-sched-item').count() === after - 1, '"Tandai terposting" moves item out of upcoming')
  const del = p.locator('.sm-sched-item').last().locator('.sm-del')
  await del.click()
  t.check(/yakin|hapus\?|konfirmasi|Klik lagi/i.test(norm(await del.textContent())), 'delete asks for a second click', norm(await del.textContent()))
  await del.click()
  await p.waitForTimeout(600)
  t.check(await p.locator('.sm-sched-item').count() === after - 2, 'second click deletes the scheduled post')
  await p.getByRole('radio', { name: 'Riwayat' }).click()
  await p.waitForTimeout(300)
  t.check(await p.locator('.sm-sched-item').count() >= 1, 'history shows the posted item')

  // ideas
  await tab('Ide').click()
  await p.fill('#sm-panel-ideas input[name=topic]', 'Tips perawatan AC di musim hujan')
  await p.getByRole('button', { name: 'Mulai brainstorm' }).click()
  await waitResult('ideas')
  t.check(await p.locator('#sm-panel-ideas .sm-result').count() >= 1, 'brainstorm returns ideas')
  await p.getByRole('button', { name: 'Simpan semua' }).click()
  await p.waitForTimeout(600)

  // library
  await tab('Pustaka').click()
  await p.waitForTimeout(500)
  const libAll = await p.locator('.sm-lib-item').count()
  t.check(libAll >= 2, 'library lists saved content and ideas', libAll)
  await p.getByRole('radio', { name: 'Ide' }).click()
  await p.waitForTimeout(300)
  const libIdeas = await p.locator('.sm-lib-item').count()
  t.check(libIdeas >= 1 && libIdeas < libAll, 'library filter "Ide" narrows the list', `${libIdeas}/${libAll}`)
  await p.getByRole('radio', { name: 'Semua' }).click()
  await p.fill('#sm-panel-library input[type=search]', 'zzzz-tidak-ada')
  await p.waitForTimeout(300)
  t.check(await p.isVisible('#sm-panel-library .empty-title'), 'library search with no match shows empty state')
  await p.fill('#sm-panel-library input[type=search]', '')
  await p.waitForTimeout(300)
  await p.locator('.sm-lib-item').first().getByRole('button', { name: 'Salin' }).click()
  await p.waitForTimeout(300)
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  t.check(clip.length > 10, '"Salin" copies the item text to the clipboard', clip.slice(0, 60))

  // stop button
  await tab('Konten').click()
  await p.getByRole('button', { name: 'Buat konten' }).click()
  await p.waitForTimeout(200)
  await p.locator('#sm-panel-content .console-stop').first().click().catch(() => {})
  await p.waitForTimeout(500)
  t.check(/Dihentikan|Selesai/.test(await p.textContent('#sm-panel-content .console-status').catch(() => '')), 'stop button ends the stream')
  await t.noErrors(p)
}

// E2E: "Alur kerja" — one sidebar menu, one table row per job, status shows how far each job has gone,
// the next-step button opens the right stage page and the topbar leads back to the table.
const { loginLive, goStage, norm, isMobile } = require('./lib.cjs')

module.exports = async function workflow(t) {
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const tag = size.width < 1024 ? 'mobile' : 'desktop'
    const p = await t.page(size)
    await loginLive(p, t.base)

    // The five stage pages are no longer separate sidebar items.
    t.check(await p.locator('.side .flow-item[data-stage="workflow"]').count() === 1, `${tag}: sidebar has one "Alur kerja" item`)
    t.check(await p.locator('.side .flow-item[data-stage="request"], .side .flow-item[data-stage="offer"], .side .flow-item[data-stage="assign"], .side .flow-item[data-stage="complete"], .side .flow-item[data-stage="bookkeeping"]').count() === 0, `${tag}: no separate stage items in the sidebar`)

    t.check(await goStage(p, 'workflow'), `${tag}: open Alur kerja`)
    await p.waitForSelector('.wf-row', { timeout: 15000 })
    const rows = await p.locator('.wf-row').count()
    const all = Number(norm(await p.textContent('.wf-filter[data-filter="all"] .wf-filter-count')))
    t.check(rows > 0 && all >= rows, `${tag}: table lists one row per job`, `${rows}/${all}`)
    t.check(await p.locator('.wf-row').first().locator('.wf-steps .wf-step').count() === 5, `${tag}: each row shows the five-step position`)

    // Filter: only jobs at Penawaran.
    await p.click('.wf-filter[data-filter="offer"]')
    await p.waitForTimeout(300)
    const offerCount = Number(norm(await p.textContent('.wf-filter[data-filter="offer"] .wf-filter-count')))
    t.check(await p.locator('.wf-row').count() === Math.min(offerCount, 10) && await p.locator('.wf-row:not([data-position="draft"]):not([data-position="rejected"])').count() === 0, `${tag}: filter "Penawaran" shows only draft/rejected offers`)

    if (!isMobile(p)) {
      // Detail dialog with the job's journey.
      await p.locator('.wf-open').first().click()
      await p.waitForSelector('dialog.modal[open] .wf-timeline')
      t.check(await p.locator('dialog.modal[open] .wf-tl').count() === 5 && await p.locator('dialog.modal[open] .wf-tl.is-current').count() === 1, 'detail: timeline with five steps and one current step')
      await p.keyboard.press('Escape')
      await p.waitForTimeout(200)

      // Next step opens the offer page focused on that offer; topbar leads back.
      const name = norm(await p.locator('.wf-row').first().locator('.wf-open').textContent()).replace(/^#\d+\s*/, '')
      await p.locator('.wf-row').first().locator('.wf-next').click()
      await p.waitForTimeout(900)
      t.check(norm(await p.textContent('.crumb-title')) === 'Penawaran' && await p.locator('.flow-item[data-stage="workflow"][aria-current="page"]').count() === 1, 'next step opens Penawaran, sidebar keeps "Alur kerja" active')
      t.check(norm(await p.locator('.view tr.is-focus').first().textContent()).includes(name), 'the offer of that job is focused', name)
      await p.getByRole('button', { name: 'Kembali ke alur kerja' }).click()
      await p.waitForSelector('.wf-row', { timeout: 10000 })
      t.check(await p.locator('.wf-filter[data-filter="offer"]').getAttribute('aria-pressed') === 'true', '"Kembali ke alur kerja" returns to the table with the same filter')

      // Search
      await p.click('.wf-filter[data-filter="all"]')
      await p.fill('.wf-panel input[type=search]', name)
      await p.waitForTimeout(300)
      t.check(await p.locator('.wf-row').count() >= 1 && norm(await p.locator('.wf-row').first().textContent()).includes(name), 'search finds the job by customer name')
    }
    await t.shot(p, `workflow-${tag}`)
    await t.noErrors(p, `${tag}: no uncaught page errors`)
  }
}

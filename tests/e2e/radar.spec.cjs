// E2E: Radar peluang ('radar') — smoke only. The feature is being built in parallel; when
// its sidebar item is missing the spec records TODO instead of failing.
// TODO(automation): replace the smoke checks with the TC-RAD-* cases in
// docs/uat/2026-10-29_test-cases.md once src/stages/radar.js is merged.
const { loginLive, goStage, norm } = require('./lib.cjs')

module.exports = async function radar(t) {
  const p = await t.page()
  await loginLive(p, t.base)
  if (!(await p.locator('.flow-item[data-stage="radar"]').count())) {
    t.todo('Radar peluang e2e', 'sidebar item .flow-item[data-stage="radar"] not present yet (feature in progress)')
    return
  }
  t.check(norm(await p.textContent('.flow-item[data-stage="radar"]')).includes('Radar peluang'), 'sidebar label "Radar peluang"')
  await goStage(p, 'radar')
  await p.waitForTimeout(1500)
  t.check(await p.locator('.view').count() === 1 && norm(await p.textContent('.view')).length > 20, 'stage renders content')
  t.check(!/Gagal memuat|Terjadi kesalahan/i.test(await p.textContent('.view')), 'no load error shown')
  await t.noErrors(p)
}

/**
 * Shared helpers for the e2e specs (Playwright, preinstalled — not a package dependency).
 *
 * Every spec exports `async function (t)` where `t` is created by `makeContext()`:
 *   t.check(cond, label)        record PASS/FAIL (never throws)
 *   t.bug(cond, label, id)      expected behaviour blocked by a reported bug (KNOWN-BUG, not a failure)
 *   t.todo(label, reason)       automation not written yet
 *   t.page(opts)                new page in a fresh context (fresh localStorage = fresh mock seed)
 *   t.base                      server base URL (http://localhost:5199)
 * Mock sessions are in-memory: log in and test within the same page load.
 */
const path = require('path')

const STAGE_LABELS = {
  dashboard: 'Ringkasan', request: 'Permintaan', offer: 'Penawaran', assign: 'Penugasan',
  complete: 'Penyelesaian', bookkeeping: 'Pembukuan', report: 'Laporan',
  'social-media': 'Media Sosial', advisor: 'Penasihat AI', radar: 'Radar peluang', leads: 'Pencari prospek',
}

function makeContext({ browser, base, spec, results, shotDir }) {
  const pages = []
  const t = {
    base,
    spec,
    check(cond, label, detail) {
      const ok = Boolean(cond)
      results.push({ spec, label, ok, detail })
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `  (${String(detail).slice(0, 200)})` : ''}`)
      return ok
    },
    /**
     * Expected behaviour blocked by a known, reported app bug: a failing check is
     * recorded as KNOWN-BUG (does not fail the run); a passing one prints a notice
     * so the bug can be closed and the check turned into a plain t.check().
     */
    bug(cond, label, bugId, detail) {
      const ok = Boolean(cond)
      results.push({ spec, label, ok: true, bug: bugId, fixed: ok })
      console.log(`  ${ok ? 'PASS' : 'KNOWN-BUG'}  ${label}  [${bugId}${ok ? ' looks fixed: change to t.check' : ''}]${!ok && detail !== undefined ? `  (${String(detail).slice(0, 160)})` : ''}`)
      return ok
    },
    todo(label, reason) {
      results.push({ spec, label, ok: true, todo: reason })
      console.log(`  TODO  ${label}  (${reason})`)
    },
    async page({ width = 1440, height = 900, theme = 'light', reducedMotion, permissions, timezoneId } = {}) {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, permissions, timezoneId })
      const page = await ctx.newPage()
      page.errors = []
      page.on('pageerror', (e) => page.errors.push(String(e)))
      page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()) })
      // Initial theme only; a theme the page stored itself (toggle) wins on reload.
      await page.addInitScript((th) => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', th) } catch { /* */ } }, theme)
      pages.push(page)
      return page
    },
    async shot(page, name) {
      if (!shotDir) return
      await page.screenshot({ path: path.join(shotDir, `${spec}-${name}.png`) }).catch(() => {})
    },
    async noErrors(page, label = 'no uncaught page errors') {
      // 404s for optional assets and the dev-only WebGL warnings are not app errors.
      const errs = page.errors.filter((e) => !/favicon|WebGL|GPU stall|GL_|Failed to load resource/i.test(e))
      t.check(errs.length === 0, label, errs.join(' | '))
    },
    async closeAll() {
      for (const p of pages) await p.context().close().catch(() => {})
    },
  }
  return t
}

/** Logs in through the real Live (email + OTP) UI in mock mode and lands on #/app. */
async function loginLive(page, base, email = 'qa@satualur.id') {
  await page.goto(`${base}/#/masuk`, { waitUntil: 'load' })
  await page.waitForSelector('#auth-email')
  await page.fill('#auth-email', email)
  await page.click('.auth-form-email button[type=submit]')
  await page.waitForSelector('.auth-demo:not([hidden])', { timeout: 10000 })
  await page.click('.auth-demo-fill')
  await page.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 10000 })
  await page.waitForSelector('.app-shell')
  // The shell reopens the last stage of this tab (sessionStorage); only the dashboard has KPIs.
  const stage = await page.evaluate(() => document.querySelector('.flow-item[aria-current="page"]')?.dataset.stage || 'dashboard')
  if (stage === 'dashboard') await waitDashboard(page)
  else await page.waitForTimeout(800)
}

/** Waits until the dashboard KPIs rendered (no skeletons). */
async function waitDashboard(page) {
  await page.waitForSelector('.kpis:not(.is-loading) .kpi-value', { timeout: 20000 })
}

const isMobile = (page) => (page.viewportSize()?.width || 1440) < 1024

/** Opens a stage from the sidebar (opens the drawer menu first on small screens). */
async function goStage(page, key) {
  const item = page.locator(`.flow-item[data-stage="${key}"]`)
  if (!(await item.count())) return false
  if (!(await item.first().isVisible())) {
    await page.click('.topbar-menu')
    await page.waitForTimeout(350)
  }
  await item.first().click()
  await page.waitForTimeout(600)
  return true
}

/** Text of a KPI value once the count-up animation settled. */
async function kpiValue(page, label, scope = '.view') {
  return page.evaluate(async ({ label, scope }) => {
    const find = () => [...document.querySelectorAll(`${scope} .kpi`)].find((k) => k.querySelector('.kpi-label')?.textContent.trim() === label)?.querySelector('.kpi-value')
    let last = null
    for (let i = 0; i < 40; i++) {
      const v = find()?.textContent.replace(/\s/g, ' ').trim() ?? null
      if (v !== null && v === last) return v
      last = v
      await new Promise((r) => setTimeout(r, 120))
    }
    return last
  }, { label, scope })
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

module.exports = { makeContext, loginLive, waitDashboard, goStage, kpiValue, isMobile, norm, STAGE_LABELS }

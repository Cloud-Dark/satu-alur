// E2E: mobile layout sweep at 390×844. Every business stage (live and demo
// account), every Pengaturan tab and every Kantor page must fit the viewport:
// no horizontal page scroll and no visible element sticking out of the screen
// (horizontal scrollers such as tab bars and tables are allowed to scroll inside).
// Overlaps between small controls (tags, buttons, chips) are checked too.
// SWEEP_VERBOSE=1 prints every offender.
const { loginLive, goStage } = require('./lib.cjs')

const BIZ = ['dashboard', 'request', 'offer', 'assign', 'complete', 'bookkeeping', 'report', 'vas', 'zero-waste',
  'radar', 'leads', 'social-media', 'advisor', 'ai-assistant', 'pertumbuhan', 'plan', 'support']
const OFFICE = ['landing', 'about', 'legal', 'plans', 'gateway', 'vouchers', 'customers', 'users', 'contact', 'tickets',
  'influencers', 'requests', 'campaigns', 'sys-overview', 'sys-email', 'sys-ai', 'sys-login', 'sys-access', 'sys-whatsapp', 'sys-activity']
const verbose = !!process.env.SWEEP_VERBOSE

/** Runs in the page: horizontal overflow and overlapping small controls. */
function inspect() {
  const vw = window.innerWidth
  const describe = (n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}.${[...n.classList].slice(0, 3).join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`
  const visible = (n) => {
    const s = getComputedStyle(n)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    const r = n.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  // Inside a horizontal scroller, a leaflet map, a closed drawer or an sr-only box, sticking out is fine.
  const contained = (n) => {
    for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth >= p.clientWidth) {
        const r = p.getBoundingClientRect()
        if (r.left >= -1 && r.right <= vw + 1) return true
      }
      if (p.classList.contains('leaflet-container') || p.classList.contains('sr-only')) return true
      if (p.matches('.drawer:not(.is-open), .side:not(.is-open), [hidden], dialog:not([open])')) return true
    }
    return false
  }
  const out = []
  const root = document.querySelector('.drawer.is-open .drawer-body') || document.querySelector('dialog[open]') || document.querySelector('.app-shell') || document.body
  for (const n of root.querySelectorAll('*')) {
    if (n.closest('.sr-only, svg, .leaflet-container, .combo-pop')) continue
    if (!visible(n)) continue
    const r = n.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !contained(n)) out.push(`out of screen: ${describe(n)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
    if (out.length > 12) break
  }
  const small = [...root.querySelectorAll('.tag, .btn, .chip, .icon-btn, .avatar, .seg-btn, .badge')].filter(visible)
  const overlaps = []
  for (let i = 0; i < small.length; i++) {
    for (let j = i + 1; j < small.length; j++) {
      const a = small[i]
      const b = small[j]
      if (a.contains(b) || b.contains(a)) continue
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (w > 2 && h > 2) overlaps.push(`overlap: ${describe(a)} × ${describe(b)}`)
    }
  }
  return {
    scroll: document.documentElement.scrollWidth - vw,
    drawerScroll: (() => { const d = document.querySelector('.drawer.is-open .drawer-body'); return d ? d.scrollWidth - d.clientWidth : 0 })(),
    out,
    overlaps: overlaps.slice(0, 8),
    nullText: /(^|[\s>])(null|undefined)([\s<]|$)/.test(root.innerText || ''),
  }
}

async function sweep(t, page, label) {
  await page.waitForTimeout(700)
  const r = await page.evaluate(inspect)
  const ok = r.scroll <= 0 && r.drawerScroll <= 0 && !r.out.length
  if (verbose && (!ok || r.overlaps.length || r.nullText)) console.log(`    [${label}] scroll=${r.scroll} drawer=${r.drawerScroll}\n      ${[...r.out, ...r.overlaps].join('\n      ')}${r.nullText ? '\n      "null"/"undefined" text' : ''}`)
  t.check(ok, `390px ${label}: fits the screen`, `${r.scroll}/${r.drawerScroll} ${r.out.slice(0, 3).join(' | ')}`)
  t.check(!r.overlaps.length, `390px ${label}: no overlapping controls`, r.overlaps.slice(0, 2).join(' | '))
  t.check(!r.nullText, `390px ${label}: no stray "null"/"undefined" text`)
}

module.exports = async function mobileSweep(t) {
  for (const [who, email] of [['live', 'qa-mobile@contoh.id'], ['demo', null]]) {
    const p = await t.page({ width: 390, height: 844 })
    if (email) await loginLive(p, t.base, email)
    else {
      await p.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
      await p.waitForSelector('#auth-mode-demo')
      await p.click('#auth-mode-demo')
      await p.waitForTimeout(300)
      await p.click('.auth-form-demo button[type=submit]')
      await p.waitForSelector('.app-shell', { timeout: 60000 })
      await p.waitForTimeout(1500)
    }
    for (const key of BIZ) {
      if (!(await goStage(p, key))) continue
      await sweep(t, p, `${who} ${key}`)
      if (key === 'assign') {
        for (const tab of ['team', 'map', 'performance']) {
          await p.locator(`.seg-btn[data-value="${tab}"]`).first().click()
          await sweep(t, p, `${who} assign › ${tab}`)
        }
      }
    }
    if (who === 'live') {
      // Pengaturan drawer: every tab, the tab bar scrolls inside its own box.
      await p.click('.topbar-menu').catch(() => {})
      await p.waitForTimeout(300)
      await p.locator('.side-row', { hasText: 'Pengaturan' }).first().click()
      await p.waitForSelector('.drawer.is-open')
      const tabs = await p.$$eval('.drawer .seg-btn', (b) => b.map((x) => x.dataset.value))
      for (const v of tabs) {
        await p.click(`.drawer .seg-btn[data-value="${v}"]`)
        await sweep(t, p, `Pengaturan › ${v}`)
      }
      const last = await p.evaluate(() => {
        const btn = [...document.querySelectorAll('.drawer .seg-btn')].pop()
        const bar = btn.closest('.seg')
        const r = btn.getBoundingClientRect()
        const b = bar.getBoundingClientRect()
        return { inBar: r.left >= b.left - 1 && r.right <= b.right + 1, scrolls: bar.scrollWidth > bar.clientWidth }
      })
      t.check(last.inBar, 'Pengaturan: the active last tab is scrolled into view inside the tab bar', JSON.stringify(last))
      await p.keyboard.press('Escape')
    }
    await t.noErrors(p, `390px ${who}: no uncaught page errors`)
  }

  const s = await t.page({ width: 390, height: 844 })
  await s.goto(`${t.base}/super-admin-login`, { waitUntil: 'load' })
  await s.waitForSelector('#staff-username')
  await s.fill('#staff-username', 'staff')
  await s.fill('#staff-password', 'rahasia-staf-123')
  await s.getByRole('button', { name: 'Masuk' }).click()
  await s.waitForSelector('.app-shell')
  for (const key of OFFICE) {
    if (!(await goStage(s, key))) continue
    await sweep(t, s, `Kantor ${key}`)
  }
}

/**
 * Records the Satu Alur demo video (storyboard: ../demo-video-script.md).
 *
 * Runs against the app in mock mode (fictional demo data, simulated AI), e.g.:
 *   VITE_USE_MOCK=true VITE_STAFF_USERS='staf:demo-staf-2026' npx vite --port 5281 --strictPort
 *   node docs/lomba/video/record.cjs http://localhost:5281 docs/lomba/video/out
 *
 * Writes <out>/raw.webm (1920×1080) and <out>/scenes.json: scene start/end in
 * seconds plus "fast" intervals (loading and AI waits) that build.sh speeds up
 * and labels "dipercepat". Each scene is wrapped in
 * try/catch so one changed selector never aborts the whole recording.
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://localhost:5281'
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'out'))
const STAFF = { user: 'staf', pass: 'demo-staf-2026' }
const W = 1920
const H = 1080

/* Overlay: lower-third caption, "Data demo fiktif" badge, cursor dot + click ripple. */
function overlayScript() {
  const css = `
  #vd-cap{position:fixed;left:48px;bottom:44px;z-index:2147483646;display:flex;align-items:center;gap:14px;
    padding:16px 26px 16px 18px;border-radius:18px;background:rgba(250,246,236,.96);color:#173f33;
    box-shadow:0 18px 50px -18px rgba(19,66,53,.45),0 0 0 1px rgba(19,66,53,.12);
    font:600 26px/1.25 "Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:-.01em;max-width:1200px;
    opacity:0;transform:translateY(12px);transition:opacity .35s ease,transform .35s ease;pointer-events:none}
  #vd-cap.on{opacity:1;transform:none}
  #vd-cap i{display:block;width:10px;height:44px;border-radius:6px;background:#e7a13a;flex:none}
  #vd-cap small{display:block;font-weight:500;font-size:17px;color:#4d6b60;margin-top:4px}
  #vd-badge{position:fixed;right:28px;bottom:24px;z-index:2147483646;padding:6px 12px;border-radius:999px;
    background:rgba(23,63,51,.82);color:#f6f0e2;font:600 13px/1 "Plus Jakarta Sans",system-ui,sans-serif;pointer-events:none}
  #vd-cur{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
    background:rgba(231,161,58,.92);box-shadow:0 0 0 3px rgba(255,255,255,.9),0 4px 14px rgba(0,0,0,.25);
    z-index:2147483647;pointer-events:none;transition:transform .08s ease}
  #vd-cur.down{transform:scale(.75)}
  .vd-rip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #e7a13a;
    z-index:2147483647;pointer-events:none;animation:vdrip .55s ease-out forwards}
  @keyframes vdrip{to{transform:scale(4.2);opacity:0}}`
  const mount = () => {
    if (document.getElementById('vd-cur')) return
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    const cap = document.createElement('div'); cap.id = 'vd-cap'; cap.innerHTML = '<i></i><div><span></span><small></small></div>'
    const badge = document.createElement('div'); badge.id = 'vd-badge'; badge.textContent = 'Data demo fiktif'
    const cur = document.createElement('div'); cur.id = 'vd-cur'
    document.body.append(cap, badge, cur)
    const last = window.__vdPos || { x: 960, y: 540 }
    cur.style.left = `${last.x}px`; cur.style.top = `${last.y}px`
    if (window.__vdCap) window.__vdSetCap(window.__vdCap.t, window.__vdCap.s)
  }
  window.__vdSetCap = (t, s) => {
    window.__vdCap = t ? { t, s } : null
    const cap = document.getElementById('vd-cap'); if (!cap) return
    cap.querySelector('span').textContent = t || ''
    cap.querySelector('small').textContent = s || ''
    cap.classList.toggle('on', Boolean(t))
  }
  addEventListener('mousemove', (e) => {
    window.__vdPos = { x: e.clientX, y: e.clientY }
    const c = document.getElementById('vd-cur'); if (c) { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px` }
  }, true)
  addEventListener('mousedown', (e) => {
    document.getElementById('vd-cur')?.classList.add('down')
    const r = document.createElement('div'); r.className = 'vd-rip'; r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`
    document.body.appendChild(r); setTimeout(() => r.remove(), 600)
  }, true)
  addEventListener('mouseup', () => document.getElementById('vd-cur')?.classList.remove('down'), true)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()
  const watch = () => new MutationObserver(() => { if (!document.getElementById('vd-cur') && document.body) mount() }).observe(document.documentElement, { childList: true, subtree: true })
  if (document.documentElement) watch(); else addEventListener('DOMContentLoaded', watch)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    locale: 'id-ID', timezoneId: 'Asia/Jakarta',
  })
  await ctx.addInitScript(overlayScript)
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light') } catch { /* */ } })
  const page = await ctx.newPage()
  const t0 = Date.now()
  const now = () => (Date.now() - t0) / 1000
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const wait = (ms) => page.waitForTimeout(ms)
  const cap = (t, s = '') => page.evaluate(([a, b]) => window.__vdSetCap?.(a, b), [t, s]).catch(() => {})
  let pos = { x: W / 2, y: H / 2 }
  async function moveTo(x, y, steps = 28) {
    await page.mouse.move(x, y, { steps })
    pos = { x, y }
  }
  async function hover(target, { steps = 28, pause = 350 } = {}) {
    const loc = typeof target === 'string' ? page.locator(target).first() : target
    await loc.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {})
    const b = await loc.boundingBox({ timeout: 4000 })
    if (!b) throw new Error(`no box for ${target}`)
    await moveTo(b.x + b.width / 2, b.y + Math.min(b.height / 2, 22), steps)
    await wait(pause)
    return loc
  }
  async function click(target, opts = {}) {
    await hover(target, opts)
    await page.mouse.down(); await wait(70); await page.mouse.up()
    await wait(opts.after ?? 600)
  }
  async function type(target, text, delay = 55) {
    await click(target, { after: 200 })
    await page.keyboard.type(text, { delay })
  }
  async function smoothScroll(dy, ms = 1600) {
    await page.evaluate(([d, m]) => new Promise((res) => {
      const el = document.scrollingElement; const s = el.scrollTop; const t = performance.now()
      const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)
      const f = (n) => { const k = Math.min(1, (n - t) / m); el.scrollTop = s + d * ease(k); k < 1 ? requestAnimationFrame(f) : res() }
      requestAnimationFrame(f)
    }), [dy, ms])
  }
  async function stage(key) {
    await click(`.flow-item[data-stage="${key}"]`, { after: 1100 })
    await page.evaluate(() => scrollTo(0, 0))
  }
  const scenes = []
  const fastSpans = []
  /** Runs fn and records its interval to be sped up by `speed` in the edit. */
  async function fast(speed, fn) {
    const from = now()
    try { await fn() } finally { fastSpans.push({ from: +from.toFixed(2), to: +now().toFixed(2), speed }) }
  }
  async function scene(n, title, sub, fn) {
    const start = now()
    await cap(title, sub)
    try { await fn() } catch (e) { console.warn(`scene ${n}: ${e.message.split('\n')[0]}`) }
    scenes.push({ n, title, start: +start.toFixed(2), end: +now().toFixed(2) })
    console.log(`scene ${n} ${start.toFixed(1)}–${now().toFixed(1)}s ${title}`)
  }

  /* 1 — Landing */
  await page.goto(`${BASE}/#/`, { waitUntil: 'load' })
  await wait(1200)
  await scene(1, 'Kerja tercecer di chat, catatan, dan spreadsheet', 'Satu Alur menyatukannya dalam satu alur kerja', async () => {
    await moveTo(1100, 420, 20)
    await wait(1800)
    await smoothScroll(900, 2600)
    await wait(1400)
    await smoothScroll(800, 2400)
    await wait(1200)
  })

  /* 2 — Demo login */
  await scene(2, '9 akun demo · 3 skala usaha', 'Masuk sebagai CV Basmi Hama Nusantara (UKM)', async () => {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await wait(900)
    await page.goto(`${BASE}/#/masuk`, { waitUntil: 'load' })
    await page.waitForSelector('#auth-mode-demo'); await wait(700)
    await click('#auth-mode-demo', { after: 700 })
    await click(page.locator('.auth-form-demo .combo-trigger').nth(0), { after: 500 })
    await page.keyboard.type('ukm', { delay: 90 }); await wait(300); await page.keyboard.press('Enter'); await wait(500)
    await click(page.locator('.auth-form-demo .combo-trigger').nth(1), { after: 500 })
    await page.keyboard.type('hama', { delay: 90 }); await wait(400)
    // Picking an account builds its 12-month demo data, which freezes the page for a while.
    await fast(10, async () => {
      await page.keyboard.press('Enter'); await wait(600)
      await page.waitForSelector('.auth-demo-preview', { timeout: 30000 }).catch(() => {})
      await click('.auth-form-demo button[type=submit]', { after: 300 })
      await page.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 40000 })
      await page.waitForSelector('.kpis:not(.is-loading) .kpi-value', { timeout: 40000 })
    })
    await wait(600)
  })

  /* 3 — Dashboard */
  await scene(3, 'Monitoring proses, langsung dari data', 'Laba, pendapatan, biaya, dan tahap yang tertahan', async () => {
    await wait(800)
    await hover('.kpi', { pause: 1500 })
    await hover(page.locator('.kpi').nth(1), { pause: 900 })
    await smoothScroll(520, 1800); await wait(900)
    await hover('.view .panel, .view section', { pause: 1400 })
    await smoothScroll(-520, 1200); await wait(500)
  })

  /* 4 — Offer: new request first, then AI offer */
  const CUSTOMER = 'Hotel Bumi Asri Surabaya'
  await scene(4, 'Agen penawaran + validasi aturan domain', 'AI menyusun ruang lingkup, harga, dan ketentuan — Anda yang memutuskan', async () => {
    await stage('request')
    await type('input[name="customer_name"]', CUSTOMER, 35)
    await type('input[name="location"]', 'Surabaya', 45)
    await page.keyboard.press('Enter'); await wait(600)
    await type('input[name="service_type"]', 'Pengendalian rayap & kecoa', 30)
    await fast(2.5, () => type('textarea[name="description"]', 'Treatment rayap dan kecoa untuk dapur hotel 3 lantai, termasuk area gudang.', 18))
    await click('.wiz-primary', { after: 700 })
    await click('.wiz-primary', { after: 300 })
    await page.waitForSelector('.wiz-done:not([hidden])', { timeout: 15000 }); await wait(700)
    await click('.wiz-done-actions .btn-primary', { after: 1200 }) // Buat penawaran
    await click('.wiz-primary', { after: 300 }) // Susun dengan AI
    await fast(3, () => page.waitForFunction(() => document.querySelector('.wiz-pane:not([hidden])')?.dataset.step === 'review', null, { timeout: 40000 }))
    await wait(900)
    await hover('input[name="validated_price"]', { pause: 1200 })
    await hover('.chip', { pause: 900 }).catch(() => {})
    await click('.wiz-primary', { after: 300 })
    await page.waitForSelector('.wiz-done:not([hidden])', { timeout: 15000 }); await wait(1300)
  })

  /* 5 — Assign + complete */
  await scene(5, 'Penugasan → Penyelesaian', 'Tetapkan petugas dan jadwal, lalu tutup pekerjaan dengan satu klik', async () => {
    await click('.wiz-done-actions .btn-primary', { after: 1200 }) // Tugaskan pekerja
    await page.waitForSelector('.worker-pick input[type="checkbox"]', { timeout: 10000 })
    await click(page.locator('.worker-pick label').first(), { after: 500 })
    await click('.form-panel button[type="submit"]', { after: 400 })
    await page.getByRole('button', { name: 'Tandai selesai nanti', exact: true }).waitFor({ timeout: 10000 }).catch(() => {})
    await wait(800)
    await click(page.getByRole('button', { name: 'Tandai selesai nanti', exact: true }), { after: 1100 })
    await fast(2.5, () => type('textarea[name="notes"]', 'Treatment selesai, dapur dan gudang bersih. Kontrol ulang 30 hari.', 18))
    await click('.wiz-primary', { after: 300 })
    await page.waitForSelector('.wiz-done:not([hidden])', { timeout: 15000 }); await wait(900)
  })

  /* 6 — Bookkeeping */
  await scene(6, 'Jurnal per pekerjaan · saldo berjalan', 'Pendapatan tidak bisa diposting dua kali', async () => {
    await click('.wiz-done-actions .btn-primary', { after: 1200 })
    await click('select[name="category"]', { after: 200 }).catch(() => {})
    await page.selectOption('select[name="category"]', 'pendapatan'); await wait(900)
    await hover('input[name="amount"]', { pause: 800 })
    await click('.wiz-primary', { after: 900 })
    await click('.wiz-primary', { after: 300 })
    await page.waitForSelector('.wiz-done:not([hidden])', { timeout: 15000 }); await wait(1200)
  })

  /* 7 — Report AI */
  await scene(7, 'Agen laporan · jawaban mengalir langsung', 'AI menjelaskan angka periode dan memberi rekomendasi', async () => {
    await stage('report')
    await page.waitForSelector('.view .kpis .kpi-value', { timeout: 15000 }); await wait(700)
    await click('.view .seg-btn[data-value="30d"]', { after: 700 }).catch(() => {})
    await click(page.getByRole('button', { name: 'Jelaskan dengan AI' }), { after: 400 })
    await page.waitForSelector('.report-ai-out .console', { timeout: 8000 })
    await wait(800)
    await page.locator('.report-ai-out').scrollIntoViewIfNeeded().catch(() => {})
    await fast(3, () => page.waitForFunction(() => /Selesai|Dihentikan|Gagal/.test(document.querySelector('.report-ai-out .console-status')?.textContent || ''), null, { timeout: 40000 }).catch(() => {}))
    await wait(1500)
  })

  /* 8 — VAS + Zero waste */
  await scene(8, 'Mesin pendapatan: VAS + Tanpa limbah', 'Layanan tambahan yang tersirat, dan kebocoran biaya di lima aliran', async () => {
    await stage('vas'); await wait(900)
    await click(page.locator('.seg-btn', { hasText: 'Peluang' }).first(), { after: 1200 }).catch(() => {})
    await hover('.view .panel, .view article, .view .card', { pause: 1600 }).catch(() => {})
    await smoothScroll(420, 1500); await wait(800); await smoothScroll(-420, 900)
    await stage('zero-waste'); await wait(900)
    await click(page.locator('.seg-btn', { hasText: 'Pemborosan' }).first(), { after: 1500 }).catch(() => {})
    await smoothScroll(420, 1500); await wait(900); await smoothScroll(-420, 900)
  })

  /* 9 — Optimization room */
  await scene(9, 'Multi-agen: 5 tim + 1 pimpinan', 'Satu pertanyaan, lima tim AI menjawab paralel, lalu dirangkum', async () => {
    await click(page.locator('.seg-btn', { hasText: 'Ruang optimasi' }).first(), { after: 900 })
    await page.locator('.opt-team').first().waitFor({ timeout: 8000 })
    await click(page.locator('.opt-preset').first(), { after: 600 })
    await click(page.getByRole('button', { name: 'Jalankan 5 tim' }), { after: 600 })
    await fast(4, () => page.waitForFunction(() => {
      const text = document.querySelector('.opt-lead .opt-md')?.textContent || ''
      return text.length > 80 && !text.includes('Menyatukan') && !text.includes('Kesimpulan muncul')
    }, null, { timeout: 60000 }).catch(() => {}))
    await page.locator('.opt-lead').scrollIntoViewIfNeeded().catch(() => {})
    await wait(1800)
  })

  /* 10 — Radar */
  await scene(10, 'Peluang dari data sendiri · bisa diperiksa', 'Pelanggan jatuh tempo, penawaran tertahan, musim ramai', async () => {
    await stage('radar'); await wait(1600)
    const why = page.locator('.rd-why summary').first()
    await hover('.rd-card-title-btn', { pause: 900 }).catch(() => {})
    await click(why, { after: 1800 })
    await hover(page.locator('.rd-card-title-btn').nth(1), { pause: 900 }).catch(() => {})
  })

  /* 11 — Leads */
  await scene(11, 'Data peta legal · tanpa scraping', 'AI menilai kecocokan prospek — tanpa pesan otomatis', async () => {
    await stage('leads')
    await page.waitForSelector('.ld-map .leaflet-container, .ld-map.leaflet-container', { timeout: 15000 }); await wait(800)
    await type('#ld-addr', 'Surabaya', 80)
    let ok = await page.waitForSelector('#ld-addr-list .ld-suggest-item', { timeout: 5000 }).then(() => true).catch(() => false)
    if (!ok) {
      await page.fill('#ld-addr', '')
      await page.keyboard.type('Bekasi', { delay: 80 })
      ok = await page.waitForSelector('#ld-addr-list .ld-suggest-item', { timeout: 5000 }).then(() => true).catch(() => false)
    }
    if (ok) await click('#ld-addr-list .ld-suggest-item', { after: 900 })
    await click('.ld-search-btn', { after: 900 })
    await fast(3, () => page.waitForFunction(() => !document.querySelector('.ld-map-wrap.is-locked'), null, { timeout: 45000 }).catch(() => {}))
    await wait(1500)
    await smoothScroll(500, 1500); await wait(1200); await smoothScroll(-500, 900)
  })

  /* 12 — Social media */
  await scene(12, 'Konten & jadwal media sosial', 'Konten per platform ditulis AI, lalu dijadwalkan', async () => {
    await stage('social-media'); await wait(800)
    await click(page.getByRole('radio', { name: 'Konten', exact: true }), { after: 700 })
    await page.waitForSelector('#sm-topic', { timeout: 8000 })
    await page.selectOption('#sm-platform', { label: 'Instagram' }).catch(() => {})
    await type('#sm-topic', 'Tips cegah rayap musim hujan', 45)
    await click(page.getByRole('button', { name: 'Buat konten' }), { after: 500 })
    await fast(3, () => page.waitForSelector('.workspace-output .sm-composer', { timeout: 25000 }).catch(() => {}))
    await page.locator('.workspace-output').scrollIntoViewIfNeeded().catch(() => {})
    await wait(1800)
    await click(page.getByRole('radio', { name: 'Jadwal', exact: true }), { after: 1500 }).catch(() => {})
  })

  /* 13 — Advisor */
  await scene(13, '5 penasihat · konteks dari bisnis Anda', 'Pertanyaan strategis dijawab dari angka usaha sendiri', async () => {
    await stage('advisor'); await wait(900)
    const chip = page.locator('.adv-chip:visible', { hasText: 'naik 2%' }).first()
    const sug = page.getByRole('button', { name: /naik 2% bulan depan/ }).first()
    if (await sug.isVisible().catch(() => false)) await click(sug, { after: 400 })
    else if (await chip.count()) { await chip.click(); await wait(400) }
    else { await type('.adv-input', 'Bagaimana naik 2% bulan depan?', 45); await click('.adv-send', { after: 400 }) }
    await fast(2.5, () => wait(7000))
    await wait(1500)
  })

  /* 14 — Office (super-admin) */
  await scene(14, 'Kantor Satu Alur (super-admin)', 'Paket, pelanggan, CS, dan kampanye influencer', async () => {
    await page.goto(`${BASE}/super-admin-login`, { waitUntil: 'load' })
    await page.waitForSelector('#staff-username'); await wait(600)
    await type('#staff-username', STAFF.user, 80)
    await type('#staff-password', STAFF.pass, 50)
    await click(page.getByRole('button', { name: 'Masuk' }), { after: 400 })
    await page.waitForSelector('.app-shell', { timeout: 15000 }); await wait(1000)
    await click(page.locator('.flow-item', { hasText: 'Landing page' }).first(), { after: 2000 })
    await smoothScroll(500, 1400); await wait(700)
    await click(page.locator('.flow-item', { hasText: 'Payment gateway' }).first(), { after: 1800 })
  })

  /* 15 — ERP connector (back as a business user) */
  await scene(15, 'Konektor ERP · migrasi bertahap', 'Pemetaan kolom, uji coba, dan rollback untuk enterprise', async () => {
    await fast(6, async () => {
      await page.locator('[aria-label="Keluar"]').first().click({ timeout: 5000 }).catch(() => {})
      await wait(800)
      await page.goto(`${BASE}/#/masuk`, { waitUntil: 'load' })
      await page.waitForSelector('#auth-mode-demo', { timeout: 15000 }); await wait(300)
      await page.click('#auth-mode-demo')
      await page.locator('.auth-form-demo .combo-trigger').nth(0).click()
      await page.keyboard.type('enter', { delay: 50 }); await page.keyboard.press('Enter'); await wait(300)
      await page.click('.auth-form-demo button[type=submit]')
      await page.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 30000 })
      await page.waitForSelector('.app-shell', { timeout: 30000 })
    })
    await wait(800)
    await click('.side-row', { after: 800 })
    await click('.drawer .seg-btn[data-value="erp"]', { after: 1500 })
    await click('.drawer .seg-btn[data-value="migration"]', { after: 1500 }).catch(() => {})
    await wait(1200)
  })

  /* 16 — Closing */
  await scene(16, 'satu-alur.apipedia.workers.dev', 'Bisnis jasa Anda, tumbuh dalam satu alur.', async () => {
    await page.goto(`${BASE}/#/`, { waitUntil: 'load' })
    await moveTo(960, 600, 20)
    await wait(3500)
  })
  await cap('')
  await wait(400)

  const video = page.video()
  await ctx.close()
  const raw = path.join(OUT, 'raw.webm')
  await video.saveAs(raw)
  await video.delete().catch(() => {})
  fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify({ scenes, fastSpans, errors }, null, 2))
  await browser.close()
  console.log(`saved ${raw} (${now().toFixed(1)} s); page errors: ${errors.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

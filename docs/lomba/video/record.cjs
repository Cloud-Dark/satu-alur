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
const LANG = process.env.VIDEO_LANG === 'en' ? 'en' : 'id'
/** Captions are written in Indonesian; the English cut swaps them through this table. */
const CAP_EN = {
  "Kerja tercecer di chat, catatan, dan spreadsheet": "Work scattered across chats, notes, and spreadsheets",
  "Satu Alur menyatukannya dalam satu alur kerja": "Satu Alur brings it into one workflow",
  "9 akun demo · 3 skala usaha": "9 demo accounts · 3 business sizes",
  "Masuk sebagai CV Basmi Hama Nusantara (UKM)": "Signing in as CV Basmi Hama Nusantara (SME)",
  "Ringkasan bisnis, langsung dari data": "Business overview, straight from your data",
  "Laba, grafik pendapatan vs biaya, alur kerja, dan yang perlu tindakan": "Profit, revenue vs costs, workflow, and what needs action",
  "Agen penawaran + validasi aturan domain": "Quote agent + domain rule checks",
  "AI menyusun ruang lingkup, harga, dan ketentuan — Anda yang memutuskan": "AI drafts scope, price, and terms — you decide",
  "Penugasan → Penyelesaian": "Assignment → Completion",
  "Tetapkan petugas dan jadwal, lalu tutup pekerjaan dengan satu klik": "Pick the worker and time, then close the job in one click",
  "Jurnal per pekerjaan · saldo berjalan": "Journal per job · running balance",
  "Pendapatan tidak bisa diposting dua kali": "Revenue can never be posted twice",
  "Agen laporan · jawaban mengalir langsung": "Report agent · answers stream live",
  "AI menjelaskan angka periode dan memberi rekomendasi": "AI explains the period and recommends next steps",
  "Mesin pendapatan: VAS + Tanpa limbah": "Revenue engines: add-ons + zero waste",
  "Layanan tambahan yang tersirat, dan kebocoran biaya di lima aliran": "Hidden add-on services, and cost leaks across five streams",
  "Multi-agen: 5 tim + 1 pimpinan": "Multi-agent: 5 teams + 1 lead",
  "Satu pertanyaan, lima tim AI menjawab paralel, lalu dirangkum": "One question, five AI teams answer in parallel, then a summary",
  "Peluang dari data sendiri · bisa diperiksa": "Opportunities from your own data · fully traceable",
  "Pelanggan jatuh tempo, penawaran tertahan, musim ramai": "Customers due, stalled quotes, busy seasons",
  "Data peta legal · tanpa scraping": "Legal map data · no scraping",
  "AI menilai kecocokan prospek — tanpa pesan otomatis": "AI rates each prospect — no automated messages",
  "Konten & jadwal media sosial": "Social media content & schedule",
  "Konten per platform ditulis AI, lalu dijadwalkan": "AI writes per-platform content, then it is scheduled",
  "5 penasihat · konteks dari bisnis Anda": "5 advisors · grounded in your business",
  "Pertanyaan strategis dijawab dari angka usaha sendiri": "Strategic questions answered from your own numbers",
  "Kantor Satu Alur (super-admin)": "Satu Alur office (super-admin)",
  "Paket, pelanggan, CS, dan kampanye influencer": "Plans, customers, support, and influencer campaigns",
  "Konektor ERP · migrasi bertahap": "ERP connector · phased migration",
  "Pemetaan kolom, uji coba, dan rollback untuk enterprise": "Field mapping, test runs, and rollback for enterprise",
  "Bisnis jasa Anda, tumbuh dalam satu alur.": "Your service business, growing in one flow."
}
const L = (txt) => (LANG === 'en' && CAP_EN[txt]) || txt
/** UI label in the recording language, read from the app's own src/lang/<lang>/<ns>.json. */
const LANG_DIR = path.join(__dirname, '..', '..', '..', 'src', 'lang')
const langCache = {}
function T(key) {
  const [ns, ...rest] = key.split('.')
  const file = (lang) => (langCache[`${lang}/${ns}`] ??= JSON.parse(fs.readFileSync(path.join(LANG_DIR, lang, `${ns}.json`), 'utf8')))
  const get = (lang) => rest.reduce((v, k) => (v == null ? v : v[k]), file(lang))
  const v = get(LANG) ?? get('id')
  if (typeof v !== 'string') throw new Error(`no label for ${key}`)
  return v
}
/** Text the recorder types into forms, in the recording language. */
const D = (id, en) => (LANG === 'en' ? en : id)
const re = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
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
    const badge = document.createElement('div'); badge.id = 'vd-badge'; badge.textContent = window.__vdBadge || 'Data demo fiktif'
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
    locale: LANG === 'en' ? 'en-US' : 'id-ID', timezoneId: 'Asia/Jakarta',
  })
  await ctx.addInitScript((lang) => {
    window.__vdBadge = lang === 'en' ? 'Fictional demo data' : 'Data demo fiktif'
    try { localStorage.setItem('lang', lang) } catch { /* */ }
  }, LANG)
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
      const el = document.scrollingElement
      // html { scroll-behavior: smooth } turns every scrollTop write into a fresh native smooth
      // scroll that the next frame cancels: the page sits still for the whole loop, then lurches.
      const prev = el.style.scrollBehavior
      el.style.scrollBehavior = 'auto'
      const s = el.scrollTop; const t = performance.now()
      const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)
      const f = (n) => {
        const k = Math.min(1, (n - t) / m)
        el.scrollTop = s + d * ease(k)
        if (k < 1) requestAnimationFrame(f)
        else { el.style.scrollBehavior = prev; res() }
      }
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
    await cap(L(title), L(sub))
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
    await page.keyboard.type(T('auth.demo.scale.ukm').slice(0, 3).toLowerCase(), { delay: 90 }); await wait(300); await page.keyboard.press('Enter'); await wait(500)
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
  await scene(3, 'Ringkasan bisnis, langsung dari data', 'Laba, grafik pendapatan vs biaya, alur kerja, dan yang perlu tindakan', async () => {
    await page.waitForSelector('.chart-panel .chart-wrap svg, .chart-panel .chart-box', { timeout: 15000 }).catch(() => {})
    await wait(900)
    await hover('.kpi.is-hero', { pause: 1500 })
    await hover(page.locator('.kpi').nth(1), { pause: 700 })
    await hover(page.locator('.kpi').nth(2), { pause: 700 })
    await click(page.locator('.chart-panel .seg-btn').first(), { after: 1100 }).catch(() => {})
    await click(page.locator('.chart-panel .seg-btn').nth(1), { after: 900 }).catch(() => {})
    await hover('.funnel-panel', { pause: 1300 }).catch(() => {})
    await smoothScroll(560, 2000); await wait(600)
    await hover('.todo-panel .todo-item', { pause: 1200 }).catch(() => {})
    await hover('.feed-panel .feed-item', { pause: 1000 }).catch(() => {})
    await smoothScroll(520, 1800); await wait(1200)
    await smoothScroll(-1080, 1800); await wait(500)
  })

  /* 4 — Offer: new request first, then AI offer */
  const CUSTOMER = 'Hotel Bumi Asri Surabaya'
  await scene(4, 'Agen penawaran + validasi aturan domain', 'AI menyusun ruang lingkup, harga, dan ketentuan — Anda yang memutuskan', async () => {
    // New shell: Ringkasan → topbar "Alur kerja" → topbar "Permintaan baru".
    await click('.topbar-cta', { after: 1300 })
    await page.waitForSelector('.wf-panel', { timeout: 15000 }).catch(() => {})
    await wait(700)
    await click('.topbar-cta', { after: 1000 })
    await page.waitForSelector('input[name="customer_name"]', { timeout: 15000 })
    await type('input[name="customer_name"]', CUSTOMER, 35)
    await type('input[name="location"]', 'Surabaya', 45)
    await page.keyboard.press('Escape'); await wait(600)
    await click('.wiz-primary', { after: 800 }) // Pelanggan → Kebutuhan
    await page.waitForSelector('input[name="service_type"]', { state: 'visible', timeout: 8000 })
    await type('input[name="service_type"]', D('Pengendalian rayap & kecoa', 'Termite & cockroach control'), 30)
    await fast(2.5, () => type('textarea[name="description"]', D('Treatment rayap dan kecoa untuk dapur hotel 3 lantai, termasuk area gudang.', 'Termite and cockroach treatment for a 3-floor hotel kitchen, including the storeroom.'), 18))
    await click('.wiz-primary', { after: 900 }) // Kebutuhan → Tinjau
    await click('.wiz-primary', { after: 300 }) // Simpan permintaan
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
    const done = page.getByRole('button', { name: T('assign.markDone'), exact: true })
    await done.waitFor({ timeout: 10000 }).catch(() => {})
    await wait(1000)
    await click(done, { after: 1100 })
    await page.waitForSelector('textarea[name="notes"]', { timeout: 10000 })
    await fast(2.5, () => type('textarea[name="notes"]', D('Treatment selesai, dapur dan gudang bersih. Kontrol ulang 30 hari.', 'Treatment done, kitchen and storeroom clean. Follow-up check in 30 days.'), 18))
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
    await click(page.getByRole('button', { name: T('report.ai.explain') }), { after: 400 })
    await page.waitForSelector('.report-ai-out .console', { timeout: 8000 })
    await wait(800)
    await page.locator('.report-ai-out').scrollIntoViewIfNeeded().catch(() => {})
    await fast(3, () => page.waitForFunction(() => /Selesai|Dihentikan|Gagal/.test(document.querySelector('.report-ai-out .console-status')?.textContent || ''), null, { timeout: 40000 }).catch(() => {}))
    await wait(1500)
  })

  /* 8 — VAS + Zero waste */
  await scene(8, 'Mesin pendapatan: VAS + Tanpa limbah', 'Layanan tambahan yang tersirat, dan kebocoran biaya di lima aliran', async () => {
    await stage('vas'); await wait(900)
    await click(page.locator('.seg-btn', { hasText: T('vas.tabs.peluang') }).first(), { after: 1200 }).catch(() => {})
    await hover('.view .panel, .view article, .view .card', { pause: 1600 }).catch(() => {})
    await smoothScroll(420, 1500); await wait(800); await smoothScroll(-420, 900)
    await stage('zero-waste'); await wait(900)
    await click(page.locator('.seg-btn', { hasText: T('zeroWaste.tabs.pemborosan') }).first(), { after: 1500 }).catch(() => {})
    await smoothScroll(420, 1500); await wait(900); await smoothScroll(-420, 900)
  })

  /* 9 — Optimization room */
  await scene(9, 'Multi-agen: 5 tim + 1 pimpinan', 'Satu pertanyaan, lima tim AI menjawab paralel, lalu dirangkum', async () => {
    await click(page.locator('.seg-btn', { hasText: T('vas.tabs.optimasi') }).first(), { after: 900 })
    await page.locator('.opt-team').first().waitFor({ timeout: 8000 })
    await click(page.locator('.opt-preset').first(), { after: 600 })
    await click(page.getByRole('button', { name: T('optimize.form.run') }), { after: 600 })
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
    await click(page.getByRole('radio', { name: T('social.tabs.content'), exact: true }), { after: 700 })
    await page.waitForSelector('#sm-topic', { timeout: 8000 })
    await type('#sm-topic', D('Tips cegah rayap musim hujan', 'Tips to prevent termites in the rainy season'), 45)
    await click(page.getByRole('button', { name: T('social.content.generate') }), { after: 500 })
    const saveBtn = page.locator('.workspace-output .sm-composer').getByRole('button', { name: T('social.content.save'), exact: true })
    await fast(3, () => saveBtn.waitFor({ timeout: 30000 }))
    await page.locator('.workspace-output').scrollIntoViewIfNeeded().catch(() => {})
    await wait(1600)
    await click(saveBtn, { after: 1200 })
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await wait(600)
    await click(page.getByRole('radio', { name: T('social.tabs.schedule'), exact: true }), { after: 1200 })
    const item = page.locator('.sm-schedule-item').first()
    await item.waitFor({ timeout: 8000 })
    await hover(item, { pause: 700 })
    await click(item.getByRole('button', { name: T('social.schedule.dialogTitle') }), { after: 900 })
    const when = page.locator('input[type="datetime-local"][id^="sm-when-"]')
    await when.waitFor({ timeout: 5000 })
    const d = new Date(Date.now() + 2 * 864e5); d.setHours(9, 0, 0, 0)
    await hover(when, { pause: 300 })
    await when.fill(new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16)); await wait(1600)
    await click(page.getByRole('button', { name: T('social.cancel'), exact: true }), { after: 500 })
  })

  /* 13 — Advisor */
  await scene(13, '5 penasihat · konteks dari bisnis Anda', 'Pertanyaan strategis dijawab dari angka usaha sendiri', async () => {
    await stage('advisor'); await wait(900)
    const chip = page.locator('.adv-chip:visible', { hasText: T('advisor.growTwo') }).first()
    const sug = page.getByRole('button', { name: re(T('advisor.growTwo')) }).first()
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
    await click(page.getByRole('button', { name: T('auth.staff.submit') }), { after: 400 })
    await page.waitForSelector('.app-shell', { timeout: 15000 }); await wait(1000)
    const nav = (t) => page.locator('.flow-item', { hasText: t }).first()
    await click(nav(T('office.menu.plans')), { after: 1200 })
    const imp = page.getByRole('button', { name: re(T('office.plans.import')) })
    if (await imp.isVisible().catch(() => false)) await click(imp, { after: 1500 })
    await wait(800)
    await click(nav(T('office.menu.customers')), { after: 1600 })
    await click(nav(T('office.menu.influencers')), { after: 1800 })
    await click(nav(T('office.menu.sysOverview')), { after: 1800 })
  })

  /* 15 — ERP connector (back as a business user) */
  await scene(15, 'Konektor ERP · migrasi bertahap', 'Pemetaan kolom, uji coba, dan rollback untuk enterprise', async () => {
    await fast(6, async () => {
      await page.locator(`[aria-label="${T('shell.nav.signOut')}"]`).first().click({ timeout: 5000 }).catch(() => {})
      await wait(800)
      await page.goto(`${BASE}/#/masuk`, { waitUntil: 'load' })
      await page.waitForSelector('#auth-mode-demo', { timeout: 15000 }); await wait(300)
      await page.click('#auth-mode-demo')
      await page.locator('.auth-form-demo .combo-trigger').nth(0).click()
      await page.keyboard.type(T('auth.demo.scale.enterprise').slice(0, 5).toLowerCase(), { delay: 50 }); await page.keyboard.press('Enter'); await wait(300)
      await page.click('.auth-form-demo button[type=submit]')
      await page.waitForFunction(() => location.hash.startsWith('#/app'), null, { timeout: 30000 })
      await page.waitForSelector('.app-shell', { timeout: 30000 })
    })
    await wait(800)
    await click('.side-row', { after: 800 })
    await click('.drawer .seg-btn[data-value="erp"]', { after: 1200 })
    await click(page.locator('.mcp-template-card', { hasText: 'Odoo' }), { after: 800 })
    await fast(3, async () => {
      await page.fill('#mcp-name', '') // the template pre-fills "Odoo"
      await type('#mcp-name', D('Odoo Pusat', 'Odoo HQ'), 45)
      await type('#mcp-url', 'https://erp.contoh.id', 30)
      await type('#mcp-key', 'demo-key-123', 30)
      await click('.drawer .checkbox-label input', { after: 300 }) // Aktifkan setelah disimpan
    })
    await click(page.locator('.drawer').getByRole('button', { name: T('settings.form.save') }), { after: 1200 })
    await click(page.locator('.drawer button', { hasText: T('settings.erp.test') }).first(), { after: 1800 })
    await click('.drawer .seg-btn[data-value="migration"]', { after: 1000 })
    await click(page.locator('.drawer').getByRole('button', { name: T('settings.migration.new') }), { after: 900 })
    await fast(3, () => type('#mig-name', D('Migrasi Odoo ke Satu Alur', 'Odoo to Satu Alur migration'), 40))
    await hover('#mig-strategy', { pause: 900 })
    await click(page.locator('.drawer').getByRole('button', { name: T('settings.migration.next'), exact: true }), { after: 1400 }) // Fase
    await click(page.locator('.drawer').getByRole('button', { name: T('settings.migration.next'), exact: true }), { after: 1400 }) // Konfirmasi
    await click(page.locator('.drawer').getByRole('button', { name: T('settings.migration.create') }), { after: 1600 })
    await click(page.locator('.drawer').getByRole('button', { name: T('settings.migration.runAll') }), { after: 2500 })
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

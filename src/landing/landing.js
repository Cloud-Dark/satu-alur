/**
 * Public landing page ("#/"). Editorial brutalist layout: sticky header,
 * hero with the Three.js flow scene, ticker, six-stage flow, AI features
 * (with a streaming terminal demo), roadmap, pricing, FAQ, CTA, footer.
 *
 * renderLanding(root, ctx) -> cleanup
 */
import '../styles/landing.css'
import { iconHTML } from '../ui/icons.js'
import { logoLink, logoMarkHTML } from '../ui/brand.js'
import { themeToggleButton } from '../ui/theme.js'
import { observeReveal, prefersReducedMotion } from '../ui/reveal.js'
import { mountFlowScene } from '../three/flow-scene.js'
import { mountTerminal } from './terminal.js'
import { PRICING_TIERS, PRICING_NOTE } from './pricing.js'
import { NAV, STAGES, TICKER, FEATURES, ROADMAP, FAQS, TERMINAL_LINES } from './content.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* ------------------------------------------------------------------ */
/* Markup                                                              */
/* ------------------------------------------------------------------ */

function primaryCta(user, { size = '', label = 'Mulai gratis' } = {}) {
  return user
    ? `<a class="btn btn-signal ${size}" href="#/app">Buka Dashboard ${iconHTML('arrowRight')}</a>`
    : `<a class="btn btn-signal ${size}" href="#/masuk">${label} ${iconHTML('arrowRight')}</a>`
}

function headerHTML(user) {
  const links = NAV.map((n) => `<li><a href="#${n.id}" data-scroll="${n.id}">${n.label}</a></li>`).join('')
  return `
  <div class="lp-progress" aria-hidden="true"><span data-progress></span></div>
  <header class="lp-header" data-header>
    <div class="lp-container lp-header-inner">
      <div class="lp-header-brand" data-slot="logo"></div>
      <nav class="lp-nav" aria-label="Navigasi utama"><ul>${links}</ul></nav>
      <div class="lp-header-actions">
        <span data-slot="theme"></span>
        ${user ? '' : '<a class="btn btn-ghost btn-sm lp-hide-sm" href="#/masuk">Masuk</a>'}
        <span class="lp-hide-sm">${primaryCta(user, { size: 'btn-sm' })}</span>
        <button type="button" class="icon-btn lp-burger" aria-label="Buka menu" aria-expanded="false" aria-controls="lp-menu" data-menu-open>${iconHTML('menu', { size: 20 })}</button>
      </div>
    </div>
  </header>
  <div class="lp-menu" id="lp-menu" role="dialog" aria-modal="true" aria-label="Menu navigasi" hidden data-menu>
    <div class="lp-menu-top lp-container">
      <span class="brand">${logoMarkHTML({ size: 28 })}<span class="brand-word">Satu<span class="brand-word-thin">Alur</span></span></span>
      <button type="button" class="icon-btn lp-menu-close" aria-label="Tutup menu" data-menu-close>${iconHTML('x', { size: 20 })}</button>
    </div>
    <nav class="lp-menu-nav lp-container" aria-label="Navigasi seluler">
      <ol>${NAV.map((n, i) => `<li><a href="#${n.id}" data-scroll="${n.id}"><span class="mono">0${i + 1}</span>${n.label}</a></li>`).join('')}</ol>
    </nav>
    <div class="lp-menu-foot lp-container">
      ${user ? '' : '<a class="btn btn-lg" href="#/masuk">Masuk</a>'}
      ${primaryCta(user, { size: 'btn-lg' })}
    </div>
  </div>`
}

function heroHTML(user) {
  return `
  <section class="lp-hero grain" aria-labelledby="lp-hero-title">
    <div class="lp-hero-scene dot-grid" data-scene aria-hidden="true">
      <span class="lp-scene-label lp-scene-label-tl mono">FIG. 01 — SATU ALUR</span>
      <span class="lp-scene-label lp-scene-label-br mono">6 TAHAP · 1 ALUR DATA</span>
    </div>
    <div class="lp-container lp-hero-inner">
      <div class="lp-hero-meta reveal">
        <p class="kicker">Operasi jasa · ditenagai AI</p>
        <p class="lp-status mono"><span class="live-dot" aria-hidden="true"></span> Alur aktif — 6 tahap, 2 agen AI</p>
      </div>
      <h1 class="lp-hero-title" id="lp-hero-title">
        <span class="lp-line reveal" style="--d: 60ms">Satu alur.</span>
        <span class="lp-line reveal" style="--d: 140ms">Dari permintaan</span>
        <span class="lp-line reveal" style="--d: 220ms">sampai <span class="lp-mark">laporan.</span></span>
      </h1>
      <div class="lp-hero-foot reveal" style="--d: 320ms">
        <p class="lp-hero-sub">Satu Alur menyatukan permintaan pelanggan, penawaran, penugasan, pembukuan, dan laporan bisnis jasa Anda dalam satu alur kerja. AI mengerjakan yang berulang; Anda fokus melayani dan bertumbuh.</p>
        <div class="lp-hero-ctas">
          ${primaryCta(user, { size: 'btn-lg' })}
          <a class="btn btn-lg" href="#alur" data-scroll="alur">Lihat alur kerja</a>
        </div>
      </div>
    </div>
  </section>`
}

function tickerHTML() {
  const items = TICKER.map((t) => `<li>${esc(t)}</li>`).join('')
  return `
  <div class="lp-ticker" role="region" aria-label="Ringkasan kemampuan">
    <div class="lp-ticker-track">
      <ul>${items}</ul>
      <ul aria-hidden="true">${items}</ul>
    </div>
  </div>`
}

function flowHTML() {
  const cells = STAGES.map((s, i) => `
    <li class="lp-stage reveal" style="--d: ${i * 70}ms" data-stage="${i}">
      <div class="lp-stage-rail" aria-hidden="true"><span class="lp-stage-node"></span></div>
      <div class="lp-stage-top">
        <span class="lp-stage-no mono">${s.no}</span>
        <span class="lp-stage-icon">${iconHTML(s.icon, { size: 22 })}</span>
      </div>
      <h3 class="lp-stage-title">${esc(s.title)}${s.ai ? ' <span class="lp-chip">AI</span>' : ''}</h3>
      <p class="lp-stage-desc">${esc(s.desc)}</p>
      <p class="lp-stage-out mono"><span>Hasil</span> ${esc(s.out)}</p>
    </li>`).join('')
  return `
  <section class="lp-section" id="alur" aria-labelledby="lp-alur-title">
    <div class="lp-container">
      <header class="lp-sec-head reveal">
        <p class="kicker">01 — Alur kerja</p>
        <h2 class="lp-h2" id="lp-alur-title">Enam tahap.<br>Satu benang merah.</h2>
        <div class="lp-sec-aside">
          <p class="lp-lede">Bisnis jasa sering mengelola pekerjaan lewat chat dan spreadsheet yang terpisah. Satu Alur merangkai semuanya: data yang masuk di tahap pertama mengalir utuh sampai laporan.</p>
          <dl class="lp-facts">
            <div><dt class="mono">Tahap</dt><dd data-count="6">06</dd></div>
            <div><dt class="mono">Agen AI</dt><dd data-count="2">02</dd></div>
            <div><dt class="mono">Alur data</dt><dd data-count="1">01</dd></div>
          </dl>
        </div>
      </header>
      <ol class="lp-stages">${cells}</ol>
    </div>
  </section>`
}

function featuresHTML() {
  const rows = FEATURES.map((f, i) => `
    <li class="lp-feature reveal" style="--d: ${i * 80}ms">
      <span class="lp-feature-icon">${iconHTML(f.icon, { size: 20 })}</span>
      <div>
        <h3 class="lp-feature-title">${esc(f.title)}${f.tag ? ` <span class="lp-chip lp-chip-outline">${esc(f.tag)}</span>` : ''}</h3>
        <p class="lp-feature-desc">${esc(f.desc)}</p>
      </div>
    </li>`).join('')
  const srText = TERMINAL_LINES.map((l) => l.s).join('\n')
  return `
  <section class="lp-section lp-section-alt" id="fitur-ai" aria-labelledby="lp-ai-title">
    <div class="lp-container">
      <header class="lp-sec-head reveal">
        <p class="kicker">02 — Fitur AI</p>
        <h2 class="lp-h2" id="lp-ai-title">AI di dalam alur,<br>bukan di sampingnya.</h2>
        <div class="lp-sec-aside">
          <p class="lp-lede">AI menyiapkan draf; aturan bisnis dan keputusan Anda yang menentukan. Setiap keluaran bisa dibaca, diperiksa, dan diubah.</p>
        </div>
      </header>
      <div class="lp-ai-grid">
        <ul class="lp-features">${rows}</ul>
        <figure class="lp-term reveal" style="--d: 120ms">
          <div class="lp-term-head">
            <span class="mono">agen://penawaran</span>
            <span class="lp-term-live mono"><span class="live-dot" aria-hidden="true"></span> Demo streaming</span>
          </div>
          <div class="lp-term-body mono" data-terminal aria-hidden="true"></div>
          <pre class="sr-only">${esc(srText)}</pre>
          <figcaption class="lp-term-cap mono">Contoh ilustrasi keluaran agen penawaran — bukan data pelanggan.</figcaption>
        </figure>
      </div>
    </div>
  </section>`
}

function visionHTML() {
  const cards = ROADMAP.map((r, i) => `
    <li class="lp-road reveal" style="--d: ${i * 90}ms">
      <div class="lp-road-top">
        <span class="mono lp-road-no">${r.no}</span>
        <span class="lp-chip lp-chip-outline">Segera hadir</span>
      </div>
      <span class="lp-road-icon">${iconHTML(r.icon, { size: 22 })}</span>
      <h3 class="lp-road-title">${esc(r.title)}</h3>
      <p class="lp-road-desc">${esc(r.desc)}</p>
    </li>`).join('')
  return `
  <section class="lp-section lp-vision" id="ide-besar" aria-labelledby="lp-vision-title">
    <div class="lp-container">
      <header class="lp-sec-head reveal">
        <p class="kicker">03 — Ide besar</p>
        <h2 class="lp-h2 lp-h2-xl" id="lp-vision-title">Hari ini merapikan operasi. Berikutnya, membaca masa depan bisnis.</h2>
        <div class="lp-sec-aside">
          <p class="lp-lede">Satu Alur dibuat untuk membantu usaha jasa naik skala dengan AI. Karena setiap tahap tercatat sebagai data terstruktur, alur yang sama bisa menjadi dasar perencanaan perusahaan Anda.</p>
        </div>
      </header>
      <ol class="lp-roadmap">${cards}</ol>
      <p class="lp-note mono reveal">Roadmap — arah pengembangan, bukan janji tanggal rilis.</p>
    </div>
  </section>`
}

function pricingHTML() {
  const tiers = PRICING_TIERS.map((t, i) => {
    const btnClass = t.cta.variant === 'signal' ? 'btn btn-signal' : t.cta.variant === 'ink' ? 'btn btn-ink' : 'btn'
    const cta = t.cta.href
      ? `<a class="${btnClass} lp-tier-cta" href="${t.cta.href}">${esc(t.cta.label)} ${iconHTML('arrowRight')}</a>`
      : `<a class="${btnClass} lp-tier-cta" href="#" data-placeholder aria-describedby="lp-contact-note">${esc(t.cta.label)} ${iconHTML('arrowUpRight')}</a>`
    return `
    <article class="lp-tier reveal${t.recommended ? ' is-recommended' : ''}" style="--d: ${i * 90}ms" aria-labelledby="tier-${t.id}">
      ${t.recommended ? `<p class="lp-tier-badge mono">${esc(t.badge)}</p>` : ''}
      <header class="lp-tier-head">
        <h3 class="lp-tier-name" id="tier-${t.id}">${esc(t.name)}</h3>
        <p class="lp-tier-tag">${esc(t.tagline)}</p>
      </header>
      <p class="lp-tier-price"><span class="lp-price">${esc(t.price)}</span><span class="lp-period mono">${esc(t.period)}</span></p>
      <dl class="lp-tier-limits">
        ${t.limits.map((l) => `<div><dt class="mono">${esc(l.label)}</dt><dd>${esc(l.value)}</dd></div>`).join('')}
      </dl>
      <ul class="lp-tier-features">
        ${t.features.map((f) => `<li>${iconHTML('check', { size: 16, stroke: 2.25 })}<span>${esc(f)}</span></li>`).join('')}
      </ul>
      ${cta}
    </article>`
  }).join('')
  return `
  <section class="lp-section" id="harga" aria-labelledby="lp-price-title">
    <div class="lp-container">
      <header class="lp-sec-head reveal">
        <p class="kicker">04 — Harga</p>
        <h2 class="lp-h2" id="lp-price-title">Mulai gratis.<br>Naik kelas saat tumbuh.</h2>
        <div class="lp-sec-aside">
          <p class="lp-lede">Tiga paket untuk tiga tahap usaha. Pilih yang sesuai sekarang, pindah paket kapan saja.</p>
        </div>
      </header>
      <div class="lp-tiers">${tiers}</div>
      <p class="lp-note mono reveal">${esc(PRICING_NOTE)} <span id="lp-contact-note">Kontak penjualan Enterprise segera tersedia.</span></p>
    </div>
  </section>`
}

function faqHTML() {
  const items = FAQS.map((f, i) => `
    <div class="lp-faq-item">
      <h3 class="lp-faq-q">
        <button type="button" id="faq-q-${i}" aria-expanded="false" aria-controls="faq-a-${i}" data-faq>
          <span class="mono lp-faq-no">${String(i + 1).padStart(2, '0')}</span>
          <span class="lp-faq-text">${esc(f.q)}</span>
          <span class="lp-faq-icon">${iconHTML('plus', { size: 18, stroke: 2 })}</span>
        </button>
      </h3>
      <div class="lp-faq-a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}" inert>
        <div><p>${esc(f.a)}</p></div>
      </div>
    </div>`).join('')
  return `
  <section class="lp-section lp-section-alt" id="faq" aria-labelledby="lp-faq-title">
    <div class="lp-container lp-faq-grid">
      <header class="lp-faq-head reveal">
        <p class="kicker">05 — FAQ</p>
        <h2 class="lp-h2" id="lp-faq-title">Pertanyaan yang sering muncul.</h2>
        <p class="lp-lede">Jawaban singkat tentang data, keamanan, AI, dan paket.</p>
      </header>
      <div class="lp-faq reveal" style="--d: 100ms">${items}</div>
    </div>
  </section>`
}

function ctaHTML(user) {
  return `
  <section class="lp-cta lp-inverse" aria-labelledby="lp-cta-title">
    <div class="lp-container lp-cta-inner">
      <p class="kicker lp-kicker-inverse">06 — Mulai</p>
      <h2 class="lp-cta-title reveal" id="lp-cta-title"><span class="lp-cta-a">Rapikan operasi jasa Anda.</span> <span class="lp-cta-b">Mulai hari ini.</span></h2>
      <div class="lp-cta-row reveal" style="--d: 120ms">
        ${primaryCta(user, { size: 'btn-lg', label: 'Mulai gratis sekarang' })}
        <a class="lp-cta-link" href="#harga" data-scroll="harga">Bandingkan paket ${iconHTML('arrowRight', { size: 16 })}</a>
      </div>
    </div>
  </section>`
}

function footerHTML() {
  const col = (title, links) => `
    <div class="lp-foot-col">
      <h2 class="mono">${title}</h2>
      <ul>${links.map(([label, attr]) => `<li><a ${attr}>${label}</a></li>`).join('')}</ul>
    </div>`
  return `
  <footer class="lp-footer" aria-labelledby="lp-foot-title">
    <div class="lp-container">
      <div class="lp-foot-top">
        <div class="lp-foot-intro">
          <h2 class="sr-only" id="lp-foot-title">Satu Alur</h2>
          <p class="lp-foot-lede">Operasi jasa dalam satu alur — dari permintaan sampai laporan, ditenagai AI.</p>
          <p class="lp-status mono"><span class="live-dot" aria-hidden="true"></span> Dibuat di Indonesia</p>
        </div>
        <div class="lp-foot-cols">
          ${col('Produk', [
            ['Alur kerja', 'href="#alur" data-scroll="alur"'],
            ['Fitur AI', 'href="#fitur-ai" data-scroll="fitur-ai"'],
            ['Harga', 'href="#harga" data-scroll="harga"'],
            ['FAQ', 'href="#faq" data-scroll="faq"'],
          ])}
          ${col('Perusahaan', [
            ['Tentang kami', 'href="#" data-placeholder'],
            ['Roadmap', 'href="#ide-besar" data-scroll="ide-besar"'],
            ['Kontak', 'href="#" data-placeholder'],
          ])}
          ${col('Legal', [
            ['Kebijakan privasi', 'href="#" data-placeholder'],
            ['Syarat & ketentuan', 'href="#" data-placeholder'],
          ])}
        </div>
      </div>
      <p class="lp-wordmark" aria-hidden="true">Satu<span>Alur</span></p>
      <div class="lp-foot-base mono">
        <span>© 2026 Satu Alur. Hak cipta dilindungi.</span>
        <span>Cloudflare Workers · D1 · Workers AI</span>
      </div>
    </div>
  </footer>
  <button type="button" class="lp-totop" aria-label="Kembali ke atas" data-totop>${iconHTML('arrowUp', { size: 20 })}</button>`
}

/* ------------------------------------------------------------------ */
/* Behaviour                                                           */
/* ------------------------------------------------------------------ */

export function renderLanding(root, ctx = {}) {
  const user = ctx.user || null
  const reduced = prefersReducedMotion()
  const disposers = []
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts)
    disposers.push(() => target.removeEventListener(type, fn, opts))
  }

  const page = document.createElement('div')
  page.className = 'lp'
  page.innerHTML = `
    <a class="lp-skip" href="#lp-main" data-scroll="lp-main">Langsung ke konten</a>
    ${headerHTML(user)}
    <main id="lp-main" tabindex="-1">
      ${heroHTML(user)}
      ${tickerHTML()}
      ${flowHTML()}
      ${featuresHTML()}
      ${visionHTML()}
      ${pricingHTML()}
      ${faqHTML()}
      ${ctaHTML(user)}
    </main>
    ${footerHTML()}`
  root.append(page)

  page.querySelector('[data-slot="logo"]').replaceWith(logoLink({ size: 30 }))
  page.querySelector('[data-slot="theme"]').replaceWith(themeToggleButton())

  const header = page.querySelector('[data-header]')
  const progress = page.querySelector('[data-progress]')
  const toTop = page.querySelector('[data-totop]')
  const menu = page.querySelector('[data-menu]')
  const burger = page.querySelector('[data-menu-open]')

  /* --- Smooth in-page scrolling (the hash router owns location.hash) --- */
  const scrollToId = (id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }
  on(page, 'click', (e) => {
    const a = e.target.closest('a')
    if (!a || !page.contains(a)) return
    if (a.hasAttribute('data-placeholder')) { e.preventDefault(); return }
    const id = a.getAttribute('data-scroll')
    if (!id) return
    e.preventDefault()
    if (!menu.hidden) closeMenu(false)
    scrollToId(id)
  })

  /* --- Scroll: progress bar, header state, back-to-top --- */
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      const y = window.scrollY
      const max = document.documentElement.scrollHeight - window.innerHeight
      progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`
      header.classList.toggle('is-scrolled', y > 8)
      toTop.classList.toggle('is-visible', y > 300)
    })
  }
  on(window, 'scroll', onScroll, { passive: true })
  on(window, 'resize', onScroll, { passive: true })
  onScroll()

  on(toTop, 'click', () => {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    header.querySelector('.brand-link')?.focus({ preventScroll: true })
  })

  /* --- Mobile menu --- */
  let lastFocus = null
  function openMenu() {
    lastFocus = document.activeElement
    menu.hidden = false
    requestAnimationFrame(() => menu.classList.add('is-open'))
    burger.setAttribute('aria-expanded', 'true')
    document.documentElement.classList.add('lp-lock')
    menu.querySelector('[data-menu-close]').focus()
  }
  function closeMenu(restore = true) {
    menu.classList.remove('is-open')
    menu.hidden = true
    burger.setAttribute('aria-expanded', 'false')
    document.documentElement.classList.remove('lp-lock')
    if (restore) (lastFocus || burger).focus()
  }
  on(burger, 'click', openMenu)
  on(menu.querySelector('[data-menu-close]'), 'click', () => closeMenu())
  on(menu, 'keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); return }
    if (e.key !== 'Tab') return
    const f = [...menu.querySelectorAll('a, button')]
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })
  const mq = window.matchMedia('(min-width: 960px)')
  const onMq = () => { if (mq.matches && !menu.hidden) closeMenu(false) }
  mq.addEventListener('change', onMq)
  disposers.push(() => mq.removeEventListener('change', onMq))
  menu.querySelectorAll('a[href^="#/"]').forEach((a) => on(a, 'click', () => closeMenu(false)))

  /* --- FAQ accordion --- */
  page.querySelectorAll('[data-faq]').forEach((btn) => {
    on(btn, 'click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true'
      const panel = document.getElementById(btn.getAttribute('aria-controls'))
      btn.setAttribute('aria-expanded', String(!open))
      panel.classList.toggle('is-open', !open)
      panel.inert = open
    })
  })

  /* --- Active stage indicator (cycles while the section is visible) --- */
  const stages = [...page.querySelectorAll('[data-stage]')]
  let active = 1
  const setActive = (i) => stages.forEach((s, k) => s.classList.toggle('is-active', k === i))
  setActive(active)
  if (!reduced) {
    let stageTimer = 0
    const stageIO = new IntersectionObserver(([e]) => {
      window.clearInterval(stageTimer)
      if (e.isIntersecting) {
        stageTimer = window.setInterval(() => {
          if (document.hidden) return
          active = (active + 1) % stages.length
          setActive(active)
        }, 2200)
      }
    }, { threshold: 0.25 })
    stageIO.observe(page.querySelector('.lp-stages'))
    disposers.push(() => { window.clearInterval(stageTimer); stageIO.disconnect() })
  }

  /* --- Counters (real counts only: stages, AI agents, flows) --- */
  if (!reduced && 'IntersectionObserver' in window) {
    const counters = [...page.querySelectorAll('[data-count]')]
    counters.forEach((el) => { el.textContent = '00' })
    const countIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        countIO.unobserve(entry.target)
        const el = entry.target
        const to = Number(el.dataset.count)
        let n = 0
        const iv = window.setInterval(() => {
          n += 1
          el.textContent = String(n).padStart(2, '0')
          if (n >= to) window.clearInterval(iv)
        }, 110)
        disposers.push(() => window.clearInterval(iv))
      })
    }, { threshold: 0.6 })
    counters.forEach((el) => countIO.observe(el))
    disposers.push(() => countIO.disconnect())
  }

  /* --- Reveal, terminal, 3D scene --- */
  disposers.push(observeReveal(page))
  disposers.push(mountTerminal(page.querySelector('[data-terminal]'), TERMINAL_LINES))

  let disposed = false
  let sceneCleanup = null
  mountFlowScene(page.querySelector('[data-scene]'), { highlight: 1 })
    .then((fn) => { if (disposed) fn?.(); else sceneCleanup = fn })
    .catch(() => {})

  return () => {
    disposed = true
    sceneCleanup?.()
    disposers.forEach((d) => { try { d() } catch { /* ignore */ } })
    document.documentElement.classList.remove('lp-lock')
  }
}


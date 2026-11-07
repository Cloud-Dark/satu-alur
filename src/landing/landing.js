/**
 * Public landing page ("#/") — design system v2 "Tumbuh".
 * Calm, warm and premium: floating pill header, serif hero with the 3D flow
 * ribbon and an illustrative product preview, capability ticker, six-stage
 * flow drawn as a path on scroll, AI features with a streaming agent demo,
 * roadmap, pricing, FAQ, closing CTA panel and footer.
 *
 * renderLanding(root, ctx) -> cleanup
 */
import '../styles/landing.css'
import { iconHTML } from '../ui/icons.js'
import { logoLink, logoMarkHTML } from '../ui/brand.js'
import { themeToggleButton } from '../ui/theme.js'
import { langToggleButton } from '../i18n/switcher.js'
import { observeReveal, prefersReducedMotion } from '../ui/reveal.js'
import { mountFlowScene } from '../three/flow-scene.js'
import { mountAgentDemo } from './terminal.js'
import { PRICING_TIERS } from './pricing.js'
import { t, getLang } from '../i18n/index.js'
import { getSite } from '../site/api.js'
import { getPlans } from '../business/api.js'
import { renderPlanCard, isLongPrice } from '../business/plan-card.js'
import { renderHero } from '../site/hero.js'
import { localizedContent, localizedTiers } from './content.js'

// Landing copy in the current language (filled once per render, in renderLanding).
let NAV, HERO, HERO_POINTS, STAGES, TICKER, FEATURES, INCOME, GROWTH, INTEGRATION, ROADMAP, FAQS, AGENT_DEMO

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/* ------------------------------------------------------------------ */
/* Markup                                                              */
/* ------------------------------------------------------------------ */

function primaryCta(user, { size = '', label = t('header.startFree'), variant = 'btn-primary' } = {}) {
  const arrow = iconHTML('arrowRight', { className: 'icon-trailing' })
  return user
    ? `<a class="btn ${variant} ${size}" href="#/app">${t('header.openDashboard')} ${arrow}</a>`
    : `<a class="btn ${variant} ${size}" href="#/masuk">${label} ${arrow}</a>`
}

function headerHTML(user) {
  const links = NAV.map((n) => `<li><a href="#${n.id}" data-scroll="${n.id}" data-nav="${n.id}">${n.label}</a></li>`).join('')
  return `
  <div class="lp-progress" aria-hidden="true"><span data-progress></span></div>
  <header class="lp-header" data-header>
    <div class="lp-header-bar">
      <div data-slot="logo"></div>
      <nav class="lp-nav" aria-label="${t('header.navLabel')}"><ul>${links}</ul></nav>
      <div class="lp-header-actions">
        <span data-slot="theme"></span>
        ${user ? '' : `<a class="btn btn-ghost btn-sm lp-hide-md" href="#/masuk">${t('header.signIn')}</a>`}
        <span class="lp-hide-sm">${primaryCta(user, { size: 'btn-sm' })}</span>
        <button type="button" class="icon-btn lp-burger" aria-label="${t('header.menuOpen')}" aria-expanded="false" aria-controls="lp-menu" data-menu-open>${iconHTML('menu', { size: 20 })}</button>
      </div>
    </div>
  </header>
  <div class="lp-menu" id="lp-menu" role="dialog" aria-modal="true" aria-label="${t('header.menuLabel')}" hidden data-menu>
    <div class="lp-menu-scrim" data-menu-close-scrim></div>
    <div class="lp-menu-panel">
      <div class="lp-menu-top">
        <span class="brand">${logoMarkHTML({ size: 28 })}<span class="brand-word">Satu<span class="brand-word-thin">Alur</span></span></span>
        <button type="button" class="icon-btn" aria-label="${t('header.menuClose')}" data-menu-close>${iconHTML('x', { size: 20 })}</button>
      </div>
      <nav aria-label="${t('header.mobileNavLabel')}">
        <ol class="lp-menu-nav">${NAV.map((n, i) => `<li style="--i:${i}"><a href="#${n.id}" data-scroll="${n.id}"><span class="lp-menu-no">0${i + 1}</span><span class="lp-menu-label">${n.label}</span>${iconHTML('arrowRight', { size: 18 })}</a></li>`).join('')}</ol>
      </nav>
      <div class="lp-menu-foot">
        ${user ? '' : `<a class="btn btn-lg" href="#/masuk">${t('header.signIn')}</a>`}
        ${primaryCta(user, { size: 'btn-lg' })}
      </div>
    </div>
  </div>`
}

function previewHTML() {
  // Illustrative mini dashboard (HTML/CSS + inline SVG). Numbers are examples.
  return `
  <div class="lp-preview" role="img" aria-label="${esc(t('body.preview.aria'))}">
    <div class="lp-preview-head">
      <div>
        <p class="lp-preview-title">${t('body.preview.title')}</p>
        <p class="lp-preview-sub">${t('body.preview.sub')}</p>
      </div>
      <span class="tag tag-accent">${t('body.example')}</span>
    </div>
    <div class="lp-preview-kpis">
      <div><span>${t('body.preview.revenue')}</span><strong class="tnum">${t('body.preview.revenueValue')}</strong></div>
      <div><span>${t('body.preview.profit')}</span><strong class="tnum">${t('body.preview.profitValue')}</strong></div>
    </div>
    <svg class="lp-preview-chart" viewBox="0 0 300 92" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="lp-pv-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--brand-500)" stop-opacity="0.22"/>
          <stop offset="1" stop-color="var(--brand-500)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M0 30.5H300M0 61.5H300" class="lp-preview-grid"/>
      <path d="M0 74 C 30 70, 46 58, 75 60 S 120 70, 150 50 S 200 44, 225 34 S 270 18, 300 12 V92 H0Z" fill="url(#lp-pv-fill)"/>
      <path d="M0 74 C 30 70, 46 58, 75 60 S 120 70, 150 50 S 200 44, 225 34 S 270 18, 300 12" class="lp-preview-line"/>
    </svg>
    <span class="lp-preview-dot" aria-hidden="true"></span>
    <ul class="lp-preview-list">
      <li><span class="lp-pv-ic">${iconHTML('sparkles', { size: 14, stroke: 2 })}</span><span class="lp-pv-name">${t('body.preview.item1')}</span><span class="lp-pv-state is-ai">${t('body.preview.state1')}</span></li>
      <li><span class="lp-pv-ic">${iconHTML('users', { size: 14, stroke: 2 })}</span><span class="lp-pv-name">${t('body.preview.item2')}</span><span class="lp-pv-state">${t('body.preview.state2')}</span></li>
    </ul>
  </div>`
}

function heroHTML(user) {
  return `
  <section class="lp-hero" aria-labelledby="lp-hero-title">
    <div class="lp-hero-glow" aria-hidden="true"></div>
    <div class="lp-container lp-hero-grid">
      <div class="lp-hero-copy">
        <p class="lp-hero-badge reveal"><span class="pulse-dot" aria-hidden="true"></span>${esc(HERO.badge)}</p>
        <h1 class="display lp-hero-title reveal" style="--d: 80ms" id="lp-hero-title">${emHTML(HERO.title)}</h1>
        <p class="lp-hero-sub reveal" style="--d: 160ms">${esc(HERO.subtitle)}</p>
        <div class="lp-hero-ctas reveal" style="--d: 240ms">
          ${primaryCta(user, { size: 'btn-lg' })}
          <a class="btn btn-lg btn-ghost lp-btn-quiet" href="#alur" data-scroll="alur">${t('body.hero.seeFlow')} ${iconHTML('chevronDown', { size: 18 })}</a>
        </div>
        <ul class="lp-hero-points reveal" style="--d: 320ms">
          ${HERO_POINTS.map((p) => `<li><span class="lp-tick">${iconHTML('check', { size: 12, stroke: 3 })}</span>${esc(p)}</li>`).join('')}
        </ul>
      </div>
      <div class="lp-hero-visual reveal" style="--d: 200ms">
        <div class="lp-scene" data-scene aria-hidden="true">
          <svg class="lp-scene-fallback" viewBox="0 0 400 420" fill="none" aria-hidden="true">
            <ellipse cx="200" cy="350" rx="185" ry="46" fill="var(--surface)" stroke="var(--line)"/>
            <rect x="48" y="282" width="38" height="62" rx="9" fill="var(--brand-300)"/>
            <rect x="102" y="250" width="38" height="94" rx="9" fill="var(--brand-300)" opacity="0.9"/>
            <rect x="156" y="214" width="38" height="130" rx="9" fill="var(--brand-500)" opacity="0.75"/>
            <rect x="210" y="174" width="38" height="170" rx="9" fill="var(--brand-500)"/>
            <rect x="264" y="130" width="38" height="214" rx="9" fill="var(--brand-600)"/>
            <rect x="318" y="82" width="38" height="262" rx="9" fill="var(--brand)"/>
            <path d="M40 300 L67 282 L121 250 L175 214 L229 174 L283 130 L337 82 L372 58" stroke="var(--brand-500)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="121" cy="236" r="12" fill="var(--accent)"/>
          </svg>
        </div>
        <div class="lp-chip-float" aria-hidden="true">
          <span class="lp-chip-ic">${iconHTML('checkCircle', { size: 18, stroke: 2 })}</span>
          <span><strong>${t('body.hero.chipTitle')}</strong><small>${t('body.hero.chipSub')}</small></span>
        </div>
        ${previewHTML()}
      </div>
    </div>
  </section>`
}

function tickerHTML() {
  const items = TICKER.map((x) => `<li class="lp-pill">${iconHTML(x.icon, { size: 16, stroke: 1.9 })}${esc(x.label)}</li>`).join('')
  return `
  <section class="lp-ticker" aria-label="${t('body.ticker.label')}">
    <p class="lp-ticker-cap reveal">${t('body.ticker.caption')}</p>
    <div class="lp-ticker-viewport">
      <div class="lp-ticker-track">
        <ul>${items}</ul>
        <ul aria-hidden="true">${items}</ul>
      </div>
    </div>
  </section>`
}

function flowHTML() {
  const cells = STAGES.map((s, i) => `
    <li class="lp-stage" data-stage="${i}">
      <span class="lp-stage-node" aria-hidden="true">${iconHTML(s.icon, { size: 20, stroke: 1.9 })}</span>
      <article class="lp-stage-card reveal" style="--d: ${i * 70}ms">
        <div class="lp-stage-top">
          <span class="lp-stage-no">${t('body.flow.stage', { no: s.no })}</span>
          ${s.ai ? '<span class="tag tag-accent">AI</span>' : ''}
        </div>
        <h3 class="lp-stage-title">${esc(s.title)}</h3>
        <p class="lp-stage-desc">${esc(s.desc)}</p>
        <p class="lp-stage-out"><span>${t('body.flow.result')}</span>${esc(s.out)}</p>
      </article>
    </li>`).join('')
  return `
  <section class="lp-section" id="alur" aria-labelledby="lp-alur-title">
    <div class="lp-container">
      <header class="lp-head lp-head-center">
        <p class="eyebrow reveal">${t('body.flow.eyebrow')}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-alur-title">${t('body.flow.title')}</h2>
        <p class="lp-lede reveal" style="--d: 120ms">${t('body.flow.lede')}</p>
        <dl class="lp-facts reveal" style="--d: 180ms">
          <div><dt>${t('body.flow.factStages')}</dt><dd class="tnum" data-count="6">6</dd></div>
          <div><dt>${t('body.flow.factTeams')}</dt><dd class="tnum" data-count="5">5</dd></div>
          <div><dt>${t('body.flow.factGroups')}</dt><dd class="tnum" data-count="2">2</dd></div>
        </dl>
      </header>
      <div class="lp-flow" data-flow>
        <svg class="lp-flow-svg" aria-hidden="true" data-flow-svg>
          <path class="lp-flow-track" data-flow-track d=""/>
          <path class="lp-flow-line" data-flow-line d="" pathLength="1"/>
          <circle class="lp-flow-head" data-flow-head r="6" cx="-20" cy="-20"/>
        </svg>
        <ol class="lp-stages">${cells}</ol>
      </div>
    </div>
  </section>`
}

function featuresHTML() {
  const rows = FEATURES.map((f, i) => `
    <li class="lp-feature reveal" style="--d: ${i * 80}ms">
      <span class="lp-feature-icon">${iconHTML(f.icon, { size: 20, stroke: 1.9 })}</span>
      <div>
        <h3 class="lp-feature-title">${esc(f.title)}${f.tag ? ` <span class="tag">${esc(f.tag)}</span>` : ''}</h3>
        <p class="lp-feature-desc">${esc(f.desc)}</p>
      </div>
    </li>`).join('')
  const sr = t('body.ai.sr', { request: AGENT_DEMO.request, fields: AGENT_DEMO.fields.map((f) => `${f.label}: ${f.value}`).join('; '), checks: AGENT_DEMO.checks.join('; '), status: AGENT_DEMO.status })
  return `
  <section class="lp-section" id="fitur-ai" aria-labelledby="lp-ai-title">
    <div class="lp-container">
      <div class="lp-ai">
        <div class="lp-ai-copy">
          <header class="lp-head">
            <p class="eyebrow reveal">${t('body.ai.eyebrow')}</p>
            <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-ai-title">${t('body.ai.title')}</h2>
            <p class="lp-lede reveal" style="--d: 120ms">${t('body.ai.lede')}</p>
          </header>
          <ul class="lp-features">${rows}</ul>
        </div>
        <figure class="lp-chat reveal" style="--d: 140ms">
          <div class="lp-chat-head">
            <span class="lp-chat-head-ic">${iconHTML('sparkles', { size: 18, stroke: 1.9 })}</span>
            <div class="lp-chat-head-text">
              <p>${t('body.ai.chatTitle')}</p>
              <span><span class="pulse-dot" aria-hidden="true"></span>AI<span class="lp-hide-xs">&nbsp;${t('body.ai.live')}</span></span>
            </div>
            <span class="tag tag-accent">${t('body.example')}</span>
          </div>
          <div class="lp-chat-body" data-agent aria-hidden="true"></div>
          <p class="sr-only">${esc(sr)}</p>
          <figcaption class="lp-chat-cap">${iconHTML('info', { size: 14 })}${t('body.ai.caption')}</figcaption>
        </figure>
      </div>
    </div>
  </section>`
}

/* ------------------------------------------------------------------ */
/* Pendapatan: the two money engines + the shared five-team room       */
/* ------------------------------------------------------------------ */

/** Escaped text with "*word*" turned into <em>word</em> (same convention as the hero). */
const emHTML = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>')

function vasPreview(p) {
  const rows = p.rows.map((r) => {
    const rate = Math.min(100, Math.max(0, r.rate))
    return `
    <li>
      <span class="lp-vas-name"><span>${esc(r.name)}</span><em class="tnum">${esc(r.price)}</em></span>
      <span class="lp-vas-bar" aria-hidden="true"><i style="width: ${rate}%"></i></span>
      <b class="tnum">${rate}%</b>
    </li>`
  }).join('')
  const sr = t('body.income.vasSr', { rows: p.rows.map((r) => t('body.income.vasSrRow', { name: r.name, price: r.price, rate: r.rate })).join('; '), label: p.footer.label, value: p.footer.value })
  return `
  <div class="lp-inc-preview lp-vas" role="img" aria-label="${esc(sr)}">
    <div class="lp-inc-pv-head"><p>${esc(p.title)}</p><span class="tag tag-accent">${t('body.example')}</span></div>
    <ul class="lp-vas-rows">${rows}</ul>
    <p class="lp-inc-pv-foot"><span>${esc(p.footer.label)}</span><strong class="tnum">${esc(p.footer.value)}</strong></p>
  </div>`
}

function wastePreview(p) {
  const pct = Math.min(100, Math.max(0, p.percent))
  const rows = p.rows.map((r) => `<li><span>${esc(r.label)}</span><b class="tnum">${esc(r.value)}</b></li>`).join('')
  const sr = t('body.income.wasteSr', { percent: p.percent, rows: p.rows.map((r) => `${r.label} ${r.value}`).join('; '), label: p.footer.label, value: p.footer.value })
  return `
  <div class="lp-inc-preview lp-zw" role="img" aria-label="${esc(sr)}">
    <div class="lp-inc-pv-head"><p>${esc(p.title)}</p><span class="tag tag-accent">${t('body.example')}</span></div>
    <div class="lp-zw-body">
      <div class="lp-zw-meter">
        <div class="lp-zw-ring" style="--p: ${pct}"><span class="tnum">${pct}%</span></div>
        <small>${t('body.income.wasteFree')}</small>
      </div>
      <ul class="lp-zw-rows">${rows}</ul>
    </div>
    <p class="lp-inc-pv-foot"><span>${esc(p.footer.label)}</span><strong class="tnum">${esc(p.footer.value)}</strong></p>
  </div>`
}

function incomeHTML() {
  const engines = INCOME.engines.map((e, i) => `
    <article class="lp-inc-engine reveal" style="--d: ${i * 90}ms">
      <header class="lp-inc-head">
        <span class="lp-inc-icon">${iconHTML(e.icon, { size: 20, stroke: 1.9 })}</span>
        <div>
          <p class="lp-inc-kicker">${esc(e.kicker)}</p>
          <h3 class="lp-inc-title">${esc(e.title)}</h3>
        </div>
      </header>
      <p class="lp-inc-desc">${esc(e.desc)}</p>
      <ul class="lp-inc-points">
        ${e.points.map((p) => `<li><span class="lp-tick">${iconHTML('check', { size: 12, stroke: 3 })}</span>${esc(p)}</li>`).join('')}
      </ul>
      ${e.id === 'vas' ? vasPreview(e.preview) : wastePreview(e.preview)}
    </article>`).join('')
  const teams = INCOME.room.teams.map((name, i) => `<li style="--i: ${i}">${esc(name)}</li>`).join('')
  const briefs = INCOME.room.briefs.map((b) => `<li>${esc(b)}</li>`).join('')
  return `
  <section class="lp-section lp-income" id="pendapatan" aria-labelledby="lp-income-title">
    <div class="lp-container">
      <header class="lp-head lp-head-center">
        <p class="eyebrow reveal">${esc(INCOME.eyebrow)}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-income-title">${emHTML(INCOME.title)}</h2>
        <p class="lp-lede reveal" style="--d: 120ms">${esc(INCOME.lede)}</p>
      </header>
      <div class="lp-inc-grid">${engines}</div>
      <aside class="lp-inc-room reveal" aria-labelledby="lp-inc-room-title">
        <div class="lp-inc-room-copy">
          <p class="lp-inc-kicker">${iconHTML(INCOME.room.icon, { size: 16, stroke: 1.9 })}${esc(INCOME.room.kicker)}</p>
          <h3 class="lp-inc-room-title" id="lp-inc-room-title">${esc(INCOME.room.title)}</h3>
          <p class="lp-inc-room-desc">${esc(INCOME.room.desc)}</p>
          <ul class="lp-inc-briefs">${briefs}</ul>
        </div>
        <div class="lp-inc-room-visual" aria-hidden="true">
          <ul class="lp-inc-teams">${teams}</ul>
          <span class="lp-inc-link"></span>
          <div class="lp-inc-lead">${iconHTML('sparkles', { size: 15, stroke: 1.9 })}<span>${esc(INCOME.room.lead)}</span></div>
        </div>
      </aside>
    </div>
  </section>`
}

/* ------------------------------------------------------------------ */
/* Pertumbuhan: five menus that turn flow data into new work           */
/* ------------------------------------------------------------------ */

function growVisual(c) {
  if (c.chips) {
    return `<ul class="lp-grow-chips">${c.chips.map((ch) => `<li>${iconHTML(ch.icon, { size: 14, stroke: 1.9 })}${esc(ch.label)}</li>`).join('')}</ul>`
  }
  if (c.stat) {
    return `
    <div class="lp-grow-stat">
      <p class="lp-grow-score"><span class="tnum">${c.stat.score}</span><small>${esc(c.stat.label)}</small></p>
      <dl class="lp-grow-dl">
        ${c.stat.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="tnum">${esc(v)}</dd></div>`).join('')}
      </dl>
    </div>`
  }
  if (c.leads) {
    return `
    <ul class="lp-grow-leads">
      ${c.leads.map((l) => `
      <li>
        <span class="lp-grow-lead-name">${esc(l.name)}</span>
        <span class="lp-grow-lead-score tnum">${l.score}</span>
        <span class="lp-grow-lead-val tnum">${esc(l.value)}</span>
      </li>`).join('')}
    </ul>`
  }
  if (c.post) {
    return `
    <div class="lp-grow-post">
      <div class="lp-grow-post-art" aria-hidden="true">
        <span class="lp-grow-post-art-ico">${iconHTML('zap', { size: 14, stroke: 2 })}</span>
        <strong>${esc(c.post.headline)}</strong>
        <small>${esc(c.post.sub)}</small>
      </div>
      <div class="lp-grow-post-body">
        <p class="lp-grow-post-acct">
          <span class="lp-grow-post-ava" aria-hidden="true">${esc(c.post.initials)}</span>
          <span class="lp-grow-post-name">${esc(c.post.account)}</span>
          <span class="lp-grow-post-plat">${esc(c.post.platform)}</span>
        </p>
        <p class="lp-grow-post-cap">${esc(c.post.caption)}</p>
        <p class="lp-grow-post-meta">
          <span class="lp-grow-post-when">${iconHTML('calendar', { size: 12, stroke: 2 })}${esc(t('body.growth.scheduled', { when: c.post.when }))}</span>
          <span class="lp-grow-post-ai">${iconHTML('sparkles', { size: 12, stroke: 2 })}${t('body.growth.aiWritten')}</span>
        </p>
      </div>
    </div>`
  }
  return ''
}

function growthHTML() {
  const cards = GROWTH.cards.map((c, i) => `
    <article class="lp-grow-card reveal" style="--d: ${i * 70}ms">
      <header class="lp-grow-head">
        <span class="lp-grow-icon">${iconHTML(c.icon, { size: 19, stroke: 1.9 })}</span>
        <h3 class="lp-grow-title">${esc(c.title)}</h3>
        ${c.stat || c.leads || c.post ? `<span class="tag tag-accent">${t('body.example')}</span>` : ''}
      </header>
      <p class="lp-grow-desc">${esc(c.desc)}</p>
      ${growVisual(c)}
    </article>`).join('')
  const assistants = GROWTH.assistants.map((a, i) => `
    <article class="lp-grow-assist reveal" style="--d: ${i * 90}ms">
      <header class="lp-grow-head">
        <span class="lp-grow-icon">${iconHTML(a.icon, { size: 19, stroke: 1.9 })}</span>
        <h3 class="lp-grow-title">${esc(a.title)}</h3>
      </header>
      <p class="lp-grow-desc">${esc(a.desc)}</p>
      ${a.sample ? `<p class="lp-grow-quote">${iconHTML('bot', { size: 14, stroke: 1.9 })}<span><span class="tag tag-accent">${t('body.example')}</span> ${esc(a.sample)}</span></p>` : ''}
      ${a.tools ? `<ul class="lp-grow-tools">${a.tools.map((tool) => `<li>${esc(tool)}</li>`).join('')}</ul>` : ''}
    </article>`).join('')
  return `
  <section class="lp-section lp-growth-sec" id="pertumbuhan" aria-labelledby="lp-growth-title">
    <div class="lp-container">
      <header class="lp-head lp-head-center">
        <p class="eyebrow reveal">${esc(GROWTH.eyebrow)}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-growth-title">${emHTML(GROWTH.title)}</h2>
        <p class="lp-lede reveal" style="--d: 120ms">${esc(GROWTH.lede)}</p>
      </header>
      <div class="lp-grow-grid">${cards}</div>
      <div class="lp-grow-assists">${assistants}</div>
      <p class="lp-note lp-note-center reveal">${iconHTML('info', { size: 14 })}${esc(GROWTH.note)}</p>
    </div>
  </section>`
}

function integrationHTML() {
  const cards = INTEGRATION.cards.map((c, i) => `
    <article class="lp-int-card reveal" style="--d: ${i * 70}ms">
      <span class="lp-int-icon">${iconHTML(c.icon, { size: 20, stroke: 1.9 })}</span>
      <h3 class="lp-int-title">${esc(c.title)}</h3>
      <p class="lp-int-desc">${esc(c.desc)}</p>
    </article>`).join('')
  const steps = INTEGRATION.steps.map((s, i) => `
    <li class="lp-int-step reveal" style="--d: ${i * 80}ms">
      <span class="lp-int-step-no" aria-hidden="true">${esc(s.no)}</span>
      <div class="lp-int-step-body">
        <h4 class="lp-int-step-title">${esc(s.title)}</h4>
        <p class="lp-int-step-desc">${esc(s.desc)}</p>
      </div>
    </li>`).join('')
  return `
  <section class="lp-section lp-int-sec" id="integrasi" aria-labelledby="lp-int-title">
    <div class="lp-container">
      <header class="lp-head lp-head-center">
        <p class="eyebrow reveal">${esc(INTEGRATION.eyebrow)}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-int-title">${emHTML(INTEGRATION.title)}</h2>
        <p class="lp-lede reveal" style="--d: 120ms">${esc(INTEGRATION.lede)}</p>
        <p class="lp-int-badge reveal" style="--d: 160ms">${iconHTML('lock', { size: 12, stroke: 2 })}${esc(INTEGRATION.badge)}</p>
      </header>
      <div class="lp-int-grid">${cards}</div>
      <ol class="lp-int-steps">${steps}</ol>
      <p class="lp-note lp-note-center reveal">${iconHTML('info', { size: 14 })}${esc(INTEGRATION.note)}</p>
    </div>
  </section>`
}

function visionHTML() {
  const cards = ROADMAP.map((r, i) => `
    <li class="lp-road reveal" style="--d: ${i * 90}ms">
      <span class="lp-road-icon">${iconHTML(r.icon, { size: 20, stroke: 1.9 })}</span>
      <div class="lp-road-body">
        <div class="lp-road-top">
          <h3 class="lp-road-title">${esc(r.title)}</h3>
          <span class="tag">${t('body.vision.comingSoon')}</span>
        </div>
        <p class="lp-road-desc">${esc(r.desc)}</p>
      </div>
    </li>`).join('')
  return `
  <section class="lp-section lp-vision" id="ide-besar" aria-labelledby="lp-vision-title">
    <div class="lp-container lp-vision-grid">
      <header class="lp-head lp-vision-head">
        <p class="eyebrow reveal">${t('body.vision.eyebrow')}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-vision-title">${t('body.vision.title')}</h2>
        <p class="lp-lede reveal" style="--d: 120ms">${t('body.vision.lede')}</p>
        <div class="lp-growth reveal" style="--d: 180ms" aria-hidden="true">
          <svg viewBox="0 0 360 150" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lp-growth-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="var(--brand-500)" stop-opacity="0.18"/>
                <stop offset="1" stop-color="var(--brand-500)" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="M0 128 C 40 124, 70 110, 100 112 S 160 96, 196 84 V150 H0Z" fill="url(#lp-growth-fill)"/>
            <path class="lp-growth-now" d="M0 128 C 40 124, 70 110, 100 112 S 160 96, 196 84"/>
            <path class="lp-growth-next" d="M196 84 C 240 70, 280 52, 356 22"/>
            <line class="lp-growth-split" x1="196" x2="196" y1="10" y2="150"/>
          </svg>
          <span class="lp-growth-dot"></span>
          <span class="lp-growth-label lp-growth-label-a">${t('body.vision.labelNow')}</span>
          <span class="lp-growth-label lp-growth-label-b">${t('body.vision.labelNext')}</span>
        </div>
      </header>
      <div class="lp-vision-list">
        <ol class="lp-roadmap">${cards}</ol>
        <p class="lp-note reveal">${iconHTML('flag', { size: 14 })}${t('body.vision.note')}</p>
      </div>
    </div>
  </section>`
}

function pricingHTML() {
  const tiers = localizedTiers(PRICING_TIERS).map((tier, i) => {
    const variant = { primary: 'btn-primary', accent: 'btn-accent', soft: 'btn-soft' }[tier.cta.variant] || ''
    const cta = tier.cta.href
      ? `<a class="btn btn-lg ${variant} lp-tier-cta" href="${tier.cta.href}">${esc(tier.cta.label)} ${iconHTML('arrowRight', { className: 'icon-trailing' })}</a>`
      : `<a class="btn btn-lg ${variant} lp-tier-cta" href="#/kontak" aria-describedby="lp-contact-note">${esc(tier.cta.label)} ${iconHTML('arrowUpRight', { className: 'icon-trailing' })}</a>`
    return `
    <article class="lp-tier reveal${tier.recommended ? ' is-recommended' : ''}" style="--d: ${i * 90}ms" aria-labelledby="tier-${tier.id}">
      <header class="lp-tier-head">
        <div class="lp-tier-name-row">
          <h3 class="lp-tier-name" id="tier-${tier.id}">${esc(tier.name)}</h3>
          ${tier.recommended ? `<span class="tag tag-accent lp-tier-badge">${iconHTML('sparkles', { size: 12, stroke: 2 })}${esc(tier.badge)}</span>` : tier.badge ? `<span class="tag lp-tier-pill">${iconHTML('shield', { size: 12, stroke: 2 })}${esc(tier.badge)}</span>` : ''}
        </div>
        <p class="lp-tier-tag">${esc(tier.tagline)}</p>
      </header>
      <p class="lp-tier-price"><span class="display lp-price${isLongPrice(tier.price) ? ' is-long' : ''}">${esc(tier.price)}</span><span class="lp-period">${esc(tier.period)}</span></p>
      <dl class="lp-tier-limits">
        ${tier.limits.map((l) => `<div><dt>${esc(l.label)}</dt><dd>${esc(l.value)}</dd></div>`).join('')}
      </dl>
      <ul class="lp-tier-features">
        ${tier.features.map((f) => `<li><span class="lp-tick">${iconHTML('check', { size: 12, stroke: 3 })}</span><span>${esc(f)}</span></li>`).join('')}
      </ul>
      ${cta}
    </article>`
  }).join('')
  return `
  <section class="lp-section" id="harga" aria-labelledby="lp-price-title">
    <div class="lp-container">
      <header class="lp-head lp-head-center">
        <p class="eyebrow reveal">${t('body.pricing.eyebrow')}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-price-title">${t('body.pricing.title')}</h2>
        <p class="lp-lede reveal" id="lp-price-lede" style="--d: 120ms">${t('body.pricing.lede')}</p>
      </header>
      <div class="lp-tiers">${tiers}</div>
      <p class="lp-note lp-note-center reveal">${iconHTML('info', { size: 14 })}<span id="lp-draft-note">${esc(t('body.pricing.note'))} </span><span id="lp-contact-note">${t('body.pricing.contactNote')}</span></p>
    </div>
  </section>`
}

function faqHTML() {
  const items = FAQS.map((f, i) => `
    <div class="lp-faq-item">
      <h3 class="lp-faq-q">
        <button type="button" id="faq-q-${i}" aria-expanded="false" aria-controls="faq-a-${i}" data-faq>
          <span class="lp-faq-text">${esc(f.q)}</span>
          <span class="lp-faq-icon" aria-hidden="true">${iconHTML('plus', { size: 16, stroke: 2 })}</span>
        </button>
      </h3>
      <div class="lp-faq-a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}" inert>
        <div><p>${esc(f.a)}</p></div>
      </div>
    </div>`).join('')
  return `
  <section class="lp-section" id="faq" aria-labelledby="lp-faq-title">
    <div class="lp-container lp-faq-grid">
      <header class="lp-head lp-faq-head">
        <p class="eyebrow reveal">${t('body.faq.eyebrow')}</p>
        <h2 class="display lp-h2 reveal" style="--d: 60ms" id="lp-faq-title">${t('body.faq.title')}</h2>
        <p class="lp-lede reveal" style="--d: 120ms">${t('body.faq.lede')}</p>
      </header>
      <div class="lp-faq reveal" style="--d: 100ms">${items}</div>
    </div>
  </section>`
}

function ctaHTML(user) {
  return `
  <section class="lp-cta-wrap" aria-labelledby="lp-cta-title">
    <div class="lp-container">
      <div class="lp-cta reveal">
        <svg class="lp-cta-lines" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-40 330 C 220 250, 380 380, 620 290 S 980 120, 1240 170"/>
          <path d="M-40 370 C 240 300, 420 420, 660 330 S 1000 170, 1240 220"/>
          <path d="M-40 290 C 200 200, 360 340, 580 250 S 960 70, 1240 120"/>
          <circle cx="1028" cy="146" r="7"/>
        </svg>
        <div class="lp-cta-inner">
          <p class="lp-cta-eyebrow">${iconHTML('sprout', { size: 16, stroke: 1.9 })}${t('body.cta.eyebrow')}</p>
          <h2 class="display lp-cta-title" id="lp-cta-title">${t('body.cta.title')}</h2>
          <p class="lp-cta-sub">${t('body.cta.sub')}</p>
          <div class="lp-cta-row">
            ${primaryCta(user, { size: 'btn-lg', label: t('body.cta.button'), variant: 'btn-accent' })}
            <a class="lp-cta-link" href="#harga" data-scroll="harga">${t('body.cta.compare')} ${iconHTML('arrowRight', { size: 16 })}</a>
          </div>
        </div>
      </div>
    </div>
  </section>`
}

function footerHTML() {
  const col = (title, links) => `
    <div class="lp-foot-col">
      <h2>${title}</h2>
      <ul>${links.map(([label, attr]) => `<li><a ${attr}>${label}</a></li>`).join('')}</ul>
    </div>`
  return `
  <footer class="lp-footer" aria-labelledby="lp-foot-title">
    <div class="lp-container">
      <div class="lp-foot-top">
        <div class="lp-foot-intro">
          <h2 class="sr-only" id="lp-foot-title">Satu Alur</h2>
          <div data-slot="foot-logo"></div>
          <p class="lp-foot-lede">${t('footer.lede')}</p>
          <p class="lp-foot-made">${iconHTML('mapPin', { size: 14 })}${t('footer.made')}</p>
        </div>
        <div class="lp-foot-cols">
          ${col(t('footer.cols.product'), [
            [t('footer.links.flow'), 'href="#alur" data-scroll="alur"'],
            [t('footer.links.income'), 'href="#pendapatan" data-scroll="pendapatan"'],
            [t('footer.links.growth'), 'href="#pertumbuhan" data-scroll="pertumbuhan"'],
            [t('footer.links.erp'), 'href="#integrasi" data-scroll="integrasi"'],
            [t('footer.links.ai'), 'href="#fitur-ai" data-scroll="fitur-ai"'],
            [t('footer.links.pricing'), 'href="#harga" data-scroll="harga"'],
            [t('footer.links.faq'), 'href="#faq" data-scroll="faq"'],
          ])}
          ${col(t('footer.cols.company'), [
            [t('footer.links.about'), 'href="#/tentang"'],
            [t('footer.links.roadmap'), 'href="#ide-besar" data-scroll="ide-besar"'],
            [t('footer.links.contact'), 'href="#/kontak"'],
          ])}
          ${col(t('footer.cols.legal'), [
            [t('footer.links.privacy'), 'href="#/privasi"'],
            [t('footer.links.terms'), 'href="#/syarat"'],
            [t('footer.links.cookies'), 'href="#/cookie"'],
          ])}
        </div>
      </div>
      <p class="display lp-foot-line" aria-hidden="true">${t('footer.line')}</p>
      <div class="lp-foot-base">
        <span>${t('footer.copyright')}</span>
        <span>${t('footer.tagline')}</span>
      </div>
    </div>
  </footer>
  <button type="button" class="lp-totop" aria-label="${t('footer.toTop')}" data-totop>${iconHTML('arrowUp', { size: 20 })}</button>`
}

/* ------------------------------------------------------------------ */
/* Flow path (drawn through the stage nodes, revealed on scroll)       */
/* ------------------------------------------------------------------ */

function setupFlowPath(page, reduced) {
  const flow = page.querySelector('[data-flow]')
  const svg = page.querySelector('[data-flow-svg]')
  const track = page.querySelector('[data-flow-track]')
  const line = page.querySelector('[data-flow-line]')
  const head = page.querySelector('[data-flow-head]')
  const stages = [...page.querySelectorAll('[data-stage]')]
  const nodes = stages.map((s) => s.querySelector('.lp-stage-node'))
  let total = 0
  let marks = [] // path length at each node
  let horizontal = true
  let shown = -1

  function layout() {
    const box = flow.getBoundingClientRect()
    const W = Math.max(1, box.width)
    const H = Math.max(1, box.height)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const pts = nodes.map((n) => {
      const r = n.getBoundingClientRect()
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }
    })
    horizontal = Math.abs(pts[1].x - pts[0].x) > Math.abs(pts[1].y - pts[0].y)
    const segs = []
    let d
    if (horizontal) {
      const midY = (pts[0].y + pts[1].y) / 2
      const lead = { x: 0, y: midY }
      d = `M${lead.x} ${lead.y}`
      let prev = lead
      ;[...pts, { x: W, y: midY }].forEach((p) => {
        const dx = (p.x - prev.x) / 2
        const s = ` C${prev.x + dx} ${prev.y} ${p.x - dx} ${p.y} ${p.x} ${p.y}`
        d += s
        segs.push(d)
        prev = p
      })
    } else {
      const start = { x: pts[0].x, y: Math.max(0, pts[0].y - 30) }
      d = `M${start.x} ${start.y}`
      let prev = start
      ;[...pts, { x: pts[0].x, y: Math.min(H, pts[pts.length - 1].y + 40) }].forEach((p) => {
        d += ` L${p.x} ${p.y}`
        segs.push(d)
        prev = p
      })
    }
    track.setAttribute('d', d)
    line.setAttribute('d', d)
    total = track.getTotalLength()
    // Measure the length at each node by measuring the prefix path.
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.append(probe)
    marks = segs.slice(0, pts.length).map((sd) => { probe.setAttribute('d', sd); return probe.getTotalLength() })
    probe.remove()
    shown = -1
    update()
  }

  function update() {
    if (!total) return
    let p = 1
    if (!reduced) {
      const r = flow.getBoundingClientRect()
      const vh = window.innerHeight
      p = horizontal
        ? clamp01((vh * 0.92 - r.top) / (vh * 0.62))
        : clamp01((vh * 0.7 - r.top) / Math.max(1, r.height))
    }
    const len = p * total
    line.style.strokeDashoffset = String(1 - p)
    if (p > 0.001 && p < 0.999) {
      const pt = line.getPointAtLength(len)
      head.setAttribute('cx', pt.x)
      head.setAttribute('cy', pt.y)
      head.classList.add('is-on')
    } else {
      head.classList.remove('is-on')
    }
    let reached = -1
    marks.forEach((m, i) => { if (len >= m - 1) reached = i })
    if (reached !== shown) {
      shown = reached
      stages.forEach((s, i) => {
        s.classList.toggle('is-reached', i <= reached)
        s.classList.toggle('is-current', i === reached)
      })
    }
  }

  const ro = new ResizeObserver(() => layout())
  ro.observe(flow)
  // Fonts can shift card heights after first layout.
  document.fonts?.ready?.then(() => { if (flow.isConnected) layout() })
  return { update, dispose: () => ro.disconnect() }
}

/* ------------------------------------------------------------------ */
/* Behaviour                                                           */
/* ------------------------------------------------------------------ */

export function renderLanding(root, ctx = {}) {
  ;({ NAV, HERO, HERO_POINTS, STAGES, TICKER, FEATURES, INCOME, GROWTH, INTEGRATION, ROADMAP, FAQS, AGENT_DEMO } = localizedContent())
  const prevTitle = document.title
  document.title = t('body.meta.title')
  const metaDesc = document.querySelector('meta[name="description"]')
  if (metaDesc) metaDesc.setAttribute('content', t('body.meta.description'))
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
    <a class="lp-skip" href="#lp-main" data-scroll="lp-main">${t('header.skip')}</a>
    ${headerHTML(user)}
    <main id="lp-main" tabindex="-1">
      ${heroHTML(user)}
      ${tickerHTML()}
      ${flowHTML()}
      ${incomeHTML()}
      ${growthHTML()}
      ${integrationHTML()}
      ${featuresHTML()}
      ${visionHTML()}
      ${pricingHTML()}
      ${faqHTML()}
      ${ctaHTML(user)}
    </main>
    ${footerHTML()}`
  root.append(page)

  page.querySelector('[data-slot="logo"]').replaceWith(logoLink({ size: 30 }))
  page.querySelector('[data-slot="foot-logo"]').replaceWith(logoLink({ size: 30 }))
  page.querySelector('[data-slot="theme"]').replaceWith(langToggleButton(), themeToggleButton())

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

  /* --- Flow path --- */
  const flowPath = setupFlowPath(page, reduced)
  disposers.push(flowPath.dispose)

  /* --- Scroll: progress bar, header state, back-to-top, flow path --- */
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      const y = window.scrollY
      const max = document.documentElement.scrollHeight - window.innerHeight
      progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`
      header.classList.toggle('is-scrolled', y > 12)
      toTop.classList.toggle('is-visible', y > 600)
      flowPath.update()
    })
  }
  on(window, 'scroll', onScroll, { passive: true })
  on(window, 'resize', onScroll, { passive: true })
  onScroll()

  on(toTop, 'click', () => {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    header.querySelector('.brand-link')?.focus({ preventScroll: true })
  })

  /* --- Active nav link follows the section in view --- */
  const navLinks = [...page.querySelectorAll('[data-nav]')]
  const sectionIO = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      navLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.nav === entry.target.id))
    })
  }, { rootMargin: '-45% 0px -50% 0px' })
  NAV.forEach((n) => { const s = page.querySelector(`#${n.id}`); if (s) sectionIO.observe(s) })
  disposers.push(() => sectionIO.disconnect())
  // Back above the first nav section (the hero) nothing intersects, so the observer alone left the
  // last link (often FAQ after a jump to the top) highlighted. Clear it there.
  const firstNav = NAV.map((n) => page.querySelector(`#${n.id}`)).find(Boolean)
  on(window, 'scroll', () => {
    if (firstNav && firstNav.getBoundingClientRect().top > window.innerHeight * 0.5) navLinks.forEach((a) => a.classList.remove('is-active'))
  }, { passive: true })

  /* --- Mobile menu --- */
  let lastFocus = null
  let hideTimer = 0
  function openMenu() {
    window.clearTimeout(hideTimer)
    lastFocus = document.activeElement
    menu.hidden = false
    requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')))
    burger.setAttribute('aria-expanded', 'true')
    document.documentElement.classList.add('lp-lock')
    menu.querySelector('[data-menu-close]').focus()
  }
  function closeMenu(restore = true) {
    menu.classList.remove('is-open')
    burger.setAttribute('aria-expanded', 'false')
    document.documentElement.classList.remove('lp-lock')
    window.clearTimeout(hideTimer)
    if (reduced || !restore) menu.hidden = true
    else hideTimer = window.setTimeout(() => { menu.hidden = true }, 280)
    if (restore) (lastFocus || burger).focus()
  }
  disposers.push(() => window.clearTimeout(hideTimer))
  on(burger, 'click', openMenu)
  on(menu.querySelector('[data-menu-close]'), 'click', () => closeMenu())
  on(menu.querySelector('[data-menu-close-scrim]'), 'click', () => closeMenu())
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

  /* --- FAQ accordion (height animates via grid rows in CSS) --- */
  // Delegated, so FAQ rows swapped in from the API keep working.
  const faqList = page.querySelector('.lp-faq')
  on(faqList, 'click', (e) => {
    const btn = e.target.closest('[data-faq]')
    if (!btn) return
    const open = btn.getAttribute('aria-expanded') === 'true'
    const panel = document.getElementById(btn.getAttribute('aria-controls'))
    btn.setAttribute('aria-expanded', String(!open))
    btn.closest('.lp-faq-item').classList.toggle('is-open', !open)
    panel.inert = open
  })

  /* --- Editable content: defaults are already rendered; swap in stored fields (text nodes only) --- */
  let disposed = false
  getSite('landing').then((row) => {
    const v = row?.value
    // Stored copy is written by staff in Indonesian; other languages keep the translated defaults.
    if (disposed || !v || getLang() !== 'id') return
    renderHero(page.querySelector('.lp-hero-copy'), v.hero)
    const faqs = (Array.isArray(v.faqs) ? v.faqs : []).filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string' && f.q.trim() && f.a.trim())
    if (!faqs.length) return
    faqList.replaceChildren(...faqs.map((f, i) => {
      const item = document.createElement('div')
      item.className = 'lp-faq-item'
      item.innerHTML = `
        <h3 class="lp-faq-q">
          <button type="button" id="faq-q-${i}" aria-expanded="false" aria-controls="faq-a-${i}" data-faq>
            <span class="lp-faq-text"></span>
            <span class="lp-faq-icon" aria-hidden="true">${iconHTML('plus', { size: 16, stroke: 2 })}</span>
          </button>
        </h3>
        <div class="lp-faq-a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}" inert><div><p></p></div></div>`
      item.querySelector('.lp-faq-text').textContent = f.q.trim()
      item.querySelector('p').textContent = f.a.trim()
      return item
    }))
  }).catch(() => {})

  // Pricing: the built-in cards stay unless the API returns at least one active plan.
  getPlans().then((plans) => {
    if (disposed || !plans?.length) return
    page.querySelector('.lp-tiers').replaceChildren(...plans.map(renderPlanCard))
    // The built-in copy says "three plans" and "draft prices"; neither is true of live plans.
    page.querySelector('#lp-price-lede').textContent = t('body.pricing.liveLede')
    page.querySelector('#lp-draft-note').remove()
    // "Kontak penjualan Enterprise" and "Mulai gratis" only make sense when such a plan exists.
    if (!plans.some((p) => p.cta_kind === 'contact')) {
      page.querySelector('#lp-contact-note').remove()
      page.querySelector('.lp-tiers').querySelectorAll('[aria-describedby="lp-contact-note"]').forEach((a) => a.removeAttribute('aria-describedby'))
      page.querySelector('#harga .lp-note')?.remove()
    }
    if (!plans.some((p) => p.price_idr === 0)) page.querySelector('#lp-price-title').textContent = t('body.pricing.liveTitle')
  }).catch(() => {})

  /* --- Counters (real counts only: stages, AI agents, data flows) --- */
  if (!reduced && 'IntersectionObserver' in window) {
    const counters = [...page.querySelectorAll('[data-count]')]
    counters.forEach((el) => { el.textContent = '0' })
    const countIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        countIO.unobserve(entry.target)
        const el = entry.target
        const to = Number(el.dataset.count)
        let n = 0
        const iv = window.setInterval(() => {
          n += 1
          el.textContent = String(n)
          if (n >= to) window.clearInterval(iv)
        }, 140)
        disposers.push(() => window.clearInterval(iv))
      })
    }, { threshold: 0.6 })
    counters.forEach((el) => countIO.observe(el))
    disposers.push(() => countIO.disconnect())
  }

  /* --- Reveal, agent demo, 3D scene --- */
  disposers.push(observeReveal(page))
  disposers.push(mountAgentDemo(page.querySelector('[data-agent]'), AGENT_DEMO))

  let sceneCleanup = null
  mountFlowScene(page.querySelector('[data-scene]'), { highlight: 1 })
    .then((fn) => { if (disposed) fn?.(); else sceneCleanup = fn })
    .catch(() => {})

  return () => {
    disposed = true
    document.title = prevTitle
    sceneCleanup?.()
    disposers.forEach((d) => { try { d() } catch { /* ignore */ } })
    document.documentElement.classList.remove('lp-lock')
  }
}

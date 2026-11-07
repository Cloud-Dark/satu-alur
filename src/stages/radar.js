/**
 * Pertumbuhan — Radar peluang.
 * Finds implicit opportunities in the account's own transactions (repeat
 * services coming due, regulars going quiet, contract/package upsell,
 * cross-sell from co-purchases, stalled offers, re-approach after a rejection,
 * seasonal windows). Detection and scoring are deterministic (src/ai/radar-engine.js);
 * AI only writes follow-up messages and summaries, grounded on that evidence.
 */
import '../styles/radar.css'
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow } from './data.js'
import { resolveModel } from './offer.js'
import { getAgentParams } from './settings.js'
import { streamAnswer } from '../ai/advisor.js'
import { renderMarkdown } from './advisor.js'
import {
  buildRadar, applyStates, summarize, thisWeek, opportunityContext,
  OPP_TYPES, OPP_TYPE_KEYS, RULES, rp, pctText, fmtDate, DAY,
} from '../ai/radar-engine.js'
import { t, locale, getLang } from '../i18n/index.js'

const { el, icon } = C
const TABLE = 'opportunity_states'
const PAGE = 12
const TAB_STORE = 'satualur_radar_tab'
const SNOOZE_DAYS = 30
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu

const TABS = [
  { key: 'radar', icon: 'radar' },
  { key: 'week', icon: 'bellRing' },
  { key: 'ai', icon: 'sparkles' },
  { key: 'predict', icon: 'target' },
]
const sortOptions = () => ['score', 'value', 'recent'].map((value) => ({ value, label: t(`radar.sorts.${value}`) }))
// Labels for stable keys coming from the radar engine, worded in the viewer's language.
const typeLabel = (k, field = 'label') => (OPP_TYPES[k] ? t(`radar.types.${k}.${field}`) : k)
const tierLabel = (tier) => (tier && ['high', 'mid', 'low'].includes(tier.key) ? t(`radar.tier.${tier.key}`) : tier?.label || '')
const FACTOR_KEYS = ['chance', 'value', 'frequency', 'confidence', 'timing', 'lift']
const factorLabel = (f) => (FACTOR_KEYS.includes(f.key) ? t(`radar.factor.${f.key}`) : f.label)

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const pct0 = (r) => pctText(r, 0)
/** Drops null/false so Element.append never prints "null". */
const kids = (...xs) => xs.flat().filter((x) => x != null && x !== false)

/* ------------------------------------------------------------- Prompts */

const FOLLOWUP_SYSTEM = `[agent:radar]
Anda menulis pesan follow-up WhatsApp untuk usaha jasa di Indonesia, atas nama pemilik usaha, kepada satu pelanggan.
Aturan:
- Bahasa Indonesia yang sopan, hangat, dan singkat (maksimal 90 kata). Sapa pelanggan dengan namanya.
- Pakai HANYA fakta dari [DATA PELUANG]. Jangan mengarang harga, diskon, promo, garansi, tanggal, atau janji yang tidak ada di data.
- Jangan menyebut skor, persentase, data internal, atau istilah seperti churn, upsell, cross-sell, peluang.
- Tanpa emoji. Satu-satunya placeholder yang boleh: [Nama usaha] untuk tanda tangan.
- Akhiri dengan ajakan yang jelas, misalnya menanyakan jadwal yang cocok.
- Keluarkan hanya isi pesan, tanpa judul, tanpa penjelasan.`

const SUMMARY_SYSTEM = `[agent:radar]
Anda analis pertumbuhan untuk usaha jasa di Indonesia. Anda menerima daftar peluang teratas yang dideteksi otomatis (deterministik) dari data transaksi pengguna sendiri.
Tugas:
1. Untuk tiap peluang: satu judul "### <nomor>. <pelanggan atau musim>" lalu 2–3 kalimat: kenapa penting sekarang dan satu langkah konkret minggu ini.
2. Tutup dengan "### Urutan kerja minggu ini" berisi 3 butir.
Aturan:
- Pakai HANYA angka dan fakta dari [DATA PELUANG]. Jangan menambah angka, persentase, atau nama baru.
- Bila peluang historis tertulis "belum cukup data", katakan bahwa datanya belum cukup; jangan menebak.
- Tanpa emoji. Bahasa Indonesia yang ringkas dan praktis. Markdown sederhana saja.`

/* ================================================================ Render */

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const signal = ctx.signal
  let radar = null
  let states = []
  let statesOk = true
  let model = null
  let all = []
  let visible = []
  let hidden = []
  let filterType = 'all'
  let sort = 'score'
  let query = ''
  let showHidden = false
  let drawRadarList = null
  let radarListHost = null
  const rdPager = C.pager({ key: 'radar', label: 'daftar peluang', pageSize: PAGE, sizes: [PAGE, PAGE * 2, PAGE * 4], className: 'is-plain', onChange: () => drawRadarList?.(), scrollTarget: () => radarListHost })
  let aiCtl = null
  signal?.addEventListener('abort', () => { aiCtl?.abort(); closeDrawer({ restore: false }) })

  const modelReady = resolveModel().then((m) => { model = m; return m }).catch(() => null)

  /* ------------------------------------------------------------ Header */
  const asOf = el('span', { className: 'date-pill' }, icon('calendar', { size: 15 }), el('span', {}, t('radar.header.loading')))
  const refreshBtn = C.iconButton({ iconName: 'refresh', label: t('radar.header.refresh') })
  refreshBtn.addEventListener('click', () => load({ fresh: true }))
  const header = C.pageHeader({ title: t('radar.header.title'), actions: [asOf, refreshBtn] })

  /* ----------------------------------------------------------- Summary */
  const summaryHost = el('div', { className: 'kpis rd-kpis is-loading', 'aria-live': 'polite' },
    Array.from({ length: 4 }, () => el('div', { className: 'kpi' }, C.skeleton({ lines: 2 }))))

  /* -------------------------------------------------------------- Tabs */
  const tablist = el('div', { className: 'rd-tabs', role: 'tablist', 'aria-label': t('radar.tabsLabel') })
  const panelsWrap = el('div', { className: 'rd-panels' })
  const tabBtns = new Map()
  const tabPanels = new Map()
  const tabCounts = new Map()
  for (const tab of TABS) {
    const count = el('span', { className: 'rd-tab-count tnum', hidden: true })
    const b = el('button', {
      type: 'button', role: 'tab', className: 'rd-tab', id: `rd-tab-${tab.key}`,
      'aria-controls': `rd-panel-${tab.key}`, 'aria-selected': 'false', tabindex: '-1', dataset: { tab: tab.key },
    }, icon(tab.icon, { size: 16 }), el('span', {}, t(`radar.tabs.${tab.key}`)), count)
    b.addEventListener('click', () => activate(tab.key))
    tabBtns.set(tab.key, b)
    tabCounts.set(tab.key, count)
    tablist.appendChild(b)
    const p = el('div', { className: 'rd-panel', role: 'tabpanel', id: `rd-panel-${tab.key}`, 'aria-labelledby': `rd-tab-${tab.key}`, tabindex: '0', hidden: true })
    tabPanels.set(tab.key, p)
    panelsWrap.appendChild(p)
  }
  tablist.addEventListener('keydown', (e) => {
    const keys = TABS.map((tab) => tab.key)
    const i = keys.indexOf(document.activeElement?.dataset?.tab)
    if (i < 0) return
    const next = { ArrowRight: keys[(i + 1) % keys.length], ArrowDown: keys[(i + 1) % keys.length], ArrowLeft: keys[(i - 1 + keys.length) % keys.length], ArrowUp: keys[(i - 1 + keys.length) % keys.length], Home: keys[0], End: keys[keys.length - 1] }[e.key]
    if (!next) return
    e.preventDefault()
    activate(next)
    tabBtns.get(next).focus()
  })
  let currentTab = TABS.some((tab) => tab.key === store.get(TAB_STORE)) ? store.get(TAB_STORE) : 'radar'
  function activate(key) {
    currentTab = key
    for (const [k, b] of tabBtns) {
      const on = k === key
      b.setAttribute('aria-selected', on ? 'true' : 'false')
      b.tabIndex = on ? 0 : -1
      tabPanels.get(k).hidden = !on
    }
    store.set(TAB_STORE, key)
    drawTab(key)
  }

  const live = el('p', { className: 'sr-only', 'aria-live': 'polite' })
  container.replaceChildren(header, summaryHost, el('div', { className: 'rd-wrap' }, tablist, panelsWrap), live)
  for (const tab of TABS) tabPanels.get(tab.key).replaceChildren(C.skeletonRows(4))
  activate(currentTab)

  /* --------------------------------------------------------------- Data */
  async function loadStates() {
    try {
      const { data, error } = await getCloud().database.from(TABLE).select('*').order('id', { ascending: true }).limit(5000)
      if (error) throw new Error(error.message)
      statesOk = true
      return data || []
    } catch {
      statesOk = false
      return []
    }
  }

  async function load({ fresh = false } = {}) {
    refreshBtn.disabled = true
    try {
      if (fresh) window.dispatchEvent(new CustomEvent('satualur:data-changed'))
      const [flow, st] = await Promise.all([loadFlow(), loadStates()])
      if (signal?.aborted) return
      radar = buildRadar(flow, { now: new Date() })
      states = st
      all = radar.opportunities
      split()
      asOf.lastChild.textContent = t('radar.header.asOf', { date: fmtDate(radar.asOf), count: radar.counts.requests.toLocaleString(locale()) })
      drawSummary()
      drawTab(currentTab)
      syncCounts()
      if (fresh) live.textContent = t('radar.live.recalculated', { count: visible.length })
    } catch (err) {
      if (signal?.aborted) return
      summaryHost.classList.remove('is-loading')
      summaryHost.replaceChildren()
      for (const tab of TABS) tabPanels.get(tab.key).replaceChildren(C.errorState(t('radar.load.failed', { error: err.message })))
    } finally {
      refreshBtn.disabled = false
    }
  }

  function split() {
    const r = applyStates(all, states, new Date())
    visible = r.visible
    hidden = r.hidden
  }

  function syncCounts() {
    const week = thisWeek(visible)
    const set = (k, n) => { const c = tabCounts.get(k); c.hidden = !n; c.textContent = String(n) }
    set('radar', visible.length)
    set('week', week.length)
  }

  /* ------------------------------------------------------------ Summary */
  function drawSummary() {
    summaryHost.classList.remove('is-loading')
    const s = summarize(visible)
    const top = visible[0]
    summaryHost.replaceChildren(
      C.kpi({
        label: t('radar.kpi.value'), hero: true, iconName: 'wallet',
        value: rp(s.value), countTo: s.value, format: (n) => rp(n),
        sub: s.pipelineCount ? t('radar.kpi.valueSub', { count: s.pipelineCount }) : t('radar.kpi.valueNone'),
      }),
      C.kpi({ label: t('radar.kpi.count'), iconName: 'radar', value: String(s.count), countTo: s.count, sub: s.count ? typeBreakdown(s.byType) : t('radar.kpi.countNone') }),
      C.kpi({ label: t('radar.kpi.high'), iconName: 'flag', value: String(s.high), countTo: s.high, sub: t('radar.kpi.highSub', { min: RULES.highScore, top: top ? t('radar.kpi.topScore', { score: top.score }) : '' }) }),
      C.kpi({ label: t('radar.kpi.week'), iconName: 'bellRing', value: String(s.thisWeek), countTo: s.thisWeek, sub: s.thisWeek ? t('radar.kpi.weekSub') : t('radar.kpi.weekNone') }),
    )
  }
  const typeBreakdown = (byType) => OPP_TYPE_KEYS.filter((k) => byType[k]).slice(0, 3).map((k) => `${byType[k]} ${typeLabel(k, 'short').toLowerCase()}`).join(' · ')

  /* --------------------------------------------------------------- Tabs */
  function drawTab(key) {
    if (!radar) return
    const p = tabPanels.get(key)
    if (key === 'radar') p.replaceChildren(buildRadarTab())
    else if (key === 'week') p.replaceChildren(buildWeekTab())
    else if (key === 'ai') { if (!p.dataset.built) { p.replaceChildren(buildAiTab()); p.dataset.built = '1' } else p.firstChild?.refresh?.() }
    else if (key === 'predict') p.replaceChildren(buildPredictTab())
  }

  function emptyAccount() {
    return C.emptyState({
      kicker: t('radar.empty.kicker'),
      title: t('radar.empty.title'),
      body: t('radar.empty.body'),
      iconName: 'radar',
      action: C.button({ label: t('radar.empty.action'), icon: 'plus', variant: 'primary', size: 'sm', onClick: () => navigate('request') }),
    })
  }

  /* ============================================================= Radar */
  function buildRadarTab() {
    if (!radar.hasData) return emptyAccount()
    const wrap = el('div', { className: 'rd-radar' })

    // Filter chips (type) with counts
    const counts = summarize(showHidden ? hidden : visible).byType
    const chips = el('div', { className: 'rd-filter', role: 'radiogroup', 'aria-label': t('radar.filter.label') })
    const chipFor = (value, label, n, iconName) => {
      const on = filterType === value
      const b = el('button', { type: 'button', role: 'radio', className: 'rd-chip', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1', dataset: { value } },
        iconName ? icon(iconName, { size: 14 }) : null, el('span', {}, label), el('span', { className: 'rd-chip-count tnum' }, String(n)))
      b.addEventListener('click', () => { filterType = value; drawTab('radar'); tabPanels.get('radar').querySelector(`.rd-chip[data-value="${value}"]`)?.focus() })
      return b
    }
    const total = (showHidden ? hidden : visible).length
    chips.append(chipFor('all', t('radar.filter.all'), total))
    for (const k of OPP_TYPE_KEYS) if (counts[k]) chips.append(chipFor(k, typeLabel(k), counts[k], OPP_TYPES[k].icon))
    chips.addEventListener('keydown', (e) => {
      const btns = [...chips.querySelectorAll('.rd-chip')]
      const i = btns.indexOf(document.activeElement)
      if (i < 0) return
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
      if (!d) return
      e.preventDefault()
      btns[(i + d + btns.length) % btns.length].click()
    })

    const sortSel = C.select({ label: t('radar.sort.label'), name: 'rd-sort', options: sortOptions(), value: sort, attrs: { onChange: (e) => { sort = e.target.value; drawList() } } })
    sortSel.wrap.classList.add('rd-sort')
    const search = el('input', { type: 'search', className: 'input input-sm', placeholder: t('radar.search.placeholder'), 'aria-label': t('radar.search.label'), value: query })
    const searchBox = el('label', { className: 'search-box rd-search' }, icon('search', { size: 16 }), search)
    search.addEventListener('input', () => { query = search.value; drawList() })
    const hiddenBtn = C.button({
      label: showHidden ? t('radar.hidden.back') : t('radar.hidden.show', { count: hidden.length }),
      icon: showHidden ? 'arrowLeft' : 'eyeOff', variant: 'ghost', size: 'sm',
      onClick: () => { showHidden = !showHidden; filterType = 'all'; drawTab('radar') },
    })
    hiddenBtn.hidden = !showHidden && !hidden.length
    const tools = el('div', { className: 'rd-tools' }, searchBox, sortSel.wrap, hiddenBtn)

    const listHost = el('div', { className: 'rd-list-host' })
    const meta = el('p', { className: 'rd-meta', 'aria-live': 'polite' })
    wrap.append(...kids(
      showHidden ? el('div', { className: 'note note-info' }, icon('eyeOff'), el('div', { className: 'note-body' }, el('p', {}, t('radar.hidden.note')))) : null,
      !statesOk ? el('div', { className: 'note note-warn' }, icon('alert'), el('div', { className: 'note-body' }, el('p', {}, t('radar.states.unavailable')))) : null,
      chips, tools, meta, listHost,
    ))

    function filtered() {
      const q = query.trim().toLowerCase()
      let list = (showHidden ? hidden : visible).filter((o) => filterType === 'all' || o.type === filterType)
      if (q) list = list.filter((o) => [o.title, o.service, o.customer?.location].some((v) => String(v || '').toLowerCase().includes(q)))
      const by = {
        score: (a, b) => b.score - a.score || b.value - a.value,
        value: (a, b) => b.value - a.value || b.score - a.score,
        recent: (a, b) => String(b.anchor).localeCompare(String(a.anchor)) || b.score - a.score,
      }[sort]
      return list.slice().sort(by)
    }

    function drawList() {
      const list = filtered()
      const val = list.filter((o) => o.inPipeline).reduce((s, o) => s + o.value, 0)
      meta.textContent = list.length ? t('radar.list.meta', { count: list.length, value: val ? t('radar.list.estimate', { amount: rp(val) }) : '' }) : ''
      if (!list.length) {
        listHost.replaceChildren(showHidden
          ? C.emptyState({ kicker: t('radar.list.emptyKicker'), title: t('radar.list.hiddenEmpty'), iconName: 'eyeOff' })
          : query || filterType !== 'all'
            ? C.emptyState({ kicker: t('radar.list.notFoundKicker'), title: t('radar.list.notFoundTitle'), body: t('radar.list.notFoundBody'), iconName: 'search' })
            : C.emptyState({ kicker: t('radar.list.cleanKicker'), title: t('radar.list.cleanTitle'), body: t('radar.list.cleanBody'), iconName: 'checkCircle' }))
        return
      }
      const pageItems = rdPager.slice(list, { resetKey: [filterType, query.trim().toLowerCase(), sort, showHidden] })
      const grid = el('ul', { className: 'rd-grid', role: 'list' }, pageItems.map((o, i) => el('li', {}, card(o, i))))
      listHost.replaceChildren(grid, rdPager.root)
    }
    drawRadarList = drawList
    radarListHost = listHost
    drawList()
    return wrap
  }

  /* ---------------------------------------------------------------- Card */
  function typeTag(o) {
    const meta = OPP_TYPES[o.type]
    return el('span', { className: `rd-type rd-type-${o.type}` }, icon(meta.icon, { size: 13 }), typeLabel(o.type))
  }

  function scoreRing(score, { size = 52, label = true } = {}) {
    const r = 21
    const c = 2 * Math.PI * r
    const tier = score >= RULES.highScore ? 'high' : score >= RULES.midScore ? 'mid' : 'low'
    const tpl = document.createElement('template')
    tpl.innerHTML = `<svg viewBox="0 0 52 52" width="${size}" height="${size}" aria-hidden="true" focusable="false"><circle class="rd-ring-track" cx="26" cy="26" r="${r}"/><circle class="rd-ring-bar" cx="26" cy="26" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(2)}"/></svg>`
    return el('span', { className: `rd-ring is-${tier}`, role: label ? 'img' : null, 'aria-label': label ? t('radar.score.aria', { score }) : null, title: t('radar.score.title', { score }) },
      tpl.content.firstElementChild, el('span', { className: 'rd-ring-num tnum', 'aria-hidden': 'true' }, String(score)))
  }

  function evidenceChips(o) {
    const chips = o.type === 'season'
      ? (o.facts.uplift || []).map((u) => ({ icon: 'trendingUp', text: `${u.name} +${pct0(u.uplift)}`, title: t('radar.ev.season', { name: u.name, count: u.nIn, expected: Math.round(u.expected) }) }))
      : o.evidence.slice(0, 3).map((e) => ({ icon: 'clock', text: `${fmtDate(e.date)}${e.amount ? ` · ${C.rupiahCompact(e.amount)}` : ''}`, title: `${e.label}${e.amount ? ` ${rp(e.amount)}` : ''} — ${e.status}` }))
    if (o.type !== 'season' && o.evidence.length > 3) chips.push({ icon: 'layers', text: t('radar.ev.more', { count: o.evidence.length - 3 }) })
    return chips.length ? el('ul', { className: 'chips rd-ev', role: 'list', 'aria-label': t('radar.ev.label') }, chips.map((c) =>
      el('li', { className: 'chip', title: c.title || c.text }, icon(c.icon, { size: 13 }), el('span', { className: 'chip-text tnum' }, c.text)))) : null
  }

  function factorList(o, { compact = false } = {}) {
    return el('ul', { className: `rd-factors ${compact ? 'is-compact' : ''}`.trim(), role: 'list' }, o.factors.map((f) => {
      const off = f.value == null
      return el('li', { className: `rd-factor ${off ? 'is-off' : ''}`.trim() },
        el('div', { className: 'rd-factor-head' },
          el('span', { className: 'rd-factor-label' }, factorLabel(f), f.neutral ? el('span', { className: 'rd-factor-flag' }, t('radar.factors.neutral')) : null),
          el('span', { className: 'rd-factor-num tnum' }, off ? t('radar.factors.off') : t('radar.factors.calc', { value: Math.round(f.value * 100), weight: Math.round(f.share * 100), points: f.contribution.toFixed(1).replace('.', getLang() === 'en' ? '.' : ',') })),
        ),
        el('span', { className: 'rd-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${off ? 0 : Math.round(f.value * 100)}%` })),
        compact ? null : el('span', { className: 'rd-factor-detail' }, f.detail),
      )
    }))
  }

  function card(o, i) {
    const titleBtn = el('button', { type: 'button', className: 'rd-card-title-btn' }, o.title)
    titleBtn.addEventListener('click', () => openDrawer(o, titleBtn))
    const details = el('details', { className: 'rd-why' },
      el('summary', {}, icon('chevronRight', { size: 14 }), t('radar.card.factors')),
      factorList(o, { compact: true }))
    const state = o.state ? el('span', { className: 'rd-state' }, stateLabel(o.state)) : null
    const node = el('article', { className: 'rd-card', style: reducedMotion() ? null : `--i:${Math.min(i, 10)}` },
      el('div', { className: 'rd-card-top' },
        typeTag(o),
        C.tag(tierLabel(o.tier), o.tier.tone),
        state,
      ),
      el('div', { className: 'rd-card-main' },
        el('div', { className: 'rd-card-text' },
          el('h3', { className: 'rd-card-title' }, titleBtn),
          o.service && o.type !== 'season' ? el('p', { className: 'rd-card-sub' }, o.service, o.customer?.location ? el('span', { className: 'rd-dim' }, ` · ${shortPlace(o.customer.location)}`) : null) : null,
          el('p', { className: 'rd-card-why' }, o.why),
        ),
        scoreRing(o.score),
      ),
      o.value > 0 ? el('div', { className: 'rd-card-value' },
        el('span', { className: 'rd-value tnum' }, rp(o.value)),
        el('span', { className: 'rd-value-label' }, o.valueLabel),
      ) : el('p', { className: 'rd-fine' }, icon('info', { size: 14 }), o.valueBasis),
      evidenceChips(o),
      el('div', { className: 'rd-card-foot' },
        details,
        C.button({ label: t('radar.card.detail'), iconRight: 'arrowRight', size: 'sm', variant: 'soft', 'aria-label': t('radar.card.detailAria', { title: o.title }), onClick: (e) => openDrawer(o, e.currentTarget) }),
      ),
    )
    return node
  }

  const shortPlace = (loc) => {
    const parts = String(loc).split(',').map((s) => s.trim()).filter(Boolean)
    return parts.length > 1 ? parts.slice(-2).join(', ') : parts[0] || ''
  }
  function stateLabel(s) {
    if (s.status === 'done') return t('radar.state.done', { date: fmtDate(s.created_at) })
    if (s.status === 'snoozed') return t('radar.state.snoozed', { date: fmtDate(s.until) })
    return t('radar.state.dismissed')
  }

  /* ================================================================ Week */
  function buildWeekTab() {
    if (!radar.hasData) return emptyAccount()
    const list = thisWeek(visible)
    const today = new Date(); today.setHours(23, 59, 59, 999)
    const overdue = list.filter((o) => new Date(o.actBy) <= today)
    const soon = list.filter((o) => new Date(o.actBy) > today)
    const wrap = el('div', { className: 'rd-week' },
      el('p', { className: 'rd-lead' }, t('radar.week.lead')),
    )
    if (!list.length) {
      wrap.append(C.emptyState({ kicker: t('radar.week.emptyKicker'), title: t('radar.week.emptyTitle'), body: t('radar.week.emptyBody'), iconName: 'checkCircle' }))
      return wrap
    }
    const group = (title, items, tone) => items.length ? C.panel({ title, meta: t('radar.week.groupMeta', { count: items.length, amount: rp(items.filter((o) => o.inPipeline).reduce((s, o) => s + o.value, 0)) }), className: `rd-week-panel is-${tone}` },
      el('ul', { className: 'rd-todo', role: 'list' }, items.map((o) => weekRow(o)))) : null
    wrap.append(...kids(group(t('radar.week.overdue'), overdue, 'now'), group(t('radar.week.soon'), soon, 'soon')))
    return wrap
  }

  function weekRow(o) {
    const d = new Date(o.actBy)
    const doneBtn = C.button({ label: t('radar.week.done'), icon: 'check', size: 'sm', variant: 'ghost', 'aria-label': t('radar.week.doneAria', { title: o.title }), onClick: (e) => setState(o, 'done', e.currentTarget) })
    if (!statesOk) doneBtn.disabled = true
    const open = C.button({ label: t('radar.card.detail'), iconRight: 'arrowRight', size: 'sm', variant: 'soft', 'aria-label': t('radar.card.detailAria', { title: o.title }), onClick: (e) => openDrawer(o, e.currentTarget) })
    return el('li', { className: 'rd-todo-item' },
      el('span', { className: 'rd-todo-date tnum' },
        el('b', {}, d.toLocaleDateString(locale(), { day: 'numeric' })),
        el('span', {}, d.toLocaleDateString(locale(), { month: 'short' }))),
      el('div', { className: 'rd-todo-text' },
        el('div', { className: 'rd-todo-head' }, typeTag(o), el('span', { className: 'rd-todo-score tnum', title: t('radar.score.title', { score: o.score }) }, t('radar.score.short', { score: o.score }))),
        el('p', { className: 'rd-todo-title' }, o.title),
        el('p', { className: 'rd-todo-why' }, o.why),
      ),
      el('div', { className: 'rd-todo-actions' }, el('span', { className: 'rd-todo-value tnum' }, o.value > 0 ? rp(o.value) : ''), open, doneBtn),
    )
  }

  /* ================================================================== AI */
  function buildAiTab() {
    const out = el('div', { className: 'rd-ai-out' })
    const msg = C.message()
    const btn = C.button({ label: t('radar.ai.build'), icon: 'sparkles', variant: 'primary' })
    const scopeNote = el('p', { className: 'rd-fine' })
    const topList = el('ol', { className: 'rd-ai-top' })
    const intro = C.panel({ title: t('radar.ai.title'), meta: t('radar.ai.meta'), className: 'rd-ai-panel', actions: btn },
      el('p', { className: 'panel-lead' }, t('radar.ai.lead')),
      topList, scopeNote, msg, out)
    const root = el('div', { className: 'rd-ai' }, intro)
    const top = () => visible.slice(0, 5)
    root.refresh = () => {
      const tops = top()
      topList.replaceChildren(...tops.map((o) => el('li', {}, typeTag(o), el('span', { className: 'rd-ai-top-name' }, o.title), el('span', { className: 'rd-dim tnum' }, t('radar.ai.topMeta', { score: o.score, value: o.value > 0 ? ` · ${rp(o.value)}` : '' })))))
      btn.disabled = !tops.length
      scopeNote.textContent = tops.length ? '' : t('radar.ai.nothing')
    }
    root.refresh()
    btn.addEventListener('click', async () => {
      const tops = top()
      if (!tops.length) return
      const ctxText = tops.map((o, i) => `## Peluang ${i + 1}\n${opportunityContext(o, { maxEvidence: 4 })}`).join('\n\n')
      await runAI({
        out, msg, btn, busyLabel: t('radar.ai.busy'),
        messages: [
          { role: 'system', content: `${SUMMARY_SYSTEM}\n\n[DATA PELUANG — dari radar, ${fmtDate(radar.asOf)}]\n${ctxText}` },
          { role: 'user', content: 'Susun rekomendasi untuk lima peluang ini.' },
        ],
        maxTokens: 1400,
        onText: (text, con) => { con.body.classList.remove('is-code'); con.body.classList.add('is-prose', 'md'); con.body.replaceChildren(renderMarkdown(text)) },
      })
    })
    return root
  }

  /**
   * Streams one completion into an aiConsole inside `out`.
   * onText(text, console) paints partial text; onDone(text) gets the final text.
   */
  async function runAI({ out, msg, btn, busyLabel, messages, maxTokens = 600, temperature = 0.5, onText, onDone }) {
    msg.hide()
    aiCtl?.abort()
    const ac = new AbortController()
    aiCtl = ac
    const m = await modelReady
    if (!m) { msg.show('danger', t('radar.ai.noModel')); return null }
    const con = C.aiConsole({ model: t('radar.ai.console') })
    out.replaceChildren(con.root)
    con.setStatus(t('radar.ai.busy'), true)
    con.onStop(() => ac.abort())
    const restore = btn ? C.setBusy(btn, busyLabel) : () => {}
    let full = ''
    let frame = 0
    const paint = () => { frame = 0; const text = full.replace(EMOJI_RE, ''); if (onText) onText(text, con); else con.write(text) }
    try {
      const params = getAgentParams()
      const gen = streamAnswer({ messages, model: m.id, feature: 'radar', temperature, maxTokens: Math.min(params.maxTokens || maxTokens, maxTokens), signal: ac.signal })
      for (;;) {
        const step = await gen.next()
        if (step.done) { full = step.value?.full || full; break }
        if (step.value.type === 'delta') { full = step.value.full; if (!frame) frame = requestAnimationFrame(paint) }
        else if (step.value.type === 'retry') con.setStatus(t('radar.ai.retry'), true)
      }
      if (frame) cancelAnimationFrame(frame)
      paint()
      con.done()
      full = full.replace(EMOJI_RE, '').trim()
      if (!full) throw new Error(t('radar.ai.empty'))
      con.setStatus(t('radar.ai.done'), false)
      onDone?.(full, con)
      return full
    } catch (err) {
      if (frame) cancelAnimationFrame(frame)
      con.done()
      if (err?.name === 'AbortError' || ac.signal.aborted) {
        con.setStatus(t('radar.ai.stopped'), false)
        if (full.trim()) { onDone?.(full.replace(EMOJI_RE, '').trim(), con); return full }
        return null
      }
      con.setStatus(t('radar.ai.failed'), false)
      msg.show('danger', t('radar.ai.error', { error: err.message }))
      return null
    } finally {
      restore()
      if (aiCtl === ac) aiCtl = null
    }
  }

  /* ============================================================= Predict */
  function buildPredictTab() {
    if (!radar.hasData) return emptyAccount()
    const S = radar.stats
    const rateCell = (r) => (r.enough ? el('b', { className: 'tnum' }, pct0(r.rate)) : el('span', { className: 'rd-dim' }, r.n ? t('radar.predict.notEnough') : '—'))
    const rangeCell = (r) => (r.enough ? el('span', { className: 'tnum rd-dim' }, `${pct0(r.lo)}–${pct0(r.hi)}`) : el('span', { className: 'muted nil' }, '—'))
    const bar = (r) => el('span', { className: 'rd-bar is-inline', 'aria-hidden': 'true' }, el('i', { style: `width:${r.enough ? Math.round(r.rate * 100) : 0}%` }))
    const rateColumns = (first) => [
      { label: first, render: (r) => C.cellStack(r.label, r.basis) },
      { label: t('radar.predict.sample'), align: 'right', render: (r) => el('span', { className: 'tnum' }, r.n.toLocaleString(locale())) },
      { label: t('radar.predict.success'), align: 'right', render: (r) => el('span', { className: 'tnum' }, r.k.toLocaleString(locale())) },
      { label: t('radar.predict.rate'), align: 'right', render: (r) => el('span', { className: 'rd-rate' }, bar(r), rateCell(r)) },
      { label: t('radar.predict.range'), align: 'right', render: rangeCell },
    ]

    const segments = [
      { label: t('radar.predict.seg.all'), ...S.overall },
      { label: t('radar.predict.seg.new'), ...S.newCustomer },
      { label: t('radar.predict.seg.returning'), ...S.returning },
      { label: t('radar.predict.seg.same'), ...S.returningSameService },
      { label: t('radar.predict.seg.newService'), ...S.returningNewService },
    ]
    const offerPanel = C.panel({ title: t('radar.predict.offerTitle'), meta: t('radar.predict.offerMeta') },
      C.dataTable({ caption: t('radar.predict.offerCaption'), rows: segments, columns: rateColumns(t('radar.predict.segment')) }))

    const svcRows = [...S.byService.values()].filter((r) => r.n > 0).sort((a, b) => b.n - a.n).map((r) => ({ ...r, label: r.name }))
    const svcPanel = C.panel({ title: t('radar.predict.svcTitle'), meta: t('radar.predict.svcMeta', { count: svcRows.length }) },
      svcRows.length ? C.dataTable({ caption: t('radar.predict.svcCaption'), rows: svcRows, columns: rateColumns(t('radar.predict.service')) }) : C.emptyState({ kicker: t('radar.list.emptyKicker'), title: t('radar.predict.svcEmpty') }))

    const repRows = [...S.repurchase.values()].map((r) => ({ ...r, label: r.name }))
    const repPanel = C.panel({ title: t('radar.predict.repTitle'), meta: t('radar.predict.repMeta') },
      el('p', { className: 'panel-lead' }, t('radar.predict.repLead')),
      repRows.length ? C.dataTable({ caption: t('radar.predict.repCaption'), rows: repRows, columns: rateColumns(t('radar.predict.service')) })
        : C.emptyState({ kicker: t('radar.predict.notDetected'), title: t('radar.predict.repEmpty'), body: t('radar.predict.repEmptyBody', { min: RULES.minSample, pct: Math.round(RULES.minRepurchase * 100) }), iconName: 'refresh' }))

    const single = [
      { label: t('radar.predict.winback'), ...S.winback, hint: t('radar.predict.winbackHint') },
      S.contract ? { label: t('radar.predict.contract'), ...S.contract, hint: t('radar.predict.contractHint') } : null,
      { label: t('radar.predict.rejection'), ...S.rejectionReturn, hint: t('radar.predict.rejectionHint') },
    ].filter(Boolean)
    const otherPanel = C.panel({ title: t('radar.predict.patterns'), meta: t('radar.predict.patternsMeta') },
      C.dataTable({ caption: t('radar.predict.patterns'), rows: single.map((r) => ({ ...r, basis: `${r.hint}: ${r.basis}` })), columns: rateColumns(t('radar.predict.pattern')) }),
      S.contract ? null : el('p', { className: 'rd-fine' }, icon('info', { size: 14 }), t('radar.predict.noContract')))

    const pairs = radar.pairs.slice(0, 8)
    const pairPanel = C.panel({ title: t('radar.predict.pairsTitle'), meta: pairs.length ? t('radar.predict.pairsMeta', { count: pairs.length }) : t('radar.predict.pairsBasis') },
      pairs.length ? C.dataTable({
        caption: t('radar.predict.pairsCaption'), rows: pairs, columns: [
          { label: t('radar.predict.ifBuys'), render: (p) => p.aName },
          { label: t('radar.predict.alsoBuys'), render: (p) => p.bName },
          { label: t('radar.predict.customers'), align: 'right', render: (p) => el('span', { className: 'tnum' }, t('radar.predict.pairCount', { both: p.both, total: p.aCount })) },
          { label: t('radar.predict.confidence'), align: 'right', render: (p) => el('b', { className: 'tnum' }, pct0(p.conf)) },
          { label: t('radar.predict.lift'), align: 'right', render: (p) => el('span', { className: 'tnum' }, `${p.lift.toFixed(2).replace('.', ',')}×`) },
        ],
      }) : C.emptyState({ kicker: t('radar.predict.notDetected'), title: t('radar.predict.pairsEmpty'), body: t('radar.predict.pairsEmptyBody', { min: RULES.crossMinSupport, pct: Math.round(RULES.crossMinConf * 100) }), iconName: 'layers' }))

    return el('div', { className: 'rd-predict' },
      el('div', { className: 'note note-info' }, icon('info'), el('div', { className: 'note-body' },
        el('p', {}, t('radar.predict.note', { min: RULES.minSample })))),
      offerPanel, otherPanel,
      el('div', { className: 'rd-predict-grid' }, repPanel, pairPanel),
      svcPanel,
    )
  }

  /* ============================================================== Drawer */
  const drawerTitle = el('h2', { className: 'drawer-title display rd-drawer-title', id: 'rd-drawer-title' })
  const drawerPre = el('div', { className: 'rd-drawer-pre' })
  const drawerBody = el('div', { className: 'drawer-body rd-drawer-body' })
  const drawerFoot = el('div', { className: 'drawer-foot rd-drawer-foot' })
  const drawerClose = C.iconButton({ iconName: 'x', label: t('radar.drawer.close') })
  const drawer = el('div', { className: 'drawer rd-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rd-drawer-title', hidden: true },
    el('div', { className: 'drawer-head' }, el('div', { className: 'rd-drawer-headtext' }, drawerPre, drawerTitle), drawerClose),
    drawerBody, drawerFoot)
  const scrim = el('div', { className: 'scrim scrim-drawer', hidden: true })
  // Inside .app-shell so form and table styles (scoped there) apply.
  ;(container.closest('.app-shell') || document.body).append(scrim, drawer)
  let returnFocus = null
  let current = null
  drawerClose.addEventListener('click', () => closeDrawer())
  scrim.addEventListener('click', () => closeDrawer())
  const onKey = (e) => {
    if (drawer.hidden) return
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer() }
    else if (e.key === 'Tab') {
      const items = [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }
  document.addEventListener('keydown', onKey)
  signal?.addEventListener('abort', () => { document.removeEventListener('keydown', onKey); drawer.remove(); scrim.remove(); document.body.classList.remove('scroll-lock') })

  function openDrawer(o, from) {
    returnFocus = from || document.activeElement
    current = o
    fillDrawer(o)
    drawer.hidden = false
    scrim.hidden = false
    document.body.classList.add('scroll-lock')
    drawerBody.scrollTop = 0
    requestAnimationFrame(() => {
      drawer.classList.add('is-open')
      scrim.classList.add('is-open')
      drawerClose.focus()
    })
  }
  function closeDrawer({ restore = true } = {}) {
    if (drawer.hidden) return
    aiCtl?.abort()
    drawer.classList.remove('is-open')
    scrim.classList.remove('is-open')
    document.body.classList.remove('scroll-lock')
    const finish = () => { drawer.hidden = true; scrim.hidden = true }
    if (reducedMotion()) finish()
    else setTimeout(finish, 280)
    current = null
    if (restore && returnFocus?.isConnected) returnFocus.focus()
  }

  function fillDrawer(o) {
    drawerPre.replaceChildren(typeTag(o), C.tag(tierLabel(o.tier), o.tier.tone))
    drawerTitle.textContent = o.title

    const contact = o.customer ? el('ul', { className: 'chips' }, [
      o.service ? { icon: 'layers', text: o.service } : null,
      o.customer.location ? { icon: 'mapPin', text: o.customer.location } : null,
      o.customer.phone ? { icon: 'phone', text: o.customer.phone } : null,
    ].filter(Boolean).map((c) => el('li', { className: 'chip', title: c.text }, icon(c.icon, { size: 13 }), el('span', { className: 'chip-text' }, c.text)))) : null

    const pred = o.prediction
    const predBox = el('div', { className: 'rd-stat' },
      el('span', { className: 'rd-stat-label' }, t('radar.drawer.prediction')),
      o.type === 'season'
        ? el('span', { className: 'rd-stat-value is-muted' }, t('radar.drawer.na'))
        : pred && pred.enough
          ? el('span', { className: 'rd-stat-value tnum' }, pct0(pred.rate))
          : el('span', { className: 'rd-stat-value is-muted' }, pred ? t('radar.drawer.notEnough') : t('radar.drawer.unavailable')),
      el('span', { className: 'rd-stat-sub' }, o.type === 'season'
        ? t('radar.drawer.seasonNote')
        : pred ? (pred.enough ? t('radar.drawer.predEnough', { k: pred.k, n: pred.n, basis: pred.basis, lo: pct0(pred.lo), hi: pct0(pred.hi) }) : t('radar.drawer.predFew', { n: pred.n, basis: pred.basis, min: RULES.minSample })) : t('radar.drawer.noHistory')),
    )
    const valueBox = el('div', { className: 'rd-stat is-accent' },
      el('span', { className: 'rd-stat-label' }, o.valueLabel),
      el('span', { className: 'rd-stat-value tnum' }, o.value > 0 ? rp(o.value) : '—'),
      el('span', { className: 'rd-stat-sub' }, o.valueBasis),
    )
    const scoreBox = el('div', { className: 'rd-stat rd-stat-score' },
      el('span', { className: 'rd-stat-label' }, t('radar.drawer.score')),
      el('div', { className: 'rd-stat-ring' }, scoreRing(o.score, { size: 56 }), el('span', { className: 'rd-stat-sub' }, tierLabel(o.tier))))

    const evRows = o.evidence.map((e) => ({ ...e }))
    const evidence = evRows.length
      ? C.dataTable({
        caption: t('radar.drawer.evCaption'), rows: evRows, columns: [
          { label: t('radar.drawer.date'), className: 'col-date', render: (e) => el('time', { className: 'tnum', datetime: e.date }, fmtDate(e.date)) },
          { label: t('radar.drawer.service'), render: (e) => C.cellStack(e.label, e.requestId != null ? t('radar.drawer.requestRef', { id: e.requestId, offer: e.offerId != null ? t('radar.drawer.offerRef', { id: e.offerId }) : '' }) : null) },
          { label: t('radar.drawer.value'), align: 'right', render: (e) => (e.amount ? el('span', { className: 'tnum' }, rp(e.amount)) : null) },
          { label: t('radar.drawer.status'), render: (e) => el('span', { className: 'rd-dim' }, e.status) },
        ],
      })
      : el('p', { className: 'rd-fine' }, icon('info', { size: 14 }), t('radar.drawer.calendarOnly'))

    /* Follow-up composer */
    const fuOut = el('div', { className: 'rd-fu-out' })
    const fuMsg = C.message()
    const fuText = C.textarea({ label: t('radar.fu.title'), name: 'rd-followup', rows: 6, hint: t('radar.fu.hint'), attrs: { maxlength: '1200' } })
    fuText.wrap.hidden = true
    const copyBtn = C.button({ label: t('radar.fu.copy'), icon: 'copy', size: 'sm', variant: 'soft' })
    const waLink = el('a', { className: 'btn btn-sm btn-soft', target: '_blank', rel: 'noopener noreferrer', hidden: true }, icon('message'), el('span', { className: 'btn-label' }, t('radar.fu.openWa')))
    const fuActions = el('div', { className: 'rd-fu-actions', hidden: true }, copyBtn, waLink)
    const wa = waNumber(o.customer?.phone)
    const syncWa = () => {
      if (!wa) return
      waLink.hidden = false
      waLink.href = `https://wa.me/${wa}?text=${encodeURIComponent(fuText.input.value)}`
    }
    fuText.input.addEventListener('input', syncWa)
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(fuText.input.value); showToast(t('radar.fu.copied'), 'success') } catch { fuText.input.select(); showToast(t('radar.fu.copyManual'), 'info') }
    })
    const fuBtn = C.button({ label: t('radar.fu.build'), icon: 'sparkles', variant: 'primary', size: 'sm' })
    if (!o.customer) fuBtn.hidden = true
    fuBtn.addEventListener('click', async () => {
      fuText.wrap.hidden = true
      fuActions.hidden = true
      const text = await runAI({
        out: fuOut, msg: fuMsg, btn: fuBtn, busyLabel: t('radar.ai.busy'),
        messages: [
          { role: 'system', content: `${FOLLOWUP_SYSTEM}\n\n[DATA PELUANG — dihitung dari riwayat transaksi, ${fmtDate(radar.asOf)}]\n${opportunityContext(o)}` },
          { role: 'user', content: `Tulis satu pesan follow-up untuk ${o.customer?.name || 'pelanggan ini'}.` },
        ],
        maxTokens: 500, temperature: 0.6,
      })
      if (text && current === o) {
        fuText.input.value = text.replace(/^#+\s.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
        fuText.wrap.hidden = false
        fuActions.hidden = false
        syncWa()
        fuOut.querySelector('.console')?.classList.add('is-folded')
      }
    })
    const composer = o.customer ? el('section', { className: 'rd-section', 'aria-labelledby': 'rd-fu-h' },
      el('div', { className: 'rd-section-head' }, el('h3', { className: 'rd-h', id: 'rd-fu-h' }, t('radar.fu.title')), fuBtn),
      fuMsg, fuOut, fuText.wrap, fuActions) : null

    drawerBody.replaceChildren(...kids(
      el('section', { className: 'rd-section' },
        el('p', { className: 'rd-drawer-why' }, o.why),
        el('p', { className: 'rd-drawer-action' }, icon('lightbulb', { size: 16 }), el('span', {}, o.action)),
        contact,
        o.season ? el('p', { className: 'rd-fine' }, icon('calendar', { size: 14 }), t('radar.drawer.season', { label: o.season.label, start: fmtDate(o.season.start), end: fmtDate(o.season.end), note: o.season.note, prev: o.season.prevStart ? t('radar.drawer.seasonPrev', { start: fmtDate(o.season.prevStart), end: fmtDate(o.season.prevEnd) }) : '' })) : null,
      ),
      el('div', { className: 'rd-stats' }, scoreBox, valueBox, predBox),
      el('section', { className: 'rd-section', 'aria-labelledby': 'rd-f-h' }, el('h3', { className: 'rd-h', id: 'rd-f-h' }, t('radar.drawer.breakdown')), factorList(o)),
      el('section', { className: 'rd-section', 'aria-labelledby': 'rd-e-h' }, el('h3', { className: 'rd-h', id: 'rd-e-h' }, t('radar.drawer.evidence')), evidence),
      composer,
    ))

    /* Footer actions */
    const primary = navButton(o)
    const doneBtn = C.button({ label: t('radar.drawer.markDone'), icon: 'check', size: 'sm', variant: 'soft', onClick: (e) => setState(o, 'done', e.currentTarget) })
    const snoozeBtn = C.button({ label: t('radar.drawer.snooze', { days: SNOOZE_DAYS }), icon: 'clock', size: 'sm', variant: 'ghost', onClick: (e) => setState(o, 'snoozed', e.currentTarget) })
    const restoreBtn = o.state ? C.button({ label: t('radar.drawer.restore'), icon: 'undo', size: 'sm', variant: 'soft', onClick: (e) => clearState(o, e.currentTarget) }) : null
    for (const b of [doneBtn, snoozeBtn, restoreBtn]) if (b && !statesOk) { b.disabled = true; b.title = t('radar.drawer.noTable') }
    drawerFoot.replaceChildren(
      el('div', { className: 'rd-foot-left' }, ...kids(o.state ? [el('span', { className: 'rd-state' }, stateLabel(o.state)), restoreBtn] : [snoozeBtn, doneBtn])),
      primary,
    )
  }

  function navButton(o) {
    const nav = o.nav || {}
    if (nav.stage === 'social') {
      return C.button({ label: t('radar.nav.social'), iconRight: 'arrowRight', size: 'sm', variant: 'primary', onClick: () => { closeDrawer({ restore: false }); navigate('social') } })
    }
    const label = nav.stage === 'offer' && nav.params?.offerId != null ? t('radar.nav.review') : t('radar.nav.create')
    return C.button({
      label, iconRight: 'arrowRight', size: 'sm', variant: 'primary',
      title: nav.stage === 'request' ? t('radar.nav.requestTitle') : undefined,
      onClick: () => { closeDrawer({ restore: false }); navigate(nav.stage || 'offer', nav.params || {}) },
    })
  }

  /* -------------------------------------------------------------- States */
  async function setState(o, status, btn) {
    const restore = btn ? C.setBusy(btn) : () => {}
    const until = status === 'snoozed' ? new Date(Date.now() + SNOOZE_DAYS * DAY).toISOString() : null
    try {
      const { data, error } = await getCloud().database.from(TABLE).insert({ opp_key: o.key, status, until, note: `${o.type}: ${o.title}`.slice(0, 200) })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      states.push(row || { opp_key: o.key, status, until, created_at: new Date().toISOString() })
      afterStateChange(status === 'done' ? t('radar.toast.done', { title: o.title }) : t('radar.toast.snoozed', { title: o.title, date: fmtDate(until) }))
    } catch (err) {
      restore()
      showToast(t('radar.toast.saveFailed', { error: err.message }), 'error')
    }
  }
  async function clearState(o, btn) {
    const restore = btn ? C.setBusy(btn) : () => {}
    try {
      const rows = states.filter((s) => s.opp_key === o.key && s.id != null)
      for (const s of rows) {
        const { error } = await getCloud().database.from(TABLE).delete().eq('id', s.id)
        if (error) throw new Error(error.message)
      }
      states = states.filter((s) => s.opp_key !== o.key)
      afterStateChange(t('radar.toast.restored', { title: o.title }))
    } catch (err) {
      restore()
      showToast(t('radar.toast.restoreFailed', { error: err.message }), 'error')
    }
  }
  function afterStateChange(text) {
    split()
    if (showHidden && !hidden.length) { showHidden = false; filterType = 'all' }
    closeDrawer({ restore: false })
    drawSummary()
    syncCounts()
    drawTab(currentTab)
    showToast(text, 'success')
    live.textContent = text
    tabBtns.get(currentTab)?.focus()
  }

  await load()
}

/** Indonesian phone → wa.me number (62…), or null. */
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length < 8) return null
  if (d.startsWith('62')) return d
  if (d.startsWith('0')) return `62${d.slice(1)}`
  if (d.startsWith('8')) return `62${d}`
  return d
}

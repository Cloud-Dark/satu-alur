/**
 * Pertumbuhan — Pencari prospek (B2B lead finder).
 *
 * The user picks a point (map click, address search or geolocation), a radius
 * and criteria. The Worker finds businesses in OpenStreetMap (or Google Places
 * when configured), the AI keeps/dedupes and rates them against the user's own
 * services, and every lead gets a transparent score and value estimate based
 * on the user's real job history. A lead can be saved, and an AI offer draft
 * can be turned into a request + draft offer in the normal flow.
 *
 * MVP: nothing is ever sent to a lead (no email, no WhatsApp).
 */
import { loadLeaflet } from '../leads/leaflet.js'
import '../styles/leads.css'
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast, reducedMotion } from '../ui/animations.js'
import { resolveModel, abortable } from './offer.js'
import { loadFlow, notifyDataChanged } from './data.js'
import { validateOffer } from '../domain/rules.js'
import { PRESET_CHIPS, MAX_KEYWORDS, DEFAULT_RADIUS_KM, MAX_RADIUS_KM, normalizeKeyword, inIndonesia } from '../leads/osm.js'
import {
  serviceStats, serviceNames, scoreLead, estimateValue, sortLeads, SORTS, serviceKey,
  DEFAULT_CONVERSION, MIN_CONVERSION, MAX_CONVERSION,
} from '../leads/scoring.js'
import { getSources, geocode } from '../leads/api.js'
import { draftLeadOffer, AI_RANK_LIMIT } from '../ai/leads-agent.js'
import {
  JOB_EVENT, startLeadJob, cancelLeadJob, getLeadJob, isJobRunning, setLeadsPageMounted,
  loadLeadsStore, saveLeadsStore, removeHistory, lastEntry,
} from '../leads/job.js'
import { t, locale } from '../i18n/index.js'

const { el, icon } = C

const QUERY_STORE = 'satualur_leads_query'
const TAB_STORE = 'satualur_leads_tab'
const DEFAULT_VIEW = { lat: -6.2, lon: 106.85, zoom: 10 } // Jabodetabek
const GEOCODE_DEBOUNCE_MS = 1000 // Nominatim policy: max 1 request/second
const PAGE_SIZE = 12

export const LEAD_STATUSES = [
  { value: 'baru', label: 'Baru', tone: 'brand' },
  { value: 'dihubungi', label: 'Dihubungi', tone: 'warn' },
  { value: 'penawaran', label: 'Penawaran', tone: 'ok' },
  { value: 'ditolak', label: 'Ditolak', tone: 'neutral' },
]
const statusOf = (v) => LEAD_STATUSES.find((s) => s.value === v) || LEAD_STATUSES[0]
const statusText = (s) => t(`leads.status.${s.value}`)
// Written into the request description, so it stays in the account's working language (Indonesian).
const SOURCE_LABEL = { osm: 'peta', google: 'Google', demo: 'data contoh' }
const presetLabel = (c) => t(`leads.preset.${c.value.replace(/\s+/g, '_')}`)
const sortOptions = () => SORTS.map((s) => ({ value: s.value, label: t(`leads.sort.${s.value}`) }))

const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback } catch { return fallback } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } },
}

const km = (n) => `${Number(n).toLocaleString(locale(), { maximumFractionDigits: n < 10 ? 1 : 0 })} km`
// The same km text, fixed to Indonesian, for data saved into the request.
const kmId = (n) => `${Number(n).toLocaleString('id-ID', { maximumFractionDigits: n < 10 ? 1 : 0 })} km`
const pct = (n) => `${Math.round(n * 100)}%`
const fmtFactor = (n) => Number(n).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function parseMeta(v) {
  if (v && typeof v === 'object') return v
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {} } catch { return {} }
}

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''))
    showToast(t('leads.copy.done'), 'success')
  } catch {
    showToast(t('leads.copy.failed'), 'error')
  }
}

/* ======================================================================= */

export async function render(container, ctx = {}) {
  const signal = ctx.signal
  const navigate = ctx.navigate || (() => {})
  const disposers = []
  const onAbort = (fn) => disposers.push(fn)
  signal?.addEventListener('abort', () => disposers.splice(0).forEach((d) => { try { d() } catch { /* ignore */ } }))

  const saved0 = store.get(QUERY_STORE, {})
  const state = {
    point: saved0.point && inIndonesia(saved0.point.lat, saved0.point.lon) ? saved0.point : null,
    pointLabel: saved0.pointLabel || '',
    radiusKm: Math.min(MAX_RADIUS_KM, Math.max(1, Number(saved0.radiusKm) || DEFAULT_RADIUS_KM)),
    keywords: Array.isArray(saved0.keywords) && saved0.keywords.length ? saved0.keywords.slice(0, MAX_KEYWORDS) : ['hotel', 'restoran'],
    conversion: Number(saved0.conversion) > 0 ? Number(saved0.conversion) : DEFAULT_CONVERSION,
    fallbackAvg: Number(saved0.fallbackAvg) > 0 ? Number(saved0.fallbackAvg) : 0,
    source: 'osm',
    sort: 'score',
    showHidden: false,
    search: null, // last response meta
    leads: [], // scored leads
    rankBasis: null, // 'ai' | 'heuristik' | 'mixed'
    focusId: null,
  }
  const persist = () => store.set(QUERY_STORE, {
    point: state.point, pointLabel: state.pointLabel, radiusKm: state.radiusKm, keywords: state.keywords,
    conversion: state.conversion, fallbackAvg: state.fallbackAvg,
  })

  /* --------------------------------------------------- Business context */
  let stats = []
  let names = []
  const businessReady = loadFlow().then((m) => {
    stats = serviceStats(m)
    names = serviceNames(m)
    for (const s of stats) if (!names.some((n) => n.toLowerCase() === s.name.toLowerCase())) names.push(s.name)
  }).catch(() => { /* estimates fall back to the user's own number */ })
  /** The estimate's explanation, worded from its basis (the scoring module writes Indonesian). */
  const estNote = (est, service) => {
    if (est.basis === 'layanan') {
      const hit = stats.find((s) => s.key === serviceKey(service))
      return hit ? t('leads.estimate.service', { count: hit.count, name: hit.name }) : est.note
    }
    if (est.basis === 'umum') return t('leads.estimate.overall', { count: stats.reduce((s, x) => s + x.count, 0) })
    if (est.basis === 'perkiraan') return t('leads.estimate.manual')
    return t('leads.estimate.none')
  }
  const servicesForAI = () => {
    const byName = new Map(stats.map((s) => [s.key, s]))
    return names.map((n) => byName.get(n.trim().toLowerCase().replace(/\s+/g, ' ')) || { name: n, count: 0, avg: 0 })
  }

  let model = null
  const modelReady = resolveModel().then((m) => { model = m }).catch(() => { model = null })

  let sources = { osm: true, google: false }
  const sourcesReady = getSources({ signal }).then((s) => { sources = s || sources }).catch(() => {})

  /* ------------------------------------------------------------- Header */
  const header = C.pageHeader({ title: t('leads.page.title') })

  /* --------------------------------------------------------------- Tabs */
  const TABS = [
    { key: 'search', label: t('leads.tabs.search'), icon: 'search' },
    { key: 'saved', label: t('leads.tabs.saved'), icon: 'bookmark' },
  ]
  const tablist = el('div', { className: 'ld-tabs', role: 'tablist', 'aria-label': t('leads.page.title') })
  const tabBtns = new Map()
  const tabPanels = new Map()
  const savedCount = el('span', { className: 'ld-tab-count tnum', hidden: true })
  for (const tab of TABS) {
    const b = el('button', {
      type: 'button', role: 'tab', className: 'ld-tab', id: `ld-tab-${tab.key}`, dataset: { tab: tab.key },
      'aria-controls': `ld-panel-${tab.key}`, 'aria-selected': 'false', tabindex: '-1',
    }, icon(tab.icon, { size: 16 }), el('span', {}, tab.label), tab.key === 'saved' ? savedCount : null)
    b.addEventListener('click', () => activate(tab.key))
    tabBtns.set(tab.key, b)
    tablist.appendChild(b)
    tabPanels.set(tab.key, el('div', { className: 'ld-panel', role: 'tabpanel', id: `ld-panel-${tab.key}`, 'aria-labelledby': `ld-tab-${tab.key}`, hidden: true }))
  }
  tablist.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const keys = TABS.map((tab) => tab.key)
    const i = keys.indexOf(document.activeElement?.dataset?.tab)
    if (i < 0) return
    e.preventDefault()
    const next = e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]
    activate(next)
    tabBtns.get(next).focus()
  })
  function activate(key) {
    for (const [k, b] of tabBtns) {
      const on = k === key
      b.setAttribute('aria-selected', on ? 'true' : 'false')
      b.tabIndex = on ? 0 : -1
      tabPanels.get(k).hidden = !on
    }
    try { sessionStorage.setItem(TAB_STORE, key) } catch { /* ignore */ }
    if (key === 'search') requestAnimationFrame(() => map?.invalidateSize())
    if (key === 'saved') drawSaved()
  }

  /* ============================================================ Controls */

  // --- Location: address search (combobox) ---
  const addrInput = el('input', {
    id: 'ld-addr', className: 'input', type: 'search', autocomplete: 'off', placeholder: t('leads.loc.placeholder'),
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'ld-addr-list', 'aria-describedby': 'ld-addr-hint',
  })
  const addrList = el('ul', { id: 'ld-addr-list', className: 'ld-suggest', role: 'listbox', 'aria-label': t('leads.loc.suggestLabel'), hidden: true })
  const addrStatus = el('span', { className: 'ld-suggest-status', role: 'status', 'aria-live': 'polite' })
  const geoBtn = C.button({ label: t('leads.loc.useMine'), icon: 'target', variant: 'soft', size: 'sm' })
  const pointLine = el('p', { className: 'ld-point', 'aria-live': 'polite' })
  const locField = el('div', { className: 'field ld-loc' },
    el('label', { className: 'field-label', htmlFor: 'ld-addr' }, el('span', {}, t('leads.loc.label'))),
    el('div', { className: 'ld-combo' }, icon('search', { size: 16 }), addrInput, addrList),
    el('span', { className: 'field-hint', id: 'ld-addr-hint' }, t('leads.loc.hint')),
    addrStatus,
    el('div', { className: 'ld-loc-row' }, geoBtn),
    pointLine,
  )

  let addrTimer = null
  let addrCtl = null
  let addrItems = []
  let addrActive = -1
  let lastGeocodeAt = 0
  function closeSuggest() {
    addrList.hidden = true
    addrInput.setAttribute('aria-expanded', 'false')
    addrInput.removeAttribute('aria-activedescendant')
    addrActive = -1
  }
  function drawSuggest() {
    addrList.replaceChildren(...addrItems.map((it, i) => {
      const li = el('li', { id: `ld-addr-opt-${i}`, role: 'option', className: 'ld-suggest-item', 'aria-selected': i === addrActive ? 'true' : 'false' },
        icon('mapPin', { size: 14 }), el('span', {}, it.label))
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pickAddress(it) })
      return li
    }))
    const open = addrItems.length > 0
    addrList.hidden = !open
    addrInput.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (addrActive >= 0) addrInput.setAttribute('aria-activedescendant', `ld-addr-opt-${addrActive}`)
    else addrInput.removeAttribute('aria-activedescendant')
  }
  async function runGeocode(q) {
    addrCtl?.abort()
    const ac = new AbortController()
    addrCtl = ac
    const gap = lastGeocodeAt + GEOCODE_DEBOUNCE_MS - Date.now()
    if (gap > 0) await new Promise((r) => setTimeout(r, gap))
    if (ac.signal.aborted) return
    lastGeocodeAt = Date.now()
    addrStatus.textContent = t('leads.loc.searching')
    try {
      addrItems = await geocode(q, { signal: ac.signal })
      if (ac.signal.aborted) return
      addrActive = addrItems.length ? 0 : -1
      addrStatus.textContent = addrItems.length ? t('leads.loc.found', { count: addrItems.length }) : t('leads.loc.notFound')
      drawSuggest()
    } catch (err) {
      if (err.name === 'AbortError') return
      addrItems = []
      drawSuggest()
      addrStatus.textContent = err.message
    }
  }
  addrInput.addEventListener('input', () => {
    clearTimeout(addrTimer)
    const q = addrInput.value.trim()
    if (q.length < 3) { addrItems = []; closeSuggest(); addrStatus.textContent = ''; return }
    addrTimer = setTimeout(() => runGeocode(q), GEOCODE_DEBOUNCE_MS)
  })
  addrInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && addrItems.length) { e.preventDefault(); addrActive = (addrActive + 1) % addrItems.length; drawSuggest() }
    else if (e.key === 'ArrowUp' && addrItems.length) { e.preventDefault(); addrActive = (addrActive - 1 + addrItems.length) % addrItems.length; drawSuggest() }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (!addrList.hidden && addrItems[addrActive]) pickAddress(addrItems[addrActive])
      else if (addrInput.value.trim().length >= 3) { clearTimeout(addrTimer); runGeocode(addrInput.value.trim()) }
    } else if (e.key === 'Escape' && !addrList.hidden) { e.preventDefault(); closeSuggest() }
  })
  addrInput.addEventListener('blur', () => setTimeout(closeSuggest, 120))
  onAbort(() => { clearTimeout(addrTimer); addrCtl?.abort() })

  function pickAddress(it) {
    closeSuggest()
    addrInput.value = it.label.split(',').slice(0, 2).join(',')
    setPoint({ lat: it.lat, lon: it.lon }, it.label, { fly: true })
  }

  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { formMsg.show('warn', t('leads.loc.noGeo')); return }
    const restore = C.setBusy(geoBtn, t('leads.loc.locating'))
    navigator.geolocation.getCurrentPosition((pos) => {
      restore()
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude }
      if (!inIndonesia(p.lat, p.lon)) { formMsg.show('warn', t('leads.loc.outside')); return }
      setPoint(p, t('leads.loc.current'), { fly: true })
    }, (err) => {
      restore()
      formMsg.show('warn', err.code === 1 ? t('leads.loc.denied') : t('leads.loc.unreadable'))
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
  })

  function drawPointLine() {
    if (!state.point) {
      pointLine.replaceChildren(icon('info', { size: 14 }), el('span', {}, t('leads.loc.none')))
      pointLine.classList.add('is-empty')
      return
    }
    pointLine.classList.remove('is-empty')
    pointLine.replaceChildren(icon('mapPin', { size: 14 }),
      el('span', {}, el('b', {}, state.pointLabel || t('leads.loc.mapPoint')), ' ',
        el('span', { className: 'tnum muted' }, `${state.point.lat.toFixed(4)}, ${state.point.lon.toFixed(4)}`)))
  }

  // --- Radius ---
  const radiusOut = el('output', { className: 'ld-radius-val tnum', htmlFor: 'ld-radius' }, km(state.radiusKm))
  const radiusInput = el('input', {
    id: 'ld-radius', type: 'range', className: 'ld-range', min: '1', max: String(MAX_RADIUS_KM), step: '1', value: String(state.radiusKm),
    'aria-valuetext': t('leads.radius.valuetext', { km: state.radiusKm }),
  })
  const radiusField = el('div', { className: 'field' },
    el('label', { className: 'field-label', htmlFor: 'ld-radius' }, el('span', {}, t('leads.radius.label')), radiusOut),
    radiusInput,
    el('span', { className: 'ld-range-scale', 'aria-hidden': 'true' }, el('span', {}, '1 km'), el('span', {}, `${MAX_RADIUS_KM} km`)),
  )
  const syncRadiusFill = () => radiusInput.style.setProperty('--fill', `${((state.radiusKm - 1) / (MAX_RADIUS_KM - 1)) * 100}%`)
  syncRadiusFill()
  radiusInput.addEventListener('input', () => {
    state.radiusKm = Number(radiusInput.value)
    radiusOut.textContent = km(state.radiusKm)
    radiusInput.setAttribute('aria-valuetext', t('leads.radius.valuetext', { km: state.radiusKm }))
    syncRadiusFill()
    drawCircle()
  })
  radiusInput.addEventListener('change', () => { persist(); fitCircle() })

  // --- Criteria chips ---
  const chipsBox = el('div', { className: 'ld-chips', role: 'group', 'aria-label': t('leads.kw.groupLabel') })
  const customBox = el('div', { className: 'ld-chips ld-chips-custom', 'aria-label': t('leads.kw.extraLabel'), role: 'list' })
  const kwInput = el('input', { id: 'ld-kw', className: 'input', placeholder: t('leads.kw.placeholder'), maxlength: '40', 'aria-describedby': 'ld-kw-hint' })
  const kwAdd = C.button({ label: t('leads.kw.add'), icon: 'plus', variant: 'soft', size: 'sm' })
  const kwCount = el('span', { className: 'ld-kw-count tnum' })
  const kwField = el('div', { className: 'field' },
    el('div', { className: 'field-label' }, el('span', { id: 'ld-kw-label' }, t('leads.kw.label')), kwCount),
    chipsBox,
    customBox,
    el('div', { className: 'ld-kw-row' }, el('label', { className: 'sr-only', htmlFor: 'ld-kw' }, t('leads.kw.other')), kwInput, kwAdd),
    el('span', { className: 'field-hint', id: 'ld-kw-hint' }, t('leads.kw.hint', { max: MAX_KEYWORDS })),
  )
  const presetKeys = new Set(PRESET_CHIPS.map((c) => c.value))
  function drawChips() {
    chipsBox.replaceChildren(...PRESET_CHIPS.map((c) => {
      const on = state.keywords.includes(c.value)
      const b = el('button', { type: 'button', className: 'ld-chip', 'aria-pressed': on ? 'true' : 'false' },
        on ? icon('check', { size: 13 }) : null, presetLabel(c))
      b.addEventListener('click', () => toggleKeyword(c.value))
      return b
    }))
    const custom = state.keywords.filter((k) => !presetKeys.has(k))
    customBox.replaceChildren(...custom.map((k) => el('span', { className: 'ld-chip is-custom', role: 'listitem' },
      el('span', {}, k),
      el('button', { type: 'button', className: 'ld-chip-x', 'aria-label': t('leads.kw.remove', { kw: k }), title: t('leads.kw.removeTitle'), onClick: () => toggleKeyword(k) }, icon('x', { size: 12 })))))
    customBox.hidden = custom.length === 0
    kwCount.textContent = `${state.keywords.length}/${MAX_KEYWORDS}`
    kwAdd.disabled = state.keywords.length >= MAX_KEYWORDS
  }
  function toggleKeyword(k) {
    if (state.keywords.includes(k)) state.keywords = state.keywords.filter((x) => x !== k)
    else if (state.keywords.length < MAX_KEYWORDS) state.keywords = [...state.keywords, k]
    else { formMsg.show('warn', t('leads.kw.max', { max: MAX_KEYWORDS })); return }
    formMsg.hide()
    persist()
    drawChips()
  }
  function addCustom() {
    const k = normalizeKeyword(kwInput.value)
    if (k.length < 2) { kwInput.focus(); return }
    if (!state.keywords.includes(k)) toggleKeyword(k)
    kwInput.value = ''
    kwInput.focus()
  }
  kwAdd.addEventListener('click', addCustom)
  kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } })

  // --- Value basis ---
  const valueBox = el('div', { className: 'ld-value' })
  const fallbackInput = el('input', { id: 'ld-fallback', className: 'input', type: 'number', min: '0', step: '50000', inputmode: 'numeric', placeholder: t('leads.value.fallbackPlaceholder'), value: state.fallbackAvg ? String(state.fallbackAvg) : '' })
  const convInput = el('input', { id: 'ld-conv', className: 'input ld-conv', type: 'number', min: String(MIN_CONVERSION * 100), max: String(MAX_CONVERSION * 100), step: '1', inputmode: 'numeric', value: String(Math.round(state.conversion * 100)), 'aria-describedby': 'ld-conv-hint' })
  const convField = el('div', { className: 'field' },
    el('label', { className: 'field-label', htmlFor: 'ld-conv' }, el('span', {}, t('leads.value.conv'))),
    el('div', { className: 'ld-suffix' }, convInput, el('span', { 'aria-hidden': 'true' }, '%')),
    el('span', { className: 'field-hint', id: 'ld-conv-hint' }, t('leads.value.convHint')),
  )
  function drawValueBox() {
    if (stats.length) {
      valueBox.replaceChildren(
        el('span', { className: 'ld-value-title' }, icon('ledger', { size: 14 }), t('leads.value.fromHistory')),
        el('ul', { className: 'ld-value-list' }, stats.slice(0, 4).map((s) => el('li', {},
          el('span', { className: 'ld-value-name' }, s.name),
          el('span', { className: 'tnum' }, C.rupiahCompact(s.avg)),
          el('span', { className: 'ld-value-n tnum' }, t('leads.value.jobs', { count: s.count }))))),
        stats.length > 4 ? el('span', { className: 'field-hint' }, t('leads.value.more', { count: stats.length - 4 })) : '',
      )
    } else {
      valueBox.replaceChildren(
        el('div', { className: 'field' },
          el('label', { className: 'field-label', htmlFor: 'ld-fallback' }, el('span', {}, t('leads.value.fallback'))),
          fallbackInput,
          el('span', { className: 'field-hint' }, t('leads.value.fallbackHint'))),
      )
    }
  }
  fallbackInput.addEventListener('change', () => { state.fallbackAvg = Math.max(0, Number(fallbackInput.value) || 0); persist(); rescore() })
  convInput.addEventListener('change', () => {
    const v = Math.min(MAX_CONVERSION * 100, Math.max(MIN_CONVERSION * 100, Number(convInput.value) || DEFAULT_CONVERSION * 100))
    convInput.value = String(Math.round(v))
    state.conversion = v / 100
    persist()
    rescore()
  })

  // --- Source ---
  const sourceBox = el('div', { className: 'ld-source' })
  function drawSource() {
    if (ctx.isMock || sources.demo) {
      sourceBox.hidden = false
      sourceBox.replaceChildren(el('span', { className: 'field-hint' }, t('leads.source.demo')))
      return
    }
    sourceBox.hidden = !sources.google
    if (!sources.google) { sourceBox.replaceChildren(); return }
    sourceBox.replaceChildren(el('span', { className: 'field-label' }, el('span', {}, t('leads.source.label'))),
      C.segmented({
        label: t('leads.source.label'), value: state.source,
        options: [{ value: 'osm', label: t('leads.source.osm') }, { value: 'google', label: 'Google' }],
        onChange: (v) => { state.source = v },
      }))
  }

  const formMsg = C.message()
  const searchBtn = C.button({ label: t('leads.form.search'), icon: 'search', variant: 'primary', type: 'submit', className: 'ld-search-btn' })
  // display: contents, so disabling it during a search locks every control.
  const controlsSet = el('fieldset', { className: 'ld-fieldset' },
    locField, radiusField, kwField, sourceBox,
    el('details', { className: 'ld-more' },
      el('summary', {}, icon('chevronRight', { size: 14 }), t('leads.form.valueBasis')),
      el('div', { className: 'ld-more-body' }, valueBox, convField)),
  )
  const controlsForm = el('form', { className: 'form ld-form', novalidate: true, 'aria-label': t('leads.form.label') },
    controlsSet,
    formMsg,
    el('div', { className: 'form-actions' }, searchBtn),
  )
  controlsForm.addEventListener('submit', (e) => { e.preventDefault(); if (!locked) runSearch() })
  const controlsPanel = C.panel({ title: t('leads.form.panelTitle'), meta: t('leads.form.panelMeta'), raised: true, className: 'form-panel ld-controls' }, controlsForm)

  /* ================================================================ Map */
  const mapEl = el('div', { className: 'ld-map', role: 'region', 'aria-label': t('leads.map.label') })
  const mapNote = el('div', { className: 'ld-map-note', 'aria-hidden': 'true' }, icon('mapPin', { size: 14 }), t('leads.map.note'))
  const mapBusy = el('div', { className: 'ld-map-busy', hidden: true },
    el('span', { className: 'ld-map-busy-pill' }, el('span', { className: 'ld-spinner', 'aria-hidden': 'true' }), t('leads.map.loading')))
  const mapWrap = el('div', { className: 'ld-map-wrap', 'aria-busy': 'false' }, mapEl, mapNote, mapBusy)
  const mapFallback = el('div', { className: 'ld-map-fallback', hidden: true })
  const mapPanel = el('section', { className: 'panel ld-map-panel', 'aria-label': t('leads.map.region') }, mapWrap, mapFallback)

  let L = null
  let map = null
  let centerMarker = null
  let circle = null
  let markerLayer = null
  const markers = new Map()

  async function initMap() {
    try {
      L = await loadLeaflet()
    } catch {
      mapWrap.hidden = true
      mapFallback.hidden = false
      mapFallback.replaceChildren(C.errorState(t('leads.map.failed')))
      return
    }
    if (signal?.aborted) return
    const view = state.point ? { ...state.point, zoom: 13 } : DEFAULT_VIEW
    const anim = !reducedMotion()
    // Leaflet's delayed zoom transition can outlive this SPA view's teardown.
    map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: anim, markerZoomAnimation: false, scrollWheelZoom: true })
      .setView([view.lat, view.lon], view.zoom)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.attributionControl.setPrefix(false)
    markerLayer = L.layerGroup().addTo(map)
    map.on('click', (e) => {
      if (locked) return
      const p = { lat: e.latlng.lat, lon: e.latlng.lng }
      if (!inIndonesia(p.lat, p.lon)) { formMsg.show('warn', t('leads.map.outside')); return }
      setPoint(p, t('leads.loc.mapPoint'))
    })
    // Stop pan/zoom animations first: removing a map mid-animation makes
    // Leaflet's pending transition callbacks read positions of removed panes.
    onAbort(() => {
      const m = map
      map = null
      if (!m) return
      try { m.stop(); m.off(); m.remove() } catch { /* already torn down */ }
    })
    const onTheme = () => drawCircle()
    window.addEventListener('themechange', onTheme)
    onAbort(() => window.removeEventListener('themechange', onTheme))
    drawCircle()
    if (state.point) fitCircle({ animate: false })
    drawMarkers()
    if (locked) { locked = false; setLocked(true) }
  }

  function drawCircle() {
    if (!map || !L) return
    if (!state.point) { centerMarker?.remove(); circle?.remove(); centerMarker = null; circle = null; mapNote.hidden = false; return }
    mapNote.hidden = true
    const ll = [state.point.lat, state.point.lon]
    const brand = cssVar('--brand-500', '#2b7560')
    if (!circle) circle = L.circle(ll, { radius: state.radiusKm * 1000, color: brand, weight: 1.5, fillColor: brand, fillOpacity: 0.07, interactive: false }).addTo(map)
    else circle.setLatLng(ll).setRadius(state.radiusKm * 1000).setStyle({ color: brand, fillColor: brand })
    if (!centerMarker) {
      centerMarker = L.marker(ll, {
        icon: L.divIcon({ className: 'ld-center-icon', html: '<span class="ld-center"><span class="ld-center-dot"></span></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: t('leads.loc.label'), keyboard: false, interactive: false,
      }).addTo(map)
    } else centerMarker.setLatLng(ll)
  }
  function fitCircle({ animate = true } = {}) {
    if (!map || !circle) return
    map.fitBounds(circle.getBounds(), { padding: [24, 24], animate: animate && !reducedMotion() })
  }

  function setPoint(p, label, { fly = false } = {}) {
    state.point = { lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 }
    state.pointLabel = label
    formMsg.hide()
    persist()
    drawPointLine()
    drawCircle()
    if (fly) fitCircle()
  }

  function markerIcon(lead, rank) {
    const cls = ['ld-pin', lead.ai.keep ? '' : 'is-muted', lead.id === state.focusId ? 'is-focus' : '', rank <= 3 && lead.ai.keep ? 'is-top' : ''].filter(Boolean).join(' ')
    return L.divIcon({ className: 'ld-pin-icon', html: `<span class="${cls}"><span>${rank}</span></span>`, iconSize: [30, 30], iconAnchor: [15, 15] })
  }
  function drawMarkers() {
    if (!map || !L || !markerLayer) return
    markerLayer.clearLayers()
    markers.clear()
    visibleLeads().forEach((lead, i) => {
      const m = L.marker([lead.lat, lead.lon], { icon: markerIcon(lead, i + 1), title: `${i + 1}. ${lead.name}`, alt: lead.name, riseOnHover: true })
      m.on('click', () => focusLead(lead.id, { from: 'map' }))
      m.addTo(markerLayer)
      markers.set(lead.id, { m, rank: i + 1, lead })
    })
  }
  function focusLead(id, { from = 'list' } = {}) {
    const prev = state.focusId
    state.focusId = id
    for (const key of [prev, id]) {
      const rec = markers.get(key)
      if (rec) rec.m.setIcon(markerIcon(rec.lead, rec.rank))
    }
    resultsList.querySelectorAll('.ld-card.is-focus').forEach((n) => n.classList.remove('is-focus'))
    let card = resultsList.querySelector(`[data-id="${CSS.escape(id)}"]`)
    if (!card && from === 'map') {
      const idx = visibleLeads().findIndex((x) => x.id === id)
      if (idx >= 0) { drawResults({ focusIndex: idx }); card = resultsList.querySelector(`[data-id="${CSS.escape(id)}"]`) }
    }
    card?.classList.add('is-focus')
    if (from === 'map') {
      card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      card?.querySelector('.ld-card-title')?.focus({ preventScroll: true })
    } else {
      const rec = markers.get(id)
      if (rec && map) {
        if (reducedMotion()) map.setView(rec.m.getLatLng(), Math.max(map.getZoom(), 15), { animate: false })
        else map.flyTo(rec.m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 })
        mapPanel.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
    }
  }

  /* ============================================================ Results */
  const resultsMeta = el('span', { className: 'panel-meta' }, t('leads.results.none'))
  const sortSeg = C.segmented({ label: t('leads.results.sortLabel'), value: state.sort, options: sortOptions(), onChange: (v) => { state.sort = v; drawResults() } })
  const statusSlot = el('div', { className: 'ld-status' })
  const resultsInfo = el('div', { className: 'ld-info' })
  const resultsList = el('ol', { className: 'ld-list', 'aria-label': t('leads.results.listLabel') })
  const hiddenToggle = el('button', { type: 'button', className: 'link-btn ld-hidden-toggle', hidden: true, 'aria-expanded': 'false' })
  hiddenToggle.addEventListener('click', () => { state.showHidden = !state.showHidden; drawResults() })
  const resultsBody = el('div', { className: 'ld-results-body' }, statusSlot, resultsInfo, resultsList, hiddenToggle)
  const resultsPager = C.pager({ key: 'leads-results', label: t('leads.results.pagerLabel'), pageSize: PAGE_SIZE, sizes: [PAGE_SIZE, PAGE_SIZE * 2, PAGE_SIZE * 4], className: 'is-plain', onChange: () => drawResults(), scrollTarget: () => resultsPanel })
  resultsBody.insertBefore(resultsPager.root, hiddenToggle)
  const resultsPanel = el('section', { className: 'panel list-panel ld-results', 'aria-labelledby': 'ld-results-title' },
    el('div', { className: 'panel-head' },
      el('div', { className: 'panel-head-text' }, el('h2', { className: 'panel-title', id: 'ld-results-title' }, t('leads.results.title')), resultsMeta),
      el('div', { className: 'panel-actions ld-sort' }, sortSeg)),
    el('div', { className: 'panel-body' }, resultsBody),
  )
  sortSeg.hidden = true

  function emptyResults() {
    resultsList.replaceChildren()
    resultsInfo.replaceChildren(C.emptyState({
      kicker: t('leads.results.emptyKicker'), iconName: 'mapPin',
      title: t('leads.results.emptyTitle'),
      body: t('leads.results.emptyBody'),
    }))
  }

  const visibleLeads = () => sortLeads(state.leads.filter((l) => l.ai.keep), state.sort)
  const hiddenLeads = () => state.leads.filter((l) => !l.ai.keep)

  function scoreAll(rows) {
    return rows.map((l) => {
      const s = scoreLead({ ...l, relevance: l.ai.relevance }, state.search?.radius_km || state.radiusKm)
      const estimate = estimateValue({ service: l.ai.suggested_service, stats, fallbackAvg: state.fallbackAvg, conversion: state.conversion })
      return { ...l, ...s, estimate }
    })
  }
  function rescore() {
    if (!state.leads.length) return
    state.leads = scoreAll(state.leads)
    drawResults()
  }

  function drawResults({ focusIndex } = {}) {
    const vis = visibleLeads()
    const hid = hiddenLeads()
    const src = state.search?.source
    sortSeg.hidden = vis.length < 2
    resultsMeta.textContent = state.search
      ? t('leads.results.meta', { count: vis.length, filtered: hid.length ? t('leads.results.filtered', { count: hid.length }) : '', demo: src === 'demo' ? t('leads.results.demo') : '' })
      : t('leads.results.none')
    drawInfo()
    const shown = resultsPager.slice(vis, { resetKey: state.sort, focusIndex })
    const offset = resultsPager.start
    resultsList.replaceChildren(...shown.map((l, i) => leadCard(l, offset + i + 1)))
    if (state.showHidden && hid.length && resultsPager.page >= resultsPager.pages) {
      resultsList.append(el('li', { className: 'ld-list-sep', 'aria-hidden': 'true' }, t('leads.results.sep')),
        ...hid.map((l) => leadCard(l, null)))
    }
    hiddenToggle.hidden = hid.length === 0
    hiddenToggle.setAttribute('aria-expanded', state.showHidden ? 'true' : 'false')
    hiddenToggle.textContent = state.showHidden ? t('leads.results.hideFiltered') : t('leads.results.showFiltered', { count: hid.length })
    drawMarkers()
  }

  function drawInfo() {
    if (!state.search) return
    const src = state.search.source
    const nodes = []
    if (src === 'demo') {
      nodes.push(el('div', { className: 'note note-warn' }, icon('alert'), el('div', { className: 'note-body' },
        el('p', {}, el('b', {}, t('leads.info.demoBadge')), t('leads.info.demo')))))
    } else if (src === 'osm') {
      nodes.push(el('p', { className: 'ld-fine' }, icon('info', { size: 14 }),
        el('span', {}, t('leads.info.osm', { truncated: state.search.truncated ? t('leads.info.truncated') : '' }))))
    } else if (src === 'google') {
      nodes.push(el('p', { className: 'ld-fine' }, icon('info', { size: 14 }), el('span', {}, t('leads.info.google'))))
    }
    if (state.rankBasis === 'heuristik') {
      nodes.push(el('p', { className: 'ld-fine' }, icon('alert', { size: 14 }), el('span', {}, t('leads.info.heuristic'))))
    } else if (state.rankBasis === 'mixed') {
      nodes.push(el('p', { className: 'ld-fine' }, icon('info', { size: 14 }), el('span', {}, t('leads.info.mixed', { count: Math.min(AI_RANK_LIMIT, state.leads.length) }))))
    }
    resultsInfo.replaceChildren(...nodes)
  }

  function completenessChips(l) {
    const item = (ok, iconName, text) => el('li', { className: `ld-mini ${ok ? 'is-ok' : 'is-missing'}` }, icon(ok ? iconName : 'minus', { size: 12 }), el('span', {}, text), el('span', { className: 'sr-only' }, ok ? t('leads.chips.available') : t('leads.chips.missing')))
    return el('ul', { className: 'ld-minis', 'aria-label': t('leads.chips.label') },
      item(Boolean(l.phone), 'phone', t('leads.chips.phone')), item(Boolean(l.website), 'arrowUpRight', t('leads.chips.site')), item(Boolean(l.address), 'mapPin', t('leads.chips.address')))
  }

  function leadCard(l, rank) {
    const savedRow = savedBySource.get(`${l.source}|${l.source_id}`)
    const saveBtn = C.button({ label: savedRow ? t('leads.card.saved') : t('leads.card.save'), icon: savedRow ? 'check' : 'bookmark', size: 'sm', variant: 'soft', 'aria-label': savedRow ? t('leads.card.alreadySaved', { name: l.name }) : t('leads.card.saveAria', { name: l.name }), title: t('leads.card.saveTitle') })
    if (savedRow) { saveBtn.disabled = true; saveBtn.classList.add('is-saved') }
    saveBtn.addEventListener('click', () => saveLead(l, saveBtn))
    const offerBtn = C.button({ label: t('leads.card.offer'), icon: 'sparkles', size: 'sm', variant: 'primary', 'aria-label': t('leads.card.offerAria', { name: l.name }) })
    offerBtn.addEventListener('click', () => openOffer(l, offerBtn))
    const est = l.estimate
    const relClass = l.ai.relevance >= 70 ? 'is-high' : l.ai.relevance >= 45 ? 'is-mid' : 'is-low'
    const titleBtn = el('button', { type: 'button', className: 'ld-card-title', title: t('leads.card.showOnMap') }, l.name)
    titleBtn.addEventListener('click', () => focusLead(l.id))
    const links = []
    if (l.phone) links.push(el('a', { className: 'ld-link tnum', href: `tel:${l.phone}` }, icon('phone', { size: 13 }), l.phone))
    if (l.website) links.push(el('a', { className: 'ld-link', href: l.website, target: '_blank', rel: 'noopener noreferrer' }, icon('arrowUpRight', { size: 13 }), l.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40)))

    return el('li', { className: `ld-card ${l.ai.keep ? '' : 'is-hidden-lead'} ${l.id === state.focusId ? 'is-focus' : ''}`.trim(), dataset: { id: l.id } },
      el('div', { className: 'ld-card-head' },
        rank ? el('span', { className: `ld-rank tnum ${rank <= 3 ? 'is-top' : ''}`, 'aria-label': t('leads.card.rank', { rank }) }, String(rank)) : el('span', { className: 'ld-rank is-muted', 'aria-hidden': 'true' }, icon('minus', { size: 12 })),
        el('div', { className: 'ld-card-name' },
          titleBtn,
          el('div', { className: 'ld-card-sub' },
            el('span', {}, l.category),
            el('span', { 'aria-hidden': 'true' }, '·'),
            el('span', { className: 'tnum' }, km(l.distance_km)),
            l.source === 'demo' ? el('span', { className: 'tag status status-live', title: t('leads.card.fictional') }, t('leads.card.sample')) : null,
            l.address ? el('span', { className: 'ld-addr', title: l.address }, l.address) : null)),
        el('div', { className: 'ld-score', title: t('leads.card.scoreTitle') },
          el('span', { className: 'ld-score-num tnum' }, String(l.score)),
          el('span', { className: 'ld-score-label' }, t('leads.card.score'))),
      ),
      el('div', { className: 'ld-card-body' },
        el('div', { className: 'ld-rel' },
          el('div', { className: 'ld-rel-top' },
            el('span', { className: 'ld-rel-label' }, l.ai.basis === 'ai' ? t('leads.card.relAi') : t('leads.card.relRule')),
            el('span', { className: 'ld-rel-val tnum' }, `${l.ai.relevance}/100`)),
          el('span', { className: `ld-bar ${relClass}`, role: 'img', 'aria-label': t('leads.card.relAria', { value: l.ai.relevance }) }, el('i', { style: `width:${l.ai.relevance}%` })),
          el('p', { className: 'ld-reason' }, l.ai.reason),
          !l.ai.keep && l.ai.duplicate_of ? el('p', { className: 'ld-dup' }, t('leads.card.dup')) : null),
        el('dl', { className: 'ld-facts' },
          el('div', { className: 'is-wide' }, el('dt', {}, t('leads.card.service')), el('dd', {}, l.ai.suggested_service || t('leads.card.unclear'))),
          el('div', {}, el('dt', {}, t('leads.card.potential')), el('dd', { className: 'tnum' }, est.basis ? C.rupiah(est.potential) : '—')),
          el('div', {}, el('dt', {}, t('leads.card.expected')), el('dd', { className: 'tnum ld-expected' }, est.basis ? C.rupiah(est.expected) : '—')),
        ),
        completenessChips(l),
        links.length ? el('div', { className: 'ld-links' }, links) : null,
        el('details', { className: 'ld-how' },
          el('summary', {}, icon('chevronRight', { size: 13 }), t('leads.card.how')),
          el('p', {}, t('leads.card.howScore', { score: l.score, rel: l.ai.relevance, prox: fmtFactor(l.proximity), comp: fmtFactor(l.completeness) })),
          el('p', {}, est.basis
            ? t('leads.card.howValue', { potential: C.rupiah(est.potential), note: estNote(est, l.ai.suggested_service), pct: pct(est.conversion), expected: C.rupiah(est.expected) })
            : estNote(est, l.ai.suggested_service))),
      ),
      el('div', { className: 'ld-card-actions' }, saveBtn, offerBtn),
    )
  }

  /* --------------------------------------------------------- Run search */
  // The search runs in src/leads/job.js so it survives page changes; this
  // page only starts it and draws whatever state the job is in.
  const owner = ctx.user?.id || 'anon'
  let stored = loadLeadsStore(owner)
  let consoleUI = null

  function runSearch() {
    formMsg.hide()
    const errs = []
    if (!state.point) errs.push(t('leads.search.needPoint'))
    if (!state.keywords.length) errs.push(t('leads.search.needKw'))
    if (errs.length) { formMsg.show('danger', errs[0], errs.length > 1 ? errs.slice(1) : undefined); return }
    state.focusId = null
    state.showHidden = false
    resultsPager.reset()
    consoleUI = null
    startLeadJob({
      owner,
      isMock: Boolean(ctx.isMock),
      criteria: { point: state.point, pointLabel: state.pointLabel, radiusKm: state.radiusKm, keywords: state.keywords, source: state.source },
      prepare: async () => {
        await businessReady
        if (!model) { try { await modelReady } catch { /* no model */ } }
        return { services: servicesForAI(), model }
      },
    })
    if (window.matchMedia('(max-width: 1023px)').matches) resultsPanel.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  /** Shows a stored search (from the job or the history) without a request. */
  function showEntry(entry, { fit = false } = {}) {
    state.search = entry.search
    state.rankBasis = entry.rankBasis
    state.leads = scoreAll(entry.leads)
    activeEntryId = entry.id
    statusSlot.replaceChildren()
    if (!state.leads.length) {
      resultsMeta.textContent = t('leads.search.zero')
      resultsList.replaceChildren()
      sortSeg.hidden = true
      hiddenToggle.hidden = true
      drawMarkers()
      resultsInfo.replaceChildren(C.emptyState({
        kicker: t('leads.search.noneKicker'), iconName: 'search',
        title: t('leads.search.noneTitle'),
        body: t('leads.search.noneBody'),
      }))
    } else {
      drawResults()
      if (fit && map && circle) fitCircle()
    }
    drawHistory()
  }

  let lastStatus = null
  function syncJob(j) {
    const running = isJobRunning(j)
    setLocked(running)
    if (!j) return
    const changed = j.status !== lastStatus
    lastStatus = j.status
    if (j.status === 'fetching') {
      if (!changed) return
      state.leads = []
      state.search = null
      state.rankBasis = null
      resultsList.replaceChildren()
      hiddenToggle.hidden = true
      sortSeg.hidden = true
      resultsInfo.replaceChildren()
      drawMarkers()
      const stop = C.button({ label: t('leads.search.cancel'), icon: 'x', size: 'sm', variant: 'ghost', onClick: () => cancelLeadJob() })
      statusSlot.replaceChildren(el('div', { className: 'ld-status-row' }, statusLine(t('leads.search.fetching', { keywords: j.criteria.keywords.join(', '), km: km(j.criteria.radiusKm) })), stop), C.skeletonRows(3))
      resultsMeta.textContent = t('leads.search.busy')
      return
    }
    if (j.status === 'ranking') {
      if (changed) {
        state.search = j.search
        state.rankBasis = j.rankBasis
        state.leads = scoreAll(j.leads)
        drawResults()
        if (map && circle) fitCircle()
        consoleUI = C.aiConsole({ model: t('leads.search.rater') })
        consoleUI.onStop(() => cancelLeadJob())
        consoleUI.setStatus(t('leads.search.rating', { count: Math.min(AI_RANK_LIMIT, j.aiTotal) }), true)
        consoleUI.root.classList.add('ld-console')
        statusSlot.replaceChildren(consoleUI.root)
      }
      consoleUI?.write(j.aiText || '')
      return
    }
    if (!changed) return
    consoleUI?.done()
    if (j.status === 'done' && j.entry) {
      stored = loadLeadsStore(owner)
      const ui = consoleUI
      showEntry(j.entry)
      if (ui) {
        ui.setStatus(j.aiCount > 0 ? t('leads.search.rated', { count: j.aiCount }) : t('leads.search.noAi'), false)
        ui.root.classList.add('is-folded')
        statusSlot.replaceChildren(ui.root)
      }
      if (j.error) showToast(j.error, 'error')
    } else if (j.status === 'error') {
      statusSlot.replaceChildren()
      resultsMeta.textContent = t('leads.search.failed')
      resultsInfo.replaceChildren(C.errorState(j.error || t('leads.search.failedFull')))
    } else if (j.status === 'cancelled') {
      statusSlot.replaceChildren()
      const prev = lastEntry(stored)
      if (prev) showEntry(prev)
      else { resultsMeta.textContent = t('leads.search.cancelledMeta'); state.leads = []; state.search = null; emptyResults(); drawMarkers() }
      showToast(t('leads.search.cancelled'), 'info')
    }
    consoleUI = null
  }

  /* ------------------------------------------------------------ History */
  let activeEntryId = null
  const historyList = el('ul', { className: 'ld-history-list' })
  const historyBox = el('div', { className: 'ld-history', hidden: true },
    el('span', { className: 'field-label' }, el('span', {}, t('leads.history.title'))),
    historyList)
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (!Number.isFinite(m) || m < 1) return t('leads.history.now')
    if (m < 60) return t('leads.history.min', { n: m })
    const h = Math.round(m / 60)
    if (h < 24) return t('leads.history.hour', { n: h })
    return C.formatDate(iso)
  }
  function drawHistory() {
    const items = stored.history
    historyBox.hidden = items.length === 0
    historyList.replaceChildren(...items.map((e) => {
      const n = e.leads.filter((l) => l.ai?.keep !== false).length
      const open = el('button', {
        type: 'button', className: `ld-history-item ${e.id === activeEntryId ? 'is-active' : ''}`.trim(),
        'aria-current': e.id === activeEntryId ? 'true' : 'false',
        title: t('leads.history.open'),
      },
        icon('clock', { size: 14 }),
        el('span', { className: 'ld-history-text' },
          el('b', {}, e.criteria.keywords.join(', ')),
          el('span', { className: 'muted' }, `${km(e.criteria.radiusKm)} · ${e.criteria.pointLabel || t('leads.loc.mapPoint')} · ${ago(e.at)}`)),
        el('span', { className: 'ld-history-n tnum' }, String(n)))
      open.addEventListener('click', () => restoreEntry(e))
      const del = el('button', { type: 'button', className: 'ld-chip-x', 'aria-label': t('leads.history.remove', { keywords: e.criteria.keywords.join(', ') }), title: t('leads.history.removeTitle') }, icon('x', { size: 12 }))
      del.addEventListener('click', () => {
        stored = saveLeadsStore(owner, removeHistory(stored, e.id))
        drawHistory()
      })
      return el('li', {}, open, del)
    }))
  }
  function restoreEntry(e) {
    if (isJobRunning(getLeadJob(owner))) return
    const c = e.criteria
    if (c.point && inIndonesia(c.point.lat, c.point.lon)) {
      state.point = c.point
      state.pointLabel = c.pointLabel
      addrInput.value = ''
    }
    state.radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, Number(c.radiusKm) || state.radiusKm))
    radiusInput.value = String(state.radiusKm)
    radiusOut.textContent = km(state.radiusKm)
    syncRadiusFill()
    state.keywords = c.keywords.slice(0, MAX_KEYWORDS)
    if (c.source === 'google' && sources.google) state.source = 'google'
    persist()
    drawPointLine()
    drawChips()
    drawCircle()
    stored = saveLeadsStore(owner, { ...stored, lastId: e.id })
    state.focusId = null
    resultsPager.reset()
    showEntry(e, { fit: true })
  }

  /* --------------------------------------------------------- Map lock */
  let locked = false
  let restoreBtn = null
  function setLocked(on) {
    if (on === locked) return
    locked = on
    controlsSet.disabled = on
    if (on) restoreBtn = C.setBusy(searchBtn, t('leads.search.busy'))
    else { restoreBtn?.(); restoreBtn = null }
    mapBusy.hidden = !on
    mapWrap.setAttribute('aria-busy', on ? 'true' : 'false')
    mapWrap.classList.toggle('is-locked', on)
    historyBox.classList.toggle('is-locked', on)
    historyList.querySelectorAll('button').forEach((b) => { b.disabled = on })
    if (!map) return
    const handlers = [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard]
    handlers.forEach((h) => { if (h) on ? h.disable() : h.enable() })
  }

  function statusLine(text) {
    return el('p', { className: 'ld-status-line', role: 'status' }, el('span', { className: 'ld-spinner', 'aria-hidden': 'true' }), text)
  }

  /* ============================================================== Saved */
  let saved = null // rows
  let savedError = null
  const savedBySource = new Map()
  const savedBody = el('div', { className: 'ld-saved-body' }, C.skeletonRows(3))
  const savedMeta = el('span', { className: 'panel-meta' }, t('leads.saved.loading'))
  const savedFilter = { status: 'semua' }
  const savedSeg = C.segmented({
    label: t('leads.saved.filter'), value: 'semua',
    options: [{ value: 'semua', label: t('leads.saved.all') }, ...LEAD_STATUSES.map((s) => ({ value: s.value, label: statusText(s) }))],
    onChange: (v) => { savedFilter.status = v; drawSaved() },
  })
  const savedPanel = el('section', { className: 'panel list-panel ld-saved', 'aria-labelledby': 'ld-saved-title' },
    el('div', { className: 'panel-head' },
      el('div', { className: 'panel-head-text' }, el('h2', { className: 'panel-title', id: 'ld-saved-title' }, t('leads.tabs.saved')), savedMeta),
      el('div', { className: 'panel-actions ld-saved-filter' }, savedSeg)),
    el('div', { className: 'panel-body' }, savedBody),
  )
  const savedPager = C.pager({ key: 'leads-saved', label: t('leads.saved.pagerLabel'), className: 'is-plain', onChange: () => drawSaved(), scrollTarget: savedPanel })

  async function loadSaved() {
    try {
      const { data, error } = await getCloud().database.from('leads').select('*').order('created_at', { ascending: false }).limit(500)
      if (error) throw new Error(error.message)
      saved = (data || []).map((r) => ({ ...r, meta: parseMeta(r.meta_json) }))
      savedError = null
    } catch (err) {
      saved = saved || []
      savedError = err.message
    }
    savedBySource.clear()
    for (const r of saved) savedBySource.set(`${r.source}|${r.source_id}`, r)
    savedCount.hidden = !saved.length
    savedCount.textContent = String(saved.length)
    if (!tabPanels.get('saved').hidden) drawSaved()
  }

  function drawSaved() {
    if (saved === null) return
    if (savedError) {
      savedMeta.textContent = t('leads.saved.failedMeta')
      savedBody.replaceChildren(C.errorState(/tabel|table|leads/i.test(savedError)
        ? t('leads.saved.noTable', { error: savedError })
        : t('leads.saved.failed', { error: savedError })))
      return
    }
    const rows = savedFilter.status === 'semua' ? saved : saved.filter((r) => (r.status || 'baru') === savedFilter.status)
    const counts = LEAD_STATUSES.map((s) => `${saved.filter((r) => (r.status || 'baru') === s.value).length} ${statusText(s).toLowerCase()}`)
    savedMeta.textContent = saved.length ? t('leads.saved.meta', { count: saved.length, breakdown: counts.join(' · ') }) : t('leads.saved.none')
    savedSeg.hidden = saved.length < 2
    if (!saved.length) {
      const go = C.button({ label: t('leads.form.search'), icon: 'search', variant: 'primary', size: 'sm' })
      go.addEventListener('click', () => { activate('search'); tabBtns.get('search').focus() })
      savedBody.replaceChildren(C.emptyState({ kicker: t('leads.saved.emptyKicker'), iconName: 'bookmark', title: t('leads.saved.emptyTitle'), body: t('leads.saved.emptyBody'), action: go }))
      return
    }
    if (!rows.length) {
      savedBody.replaceChildren(el('p', { className: 'muted small ld-saved-empty' }, t('leads.saved.noStatus')))
      return
    }
    savedBody.replaceChildren(el('ul', { className: 'ld-saved-list' }, savedPager.slice(rows, { resetKey: savedFilter.status }).map(savedRow)), savedPager.root)
  }

  function savedRow(r) {
    const st = statusOf(r.status)
    const sel = el('select', { className: 'input ld-status-sel', 'aria-label': t('leads.saved.statusAria', { name: r.name }) },
      LEAD_STATUSES.map((s) => el('option', { value: s.value }, statusText(s))))
    sel.value = st.value
    sel.addEventListener('change', async () => {
      sel.disabled = true
      try {
        const { error } = await getCloud().database.from('leads').update({ status: sel.value }).eq('id', r.id)
        if (error) throw new Error(error.message)
        r.status = sel.value
        showToast(t('leads.saved.statusChanged', { status: statusText(statusOf(sel.value)) }), 'success')
        drawSaved()
      } catch (err) {
        sel.value = r.status || 'baru'
        showToast(t('leads.saved.statusFailed', { error: err.message }), 'error')
      } finally { sel.disabled = false }
    })
    const offerBtn = C.button({ label: t('leads.card.offer'), icon: 'sparkles', size: 'sm', variant: 'soft' })
    offerBtn.addEventListener('click', () => openOffer(savedToLead(r), offerBtn))
    const actions = [offerBtn]
    if (r.meta?.offer_id || r.meta?.request_id) {
      const open = C.button({ label: t('leads.saved.openFlow'), iconRight: 'arrowRight', size: 'sm', variant: 'ghost' })
      open.addEventListener('click', () => navigate('offer', r.meta.offer_id ? { offerId: r.meta.offer_id } : { requestId: r.meta.request_id }))
      actions.push(open)
    }
    const del = C.button({ label: t('leads.saved.delete'), icon: 'trash', size: 'sm', variant: 'ghost', className: 'ld-del' })
    let armed = null
    del.addEventListener('click', async () => {
      if (!armed) {
        del.querySelector('.btn-label').textContent = t('leads.saved.confirm')
        del.classList.add('is-armed')
        armed = setTimeout(() => { armed = null; del.classList.remove('is-armed'); del.querySelector('.btn-label').textContent = t('leads.saved.delete') }, 4000)
        return
      }
      clearTimeout(armed)
      const restore = C.setBusy(del, t('leads.saved.deleting'))
      try {
        const { error } = await getCloud().database.from('leads').delete().eq('id', r.id)
        if (error) throw new Error(error.message)
        showToast(t('leads.saved.deleted'), 'success')
        await loadSaved()
        drawResults()
      } catch (err) {
        restore()
        showToast(t('leads.saved.deleteFailed', { error: err.message }), 'error')
      }
    })
    actions.push(del)
    const facts = [
      r.category,
      r.distance_km != null ? km(r.distance_km) : null,
      r.meta?.suggested_service ? t('leads.saved.fits', { service: r.meta.suggested_service }) : null,
    ].filter(Boolean)
    return el('li', { className: 'ld-saved-item' },
      el('div', { className: 'ld-saved-main' },
        el('div', { className: 'ld-saved-top' },
          el('span', { className: 'ld-saved-name' }, r.name),
          C.tag(statusText(st), st.tone),
          r.source === 'demo' ? el('span', { className: 'tag status status-live' }, t('leads.card.sample')) : null),
        el('p', { className: 'ld-saved-sub' }, facts.join(' · ')),
        r.address ? el('p', { className: 'ld-saved-sub' }, r.address) : null,
        el('div', { className: 'ld-links' },
          r.phone ? el('a', { className: 'ld-link tnum', href: `tel:${r.phone}` }, icon('phone', { size: 13 }), r.phone) : null,
          r.website ? el('a', { className: 'ld-link', href: r.website, target: '_blank', rel: 'noopener noreferrer' }, icon('arrowUpRight', { size: 13 }), String(r.website).replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)) : null),
      ),
      el('div', { className: 'ld-saved-nums' },
        el('span', { className: 'ld-saved-num' }, el('b', { className: 'tnum' }, r.score != null ? String(r.score) : '—'), el('span', {}, t('leads.card.score'))),
        el('span', { className: 'ld-saved-num' }, el('b', { className: 'tnum' }, r.est_value ? C.rupiahCompact(r.est_value) : '—'), el('span', {}, t('leads.saved.expected'))),
        el('time', { className: 'ld-saved-date tnum', datetime: r.created_at, title: C.formatDateTime(r.created_at) }, t('leads.saved.at', { when: C.relativeTime(r.created_at) }))),
      el('div', { className: 'ld-saved-actions' }, sel, ...actions),
    )
  }

  function savedToLead(r) {
    const m = r.meta || {}
    return {
      id: `saved:${r.id}`, savedId: r.id, source: r.source, source_id: r.source_id, name: r.name, category: r.category || 'Usaha',
      tags: m.tags || {}, lat: r.lat, lon: r.lon, address: r.address || '', phone: r.phone || '', website: r.website || '',
      distance_km: Number(r.distance_km) || 0, matched: m.matched || [],
      ai: { relevance: m.relevance ?? 0, reason: m.reason || '', suggested_service: m.suggested_service || '', keep: true, basis: m.basis || 'heuristik' },
      score: r.score ?? 0,
      estimate: estimateValue({ service: m.suggested_service, stats, fallbackAvg: state.fallbackAvg, conversion: state.conversion }),
    }
  }

  function leadRow(l, extra = {}) {
    return {
      source: l.source, source_id: l.source_id, name: l.name, category: l.category, address: l.address || null,
      phone: l.phone || null, website: l.website || null, lat: l.lat, lon: l.lon, distance_km: l.distance_km,
      score: l.score, est_value: l.estimate?.expected || null, status: 'baru', notes: null,
      meta_json: {
        relevance: l.ai.relevance, reason: l.ai.reason, suggested_service: l.ai.suggested_service, basis: l.ai.basis,
        potential: l.estimate?.potential || null, conversion: l.estimate?.conversion, value_basis: l.estimate?.basis,
        tags: l.tags, matched: l.matched,
        search: state.search ? { lat: state.search.center?.lat, lon: state.search.center?.lon, radius_km: state.search.radius_km, keywords: state.search.keywords } : null,
      },
      ...extra,
    }
  }

  async function saveLead(l, btn) {
    const restore = C.setBusy(btn, t('leads.common.saving'))
    try {
      const { error } = await getCloud().database.from('leads').insert(leadRow(l))
      if (error) throw new Error(error.message)
      restore()
      btn.disabled = true
      btn.classList.add('is-saved')
      btn.querySelector('.btn-label').textContent = t('leads.card.saved')
      btn.setAttribute('aria-label', t('leads.card.alreadySaved', { name: l.name }))
      btn.querySelector('svg')?.replaceWith(icon('check'))
      showToast(t('leads.save.done', { name: l.name }), 'success')
      await loadSaved()
    } catch (err) {
      restore()
      showToast(t('leads.save.failed', { error: err.message }), 'error')
    }
  }

  /* ========================================================= Offer modal */
  let modal = null
  onAbort(() => modal?.close({ restore: false }))

  async function openOffer(lead, opener) {
    await businessReady
    modal?.close({ restore: false })
    modal = offerModal(lead, opener)
  }

  function offerModal(lead, opener) {
    const svcOptions = [...new Set([lead.ai.suggested_service, ...names].filter(Boolean))]
    const svcSel = C.select({
      label: t('leads.offer.service'), name: 'service', required: true,
      options: svcOptions.length ? svcOptions.map((n) => ({ value: n, label: n })) : [{ value: '', label: t('leads.offer.noServices') }],
      value: lead.ai.suggested_service || svcOptions[0] || '',
    })
    const svcFree = C.field({ label: t('leads.offer.free'), name: 'service_free', placeholder: t('leads.offer.freePlaceholder'), hint: svcOptions.length ? t('leads.offer.freeHint') : t('leads.offer.freeHintEmpty') })
    const extra = C.textarea({ label: t('leads.offer.extra'), name: 'extra', rows: 3, placeholder: t('leads.offer.extraPlaceholder') })
    const estBox = el('div', { className: 'ld-est-box' })
    const service = () => svcFree.input.value.trim() || svcSel.input.value || ''
    const estimate = () => estimateValue({ service: service(), stats, fallbackAvg: state.fallbackAvg, conversion: state.conversion })
    const drawEst = () => {
      const e = estimate()
      estBox.replaceChildren(icon('ledger', { size: 14 }), el('span', {}, e.basis ? t('leads.offer.estimate', { amount: C.rupiah(e.potential), note: estNote(e, service()) }) : estNote(e, service())))
    }
    svcSel.input.addEventListener('change', drawEst)
    svcFree.input.addEventListener('input', drawEst)
    drawEst()

    const aiSlot = el('div', { className: 'ai-slot' })
    const reviewBox = el('div', { className: 'ld-review' })
    let draft = null
    let current = null
    let lastError = false
    let fields = null

    const leadSummary = C.miniPreview({
      title: lead.name,
      chips: [
        { icon: 'store', text: lead.category },
        { icon: 'mapPin', text: km(lead.distance_km) },
        lead.phone ? { icon: 'phone', text: lead.phone } : null,
      ],
      note: lead.ai.reason || undefined,
    })

    const wiz = C.wizard({
      label: t('leads.offer.wizard'),
      className: 'ld-wiz',
      steps: [
        {
          key: 'service', title: t('leads.offer.step1'), description: t('leads.offer.step1Desc'),
          content: [leadSummary, svcSel.wrap, svcFree.wrap, estBox, extra.wrap],
          validate: () => (service() ? [] : [{ text: t('leads.offer.needService'), input: svcFree.input }]),
        },
        {
          key: 'compose', title: t('leads.offer.step2'), description: t('leads.offer.step2Desc'),
          content: [aiSlot],
          primary: () => (draft && !current ? { label: t('leads.offer.next'), iconRight: 'arrowRight' } : { label: lastError ? t('leads.offer.retry') : t('leads.offer.draft'), icon: lastError ? 'refresh' : 'sparkles', iconRight: undefined }),
          onPrimary: async () => { if (draft) wiz.next(); else await generate() },
          onEnter: () => {
            if (current) return
            if (draft) aiSlot.replaceChildren(el('div', { className: 'note note-ok' }, icon('checkCircle'), el('div', { className: 'note-body' }, el('p', {}, t('leads.offer.ready')))))
            else if (!lastError) aiSlot.replaceChildren(el('div', { className: 'ai-placeholder' }, icon('sparkles', { size: 18 }), el('span', {}, t('leads.offer.placeholder'))))
          },
        },
        {
          key: 'review', title: t('leads.offer.step3'), description: t('leads.offer.step3Desc'),
          content: [reviewBox],
          primary: { label: t('leads.offer.saveFlow'), icon: 'save', iconRight: undefined },
          onPrimary: () => saveToFlow(),
          onEnter: () => drawReview(),
        },
      ],
    })

    async function generate() {
      wiz.msg.hide()
      if (!model) { try { await modelReady } catch { /* below */ } }
      if (!model) { wiz.msg.show('danger', t('leads.offer.noModel')); return }
      const ac = new AbortController()
      current = ac
      const restore = wiz.busy(t('leads.offer.composing'))
      const ui = C.aiConsole({ model: t('leads.offer.composer') })
      ui.onStop(() => ac.abort())
      ui.setStatus(t('leads.offer.writing'), true)
      ui.write('')
      aiSlot.replaceChildren(ui.root)
      let ok = false
      try {
        const res = await abortable(draftLeadOffer({
          lead, service: service(), estimate: estimate(), sender: ctx.user, extra: extra.input.value.trim(),
          modelId: model.id, signal: ac.signal, onChunk: (_d, full) => { if (!ac.signal.aborted) ui.write(full) },
        }), ac.signal)
        ui.done()
        if (!res.data) throw new Error(t('leads.offer.badFormat'))
        if (!(res.data.price > 0) && estimate().potential) res.data.price = estimate().potential
        draft = { ...res.data, raw: res.raw }
        fields = null
        lastError = false
        ui.setStatus(t('leads.offer.done'), false)
        ok = true
      } catch (err) {
        ui.done()
        lastError = true
        ui.setStatus(err.name === 'AbortError' ? t('leads.offer.stopped') : t('leads.offer.failed'), false)
        wiz.msg.show(err.name === 'AbortError' ? 'info' : 'danger', err.name === 'AbortError' ? t('leads.offer.stoppedMsg') : err.message)
      } finally {
        current = null
        restore()
      }
      if (ok && modal) wiz.go('review')
    }

    function drawReview() {
      if (!draft) { wiz.go('compose', { focus: false }); return }
      if (fields) return
      const subject = C.field({ label: t('leads.offer.subject'), name: 'subject', value: draft.subject })
      const pitch = C.textarea({ label: t('leads.offer.pitch'), name: 'pitch', rows: 6, value: draft.pitch, hint: t('leads.offer.pitchHint') })
      const copyBtn = C.button({ label: t('leads.offer.copy'), icon: 'copy', size: 'sm', variant: 'soft' })
      copyBtn.addEventListener('click', () => copyText(pitch.input.value))
      pitch.wrap.appendChild(el('div', { className: 'form-actions' }, copyBtn))
      const scope = C.textarea({ label: t('leads.offer.scope'), name: 'scope', rows: 3, value: draft.scope })
      const price = C.field({ label: t('leads.offer.price'), name: 'price', type: 'number', value: String(draft.price || ''), attrs: { min: '0', step: '1000', inputmode: 'numeric' } })
      const terms = C.textarea({ label: t('leads.offer.terms'), name: 'terms', rows: 2, value: draft.terms })
      const notes = C.textarea({ label: t('leads.offer.notes'), name: 'notes', rows: 2, value: draft.notes })
      const withOffer = el('input', { type: 'checkbox', id: 'ld-with-offer', checked: true })
      const checkRow = el('label', { className: 'ld-check', htmlFor: 'ld-with-offer' }, withOffer,
        el('span', {}, el('b', {}, t('leads.offer.withOffer')), el('span', { className: 'field-hint' }, t('leads.offer.withOfferHint'))))
      fields = { subject, pitch, scope, price, terms, notes, withOffer }
      reviewBox.replaceChildren(
        el('div', { className: 'proposal-top' }, el('span', { className: 'tag tag-accent' }, icon('sparkles', { size: 14 }), t('leads.offer.aiDraft')), el('span', { className: 'proposal-for' }, `${lead.name} — ${service()}`)),
        subject.wrap, pitch.wrap, scope.wrap, price.wrap, terms.wrap, notes.wrap, checkRow,
      )
    }

    async function saveToFlow() {
      if (!fields) return
      const o = {
        subject: fields.subject.input.value.trim(),
        pitch: fields.pitch.input.value.trim(),
        scope: fields.scope.input.value.trim(),
        price: Math.round(Number(fields.price.input.value) || 0),
        terms: fields.terms.input.value.trim(),
        notes: fields.notes.input.value.trim(),
      }
      const wantOffer = fields.withOffer.checked
      if (wantOffer) {
        const v = validateOffer(o)
        if (!v.valid) {
          wiz.invalid(v.errors.map((text) => ({ text, input: /harga/i.test(text) ? fields.price.input : /lingkup/i.test(text) ? fields.scope.input : /ketentuan/i.test(text) ? fields.terms.input : null })))
          return
        }
      }
      const restore = wiz.busy(t('leads.common.saving'))
      const db = getCloud().database
      try {
        const svc = service()
        const description = [
          `Prospek dari Pencari prospek (${SOURCE_LABEL[lead.source] || lead.source}): ${lead.category}, ${kmId(lead.distance_km)} dari titik pencarian.`,
          o.scope ? `Usulan: ${o.scope}` : '',
          lead.website ? `Situs: ${lead.website}` : '',
        ].filter(Boolean).join('\n')
        const { data: reqRows, error: reqErr } = await db.from('requests').insert({
          customer_name: lead.name.slice(0, 120),
          service_type: svc.slice(0, 120),
          location: (lead.address || `${lead.category}, ${Number(lead.lat).toFixed(5)}, ${Number(lead.lon).toFixed(5)}`).slice(0, 200),
          phone: lead.phone || null,
          description,
        })
        if (reqErr) throw new Error(reqErr.message)
        const reqRow = Array.isArray(reqRows) ? reqRows[0] : reqRows
        let offerRow = null
        if (wantOffer && reqRow?.id != null) {
          const { data: offRows, error: offErr } = await db.from('offers').insert({
            request_id: reqRow.id,
            ai_proposal_json: { scope: o.scope, price: o.price, terms: o.terms, notes: o.notes, subject: o.subject, pitch: o.pitch, origin: 'leads' },
            validated_price: o.price,
            validated_scope: o.scope,
            status: 'draft',
          })
          if (offErr) throw new Error(t('leads.offer.offerFailed', { error: offErr.message }))
          offerRow = Array.isArray(offRows) ? offRows[0] : offRows
        }
        // Keep the lead in sync (save it if it was not saved yet).
        const savedRec = lead.savedId != null ? saved?.find((r) => r.id === lead.savedId) : savedBySource.get(`${lead.source}|${lead.source_id}`)
        const metaExtra = { request_id: reqRow?.id ?? null, offer_id: offerRow?.id ?? null, offer_subject: o.subject }
        try {
          if (savedRec) {
            await db.from('leads').update({ status: 'penawaran', meta_json: { ...(savedRec.meta || {}), ...metaExtra } }).eq('id', savedRec.id)
          } else {
            const row = leadRow(lead, { status: 'penawaran' })
            row.meta_json = { ...row.meta_json, ...metaExtra }
            await db.from('leads').insert(row)
          }
        } catch { /* the request is what matters; the lead list refreshes below */ }
        restore()
        notifyDataChanged()
        await loadSaved()
        drawResults()
        const go = C.button({ label: offerRow ? t('leads.offer.openDraft') : t('leads.offer.toOffer'), iconRight: 'arrowRight', variant: 'primary', size: 'sm' })
        go.addEventListener('click', () => {
          modal?.close({ restore: false })
          navigate('offer', offerRow ? { offerId: offerRow.id } : { requestId: reqRow?.id })
        })
        const stay = C.button({ label: t('leads.offer.stay'), variant: 'soft', size: 'sm' })
        stay.addEventListener('click', () => modal?.close())
        wiz.complete({
          text: offerRow
            ? t('leads.offer.doneWithOffer', { name: lead.name, price: C.rupiah(o.price) })
            : t('leads.offer.doneRequest', { name: lead.name }),
          actions: [go, stay],
        })
        showToast(t('leads.offer.savedFlow'), 'success')
      } catch (err) {
        restore()
        wiz.msg.show('danger', t('leads.save.failed', { error: err.message }))
      }
    }

    /* Dialog chrome */
    const closeBtn = el('button', { type: 'button', className: 'icon-btn', 'aria-label': t('leads.modal.close'), title: t('leads.modal.closeTitle') }, icon('x'))
    const dialog = el('div', { className: 'ld-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ld-modal-title' },
      el('div', { className: 'ld-modal-head' },
        el('div', {},
          el('span', { className: 'drawer-pre' }, t('leads.modal.pre')),
          el('h2', { className: 'ld-modal-title display', id: 'ld-modal-title' }, t('leads.modal.titleStart'), el('em', {}, t('leads.modal.titleEm')))),
        closeBtn),
      el('div', { className: 'ld-modal-body' }, wiz.root),
    )
    const scrim = el('div', { className: 'ld-scrim' })
    const layer = el('div', { className: 'ld-modal-layer' }, scrim, dialog)
    // Inside .app-shell so the app's form styles (scoped to .app-shell) apply.
    ;(container.closest('.app-shell') || document.body).appendChild(layer)
    document.body.classList.add('scroll-lock')
    requestAnimationFrame(() => {
      layer.classList.add('is-open')
      const heading = dialog.querySelector('.wiz-pane:not([hidden]) .wiz-pane-title')
      ;(heading || closeBtn).focus()
    })

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close() }
      else if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    closeBtn.addEventListener('click', () => api.close())
    scrim.addEventListener('click', () => api.close())

    const api = {
      close({ restore = true } = {}) {
        current?.abort()
        document.removeEventListener('keydown', onKey, true)
        document.body.classList.remove('scroll-lock')
        layer.classList.remove('is-open')
        const finish = () => layer.remove()
        if (reducedMotion()) finish()
        else setTimeout(finish, 220)
        if (modal === api) modal = null
        if (restore && opener?.isConnected) opener.focus()
      },
    }
    return api
  }

  /* ============================================================= Layout */
  const searchPanel = tabPanels.get('search')
  searchPanel.appendChild(el('div', { className: 'ld-grid' },
    el('div', { className: 'ld-side' }, controlsPanel, historyBox),
    el('div', { className: 'ld-main' }, mapPanel, resultsPanel)))
  tabPanels.get('saved').appendChild(savedPanel)

  container.replaceChildren(header, el('div', { className: 'ld-wrap' }, tablist, ...tabPanels.values()))

  drawPointLine()
  drawChips()
  drawValueBox()
  drawSource()
  emptyResults()
  let startTab = 'search'
  try { startTab = sessionStorage.getItem(TAB_STORE) === 'saved' ? 'saved' : 'search' } catch { /* ignore */ }
  activate(startTab)

  sourcesReady.then(() => { if (!signal?.aborted) drawSource() })
  businessReady.then(() => { if (!signal?.aborted) { drawValueBox(); rescore() } })

  // Restore: a running job wins, otherwise the last stored search.
  setLeadsPageMounted(true)
  const onJob = (e) => { if (!signal?.aborted && e.detail?.owner === owner) syncJob(e.detail) }
  window.addEventListener(JOB_EVENT, onJob)
  onAbort(() => { window.removeEventListener(JOB_EVENT, onJob); setLeadsPageMounted(false) })
  const running = getLeadJob(owner)
  if (isJobRunning(running)) syncJob(running)
  else {
    const last = lastEntry(stored)
    if (last) showEntry(last)
    else drawHistory()
  }

  initMap()
  await loadSaved()
}

/**
 * Pertumbuhan — Penasihat AI.
 * A multi-agent business adviser grounded in the user's own data: the
 * snapshot and growth calculator below are computed client-side and sent to
 * the model as context, so advice quotes the user's real numbers.
 * Conversations live in localStorage (see ai/advisor.js). An answer that is
 * still streaming runs at module level, so it finishes and is saved even if
 * the user leaves the page; coming back re-attaches to it.
 */
import '../styles/advisor.css'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { resolveModel } from './offer.js'
import { getAgentParams } from './settings.js'
import { loadFlow } from './data.js'
import {
  AGENTS, AGENT_KEYS, AUTO, agentName, routeQuestion, describeRoute, buildMessages, toHistory,
  streamAnswer, loadMessages, saveMessage, deleteMessage, clearMessages, computeAnalytics,
} from '../ai/advisor.js'
import {
  buildSnapshot, snapshotToContext, growthProjection, projectionToContext, parseTargetPct,
  growthTier, GROWTH_PRESETS, rp, pct, pctPlain, fmtJobs,
} from '../ai/advisor-tools.js'

const { el, icon } = C
const SVGNS = 'http://www.w3.org/2000/svg'
const PREF_AGENT = 'satualur_advisor_agent'
const PREF_TARGET = 'satualur_advisor_target'
const SHOW_STEP = 20 // messages rendered per "Muat pesan sebelumnya" step
const PREF_TAB = 'satualur_advisor_tab'

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

const AUTO_AGENT = { name: 'Otomatis', role: 'Memilih penasihat sesuai pertanyaan', icon: 'wand' }
const AUTO_SUGGESTIONS = [
  'Bagaimana naik 2% bulan depan?',
  'Biaya mana yang paling bisa dihemat?',
  'Bagaimana membuat pelanggan kembali lagi?',
  'Pekerjaan mana yang tertahan paling lama?',
]
const viewMeta = (key) => (key === AUTO ? AUTO_AGENT : AGENTS[key])

/* -------------------------------------------------- Background answer */

let activeJob = null
const routes = new Map() // row id -> route info, kept across page visits

/** Streams one answer and stores it, independent of any mounted page. */
function startJob({ uid, view, agentKey, route, question, userRow, draft, request }) {
  const ac = new AbortController()
  const job = { uid, view, agentKey, route, question, userRow, draft, ac, full: '', done: false, outcome: null, listeners: new Set() }
  const emit = (type) => job.listeners.forEach((fn) => { try { fn(type) } catch (e) { console.error(e) } })
  activeJob = job
  job.promise = (async () => {
    let result = null
    let failure = null
    try {
      const gen = streamAnswer({ ...request, signal: ac.signal })
      for (;;) {
        const step = await gen.next()
        if (step.done) { result = step.value; break }
        if (step.value.type === 'delta') { job.full = step.value.full; emit('delta') }
        else if (step.value.type === 'retry') emit('retry')
      }
    } catch (err) {
      failure = err
    }
    const aborted = failure?.name === 'AbortError'
    let full = job.full
    if (!failure) {
      full = result.full || full
      if (!full.trim()) failure = new Error('Jawaban kosong. Coba tanyakan lagi.')
    }
    const base = { ...draft, model: request.model }
    let row = null
    if (!failure) row = { ...base, content: full, latency_ms: result.latency, error: null }
    else if (aborted) row = full.trim() ? { ...base, content: full, latency_ms: null, error: 'aborted' } : null
    else row = { ...base, content: failure.partial || full || '', latency_ms: failure.latency ?? null, error: String(failure.message || 'Gagal').slice(0, 300) }
    let unsaved = false
    if (row) {
      row.created_at = new Date().toISOString()
      try { Object.assign(row, await saveMessage(row, { uid })) } catch { row.id = `tmp-${Date.now()}`; unsaved = true }
      if (route) routes.set(row.id, route)
    }
    job.full = full
    job.outcome = { failure, aborted, row, unsaved }
    job.done = true
    if (activeJob === job) activeJob = null
    emit('done')
  })()
  return job
}

/* ------------------------------------------------------------ Markdown */

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu

/** Inline markdown -> array of strings/nodes (strings become text nodes). */
function inline(text) {
  const out = []
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2] != null) out.push(el('strong', {}, inline(m[2])))
    else if (m[3] != null) out.push(el('code', {}, m[3]))
    else out.push(el('em', {}, m[4] ?? m[5]))
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Small, safe markdown renderer: builds DOM nodes, never parses HTML. */
export function renderMarkdown(src) {
  const root = document.createDocumentFragment()
  const lines = String(src || '').replace(EMOJI_RE, '').replace(/\r\n?/g, '\n').split('\n')
  let para = []
  let list = null
  const flushPara = () => {
    if (!para.length) return
    root.append(el('p', {}, para.map((t, i) => (i ? [el('br'), ...inline(t)] : inline(t)))))
    para = []
  }
  const flushList = () => { if (list) root.append(list.node); list = null }
  const flush = () => { flushPara(); flushList() }
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    let m
    if (/^```/.test(line)) {
      flush()
      const buf = []
      for (i++; i < lines.length && !/^```/.test(lines[i].trim()); i++) buf.push(lines[i])
      root.append(el('pre', {}, el('code', {}, buf.join('\n'))))
      continue
    }
    if (!line) { flush(); continue }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush()
      root.append(el(m[1].length <= 3 ? 'h3' : 'h4', {}, inline(m[2].replace(/\s#+$/, ''))))
      continue
    }
    if (/^([-*_])(\s*\1){2,}$/.test(line)) { flush(); root.append(el('hr')); continue }
    if (line.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush()
      const head = cells(line)
      const body = []
      for (i += 1; i + 1 < lines.length && lines[i + 1].trim().startsWith('|'); ) body.push(cells(lines[++i]))
      root.append(el('div', { className: 'md-table' }, el('table', {},
        el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, inline(h))))),
        el('tbody', {}, body.map((r) => el('tr', {}, r.map((c) => el('td', {}, inline(c)))))),
      )))
      continue
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      const li = list.node.lastElementChild
      const sub = line.match(/^(?:[-*•+]|\d{1,3}[.)])\s+(.*)$/)
      if (sub) {
        let ul = li.querySelector(':scope > ul')
        if (!ul) { ul = el('ul'); li.append(ul) }
        ul.append(el('li', {}, inline(sub[1])))
      } else li.append(el('br'), ...inline(line))
      continue
    }
    if ((m = line.match(/^[-*•+]\s+(.*)$/))) {
      flushPara()
      if (list?.type !== 'ul') { flushList(); list = { type: 'ul', node: el('ul') } }
      list.node.append(el('li', {}, inline(m[1])))
      continue
    }
    if ((m = line.match(/^(\d{1,3})[.)]\s+(.*)$/))) {
      flushPara()
      if (list?.type !== 'ol') { flushList(); list = { type: 'ol', node: el('ol', m[1] !== '1' ? { start: m[1] } : {}) } }
      list.node.append(el('li', {}, inline(m[2])))
      continue
    }
    flushList()
    para.push(line)
  }
  flush()
  return root
}

/* ---------------------------------------------------------------- Format */

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const clock = (v) => C.toDate(v)?.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) || ''
function dayLabel(d) {
  const now = new Date()
  if (sameDay(d, now)) return 'Hari ini'
  if (sameDay(d, new Date(now.getTime() - 86400000))) return 'Kemarin'
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
const seconds = (ms) => (ms == null ? '' : `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`)

/* ================================================================ Render */

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const savedView = store.get(PREF_AGENT)
  const uid = ctx.user?.id || null
  const running = activeJob && activeJob.uid === uid && !activeJob.done ? activeJob : null
  let view = running ? running.view : savedView === AUTO || AGENTS[savedView] ? savedView : AUTO
  let rows = []
  let snap = null
  let model = null
  let busy = false
  let current = null
  let lastAuto = null
  let showCount = SHOW_STEP

  /* ------------------------------------------------------------ Header */
  const modelPill = el('span', { className: 'date-pill adv-model-pill', hidden: true }, icon('bot', { size: 15 }), el('span', {}, 'AI sedang tidak tersedia'))
  const header = C.pageHeader({ title: 'Penasihat bisnis', actions: modelPill })

  /* ------------------------------------------------------ Agent picker */
  const agentButtons = new Map()
  const agentCounts = new Map()
  const agentList = el('div', { className: 'adv-agent-list', role: 'listbox', id: 'adv-agent-list', 'aria-label': 'Pilih penasihat' })
  for (const key of [AUTO, ...AGENT_KEYS]) {
    const meta = viewMeta(key)
    const count = el('span', { className: 'adv-agent-count tnum', hidden: true })
    const b = el('button', { type: 'button', role: 'option', className: `adv-agent ${key === AUTO ? 'is-auto' : ''}`.trim(), dataset: { agent: key } },
      el('span', { className: 'adv-agent-ico', 'aria-hidden': 'true' }, icon(meta.icon, { size: 17 })),
      el('span', { className: 'adv-agent-text' },
        el('span', { className: 'adv-agent-name' }, meta.name),
        el('span', { className: 'adv-agent-role' }, meta.role),
      ),
      count,
    )
    b.addEventListener('click', () => { selectView(key); closePicker({ focus: true }) })
    agentButtons.set(key, b)
    agentCounts.set(key, count)
    agentList.append(b)
  }
  const chatIco = el('span', { className: 'adv-chat-ico', 'aria-hidden': 'true' })
  const chatName = el('span', { className: 'adv-chat-name', id: 'adv-chat-title' })
  const chatRole = el('span', { className: 'adv-chat-role' })
  const pickerBtn = el('button', {
    type: 'button', className: 'adv-agent-trigger', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': 'adv-agent-list',
    title: 'Ganti penasihat',
  },
  chatIco,
  el('span', { className: 'adv-trigger-text' },
    el('span', { className: 'adv-trigger-kicker' }, 'Penasihat'),
    el('span', { className: 'adv-trigger-name' }, chatName, icon('chevronDown', { size: 16, className: 'adv-trigger-chev' })),
  ))
  const pickerPop = el('div', { className: 'adv-agent-pop', hidden: true },
    el('p', { className: 'adv-pop-head' }, 'Pilih penasihat', el('span', {}, 'Otomatis memilih sesuai pertanyaan')),
    agentList)
  const picker = el('div', { className: 'adv-picker' }, pickerBtn, pickerPop)
  const optionKeys = [AUTO, ...AGENT_KEYS]
  function openPicker() {
    if (!pickerPop.hidden) return
    pickerPop.hidden = false
    pickerBtn.setAttribute('aria-expanded', 'true')
    picker.classList.add('is-open')
    agentButtons.get(view)?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside, true)
  }
  function closePicker({ focus = false } = {}) {
    if (pickerPop.hidden) return
    pickerPop.hidden = true
    pickerBtn.setAttribute('aria-expanded', 'false')
    picker.classList.remove('is-open')
    document.removeEventListener('pointerdown', outside, true)
    if (focus) pickerBtn.focus({ preventScroll: true })
  }
  function outside(e) { if (!picker.contains(e.target)) closePicker() }
  ctx.signal?.addEventListener('abort', () => document.removeEventListener('pointerdown', outside, true))
  pickerBtn.addEventListener('click', () => (pickerPop.hidden ? openPicker() : closePicker()))
  pickerBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openPicker() }
  })
  pickerPop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker({ focus: true }); return }
    if (e.key === 'Tab') { closePicker(); return }
    const dir = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    const cur = optionKeys.indexOf(document.activeElement?.dataset?.agent)
    if (dir) { e.preventDefault(); agentButtons.get(optionKeys[(Math.max(0, cur) + dir + optionKeys.length) % optionKeys.length]).focus() }
    else if (e.key === 'Home') { e.preventDefault(); agentButtons.get(optionKeys[0]).focus() }
    else if (e.key === 'End') { e.preventDefault(); agentButtons.get(optionKeys.at(-1)).focus() }
  })

  /* ---------------------------------------------------------- Snapshot */
  const snapBody = el('div', { className: 'adv-snap-body' }, C.skeleton({ lines: 4 }))

  /* -------------------------------------------------------- Calculator */
  let target = Number(store.get(PREF_TARGET)) || 2
  const presetWrap = el('div', { className: 'adv-presets', role: 'radiogroup', 'aria-label': 'Target pertumbuhan per bulan' })
  const presetBtns = GROWTH_PRESETS.map((p) => {
    const b = el('button', { type: 'button', role: 'radio', className: 'adv-preset', dataset: { pct: String(p) } }, `${p}%`)
    b.addEventListener('click', () => setTarget(p))
    presetWrap.append(b)
    return b
  })
  presetWrap.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!dir) return
    e.preventDefault()
    const i = Math.max(0, GROWTH_PRESETS.indexOf(target))
    const next = GROWTH_PRESETS[(i + dir + GROWTH_PRESETS.length) % GROWTH_PRESETS.length]
    setTarget(next)
    presetBtns[GROWTH_PRESETS.indexOf(next)].focus()
  })
  const customField = C.field({ label: 'Target lain', name: 'adv_target', type: 'number', value: String(target), attrs: { min: '0.1', max: '50', step: '0.1', inputmode: 'decimal', 'aria-label': 'Target pertumbuhan per bulan dalam persen' } })
  const baseField = C.field({ label: 'Pendapatan per bulan', name: 'adv_base', type: 'number', hint: 'Memuat…', attrs: { min: '0', step: '100000', inputmode: 'numeric' } })
  const jobField = C.field({ label: 'Nilai per pekerjaan', name: 'adv_job', type: 'number', hint: 'Memuat…', attrs: { min: '0', step: '50000', inputmode: 'numeric' } })
  const calcOut = el('div', { className: 'adv-calc-out', 'aria-live': 'polite' })
  const askCalcBtn = C.button({ label: 'Tanya cara mencapainya', icon: 'message', variant: 'soft', size: 'sm' })
  const calcBody = el('div', { className: 'adv-calc' },
    el('div', { className: 'adv-calc-target' },
      el('span', { className: 'field-label', id: 'adv-target-label' }, 'Target per bulan'),
      el('div', { className: 'adv-target-row' }, presetWrap, el('div', { className: 'adv-custom' }, customField.input, el('span', { className: 'adv-custom-unit', 'aria-hidden': 'true' }, '%'))),
    ),
    el('div', { className: 'adv-calc-inputs' }, baseField.wrap, jobField.wrap),
    calcOut,
    el('div', { className: 'form-actions' }, askCalcBtn),
  )
  customField.wrap.querySelector('label')?.classList.add('sr-only')

  /* ------------------------------------------------------------- Stats */
  const statsBody = el('div', {}, C.skeleton({ lines: 2 }))

  /* -------------------------------------------------- Side panel (tabs) */
  const TABS = [
    { key: 'snapshot', label: 'Snapshot', icon: 'chart', meta: 'Angka bisnis yang dibaca AI sebagai konteks', body: el('div', { className: 'adv-snap' }, snapBody) },
    { key: 'calc', label: 'Kalkulator', icon: 'calculator', meta: 'Target pertumbuhan majemuk per bulan', body: calcBody },
    { key: 'stats', label: 'Statistik', icon: 'activity', meta: 'Dari riwayat tersimpan di akun Anda', body: el('div', { className: 'adv-stats' }, statsBody) },
  ]
  const savedTab = store.get(PREF_TAB)
  let tab = TABS.some((t) => t.key === savedTab) ? savedTab : 'snapshot'
  const tabBtns = new Map()
  const tabPanes = new Map()
  const tabList = el('div', { className: 'adv-tabs', role: 'tablist', 'aria-label': 'Data dan alat penasihat' })
  const sideMeta = el('p', { className: 'adv-side-meta' })
  for (const t of TABS) {
    const b = el('button', { type: 'button', role: 'tab', className: 'adv-tab', id: `adv-tab-${t.key}`, 'aria-controls': `adv-pane-${t.key}`, dataset: { tab: t.key } },
      icon(t.icon, { size: 15 }), el('span', {}, t.label))
    b.addEventListener('click', () => selectTab(t.key))
    tabBtns.set(t.key, b)
    tabList.append(b)
    tabPanes.set(t.key, el('div', { className: 'adv-pane', role: 'tabpanel', id: `adv-pane-${t.key}`, 'aria-labelledby': `adv-tab-${t.key}`, tabindex: '0', dataset: { pane: t.key } }, t.body))
  }
  tabList.addEventListener('keydown', (e) => {
    const keys = TABS.map((t) => t.key)
    const i = keys.indexOf(tab)
    const next = { ArrowRight: keys[(i + 1) % keys.length], ArrowLeft: keys[(i - 1 + keys.length) % keys.length], Home: keys[0], End: keys.at(-1) }[e.key]
    if (!next) return
    e.preventDefault()
    selectTab(next)
    tabBtns.get(next).focus()
  })
  function selectTab(key) {
    tab = key
    store.set(PREF_TAB, key)
    for (const t of TABS) {
      const on = t.key === key
      const b = tabBtns.get(t.key)
      b.setAttribute('aria-selected', on ? 'true' : 'false')
      b.tabIndex = on ? 0 : -1
      tabPanes.get(t.key).hidden = !on
      if (on) sideMeta.textContent = t.meta
    }
    tabPanes.get(key).scrollTop = 0
  }
  const side = el('section', { className: 'panel adv-side', id: 'adv-side', 'aria-label': 'Snapshot, kalkulator, dan statistik' },
    el('div', { className: 'adv-side-head' }, tabList, sideMeta),
    el('div', { className: 'adv-side-body' }, [...tabPanes.values()]),
  )
  selectTab(tab)

  /* -------------------------------------------------------------- Chat */
  const jumpBtn = C.button({ label: 'Data & kalkulator', icon: 'calculator', variant: 'soft', size: 'sm', className: 'adv-side-jump', 'aria-controls': 'adv-side', 'aria-label': 'Data & kalkulator', title: 'Snapshot, kalkulator, dan statistik' })
  jumpBtn.addEventListener('click', () => {
    side.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    tabBtns.get(tab).focus({ preventScroll: true })
  })
  const clearBtn = C.button({ label: 'Hapus percakapan', icon: 'trash', variant: 'ghost', size: 'sm', className: 'adv-clear' })
  const log = el('div', { className: 'adv-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Percakapan dengan penasihat', tabindex: '0' })
  const status = el('p', { className: 'sr-only', role: 'status', 'aria-live': 'polite' })
  const chips = el('div', { className: 'adv-chips', role: 'group', 'aria-label': 'Pertanyaan saran' })
  const input = el('textarea', {
    className: 'adv-input', rows: '1', id: 'adv-question', name: 'adv_question',
    placeholder: 'Tanyakan strategi atau target…', 'aria-label': 'Pertanyaan untuk penasihat', maxlength: '2000',
  })
  const sendBtn = el('button', { type: 'submit', className: 'adv-send', 'aria-label': 'Kirim pertanyaan', title: 'Kirim (Enter)' }, icon('send', { size: 18 }))
  const stopBtn = el('button', { type: 'button', className: 'adv-stop', hidden: true }, icon('stop', { size: 15 }), el('span', {}, 'Hentikan'))
  const routeHint = el('span', { className: 'adv-route-hint' })
  const composer = el('form', { className: 'adv-composer', novalidate: true },
    el('div', { className: 'adv-input-wrap' }, input, stopBtn, sendBtn),
    el('div', { className: 'adv-composer-foot' },
      routeHint,
      el('span', { className: 'adv-kbd' }, el('kbd', {}, 'Enter'), ' kirim · ', el('kbd', {}, 'Shift'), '+', el('kbd', {}, 'Enter'), ' baris baru'),
    ),
  )
  const chat = el('section', { className: 'panel is-raised adv-chat', 'aria-labelledby': 'adv-chat-title' },
    el('div', { className: 'adv-chat-head' },
      picker,
      el('div', { className: 'adv-chat-title' }, chatRole),
      jumpBtn,
      clearBtn,
    ),
    log,
    el('div', { className: 'adv-chat-foot' }, chips, composer),
    status,
  )

  container.replaceChildren(
    header,
    el('div', { className: 'adv-grid' }, chat, side),
  )

  /* ============================================================ Logic */

  const viewRows = () => (view === AUTO ? rows : rows.filter((r) => r.agent === view))

  function selectView(key) {
    if (busy && key !== view) { showToast('Tunggu jawaban selesai atau hentikan dulu.', 'info'); return }
    if (key !== view) showCount = SHOW_STEP
    view = key
    store.set(PREF_AGENT, key)
    syncAgents()
    renderThread()
    syncRouteHint()
  }

  function syncAgents() {
    for (const [key, b] of agentButtons) {
      const on = key === view
      b.setAttribute('aria-selected', on ? 'true' : 'false')
      b.classList.toggle('is-active', on)
    }
    const meta = viewMeta(view)
    chatIco.replaceChildren(icon(meta.icon, { size: 18 }))
    chatName.textContent = meta.name
    chatRole.textContent = view === AUTO ? 'Pertanyaan diarahkan ke penasihat yang paling cocok' : meta.role
    pickerBtn.setAttribute('aria-label', `Penasihat: ${meta.name}. Ganti penasihat`)
    for (const [key, countEl] of agentCounts) {
      const n = (key === AUTO ? rows : rows.filter((r) => r.agent === key)).filter((r) => r.role === 'user').length
      countEl.hidden = n === 0
      countEl.textContent = String(n)
      countEl.title = `${n} pertanyaan`
    }
    const has = viewRows().length > 0
    clearBtn.disabled = busy || !has
    clearBtn.hidden = !has
  }

  function syncRouteHint() {
    const text = input.value.trim()
    if (view !== AUTO) {
      routeHint.replaceChildren(icon(AGENTS[view].icon, { size: 13 }), el('span', {}, `Dijawab oleh ${AGENTS[view].name}`))
      return
    }
    if (!text) {
      routeHint.replaceChildren(icon('wand', { size: 13 }), el('span', {}, 'Penasihat dipilih otomatis'))
      return
    }
    const r = routeQuestion(text, { lastAgent: lastAuto })
    routeHint.replaceChildren(icon(AGENTS[r.key].icon, { size: 13 }), el('span', {}, `Akan dijawab: ${AGENTS[r.key].name}`))
  }

  /* ------------------------------------------------------------ Thread */
  function suggestionsFor(key) {
    if (key === AUTO) return AUTO_SUGGESTIONS
    const own = AGENTS[key].suggestions
    return key === 'pertumbuhan' ? own : [...own, 'Bagaimana naik 2% bulan depan?']
  }

  function renderChips() {
    const list = suggestionsFor(view)
    const show = viewRows().length > 0
    chips.hidden = !show
    chips.replaceChildren(...list.map((q) => {
      const b = el('button', { type: 'button', className: 'adv-chip' }, q)
      b.addEventListener('click', () => ask(q))
      return b
    }))
  }

  function emptyThread() {
    const meta = viewMeta(view)
    const cards = suggestionsFor(view).slice(0, 4).map((q) => {
      const b = el('button', { type: 'button', className: 'adv-suggest' }, el('span', {}, q), icon('arrowUpRight', { size: 15 }))
      b.addEventListener('click', () => ask(q))
      return b
    })
    return el('div', { className: 'adv-empty' },
      el('span', { className: 'adv-empty-ico', 'aria-hidden': 'true' }, icon(meta.icon, { size: 22 })),
      el('p', { className: 'adv-empty-title display' }, C.displayTitle(view === AUTO ? 'Apa yang ingin Anda tumbuhkan?' : `Tanya ${meta.name.toLowerCase()}`, view === AUTO ? 'tumbuhkan' : meta.name.toLowerCase())),
      el('p', { className: 'adv-empty-body' }, snap && !snap.hasData
        ? 'Data bisnis Anda belum ada, jadi saran awal bersifat umum. Setelah permintaan dan jurnal tercatat, jawaban akan memakai angka Anda.'
        : 'Jawaban memakai snapshot bisnis Anda: pendapatan, biaya, konversi, dan pekerjaan tertunda. Percakapan tersimpan di perangkat ini.'),
      el('div', { className: 'adv-suggests' }, cards),
    )
  }

  function daySep(d) {
    return el('div', { className: 'adv-day', role: 'separator' }, el('span', {}, dayLabel(d)))
  }

  function userMsg(row) {
    return el('div', { className: 'adv-msg is-user', dataset: { id: String(row.id ?? '') } },
      el('div', { className: 'adv-bubble' }, row.content),
      el('span', { className: 'adv-time tnum' }, el('time', { datetime: row.created_at }, clock(row.created_at))),
    )
  }

  function assistantMsg(row, { route, streaming = false } = {}) {
    const meta = AGENTS[row.agent] || AGENTS.konsultan
    const body = el('div', { className: 'adv-bubble md' })
    const foot = el('div', { className: 'adv-msg-foot' })
    const badge = el('span', { className: 'adv-badge' }, icon(meta.icon, { size: 13 }), el('span', {}, meta.name))
    const routeNote = route ? el('span', { className: 'adv-route', title: describeRoute(route) }, describeRoute(route)) : null
    const node = el('article', { className: 'adv-msg is-assistant', 'aria-label': `Jawaban ${meta.name}` },
      el('div', { className: 'adv-msg-head' }, badge, routeNote,
        el('time', { className: 'adv-time tnum', datetime: row.created_at }, clock(row.created_at))),
      body,
      foot,
    )
    const api = {
      node, body, foot,
      setText(text, { caret = false } = {}) {
        body.replaceChildren(renderMarkdown(text))
        if (caret) (body.lastElementChild || body).append(el('span', { className: 'caret', 'aria-hidden': 'true' }))
      },
      typing(label = 'Menyusun jawaban') {
        body.replaceChildren(el('span', { className: 'adv-typing' },
          el('span', { className: 'adv-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
          el('span', {}, label)))
      },
      finish(r) {
        node.removeAttribute('aria-busy')
        const parts = []
        if (r.error === 'aborted') parts.push(el('span', { className: 'adv-flag' }, icon('stop', { size: 12 }), 'Dihentikan'))
        else if (r.error) parts.push(el('span', { className: 'adv-flag is-bad', title: r.error }, icon('alert', { size: 12 }), 'Terputus'))
        if (r.latency_ms && r.error !== 'aborted') parts.push(el('span', { className: 'tnum' }, seconds(r.latency_ms)))
        foot.replaceChildren(...parts.flatMap((p, i) => (i ? [el('span', { className: 'adv-sep', 'aria-hidden': 'true' }, '·'), p] : [p])))
        foot.hidden = parts.length === 0
      },
      fail(message, onRetry) {
        node.removeAttribute('aria-busy')
        node.classList.add('is-error')
        const retry = onRetry ? C.button({ label: 'Coba lagi', icon: 'refresh', size: 'sm', variant: 'soft' }) : null
        retry?.addEventListener('click', onRetry)
        body.replaceChildren(el('div', { className: 'adv-error' }, icon('alert', { size: 16 }),
          el('div', {}, el('p', {}, 'Penasihat gagal menjawab.'), el('p', { className: 'adv-error-detail' }, message), retry)))
        foot.hidden = true
      },
    }
    if (streaming) node.setAttribute('aria-busy', 'true')
    else if (row.error && row.error !== 'aborted' && !String(row.content || '').trim()) api.fail(row.error)
    else { api.setText(row.content); api.finish(row) }
    return api
  }

  function olderButton(hiddenCount) {
    const n = Math.min(SHOW_STEP, hiddenCount)
    const b = el('button', { type: 'button', className: 'adv-older' }, icon('arrowUp', { size: 14 }),
      el('span', {}, `Muat pesan sebelumnya`), el('span', { className: 'adv-older-n tnum' }, hiddenCount > n ? `${n} dari ${hiddenCount} lagi` : `${hiddenCount} lagi`))
    b.addEventListener('click', () => {
      const before = log.scrollHeight - log.scrollTop
      showCount += SHOW_STEP
      renderThread({ keepScroll: true })
      log.scrollTop = log.scrollHeight - before
      const again = log.querySelector('.adv-older')
      const first = log.querySelector('.adv-msg')
      if (again) again.focus({ preventScroll: true })
      else if (first) { first.tabIndex = -1; first.focus({ preventScroll: true }) }
      status.textContent = `${n} pesan sebelumnya dimuat.`
    })
    return b
  }

  function renderThread({ keepScroll = false } = {}) {
    const all = viewRows()
    const list = all.slice(-showCount)
    renderChips()
    syncAgents()
    if (!list.length) { log.replaceChildren(emptyThread()); log.classList.add('is-empty'); return }
    log.classList.remove('is-empty')
    const nodes = []
    if (all.length > list.length) nodes.push(olderButton(all.length - list.length))
    let prevDay = null
    for (const r of list) {
      const d = C.toDate(r.created_at)
      if (d && (!prevDay || !sameDay(d, prevDay))) { nodes.push(daySep(d)); prevDay = d }
      nodes.push(r.role === 'user' ? userMsg(r) : assistantMsg(r, { route: routes.get(r.id) }).node)
    }
    log.replaceChildren(...nodes)
    if (!keepScroll) log.scrollTop = log.scrollHeight
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120
  const appendToLog = (node) => {
    if (log.classList.contains('is-empty')) { log.replaceChildren(); log.classList.remove('is-empty') }
    const times = log.querySelectorAll('.adv-msg time')
    const last = times[times.length - 1]
    const lastDay = last ? C.toDate(last.getAttribute('datetime')) : null
    if (!lastDay || !sameDay(lastDay, new Date())) log.append(daySep(new Date()))
    log.append(node)
    log.scrollTop = log.scrollHeight
  }

  /* --------------------------------------------------------------- Ask */
  function setBusy(on) {
    busy = on
    sendBtn.hidden = on
    stopBtn.hidden = !on
    input.setAttribute('aria-busy', on ? 'true' : 'false')
    chips.querySelectorAll('button').forEach((b) => { b.disabled = on })
    log.querySelectorAll('.adv-suggest').forEach((b) => { b.disabled = on })
    clearBtn.disabled = on || !viewRows().length
    askCalcBtn.disabled = on
  }

  function contextFor(agentKey, question) {
    const parts = [snap ? snapshotToContext(snap) : '[DATA BISNIS PENGGUNA] Data gagal dimuat; beri saran umum dan jangan menyebut angka.']
    const asked = parseTargetPct(question)
    const growthy = agentKey === 'pertumbuhan' || agentKey === 'konsultan' || asked != null || /target|tumbuh|naik/i.test(question)
    if (growthy) {
      const { base, job } = calcInputs()
      if (asked != null && asked !== target) parts.push(projectionToContext(growthProjection({ base, pct: asked, avgJob: job }), { source: 'target dari pertanyaan' }))
      parts.push(projectionToContext(growthProjection({ base, pct: target, avgJob: job }), { source: 'kalkulator di halaman' }))
    }
    return parts.join('\n\n')
  }

  async function ask(text, { agentKey: forced, userRow: existingUser } = {}) {
    const question = String(text || '').trim()
    if (!question || busy) return
    setBusy(true)

    await dataReady
    if (!model) {
      try { model = await modelReady } catch { /* handled below */ }
    }
    const route = forced ? null : view === AUTO ? routeQuestion(question, { lastAgent: lastAuto }) : null
    const agentKey = forced || (route ? route.key : view)
    if (route) lastAuto = agentKey

    // 1. User turn: stored right away so it survives leaving the page.
    let userRow = existingUser
    if (!userRow) {
      userRow = { id: `tmp-${Date.now()}`, agent: agentKey, role: 'user', content: question, created_at: new Date().toISOString() }
      rows.push(userRow)
      appendToLog(userMsg(userRow))
      try { Object.assign(userRow, await saveMessage(userRow, { uid })) } catch { userRow.unsaved = true }
    }
    input.value = ''
    autosize()
    syncRouteHint()
    syncAgents()

    // 2. Assistant turn.
    const history = toHistory((view === AUTO ? rows : rows.filter((r) => r.agent === agentKey)).filter((r) => r !== userRow))
    const draft = { agent: agentKey, role: 'assistant', content: '', created_at: new Date().toISOString() }
    const ui = assistantMsg(draft, { route, streaming: true })
    ui.typing()
    appendToLog(ui.node)
    status.textContent = `${agentName(agentKey)} sedang menyusun jawaban.`

    if (!model) {
      ui.fail('AI sedang tidak tersedia. Periksa koneksi lalu muat ulang halaman.')
      setBusy(false)
      return
    }

    const params = getAgentParams()
    const job = startJob({
      uid, view, agentKey, route, question, userRow, draft,
      request: {
        messages: buildMessages({ agentKey, context: contextFor(agentKey, question), history, question }),
        model: model.id,
        temperature: AGENTS[agentKey].temperature,
        maxTokens: Math.min(params.maxTokens || 1500, 2048),
      },
    })
    attach(job, ui)
  }

  /** Follows a running answer on this page; detaches when the page unmounts. */
  function attach(job, ui) {
    setBusy(true)
    current = job.ac
    let frame = 0
    const paint = () => {
      frame = 0
      const stick = nearBottom()
      ui.setText(job.full, { caret: true })
      if (stick) log.scrollTop = log.scrollHeight
    }
    const onEvent = (type) => {
      if (ctx.signal?.aborted) return
      if (type === 'delta') { if (!frame) frame = requestAnimationFrame(paint) }
      else if (type === 'retry') {
        ui.typing('Koneksi terputus, mencoba sekali lagi')
        status.textContent = 'Koneksi terputus, mencoba sekali lagi.'
      } else if (type === 'done') {
        job.listeners.delete(onEvent)
        if (frame) cancelAnimationFrame(frame)
        finishJob(job, ui)
      }
    }
    job.listeners.add(onEvent)
    ctx.signal?.addEventListener('abort', () => {
      job.listeners.delete(onEvent)
      if (frame) cancelAnimationFrame(frame)
    })
    if (job.done) onEvent('done')
  }

  function finishJob(job, ui) {
    const { failure, aborted, row, unsaved } = job.outcome
    const stickEnd = nearBottom()
    const name = agentName(job.agentKey)
    if (!failure) {
      ui.setText(row.content)
      status.textContent = `Jawaban ${name} selesai.`
    } else if (aborted) {
      if (row) ui.setText(row.content)
      else ui.node.remove()
      status.textContent = 'Jawaban dihentikan.'
    } else {
      if (row.content) {
        ui.setText(row.content)
        ui.node.classList.add('is-error')
      } else {
        ui.fail(failure.message, async () => {
          ui.node.remove()
          rows = rows.filter((r) => r !== row)
          await deleteMessage(row.id, { uid })
          ask(job.question, { agentKey: job.agentKey, userRow: job.userRow })
        })
      }
      status.textContent = 'Penasihat gagal menjawab.'
    }
    if (row) {
      rows.push(row)
      if (!failure || aborted || row.content) ui.finish(row)
    }
    if (unsaved || job.userRow.unsaved) showToast('Percakapan tidak tersimpan di perangkat ini.', 'error')
    if (stickEnd) log.scrollTop = log.scrollHeight

    if (current === job.ac) current = null
    setBusy(false)
    syncAgents()
    renderChips()
    renderStats()
    if (!job.ac.signal.aborted && document.activeElement === document.body) input.focus()
  }

  /* ---------------------------------------------------------- Composer */
  function autosize() {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`
  }
  input.addEventListener('input', () => { autosize(); syncRouteHint() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      composer.requestSubmit()
    }
  })
  composer.addEventListener('submit', (e) => {
    e.preventDefault()
    if (busy) return
    if (!input.value.trim()) { input.focus(); return }
    ask(input.value)
  })
  stopBtn.addEventListener('click', () => { current?.abort(); input.focus() })

  let armed = 0
  clearBtn.addEventListener('click', async () => {
    if (busy) return
    const label = clearBtn.querySelector('.btn-label')
    if (!armed) {
      label.textContent = 'Klik lagi untuk hapus'
      clearBtn.classList.add('is-armed')
      armed = setTimeout(() => { armed = 0; label.textContent = 'Hapus percakapan'; clearBtn.classList.remove('is-armed') }, 4000)
      return
    }
    clearTimeout(armed)
    armed = 0
    clearBtn.classList.remove('is-armed')
    const keys = view === AUTO ? AGENT_KEYS : [view]
    const restore = C.setBusy(clearBtn, 'Menghapus…')
    try {
      await clearMessages(keys, { uid })
      rows = rows.filter((r) => !keys.includes(r.agent))
      if (view === AUTO) lastAuto = null
      restore()
      label.textContent = 'Hapus percakapan'
      renderThread()
      renderStats()
      showToast(view === AUTO ? 'Semua percakapan penasihat dihapus.' : `Percakapan ${AGENTS[view].name} dihapus.`, 'success')
      input.focus()
    } catch (err) {
      restore()
      label.textContent = 'Hapus percakapan'
      showToast(`Gagal menghapus: ${err.message}`, 'error')
    }
  })

  /* -------------------------------------------------------- Calculator */
  function calcInputs() {
    return { base: Number(baseField.input.value) || 0, job: Number(jobField.input.value) || 0 }
  }

  function setTarget(p) {
    const v = Math.round(Number(p) * 10) / 10
    if (!(v > 0)) return
    target = Math.min(v, 50)
    store.set(PREF_TARGET, String(target))
    if (Number(customField.input.value) !== target) customField.input.value = String(target)
    drawCalc()
  }
  customField.input.addEventListener('input', () => {
    const v = Number(customField.input.value)
    if (v > 0 && v <= 50) { target = Math.round(v * 10) / 10; store.set(PREF_TARGET, String(target)); drawCalc() }
  })
  baseField.input.addEventListener('input', drawCalc)
  jobField.input.addEventListener('input', drawCalc)
  askCalcBtn.addEventListener('click', () => {
    const { base } = calcInputs()
    ask(base > 0
      ? `Bagaimana cara mencapai pertumbuhan ${pctPlain(target)} per bulan dari pendapatan ${rp(base)} per bulan?`
      : `Bagaimana cara mencapai pertumbuhan ${pctPlain(target)} per bulan?`)
  })

  function projectionChart(proj) {
    const W = 320
    const H = 112
    const pad = 6
    const presets = [...new Set([...GROWTH_PRESETS, proj.pct])]
    const maxPct = Math.max(...presets)
    const yMax = proj.base * Math.pow(1 + maxPct / 100, 12) * 1.04
    const x = (m) => pad + (m / 12) * (W - pad * 2)
    const y = (v) => H - pad - (v / yMax) * (H - pad * 2)
    const line = (p) => Array.from({ length: 13 }, (_, m) => `${m ? 'L' : 'M'}${x(m).toFixed(1)},${y(proj.base * Math.pow(1 + p / 100, m)).toFixed(1)}`).join(' ')
    const s = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n }
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'adv-proj', role: 'img', 'aria-label': `Proyeksi 12 bulan: dari ${rp(proj.base)} menjadi ${rp(proj.series[12].revenue)} per bulan pada target ${pctPlain(proj.pct)} per bulan. Garis tipis membandingkan target 1, 2, 5, dan 10 persen.` })
    for (let i = 1; i <= 3; i++) svg.append(s('line', { x1: pad, x2: W - pad, y1: y((yMax / 4) * i), y2: y((yMax / 4) * i), class: 'adv-proj-grid' }))
    svg.append(s('line', { x1: pad, x2: W - pad, y1: y(proj.base), y2: y(proj.base), class: 'adv-proj-base' }))
    for (const p of GROWTH_PRESETS) if (p !== proj.pct) svg.append(s('path', { d: line(p), class: 'adv-proj-ghost' }))
    const main = line(proj.pct)
    svg.append(s('path', { d: `${main} L${x(12)},${y(0)} L${x(0)},${y(0)} Z`, class: 'adv-proj-area' }))
    svg.append(s('path', { d: main, class: 'adv-proj-line', pathLength: '1' }))
    return svg
  }

  let projOpen = false
  function projDetails(table) {
    const d = el('details', { className: 'adv-proj-more', open: projOpen },
      el('summary', {}, icon('chevronRight', { size: 14 }), 'Tabel proyeksi 12 bulan'), table)
    d.addEventListener('toggle', () => { projOpen = d.open })
    return d
  }

  function drawCalc() {
    presetBtns.forEach((b) => {
      const on = Number(b.dataset.pct) === target
      b.setAttribute('aria-checked', on ? 'true' : 'false')
      b.tabIndex = on || (!GROWTH_PRESETS.includes(target) && b === presetBtns[0]) ? 0 : -1
    })
    const { base, job } = calcInputs()
    const proj = growthProjection({ base, pct: target, avgJob: job })
    const tier = growthTier(target)
    const tierNote = el('p', { className: `adv-tier tone-${tier.tone}` }, el('i', { 'aria-hidden': 'true' }), tier.label)
    const actual = snap?.cmgr ?? snap?.momGrowth
    const compare = actual != null
      ? el('p', { className: 'adv-calc-compare' }, `Pertumbuhan aktual Anda: `, el('strong', { className: 'tnum' }, `${pct(actual)} per bulan`), actual >= target ? ', sudah di atas target ini.' : `, perlu tambahan ${pctPlain(target - actual)} poin.`)
      : null
    if (!(base > 0)) {
      calcOut.replaceChildren(tierNote, el('p', { className: 'adv-calc-empty' }, 'Isi pendapatan dasar per bulan untuk melihat proyeksi dan jumlah pekerjaan yang dibutuhkan.'))
      return
    }
    const m12 = proj.series[12].revenue
    calcOut.replaceChildren(...[
      tierNote,
      el('div', { className: 'adv-calc-hero' },
        el('div', {},
          el('span', { className: 'adv-calc-kicker' }, 'Bulan ke-12'),
          el('span', { className: 'adv-calc-big tnum' }, rp(m12)),
          el('span', { className: 'adv-calc-sub tnum' }, `per bulan · setara ${pctPlain(proj.annualPct)} per tahun`),
        ),
        proj.nextMonthExtraJobs != null
          ? el('div', { className: 'adv-calc-next' },
              el('span', { className: 'adv-calc-kicker' }, 'Bulan depan'),
              el('span', { className: 'tnum strong' }, `+${rp(base * target / 100)}`),
              el('span', { className: 'adv-calc-sub tnum' }, `setara ${fmtJobs(proj.nextMonthExtraJobs)} pekerjaan`))
          : null,
      ),
      el('div', { className: 'adv-proj-wrap' }, projectionChart(proj),
        el('div', { className: 'adv-proj-axis', 'aria-hidden': 'true' }, el('span', {}, 'Sekarang'), el('span', {}, '6 bln'), el('span', {}, '12 bln'))),
      projDetails(el('table', { className: 'adv-proj-table' },
        el('caption', { className: 'sr-only' }, `Proyeksi pendapatan pada target ${pctPlain(target)} per bulan`),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Bulan'),
          el('th', { scope: 'col', className: 'num' }, 'Pendapatan/bln'),
          el('th', { scope: 'col', className: 'num' }, job > 0 ? 'Pekerjaan/bln' : 'Tambahan'))),
        el('tbody', {}, proj.rows.map((r) => el('tr', {},
          el('th', { scope: 'row' }, `ke-${r.month}`),
          el('td', { className: 'num tnum' }, rp(r.revenue)),
          el('td', { className: 'num tnum' }, job > 0
            ? [fmtJobs(r.jobs), el('span', { className: 'adv-plus' }, ` +${fmtJobs(r.extraJobs)}`)]
            : `+${rp(r.delta)}`),
        ))),
      )),
      el('p', { className: 'adv-calc-note' }, `Tambahan pendapatan kumulatif 12 bulan: `, el('strong', { className: 'tnum' }, rp(proj.cumulativeExtra)), job > 0 ? `. Pekerjaan dihitung dengan nilai rata-rata ${rp(job)}.` : '. Isi nilai rata-rata pekerjaan untuk menghitung jumlah pekerjaan.'),
      compare,
    ].filter(Boolean))
  }

  /* ---------------------------------------------------------- Snapshot */
  function miniKpi(label, value, sub, tone) {
    return el('div', { className: 'adv-kpi' },
      el('span', { className: 'adv-kpi-label' }, label),
      el('span', { className: 'adv-kpi-value tnum' }, value),
      sub ? el('span', { className: `adv-kpi-sub ${tone ? `tone-${tone}` : ''}`.trim() }, sub) : null,
    )
  }

  function renderSnapshot() {
    const s = snap
    if (!s.hasData) {
      const go = C.button({ label: 'Catat permintaan', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
      go.addEventListener('click', () => navigate('request'))
      snapBody.replaceChildren(C.emptyState({ kicker: 'Data belum ada', title: 'Snapshot terisi otomatis.', body: 'Penasihat tetap bisa memberi saran umum. Catat permintaan dan jurnal agar saran memakai angka Anda.', action: go, iconName: 'chart' }))
      return
    }
    const toneOf = (v) => (v == null ? null : v > 0 ? 'ok' : v < 0 ? 'danger' : null)
    const growthVal = s.momGrowth ?? s.growth30
    const growthSub = s.momGrowth != null
      ? `${s.prevFull.short} ke ${s.lastFull.short}${s.cmgr != null ? ` · rata-rata ${pct(s.cmgr)}` : ''}`
      : s.growth30 != null ? '30 hari vs 30 hari sebelumnya' : 'Butuh dua periode data'
    const kpis = el('div', { className: 'adv-kpis' },
      miniKpi('Pendapatan 30 hari', s.hasLedger ? rp(s.last30.revenue) : '—', s.hasLedger ? (s.growth30 != null ? `${pct(s.growth30)} vs sebelumnya` : `Sebelumnya ${rp(s.prev30.revenue)}`) : 'Belum ada jurnal', toneOf(s.growth30)),
      miniKpi('Pertumbuhan', growthVal != null ? pct(growthVal) : '—', growthSub, toneOf(growthVal)),
      miniKpi('Nilai rata-rata pekerjaan', s.avgJob > 0 ? rp(s.avgJob) : '—', `${s.allJobs} pekerjaan terbukukan`),
      miniKpi('Margin', s.margin != null ? pctPlain(s.margin) : '—', s.hasLedger ? `Laba ${rp(s.all.profit)}` : 'Belum ada jurnal', s.margin != null ? (s.margin >= 30 ? 'ok' : 'danger') : null),
    )

    const max = Math.max(1, ...s.months.map((m) => m.revenue))
    const bars = el('div', { className: 'adv-bars', role: 'img', 'aria-label': `Pendapatan enam bulan: ${s.months.map((m) => `${m.label} ${rp(m.revenue)}`).join(', ')}` },
      s.months.map((m) => el('div', { className: `adv-bar ${m.partial ? 'is-partial' : ''}`.trim(), title: `${m.label}${m.partial ? ' (berjalan)' : ''}: ${rp(m.revenue)}` },
        el('span', { className: 'adv-bar-track' }, el('span', { className: 'adv-bar-fill', style: `height:${Math.max(m.revenue > 0 ? 6 : 0, (m.revenue / max) * 100)}%` })),
        el('span', { className: 'adv-bar-label' }, m.short),
      )),
    )

    const p = s.pending
    const pendingTotal = p.requestsWithoutOffer + p.draftOffers + p.approvedWithoutAssignment + p.activeAssignments + p.completionsWithoutLedger
    const facts = [
      ['Layanan teratas', s.services[0] ? `${s.services[0].name} · ${rp(s.services[0].revenue)}` : s.demand[0] ? `${s.demand[0].name} · ${s.demand[0].requests} permintaan` : '—'],
      ['Biaya terbesar', s.costMix[0] ? `${s.costMix[0].label}${s.costMix[0].ofRevenue != null ? ` · ${pctPlain(s.costMix[0].ofRevenue)} pendapatan` : ''}` : '—'],
      ['Konversi penawaran', s.conversion.requestToOffer != null ? `${pctPlain(s.conversion.requestToOffer, 0)} permintaan ditawar` : '—'],
      ['Pelanggan berulang', s.repeat.customers ? `${s.repeat.returning} dari ${s.repeat.customers}` : '—'],
      ['Pekerjaan tertunda', pendingTotal ? `${pendingTotal} item${p.draftValue ? ` · draf ${rp(p.draftValue)}` : ''}` : 'Tidak ada'],
    ]
    const details = el('details', { className: 'adv-ctx' },
      el('summary', {}, icon('chevronRight', { size: 14 }), 'Lihat konteks yang dikirim ke AI'),
      el('pre', { className: 'adv-ctx-pre' }, snapshotToContext(s)),
    )
    snapBody.replaceChildren(...[
      kpis,
      s.hasLedger ? el('div', { className: 'adv-bars-wrap' }, el('span', { className: 'adv-mini-label' }, 'Pendapatan 6 bulan'), bars) : null,
      el('dl', { className: 'adv-facts' }, facts.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
      el('p', { className: 'adv-asof' }, icon('calendar', { size: 13 }), `Dihitung per ${s.asOfLabel} dari ${s.counts.requests} permintaan dan ${s.counts.ledger} jurnal.`),
      details,
    ].filter(Boolean))
  }

  /* ------------------------------------------------------------- Stats */
  function renderStats() {
    const a = computeAnalytics(rows)
    if (!a.count) {
      statsBody.replaceChildren(el('p', { className: 'adv-stats-empty' }, 'Belum ada jawaban tersimpan. Statistik muncul setelah Anda bertanya.'))
      return
    }
    const max = Math.max(1, ...a.byAgent.map((b) => b.count))
    statsBody.replaceChildren(...[
      el('div', { className: 'adv-stat-row' },
        el('div', { className: 'adv-stat' }, el('span', { className: 'adv-stat-value tnum' }, C.number(a.count)), el('span', { className: 'adv-stat-label' }, 'Jawaban')),
        el('div', { className: 'adv-stat' }, el('span', { className: 'adv-stat-value tnum' }, a.avgLatency != null ? seconds(a.avgLatency) : '—'), el('span', { className: 'adv-stat-label' }, 'Rata-rata waktu')),
        el('div', { className: 'adv-stat' }, el('span', { className: `adv-stat-value tnum ${a.errors ? 'is-bad' : ''}`.trim() }, a.errorRate != null ? pctPlain(a.errorRate, 0) : '—'), el('span', { className: 'adv-stat-label' }, 'Gagal')),
      ),
      el('ul', { className: 'adv-usage', 'aria-label': 'Jawaban per penasihat' }, a.byAgent.map((b) => el('li', {},
        el('span', { className: 'adv-usage-name' }, icon(AGENTS[b.key].icon, { size: 13 }), b.name),
        el('span', { className: 'adv-usage-track', 'aria-hidden': 'true' }, el('span', { className: 'adv-usage-fill', style: `width:${(b.count / max) * 100}%` })),
        el('span', { className: 'adv-usage-n tnum' }, String(b.count)),
      ))),
      a.stopped ? el('p', { className: 'adv-stats-note' }, `${a.stopped} jawaban dihentikan manual (tidak dihitung gagal).`) : null,
    ].filter(Boolean))
  }

  /* -------------------------------------------------------------- Load */
  syncAgents()
  syncRouteHint()
  drawCalc()
  log.replaceChildren(el('div', { className: 'adv-loading' }, C.skeleton({ lines: 3 })))

  const modelReady = resolveModel()
  modelReady
    .then((m) => { model = m; modelPill.hidden = Boolean(m) })
    .catch((err) => { modelPill.hidden = false })

  const memoryReady = loadMessages({ uid })
    .then(({ rows: r }) => { rows = r })
    .catch((err) => { showToast(`Riwayat percakapan gagal dimuat: ${err.message}`, 'error') })

  const dataReady = loadFlow()
    .then((flow) => { snap = buildSnapshot(flow) })
    .catch((err) => { snapBody.replaceChildren(C.errorState(`Gagal memuat data bisnis: ${err.message}`)) })

  await Promise.all([memoryReady, dataReady])
  if (ctx.signal?.aborted) return
  const last = [...rows].reverse().find((r) => r.role === 'assistant')
  lastAuto = last?.agent || null
  if (snap) {
    renderSnapshot()
    if (!baseField.input.value) baseField.input.value = snap.base.revenue > 0 ? String(Math.round(snap.base.revenue)) : ''
    if (!jobField.input.value) jobField.input.value = snap.avgJob > 0 ? String(Math.round(snap.avgJob)) : ''
    baseField.wrap.querySelector('.field-hint').textContent = snap.base.revenue > 0 ? `Dari ${snap.base.label}. Boleh diubah.` : 'Belum ada pendapatan tercatat. Isi perkiraan Anda.'
    jobField.wrap.querySelector('.field-hint').textContent = snap.avgJob > 0 ? `Dari ${snap.allJobs} pekerjaan terbukukan.` : 'Isi perkiraan nilai satu pekerjaan.'
  }
  drawCalc()
  renderThread()
  renderStats()

  // An answer that kept streaming while the user was on another page.
  if (running) {
    const job = running
    const has = (row) => rows.some((r) => r.id === row.id)
    if (!has(job.userRow)) rows.push(job.userRow)
    if (job.done) {
      // Finished while this page was loading.
      if (job.outcome.row && !has(job.outcome.row)) rows.push(job.outcome.row)
      renderThread()
      renderStats()
      return
    }
    renderThread()
    const ui = assistantMsg(job.draft, { route: job.route, streaming: true })
    if (job.full) ui.setText(job.full, { caret: true })
    else ui.typing()
    appendToLog(ui.node)
    status.textContent = `${agentName(job.agentKey)} sedang menyusun jawaban.`
    attach(job, ui)
  }
}

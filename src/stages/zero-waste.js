/**
 * Pendapatan — Tanpa Limbah (zero waste).
 *
 * The premise: income has two levers. Raise what comes in (VAS) and stop what
 * leaks out. This page owns the second lever across five streams, measures the
 * leak in Rupiah against recorded findings, and shows honest progress toward
 * zero.
 *
 * Tabs: Pemborosan (state of play) · Tindakan (findings CRUD) · Ruang optimasi.
 */
import '../styles/pendapatan.css'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { getCloud } from '../cloud.js'
import { loadFlow, notifyDataChanged } from './data.js'
import {
  WASTE_STREAMS, WASTE_STATUSES, streamMeta, statusLabel,
  computeWaste, benchmarkVerdict, closurePlan,
} from '../business/waste-engine.js'
import { filterRows, debounce, toCsv } from '../business/list-view.js'
import {
  validateWasteEntry, withWasteCompletion, assertWasteInvariants,
  wasteKey, splitDuplicates, assertImportSize,
} from '../pendapatan/rules.js'
import { downloadText, datedName } from '../ui/download.js'
import { renderOptimasi } from './optimasi-panel.js'
import { t } from '../i18n/index.js'

const { el, icon } = C
const TAB_KEYS = ['pemborosan', 'tindakan', 'optimasi']
const tabOptions = () => TAB_KEYS.map((value) => ({ value, label: t(`zeroWaste.tabs.${value}`) }))

// Labels for stable keys from the shared engine, worded in the viewer's language.
const known = (key) => WASTE_STREAMS.some((s) => s.key === key)
const streamText = (key, field) => (known(key) ? t(`zeroWaste.stream.${key}.${field}`) : streamMeta(key)[field])
const stLabel = (v) => (WASTE_STATUSES.some((s) => s.value === v) ? t(`zeroWaste.status.${v}`) : statusLabel(v))
const stOptions = () => WASTE_STATUSES.map((s) => ({ value: s.value, label: stLabel(s.value) }))
const VERDICT_KEYS = { 'Belum ada data pendapatan': 'noRevenue', 'Bebas limbah': 'free', 'Di bawah patokan': 'below', 'Sesuai patokan': 'at', 'Di atas patokan': 'above' }
const verdictLabel = (label) => (VERDICT_KEYS[label] ? t(`zeroWaste.verdict.${VERDICT_KEYS[label]}`) : label)
let currentTab = 'pemborosan'
// Survives tab switches so the user's filter is still there when they return.
let entryQuery = ''
let entryStream = 'all'
let entryStatus = 'all'
let skipDuplicates = true

const STATUS_TONE = { open: 'danger', progress: 'warn', done: 'ok' }

/* ------------------------------------------------------------- Database */

async function fetchEntries() {
  const { data, error } = await getCloud().database.from('waste_entries').select('*')
  if (error) throw new Error(error.message)
  return (data || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

async function saveEntry(fields, id) {
  // Same validator as the Worker: the form cannot save what D1 would reject.
  const row = withWasteCompletion(validateWasteEntry(fields))
  assertWasteInvariants(row)
  const table = getCloud().database.from('waste_entries')
  const { error } = id
    ? await table.update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : await table.insert(row)
  if (error) throw new Error(error.message)
  notifyDataChanged()
}

async function removeEntry(id) {
  const { error } = await getCloud().database.from('waste_entries').delete().eq('id', id)
  if (error) throw new Error(error.message)
  notifyDataChanged()
}

async function closeEntry(entry) {
  const { error } = await getCloud().database.from('waste_entries')
    .update({ saved: Number(entry.monthly_loss) || 0, status: 'done', updated_at: new Date().toISOString() })
    .eq('id', entry.id)
  if (error) throw new Error(error.message)
  notifyDataChanged()
}

/* ---------------------------------------------------------------- Render */

export async function render(container, ctx = {}) {
  let model = null
  let entries = []
  const status = C.message()

  const host = el('div')
  const tabs = C.segmented({
    options: tabOptions(), value: currentTab, label: t('zeroWaste.tabsLabel'),
    onChange: (value) => { currentTab = value; status.hide(); draw() },
  })
  tabs.classList.add('workspace-tabs')

  const head = C.pageHeader({
    title: t('zeroWaste.page.title'), em: t('zeroWaste.page.em'),
    actions: C.button({ label: t('zeroWaste.page.record'), icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
  })
  // The tabs share the header row with the page action (one row instead of two).
  head.insertBefore(tabs, head.querySelector('.page-head-actions'))
  container.replaceChildren(head, status, host)

  const revenue = () => (model?.ledger || [])
    .filter((l) => l.category === 'pendapatan')
    .reduce((s, l) => s + (Number(l.amount) || 0), 0)
  // "x% dari pendapatan" means nothing before any revenue is booked.
  const shareText = (w, suffix = 'ofRevenue') => (revenue() > 0 ? t(`zeroWaste.share.${suffix}`, { pct: w.lossShare.toFixed(1) }) : t('zeroWaste.share.none'))

  function draw() {
    if (currentTab === 'pemborosan') drawState()
    else if (currentTab === 'tindakan') drawActions()
    else drawOptimasi()
  }

  /* ---------------------------------------------------------- Pemborosan */

  function drawState() {
    const w = computeWaste(entries, revenue())
    const plan = closurePlan(w)
    const freePct = Math.round(w.pct)

    const ring = el('div', { className: 'zw-ring' })
    const R = 54
    const CIRC = 2 * Math.PI * R
    const offset = CIRC * (1 - Math.min(1, w.pct / 100))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 128 128')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', t('zeroWaste.ring.aria', { pct: freePct }))
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    track.setAttribute('cx', '64'); track.setAttribute('cy', '64'); track.setAttribute('r', String(R))
    track.setAttribute('class', 'zw-ring-track')
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    arc.setAttribute('cx', '64'); arc.setAttribute('cy', '64'); arc.setAttribute('r', String(R))
    arc.setAttribute('class', 'zw-ring-arc')
    arc.setAttribute('stroke-dasharray', String(CIRC))
    arc.setAttribute('stroke-dashoffset', String(offset))
    svg.append(track, arc)
    ring.append(svg, el('div', { className: 'zw-ring-label' },
      el('span', { className: 'zw-ring-value tnum' }, `${freePct}%`),
      el('span', { className: 'zw-ring-caption' }, t('zeroWaste.ring.caption'))))

    const hero = el('div', { className: 'zw-hero' },
      ring,
      el('div', { className: 'zw-hero-body' },
        el('h2', { className: 'zw-hero-title' }, freePct >= 100
          ? t('zeroWaste.hero.clean')
          : t('zeroWaste.hero.leaking', { amount: C.rupiah(w.remaining) })),
        el('p', { className: 'zw-hero-text' }, w.loss
          ? t('zeroWaste.hero.text', { loss: C.rupiah(w.loss), saved: C.rupiah(w.saved), remaining: w.remaining > 0 ? `${C.rupiah(w.remaining)}` : t('zeroWaste.hero.zero'), share: revenue() > 0 ? shareText(w, 'ofRecorded') : t('zeroWaste.hero.noCompare') })
          : t('zeroWaste.hero.empty')),
        el('div', { className: 'zw-hero-actions' },
          C.button({ label: t('zeroWaste.page.record'), icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
          C.button({ label: t('zeroWaste.hero.viewActions'), iconRight: 'arrowRight', size: 'sm', variant: 'ghost', onClick: () => tabs.querySelector('[data-value="tindakan"]')?.click() })),
      ),
    )

    const kpis = el('div', { className: 'zw-kpis' },
      C.kpi({ label: t('zeroWaste.kpi.remaining'), value: C.rupiah(w.remaining), sub: revenue() > 0 ? shareText(w) : t('zeroWaste.kpi.noRevenue'), iconName: 'trendingDown' }),
      C.kpi({ label: t('zeroWaste.kpi.stopped'), value: C.rupiah(w.saved), sub: t('zeroWaste.kpi.ofRecorded', { amount: C.rupiah(w.loss) }), iconName: 'checkCircle' }),
      C.kpi({ label: t('zeroWaste.kpi.winnable'), value: C.rupiah(w.winnable), sub: t('zeroWaste.kpi.openFindings', { count: w.open }), iconName: 'target' }),
      C.kpi({ label: t('zeroWaste.kpi.done'), value: String(w.done), sub: t('zeroWaste.kpi.doneSub'), iconName: 'flag' }),
    )

    const streamCards = el('div', { className: 'zw-streams' }, w.streams.map((s) => {
      const verdict = benchmarkVerdict(s, revenue())
      return el('article', { className: 'zw-stream', 'data-tone': verdict.tone },
        el('header', { className: 'zw-stream-head' },
          el('span', { className: 'zw-stream-ico', 'aria-hidden': 'true' }, icon(s.icon, { size: 18 })),
          el('div', { className: 'zw-stream-id' },
            el('h3', { className: 'zw-stream-name' }, streamText(s.key, 'short')),
            el('p', { className: 'zw-stream-sub' }, t('zeroWaste.streamCard.sub', { count: s.rows.length, open: s.open })),
          ),
          C.tag(verdictLabel(verdict.label), verdict.tone),
        ),
        el('div', { className: 'zw-stream-money' },
          el('span', { className: 'zw-stream-money-value tnum' }, C.rupiah(s.remaining)),
          el('span', { className: 'zw-stream-money-label' }, t('zeroWaste.streamCard.perMonth')),
        ),
        el('div', { className: 'zw-bar', role: 'img', 'aria-label': t('zeroWaste.streamCard.barAria', { pct: Math.round(s.pct) }) },
          el('span', { className: 'zw-bar-fill', style: `width:${Math.max(0, Math.min(100, s.pct))}%` })),
        el('div', { className: 'zw-stream-foot' },
          el('span', { className: 'tnum' }, t('zeroWaste.streamCard.stopped', { pct: Math.round(s.pct) })),
          el('span', { className: 'tnum' }, t('zeroWaste.streamCard.benchmark', { pct: s.benchmark })),
        ),
        el('p', { className: 'zw-stream-why' }, streamText(s.key, 'why')),
      )
    }))

    const planPanel = plan.length
      ? C.panel({ title: t('zeroWaste.plan.title'), meta: t('zeroWaste.plan.meta') },
        el('ol', { className: 'zw-plan' }, plan.map((p) => el('li', { className: 'zw-plan-item' },
          el('div', { className: 'zw-plan-head' },
            el('span', { className: 'zw-plan-name' }, streamText(p.stream, 'short')),
            el('span', { className: 'zw-plan-value tnum' }, C.rupiah(p.remaining))),
          el('p', { className: 'zw-plan-action' }, streamText(p.stream, 'fix')),
          el('div', { className: 'zw-bar is-thin', role: 'img', 'aria-label': t('zeroWaste.streamCard.barAria', { pct: Math.round(p.pct) }) },
            el('span', { className: 'zw-bar-fill', style: `width:${Math.max(0, Math.min(100, p.pct))}%` })),
        ))))
      : C.panel({ title: t('zeroWaste.plan.title') },
        el('p', { className: 'zw-muted' }, t('zeroWaste.plan.clean')))

    host.replaceChildren(hero, kpis, streamCards, planPanel)
  }

  /* ------------------------------------------------------------ Tindakan */

  let entryList = null
  let entryNote = null

  const filteredEntries = () => filterRows(entries, {
    query: entryQuery,
    fields: ['title', 'detail', 'action', 'owner'],
    filters: { stream: entryStream, status: entryStatus },
  })

  function entryTable(rows) {
    return C.dataTable({
      caption: t('zeroWaste.table.caption'),
      columns: [
        { key: 'title', label: t('zeroWaste.table.finding'), render: (r) => C.cellStack(r.title, el('span', { className: 'zw-clamp' }, r.detail || streamText(r.stream, 'label'))) },
        { key: 'stream', label: t('zeroWaste.table.source'), render: (r) => streamText(r.stream, 'short') },
        { key: 'monthly_loss', label: t('zeroWaste.table.lossMonth'), align: 'right', render: (r) => C.rupiah(r.monthly_loss) },
        { key: 'saved', label: t('zeroWaste.table.stopped'), align: 'right', render: (r) => C.rupiah(r.saved) },
        {
          key: 'remaining', label: t('zeroWaste.table.remaining'), align: 'right',
          render: (r) => {
            const left = Math.max(0, (Number(r.monthly_loss) || 0) - (Number(r.saved) || 0))
            return el('strong', { className: `tnum ${left > 0 ? 'zw-left' : ''}` }, C.rupiah(left))
          },
        },
        { key: 'owner', label: t('zeroWaste.table.owner'), render: (r) => r.owner || el('span', { className: 'muted' }, '—') },
        { key: 'status', label: t('zeroWaste.table.status'), render: (r) => C.tag(stLabel(r.status), STATUS_TONE[r.status] || 'neutral') },
        {
          key: 'act', label: '', className: 'zw-row-actions',
          render: (r) => el('div', { className: 'zw-row-actions-in' },
            r.status !== 'done'
              ? C.iconButton({ iconName: 'check', label: t('zeroWaste.table.markDone', { title: r.title }), onClick: () => markDone(r) })
              : null,
            C.iconButton({ iconName: 'pencil', label: t('zeroWaste.table.edit', { title: r.title }), onClick: () => openEditor(r) }),
            C.iconButton({ iconName: 'trash', label: t('zeroWaste.table.delete', { title: r.title }), onClick: () => confirmDelete(r) })),
        },
      ],
      rows,
    })
  }

  /** Redraws table + count only, so typing in the search box keeps focus. */
  function refreshEntries() {
    if (!entryList) return
    const rows = filteredEntries()
    entryList.update(rows, { resetKey: `${entryQuery}|${entryStream}|${entryStatus}` })
    const w = computeWaste(entries, revenue())
    entryNote.textContent = t('zeroWaste.list.note', { shown: rows.length, total: entries.length, open: w.open, amount: C.rupiah(w.winnable) })
  }

  function exportEntries() {
    const rows = filteredEntries()
    if (!rows.length) { showToast(t('zeroWaste.list.noRows'), 'warn'); return }
    downloadText(datedName('temuan-limbah'), toCsv([
      { label: t('zeroWaste.table.finding'), value: (r) => r.title },
      { label: t('zeroWaste.table.source'), value: (r) => streamText(r.stream, 'label') },
      { label: t('zeroWaste.csv.lossMonth'), key: 'monthly_loss' },
      { label: t('zeroWaste.kpi.stopped'), key: 'saved' },
      { label: t('zeroWaste.table.remaining'), value: (r) => Math.max(0, (Number(r.monthly_loss) || 0) - (Number(r.saved) || 0)) },
      { label: t('zeroWaste.csv.action'), value: (r) => r.action || '' },
      { label: t('zeroWaste.table.owner'), value: (r) => r.owner || '' },
      { label: t('zeroWaste.table.status'), value: (r) => stLabel(r.status) },
      { label: t('zeroWaste.csv.created'), value: (r) => r.created_at || '' },
    ], rows))
    showToast(t('zeroWaste.list.exported', { count: rows.length }), 'success')
  }

  function drawActions() {
    const search = el('input', {
      type: 'search',
      className: 'pd-search',
      value: entryQuery,
      placeholder: t('zeroWaste.list.searchPlaceholder'),
      'aria-label': t('zeroWaste.list.searchLabel'),
    })
    search.addEventListener('input', debounce(() => { entryQuery = search.value; refreshEntries() }, 150))

    const streamFilter = el('select', { className: 'pd-filter', 'aria-label': t('zeroWaste.list.streamFilter') },
      [{ value: 'all', label: t('zeroWaste.list.allSources') }, ...WASTE_STREAMS.map((s) => ({ value: s.key, label: streamText(s.key, 'short') }))]
        .map((o) => el('option', { value: o.value }, o.label)))
    streamFilter.value = entryStream
    streamFilter.addEventListener('change', () => { entryStream = streamFilter.value; refreshEntries() })

    const statusFilter = el('select', { className: 'pd-filter', 'aria-label': t('zeroWaste.list.statusFilter') },
      [{ value: 'all', label: t('zeroWaste.list.allStatuses') }, ...stOptions()].map((o) => el('option', { value: o.value }, o.label)))
    statusFilter.value = entryStatus
    statusFilter.addEventListener('change', () => { entryStatus = statusFilter.value; refreshEntries() })

    entryNote = el('span', { className: 'zw-toolbar-note' })
    // "Catat temuan" lives in the page header; the toolbar only holds list tools.
    const toolbar = el('div', { className: 'zw-toolbar' },
      C.button({ label: t('zeroWaste.list.bulk'), icon: 'layers', size: 'sm', onClick: openBulk }),
      el('div', { className: 'pd-filters' }, search, streamFilter, statusFilter),
      C.button({ label: t('zeroWaste.list.export'), icon: 'file', size: 'sm', variant: 'ghost', onClick: exportEntries }),
      entryNote,
    )

    if (!entries.length) {
      entryList = null
      host.replaceChildren(toolbar, C.emptyState({
        kicker: t('zeroWaste.list.emptyKicker'),
        title: t('zeroWaste.list.emptyTitle'),
        body: t('zeroWaste.list.emptyBody'),
        iconName: 'sprout',
        action: C.button({ label: t('zeroWaste.list.recordFirst'), icon: 'plus', variant: 'primary', onClick: () => openEditor(null) }),
      }))
      entryNote.textContent = t('zeroWaste.list.zero')
      return
    }

    entryList = C.paginate({
      key: 'zw-tindakan',
      label: t('zeroWaste.list.pagerLabel'),
      pageSize: 10,
      render: (rows) => (rows.length
        ? entryTable(rows)
        : el('p', { className: 'pd-none' }, t('zeroWaste.list.noMatch'))),
    })
    host.replaceChildren(toolbar, entryList.root)
    refreshEntries()
  }

  /* ------------------------------------------------------------ Optimasi */

  function drawOptimasi() {
    const rev = revenue()
    const w = computeWaste(entries, rev)
    const plan = closurePlan(w)
    const top = [...w.streams].sort((a, b) => b.remaining - a.remaining)

    const context = [
      'Cakupan: Tanpa limbah (zero waste)',
      `Pendapatan tercatat: ${C.rupiah(rev)}`,
      `Kerugian tercatat: ${C.rupiah(w.loss)} per bulan`,
      `Sudah dihentikan: ${C.rupiah(w.saved)} (${w.pct.toFixed(1)}%)`,
      `Sisa kerugian: ${C.rupiah(w.remaining)} (${rev > 0 ? `${w.lossShare.toFixed(1)}% dari pendapatan` : 'belum ada pendapatan tercatat'})`,
      `Temuan terbuka: ${w.open}, selesai: ${w.done}`,
      `Masih bisa dihemat: ${C.rupiah(w.winnable)}`,
      `Sumber terbesar: ${top[0]?.remaining > 0 ? top[0].label : 'Tidak ada'}`,
      'Rincian per sumber:',
      ...w.streams.map((s) => `- ${s.label}: sisa ${C.rupiah(s.remaining)}, terhenti ${Math.round(s.pct)}%, patokan sehat ${s.benchmark}% dari pendapatan`),
      ...plan.map((p) => `- Langkah disarankan untuk ${p.label}: ${p.action}`),
    ].join('\n')

    const facts = [
      { label: t('zeroWaste.facts.revenue'), value: C.rupiah(rev) },
      { label: t('zeroWaste.facts.recordedLoss'), value: t('zeroWaste.facts.perMonth', { amount: C.rupiah(w.loss) }) },
      { label: t('zeroWaste.kpi.remaining'), value: t('zeroWaste.facts.perMonth', { amount: C.rupiah(w.remaining) }) },
      { label: t('zeroWaste.facts.stopped'), value: `${w.pct.toFixed(0)}%` },
      { label: t('zeroWaste.facts.open'), value: String(w.open) },
      { label: t('zeroWaste.facts.top'), value: top[0]?.remaining > 0 ? t(`zeroWaste.stream.${top[0].key}.short`) : t('zeroWaste.facts.none') },
    ]

    const presets = [
      {
        label: t('zeroWaste.presets.rework.label'),
        problem: t('zeroWaste.presets.rework.problem'),
        target: 1500000,
      },
      {
        label: t('zeroWaste.presets.route.label'),
        problem: t('zeroWaste.presets.route.problem'),
        target: 800000,
      },
      {
        label: t('zeroWaste.presets.zero.label'),
        problem: t('zeroWaste.presets.zero.problem'),
        target: Math.max(500000, Math.round(w.remaining / 3 / 50000) * 50000),
      },
    ]

    renderOptimasi(host, ctx, { scope: 'waste', context, facts, presets })
  }

  /* --------------------------------------------------------------- Modals */

  function openEditor(existing) {
    const isEdit = Boolean(existing)
    const seed = existing || {}
    const stream = C.select({
      label: t('zeroWaste.editor.stream'), id: 'zw-stream',
      options: WASTE_STREAMS.map((s) => ({ value: s.key, label: streamText(s.key, 'label') })),
      value: seed.stream || 'waktu',
      hint: t('zeroWaste.editor.streamHint'),
    })
    const title = C.field({ label: t('zeroWaste.editor.title'), id: 'zw-title', required: true, value: seed.title || '', placeholder: t('zeroWaste.editor.titlePlaceholder') })
    const detail = C.textarea({ label: t('zeroWaste.editor.detail'), id: 'zw-detail', rows: 3, value: seed.detail || '', placeholder: t('zeroWaste.editor.detailPlaceholder') })
    const loss = C.field({ label: t('zeroWaste.editor.loss'), id: 'zw-loss', type: 'number', required: true, value: seed.monthly_loss ?? '', hint: t('zeroWaste.editor.lossHint'), attrs: { min: '0', step: '50000', inputmode: 'numeric' } })
    const saved = C.field({ label: t('zeroWaste.editor.saved'), id: 'zw-saved', type: 'number', value: seed.saved ?? 0, hint: t('zeroWaste.editor.savedHint'), attrs: { min: '0', step: '50000', inputmode: 'numeric' } })
    const action = C.textarea({ label: t('zeroWaste.editor.action'), id: 'zw-action', rows: 2, value: seed.action || '', placeholder: t('zeroWaste.editor.actionPlaceholder') })
    const owner = C.field({ label: t('zeroWaste.editor.owner'), id: 'zw-owner', value: seed.owner || '', placeholder: t('zeroWaste.editor.ownerPlaceholder') })
    const statusSel = C.select({ label: t('zeroWaste.editor.status'), id: 'zw-status', options: stOptions(), value: seed.status || 'open' })

    const saveBtn = C.button({ label: isEdit ? t('zeroWaste.editor.save') : t('zeroWaste.editor.record'), variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: isEdit ? t('zeroWaste.editor.editTitle') : t('zeroWaste.editor.newTitle'),
      description: t('zeroWaste.editor.description'),
      wide: true,
      children: [
        modalNote,
        el('div', { className: 'zw-form-grid' }, stream.wrap, statusSel.wrap),
        title.wrap,
        detail.wrap,
        el('div', { className: 'zw-form-grid' }, loss.wrap, saved.wrap),
        action.wrap,
        owner.wrap,
      ],
      actions: [C.button({ label: t('zeroWaste.common.cancel'), variant: 'ghost', dismiss: true }), saveBtn],
      opener: container,
    })

    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      if (!title.input.value.trim()) { title.input.focus(); modalNote.show('warn', t('zeroWaste.editor.titleRequired')); return }
      if (!(Number(loss.input.value) > 0)) { loss.input.focus(); modalNote.show('warn', t('zeroWaste.editor.lossRequired')); return }
      if (Number(saved.input.value) > Number(loss.input.value)) {
        saved.input.focus(); modalNote.show('warn', t('zeroWaste.editor.savedTooHigh')); return
      }
      const restore = C.setBusy(saveBtn, t('zeroWaste.common.saving'))
      try {
        await saveEntry({
          stream: stream.input.value, title: title.input.value, detail: detail.input.value,
          monthly_loss: loss.input.value, saved: saved.input.value,
          action: action.input.value, owner: owner.input.value, status: statusSel.input.value,
        }, existing?.id)
        dialog.close()
        status.hide()
        showToast(isEdit ? t('zeroWaste.editor.updated') : t('zeroWaste.editor.recorded'), 'success')
        await reload()
      } catch (err) { modalNote.show('danger', err.message) } finally { restore() }
    })
  }

  async function markDone(entry) {
    try {
      await closeEntry(entry)
      showToast(t('zeroWaste.markDone.done'), 'success')
      await reload()
    } catch (err) { status.show('danger', err.message) }
  }

  function confirmDelete(entry) {
    const delBtn = C.button({ label: t('zeroWaste.delete.confirm'), variant: 'danger' })
    const dialog = C.modal({
      title: t('zeroWaste.delete.title'),
      description: t('zeroWaste.delete.description', { title: entry.title }),
      children: [el('p', { className: 'zw-muted' }, t('zeroWaste.delete.irreversible'))],
      actions: [C.button({ label: t('zeroWaste.common.cancel'), variant: 'ghost', dismiss: true }), delBtn],
      opener: container,
    })
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      const restore = C.setBusy(delBtn, t('zeroWaste.delete.busy'))
      try {
        await removeEntry(entry.id)
        dialog.close()
        showToast(t('zeroWaste.delete.done'), 'success')
        await reload()
      } catch (err) { status.show('danger', err.message) } finally { restore() }
    })
  }

  function openBulk() {
    const ta = C.textarea({
      label: t('zeroWaste.bulk.label'),
      id: 'zw-bulk',
      rows: 10,
      hint: t('zeroWaste.bulk.hint'),
      placeholder: t('zeroWaste.bulk.placeholder'),
    })
    const preview = el('div', { className: 'zw-bulk-preview' })
    const skip = el('input', { type: 'checkbox', id: 'zw-bulk-skip', checked: skipDuplicates })
    skip.addEventListener('change', () => { skipDuplicates = skip.checked; check() })
    const skipWrap = el('label', { className: 'pd-check', for: 'zw-bulk-skip' },
      skip, el('span', {}, t('zeroWaste.bulk.skip')))

    const split = () => {
      const rows = parseBulk(ta.input.value)
      return { rows, ...splitDuplicates(rows, entries, (r) => wasteKey(r.title)) }
    }

    const check = () => {
      try {
        const { fresh, duplicates } = split()
        preview.className = 'zw-bulk-preview is-ok'
        const extra = duplicates.length ? t('zeroWaste.bulk.dupes', { count: duplicates.length, skipped: skip.checked ? t('zeroWaste.bulk.andSkipped') : '' }) : ''
        const sample = fresh[0] || duplicates[0]
        preview.textContent = t('zeroWaste.bulk.preview', { count: fresh.length, extra, title: sample?.title, amount: C.rupiah(sample?.monthly_loss || 0) })
      } catch (err) {
        preview.className = 'zw-bulk-preview is-bad'
        preview.textContent = err.message
      }
    }
    ta.input.addEventListener('input', check)

    const importBtn = C.button({ label: t('zeroWaste.bulk.import'), variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: t('zeroWaste.bulk.title'),
      description: t('zeroWaste.bulk.description'),
      wide: true,
      children: [modalNote, ta.wrap, skipWrap, preview],
      actions: [C.button({ label: t('zeroWaste.common.cancel'), variant: 'ghost', dismiss: true }), importBtn],
      opener: container,
    })

    importBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      let plan
      try { plan = split() } catch (err) { modalNote.show('warn', err.message); return }
      const rows = skip.checked ? plan.fresh : plan.rows
      const skipped = plan.rows.length - rows.length
      if (!rows.length) { modalNote.show('warn', t('zeroWaste.bulk.allDupes')); return }
      const restore = C.setBusy(importBtn, t('zeroWaste.bulk.importing'))
      try {
        const { error } = await getCloud().database.from('waste_entries').insert(rows)
        if (error) throw new Error(error.message)
        dialog.close()
        showToast(t('zeroWaste.bulk.done', { count: rows.length, skipped: skipped ? t('zeroWaste.bulk.skippedCount', { count: skipped }) : '' }), 'success')
        notifyDataChanged()
        await reload()
      } catch (err) { modalNote.show('danger', err.message) } finally { restore() }
    })
  }

  /* ----------------------------------------------------------------- Load */

  /** Load failure with a retry that does not force a full page reload. */
  function errorView(message) {
    const box = C.errorState(message)
    const retry = C.button({
      label: t('zeroWaste.load.retry'), icon: 'refresh', size: 'sm',
      onClick: () => { host.replaceChildren(C.skeletonRows(4)); reload() },
    })
    box.querySelector('.note-body')?.appendChild(el('div', { className: 'note-actions' }, retry))
    return box
  }

  async function reload() {
    try {
      const [m, list] = await Promise.all([loadFlow(), fetchEntries()])
      model = m
      entries = list
    } catch (err) {
      if (ctx.signal?.aborted) return
      status.show('danger', t('zeroWaste.load.failed', { error: err.message }))
      host.replaceChildren(errorView(err.message))
      return
    }
    if (ctx.signal?.aborted) return
    draw()
  }

  host.replaceChildren(C.skeletonRows(4))
  await reload()
}

/* --------------------------------------------------------------- Parsing */

const STREAM_ALIASES = {
  waktu: 'waktu', waktu_menganggur: 'waktu', idle: 'waktu',
  perjalanan: 'perjalanan', transport: 'perjalanan', bahan_bakar: 'perjalanan',
  bahan: 'bahan', material: 'bahan', consumables: 'bahan',
  pengerjaan_ulang: 'pengerjaan_ulang', rework: 'pengerjaan_ulang', kerja_ulang: 'pengerjaan_ulang',
  air_kimia: 'air_kimia', kimia: 'air_kimia', air: 'air_kimia',
}

/** One row through the shared validator, with a readable line number on failure. */
function normalizeRow(r, lineNo) {
  const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '')
  const streamRaw = clean(r.stream ?? r.sumber).toLowerCase().replace(/\s+/g, '_')
  try {
    const row = withWasteCompletion(validateWasteEntry({
      stream: STREAM_ALIASES[streamRaw] || 'waktu',
      title: clean(r.title ?? r.judul),
      detail: clean(r.detail ?? r.keterangan),
      monthly_loss: r.monthly_loss ?? r.kerugian,
      saved: r.saved ?? r.terhenti ?? 0,
      action: clean(r.action ?? r.tindakan),
      owner: clean(r.owner ?? r.pemilik),
      status: clean(r.status) || 'open',
    }))
    assertWasteInvariants(row)
    return row
  } catch (err) {
    throw new Error(t('zeroWaste.parse.line', { line: lineNo, error: err.message }))
  }
}

function parseBulk(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error(t('zeroWaste.parse.empty'))
  if (raw.startsWith('[')) {
    let rows
    try { rows = JSON.parse(raw) } catch { throw new Error(t('zeroWaste.parse.badJson')) }
    if (!Array.isArray(rows)) throw new Error(t('zeroWaste.parse.notArray'))
    const parsed = rows.map((r, i) => normalizeRow(r, i + 1))
    assertImportSize(parsed.length)
    return parsed
  }
  const rows = raw.split('\n')
    .map((line, i) => ({ line: line.trim(), i: i + 1 }))
    .filter(({ line }) => line && !line.startsWith('#'))
    .map(({ line, i }) => {
      const p = line.split(/\s*[|\t;]\s*/)
      return normalizeRow({
        stream: p[0], title: p[1], monthly_loss: p[2], saved: p[3], owner: p[4], status: p[5],
      }, i)
    })
  assertImportSize(rows.length)
  return rows
}

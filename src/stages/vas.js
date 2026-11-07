/**
 * Pendapatan — Layanan Tambahan (VAS).
 *
 * Three tabs:
 *   Peluang   AI-free discovery: which add-on revenue already sits inside the
 *             user's own jobs, with the Rupiah attached and the rows that
 *             produced it.
 *   Katalog   the sellable VAS catalog. Full CRUD, bulk paste, margin view.
 *   Optimasi  the five-team room, scoped to VAS and fed the same numbers.
 *
 * Nothing on this page invents a number: discovery reads the flow tables, the
 * catalog reads `vas_items`, and the teams receive both as context.
 */
import '../styles/pendapatan.css'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { getCloud } from '../cloud.js'
import { loadFlow, notifyDataChanged } from './data.js'
import {
  VAS_CATEGORIES, VAS_STATUSES, categoryLabel, statusLabel,
  itemEconomics, attachRate, catalogPotential, discoverOpportunities, vasRevenueShare,
} from '../business/vas-engine.js'
import { filterRows, debounce, toCsv } from '../business/list-view.js'
import { validateVasItem, vasKey, splitDuplicates, assertImportSize } from '../pendapatan/rules.js'
import { downloadText, datedName } from '../ui/download.js'
import { renderOptimasi } from './optimasi-panel.js'
import { t, locale } from '../i18n/index.js'

const { el } = C
const TAB_KEYS = ['peluang', 'katalog', 'optimasi']
const tabOptions = () => TAB_KEYS.map((value) => ({ value, label: t(`vas.tabs.${value}`) }))

// Labels for stable keys from the shared engine/rules, worded in the viewer's language.
const catLabel = (v) => (VAS_CATEGORIES.some((c) => c.value === v) ? t(`vas.category.${v}`) : categoryLabel(v))
const stLabel = (v) => (VAS_STATUSES.some((s) => s.value === v) ? t(`vas.status.${v}`) : statusLabel(v))
const catOptions = () => VAS_CATEGORIES.map((c) => ({ value: c.value, label: catLabel(c.value) }))
const stOptions = () => VAS_STATUSES.map((s) => ({ value: s.value, label: stLabel(s.value) }))
const OWNERS = ['Keuangan', 'Operasional', 'Marketing', 'Kreatif']
const ownerLabel = (owner) => String(owner || '').split(' + ').map((o) => (OWNERS.includes(o) ? t(`vas.owner.${o}`) : o)).join(' + ')

/** Title, reason and evidence of an engine opportunity, worded from its raw figures. */
function oppText(o) {
  const v = o.vars
  if (!v) return { title: o.title, why: o.why, basis: o.basis }
  const k = `vas.opp.${o.kind}`
  switch (o.kind) {
    case 'langganan': return { title: t(`${k}.title`), why: t(`${k}.why`, v), basis: v.items.map((i) => t(`${k}.basisItem`, i)).join(', ') }
    case 'berkala': return { title: t(`${k}.title`), why: t(`${k}.why`, v), basis: v.items.map((i) => t(`${k}.basisItem`, i)).join('; ') }
    case 'garansi': return { title: t(`${k}.title`), why: t(`${k}.why`, v), basis: t(`${k}.basis`, { count: v.count, amount: `Rp${v.threshold.toLocaleString(locale())}` }) }
    case 'bundling': return { title: t(`${k}.title`, v), why: t(`${k}.why`, v), basis: t(`${k}.basis`, v) }
    case 'tertahan': return { title: t(`${k}.title`), why: t(`${k}.why`, v), basis: t(`${k}.basis`, v) }
    case 'marginkatalog': return { title: t(`${k}.title`), why: t(`${k}.why`, v), basis: o.basis }
    default: return { title: o.title, why: o.why, basis: o.basis }
  }
}
let currentTab = 'peluang'
// Kept outside render() so switching tabs does not reset what the user typed.
let catalogQuery = ''
let catalogStatus = 'all'
let skipDuplicates = true

const KIND_TONE = {
  langganan: 'brand', berkala: 'ok', garansi: 'warn', bundling: 'brand', tertahan: 'danger', marginkatalog: 'neutral',
}
const KIND_TO_CATEGORY = {
  langganan: 'paket', berkala: 'perawatan', garansi: 'perlindungan',
  bundling: 'peningkatan', tertahan: 'kecepatan', marginkatalog: 'lain',
}

/* ------------------------------------------------------------- Database */

async function fetchItems() {
  const { data, error } = await getCloud().database.from('vas_items').select('*')
  if (error) throw new Error(error.message)
  return (data || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

async function saveItem(fields, id) {
  // One validator for the form, the bulk import, the mock and the Worker.
  const row = validateVasItem(fields)
  const table = getCloud().database.from('vas_items')
  const { error } = id
    ? await table.update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : await table.insert(row)
  if (error) throw new Error(error.message)
  notifyDataChanged()
}

async function removeItem(id) {
  const { error } = await getCloud().database.from('vas_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
  notifyDataChanged()
}

/* --------------------------------------------------------------- Parsing */

/**
 * Accepts a JSON array or pipe/tab/semicolon separated lines.
 * Columns: nama | harga | biaya | kategori | layanan | tingkat pasang
 */
function parseBulk(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error(t('vas.parse.empty'))
  const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '')

  if (raw.startsWith('[')) {
    let rows
    try { rows = JSON.parse(raw) } catch { throw new Error(t('vas.parse.badJson')) }
    if (!Array.isArray(rows)) throw new Error(t('vas.parse.notArray'))
    const parsed = rows.map((r, i) => normalizeRow(r, i + 1, clean))
    assertImportSize(parsed.length)
    return parsed
  }

  const rows = raw.split('\n')
    .map((line, i) => ({ line: line.trim(), i: i + 1 }))
    .filter(({ line }) => line && !line.startsWith('#'))
    .map(({ line, i }) => {
      const parts = line.split(/\s*[|\t;]\s*/)
      return normalizeRow({
        name: parts[0], price: parts[1], cost: parts[2],
        category: parts[3], attach_to: parts[4], attach_rate: parts[5],
      }, i, clean)
    })
  assertImportSize(rows.length)
  return rows
}

/** One row through the shared validator; line numbers stay readable for pasted sheets. */
function normalizeRow(r, lineNo, clean) {
  const catRaw = clean(r.category ?? r.kategori).toLowerCase()
  try {
    return validateVasItem({
      name: clean(r.name ?? r.nama),
      price: r.price ?? r.harga,
      cost: r.cost ?? r.biaya ?? 0,
      category: VAS_CATEGORIES.some((c) => c.value === catRaw) ? catRaw : 'lain',
      attach_to: clean(r.attach_to ?? r.layanan),
      attach_rate: r.attach_rate ?? r.tingkat_pasang ?? 25,
      description: clean(r.description ?? r.keterangan),
      status: clean(r.status) || 'active',
    })
  } catch (err) {
    throw new Error(t('vas.parse.line', { line: lineNo, error: err.message }))
  }
}

/* ---------------------------------------------------------------- Render */

export async function render(container, ctx = {}) {
  let model = null
  let items = []
  let loadError = null
  const status = C.message()

  const host = el('div')
  const tabs = C.segmented({
    options: tabOptions(), value: currentTab, label: t('vas.tabsLabel'),
    onChange: (value) => { currentTab = value; status.hide(); draw() },
  })
  tabs.classList.add('workspace-tabs')

  const head = C.pageHeader({
    title: t('vas.page.title'), em: t('vas.page.em'),
    actions: C.button({ label: t('vas.page.newItem'), icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
  })
  // The tabs share the header row with the page action (one row instead of two).
  head.insertBefore(tabs, head.querySelector('.page-head-actions'))
  container.replaceChildren(head, status, host)

  function draw() {
    if (currentTab === 'peluang') drawPeluang()
    else if (currentTab === 'katalog') drawKatalog()
    else drawOptimasi()
  }

  /* ------------------------------------------------------------ Peluang */

  function drawPeluang() {
    const opportunities = discoverOpportunities(model, { catalog: items })
    const potential = opportunities.reduce((s, o) => s + o.potential, 0)
    const cat = catalogPotential(items)
    const share = vasRevenueShare(model?.ledger || [], items)
    const avgMargin = items.length
      ? items.reduce((s, i) => s + itemEconomics(i).marginPct, 0) / items.length
      : 0

    const kpis = el('div', { className: 'vas-kpis' },
      C.kpi({ label: t('vas.kpi.potential'), value: C.rupiah(potential), sub: t('vas.kpi.potentialSub'), iconName: 'trendingUp', hero: true }),
      C.kpi({ label: t('vas.kpi.open'), value: String(opportunities.length), sub: t('vas.kpi.openSub'), iconName: 'radar' }),
      C.kpi({ label: t('vas.kpi.catalogMargin'), value: C.rupiah(cat.monthly), sub: t('vas.kpi.activeItems', { count: cat.active }), iconName: 'wallet' }),
      C.kpi({ label: t('vas.kpi.share'), value: `${share.share.toFixed(1)}%`, sub: t('vas.kpi.shareSub', { amount: C.rupiah(share.revenue) }), iconName: 'chart' }),
    )

    const list = opportunities.length
      ? el('div', { className: 'vas-opps' }, opportunities.map(oppCard))
      : C.emptyState({
        kicker: t('vas.empty.kicker'),
        title: t('vas.empty.title'),
        body: t('vas.empty.body'),
        iconName: 'radar',
      })

    host.replaceChildren(
      kpis,
      el('div', { className: 'vas-section-head' },
        el('h2', { className: 'vas-section-title' }, t('vas.section.title')),
        el('span', { className: 'vas-section-note' }, t('vas.section.note', { pct: avgMargin.toFixed(0) })),
      ),
      list,
    )
  }

  function oppCard(o) {
    const text = oppText(o)
    const facts = [
      [t('vas.opp.price'), C.rupiah(o.price)],
      [t('vas.opp.perMonth'), String(o.jobsPerMonth)],
      [t('vas.opp.attach'), `${Math.round(o.attachRate * 100)}%`],
      [t('vas.opp.confidence'), `${Math.round(o.confidence * 100)}%`],
    ]
    return el('article', { className: 'vas-opp' },
      el('div', { className: 'vas-opp-top' },
        el('div', { className: 'vas-opp-id' },
          el('span', { className: 'vas-opp-kicker' }, C.tag(kindLabel(o.kind), KIND_TONE[o.kind] || 'neutral')),
          el('h3', { className: 'vas-opp-title' }, text.title),
        ),
        el('div', { className: 'vas-opp-money' },
          el('span', { className: 'vas-opp-money-label' }, t('vas.opp.potential')),
          el('span', { className: 'vas-opp-money-value tnum' }, C.rupiah(o.potential)),
        ),
      ),
      el('p', { className: 'vas-opp-why' }, text.why),
      el('dl', { className: 'vas-opp-facts' },
        facts.map(([k, v]) => el('div', { className: 'vas-opp-fact' },
          el('dt', {}, k), el('dd', { className: 'tnum' }, v)))),
      el('p', { className: 'vas-opp-basis' }, el('strong', {}, t('vas.opp.basis')), text.basis),
      el('div', { className: 'vas-opp-actions' },
        C.button({
          label: t('vas.opp.toCatalog'), icon: 'plus', size: 'sm', variant: 'soft',
          onClick: () => openEditor(null, {
            name: text.title, price: o.price, cost: Math.round(o.price * 0.2),
            category: KIND_TO_CATEGORY[o.kind] || 'lain', attach_rate: Math.round(o.attachRate * 100),
            description: text.why,
          }),
        }),
        C.button({
          label: t('vas.opp.discuss'), icon: 'zap', size: 'sm', variant: 'ghost',
          onClick: () => {
            currentTab = 'optimasi'
            tabs.querySelector('[data-value="optimasi"]')?.click()
          },
        }),
        el('span', { className: 'vas-opp-owner' }, t('vas.opp.owner', { owner: ownerLabel(o.owner) })),
      ),
    )
  }

  /* ------------------------------------------------------------- Katalog */

  let catalogList = null
  let catalogNote = null

  const filteredItems = () => filterRows(items, {
    query: catalogQuery,
    fields: ['name', 'description', 'attach_to', 'category'],
    filters: { status: catalogStatus },
  })

  function catalogTable(rows) {
    return C.dataTable({
      caption: t('vas.table.caption'),
      columns: [
        { key: 'name', label: t('vas.table.item'), render: (r) => C.cellStack(r.name, el('span', { className: 'vas-clamp' }, r.description || catLabel(r.category))) },
        { key: 'category', label: t('vas.table.category'), render: (r) => catLabel(r.category) },
        { key: 'price', label: t('vas.table.price'), align: 'right', render: (r) => C.rupiah(r.price) },
        { key: 'cost', label: t('vas.table.cost'), align: 'right', render: (r) => C.rupiah(r.cost) },
        {
          key: 'margin', label: t('vas.table.margin'), align: 'right',
          render: (r) => {
            const e = itemEconomics(r)
            return el('span', { className: `vas-margin ${e.marginPct < 25 ? 'is-thin' : ''}` },
              el('strong', { className: 'tnum' }, `${e.marginPct.toFixed(0)}%`),
              el('span', { className: 'tnum' }, C.rupiah(e.margin)))
          },
        },
        { key: 'attach_to', label: t('vas.table.attachTo'), render: (r) => r.attach_to || el('span', { className: 'muted' }, t('vas.table.allServices')) },
        { key: 'attach_rate', label: t('vas.table.attach'), align: 'right', render: (r) => `${Math.round(attachRate(r) * 100)}%` },
        { key: 'status', label: t('vas.table.status'), render: (r) => C.tag(stLabel(r.status), r.status === 'active' ? 'ok' : r.status === 'draft' ? 'warn' : 'neutral') },
        {
          key: 'act', label: '', className: 'vas-row-actions',
          render: (r) => el('div', { className: 'vas-row-actions-in' },
            C.iconButton({ iconName: 'pencil', label: t('vas.table.edit', { name: r.name }), onClick: () => openEditor(r) }),
            C.iconButton({ iconName: 'trash', label: t('vas.table.delete', { name: r.name }), onClick: () => confirmDelete(r) })),
        },
      ],
      rows,
    })
  }

  /** Redraws the table and the count line only — the search box keeps focus. */
  function refreshCatalog() {
    if (!catalogList) return
    const rows = filteredItems()
    catalogList.update(rows, { resetKey: `${catalogQuery}|${catalogStatus}` })
    const active = items.filter((i) => i.status === 'active').length
    const cat = catalogPotential(items)
    catalogNote.textContent = t('vas.catalog.note', { shown: rows.length, total: items.length, active, amount: C.rupiah(cat.monthly) })
  }

  function exportCatalog() {
    const rows = filteredItems()
    if (!rows.length) { showToast(t('vas.catalog.noRows'), 'warn'); return }
    downloadText(datedName('katalog-vas'), toCsv([
      { label: t('vas.table.item'), value: (r) => r.name },
      { label: t('vas.table.category'), value: (r) => catLabel(r.category) },
      { label: t('vas.table.price'), key: 'price' },
      { label: t('vas.table.cost'), key: 'cost' },
      { label: t('vas.table.margin'), value: (r) => itemEconomics(r).margin },
      { label: t('vas.csv.marginPct'), value: (r) => Math.round(itemEconomics(r).marginPct) },
      { label: t('vas.csv.parent'), value: (r) => r.attach_to || '' },
      { label: t('vas.opp.attach'), key: 'attach_rate' },
      { label: t('vas.table.status'), value: (r) => stLabel(r.status) },
      { label: t('vas.csv.created'), value: (r) => r.created_at || '' },
    ], rows))
    showToast(t('vas.catalog.exported', { count: rows.length }), 'success')
  }

  function drawKatalog() {
    const search = el('input', {
      type: 'search',
      className: 'pd-search',
      value: catalogQuery,
      placeholder: t('vas.catalog.searchPlaceholder'),
      'aria-label': t('vas.catalog.searchLabel'),
    })
    search.addEventListener('input', debounce(() => { catalogQuery = search.value; refreshCatalog() }, 150))

    const statusFilter = el('select', { className: 'pd-filter', 'aria-label': t('vas.catalog.filterLabel') },
      [{ value: 'all', label: t('vas.catalog.allStatuses') }, ...stOptions()].map((o) => el('option', { value: o.value }, o.label)))
    statusFilter.value = catalogStatus
    statusFilter.addEventListener('change', () => { catalogStatus = statusFilter.value; refreshCatalog() })

    catalogNote = el('span', { className: 'vas-toolbar-note' })

    // "Item baru" lives in the page header; the toolbar only holds list tools.
    const toolbar = el('div', { className: 'vas-toolbar' },
      C.button({ label: t('vas.catalog.bulk'), icon: 'layers', size: 'sm', onClick: openBulk }),
      el('div', { className: 'pd-filters' }, search, statusFilter),
      C.button({ label: t('vas.catalog.export'), icon: 'file', size: 'sm', variant: 'ghost', onClick: exportCatalog }),
      catalogNote,
    )

    if (!items.length) {
      catalogList = null
      host.replaceChildren(toolbar, C.emptyState({
        kicker: t('vas.catalog.emptyKicker'),
        title: t('vas.catalog.emptyTitle'),
        body: t('vas.catalog.emptyBody'),
        iconName: 'layers',
        action: C.button({ label: t('vas.catalog.addFirst'), icon: 'plus', variant: 'primary', onClick: () => openEditor(null) }),
      }))
      catalogNote.textContent = t('vas.catalog.emptyNote')
      return
    }

    catalogList = C.paginate({
      key: 'vas-katalog',
      label: t('vas.catalog.pagerLabel'),
      pageSize: 10,
      render: (rows) => (rows.length
        ? catalogTable(rows)
        : el('p', { className: 'pd-none' }, t('vas.catalog.noMatch'))),
    })
    host.replaceChildren(toolbar, catalogList.root)
    refreshCatalog()
  }

  /* ------------------------------------------------------------- Optimasi */

  function drawOptimasi() {
    const opportunities = discoverOpportunities(model, { catalog: items })
    const cat = catalogPotential(items)
    const share = vasRevenueShare(model?.ledger || [], items)
    const avgJob = (() => {
      const revenue = (model?.ledger || []).filter((l) => l.category === 'pendapatan').reduce((s, l) => s + (Number(l.amount) || 0), 0)
      const jobs = model?.completions?.length || 0
      return jobs ? revenue / jobs : 0
    })()

    const context = [
      `Cakupan: VAS (layanan tambahan)`,
      `Pendapatan tercatat: ${C.rupiah(share.revenue)}`,
      `Jumlah pekerjaan selesai: ${model?.completions?.length || 0}`,
      `Rata-rata nilai pekerjaan: ${C.rupiah(avgJob)}`,
      `Jumlah permintaan tercatat: ${model?.requests?.length || 0}`,
      `Item VAS aktif: ${cat.active} dari ${items.length}`,
      `Potensi margin katalog: ${C.rupiah(cat.monthly)} per bulan`,
      `Porsi pendapatan dari VAS: ${share.share.toFixed(1)}%`,
      `Peluang terdeteksi: ${opportunities.length}`,
      ...opportunities.slice(0, 4).map((o) => `- ${o.title}: harga ${C.rupiah(o.price)}, potensi ${C.rupiah(o.potential)}/bulan, keyakinan ${Math.round(o.confidence * 100)}%`),
    ].join('\n')

    const facts = [
      { label: t('vas.facts.revenue'), value: C.rupiah(share.revenue) },
      { label: t('vas.facts.avgJob'), value: C.rupiah(avgJob) },
      { label: t('vas.facts.activeItems'), value: String(cat.active) },
      { label: t('vas.facts.catalogPotential'), value: t('vas.facts.perMonth', { amount: C.rupiah(cat.monthly) }) },
      { label: t('vas.facts.detected'), value: String(opportunities.length) },
    ]

    const presets = [
      {
        label: t('vas.presets.offer.label'),
        problem: t('vas.presets.offer.problem'),
        target: 2000000,
      },
      {
        label: t('vas.presets.contract.label'),
        problem: t('vas.presets.contract.problem'),
        target: 3000000,
      },
      {
        label: t('vas.presets.margin.label'),
        problem: t('vas.presets.margin.problem'),
        target: 1000000,
      },
    ]

    renderOptimasi(host, ctx, { scope: 'vas', context, facts, presets })
  }

  /* --------------------------------------------------------------- Modals */

  function openEditor(existing, preset) {
    const seed = existing || preset || {}
    const isEdit = Boolean(existing)
    const name = C.field({ label: t('vas.editor.name'), id: 'vas-name', required: true, value: seed.name || '', placeholder: t('vas.editor.namePlaceholder') })
    const category = C.select({
      label: t('vas.editor.category'), id: 'vas-cat', options: catOptions(), value: seed.category || 'perawatan',
    })
    const price = C.field({ label: t('vas.editor.price'), id: 'vas-price', type: 'number', required: true, value: seed.price ?? '', attrs: { min: '0', step: '5000', inputmode: 'numeric' } })
    const cost = C.field({ label: t('vas.editor.cost'), id: 'vas-cost', type: 'number', value: seed.cost ?? 0, hint: t('vas.editor.costHint'), attrs: { min: '0', step: '5000', inputmode: 'numeric' } })
    const attachTo = C.field({ label: t('vas.editor.attachTo'), id: 'vas-attach', value: seed.attach_to || '', placeholder: t('vas.editor.attachPlaceholder'), hint: t('vas.editor.attachHint') })
    const rate = C.field({ label: t('vas.editor.rate'), id: 'vas-rate', type: 'number', value: seed.attach_rate ?? 25, hint: t('vas.editor.rateHint'), attrs: { min: '0', max: '100', step: '5' } })
    const desc = C.textarea({ label: t('vas.editor.desc'), id: 'vas-desc', rows: 3, value: seed.description || '', placeholder: t('vas.editor.descPlaceholder') })
    const statusSel = C.select({ label: t('vas.editor.status'), id: 'vas-status', options: stOptions(), value: seed.status || 'active' })

    const marginNote = el('p', { className: 'vas-margin-note' }, t('vas.editor.marginAuto'))
    const recompute = () => {
      const e = itemEconomics({ price: price.input.value, cost: cost.input.value })
      marginNote.textContent = t('vas.editor.margin', { amount: C.rupiah(e.margin), pct: e.marginPct.toFixed(0) })
      marginNote.classList.toggle('is-thin', e.marginPct < 25)
    }
    price.input.addEventListener('input', recompute)
    cost.input.addEventListener('input', recompute)
    recompute()

    const saveBtn = C.button({ label: isEdit ? t('vas.editor.save') : t('vas.editor.add'), variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: isEdit ? t('vas.editor.editTitle') : t('vas.editor.newTitle'),
      description: t('vas.editor.description'),
      wide: true,
      children: [
        modalNote,
        el('div', { className: 'vas-form-grid' }, name.wrap, category.wrap),
        el('div', { className: 'vas-form-grid' }, price.wrap, cost.wrap),
        marginNote,
        el('div', { className: 'vas-form-grid' }, attachTo.wrap, rate.wrap),
        desc.wrap,
        statusSel.wrap,
      ],
      actions: [C.button({ label: t('vas.common.cancel'), variant: 'ghost', dismiss: true }), saveBtn],
      opener: container,
    })

    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      if (!name.input.value.trim()) { name.input.focus(); modalNote.show('warn', t('vas.editor.nameRequired')); return }
      if (!(Number(price.input.value) > 0)) { price.input.focus(); modalNote.show('warn', t('vas.editor.priceRequired')); return }
      const restore = C.setBusy(saveBtn, t('vas.common.saving'))
      try {
        await saveItem({
          name: name.input.value, category: category.input.value, price: price.input.value,
          cost: cost.input.value, attach_to: attachTo.input.value, attach_rate: rate.input.value,
          description: desc.input.value, status: statusSel.input.value,
        }, existing?.id)
        dialog.close()
        status.hide()
        showToast(isEdit ? t('vas.editor.updated') : t('vas.editor.added'), 'success')
        await reload()
      } catch (err) {
        modalNote.show('danger', err.message)
      } finally { restore() }
    })
  }

  function confirmDelete(item) {
    const delBtn = C.button({ label: t('vas.delete.confirm'), variant: 'danger' })
    const dialog = C.modal({
      title: t('vas.delete.title'),
      description: t('vas.delete.description', { name: item.name }),
      children: [el('p', { className: 'vas-muted' }, t('vas.delete.irreversible'))],
      actions: [C.button({ label: t('vas.common.cancel'), variant: 'ghost', dismiss: true }), delBtn],
      opener: container,
    })
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      const restore = C.setBusy(delBtn, t('vas.delete.busy'))
      try {
        await removeItem(item.id)
        dialog.close()
        showToast(t('vas.delete.done'), 'success')
        await reload()
      } catch (err) { status.show('danger', err.message) } finally { restore() }
    })
  }

  function openBulk() {
    const ta = C.textarea({
      label: t('vas.bulk.label'),
      id: 'vas-bulk',
      rows: 10,
      hint: t('vas.bulk.hint'),
      placeholder: t('vas.bulk.placeholder'),
    })
    const fileInput = el('input', { type: 'file', accept: '.json,.csv,.txt', className: 'vas-file' })
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      try { ta.input.value = await file.text() } catch { status.show('danger', t('vas.bulk.unreadable')) }
    })

    const preview = el('div', { className: 'vas-bulk-preview' })
    const skip = el('input', { type: 'checkbox', id: 'vas-bulk-skip', checked: skipDuplicates })
    skip.addEventListener('change', () => { skipDuplicates = skip.checked; check() })
    const skipWrap = el('label', { className: 'pd-check', for: 'vas-bulk-skip' },
      skip, el('span', {}, t('vas.bulk.skip')))

    const split = () => {
      const rows = parseBulk(ta.input.value)
      return { rows, ...splitDuplicates(rows, items, (r) => vasKey(r.name)) }
    }

    const check = () => {
      try {
        const { fresh, duplicates } = split()
        preview.className = 'vas-bulk-preview is-ok'
        const extra = duplicates.length ? t('vas.bulk.dupes', { count: duplicates.length, skipped: skip.checked ? t('vas.bulk.andSkipped') : '' }) : ''
        preview.textContent = t('vas.bulk.preview', { count: fresh.length, extra, name: fresh[0]?.name || duplicates[0]?.name, price: C.rupiah(fresh[0]?.price || duplicates[0]?.price || 0) })
      } catch (err) {
        preview.className = 'vas-bulk-preview is-bad'
        preview.textContent = err.message
      }
    }
    ta.input.addEventListener('input', check)

    const importBtn = C.button({ label: t('vas.bulk.import'), variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: t('vas.bulk.title'),
      description: t('vas.bulk.description'),
      wide: true,
      children: [modalNote, el('div', { className: 'vas-bulk-file' }, el('span', {}, t('vas.bulk.pickFile')), fileInput), ta.wrap, skipWrap, preview],
      actions: [C.button({ label: t('vas.common.cancel'), variant: 'ghost', dismiss: true }), importBtn],
      opener: container,
    })

    importBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      let plan
      try { plan = split() } catch (err) { modalNote.show('warn', err.message); return }
      const rows = skip.checked ? plan.fresh : plan.rows
      const skipped = plan.rows.length - rows.length
      if (!rows.length) { modalNote.show('warn', t('vas.bulk.allDupes')); return }
      const restore = C.setBusy(importBtn, t('vas.bulk.importing'))
      try {
        const { error } = await getCloud().database.from('vas_items').insert(rows)
        if (error) throw new Error(error.message)
        dialog.close()
        showToast(t('vas.bulk.done', { count: rows.length, skipped: skipped ? t('vas.bulk.skippedCount', { count: skipped }) : '' }), 'success')
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
      label: t('vas.load.retry'), icon: 'refresh', size: 'sm',
      onClick: () => { host.replaceChildren(C.skeletonRows(4)); reload() },
    })
    box.querySelector('.note-body')?.appendChild(el('div', { className: 'note-actions' }, retry))
    return box
  }

  async function reload() {
    try {
      const [m, list] = await Promise.all([loadFlow(), fetchItems()])
      model = m
      items = list
      loadError = null
    } catch (err) { loadError = err }
    if (ctx.signal?.aborted) return
    if (loadError) {
      status.show('danger', t('vas.load.failed', { error: loadError.message }))
      host.replaceChildren(errorView(loadError.message))
      return
    }
    draw()
  }

  host.replaceChildren(C.skeletonRows(4))
  await reload()
}

function kindLabel(kind) {
  return KIND_TONE[kind] ? t(`vas.kind.${kind}`) : kind
}

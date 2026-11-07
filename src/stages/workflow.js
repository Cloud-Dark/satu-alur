/**
 * Alur kerja — one table, one row per job (permintaan), from request to
 * bookkeeping. The status column says how far each job has gone; the action
 * button opens the stage page that does the next step, already pointed at it.
 * This table is the only list of jobs: the stage pages each show one job.
 *
 * URL: #/app/alur-kerja?posisi=<filter>&q=<search>; #/app/alur-kerja/<id> opens the job detail.
 */
import * as C from '../ui/components.js'
import { loadFlow } from './data.js'
import { loadInvoices } from '../invoice/api.js'
import { statusLabel as invoiceStatusLabel, STATUSES as INVOICE_STATUSES } from '../invoice/rules.js'
import '../styles/workflow.css'
import { openWaDialog } from '../ui/wa-dialog.js'
import { followUpMessage } from '../wa/rules.js'
import { STEPS, FILTERS, workflowRows, filterCounts, matchesQuery, timeline } from '../domain/workflow.js'
import { t, has } from '../i18n/index.js'

// Labels from domain/workflow.js stay Indonesian there (shared with the worker); they are
// translated here, keyed by their stable values.
const stepLabel = (s) => t(`workflow.steps.${s.key}`)
const filterLabel = (f) => t(`workflow.filters.${f.value}`)
const invoiceStatusText = (s) => (has(`invoice.status.${s}`) ? t(`invoice.status.${s}`) : invoiceStatusLabel(s))
const STATUS_KEY = {
  'Belum ada penawaran': 'new', 'Penawaran draf': 'draft', 'Penawaran ditolak': 'rejected', 'Disetujui, belum ditugaskan': 'approved',
  'Sedang dikerjakan': 'working', 'Selesai, belum dibukukan': 'completed', 'Selesai & dibukukan': 'booked',
  'Ditugaskan, belum mulai': 'notStarted', 'Lewat jadwal': 'overdue', Ditunda: 'onHold',
}
const statusText = (row) => (STATUS_KEY[row.status.label] ? t(`workflow.status.${STATUS_KEY[row.status.label]}`) : row.status.label)
function nextLabel(row) {
  if (row.key === 'booked') return t(row.invoice ? 'workflow.next.viewInvoice' : 'workflow.next.createInvoice')
  return has(`workflow.next.${row.key}`) ? t(`workflow.next.${row.key}`) : row.next?.label
}
/** One-line note under a timeline step, rebuilt from the row in the current language. */
function timelineNote(it, row) {
  const { request, offer, assignment, completion, ledger } = row
  switch (it.key) {
    case 'request': return [request.service_type, request.location].filter(Boolean).join(' · ') || t('workflow.note.requestLogged')
    case 'offer': return offer ? t(`workflow.note.offer.${offer.status === 'approved' ? 'approved' : offer.status === 'rejected' ? 'rejected' : 'draft'}`) : t('workflow.note.offer.none')
    case 'assign': return assignment ? t('workflow.note.worker', { name: assignment.worker_name || '—' }) : t('workflow.note.notAssigned')
    case 'complete': return completion ? (completion.notes || t('workflow.note.jobDone')) : t('workflow.note.notDone')
    case 'bookkeeping': return ledger.length ? t('workflow.note.entries', { count: ledger.length }) : t('workflow.note.notBooked')
    default: return it.note
  }
}

const { el } = C

const FILTER_KEY = 'satualur_workflow_filter'
const FILTER_ICON = { all: 'layers', request: 'inbox', offer: 'sparkles', assign: 'users', work: 'clock', book: 'ledger', done: 'checkCircle' }

const session = {
  get(k) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k, v) { try { sessionStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

/** Index in STEPS of the step this job waits on (STEPS.length = all done). */
const NEXT_STEP = { new: 1, draft: 1, rejected: 1, approved: 2, working: 3, completed: 4, booked: 5 }
const nextStep = (row) => NEXT_STEP[row.key] ?? row.step

function currentStageLabel(row) {
  return row.done ? stepLabel(STEPS[4]) : stepLabel(STEPS[Math.min(nextStep(row), STEPS.length - 1)])
}

/** Five dots on a line: done, current, still to do. */
function stepper(row) {
  const current = nextStep(row)
  const label = row.done ? t('workflow.stepper.allDone') : t('workflow.stepper.stepOf', { n: current + 1, total: STEPS.length, label: stepLabel(STEPS[current]) })
  return el('div', { className: 'wf-steps', role: 'img', 'aria-label': label, title: label },
    STEPS.map((s, i) => {
      const state = i < current ? 'done' : i === current ? 'current' : 'todo'
      return el('span', { className: `wf-step is-${state}${state === 'current' && row.key === 'rejected' ? ' is-danger' : ''}` },
        el('i', { className: 'wf-dot', 'aria-hidden': 'true' }),
        el('span', { className: 'wf-step-label' }, stepLabel(s)))
    }))
}

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  let rows = []
  const params = ctx.params || {}
  const validFilter = (v) => FILTERS.some((f) => f.value === v)
  // The URL wins (deep link, Back); otherwise the filter last used in this tab.
  let filter = validFilter(params.filter) ? params.filter : validFilter(session.get(FILTER_KEY)) ? session.get(FILTER_KEY) : 'all'
  if (validFilter(params.filter)) session.set(FILTER_KEY, filter)

  const intro = el('p', { className: 'wf-intro muted' },
    t('workflow.intro.before'),
    el('b', {}, t('workflow.col.position')), t('workflow.intro.middle'), el('b', {}, t('workflow.col.next')), t('workflow.intro.after'))

  const filterBar = el('div', { className: 'wf-filters', role: 'group', 'aria-label': t('workflow.filterAria') })
  const search = el('input', { type: 'search', className: 'input input-sm', placeholder: t('workflow.searchPlaceholder'), 'aria-label': t('workflow.searchAria') })
  const searchBox = el('label', { className: 'search-box' }, C.icon('search', { size: 16 }), search)
  const listBody = el('div', { className: 'list-body' }, C.skeletonRows(5))
  const listPanel = C.panel({ title: t('workflow.listTitle'), meta: t('workflow.loading'), actions: searchBox, className: 'list-panel wf-panel' }, listBody)
  const pg = C.pager({ key: 'workflow', label: t('workflow.pagerLabel'), onChange: () => drawList(), scrollTarget: listPanel })

  container.replaceChildren(
    C.pageHeader({ title: t('workflow.title') }),
    intro,
    filterBar,
    listPanel,
  )

  function drawFilters() {
    const counts = filterCounts(rows)
    filterBar.replaceChildren(...FILTERS.map((f) => {
      const on = f.value === filter
      const b = el('button', {
        type: 'button',
        className: `wf-filter${on ? ' is-active' : ''}${f.value !== 'all' && counts[f.value] ? ' has-items' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        dataset: { filter: f.value },
      },
        el('span', { className: 'wf-filter-top' },
          el('span', { className: 'wf-filter-count tnum' }, String(counts[f.value] || 0)),
          el('span', { className: 'wf-filter-ico', 'aria-hidden': 'true' }, C.icon(FILTER_ICON[f.value], { size: 16 }))),
        el('span', { className: 'wf-filter-label' }, filterLabel(f)),
        el('span', { className: 'wf-filter-hint' }, t(`workflow.filterHint.${f.value}`)))
      b.addEventListener('click', () => {
        filter = on && f.value !== 'all' ? 'all' : f.value
        session.set(FILTER_KEY, filter)
        syncRoute()
        drawFilters()
        drawList()
      })
      return b
    }))
  }

  function actionButton(row, { variant = 'soft', onBefore } = {}) {
    const n = row.next
    if (!n) return el('span', { className: 'muted nil' }, '—')
    const b = C.button({ label: nextLabel(row), iconRight: 'arrowRight', size: 'sm', variant: n.optional ? 'ghost' : variant, className: 'wf-next' })
    b.setAttribute('aria-label', t('workflow.nextAria', { action: nextLabel(row), customer: row.customer }))
    b.addEventListener('click', (e) => { e.stopPropagation(); onBefore?.(); navigate(n.stage, n.params) })
    return b
  }

  function drawList() {
    const q = search.value.trim()
    const shown = rows.filter((r) => (filter === 'all' || r.filter === filter) && matchesQuery(r, q))
    const meta = listPanel.querySelector('.panel-meta')
    meta.textContent = shown.length === rows.length ? t('workflow.meta.all', { count: rows.length }) : t('workflow.meta.some', { shown: shown.length, count: rows.length })
    if (!rows.length) {
      const start = C.button({ label: t('workflow.empty.start'), icon: 'plus', variant: 'primary', size: 'sm' })
      start.addEventListener('click', () => navigate('request'))
      listBody.replaceChildren(C.emptyState({ kicker: t('workflow.empty.kicker'), title: t('workflow.empty.title'), body: t('workflow.empty.body'), action: start }))
      return
    }
    if (!shown.length) {
      listBody.replaceChildren(C.emptyState({ kicker: t('workflow.notFound.kicker'), title: q ? t('workflow.notFound.query', { q }) : t('workflow.notFound.filter') }))
      return
    }
    listBody.replaceChildren(C.dataTable({
      caption: t('workflow.caption'),
      rows: pg.slice(shown, { resetKey: `${filter}|${q}` }),
      rowAttrs: (r) => ({ className: 'wf-row', dataset: { id: String(r.id), position: r.key } }),
      columns: [
        {
          label: t('workflow.col.customer'),
          render: (r) => {
            const open = el('button', { type: 'button', className: 'wf-open', title: t('workflow.openDetail') },
              el('span', { className: 'cell-id tnum' }, `#${r.id}`), r.customer)
            open.addEventListener('click', () => openDetail(r, open))
            return el('div', { className: 'cell-stack' },
              el('span', { className: 'cell-primary' }, open),
              el('span', { className: 'cell-secondary' }, [r.service, r.location].filter(Boolean).join(' · ') || '—'))
          },
        },
        {
          label: t('workflow.col.position'),
          className: 'col-wf-pos',
          render: (r) => el('div', { className: 'wf-pos' },
            el('span', { className: 'wf-pos-stage' }, r.done ? t('workflow.pos.done') : t('workflow.pos.at', { stage: currentStageLabel(r) })),
            stepper(r)),
        },
        {
          label: t('workflow.col.status'),
          render: (r) => el('div', { className: 'wf-status' },
            C.tag(statusText(r), r.status.tone),
            r.worker && (r.key === 'working' || r.key === 'completed') ? el('span', { className: 'cell-secondary' }, t('workflow.note.worker', { name: r.worker })) : null,
            r.invoice ? el('span', { className: 'cell-secondary' }, t('workflow.invoiceStatus', { status: invoiceStatusText(r.invoice.status) })) : null),
        },
        { label: t('workflow.col.value'), align: 'right', render: (r) => (r.price != null ? el('span', { className: 'tnum' }, C.rupiah(r.price)) : null) },
        {
          label: t('workflow.col.updated'),
          className: 'col-date',
          render: (r) => (r.updatedAt ? el('time', { className: 'tnum', datetime: r.updatedAt, title: C.formatDateTime(r.updatedAt) }, C.relativeTime(r.updatedAt)) : null),
        },
        { label: t('workflow.col.next'), className: 'col-action', render: (r) => actionButton(r) },
      ],
    }), pg.root)
  }

  const routeParams = () => ({ filter: filter === 'all' ? undefined : filter, q: search.value.trim() || undefined })
  const syncRoute = () => ctx.setRoute?.(routeParams())

  function openDetail(row, opener) {
    const { items, invoice } = timeline(row)
    let dlg = null
    const list = el('ol', { className: 'wf-timeline' }, items.map((it) => {
      // Every stage page shows this one job; the request itself is summed up right here.
      const go = it.stage === 'request' ? null : C.button({ label: t('workflow.detail.open', { stage: stepLabel(it).toLowerCase() }), size: 'sm', variant: 'ghost', iconRight: 'arrowRight' })
      go?.addEventListener('click', () => { dlg?.close(); navigate(it.stage, it.params) })
      return el('li', { className: `wf-tl is-${it.state}` },
        el('span', { className: 'wf-tl-dot', 'aria-hidden': 'true' }, it.state === 'done' ? C.icon('check', { size: 12 }) : null),
        el('div', { className: 'wf-tl-body' },
          el('div', { className: 'wf-tl-head' },
            el('span', { className: 'wf-tl-label' }, stepLabel(it)),
            el('span', { className: 'sr-only' }, it.state === 'done' ? t('workflow.detail.srDone') : it.state === 'current' ? t('workflow.detail.srCurrent') : t('workflow.detail.srTodo')),
            it.date ? el('time', { className: 'wf-tl-date tnum', datetime: it.date }, C.formatDate(it.date)) : null),
          el('p', { className: 'wf-tl-note' }, timelineNote(it, row),
            it.money != null ? ` · ${C.rupiah(it.money)}` : '',
            it.revenue != null ? t('workflow.detail.money', { revenue: C.rupiah(it.revenue), cost: C.rupiah(it.cost) }) : ''),
          it.state !== 'todo' && Object.keys(it.params || {}).length ? go : null))
    }))
    const facts = C.defList([
      [t('workflow.detail.service'), row.service || '—'],
      [t('workflow.detail.location'), row.location || '—'],
      [t('workflow.detail.phone'), row.request.phone || '—'],
      ...(row.request.email ? [[t('workflow.detail.email'), row.request.email]] : []),
      ...(row.request.website ? [[t('workflow.detail.website'), row.request.website]] : []),
      [t('workflow.detail.offerValue'), row.price != null ? C.rupiah(row.price) : '—'],
      [t('workflow.col.status'), C.tag(statusText(row), row.status.tone)],
      [t('workflow.detail.invoice'), invoice ? C.tag(`${invoice.number || t('workflow.detail.invoice')} · ${invoiceStatusText(invoice.status)}`, INVOICE_STATUSES.find((s) => s.value === invoice.status)?.tone || 'neutral') : '—'],
    ])
    const close = C.button({ label: t('workflow.detail.close'), variant: 'ghost', dismiss: true })
    const actions = [close]
    // Follow up with the customer on WhatsApp (needs their phone).
    if (row.request.phone) {
      const wa = C.button({ label: t('workflow.detail.wa'), icon: 'send', variant: 'ghost' })
      wa.setAttribute('aria-label', t('workflow.detail.waAria', { customer: row.customer }))
      wa.addEventListener('click', () => {
        dlg?.close()
        openWaDialog({
          requestId: row.id, customer: row.customer, phone: row.request.phone, kind: 'followup', opener, openSettings: ctx.openSettings,
          text: followUpMessage({ customer: row.request.customer_name, service: row.request.service_type, business: ctx.user?.name }),
        })
      })
      actions.push(wa)
    }
    if (row.next) actions.push(actionButton(row, { variant: 'primary', onBefore: () => dlg?.close() }))
    dlg = C.modal({
      title: `#${row.id} · ${row.customer}`,
      description: row.done ? t('workflow.detail.doneDesc') : t('workflow.detail.posDesc', { stage: currentStageLabel(row), status: statusText(row).toLowerCase() }),
      children: [facts, el('h3', { className: 'wf-tl-title' }, t('workflow.detail.journey')), list],
      actions,
      opener,
      wide: true,
    })
    dlg.dialog.classList.add('wf-detail')
    dlg.dialog.dataset.id = String(row.id)
    ctx.routeDialog?.(dlg.dialog, { ...routeParams(), id: row.id })
  }

  search.addEventListener('input', () => { syncRoute(); drawList() })
  // Opened with a search (e.g. from Waguri's "Buka di Alur kerja"): show that customer's rows.
  if (params.q) { search.value = String(params.q); if (!validFilter(params.filter)) filter = 'all' }
  syncRoute()
  let detailPending = params.id != null ? String(params.id) : null

  async function load() {
    try {
      const [model, invoices] = await Promise.all([loadFlow(), loadInvoices().catch(() => [])])
      if (ctx.signal?.aborted) return
      rows = workflowRows(model, { invoices })
        .sort((a, b) => Number(a.done) - Number(b.done) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    } catch (err) {
      if (ctx.signal?.aborted) return
      listBody.replaceChildren(C.errorState(t('workflow.loadError', { error: err.message })))
      return
    }
    drawFilters()
    drawList()
    // #/app/alur-kerja/<id>: open that job's detail once the rows are there.
    if (detailPending) {
      const row = rows.find((r) => String(r.id) === detailPending)
      detailPending = null
      if (row) openDetail(row, null)
    }
  }
  window.addEventListener('satualur:data-changed', load, { signal: ctx.signal })
  await load()
}

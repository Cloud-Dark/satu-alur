/**
 * Alur kerja — one table, one row per job (permintaan), from request to
 * bookkeeping. The status column says how far each job has gone; the action
 * button opens the stage page that does the next step, already pointed at it.
 */
import * as C from '../ui/components.js'
import { loadFlow } from './data.js'
import { loadInvoices } from '../invoice/api.js'
import { statusLabel as invoiceStatusLabel, STATUSES as INVOICE_STATUSES } from '../invoice/rules.js'
import '../styles/workflow.css'
import { STEPS, FILTERS, workflowRows, filterCounts, matchesQuery, timeline } from '../domain/workflow.js'

const { el } = C

const FILTER_KEY = 'satualur_workflow_filter'
const FILTER_HINT = {
  all: 'Semua pekerjaan',
  request: 'Belum ada penawaran',
  offer: 'Draf atau ditolak',
  assign: 'Penawaran disetujui',
  work: 'Sedang dikerjakan petugas',
  book: 'Selesai, belum dibukukan',
  done: 'Sudah dibukukan',
}
const FILTER_ICON = { all: 'layers', request: 'inbox', offer: 'sparkles', assign: 'users', work: 'clock', book: 'ledger', done: 'checkCircle' }

const session = {
  get(k) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k, v) { try { sessionStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

/** Index in STEPS of the step this job waits on (STEPS.length = all done). */
const NEXT_STEP = { new: 1, draft: 1, rejected: 1, approved: 2, working: 3, completed: 4, booked: 5 }
const nextStep = (row) => NEXT_STEP[row.key] ?? row.step

function currentStageLabel(row) {
  return row.done ? 'Pembukuan' : STEPS[Math.min(nextStep(row), STEPS.length - 1)].label
}

/** Five dots on a line: done, current, still to do. */
function stepper(row) {
  const current = nextStep(row)
  const label = row.done ? 'Semua tahap selesai' : `Tahap ${current + 1} dari ${STEPS.length}: ${STEPS[current].label}`
  return el('div', { className: 'wf-steps', role: 'img', 'aria-label': label, title: label },
    STEPS.map((s, i) => {
      const state = i < current ? 'done' : i === current ? 'current' : 'todo'
      return el('span', { className: `wf-step is-${state}${state === 'current' && row.key === 'rejected' ? ' is-danger' : ''}` },
        el('i', { className: 'wf-dot', 'aria-hidden': 'true' }),
        el('span', { className: 'wf-step-label' }, s.label))
    }))
}

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  let rows = []
  let filter = FILTERS.some((f) => f.value === session.get(FILTER_KEY)) ? session.get(FILTER_KEY) : 'all'

  const intro = el('p', { className: 'wf-intro muted' },
    'Satu baris = satu pekerjaan pelanggan, dari permintaan sampai pembukuan. Lihat kolom ',
    el('b', {}, 'Posisi'), ' untuk tahu sudah sampai mana, lalu tekan tombol di kolom ', el('b', {}, 'Langkah berikutnya'), '.')

  // The per-stage pages (full lists of every offer, assignment, …) stay one click away.
  const stageLinks = el('nav', { className: 'wf-stage-links', 'aria-label': 'Buka halaman per tahap' },
    el('span', { className: 'wf-stage-links-label' }, 'Buka per tahap:'),
    STEPS.map((s, i) => {
      const a = el('button', { type: 'button', className: 'wf-stage-link', dataset: { stage: s.stage } }, el('span', { className: 'tnum' }, `${i + 1}`), s.label)
      a.addEventListener('click', () => navigate(s.stage))
      return a
    }))

  const filterBar = el('div', { className: 'wf-filters', role: 'group', 'aria-label': 'Saring menurut posisi alur' })
  const search = el('input', { type: 'search', className: 'input input-sm', placeholder: 'Cari pelanggan, layanan, petugas, #nomor', 'aria-label': 'Cari pekerjaan' })
  const searchBox = el('label', { className: 'search-box' }, C.icon('search', { size: 16 }), search)
  const listBody = el('div', { className: 'list-body' }, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar alur kerja', meta: 'memuat…', actions: searchBox, className: 'list-panel wf-panel' }, listBody)
  const pg = C.pager({ key: 'workflow', label: 'daftar alur kerja', onChange: () => drawList(), scrollTarget: listPanel })

  container.replaceChildren(
    C.pageHeader({ title: 'Alur kerja' }),
    intro,
    filterBar,
    stageLinks,
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
        el('span', { className: 'wf-filter-label' }, f.label),
        el('span', { className: 'wf-filter-hint' }, FILTER_HINT[f.value]))
      b.addEventListener('click', () => {
        filter = on && f.value !== 'all' ? 'all' : f.value
        session.set(FILTER_KEY, filter)
        drawFilters()
        drawList()
      })
      return b
    }))
  }

  function actionButton(row, { variant = 'soft', onBefore } = {}) {
    const n = row.next
    if (!n) return el('span', { className: 'muted nil' }, '—')
    const b = C.button({ label: n.label, iconRight: 'arrowRight', size: 'sm', variant: n.optional ? 'ghost' : variant, className: 'wf-next' })
    b.setAttribute('aria-label', `${n.label} untuk ${row.customer}`)
    b.addEventListener('click', (e) => { e.stopPropagation(); onBefore?.(); navigate(n.stage, n.params) })
    return b
  }

  function drawList() {
    const q = search.value.trim()
    const shown = rows.filter((r) => (filter === 'all' || r.filter === filter) && matchesQuery(r, q))
    const meta = listPanel.querySelector('.panel-meta')
    meta.textContent = shown.length === rows.length ? `${rows.length} pekerjaan` : `${shown.length} dari ${rows.length} pekerjaan`
    if (!rows.length) {
      const start = C.button({ label: 'Catat permintaan pertama', icon: 'plus', variant: 'primary', size: 'sm' })
      start.addEventListener('click', () => navigate('request'))
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada pekerjaan.', body: 'Setiap permintaan pelanggan yang Anda catat muncul di sini sebagai satu baris, lalu bergerak sampai selesai dibukukan.', action: start }))
      return
    }
    if (!shown.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Tidak ditemukan', title: q ? `Tidak ada yang cocok dengan "${q}".` : 'Tidak ada pekerjaan di posisi ini.' }))
      return
    }
    listBody.replaceChildren(C.dataTable({
      caption: 'Daftar alur kerja: satu baris per pekerjaan',
      rows: pg.slice(shown, { resetKey: `${filter}|${q}` }),
      rowAttrs: (r) => ({ className: 'wf-row', dataset: { id: String(r.id), position: r.key } }),
      columns: [
        {
          label: 'Pelanggan',
          render: (r) => {
            const open = el('button', { type: 'button', className: 'wf-open', title: 'Lihat detail alur' },
              el('span', { className: 'cell-id tnum' }, `#${r.id}`), r.customer)
            open.addEventListener('click', () => openDetail(r, open))
            return el('div', { className: 'cell-stack' },
              el('span', { className: 'cell-primary' }, open),
              el('span', { className: 'cell-secondary' }, [r.service, r.location].filter(Boolean).join(' · ') || '—'))
          },
        },
        {
          label: 'Posisi',
          className: 'col-wf-pos',
          render: (r) => el('div', { className: 'wf-pos' },
            el('span', { className: 'wf-pos-stage' }, r.done ? 'Selesai' : `Di ${currentStageLabel(r)}`),
            stepper(r)),
        },
        {
          label: 'Status',
          render: (r) => el('div', { className: 'wf-status' },
            C.tag(r.status.label, r.status.tone),
            r.worker && (r.key === 'working' || r.key === 'completed') ? el('span', { className: 'cell-secondary' }, `Petugas: ${r.worker}`) : null,
            r.invoice ? el('span', { className: 'cell-secondary' }, `Invoice: ${invoiceStatusLabel(r.invoice.status)}`) : null),
        },
        { label: 'Nilai', align: 'right', render: (r) => (r.price != null ? el('span', { className: 'tnum' }, C.rupiah(r.price)) : null) },
        {
          label: 'Diperbarui',
          className: 'col-date',
          render: (r) => (r.updatedAt ? el('time', { className: 'tnum', datetime: r.updatedAt, title: C.formatDateTime(r.updatedAt) }, C.relativeTime(r.updatedAt)) : null),
        },
        { label: 'Langkah berikutnya', className: 'col-action', render: (r) => actionButton(r) },
      ],
    }), pg.root)
  }

  function openDetail(row, opener) {
    const { items, invoice } = timeline(row)
    let dlg = null
    const list = el('ol', { className: 'wf-timeline' }, items.map((it) => {
      const go = C.button({ label: `Buka ${it.label.toLowerCase()}`, size: 'sm', variant: 'ghost', iconRight: 'arrowRight' })
      go.addEventListener('click', () => { dlg?.close(); navigate(it.stage, it.params) })
      return el('li', { className: `wf-tl is-${it.state}` },
        el('span', { className: 'wf-tl-dot', 'aria-hidden': 'true' }, it.state === 'done' ? C.icon('check', { size: 12 }) : null),
        el('div', { className: 'wf-tl-body' },
          el('div', { className: 'wf-tl-head' },
            el('span', { className: 'wf-tl-label' }, it.label),
            el('span', { className: 'sr-only' }, it.state === 'done' ? ' (selesai)' : it.state === 'current' ? ' (posisi sekarang)' : ' (belum)'),
            it.date ? el('time', { className: 'wf-tl-date tnum', datetime: it.date }, C.formatDate(it.date)) : null),
          el('p', { className: 'wf-tl-note' }, it.note,
            it.money != null ? ` · ${C.rupiah(it.money)}` : '',
            it.revenue != null ? ` · Pendapatan ${C.rupiah(it.revenue)}, biaya ${C.rupiah(it.cost)}` : ''),
          it.state !== 'todo' ? go : null))
    }))
    const facts = C.defList([
      ['Layanan', row.service || '—'],
      ['Lokasi', row.location || '—'],
      ['Telepon', row.request.phone || '—'],
      ...(row.request.email ? [['Email', row.request.email]] : []),
      ...(row.request.website ? [['Website / kontak lain', row.request.website]] : []),
      ['Nilai penawaran', row.price != null ? C.rupiah(row.price) : '—'],
      ['Status', C.tag(row.status.label, row.status.tone)],
      ['Invoice', invoice ? C.tag(`${invoice.number || 'Invoice'} · ${invoiceStatusLabel(invoice.status)}`, INVOICE_STATUSES.find((s) => s.value === invoice.status)?.tone || 'neutral') : '—'],
    ])
    const close = C.button({ label: 'Tutup', variant: 'ghost', dismiss: true })
    const actions = [close]
    if (row.next) actions.push(actionButton(row, { variant: 'primary', onBefore: () => dlg?.close() }))
    dlg = C.modal({
      title: `#${row.id} · ${row.customer}`,
      description: row.done ? 'Pekerjaan ini sudah selesai dan dibukukan.' : `Posisi sekarang: ${currentStageLabel(row)} — ${row.status.label.toLowerCase()}.`,
      children: [facts, el('h3', { className: 'wf-tl-title' }, 'Perjalanan pekerjaan'), list],
      actions,
      opener,
      wide: true,
    })
  }

  search.addEventListener('input', () => drawList())
  // Opened with a search (e.g. from Waguri's "Buka di Alur kerja"): show that customer's rows.
  if (ctx.params?.q) { search.value = String(ctx.params.q); filter = 'all' }

  async function load() {
    try {
      const [model, invoices] = await Promise.all([loadFlow(), loadInvoices().catch(() => [])])
      if (ctx.signal?.aborted) return
      rows = workflowRows(model, { invoices })
        .sort((a, b) => Number(a.done) - Number(b.done) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    } catch (err) {
      if (ctx.signal?.aborted) return
      listBody.replaceChildren(C.errorState(`Gagal memuat alur kerja: ${err.message}`))
      return
    }
    drawFilters()
    drawList()
  }
  window.addEventListener('satualur:data-changed', load, { signal: ctx.signal })
  await load()
}

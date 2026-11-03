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

const { el, icon } = C
const TABS = [
  { value: 'pemborosan', label: 'Pemborosan' },
  { value: 'tindakan', label: 'Tindakan' },
  { value: 'optimasi', label: 'Ruang optimasi' },
]
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
    options: TABS, value: currentTab, label: 'Tanpa limbah',
    onChange: (value) => { currentTab = value; status.hide(); draw() },
  })
  tabs.classList.add('workspace-tabs')

  container.replaceChildren(
    C.pageHeader({
      title: 'Bebas limbah', em: 'limbah',
      actions: C.button({ label: 'Catat temuan', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
    }),
    tabs, status, host,
  )

  const revenue = () => (model?.ledger || [])
    .filter((l) => l.category === 'pendapatan')
    .reduce((s, l) => s + (Number(l.amount) || 0), 0)

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
    svg.setAttribute('aria-label', `Bebas limbah ${freePct} persen`)
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
      el('span', { className: 'zw-ring-caption' }, 'bebas limbah')))

    const hero = el('div', { className: 'zw-hero' },
      ring,
      el('div', { className: 'zw-hero-body' },
        el('h2', { className: 'zw-hero-title' }, freePct >= 100
          ? 'Tidak ada kerugian tercatat yang tersisa'
          : `${C.rupiah(w.remaining)} masih bocor setiap bulan`),
        el('p', { className: 'zw-hero-text' }, w.loss
          ? `Dari ${C.rupiah(w.loss)} kerugian yang pernah Anda catat, ${C.rupiah(w.saved)} sudah dihentikan. Sisa ${w.remaining > 0 ? `${C.rupiah(w.remaining)}` : 'nol'} sama dengan ${w.lossShare.toFixed(1)}% dari pendapatan tercatat.`
          : 'Belum ada kerugian yang dicatat. Catat satu temuan pertama supaya target 100% bebas limbah punya titik awal yang jujur.'),
        el('div', { className: 'zw-hero-actions' },
          C.button({ label: 'Catat temuan', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
          C.button({ label: 'Lihat tindakan', iconRight: 'arrowRight', size: 'sm', variant: 'ghost', onClick: () => tabs.querySelector('[data-value="tindakan"]')?.click() })),
      ),
    )

    const kpis = el('div', { className: 'zw-kpis' },
      C.kpi({ label: 'Sisa kerugian', value: C.rupiah(w.remaining), sub: `${w.lossShare.toFixed(1)}% dari pendapatan`, iconName: 'trendingDown' }),
      C.kpi({ label: 'Sudah dihentikan', value: C.rupiah(w.saved), sub: `dari ${C.rupiah(w.loss)} tercatat`, iconName: 'checkCircle' }),
      C.kpi({ label: 'Masih bisa dihemat', value: C.rupiah(w.winnable), sub: `${w.open} temuan terbuka`, iconName: 'target' }),
      C.kpi({ label: 'Temuan selesai', value: String(w.done), sub: 'sudah ditutup', iconName: 'flag' }),
    )

    const streamCards = el('div', { className: 'zw-streams' }, w.streams.map((s) => {
      const verdict = benchmarkVerdict(s, revenue())
      return el('article', { className: 'zw-stream', 'data-tone': verdict.tone },
        el('header', { className: 'zw-stream-head' },
          el('span', { className: 'zw-stream-ico', 'aria-hidden': 'true' }, icon(s.icon, { size: 18 })),
          el('div', { className: 'zw-stream-id' },
            el('h3', { className: 'zw-stream-name' }, s.short),
            el('p', { className: 'zw-stream-sub' }, `${s.rows.length} temuan · ${s.open} terbuka`),
          ),
          C.tag(verdict.label, verdict.tone),
        ),
        el('div', { className: 'zw-stream-money' },
          el('span', { className: 'zw-stream-money-value tnum' }, C.rupiah(s.remaining)),
          el('span', { className: 'zw-stream-money-label' }, 'sisa / bulan'),
        ),
        el('div', { className: 'zw-bar', role: 'img', 'aria-label': `Terhentikan ${Math.round(s.pct)} persen` },
          el('span', { className: 'zw-bar-fill', style: `width:${Math.max(0, Math.min(100, s.pct))}%` })),
        el('div', { className: 'zw-stream-foot' },
          el('span', { className: 'tnum' }, `${Math.round(s.pct)}% terhenti`),
          el('span', { className: 'tnum' }, `patokan ${s.benchmark}% pendapatan`),
        ),
        el('p', { className: 'zw-stream-why' }, s.why),
      )
    }))

    const planPanel = plan.length
      ? C.panel({ title: 'Jalan terpendek menuju nol', meta: 'Diurutkan dari kebocoran terbesar' },
        el('ol', { className: 'zw-plan' }, plan.map((p) => el('li', { className: 'zw-plan-item' },
          el('div', { className: 'zw-plan-head' },
            el('span', { className: 'zw-plan-name' }, p.label),
            el('span', { className: 'zw-plan-value tnum' }, C.rupiah(p.remaining))),
          el('p', { className: 'zw-plan-action' }, p.action),
          el('div', { className: 'zw-bar is-thin', role: 'img', 'aria-label': `Terhentikan ${Math.round(p.pct)} persen` },
            el('span', { className: 'zw-bar-fill', style: `width:${Math.max(0, Math.min(100, p.pct))}%` })),
        ))))
      : C.panel({ title: 'Jalan terpendek menuju nol' },
        el('p', { className: 'zw-muted' }, 'Semua stream sudah bersih. Pertahankan dengan pemeriksaan bulanan.'))

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
      caption: 'Temuan pemborosan dan tindakannya',
      columns: [
        { key: 'title', label: 'Temuan', render: (r) => C.cellStack(r.title, el('span', { className: 'zw-clamp' }, r.detail || streamMeta(r.stream).label)) },
        { key: 'stream', label: 'Sumber', render: (r) => streamMeta(r.stream).short },
        { key: 'monthly_loss', label: 'Kerugian/bln', align: 'right', render: (r) => C.rupiah(r.monthly_loss) },
        { key: 'saved', label: 'Terhenti', align: 'right', render: (r) => C.rupiah(r.saved) },
        {
          key: 'remaining', label: 'Sisa', align: 'right',
          render: (r) => {
            const left = Math.max(0, (Number(r.monthly_loss) || 0) - (Number(r.saved) || 0))
            return el('strong', { className: `tnum ${left > 0 ? 'zw-left' : ''}` }, C.rupiah(left))
          },
        },
        { key: 'owner', label: 'Pemilik', render: (r) => r.owner || el('span', { className: 'muted' }, '—') },
        { key: 'status', label: 'Status', render: (r) => C.tag(statusLabel(r.status), STATUS_TONE[r.status] || 'neutral') },
        {
          key: 'act', label: '', className: 'zw-row-actions',
          render: (r) => el('div', { className: 'zw-row-actions-in' },
            r.status !== 'done'
              ? C.iconButton({ iconName: 'check', label: `Tandai selesai: ${r.title}`, onClick: () => markDone(r) })
              : null,
            C.iconButton({ iconName: 'pencil', label: `Ubah ${r.title}`, onClick: () => openEditor(r) }),
            C.iconButton({ iconName: 'trash', label: `Hapus ${r.title}`, onClick: () => confirmDelete(r) })),
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
    entryNote.textContent = `${rows.length} dari ${entries.length} temuan · ${w.open} terbuka · ${C.rupiah(w.winnable)} bisa dihemat`
  }

  function exportEntries() {
    const rows = filteredEntries()
    if (!rows.length) { showToast('Tidak ada baris untuk diekspor.', 'warn'); return }
    downloadText(datedName('temuan-limbah'), toCsv([
      { label: 'Temuan', value: (r) => r.title },
      { label: 'Sumber', value: (r) => streamMeta(r.stream).label },
      { label: 'Kerugian per bulan', key: 'monthly_loss' },
      { label: 'Sudah dihentikan', key: 'saved' },
      { label: 'Sisa', value: (r) => Math.max(0, (Number(r.monthly_loss) || 0) - (Number(r.saved) || 0)) },
      { label: 'Tindakan', value: (r) => r.action || '' },
      { label: 'Pemilik', value: (r) => r.owner || '' },
      { label: 'Status', value: (r) => statusLabel(r.status) },
      { label: 'Dibuat', value: (r) => r.created_at || '' },
    ], rows))
    showToast(`${rows.length} temuan diekspor ke CSV.`, 'success')
  }

  function drawActions() {
    const search = el('input', {
      type: 'search',
      className: 'pd-search',
      value: entryQuery,
      placeholder: 'Cari temuan, tindakan, atau pemilik…',
      'aria-label': 'Cari temuan pemborosan',
    })
    search.addEventListener('input', debounce(() => { entryQuery = search.value; refreshEntries() }, 150))

    const streamFilter = el('select', { className: 'pd-filter', 'aria-label': 'Saring sumber pemborosan' },
      [{ value: 'all', label: 'Semua sumber' }, ...WASTE_STREAMS.map((s) => ({ value: s.key, label: s.short }))]
        .map((o) => el('option', { value: o.value }, o.label)))
    streamFilter.value = entryStream
    streamFilter.addEventListener('change', () => { entryStream = streamFilter.value; refreshEntries() })

    const statusFilter = el('select', { className: 'pd-filter', 'aria-label': 'Saring status temuan' },
      [{ value: 'all', label: 'Semua status' }, ...WASTE_STATUSES].map((o) => el('option', { value: o.value }, o.label)))
    statusFilter.value = entryStatus
    statusFilter.addEventListener('change', () => { entryStatus = statusFilter.value; refreshEntries() })

    entryNote = el('span', { className: 'zw-toolbar-note' })
    const toolbar = el('div', { className: 'zw-toolbar' },
      C.button({ label: 'Catat temuan', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
      C.button({ label: 'Impor massal', icon: 'layers', size: 'sm', onClick: openBulk }),
      el('div', { className: 'pd-filters' }, search, streamFilter, statusFilter),
      C.button({ label: 'Ekspor CSV', icon: 'file', size: 'sm', variant: 'ghost', onClick: exportEntries }),
      entryNote,
    )

    if (!entries.length) {
      entryList = null
      host.replaceChildren(toolbar, C.emptyState({
        kicker: 'Belum ada temuan',
        title: 'Mulai dari kebocoran yang paling Anda rasakan',
        body: 'Contoh: teknisi menunggu bahan 45 menit per pekerjaan, atau kunjungan ulang karena noda tidak hilang. Setiap temuan butuh angka kerugian per bulan.',
        iconName: 'sprout',
        action: C.button({ label: 'Catat temuan pertama', icon: 'plus', variant: 'primary', onClick: () => openEditor(null) }),
      }))
      entryNote.textContent = '0 temuan'
      return
    }

    entryList = C.paginate({
      key: 'zw-tindakan',
      label: 'temuan pemborosan',
      pageSize: 10,
      render: (rows) => (rows.length
        ? entryTable(rows)
        : el('p', { className: 'pd-none' }, 'Tidak ada temuan yang cocok. Ubah kata kunci atau saringan.')),
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
      `Sisa kerugian: ${C.rupiah(w.remaining)} (${w.lossShare.toFixed(1)}% dari pendapatan)`,
      `Temuan terbuka: ${w.open}, selesai: ${w.done}`,
      `Masih bisa dihemat: ${C.rupiah(w.winnable)}`,
      `Sumber terbesar: ${top[0]?.remaining > 0 ? top[0].label : 'Tidak ada'}`,
      'Rincian per sumber:',
      ...w.streams.map((s) => `- ${s.label}: sisa ${C.rupiah(s.remaining)}, terhenti ${Math.round(s.pct)}%, patokan sehat ${s.benchmark}% dari pendapatan`),
      ...plan.map((p) => `- Langkah disarankan untuk ${p.label}: ${p.action}`),
    ].join('\n')

    const facts = [
      { label: 'Pendapatan', value: C.rupiah(rev) },
      { label: 'Kerugian tercatat', value: `${C.rupiah(w.loss)}/bln` },
      { label: 'Sisa kerugian', value: `${C.rupiah(w.remaining)}/bln` },
      { label: 'Sudah terhenti', value: `${w.pct.toFixed(0)}%` },
      { label: 'Temuan terbuka', value: String(w.open) },
      { label: 'Sumber terbesar', value: top[0]?.remaining > 0 ? top[0].short : 'Tidak ada' },
    ]

    const presets = [
      {
        label: 'Hentikan kunjungan ulang',
        problem: 'Pekerjaan ulang dan panggilan balik memakan biaya. Saya ingin menekan angka ini sampai nol tanpa memperlambat tim.',
        target: 1500000,
      },
      {
        label: 'Rapikan rute & bahan bakar',
        problem: 'Biaya perjalanan naik karena jadwal tidak diurutkan. Saya ingin menghemat bahan bakar dan jam kerja yang hilang di jalan.',
        target: 800000,
      },
      {
        label: 'Target 100% bebas limbah',
        problem: 'Saya ingin menutup semua kebocoran yang tercatat dan mencapai nol kerugian bulanan dalam tiga bulan.',
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
      label: 'Sumber pemborosan', id: 'zw-stream',
      options: WASTE_STREAMS.map((s) => ({ value: s.key, label: s.label })),
      value: seed.stream || 'waktu',
      hint: 'Pilih satu sumber supaya laporan tidak tercampur.',
    })
    const title = C.field({ label: 'Apa yang bocor', id: 'zw-title', required: true, value: seed.title || '', placeholder: 'Contoh: Teknisi menunggu bahan di gudang' })
    const detail = C.textarea({ label: 'Bagaimana hal itu terjadi', id: 'zw-detail', rows: 3, value: seed.detail || '', placeholder: 'Kapan, di mana, dan seberapa sering.' })
    const loss = C.field({ label: 'Kerugian per bulan (Rp)', id: 'zw-loss', type: 'number', required: true, value: seed.monthly_loss ?? '', hint: 'Perkiraan yang jujur lebih berguna daripada angka yang terlihat bagus.', attrs: { min: '0', step: '50000', inputmode: 'numeric' } })
    const saved = C.field({ label: 'Sudah dihentikan per bulan (Rp)', id: 'zw-saved', type: 'number', value: seed.saved ?? 0, hint: 'Isi nol bila belum ada yang dikerjakan.', attrs: { min: '0', step: '50000', inputmode: 'numeric' } })
    const action = C.textarea({ label: 'Tindakan', id: 'zw-action', rows: 2, value: seed.action || '', placeholder: 'Apa yang akan atau sudah dilakukan.' })
    const owner = C.field({ label: 'Pemilik tindakan', id: 'zw-owner', value: seed.owner || '', placeholder: 'Contoh: Tim Operasional' })
    const statusSel = C.select({ label: 'Status', id: 'zw-status', options: WASTE_STATUSES, value: seed.status || 'open' })

    const saveBtn = C.button({ label: isEdit ? 'Simpan perubahan' : 'Catat temuan', variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: isEdit ? 'Ubah temuan' : 'Temuan pemborosan baru',
      description: 'Satu temuan = satu kebocoran dengan angka dan pemilik. Ini yang membuat target 100% bisa diukur.',
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
      actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), saveBtn],
      opener: container,
    })

    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      if (!title.input.value.trim()) { title.input.focus(); modalNote.show('warn', 'Tulis dulu apa yang bocor.'); return }
      if (!(Number(loss.input.value) > 0)) { loss.input.focus(); modalNote.show('warn', 'Kerugian per bulan harus lebih dari nol.'); return }
      if (Number(saved.input.value) > Number(loss.input.value)) {
        saved.input.focus(); modalNote.show('warn', 'Yang sudah dihentikan tidak boleh melebihi kerugian tercatat.'); return
      }
      const restore = C.setBusy(saveBtn, 'Menyimpan…')
      try {
        await saveEntry({
          stream: stream.input.value, title: title.input.value, detail: detail.input.value,
          monthly_loss: loss.input.value, saved: saved.input.value,
          action: action.input.value, owner: owner.input.value, status: statusSel.input.value,
        }, existing?.id)
        dialog.close()
        status.hide()
        showToast(isEdit ? 'Temuan diperbarui.' : 'Temuan dicatat.', 'success')
        await reload()
      } catch (err) { modalNote.show('danger', err.message) } finally { restore() }
    })
  }

  async function markDone(entry) {
    try {
      await closeEntry(entry)
      showToast('Temuan ditutup, kerugian dihitung terhenti.', 'success')
      await reload()
    } catch (err) { status.show('danger', err.message) }
  }

  function confirmDelete(entry) {
    const delBtn = C.button({ label: 'Hapus', variant: 'danger' })
    const dialog = C.modal({
      title: 'Hapus temuan?',
      description: `"${entry.title}" akan dihapus dan tidak lagi dihitung dalam target bebas limbah.`,
      children: [el('p', { className: 'zw-muted' }, 'Tindakan ini tidak bisa dibatalkan.')],
      actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), delBtn],
      opener: container,
    })
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      const restore = C.setBusy(delBtn, 'Menghapus…')
      try {
        await removeEntry(entry.id)
        dialog.close()
        showToast('Temuan dihapus.', 'success')
        await reload()
      } catch (err) { status.show('danger', err.message) } finally { restore() }
    })
  }

  function openBulk() {
    const ta = C.textarea({
      label: 'Tempel data',
      id: 'zw-bulk',
      rows: 10,
      hint: 'JSON array, atau satu baris per temuan: sumber | judul | kerugian | terhenti | pemilik | status. Sumber: waktu, perjalanan, bahan, pengerjaan_ulang, air_kimia.',
      placeholder: 'perjalanan | Rute tidak diurutkan antar kecamatan | 900000 | 0 | Tim Operasional | open\nbahan | Dosis kimia berlebih pada kolam kecil | 400000 | 150000 | Tim Operasional | progress',
    })
    const preview = el('div', { className: 'zw-bulk-preview' })
    const skip = el('input', { type: 'checkbox', id: 'zw-bulk-skip', checked: skipDuplicates })
    skip.addEventListener('change', () => { skipDuplicates = skip.checked; check() })
    const skipWrap = el('label', { className: 'pd-check', for: 'zw-bulk-skip' },
      skip, el('span', {}, 'Lewati temuan dengan judul yang sudah ada'))

    const split = () => {
      const rows = parseBulk(ta.input.value)
      return { rows, ...splitDuplicates(rows, entries, (r) => wasteKey(r.title)) }
    }

    const check = () => {
      try {
        const { fresh, duplicates } = split()
        preview.className = 'zw-bulk-preview is-ok'
        const extra = duplicates.length ? ` · ${duplicates.length} sudah ada${skip.checked ? ' dan dilewati' : ''}` : ''
        const sample = fresh[0] || duplicates[0]
        preview.textContent = `${fresh.length} temuan baru${extra}. Contoh: ${sample?.title} — ${C.rupiah(sample?.monthly_loss || 0)}`
      } catch (err) {
        preview.className = 'zw-bulk-preview is-bad'
        preview.textContent = err.message
      }
    }
    ta.input.addEventListener('input', check)

    const importBtn = C.button({ label: 'Impor', variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: 'Impor massal temuan',
      description: 'Tempel dari spreadsheet. Seluruh baris ditolak bila ada satu yang tidak valid, supaya hitungan tidak setengah jadi.',
      wide: true,
      children: [modalNote, ta.wrap, skipWrap, preview],
      actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), importBtn],
      opener: container,
    })

    importBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      let plan
      try { plan = split() } catch (err) { modalNote.show('warn', err.message); return }
      const rows = skip.checked ? plan.fresh : plan.rows
      const skipped = plan.rows.length - rows.length
      if (!rows.length) { modalNote.show('warn', 'Semua temuan sudah ada. Tidak ada yang diimpor.'); return }
      const restore = C.setBusy(importBtn, 'Mengimpor…')
      try {
        const { error } = await getCloud().database.from('waste_entries').insert(rows)
        if (error) throw new Error(error.message)
        dialog.close()
        showToast(`${rows.length} temuan diimpor${skipped ? `, ${skipped} dilewati` : ''}.`, 'success')
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
      label: 'Coba lagi', icon: 'refresh', size: 'sm',
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
      status.show('danger', `Gagal memuat data: ${err.message}`)
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
    throw new Error(`Baris ${lineNo}: ${err.message}`)
  }
}

function parseBulk(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('Tidak ada data untuk diimpor.')
  if (raw.startsWith('[')) {
    let rows
    try { rows = JSON.parse(raw) } catch { throw new Error('JSON tidak valid. Periksa koma dan tanda kutip.') }
    if (!Array.isArray(rows)) throw new Error('JSON harus berupa daftar temuan.')
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

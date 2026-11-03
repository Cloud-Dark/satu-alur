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

const { el } = C
const TABS = [
  { value: 'peluang', label: 'Peluang' },
  { value: 'katalog', label: 'Katalog' },
  { value: 'optimasi', label: 'Ruang optimasi' },
]
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
  if (!raw) throw new Error('Tidak ada data untuk diimpor.')
  const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '')

  if (raw.startsWith('[')) {
    let rows
    try { rows = JSON.parse(raw) } catch { throw new Error('JSON tidak valid. Periksa koma dan tanda kutip.') }
    if (!Array.isArray(rows)) throw new Error('JSON harus berupa daftar item.')
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
    throw new Error(`Baris ${lineNo}: ${err.message}`)
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
    options: TABS, value: currentTab, label: 'Layanan tambahan',
    onChange: (value) => { currentTab = value; status.hide(); draw() },
  })
  tabs.classList.add('workspace-tabs')

  container.replaceChildren(
    C.pageHeader({
      title: 'Pendapatan tambahan', em: 'tambahan',
      actions: C.button({ label: 'Item baru', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
    }),
    tabs, status, host,
  )

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
      C.kpi({ label: 'Potensi bulanan', value: C.rupiah(potential), sub: 'dari peluang yang terdeteksi', iconName: 'trendingUp', hero: true }),
      C.kpi({ label: 'Peluang terbuka', value: String(opportunities.length), sub: 'dihitung dari data Anda', iconName: 'radar' }),
      C.kpi({ label: 'Margin katalog', value: C.rupiah(cat.monthly), sub: `${cat.active} item aktif`, iconName: 'wallet' }),
      C.kpi({ label: 'Porsi VAS', value: `${share.share.toFixed(1)}%`, sub: `dari ${C.rupiah(share.revenue)} pendapatan`, iconName: 'chart' }),
    )

    const list = opportunities.length
      ? el('div', { className: 'vas-opps' }, opportunities.map(oppCard))
      : C.emptyState({
        kicker: 'Belum ada peluang',
        title: 'Catat beberapa permintaan dan penyelesaian dulu',
        body: 'Peluang dihitung dari pekerjaan yang sudah Anda catat. Setelah ada riwayat, halaman ini akan menunjuk pelanggan dan layanan yang siap ditawari tambahan.',
        iconName: 'radar',
      })

    host.replaceChildren(
      kpis,
      el('div', { className: 'vas-section-head' },
        el('h2', { className: 'vas-section-title' }, 'Peluang dari pekerjaan Anda'),
        el('span', { className: 'vas-section-note' }, `Margin rata-rata katalog ${avgMargin.toFixed(0)}% · angka diperbarui setiap halaman dibuka`),
      ),
      list,
    )
  }

  function oppCard(o) {
    const facts = [
      ['Harga saran', C.rupiah(o.price)],
      ['Pelanggan/bulan', String(o.jobsPerMonth)],
      ['Tingkat pasang', `${Math.round(o.attachRate * 100)}%`],
      ['Keyakinan', `${Math.round(o.confidence * 100)}%`],
    ]
    return el('article', { className: 'vas-opp' },
      el('div', { className: 'vas-opp-top' },
        el('div', { className: 'vas-opp-id' },
          el('span', { className: 'vas-opp-kicker' }, C.tag(kindLabel(o.kind), KIND_TONE[o.kind] || 'neutral')),
          el('h3', { className: 'vas-opp-title' }, o.title),
        ),
        el('div', { className: 'vas-opp-money' },
          el('span', { className: 'vas-opp-money-label' }, 'Potensi/bulan'),
          el('span', { className: 'vas-opp-money-value tnum' }, C.rupiah(o.potential)),
        ),
      ),
      el('p', { className: 'vas-opp-why' }, o.why),
      el('dl', { className: 'vas-opp-facts' },
        facts.map(([k, v]) => el('div', { className: 'vas-opp-fact' },
          el('dt', {}, k), el('dd', { className: 'tnum' }, v)))),
      el('p', { className: 'vas-opp-basis' }, el('strong', {}, 'Dasar: '), o.basis),
      el('div', { className: 'vas-opp-actions' },
        C.button({
          label: 'Jadikan item katalog', icon: 'plus', size: 'sm', variant: 'soft',
          onClick: () => openEditor(null, {
            name: o.title, price: o.price, cost: Math.round(o.price * 0.2),
            category: KIND_TO_CATEGORY[o.kind] || 'lain', attach_rate: Math.round(o.attachRate * 100),
            description: o.why,
          }),
        }),
        C.button({
          label: 'Bahas 5 tim', icon: 'zap', size: 'sm', variant: 'ghost',
          onClick: () => {
            currentTab = 'optimasi'
            tabs.querySelector('[data-value="optimasi"]')?.click()
          },
        }),
        el('span', { className: 'vas-opp-owner' }, `Pemilik: ${o.owner}`),
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
      caption: 'Katalog layanan tambahan',
      columns: [
        { key: 'name', label: 'Item', render: (r) => C.cellStack(r.name, el('span', { className: 'vas-clamp' }, r.description || categoryLabel(r.category))) },
        { key: 'category', label: 'Kategori', render: (r) => categoryLabel(r.category) },
        { key: 'price', label: 'Harga', align: 'right', render: (r) => C.rupiah(r.price) },
        { key: 'cost', label: 'Biaya', align: 'right', render: (r) => C.rupiah(r.cost) },
        {
          key: 'margin', label: 'Margin', align: 'right',
          render: (r) => {
            const e = itemEconomics(r)
            return el('span', { className: `vas-margin ${e.marginPct < 25 ? 'is-thin' : ''}` },
              el('strong', { className: 'tnum' }, `${e.marginPct.toFixed(0)}%`),
              el('span', { className: 'tnum' }, C.rupiah(e.margin)))
          },
        },
        { key: 'attach_to', label: 'Menempel pada', render: (r) => r.attach_to || el('span', { className: 'muted' }, 'Semua layanan') },
        { key: 'attach_rate', label: 'Pasang', align: 'right', render: (r) => `${Math.round(attachRate(r) * 100)}%` },
        { key: 'status', label: 'Status', render: (r) => C.tag(statusLabel(r.status), r.status === 'active' ? 'ok' : r.status === 'draft' ? 'warn' : 'neutral') },
        {
          key: 'act', label: '', className: 'vas-row-actions',
          render: (r) => el('div', { className: 'vas-row-actions-in' },
            C.iconButton({ iconName: 'pencil', label: `Ubah ${r.name}`, onClick: () => openEditor(r) }),
            C.iconButton({ iconName: 'trash', label: `Hapus ${r.name}`, onClick: () => confirmDelete(r) })),
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
    catalogNote.textContent = `${rows.length} dari ${items.length} item · ${active} aktif · potensi ${C.rupiah(cat.monthly)}/bulan`
  }

  function exportCatalog() {
    const rows = filteredItems()
    if (!rows.length) { showToast('Tidak ada baris untuk diekspor.', 'warn'); return }
    downloadText(datedName('katalog-vas'), toCsv([
      { label: 'Item', value: (r) => r.name },
      { label: 'Kategori', value: (r) => categoryLabel(r.category) },
      { label: 'Harga', key: 'price' },
      { label: 'Biaya', key: 'cost' },
      { label: 'Margin', value: (r) => itemEconomics(r).margin },
      { label: 'Margin persen', value: (r) => Math.round(itemEconomics(r).marginPct) },
      { label: 'Layanan induk', value: (r) => r.attach_to || '' },
      { label: 'Tingkat pasang', key: 'attach_rate' },
      { label: 'Status', value: (r) => statusLabel(r.status) },
      { label: 'Dibuat', value: (r) => r.created_at || '' },
    ], rows))
    showToast(`${rows.length} item diekspor ke CSV.`, 'success')
  }

  function drawKatalog() {
    const search = el('input', {
      type: 'search',
      className: 'pd-search',
      value: catalogQuery,
      placeholder: 'Cari item, layanan induk, atau kategori…',
      'aria-label': 'Cari item katalog',
    })
    search.addEventListener('input', debounce(() => { catalogQuery = search.value; refreshCatalog() }, 150))

    const statusFilter = el('select', { className: 'pd-filter', 'aria-label': 'Saring status item' },
      [{ value: 'all', label: 'Semua status' }, ...VAS_STATUSES].map((o) => el('option', { value: o.value }, o.label)))
    statusFilter.value = catalogStatus
    statusFilter.addEventListener('change', () => { catalogStatus = statusFilter.value; refreshCatalog() })

    catalogNote = el('span', { className: 'vas-toolbar-note' })

    const toolbar = el('div', { className: 'vas-toolbar' },
      C.button({ label: 'Tambah item', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openEditor(null) }),
      C.button({ label: 'Impor massal', icon: 'layers', size: 'sm', onClick: openBulk }),
      el('div', { className: 'pd-filters' }, search, statusFilter),
      C.button({ label: 'Ekspor CSV', icon: 'file', size: 'sm', variant: 'ghost', onClick: exportCatalog }),
      catalogNote,
    )

    if (!items.length) {
      catalogList = null
      host.replaceChildren(toolbar, C.emptyState({
        kicker: 'Katalog kosong',
        title: 'Belum ada layanan tambahan',
        body: 'Tambahkan satu item, atau tempel daftar harga Anda sekaligus lewat Impor massal.',
        iconName: 'layers',
        action: C.button({ label: 'Tambah item pertama', icon: 'plus', variant: 'primary', onClick: () => openEditor(null) }),
      }))
      catalogNote.textContent = '0 item · potensi Rp0/bulan'
      return
    }

    catalogList = C.paginate({
      key: 'vas-katalog',
      label: 'katalog layanan tambahan',
      pageSize: 10,
      render: (rows) => (rows.length
        ? catalogTable(rows)
        : el('p', { className: 'pd-none' }, 'Tidak ada item yang cocok. Ubah kata kunci atau saringan status.')),
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
      { label: 'Pendapatan tercatat', value: C.rupiah(share.revenue) },
      { label: 'Rata-rata pekerjaan', value: C.rupiah(avgJob) },
      { label: 'Item VAS aktif', value: String(cat.active) },
      { label: 'Potensi katalog', value: `${C.rupiah(cat.monthly)}/bln` },
      { label: 'Peluang terdeteksi', value: String(opportunities.length) },
    ]

    const presets = [
      {
        label: 'Naikkan nilai penawaran',
        problem: 'Nilai penawaran saya berhenti di jasa dasar. Saya ingin setiap penawaran membawa satu layanan tambahan yang relevan tanpa membuat pelanggan menolak.',
        target: 2000000,
      },
      {
        label: 'Kontrak perawatan bulanan',
        problem: 'Saya ingin mengubah pelanggan berulang menjadi kontrak perawatan bulanan supaya pendapatan lebih pasti.',
        target: 3000000,
      },
      {
        label: 'Perbaiki margin katalog',
        problem: 'Beberapa item tambahan saya dijual terlalu murah. Saya ingin tahu mana yang harus dinaikkan harganya atau dihentikan.',
        target: 1000000,
      },
    ]

    renderOptimasi(host, ctx, { scope: 'vas', context, facts, presets })
  }

  /* --------------------------------------------------------------- Modals */

  function openEditor(existing, preset) {
    const seed = existing || preset || {}
    const isEdit = Boolean(existing)
    const name = C.field({ label: 'Nama item', id: 'vas-name', required: true, value: seed.name || '', placeholder: 'Contoh: Perawatan AC 3 bulan' })
    const category = C.select({
      label: 'Kategori', id: 'vas-cat', options: VAS_CATEGORIES, value: seed.category || 'perawatan',
    })
    const price = C.field({ label: 'Harga jual (Rp)', id: 'vas-price', type: 'number', required: true, value: seed.price ?? '', attrs: { min: '0', step: '5000', inputmode: 'numeric' } })
    const cost = C.field({ label: 'Biaya langsung (Rp)', id: 'vas-cost', type: 'number', value: seed.cost ?? 0, hint: 'Bahan dan waktu yang benar-benar keluar untuk item ini.', attrs: { min: '0', step: '5000', inputmode: 'numeric' } })
    const attachTo = C.field({ label: 'Menempel pada layanan', id: 'vas-attach', value: seed.attach_to || '', placeholder: 'Kosongkan untuk semua layanan', hint: 'Nama layanan persis seperti di permintaan, mis. Pembersihan AC.' })
    const rate = C.field({ label: 'Perkiraan tingkat pasang (%)', id: 'vas-rate', type: 'number', value: seed.attach_rate ?? 25, hint: 'Berapa persen pelanggan yang biasanya mengambil item ini.', attrs: { min: '0', max: '100', step: '5' } })
    const desc = C.textarea({ label: 'Penjelasan singkat', id: 'vas-desc', rows: 3, value: seed.description || '', placeholder: 'Satu atau dua kalimat yang bisa dibaca pelanggan.' })
    const statusSel = C.select({ label: 'Status', id: 'vas-status', options: VAS_STATUSES, value: seed.status || 'active' })

    const marginNote = el('p', { className: 'vas-margin-note' }, 'Margin dihitung otomatis.')
    const recompute = () => {
      const e = itemEconomics({ price: price.input.value, cost: cost.input.value })
      marginNote.textContent = `Margin ${C.rupiah(e.margin)} (${e.marginPct.toFixed(0)}%) per item`
      marginNote.classList.toggle('is-thin', e.marginPct < 25)
    }
    price.input.addEventListener('input', recompute)
    cost.input.addEventListener('input', recompute)
    recompute()

    const saveBtn = C.button({ label: isEdit ? 'Simpan perubahan' : 'Tambah item', variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: isEdit ? 'Ubah item VAS' : 'Item VAS baru',
      description: 'Item ini muncul sebagai tawaran tambahan di penawaran dan dihitung dalam potensi katalog.',
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
      actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), saveBtn],
      opener: container,
    })

    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      modalNote.hide()
      if (!name.input.value.trim()) { name.input.focus(); modalNote.show('warn', 'Nama item wajib diisi.'); return }
      if (!(Number(price.input.value) > 0)) { price.input.focus(); modalNote.show('warn', 'Harga harus lebih dari nol.'); return }
      const restore = C.setBusy(saveBtn, 'Menyimpan…')
      try {
        await saveItem({
          name: name.input.value, category: category.input.value, price: price.input.value,
          cost: cost.input.value, attach_to: attachTo.input.value, attach_rate: rate.input.value,
          description: desc.input.value, status: statusSel.input.value,
        }, existing?.id)
        dialog.close()
        status.hide()
        showToast(isEdit ? 'Item diperbarui.' : 'Item ditambahkan.', 'success')
        await reload()
      } catch (err) {
        modalNote.show('danger', err.message)
      } finally { restore() }
    })
  }

  function confirmDelete(item) {
    const delBtn = C.button({ label: 'Hapus', variant: 'danger' })
    const dialog = C.modal({
      title: 'Hapus item VAS?',
      description: `"${item.name}" akan dihapus dari katalog. Riwayat pendapatan yang sudah tercatat tidak berubah.`,
      children: [el('p', { className: 'vas-muted' }, 'Tindakan ini tidak bisa dibatalkan.')],
      actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), delBtn],
      opener: container,
    })
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      const restore = C.setBusy(delBtn, 'Menghapus…')
      try {
        await removeItem(item.id)
        dialog.close()
        showToast('Item dihapus.', 'success')
        await reload()
      } catch (err) { status.show('danger', err.message) } finally { restore() }
    })
  }

  function openBulk() {
    const ta = C.textarea({
      label: 'Tempel data',
      id: 'vas-bulk',
      rows: 10,
      hint: 'Dua format diterima: JSON array, atau satu baris per item dengan pemisah | — nama | harga | biaya | kategori | layanan | tingkat pasang.',
      placeholder: 'Perawatan AC 3 bulan | 450000 | 120000 | perawatan | Pembersihan AC | 30\nCuci karpet express | 250000 | 60000 | kecepatan | Cuci Sofa & Karpet | 20',
    })
    const fileInput = el('input', { type: 'file', accept: '.json,.csv,.txt', className: 'vas-file' })
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      try { ta.input.value = await file.text() } catch { status.show('danger', 'Berkas tidak bisa dibaca.') }
    })

    const preview = el('div', { className: 'vas-bulk-preview' })
    const skip = el('input', { type: 'checkbox', id: 'vas-bulk-skip', checked: skipDuplicates })
    skip.addEventListener('change', () => { skipDuplicates = skip.checked; check() })
    const skipWrap = el('label', { className: 'pd-check', for: 'vas-bulk-skip' },
      skip, el('span', {}, 'Lewati item yang namanya sudah ada di katalog'))

    const split = () => {
      const rows = parseBulk(ta.input.value)
      return { rows, ...splitDuplicates(rows, items, (r) => vasKey(r.name)) }
    }

    const check = () => {
      try {
        const { fresh, duplicates } = split()
        preview.className = 'vas-bulk-preview is-ok'
        const extra = duplicates.length ? ` · ${duplicates.length} sudah ada${skip.checked ? ' dan dilewati' : ''}` : ''
        preview.textContent = `${fresh.length} item baru${extra}. Contoh: ${fresh[0]?.name || duplicates[0]?.name} — ${C.rupiah(fresh[0]?.price || duplicates[0]?.price || 0)}`
      } catch (err) {
        preview.className = 'vas-bulk-preview is-bad'
        preview.textContent = err.message
      }
    }
    ta.input.addEventListener('input', check)

    const importBtn = C.button({ label: 'Impor', variant: 'primary' })
    const modalNote = C.message()
    const dialog = C.modal({
      title: 'Impor massal item VAS',
      description: 'Tempel dari spreadsheet, atau pilih berkas JSON/CSV. Baris yang salah akan ditolak seluruhnya agar katalog tidak setengah jadi.',
      wide: true,
      children: [modalNote, el('div', { className: 'vas-bulk-file' }, el('span', {}, 'Pilih berkas'), fileInput), ta.wrap, skipWrap, preview],
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
      if (!rows.length) { modalNote.show('warn', 'Semua baris sudah ada di katalog. Tidak ada yang diimpor.'); return }
      const restore = C.setBusy(importBtn, 'Mengimpor…')
      try {
        const { error } = await getCloud().database.from('vas_items').insert(rows)
        if (error) throw new Error(error.message)
        dialog.close()
        showToast(`${rows.length} item diimpor${skipped ? `, ${skipped} dilewati` : ''}.`, 'success')
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
      const [m, list] = await Promise.all([loadFlow(), fetchItems()])
      model = m
      items = list
      loadError = null
    } catch (err) { loadError = err }
    if (ctx.signal?.aborted) return
    if (loadError) {
      status.show('danger', `Gagal memuat data: ${loadError.message}`)
      host.replaceChildren(errorView(loadError.message))
      return
    }
    draw()
  }

  host.replaceChildren(C.skeletonRows(4))
  await reload()
}

function kindLabel(kind) {
  return {
    langganan: 'Langganan', berkala: 'Berkala', garansi: 'Garansi',
    bundling: 'Bundling', tertahan: 'Penawaran tertahan', marginkatalog: 'Margin katalog',
  }[kind] || kind
}

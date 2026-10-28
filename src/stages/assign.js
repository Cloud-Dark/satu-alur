/** 03 — Penugasan: assign an approved offer to a worker with AI matching, map, and team management. */
import { loadWorkers, loadLinks, saveWorker, removeWorker, createTeamAssignment } from './workers-repo.js'
import { geocode } from '../geo.js'
import { SKILL_LABELS, workerState, completedCount, hasHistory, inferSkill, scoreWorkers, pickRecommended, joinWorkerNames } from '../domain/workers.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'

const { el } = C

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function defaultSchedule() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return toLocalInput(d)
}

const STATUS_LABELS = {
  available: { label: 'Tersedia', color: 'success' },
  on_job: { label: 'Dalam Tugas', color: 'warning' },
  off_duty: { label: 'Off Duty', color: 'muted' },
  sick: { label: 'Sakit', color: 'danger' },
}

const TABS = [
  { value: 'assign', label: 'Tugaskan' },
  { value: 'team', label: 'Tim' },
  { value: 'map', label: 'Peta' },
  { value: 'performance', label: 'Performa' },
]
let currentTab = 'assign'

/* ================================================================ Main Render */
export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const status = C.message()
  const host = el('div')
  const tabs = C.segmented({ options: TABS, value: currentTab, label: 'Penugasan', onChange: (value) => {
    currentTab = value
    status.hide()
    draw()
  } })
  tabs.classList.add('workspace-tabs')

  container.replaceChildren(
    C.pageHeader({ num: '03', label: 'Penugasan', title: 'Penugasan Pintar', em: 'Pintar', description: 'Tugaskan petugas dengan AI matching, visualisasi peta, dan tracking performa.' }),
    tabs, status, host,
  )

  let flow = null
  let workers = []
  let links = []

  async function load() {
    try {
      ;[flow, workers, links] = await Promise.all([loadFlow(), loadWorkers(), loadLinks()])
      status.hide()
    } catch (err) {
      status.show('danger', `Gagal memuat data: ${err.message}`)
    }
    draw()
  }
  async function reload() {
    await load()
    notifyDataChanged()
  }

  function draw() {
    host.replaceChildren()
    if (!flow) return
    switch (currentTab) {
      case 'assign': renderAssign(host, ctx, flow, workers, links, reload, status, () => tabs.querySelector('[data-value="team"]').click()); break
      case 'team': renderTeam(host, { workers, assignments: flow.assignments, completions: flow.completions, links, reload, status }); break
      case 'map': renderMap(host, flow, workers); break
      case 'performance': renderPerformance(host, workers); break
    }
  }
  await load()
}

/* ================================================================ Tab: Assign */
function renderAssign(target, ctx, flow, workers, links, reload, status, goTeam) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const offerSel = C.select({ label: 'Penawaran disetujui', name: 'offer_id', required: true, hint: 'Pilih penawaran untuk lihat rekomendasi petugas.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { className: 'req-preview', hidden: true })
  const when = C.field({ label: 'Jadwal pelaksanaan', name: 'scheduled_at', type: 'datetime-local', required: true, value: defaultSchedule(), hint: 'Waktu lokal perangkat Anda.' })
  const submit = C.button({ label: 'Tugaskan', icon: 'users', variant: 'primary', type: 'submit' })
  const msg = C.message()

  const pickList = el('div', { className: 'worker-pick' })
  const count = C.field({ label: 'Jumlah', name: 'recommend_n', type: 'number', value: '1', attrs: { min: '1' } })
  const recommend = C.button({ label: 'Pilih rekomendasi', icon: 'check', variant: 'soft', onClick: () => {
    const n = Math.max(1, parseInt(count.input.value, 10) || 1)
    checked.clear()
    pickRecommended(scored, n).forEach((w) => checked.add(w.id))
    drawPick()
  } })
  const summary = el('div', { className: 'muted small' })
  const picker = el('div', { className: 'field' },
    el('span', { className: 'field-label' }, 'Petugas'),
    workers.some((w) => w.status === 'active')
      ? el('div', { className: 'form' }, el('div', { className: 'pick-recommend' }, count.wrap, recommend), pickList)
      : C.emptyState({ title: 'Belum ada petugas aktif', iconName: 'users', body: 'Tambahkan petugas di tab Tim untuk mulai menugaskan.', action: C.button({ label: 'Ke tab Tim', icon: 'users', onClick: goTeam }) }),
  )

  const form = el('form', { className: 'form' },
    offerSel.wrap, preview,
    when.wrap,
    picker, summary,
    el('div', { className: 'form-actions' }, submit),
    msg,
  )
  form.noValidate = true

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar penugasan', meta: 'memuat…', className: 'list-panel' }, listBody)

  target.appendChild(el('div', { className: 'stage-grid' },
    C.panel({ title: 'Tugaskan petugas', meta: 'Rekomendasi otomatis', raised: true, className: 'form-panel' }, form),
    listPanel,
  ))

  let job = null // { skill, lat, lng } of the selected offer
  let scored = []
  const checked = new Set()

  const scheduledDate = () => {
    const d = when.input.value ? new Date(when.input.value) : null
    return d && !Number.isNaN(d.getTime()) ? d : null
  }

  function rescore() {
    const d = scheduledDate()
    scored = job && d ? scoreWorkers({ workers, job: { ...job, scheduledAt: d.toISOString() }, assignments: flow.assignments, links }) : []
    const ids = new Set(scored.map((s) => s.worker.id))
    ;[...checked].forEach((id) => { if (!ids.has(id)) checked.delete(id) })
    drawPick()
  }

  function drawPick() {
    if (!job) { pickList.replaceChildren(el('p', { className: 'muted small', style: 'padding:12px;margin:0;' }, 'Pilih penawaran terlebih dahulu.')); drawSummary(); return }
    if (!scored.length) { pickList.replaceChildren(el('p', { className: 'muted small', style: 'padding:12px;margin:0;' }, 'Isi jadwal pelaksanaan yang valid.')); drawSummary(); return }
    pickList.replaceChildren(...scored.map((s) => {
      const w = s.worker
      const input = el('input', { type: 'checkbox', value: String(w.id) })
      input.checked = checked.has(w.id)
      input.addEventListener('change', () => { input.checked ? checked.add(w.id) : checked.delete(w.id); drawSummary() })
      return el('label', { className: 'check-row' }, input,
        el('span', { className: 'worker-pick-body' },
          el('span', { className: 'worker-pick-tags' },
            el('strong', {}, w.name),
            ...(w.skills || []).map((k) => C.tag(SKILL_LABELS[k] || k)),
            s.clash ? C.tag('Bentrok', 'warn') : null,
            s.distanceKm !== null ? el('span', { className: 'muted small' }, `${s.distanceKm.toFixed(1).replace('.', ',')} km`) : null,
          ),
          el('span', { className: 'muted small' }, s.reasons.join(' · ')),
        ),
      )
    }))
    drawSummary()
  }

  const selected = () => scored.filter((s) => checked.has(s.worker.id))

  function drawSummary() {
    const sel = selected()
    if (!sel.length) { summary.replaceChildren(); return }
    const skills = [...new Set(sel.flatMap((s) => s.worker.skills || []))]
    const warns = []
    if (sel.some((s) => s.clash)) warns.push('Ada petugas yang bentrok di hari yang sama.')
    if (job?.skill && !sel.some((s) => s.skillMatch === 'full')) warns.push('Tidak ada petugas terpilih yang memiliki keahlian yang dibutuhkan.')
    summary.replaceChildren(
      el('div', {}, el('strong', {}, 'Tim: '), joinWorkerNames(sel.map((s) => s.worker))),
      el('div', {}, el('strong', {}, 'Keahlian: '), skills.map((k) => SKILL_LABELS[k] || k).join(', ') || '—'),
      ...warns.map((t) => C.tag(t, 'warn')),
    )
  }

  function fillOffers() {
    if (!flow) return
    const approved = flow.offers.filter((o) => o.status === 'approved')
    const free = approved.filter((o) => !flow.assignmentsOf(o.id).length)
    const taken = approved.filter((o) => flow.assignmentsOf(o.id).length)
    const label = (o) => { const r = flow.requestOfOffer(o); return `${customerLabel(r)} — ${C.rupiah(o.validated_price)}` }
    const opts = [{ value: '', label: approved.length ? 'Pilih penawaran' : 'Belum ada penawaran disetujui' }]
    free.forEach((o) => opts.push({ value: o.id, label: label(o) }))
    taken.forEach((o) => opts.push({ value: o.id, label: `${label(o)} (sudah ditugaskan)` }))
    const keep = offerSel.input.value || (params.offerId != null ? String(params.offerId) : '')
    C.setOptions(offerSel.input, opts, keep)
    submit.disabled = !approved.length
    if (!approved.length) {
      msg.show('info', 'Belum ada penawaran yang disetujui. Simpan penawaran di tahap 02 terlebih dahulu.')
      const go = C.button({ label: 'Ke penawaran', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('offer'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    selectOffer()
  }

  let selectToken = 0
  async function selectOffer() {
    const token = ++selectToken
    const o = flow?.offer(offerSel.input.value)
    checked.clear()
    job = null
    if (!o) { preview.hidden = true; scored = []; drawPick(); return }
    const r = flow.requestOfOffer(o)
    preview.replaceChildren(C.defList([
      ['Pelanggan', `${customerLabel(r)}${r?.location ? ` · ${r.location}` : ''}`],
      ['Lingkup', o.validated_scope || '—'],
      ['Nilai', el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price))],
    ]))
    preview.hidden = false
    when.input.value = r?.requested_at && !Number.isNaN(new Date(r.requested_at).getTime()) ? toLocalInput(new Date(r.requested_at)) : defaultSchedule()
    const geo = r?.location ? await geocode(r.location) : null
    if (token !== selectToken) return
    job = { skill: inferSkill(r?.service_type), lat: geo?.lat ?? null, lng: geo?.lng ?? null }
    rescore()
  }

  offerSel.input.addEventListener('change', () => { msg.hide(); selectOffer() })
  when.input.addEventListener('change', rescore)

  let saving = false
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (saving) return
    msg.hide()
    const errors = []
    const offer = flow?.offer(offerSel.input.value)
    const team = selected().map((s) => s.worker)
    const date = scheduledDate()
    if (!offer) errors.push('Pilih penawaran.')
    if (!team.length) errors.push('Pilih minimal satu petugas.')
    if (!date) errors.push('Isi jadwal pelaksanaan yang valid.')
    if (errors.length) {
      msg.show('danger', 'Periksa kembali isian berikut.', errors)
      return
    }
    saving = true
    const restore = C.setBusy(submit, 'Menyimpan…')
    try {
      const row = await createTeamAssignment({ offerId: Number(offer.id), scheduledAt: date.toISOString(), workers: team })
      const text = `${joinWorkerNames(team)} ditugaskan untuk ${customerLabel(flow.requestOfOffer(offer))}, ${C.formatDateTime(date)}.`
      showToast('Penugasan tersimpan.', 'success')
      // reload redraws this page, so the success note goes on the page-level status
      await reload()
      status.show('ok', text)
      const next = C.button({ label: 'Tandai selesai nanti', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('complete', { assignmentId: row?.id }))
      status.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, next))
    } catch (err) {
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
      restore()
      saving = false
    }
  })

  async function loadList() {
    if (!flow) return
    fillOffers()
    const active = flow.activeAssignments().length
    listPanel.querySelector('.panel-meta').textContent = `${flow.assignments.length} baris · ${active} aktif`
    if (!flow.assignments.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada penugasan.', body: 'Pilih penawaran yang disetujui dan tentukan pelaksananya.' }))
      return
    }
    const now = Date.now()
    listBody.replaceChildren(C.dataTable({
      caption: 'Daftar penugasan',
      rows: flow.assignments,
      columns: [
        { label: 'Pelanggan', render: (a) => { const r = flow.requestOfAssignment(a); return C.cellStack(customerLabel(r), r?.service_type) } },
        {
          label: 'Petugas · jadwal',
          render: (a) => {
            return el('div', { className: 'cell-stack' },
              el('span', { className: 'cell-primary' }, a.worker_name || '—'),
              el('time', { className: 'cell-secondary tnum', datetime: a.scheduled_at || '' }, C.formatDateTime(a.scheduled_at)),
            )
          },
        },
        {
          label: 'Status',
          render: (a) => {
            if (a.status === 'done' || flow.completionsOf(a.id).length) return C.tag('Selesai', 'ok')
            const sched = C.toDate(a.scheduled_at)
            return sched && sched.getTime() < now ? C.tag('Lewat jadwal', 'warn') : C.tag('Ditugaskan', 'brand')
          },
        },
        {
          label: 'Aksi',
          className: 'col-action',
          render: (a) => {
            if (a.status === 'done' || flow.completionsOf(a.id).length) return el('span', { className: 'muted nil' }, '—')
            const b = C.button({ label: 'Tandai selesai', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
            b.addEventListener('click', () => navigate('complete', { assignmentId: a.id }))
            return b
          },
        },
      ],
    }))
  }

  fillOffers()
  loadList()
}

/* ================================================================ Tab: Team */
const PHONE_RE = /^[+()\d\s.-]{6,32}$/
const STATE_TAG = { available: ['Tersedia', 'ok'], on_job: ['Dalam tugas', 'warn'], inactive: ['Nonaktif', 'neutral'] }

function renderTeam(target, { workers, assignments, completions, links, reload, status }) {
  const dialog = el('dialog', { className: 'panel' })
  dialog.addEventListener('close', () => dialog.replaceChildren())

  function openWorkerForm(worker = null) {
    const isEdit = !!worker
    const name = C.field({ label: 'Nama', name: 'name', required: true, value: worker?.name || '' })
    const phone = C.field({ label: 'No. HP', name: 'phone', type: 'tel', value: worker?.phone || '' })
    const address = C.field({ label: 'Alamat', name: 'address', value: worker?.address || '', hint: 'Dipakai untuk menentukan zona dan jarak.' })
    const boxes = Object.entries(SKILL_LABELS).map(([key, label]) => {
      const input = el('input', { type: 'checkbox', value: key })
      input.checked = !!worker?.skills?.includes(key)
      return { input, wrap: el('label', { className: 'check-row' }, input, ` ${label}`) }
    })
    const statusSel = isEdit ? C.select({ label: 'Status', name: 'status', options: [{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }], value: worker.status }) : null
    const msg = C.message()
    const submit = C.button({ label: isEdit ? 'Simpan perubahan' : 'Tambah petugas', icon: 'check', variant: 'primary', type: 'submit' })
    const cancel = C.button({ label: 'Batal', variant: 'ghost', onClick: () => dialog.close() })
    const form = el('form', { className: 'form' },
      name.wrap, phone.wrap, address.wrap,
      el('fieldset', { className: 'field' }, el('legend', { className: 'field-label' }, 'Keahlian'), ...boxes.map((b) => b.wrap)),
      statusSel?.wrap, msg,
      el('div', { className: 'form-actions' }, submit, cancel),
    )
    form.noValidate = true
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      msg.hide()
      const fields = {
        name: name.input.value.trim(), phone: phone.input.value.trim(), address: address.input.value.trim(),
        skills: boxes.filter((b) => b.input.checked).map((b) => b.input.value),
      }
      if (!fields.name) { msg.show('danger', 'Nama wajib diisi.'); return }
      if (fields.phone && !PHONE_RE.test(fields.phone)) { msg.show('danger', 'Nomor HP tidak valid.'); return }
      fields.status = isEdit ? statusSel.input.value : 'active'
      if (isEdit) fields.id = worker.id
      const restore = C.setBusy(submit, 'Menyimpan…')
      try {
        await saveWorker(fields, worker || undefined)
        dialog.close()
        showToast(isEdit ? `${fields.name} diperbarui.` : `${fields.name} ditambahkan.`, 'success')
        await reload()
      } catch (err) {
        msg.show('danger', err.message)
        restore()
      }
    })
    dialog.replaceChildren(el('h2', { className: 'panel-title' }, isEdit ? 'Edit petugas' : 'Tambah petugas'), form)
    dialog.showModal()
  }

  async function act(label, run, done) {
    try { await run(); showToast(done, 'success'); await reload() }
    catch (err) { status.show('danger', `${label}: ${err.message}`) }
  }

  function removeAction(w) {
    const history = hasHistory(w.id, links)
    const verb = history ? 'Nonaktifkan' : 'Hapus'
    return C.button({ label: verb, icon: history ? 'x' : 'trash', variant: 'ghost', size: 'sm', onClick: () => {
      if (!window.confirm(`${verb} ${w.name}?`)) return
      act(`${verb} gagal`, () => removeWorker(w, links), history ? `${w.name} dinonaktifkan.` : `${w.name} dihapus.`)
    } })
  }

  function card(w) {
    const state = workerState(w, assignments, links)
    const [stateLabel, tone] = STATE_TAG[state]
    const inactive = state === 'inactive'
    return el('article', { className: 'workspace-entry' },
      el('div', { className: 'workspace-entry-head' }, el('strong', {}, w.name), C.tag(stateLabel, tone)),
      el('p', { className: 'muted small' }, [w.phone, w.zone].filter(Boolean).join(' · ') || 'Belum ada kontak'),
      el('div', {}, ...(w.skills || []).map((s) => C.tag(SKILL_LABELS[s] || s))),
      el('p', { className: 'muted small' }, `${completedCount(w.id, links, completions)} job selesai`),
      el('div', { className: 'form-actions' },
        C.button({ label: 'Edit', icon: 'edit', variant: 'soft', size: 'sm', onClick: () => openWorkerForm(w) }),
        inactive
          ? C.button({ label: 'Aktifkan', icon: 'check', variant: 'soft', size: 'sm', onClick: () => act('Aktifkan gagal', () => saveWorker({ id: w.id, name: w.name, phone: w.phone, address: w.address, skills: w.skills, status: 'active' }, w), `${w.name} diaktifkan.`) })
          : null,
        removeAction(w),
      ),
    )
  }

  const byName = [...workers].sort((a, b) => a.name.localeCompare(b.name))
  const active = byName.filter((w) => w.status === 'active')
  const inactive = byName.filter((w) => w.status !== 'active')

  target.append(
    dialog,
    el('div', { className: 'form-actions' }, C.button({ label: 'Tambah petugas', icon: 'plus', variant: 'primary', onClick: () => openWorkerForm() })),
    C.panel({ title: 'Tim petugas', meta: `${active.length} aktif` },
      active.length ? active.map(card) : C.emptyState({ title: 'Belum ada petugas aktif', iconName: 'users', body: 'Tambahkan petugas untuk mulai menugaskan pekerjaan.' })),
    inactive.length ? C.panel({ title: 'Nonaktif', meta: `${inactive.length} petugas` }, inactive.map(card)) : null,
  )
}

/* ================================================================ Tab: Map */
function renderMap(target, flow, workers) {
  // Simple visual map using SVG representation (no external map lib needed for demo)
  const mapBox = el('div', { style: 'background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;min-height:400px;position:relative;overflow:hidden;' })

  // Mock map: Jakarta area with relative coordinates
  const mapWidth = 800
  const mapHeight = 400
  const bounds = { minLat: -6.6, maxLat: -6.1, minLng: 106.5, maxLng: 107.0 }

  function toX(lng) { return ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * mapWidth }
  function toY(lat) { return mapHeight - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * mapHeight }

  const svg = el('svg', { viewBox: `0 0 ${mapWidth} ${mapHeight}`, style: 'width:100%;height:auto;background:#e8f4f8;border-radius:var(--radius-sm);' })

  // Grid lines
  for (let i = 0; i <= 5; i++) {
    const y = (mapHeight / 5) * i
    svg.appendChild(el('line', { x1: 0, y1: y, x2: mapWidth, y2: y, stroke: '#d0e8f0', 'stroke-width': 1 }))
    const x = (mapWidth / 5) * i
    svg.appendChild(el('line', { x1: x, y1: 0, x2: x, y2: mapHeight, stroke: '#d0e8f0', 'stroke-width': 1 }))
  }

  // Workers (blue dots)
  workers.forEach((w) => {
    if (w.lat && w.lng) {
      const cx = toX(w.lng)
      const cy = toY(w.lat)
      const g = el('g')
      g.appendChild(el('circle', { cx, cy, r: 8, fill: w.status === 'available' ? '#27ae60' : w.status === 'on_job' ? '#e67e22' : '#95a5a6', stroke: '#fff', 'stroke-width': 2 }))
      g.appendChild(el('text', { x: cx, y: cy - 12, 'text-anchor': 'middle', 'font-size': '10', fill: '#3d2b1f', 'font-weight': '600' }, w.name.split(' ')[0]))
      svg.appendChild(g)
    }
  })

  // Jobs (red pins)
  if (flow?.requests) {
    flow.requests.forEach((r, i) => {
      // Mock lat/lng based on location name hash for demo
      const hash = r.location?.split('').reduce((a, c) => a + c.charCodeAt(0), 0) || i * 100
      const lat = bounds.minLat + (hash % 1000) / 1000 * (bounds.maxLat - bounds.minLat)
      const lng = bounds.minLng + ((hash * 7) % 1000) / 1000 * (bounds.maxLng - bounds.minLng)
      const cx = toX(lng)
      const cy = toY(lat)
      const g = el('g')
      g.appendChild(el('polygon', { points: `${cx},${cy - 12} ${cx - 6},${cy + 4} ${cx + 6},${cy + 4}`, fill: '#c0392b', stroke: '#fff', 'stroke-width': 2 }))
      g.appendChild(el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', 'font-size': '9', fill: '#3d2b1f' }, r.customer_name?.slice(0, 10) || 'Job'))
      svg.appendChild(g)
    })
  }

  mapBox.appendChild(svg)

  const legend = el('div', { style: 'display:flex;gap:16px;margin-top:12px;flex-wrap:wrap;' },
    el('span', { className: 'muted small', style: 'display:flex;align-items:center;gap:4px;' }, el('span', { style: 'width:10px;height:10px;border-radius:50%;background:#27ae60;display:inline-block;' }), 'Tersedia'),
    el('span', { className: 'muted small', style: 'display:flex;align-items:center;gap:4px;' }, el('span', { style: 'width:10px;height:10px;border-radius:50%;background:#e67e22;display:inline-block;' }), 'Dalam Tugas'),
    el('span', { className: 'muted small', style: 'display:flex;align-items:center;gap:4px;' }, el('span', { style: 'width:10px;height:10px;border-radius:50%;background:#95a5a6;display:inline-block;' }), 'Off Duty'),
    el('span', { className: 'muted small', style: 'display:flex;align-items:center;gap:4px;' }, el('span', { style: 'width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid #c0392b;display:inline-block;' }), 'Pekerjaan'),
  )

  target.appendChild(el('div', { className: 'form-actions', style: 'margin-bottom:16px;' },
    C.button({ label: '🗺️ Aktifkan Peta Real (Leaflet)', icon: 'map', variant: 'soft', onClick: () => showToast('Integrasi MapsEncoder APIPedia + Leaflet memerlukan API token. Masukkan di Pengaturan.', 'info') }),
    C.button({ label: 'Refresh Posisi', icon: 'refresh', variant: 'ghost', onClick: () => showToast('Memperbarui posisi petugas...', 'info') }),
  ))
  target.appendChild(mapBox)
  target.appendChild(legend)

  target.appendChild(el('div', { className: 'card', style: 'margin-top:16px;padding:16px;' },
    el('h3', { style: 'margin:0 0 8px;font-size:0.95rem;' }, '📍 Integrasi MapsEncoder APIPedia'),
    el('p', { className: 'text-body', style: 'font-size:0.85rem;' }, 'Aktifkan peta interaktif dengan fitur:'),
    el('ul', { style: 'font-size:0.85rem;color:var(--text);margin:8px 0;padding-left:18px;' },
      el('li', {}, 'Geocoding alamat ke koordinat (Forward)'),
      el('li', {}, 'Reverse geocoding koordinat ke alamat'),
      el('li', {}, 'Hitung jarak & estimasi waktu tempuh'),
      el('li', {}, 'Visualisasi rute harian per petugas'),
    ),
    el('div', { className: 'form-actions', style: 'margin-top:12px;' },
      C.button({ label: 'Masukkan Token APIPedia', icon: 'key', variant: 'soft', size: 'sm', onClick: () => showToast('Buka Pengaturan → Integrasi untuk masukkan token APIPedia.', 'info') }),
    ),
  ))
}

/* ================================================================ Tab: Performance */
function renderPerformance(target, workers) {
  const summary = el('div', { className: 'kpis', style: 'margin-bottom:20px;' },
    kpiCard('👷', 'Total Petugas', String(workers.length), 'Aktif', '+2 bulan ini'),
    kpiCard('✅', 'Job Selesai', String(workers.reduce((a, w) => a + (w.completed || 0), 0)), 'Baik', 'Bulan ini'),
    kpiCard('⏰', 'On-time Rate', `${Math.round(workers.reduce((a, w) => a + (w.onTime || 0), 0) / workers.length)}%`, 'Tinggi', '+5% vs bulan lalu'),
    kpiCard('⭐', 'Avg Rating', String((workers.reduce((a, w) => a + (w.rating || 0), 0) / workers.length).toFixed(1)), 'Tinggi', 'Dari 5.0'),
  )

  const leaderboard = el('div', { className: 'card', style: 'margin-top:16px;' },
    el('h3', { className: 'card-title', style: 'margin-bottom:16px;' }, '🏆 Leaderboard Bulan Ini'),
  )

  const sorted = [...workers].sort((a, b) => (b.completed || 0) - (a.completed || 0))
  const table = el('table', { style: 'width:100%;border-collapse:collapse;font-size:0.9rem;' })
  const thead = el('thead', {},
    el('tr', {},
      el('th', { style: 'text-align:left;padding:8px;border-bottom:2px solid var(--border);' }, '#'),
      el('th', { style: 'text-align:left;padding:8px;border-bottom:2px solid var(--border);' }, 'Petugas'),
      el('th', { style: 'text-align:center;padding:8px;border-bottom:2px solid var(--border);' }, 'Job'),
      el('th', { style: 'text-align:center;padding:8px;border-bottom:2px solid var(--border);' }, 'Rating'),
      el('th', { style: 'text-align:center;padding:8px;border-bottom:2px solid var(--border);' }, 'On-time'),
      el('th', { style: 'text-align:right;padding:8px;border-bottom:2px solid var(--border);' }, 'Skill'),
    ),
  )
  const tbody = el('tbody')
  sorted.forEach((w, i) => {
    tbody.appendChild(el('tr', {},
      el('td', { style: 'padding:8px;border-bottom:1px solid var(--border);font-weight:700;' }, `#${i + 1}`),
      el('td', { style: 'padding:8px;border-bottom:1px solid var(--border);' },
        el('div', { style: 'display:flex;align-items:center;gap:8px;' },
          el('div', { style: 'width:32px;height:32px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.8rem;' }, (w.avatar || w.name.split(' ').map((n) => n[0]).join('').slice(0, 2)).toUpperCase()),
          w.name,
        ),
      ),
      el('td', { style: 'padding:8px;border-bottom:1px solid var(--border);text-align:center;font-weight:700;' }, w.completed || 0),
      el('td', { style: `padding:8px;border-bottom:1px solid var(--border);text-align:center;color:var(--warning);font-weight:700;` }, `${w.rating || 0} ★`),
      el('td', { style: `padding:8px;border-bottom:1px solid var(--border);text-align:center;color:${(w.onTime || 0) >= 95 ? 'var(--success)' : (w.onTime || 0) >= 90 ? 'var(--warning)' : 'var(--danger)'};font-weight:700;` }, `${w.onTime || 0}%`),
      el('td', { style: 'padding:8px;border-bottom:1px solid var(--border);text-align:right;' },
        el('div', { style: 'display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap;' },
          ...(w.skills || []).slice(0, 2).map((s) => C.tag(SKILL_LABELS[s] || s, 'soft')),
        ),
      ),
    ))
  })
  table.appendChild(thead)
  table.appendChild(tbody)
  leaderboard.appendChild(table)

  target.appendChild(summary)
  target.appendChild(leaderboard)
}

/* ------------------------------------------------------------------ KPI */
function kpiCard(ico, label, value, status, sub) {
  return el('div', { className: 'kpi' },
    el('div', { className: 'kpi-top' },
      el('span', { className: 'kpi-ico' }, ico),
      C.tag(status, status === 'Tinggi' || status === 'Baik' || status === 'Aktif' ? 'success' : status === 'Sedang' ? 'warning' : 'danger'),
    ),
    el('div', { className: 'kpi-value' }, value),
    el('div', { className: 'kpi-sub' }, label, el('br'), el('span', { className: 'muted' }, sub)),
  )
}

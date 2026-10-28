/** 03 — Penugasan: assign an approved offer to a worker with AI matching, map, and team management. */
import { getCloud } from '../cloud.js'
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

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const SKILL_LABELS = {
  ac: 'Service AC', cleaning: 'Cleaning', waterproofing: 'Waterproofing',
  roof: 'Roof Repair', carpet: 'Cuci Karpet', sofa: 'Cuci Sofa',
  electrical: 'Listrik', pool: 'Kolam Renang', garden: 'Taman',
  pest: 'Pest Control',
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

  async function init() {
    try {
      flow = await loadFlow()
      const { data, error } = await getCloud().database.from('workers').select('*')
      workers = (data || []).sort((a, b) => b.completed - a.completed)
    } catch (err) { /* silent */ }
  }
  await init()

  function draw() {
    host.replaceChildren()
    switch (currentTab) {
      case 'assign': renderAssign(host, ctx, flow, workers); break
      case 'team': renderTeam(host, workers); break
      case 'map': renderMap(host, flow, workers); break
      case 'performance': renderPerformance(host, workers); break
    }
  }
  draw()
}

/* ================================================================ Tab: Assign */
function renderAssign(target, ctx, flow, workers) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const offerSel = C.select({ label: 'Penawaran disetujui', name: 'offer_id', required: true, hint: 'Pilih penawaran untuk lihat rekomendasi AI.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { className: 'req-preview', hidden: true })
  const workerSel = C.select({ label: 'Petugas (AI Rekomendasi)', name: 'worker_id', required: true, options: [{ value: '', label: 'Pilih penawaran terlebih dahulu' }] })
  const when = C.field({ label: 'Jadwal pelaksanaan', name: 'scheduled_at', type: 'datetime-local', required: true, value: defaultSchedule(), hint: 'Waktu lokal perangkat Anda.' })
  const submit = C.button({ label: 'Tugaskan', icon: 'users', variant: 'primary', type: 'submit' })
  const msg = C.message()

  const aiPanel = el('div', { className: 'card', style: 'margin-bottom:16px;background:var(--bg-input);' })

  const form = el('form', { className: 'form' },
    aiPanel,
    offerSel.wrap, preview,
    workerSel.wrap,
    el('div', { className: 'form-row' }, when.wrap),
    el('div', { className: 'form-actions' }, submit),
    msg,
  )
  form.noValidate = true

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar penugasan', meta: 'memuat…', className: 'list-panel' }, listBody)

  target.appendChild(el('div', { className: 'stage-grid' },
    C.panel({ title: 'Tugaskan dengan AI', meta: 'Smart matching', raised: true, className: 'form-panel' }, form),
    listPanel,
  ))

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
    showPreview()
  }

  function showPreview() {
    const o = flow?.offer(offerSel.input.value)
    if (!o) { preview.hidden = true; aiPanel.replaceChildren(); return }
    const r = flow.requestOfOffer(o)
    preview.replaceChildren(C.defList([
      ['Pelanggan', `${customerLabel(r)}${r?.location ? ` · ${r.location}` : ''}`],
      ['Lingkup', o.validated_scope || '—'],
      ['Nilai', el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price))],
    ]))
    preview.hidden = false
    runAiDispatch(o, r)
  }

  function runAiDispatch(offer, request) {
    aiPanel.replaceChildren(el('div', { style: 'padding:12px;' },
      el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' },
        el('span', { style: 'font-size:1.2rem;' }, '🤖'),
        el('strong', {}, 'AI Smart Dispatch'),
      ),
      el('p', { className: 'muted small', style: 'margin:0;' }, 'Menganalisis jarak, skill, workload, dan rating...'),
    ))

    // Simulate AI analysis delay
    setTimeout(() => {
      // Calculate scores for each worker
      const jobLat = request?.lat || -6.2088
      const jobLng = request?.lng || 106.8456
      const jobSkill = inferSkill(request?.service_type || '')

      const scored = workers.map((w) => {
        const distance = haversine(w.lat || -6.2, w.lng || 106.8, jobLat, jobLng)
        const hasSkill = w.skills?.includes(jobSkill) ? 100 : w.skills?.some((s) => jobSkill.includes(s) || s.includes(jobSkill)) ? 70 : 0
        const workloadScore = w.status === 'available' ? 100 : w.status === 'on_job' ? 50 : 0
        const distScore = Math.max(0, 100 - distance * 8)
        const ratingScore = (w.rating || 4) * 20
        const total = Math.round(distScore * 0.30 + hasSkill * 0.25 + workloadScore * 0.20 + ratingScore * 0.15 + 100 * 0.10)
        return { worker: w, distance: Math.round(distance * 10) / 10, distScore, hasSkill, workloadScore, ratingScore, total }
      }).sort((a, b) => b.total - a.total)

      const top3 = scored.slice(0, 3)
      const best = top3[0]

      // Fill worker select with AI-ranked options
      const workerOpts = [{ value: '', label: 'Pilih petugas (diurutkan AI)' }]
      top3.forEach((s, i) => {
        const w = s.worker
        workerOpts.push({ value: w.id, label: `${i + 1}. ${w.name} — Score ${s.total} (${s.distance} km)` })
      })
      scored.slice(3).forEach((s) => {
        workerOpts.push({ value: s.worker.id, label: `${s.worker.name} — Score ${s.total}` })
      })
      C.setOptions(workerSel.input, workerOpts, best?.worker.id || '')

      aiPanel.replaceChildren(
        el('div', { style: 'padding:16px;' },
          el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:12px;' },
            el('span', { style: 'font-size:1.3rem;' }, '🤖'),
            el('strong', { style: 'font-size:1rem;' }, 'AI Rekomendasi'),
          ),
          best ? el('div', { style: 'background:var(--bg);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--success);' },
            el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
              el('div', {},
                el('strong', {}, best.worker.name),
                el('div', { className: 'muted small' }, `${best.distance} km · ${best.worker.rating}★ · ${STATUS_LABELS[best.worker.status]?.label || best.worker.status}`),
              ),
              el('div', { style: 'text-align:right;' },
                el('div', { style: 'font-size:1.5rem;font-weight:800;color:var(--success);' }, best.total),
                el('div', { className: 'muted small' }, 'AI Score'),
              ),
            ),
            el('div', { style: 'display:grid;grid-template-columns:repeat(5, 1fr);gap:6px;margin-top:10px;' },
              scoreMini('Jarak', best.distScore, 30),
              scoreMini('Skill', best.hasSkill, 25),
              scoreMini('Beban', best.workloadScore, 20),
              scoreMini('Rating', best.ratingScore, 15),
              scoreMini('Biaya', 100, 10),
            ),
          ) : el('p', {}, 'Tidak ada petugas tersedia.'),
          top3.length > 1 ? el('div', { style: 'margin-top:10px;' },
            el('p', { className: 'muted small', style: 'margin:0 0 6px;' }, 'Alternatif:'),
            ...top3.slice(1).map((s) => el('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border);' },
              el('span', {}, s.worker.name),
              el('span', { style: 'color:var(--text-muted);' }, `Score ${s.total} · ${s.distance} km`),
            )),
          ) : null,
        ),
      )
    }, 800)
  }

  function scoreMini(label, score, weight) {
    return el('div', { style: 'text-align:center;' },
      el('div', { className: 'muted small', style: 'font-size:0.65rem;' }, label),
      el('div', { style: `font-size:0.8rem;font-weight:700;color:${score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)'};` }, score),
      el('div', { className: 'muted small', style: 'font-size:0.6rem;' }, `${weight}%`),
    )
  }

  function inferSkill(serviceType) {
    const s = (serviceType || '').toLowerCase()
    if (s.includes('ac')) return 'ac'
    if (s.includes('sofa') || s.includes('karpet')) return 'cleaning'
    if (s.includes('kolam')) return 'pool'
    if (s.includes('taman')) return 'garden'
    if (s.includes('hama') || s.includes('pest')) return 'pest'
    if (s.includes('waterproofing') || s.includes('bocor')) return 'waterproofing'
    if (s.includes('kaca') || s.includes('gedung')) return 'cleaning'
    return 'cleaning'
  }

  offerSel.input.addEventListener('change', () => { msg.hide(); showPreview() })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.hide()
    const errors = []
    const offer = flow?.offer(offerSel.input.value)
    const workerId = workerSel.input.value
    const selectedWorker = workers.find((w) => w.id === workerId)
    const date = when.input.value ? new Date(when.input.value) : null
    if (!offer) errors.push('Pilih penawaran.')
    if (!workerId) errors.push('Pilih petugas.')
    if (!date || Number.isNaN(date.getTime())) errors.push('Isi jadwal pelaksanaan yang valid.')
    if (errors.length) {
      msg.show('danger', 'Periksa kembali isian berikut.', errors)
      return
    }
    const restore = C.setBusy(submit, 'Menyimpan…')
    try {
      const { data, error } = await getCloud().database.from('assignments').insert({
        offer_id: Number(offer.id),
        worker_id: workerId,
        worker_name: selectedWorker?.name || 'Tim',
        scheduled_at: date.toISOString(),
        status: 'assigned',
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      workerSel.input.value = ''
      offerSel.input.value = ''
      when.input.value = defaultSchedule()
      aiPanel.replaceChildren()
      msg.show('ok', `${selectedWorker?.name} ditugaskan untuk ${customerLabel(flow.requestOfOffer(offer))}, ${C.formatDateTime(date)}.`)
      const next = C.button({ label: 'Tandai selesai nanti', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('complete', { assignmentId: row?.id }))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, next))
      showToast('Penugasan tersimpan.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    } finally {
      restore()
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
            const w = workers.find((x) => x.id === a.worker_id)
            return el('div', { className: 'cell-stack' },
              el('span', { className: 'cell-primary' }, w?.name || a.worker_name || '—'),
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
function renderTeam(target, workers) {
  let editingWorker = null
  let localWorkers = [...workers]

  // Modal overlay
  function createModal(title, content) {
    const overlay = el('div', { style: 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:20px;' })
    const box = el('div', { style: 'background:var(--bg-surface);border-radius:var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-lg);width:100%;max-width:560px;max-height:90vh;overflow-y:auto;' })
    const head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--border);' },
      el('h3', { style: 'margin:0;font-size:1.1rem;' }, title),
      C.button({ label: '✕', variant: 'ghost', size: 'sm', onClick: () => overlay.remove() }),
    )
    const body = el('div', { style: 'padding:24px;' }, content)
    box.appendChild(head)
    box.appendChild(body)
    overlay.appendChild(box)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    return overlay
  }

  // Form Tambah / Edit
  function openWorkerForm(worker = null) {
    editingWorker = worker
    const isEdit = !!worker
    const form = el('form', { className: 'form', style: 'display:flex;flex-direction:column;gap:14px;' })

    const fields = {
      name: el('input', { className: 'input', placeholder: 'Nama lengkap', value: worker?.name || '' }),
      phone: el('input', { className: 'input', placeholder: 'No. HP', value: worker?.phone || '' }),
      email: el('input', { className: 'input', placeholder: 'Email', value: worker?.email || '' }),
      address: el('input', { className: 'input', placeholder: 'Alamat (untuk geocoding)', value: worker?.address || '' }),
      lat: el('input', { className: 'input', placeholder: 'Latitude', value: worker?.lat || '' }),
      lng: el('input', { className: 'input', placeholder: 'Longitude', value: worker?.lng || '' }),
      skills: el('input', { className: 'input', placeholder: 'Skill (pisah koma): ac, cleaning, waterproofing', value: (worker?.skills || []).join(', ') }),
      zones: el('input', { className: 'input', placeholder: 'Zona (pisah koma): Jakarta Selatan, Depok', value: (worker?.zones || []).join(', ') }),
      rating: el('input', { className: 'input', placeholder: 'Rating 0-5', value: worker?.rating || '4.5' }),
      maxJobs: el('input', { className: 'input', placeholder: 'Max job per hari', value: worker?.maxJobs || '4' }),
      status: C.select({ options: [{ value: 'available', label: 'Tersedia' }, { value: 'on_job', label: 'Dalam Tugas' }, { value: 'off_duty', label: 'Off Duty' }, { value: 'sick', label: 'Sakit' }], value: worker?.status || 'available' }),
    }

    form.appendChild(el('label', {}, 'Nama', fields.name))
    form.appendChild(el('label', {}, 'No. HP', fields.phone))
    form.appendChild(el('label', {}, 'Email', fields.email))
    form.appendChild(el('div', { className: 'form-row' },
      el('label', {}, 'Alamat', fields.address),
      el('label', {}, 'Lat', fields.lat),
      el('label', {}, 'Lng', fields.lng),
    ))
    form.appendChild(el('div', { className: 'form-row' },
      el('label', {}, 'Skill', fields.skills),
      el('label', {}, 'Zona', fields.zones),
    ))
    form.appendChild(el('div', { className: 'form-row' },
      el('label', {}, 'Rating', fields.rating),
      el('label', {}, 'Max Job/Hari', fields.maxJobs),
      el('label', {}, 'Status', fields.status.wrap),
    ))

    const saveBtn = C.button({ label: isEdit ? 'Simpan Perubahan' : 'Tambah Petugas', icon: 'check', variant: 'primary', type: 'submit' })
    const delBtn = isEdit ? C.button({ label: 'Hapus', icon: 'trash', variant: 'danger', onClick: () => {
      if (confirm(`Yakin hapus ${worker.name}?`)) {
        localWorkers = localWorkers.filter((w) => w.id !== worker.id)
        overlay.remove()
        renderWorkerCards(localWorkers)
        showToast(`${worker.name} dihapus.`, 'success')
      }
    } }) : null

    form.appendChild(el('div', { className: 'form-actions', style: 'margin-top:8px;' }, saveBtn, delBtn || ''))

    const overlay = createModal(isEdit ? 'Edit Petugas' : 'Tambah Petugas Baru', form)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const newWorker = {
        id: worker?.id || 'w' + Date.now(),
        name: fields.name.value.trim(),
        phone: fields.phone.value.trim(),
        email: fields.email.value.trim(),
        address: fields.address.value.trim(),
        lat: parseFloat(fields.lat.value) || -6.2,
        lng: parseFloat(fields.lng.value) || 106.8,
        skills: fields.skills.value.split(',').map((s) => s.trim()).filter(Boolean),
        zones: fields.zones.value.split(',').map((s) => s.trim()).filter(Boolean),
        rating: parseFloat(fields.rating.value) || 4.5,
        maxJobs: parseInt(fields.maxJobs.value) || 4,
        status: fields.status.input.value,
        completed: worker?.completed || 0,
        onTime: worker?.onTime || 95,
      }
      if (!newWorker.name) { showToast('Nama wajib diisi.', 'danger'); return }

      if (isEdit) {
        const idx = localWorkers.findIndex((w) => w.id === worker.id)
        if (idx >= 0) localWorkers[idx] = newWorker
      } else {
        localWorkers.push(newWorker)
      }
      overlay.remove()
      renderWorkerCards(localWorkers)
      showToast(isEdit ? `${newWorker.name} diperbarui.` : `${newWorker.name} ditambahkan.`, 'success')
    })
  }

  // Bulk Import Modal
  function openBulkImport() {
    const textarea = el('textarea', { className: 'input', style: 'min-height:200px;font-family:monospace;font-size:0.85rem;', placeholder: '[\n  {"name":"Ahmad","phone":"0812...","skills":["ac"],"zones":["Jakarta"],"status":"available"},\n  ...\n]' })
    const form = el('form', { className: 'form' },
      el('p', { className: 'text-body', style: 'font-size:0.85rem;margin-bottom:12px;' }, 'Paste JSON array petugas. Format: name, phone, email, skills[], zones[], status, address, lat, lng, rating, maxJobs.'),
      textarea,
      el('div', { className: 'form-actions', style: 'margin-top:12px;' },
        C.button({ label: 'Import', icon: 'upload', variant: 'primary', type: 'submit' }),
        C.button({ label: 'Contoh Data', icon: 'file', variant: 'soft', onClick: () => {
          textarea.value = JSON.stringify([
            { name: 'Ahmad Fauzi', phone: '0812-1111-2222', email: 'ahmad@satualur.id', skills: ['ac', 'electrical'], zones: ['Jakarta Selatan', 'Depok'], status: 'available', address: 'Jl. Fatmawati', lat: -6.2673, lng: 106.7976, rating: 4.7, maxJobs: 4 },
            { name: 'Maya Sari', phone: '0822-3333-4444', email: 'maya@satualur.id', skills: ['cleaning', 'sofa'], zones: ['Tangerang'], status: 'available', address: 'Jl. Thamrin', lat: -6.1777, lng: 106.6296, rating: 4.9, maxJobs: 5 },
          ], null, 2)
        } }),
      ),
    )
    const overlay = createModal('Import Bulk Petugas (JSON)', form)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      try {
        const data = JSON.parse(textarea.value.trim())
        const arr = Array.isArray(data) ? data : [data]
        let added = 0
        arr.forEach((item) => {
          if (item.name) {
            localWorkers.push({
              id: 'w' + Date.now() + '_' + added,
              name: item.name,
              phone: item.phone || '',
              email: item.email || '',
              skills: item.skills || [],
              zones: item.zones || [],
              status: item.status || 'available',
              address: item.address || '',
              lat: item.lat || -6.2,
              lng: item.lng || 106.8,
              rating: item.rating || 4.5,
              maxJobs: item.maxJobs || 4,
              completed: item.completed || 0,
              onTime: item.onTime || 95,
            })
            added++
          }
        })
        overlay.remove()
        renderWorkerCards(localWorkers)
        showToast(`${added} petugas berhasil diimport.`, 'success')
      } catch (err) {
        showToast('JSON tidak valid: ' + err.message, 'danger')
      }
    })
  }

  // Inject Query Modal
  function openInjectQuery() {
    const textarea = el('textarea', { className: 'input', style: 'min-height:180px;font-family:monospace;font-size:0.85rem;', placeholder: "-- Contoh: UPDATE workers SET status='available' WHERE zone='Jakarta'\n-- atau perintah custom lainnya" })
    const form = el('form', { className: 'form' },
      el('p', { className: 'text-body', style: 'font-size:0.85rem;margin-bottom:12px;' }, 'Jalankan perintah manipulasi data petugas. Hati-hati, tidak ada undo!'),
      textarea,
      el('div', { className: 'form-actions', style: 'margin-top:12px;' },
        C.button({ label: 'Jalankan', icon: 'play', variant: 'primary', type: 'submit' }),
        C.button({ label: 'Contoh Query', icon: 'file', variant: 'soft', onClick: () => {
          textarea.value = `// JavaScript expression untuk manipulasi array localWorkers:
localWorkers.forEach(w => {
  if (w.zones.includes('Jakarta Selatan')) {
    w.status = 'available'
    w.maxJobs = 5
  }
})
// Tulis expression valid, hasil akan di-eval.`
        } }),
      ),
    )
    const overlay = createModal('Inject Query (Advanced)', form)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      try {
        const code = textarea.value.trim()
        // Safe-ish eval with localWorkers in scope
        const fn = new Function('localWorkers', code)
        fn(localWorkers)
        overlay.remove()
        renderWorkerCards(localWorkers)
        showToast('Query berhasil dijalankan.', 'success')
      } catch (err) {
        showToast('Error: ' + err.message, 'danger')
      }
    })
  }

  const filterRow = el('div', { className: 'form-row', style: 'margin-bottom:16px;' },
    el('input', { className: 'input', placeholder: 'Cari nama petugas...', id: 'worker-search', style: 'flex:1;' }),
    C.select({ id: 'skill-filter', options: [{ value: '', label: 'Semua Skill' }, ...Object.entries(SKILL_LABELS).map(([k, v]) => ({ value: k, label: v }))], value: '', onChange: () => filterWorkers() }),
    C.select({ id: 'status-filter', options: [{ value: '', label: 'Semua Status' }, { value: 'available', label: 'Tersedia' }, { value: 'on_job', label: 'Dalam Tugas' }, { value: 'off_duty', label: 'Off Duty' }], value: '', onChange: () => filterWorkers() }),
  )

  const grid = el('div', { className: 'cards-grid' })
  target.appendChild(el('div', { className: 'form-actions', style: 'margin-bottom:16px;' },
    C.button({ label: 'Tambah Petugas', icon: 'plus', variant: 'primary', onClick: () => openWorkerForm() }),
    C.button({ label: 'Import Bulk JSON', icon: 'upload', variant: 'soft', onClick: () => openBulkImport() }),
    C.button({ label: 'Inject Query', icon: 'terminal', variant: 'soft', onClick: () => openInjectQuery() }),
  ))
  target.appendChild(filterRow)
  target.appendChild(grid)

  function renderWorkerCards(list) {
    grid.replaceChildren()
    list.forEach((w) => {
      const st = STATUS_LABELS[w.status] || STATUS_LABELS.available
      const card = el('article', { className: 'card card-hover' },
        el('div', { className: 'card-accent-row' },
          C.tag(st.label, st.color),
          C.tag(`${w.rating} ★`, 'warning'),
        ),
        el('div', { style: 'display:flex;align-items:center;gap:12px;margin:12px 0;' },
          el('div', { style: 'width:48px;height:48px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;flex-shrink:0;' }, w.avatar || w.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()),
          el('div', { style: 'min-width:0;' },
            el('h3', { className: 'card-title', style: 'margin:0;font-size:1rem;' }, w.name),
            el('p', { className: 'muted small', style: 'margin:2px 0 0;' }, w.phone),
          ),
        ),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:8px 0;' },
          ...(w.skills || []).map((s) => C.tag(SKILL_LABELS[s] || s, 'soft')),
        ),
        el('div', { className: 'deflist' },
          el('dt', {}, '📍 Zona'), el('dd', {}, (w.zones || []).join(', ')),
          el('dt', {}, '✅ Selesai'), el('dd', {}, `${w.completed} job`),
          el('dt', {}, '⏰ On-time'), el('dd', {}, `${w.onTime}%`),
          el('dt', {}, '📅 Max/hari'), el('dd', {}, `${w.maxJobs} job`),
        ),
        el('div', { className: 'form-actions', style: 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);' },
          C.button({ label: 'Edit', icon: 'edit', variant: 'soft', size: 'sm', onClick: () => openWorkerForm(w) }),
          C.button({ label: 'Hapus', icon: 'trash', variant: 'ghost', size: 'sm', onClick: () => {
            if (confirm(`Yakin hapus ${w.name}?`)) {
              localWorkers = localWorkers.filter((x) => x.id !== w.id)
              renderWorkerCards(localWorkers)
              showToast(`${w.name} dihapus.`, 'success')
            }
          } }),
        ),
      )
      grid.appendChild(card)
    })
  }

  renderWorkerCards(localWorkers)

  function filterWorkers() {
    const search = (document.getElementById('worker-search')?.value || '').toLowerCase()
    const skill = document.getElementById('skill-filter')?.value || ''
    const statusVal = document.getElementById('status-filter')?.value || ''
    const filtered = localWorkers.filter((w) => {
      if (search && !w.name.toLowerCase().includes(search)) return false
      if (skill && !w.skills?.includes(skill)) return false
      if (statusVal && w.status !== statusVal) return false
      return true
    })
    renderWorkerCards(filtered)
  }

  document.getElementById('worker-search')?.addEventListener('input', filterWorkers)
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

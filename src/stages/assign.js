/** 03 — Penugasan: assign an approved offer to a worker with AI matching, map, and team management. */
import { loadWorkers, loadLinks, saveWorker, removeWorker, createTeamAssignment, loadSkills, addSkill, renameSkill, deleteSkill, saveWorkerLocation } from './workers-repo.js'
import { geocode } from '../geo.js'
import { loadLeaflet, addBaseLayer, disposeMap } from '../ui/leaflet.js'
import { SKILL_LABELS, workerState, completedCount, hasHistory, inferSkill, scoreWorkers, pickRecommended, joinWorkerNames } from '../domain/workers.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'
import { labelMap, sortSkills, nameProblem, workersUsing, NAME_MAX } from '../domain/skills.js'

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

const TABS = [
  { value: 'assign', label: 'Tugaskan' },
  { value: 'team', label: 'Tim' },
  { value: 'map', label: 'Peta' },
  { value: 'performance', label: 'Performa' },
]
let currentTab = 'assign'
// key → display name of this business's skills (built-in names until loaded).
let labels = { ...SKILL_LABELS }

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
    C.pageHeader({ title: 'Penugasan Pintar' }),
    tabs, status, host,
  )

  let flow = null
  let workers = []
  let links = []
  let skills = []

  async function load() {
    try {
      ;[flow, workers, links, skills] = await Promise.all([loadFlow(), loadWorkers(), loadLinks(), loadSkills().catch(() => [])])
      labels = labelMap(skills)
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

  let cleanupTab = null
  ctx.signal?.addEventListener?.('abort', () => { cleanupTab?.(); cleanupTab = null })
  function draw() {
    cleanupTab?.()
    cleanupTab = null
    host.replaceChildren()
    if (!flow) return
    switch (currentTab) {
      case 'assign': renderAssign(host, ctx, flow, workers, links, reload, status, () => tabs.querySelector('[data-value="team"]').click()); break
      case 'team': renderTeam(host, { workers, skills, assignments: flow.assignments, completions: flow.completions, links, reload, status }); break
      case 'map': cleanupTab = renderMap(host, { workers, assignments: flow.assignments, links, flow }); break
      case 'performance': renderPerformance(host, { workers, assignments: flow.assignments, completions: flow.completions, links }); break
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
  const applyRecommend = () => {
    const n = Math.max(1, parseInt(count.input.value, 10) || 1)
    checked.clear()
    pickRecommended(scored, n).forEach((w) => checked.add(w.id))
    drawPick()
  }
  const recommend = C.button({ label: 'Pilih rekomendasi', icon: 'check', variant: 'soft', onClick: applyRecommend })
  count.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyRecommend() }
  })
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
  const pg = C.pager({ key: 'assignments', label: 'daftar penugasan', onChange: () => drawList(), scrollTarget: listPanel })

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
            ...(w.skills || []).map((k) => C.tag(labels[k] || k)),
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
      el('div', {}, el('strong', {}, 'Keahlian: '), skills.map((k) => labels[k] || k).join(', ') || '—'),
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
    drawList()
  }

  function drawList() {
    const active = flow.activeAssignments().length
    listPanel.querySelector('.panel-meta').textContent = `${flow.assignments.length} baris · ${active} aktif`
    if (!flow.assignments.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada penugasan.', body: 'Pilih penawaran yang disetujui dan tentukan pelaksananya.' }))
      return
    }
    const now = Date.now()
    listBody.replaceChildren(C.dataTable({
      caption: 'Daftar penugasan',
      rows: pg.slice(flow.assignments),
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
    }), pg.root)
  }

  fillOffers()
  loadList()
}

/* ================================================================ Tab: Team */
const PHONE_RE = /^[+()\d\s.-]{6,32}$/
const STATE_TAG = { available: ['Tersedia', 'ok'], on_job: ['Dalam tugas', 'warn'], inactive: ['Nonaktif', 'neutral'] }

function renderTeam(target, { workers, skills, assignments, completions, links, reload, status }) {
  const dialog = el('dialog', { className: 'panel', 'aria-labelledby': 'worker-dialog-title' })
  dialog.addEventListener('close', () => dialog.replaceChildren())

  function openWorkerForm(worker = null) {
    const isEdit = !!worker
    const name = C.field({ label: 'Nama', name: 'name', required: true, value: worker?.name || '' })
    const phone = C.field({ label: 'No. HP', name: 'phone', type: 'tel', value: worker?.phone || '' })
    const address = C.field({ label: 'Alamat', name: 'address', value: worker?.address || '', hint: 'Dipakai untuk menentukan zona dan jarak.' })
    const picked = new Set(worker?.skills || [])
    const skillList = sortSkills(skills.length ? skills : Object.entries(labels).map(([key, name]) => ({ key, name })))
    const chipsLabelId = `skills-label-${Date.now()}`
    const chips = el('div', { className: 'chip-toggles', role: 'group', 'aria-labelledby': chipsLabelId })
    const drawChips = () => chips.replaceChildren(...skillList.map((sk) => {
      const on = picked.has(sk.key)
      const b = el('button', { type: 'button', className: `chip-toggle${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false' },
        on ? C.icon('check', { size: 14 }) : '', sk.name)
      b.addEventListener('click', () => { if (picked.has(sk.key)) picked.delete(sk.key); else picked.add(sk.key); drawChips() })
      return b
    }))
    drawChips()
    // Inline "add new skill": saved to the business list and selected right away.
    const newSkill = el('input', { className: 'input', type: 'text', placeholder: 'Keahlian baru, mis. Instalasi CCTV', maxLength: NAME_MAX, 'aria-label': 'Nama keahlian baru' })
    const addBtn = C.button({ label: 'Tambah', icon: 'plus', size: 'sm', variant: 'soft' })
    const addNew = async () => {
      const name = newSkill.value
      const problem = nameProblem(name, skillList)
      if (problem) { msg.show('danger', problem); return }
      const restore = C.setBusy(addBtn, '…')
      try {
        await addSkill(name, skillList)
        const fresh = await loadSkills()
        const made = fresh.find((x) => !skillList.some((y) => y.key === x.key))
        skillList.splice(0, skillList.length, ...sortSkills(fresh))
        labels = labelMap(fresh)
        if (made) picked.add(made.key)
        newSkill.value = ''
        msg.hide()
        drawChips()
      } catch (err) { msg.show('danger', err.message) }
      restore()
    }
    addBtn.addEventListener('click', addNew)
    newSkill.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew() } })
    const skillField = el('div', { className: 'field' },
      el('span', { className: 'field-label', id: chipsLabelId }, 'Keahlian'),
      chips,
      el('div', { className: 'chip-add' }, newSkill, addBtn),
      el('span', { className: 'field-hint' }, 'Ketuk untuk memilih. Ubah nama atau hapus keahlian di panel Keahlian.'))
    const statusSel = isEdit ? C.select({ label: 'Status', name: 'status', options: [{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }], value: worker.status }) : null
    const msg = C.message()
    const submit = C.button({ label: isEdit ? 'Simpan perubahan' : 'Tambah petugas', icon: 'check', variant: 'primary', type: 'submit' })
    const cancel = C.button({ label: 'Batal', variant: 'ghost', onClick: () => dialog.close() })
    const form = el('form', { className: 'form' },
      name.wrap, phone.wrap, address.wrap,
      skillField,
      statusSel?.wrap, msg,
      el('div', { className: 'form-actions' }, submit, cancel),
    )
    form.noValidate = true
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      msg.hide()
      const fields = {
        name: name.input.value.trim(), phone: phone.input.value.trim(), address: address.input.value.trim(),
        skills: skillList.map((sk) => sk.key).filter((k) => picked.has(k)),
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
    dialog.replaceChildren(el('h2', { className: 'panel-title', id: 'worker-dialog-title' }, isEdit ? 'Edit petugas' : 'Tambah petugas'), form)
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
      el('div', {}, ...(w.skills || []).map((s) => C.tag(labels[s] || s))),
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

  /* Keahlian: add, rename (inline) and delete; stored per business. */
  function skillsPanel() {
    const list = sortSkills(skills)
    const rows = el('div', { className: 'skill-rows' })
    const draw = () => rows.replaceChildren(...list.map((sk) => {
      const used = workersUsing(sk.key, workers).length
      const name = el('span', { className: 'skill-name' }, sk.name)
      const meta = el('span', { className: 'muted small' }, used ? `${used} petugas` : 'Belum dipakai')
      const row = el('div', { className: 'skill-row' }, el('div', { className: 'skill-text' }, name, meta))
      const edit = C.button({ label: 'Ubah', icon: 'edit', size: 'sm', variant: 'ghost', onClick: () => {
        const input = el('input', { className: 'input', type: 'text', value: sk.name, maxLength: NAME_MAX, 'aria-label': `Nama baru untuk ${sk.name}` })
        const save = C.button({ label: 'Simpan', icon: 'check', size: 'sm', variant: 'soft' })
        const cancel = C.button({ label: 'Batal', size: 'sm', variant: 'ghost', onClick: draw })
        const commit = () => act('Ubah keahlian gagal', () => renameSkill(sk, input.value, list), `Keahlian diganti menjadi ${input.value.trim()}.`)
        save.addEventListener('click', commit)
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.stopPropagation(); draw() } })
        row.replaceChildren(input, el('div', { className: 'skill-actions' }, save, cancel))
        input.focus()
        input.select()
      } })
      const del = C.button({ label: 'Hapus', icon: 'trash', size: 'sm', variant: 'ghost', onClick: () => {
        const q = used ? `Hapus keahlian "${sk.name}"? Keahlian ini juga dilepas dari ${used} petugas.` : `Hapus keahlian "${sk.name}"?`
        if (!window.confirm(q)) return
        act('Hapus keahlian gagal', () => deleteSkill(sk, workers), `Keahlian ${sk.name} dihapus.`)
      } })
      row.append(el('div', { className: 'skill-actions' }, edit, del))
      return row
    }))
    draw()
    const input = el('input', { className: 'input', type: 'text', placeholder: 'Nama keahlian baru', maxLength: NAME_MAX, 'aria-label': 'Nama keahlian baru' })
    const add = C.button({ label: 'Tambah', icon: 'plus', size: 'sm', variant: 'primary' })
    const submit = () => act('Tambah keahlian gagal', () => addSkill(input.value, list), `Keahlian ${input.value.trim()} ditambahkan.`)
    add.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } })
    return C.panel({ title: 'Keahlian', meta: `${list.length} keahlian`, className: 'skills-panel' },
      el('div', { className: 'chip-add' }, input, add), rows)
  }

  const byName = [...workers].sort((a, b) => a.name.localeCompare(b.name))
  const active = byName.filter((w) => w.status === 'active')
  const inactive = byName.filter((w) => w.status !== 'active')

  target.append(
    dialog,
    el('div', { className: 'form-actions' }, C.button({ label: 'Tambah petugas', icon: 'plus', variant: 'primary', onClick: () => openWorkerForm() })),
    C.panel({ title: 'Tim petugas', meta: `${active.length} aktif` },
      active.length ? active.map(card) : C.emptyState({ title: 'Belum ada petugas aktif', iconName: 'users', body: 'Tambahkan petugas untuk mulai menugaskan pekerjaan.' })),
    inactive.length ? C.panel({ title: 'Nonaktif', meta: `${inactive.length} petugas` }, inactive.map(card)) : '',
    skillsPanel(),
  )
}

/* ================================================================ Tab: Map */
const STATE_LABELS = { available: 'Tersedia', on_job: 'Dalam tugas', inactive: 'Nonaktif' }
const STATE_COLORS = { available: '--success', on_job: '--warning', inactive: '--text-muted' }
const located = (o) => Number.isFinite(Number(o?.lat)) && Number.isFinite(Number(o?.lng ?? o?.lon)) && o.lat !== null
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
const MAX_GEOCODE_PER_VISIT = 8

/** Leaflet map of petugas (OpenStreetMap). Returns a cleanup function. */
function renderMap(target, { workers, assignments, links, flow }) {
  let map = null
  let disposed = false
  const mapEl = el('div', { className: 'worker-lmap', role: 'region', 'aria-label': 'Peta lokasi petugas' })
  const note = el('p', { className: 'muted small worker-map-note' })
  const legend = el('div', { className: 'worker-map-legend' },
    ['available', 'on_job', 'inactive'].map((k) => el('span', { className: 'muted small' }, el('i', { className: `worker-pin-dot is-${k}` }), STATE_LABELS[k])),
    el('span', { className: 'muted small' }, el('i', { className: 'worker-pin-dot is-job' }), 'Lokasi job hari ini'))

  if (!workers.length) {
    target.appendChild(C.emptyState({ title: 'Belum ada petugas', iconName: 'users', body: 'Tambahkan petugas di tab Tim, lalu isi alamatnya.' }))
    return () => {}
  }
  const withAddress = workers.filter((w) => String(w.address || '').trim().length >= 3)
  if (!workers.some(located) && !withAddress.length) {
    target.appendChild(C.emptyState({ title: 'Belum ada lokasi petugas', iconName: 'mapPin', body: 'Isi alamat petugas di tab Tim untuk menampilkannya di peta.' }))
    return () => {}
  }
  const panel = C.panel({ title: 'Lokasi petugas', meta: 'Memuat peta…' }, mapEl, legend, note)
  target.appendChild(panel)
  const meta = panel.querySelector('.panel-meta')

  const today = new Date()
  const jobs = (assignments || []).filter((a) => a.status === 'assigned' && a.scheduled_at && new Date(a.scheduled_at).toDateString() === today.toDateString())
    .map((a) => ({ a, r: flow?.requestOfAssignment?.(a) }))
    .filter(({ r }) => r && located({ lat: r.lat, lng: r.lng ?? r.lon }))

  ;(async () => {
    // Fill missing coordinates from addresses (server geocoder, cached); a few per visit.
    const missing = withAddress.filter((w) => !located(w)).slice(0, MAX_GEOCODE_PER_VISIT)
    let filled = 0
    for (const w of missing) {
      if (disposed) return
      const geo = await geocode(w.address)
      if (geo) { Object.assign(w, geo); filled++; saveWorkerLocation(w.id, geo).catch(() => {}) }
    }
    let L
    try { L = await loadLeaflet() } catch {
      mapEl.replaceWith(C.errorState('Peta gagal dimuat. Periksa koneksi lalu buka tab ini lagi.'))
      return
    }
    if (disposed) return
    const pins = workers.filter(located)
    const noLoc = workers.filter((w) => !located(w))
    meta.textContent = `${pins.length} dari ${workers.length} petugas punya lokasi`
    note.textContent = noLoc.length
      ? `Belum di peta: ${noLoc.map((w) => w.name).join(', ')}. ${noLoc.some((w) => !w.address) ? 'Isi alamatnya di tab Tim.' : 'Alamatnya belum ditemukan; perjelas alamat (kelurahan, kota).'}`
      : ''
    map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomAnimation: false, markerZoomAnimation: false, scrollWheelZoom: false })
    addBaseLayer(L, map)
    const icon = (color, ring) => L.divIcon({ className: 'worker-lpin', html: `<span style="background:${color};box-shadow:0 0 0 3px ${ring}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9] })
    const bounds = []
    const surface = cssVar('--surface', '#fff')
    for (const w of pins) {
      const state = workerState(w, assignments, links)
      const ll = [Number(w.lat), Number(w.lng)]
      bounds.push(ll)
      const pop = el('div', { className: 'worker-lpop' },
        el('strong', {}, w.name),
        el('div', {}, C.tag(STATE_LABELS[state], state === 'available' ? 'ok' : state === 'on_job' ? 'warn' : 'neutral')),
        (w.skills || []).length ? el('div', { className: 'muted small' }, (w.skills || []).map((k) => labels[k] || k).join(', ')) : '',
        w.phone ? el('a', { href: `tel:${w.phone}` }, w.phone) : '',
        w.zone ? el('div', { className: 'muted small' }, w.zone) : '')
      L.marker(ll, { icon: icon(cssVar(STATE_COLORS[state], '#888'), surface), title: w.name, keyboard: true, alt: w.name }).addTo(map).bindPopup(pop)
    }
    for (const { a, r } of jobs) {
      const ll = [Number(r.lat), Number(r.lng ?? r.lon)]
      bounds.push(ll)
      const pop = el('div', { className: 'worker-lpop' },
        el('strong', {}, customerLabel(r)),
        el('div', { className: 'muted small' }, `${a.worker_name || 'Tanpa petugas'} · ${C.formatDateTime(a.scheduled_at)}`))
      L.marker(ll, { icon: icon(cssVar('--accent', '#e7a13a'), surface), title: customerLabel(r), keyboard: true }).addTo(map).bindPopup(pop)
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14, animate: false })
    else map.setView([-2.5, 118], 4)
  })()

  return () => { disposed = true; disposeMap(map); map = null }
}

/* ================================================================ Tab: Performance */
function renderPerformance(target, { workers, assignments, completions, links }) {
  const activeList = workers.filter((w) => w.status === 'active')
  const done = new Map(workers.map((w) => [w.id, completedCount(w.id, links, completions)]))
  const total = [...done.values()].reduce((a, n) => a + n, 0)
  const onJob = activeList.filter((w) => workerState(w, assignments, links) === 'on_job').length
  const ranked = [...workers].sort((a, b) => done.get(b.id) - done.get(a.id) || a.name.localeCompare(b.name, 'id'))

  target.appendChild(el('div', { className: 'kpis' },
    C.kpi({ label: 'Petugas aktif', value: String(activeList.length), iconName: 'users' }),
    C.kpi({ label: 'Job selesai', value: String(total), iconName: 'check' }),
    C.kpi({ label: 'Dalam tugas hari ini', value: String(onJob), iconName: 'clock' }),
  ))
  target.appendChild(C.panel({ title: 'Peringkat petugas', meta: 'Berdasarkan job selesai' },
    ranked.length
      ? C.dataTable({
        caption: 'Peringkat petugas berdasarkan job selesai',
        columns: [
          { label: '#', render: (w) => String(ranked.indexOf(w) + 1) },
          { label: 'Petugas', key: 'name' },
          { label: 'Status', render: (w) => { const s = workerState(w, assignments, links); return C.tag(STATE_LABELS[s], s === 'available' ? 'ok' : s === 'on_job' ? 'warn' : 'neutral') } },
          { label: 'Job selesai', align: 'right', render: (w) => String(done.get(w.id)) },
        ],
        rows: ranked,
      })
      : C.emptyState({ title: 'Belum ada petugas', body: 'Tambahkan petugas di tab Tim.' })))
}

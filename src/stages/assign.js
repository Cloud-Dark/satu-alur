/** 03 — Penugasan: assign an approved offer to a worker with a schedule. */
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

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const offerSel = C.select({ label: 'Penawaran disetujui', name: 'offer_id', required: true, hint: 'Penawaran yang belum ditugaskan tampil lebih dulu.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { className: 'req-preview', hidden: true })
  const worker = C.field({ label: 'Nama pekerja atau tim', name: 'worker_name', required: true, placeholder: 'Ahmad & Tim', attrs: { maxlength: '120', autocomplete: 'off' } })
  const when = C.field({ label: 'Jadwal pelaksanaan', name: 'scheduled_at', type: 'datetime-local', required: true, value: defaultSchedule(), hint: 'Waktu lokal perangkat Anda.' })
  const submit = C.button({ label: 'Tugaskan', icon: 'users', variant: 'primary', type: 'submit' })
  const msg = C.message()

  const form = el('form', { className: 'form' },
    offerSel.wrap, preview,
    el('div', { className: 'form-row' }, worker.wrap, when.wrap),
    el('div', { className: 'form-actions' }, submit),
    msg,
  )
  form.noValidate = true

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar penugasan', meta: 'memuat…', className: 'list-panel' }, listBody)

  container.replaceChildren(
    C.pageHeader({ num: '03', label: 'Penugasan', title: 'Penugasan pelaksana', em: 'pelaksana', description: 'Jadwalkan siapa yang mengerjakan penawaran yang sudah disetujui, dan kapan.' }),
    el('div', { className: 'stage-grid' },
      C.panel({ title: 'Tugaskan pekerja', meta: 'Jadwal & pelaksana', raised: true, className: 'form-panel' }, form),
      listPanel,
    ),
  )

  let flow = null

  function fillOffers() {
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
    if (!o) { preview.hidden = true; return }
    const r = flow.requestOfOffer(o)
    preview.replaceChildren(C.defList([
      ['Pelanggan', `${customerLabel(r)}${r?.location ? ` · ${r.location}` : ''}`],
      ['Lingkup', o.validated_scope || '—'],
      ['Nilai', el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price))],
    ]))
    preview.hidden = false
  }
  offerSel.input.addEventListener('change', () => { msg.hide(); showPreview() })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.hide()
    const errors = []
    const offer = flow?.offer(offerSel.input.value)
    const name = worker.input.value.trim()
    const date = when.input.value ? new Date(when.input.value) : null
    if (!offer) errors.push('Pilih penawaran.')
    if (!name) errors.push('Isi nama pekerja atau tim.')
    if (!date || Number.isNaN(date.getTime())) errors.push('Isi jadwal pelaksanaan yang valid.')
    if (errors.length) {
      msg.show('danger', 'Periksa kembali isian berikut.', errors)
      ;(!offer ? offerSel.input : !name ? worker.input : when.input).focus()
      return
    }
    const restore = C.setBusy(submit, 'Menyimpan…')
    try {
      const { data, error } = await getCloud().database.from('assignments').insert({
        offer_id: Number(offer.id),
        worker_name: name,
        scheduled_at: date.toISOString(),
        status: 'assigned',
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      worker.input.value = ''
      offerSel.input.value = ''
      when.input.value = defaultSchedule()
      const past = date.getTime() < Date.now()
      msg.show('ok', `${name} ditugaskan untuk ${customerLabel(flow.requestOfOffer(offer))}, ${C.formatDateTime(date)}.${past ? ' Catatan: jadwal ini sudah lewat.' : ''}`)
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
    try {
      flow = await loadFlow()
    } catch (err) {
      listBody.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
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
          label: 'Pelaksana · jadwal',
          render: (a) => el('div', { className: 'cell-stack' },
            el('span', { className: 'cell-primary' }, a.worker_name || '—'),
            el('time', { className: 'cell-secondary tnum', datetime: a.scheduled_at || '' }, C.formatDateTime(a.scheduled_at)),
          ),
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

  await loadList()
}

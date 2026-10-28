/** 03 — Penugasan: assign an approved offer to a worker with a schedule. */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'

const { el, icon } = C

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
  const preview = el('div', { hidden: true })
  const ctxBox = el('div', {})
  const worker = C.field({ label: 'Nama pekerja atau tim', name: 'worker_name', required: true, placeholder: 'Ahmad & Tim', attrs: { maxlength: '120', autocomplete: 'off' } })
  const when = C.field({ label: 'Jadwal pelaksanaan', name: 'scheduled_at', type: 'datetime-local', required: true, value: defaultSchedule(), hint: 'Waktu lokal perangkat Anda.' })
  const confirmBox = el('div', { className: 'proposal' })

  let flow = null
  const selectedOffer = () => flow?.offer(offerSel.input.value) || null
  const scheduleDate = () => { const d = when.input.value ? new Date(when.input.value) : null; return d && !Number.isNaN(d.getTime()) ? d : null }

  const wiz = C.wizard({
    label: 'Tugaskan pekerja',
    steps: [
      {
        key: 'pick',
        title: 'Pilih penawaran',
        description: 'Penawaran disetujui yang akan dikerjakan.',
        content: [offerSel.wrap, preview],
        validate: () => (selectedOffer() ? [] : [{ text: 'Pilih penawaran.', input: offerSel.input }]),
        primary: () => ({ disabled: !flow?.offers.some((o) => o.status === 'approved') }),
      },
      {
        key: 'who',
        title: 'Pelaksana & jadwal',
        description: 'Siapa yang mengerjakan, dan kapan.',
        content: [ctxBox, worker.wrap, when.wrap],
        validate: () => {
          const errs = []
          if (!worker.input.value.trim()) errs.push({ text: 'Isi nama pekerja atau tim.', input: worker.input })
          if (!scheduleDate()) errs.push({ text: 'Isi jadwal pelaksanaan yang valid.', input: when.input })
          return errs
        },
        onEnter: () => drawContext(),
      },
      {
        key: 'confirm',
        title: 'Konfirmasi',
        description: 'Periksa ringkasan sebelum menugaskan.',
        content: confirmBox,
        primary: { label: 'Tugaskan', icon: 'users', iconRight: undefined },
        validate: () => {
          const errs = []
          if (!selectedOffer()) errs.push('Pilih penawaran.')
          if (!worker.input.value.trim()) errs.push('Isi nama pekerja atau tim.')
          if (!scheduleDate()) errs.push('Isi jadwal pelaksanaan yang valid.')
          return errs
        },
        onPrimary: () => save(),
        onEnter: () => drawConfirm(),
      },
    ],
  })
  const msg = wiz.msg

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar penugasan', meta: 'memuat…', className: 'list-panel' }, listBody)
  const pg = C.pager({ key: 'assignments', label: 'daftar penugasan', onChange: () => drawList(), scrollTarget: listPanel })

  container.replaceChildren(
    C.pageHeader({ num: '03', label: 'Penugasan', title: 'Penugasan pelaksana', em: 'pelaksana', description: 'Jadwalkan siapa yang mengerjakan penawaran yang sudah disetujui, dan kapan.' }),
    el('div', { className: 'stage-grid has-wizard' }, wiz.root, listPanel),
  )

  const offerPreview = (o, { scope = true } = {}) => {
    const r = flow.requestOfOffer(o)
    return C.miniPreview({
      title: customerLabel(r),
      aside: C.rupiah(o.validated_price),
      chips: [
        r?.service_type ? { icon: 'layers', text: r.service_type } : null,
        r?.location ? { icon: 'mapPin', text: r.location } : null,
      ],
      note: scope ? (o.validated_scope || null) : null,
    })
  }

  let firstFill = true
  function fillOffers() {
    const approved = flow.offers.filter((o) => o.status === 'approved')
    const free = approved.filter((o) => !flow.assignmentsOf(o.id).length)
    const taken = approved.filter((o) => flow.assignmentsOf(o.id).length)
    const label = (o) => { const r = flow.requestOfOffer(o); return `${customerLabel(r)} — ${C.rupiah(o.validated_price)}` }
    const opts = [{ value: '', label: approved.length ? 'Pilih penawaran' : 'Belum ada penawaran disetujui' }]
    free.forEach((o) => opts.push({ value: o.id, label: label(o) }))
    taken.forEach((o) => opts.push({ value: o.id, label: `${label(o)} (sudah ditugaskan)` }))
    const keep = offerSel.input.value || (firstFill && params.offerId != null ? String(params.offerId) : '')
    C.setOptions(offerSel.input, opts, keep)
    if (!approved.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', 'Belum ada penawaran yang disetujui. Simpan penawaran di tahap 02 terlebih dahulu.')
      const go = C.button({ label: 'Ke penawaran', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('offer'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    showPreview()
    wiz.syncPrimary()
    if (firstFill && params.offerId != null && selectedOffer()?.status === 'approved') wiz.go('who', { focus: false, animate: false })
    firstFill = false
  }

  function showPreview() {
    const o = selectedOffer()
    if (!o) { preview.hidden = true; return }
    preview.replaceChildren(offerPreview(o))
    preview.hidden = false
  }
  offerSel.input.addEventListener('change', () => { msg.hide(); showPreview() })

  function drawContext() {
    const o = selectedOffer()
    ctxBox.replaceChildren(o ? offerPreview(o, { scope: false }) : '')
  }

  function drawConfirm() {
    const o = selectedOffer()
    if (!o) { confirmBox.replaceChildren(); return }
    const r = flow.requestOfOffer(o)
    const date = scheduleDate()
    const taken = flow.assignmentsOf(o.id).length
    confirmBox.replaceChildren(...[
      el('dl', { className: 'sum-grid' },
        el('div', { className: 'is-wide' }, el('dt', {}, 'Pelanggan'), el('dd', {}, `${customerLabel(r)}${r?.location ? ` · ${r.location}` : ''}`)),
        el('div', {}, el('dt', {}, 'Pelaksana'), el('dd', {}, worker.input.value.trim() || '—')),
        el('div', {}, el('dt', {}, 'Nilai'), el('dd', {}, el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price)))),
        el('div', { className: 'is-wide' }, el('dt', {}, 'Jadwal'), el('dd', {}, el('span', { className: 'tnum' }, date ? C.formatDateTime(date) : '—'))),
        o.validated_scope ? el('div', { className: 'is-wide' }, el('dt', {}, 'Lingkup'), el('dd', {}, C.clampText(o.validated_scope, 3))) : null,
      ),
      date && date.getTime() < Date.now()
        ? el('div', { className: 'note note-warn' }, icon('alert'), el('div', { className: 'note-body' }, el('p', {}, 'Jadwal ini sudah lewat. Tetap bisa disimpan.')))
        : null,
      taken
        ? el('div', { className: 'note note-info' }, icon('info'), el('div', { className: 'note-body' }, el('p', {}, `Penawaran ini sudah punya ${taken} penugasan.`)))
        : null,
    ].filter(Boolean))
  }

  async function save() {
    const offer = selectedOffer()
    const name = worker.input.value.trim()
    const date = scheduleDate()
    const restore = wiz.busy('Menyimpan…')
    try {
      const { data, error } = await getCloud().database.from('assignments').insert({
        offer_id: Number(offer.id),
        worker_name: name,
        scheduled_at: date.toISOString(),
        status: 'assigned',
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      restore()
      const past = date.getTime() < Date.now()
      const next = C.button({ label: 'Tandai selesai nanti', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('complete', { assignmentId: row?.id }))
      const again = C.button({ label: 'Tugaskan lainnya', icon: 'plus', size: 'sm', variant: 'soft' })
      again.addEventListener('click', () => {
        worker.input.value = ''
        when.input.value = defaultSchedule()
        offerSel.input.value = ''
        offerSel.input.dispatchEvent(new Event('change'))
        wiz.reset()
      })
      wiz.complete({
        text: `${name} ditugaskan untuk ${customerLabel(flow.requestOfOffer(offer))}, ${C.formatDateTime(date)}.${past ? ' Catatan: jadwal ini sudah lewat.' : ''}`,
        actions: [next, again],
      })
      showToast('Penugasan tersimpan.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    }
  }

  async function loadList() {
    try {
      flow = await loadFlow()
    } catch (err) {
      listBody.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
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
    }), pg.root)
  }

  await loadList()
}

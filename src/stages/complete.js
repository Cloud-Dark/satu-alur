/** 04 — Penyelesaian: close an active assignment with result notes. */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const assignSel = C.select({ label: 'Penugasan aktif', name: 'assignment_id', required: true, options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { hidden: true })
  const ctxBox = el('div', {})
  const notes = C.textarea({ label: 'Catatan hasil pekerjaan', name: 'notes', rows: 4, placeholder: 'Kondisi akhir, kendala, saran perawatan…', hint: 'Ikut tersimpan di riwayat dan membantu laporan.', attrs: { maxlength: '2000' } })

  let flow = null
  const selected = () => flow?.assignment(assignSel.input.value) || null

  const wiz = C.wizard({
    label: 'Konfirmasi selesai',
    steps: [
      {
        key: 'pick',
        title: 'Pilih penugasan',
        description: 'Pekerjaan mana yang sudah dikerjakan?',
        content: [assignSel.wrap, preview],
        validate: () => (selected() ? [] : [{ text: 'Pilih penugasan terlebih dahulu.', input: assignSel.input }]),
        primary: () => ({ disabled: !flow?.activeAssignments().length }),
      },
      {
        key: 'notes',
        title: 'Catat hasil',
        description: 'Tutup penugasan dengan catatan singkat.',
        content: [ctxBox, notes.wrap],
        primary: { label: 'Tandai selesai', icon: 'checkCircle', iconRight: undefined },
        validate: () => (selected() ? [] : ['Pilih penugasan terlebih dahulu.']),
        onPrimary: () => save(),
        onEnter: () => drawContext(),
      },
    ],
  })
  const msg = wiz.msg

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Riwayat penyelesaian', meta: 'memuat…', className: 'list-panel' }, listBody)
  const pg = C.pager({ key: 'completions', label: 'riwayat penyelesaian', onChange: () => drawList(), scrollTarget: listPanel })

  container.replaceChildren(
    C.pageHeader({ num: '04', label: 'Penyelesaian', title: 'Penyelesaian pekerjaan', em: 'pekerjaan', description: 'Tutup penugasan yang sudah dikerjakan. Pekerjaan selesai siap dibukukan di tahap 05.' }),
    el('div', { className: 'stage-grid has-wizard' }, wiz.root, listPanel),
  )

  const assignmentPreview = (a) => {
    const r = flow.requestOfAssignment(a)
    const o = flow.offerOfAssignment(a)
    return C.miniPreview({
      title: customerLabel(r),
      aside: C.rupiah(o?.validated_price),
      chips: [
        { icon: 'users', text: a.worker_name || '—', title: `Pelaksana: ${a.worker_name || '—'}` },
        { icon: 'calendar', text: C.formatDateTime(a.scheduled_at), title: 'Jadwal' },
        r?.location ? { icon: 'mapPin', text: r.location } : null,
      ],
    })
  }

  let firstFill = true
  function fillAssignments() {
    const active = flow.activeAssignments()
    const opts = [{ value: '', label: active.length ? 'Pilih penugasan' : 'Tidak ada penugasan aktif' }]
    active.forEach((a) => {
      const r = flow.requestOfAssignment(a)
      opts.push({ value: a.id, label: `${customerLabel(r)} — ${a.worker_name || 'tanpa nama'} · ${C.formatDate(a.scheduled_at)}` })
    })
    const wanted = firstFill && params.assignmentId != null ? String(params.assignmentId) : ''
    const keep = [assignSel.input.value, wanted].find((v) => v && active.some((a) => String(a.id) === v)) || ''
    C.setOptions(assignSel.input, opts, keep)
    if (!active.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', flow.assignments.length
        ? 'Semua penugasan sudah selesai. Buat penugasan baru di tahap 03.'
        : 'Belum ada penugasan. Tugaskan pekerja di tahap 03 terlebih dahulu.')
      const go = C.button({ label: 'Ke penugasan', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('assign'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    showPreview()
    wiz.syncPrimary()
    if (firstFill && wanted && selected()) wiz.go('notes', { focus: false, animate: false })
    firstFill = false
  }

  function showPreview() {
    const a = selected()
    if (!a) { preview.hidden = true; return }
    preview.replaceChildren(assignmentPreview(a))
    preview.hidden = false
  }
  assignSel.input.addEventListener('change', () => { msg.hide(); showPreview() })

  function drawContext() {
    const a = selected()
    ctxBox.replaceChildren(a ? assignmentPreview(a) : '')
  }

  async function save() {
    const a = selected()
    const restore = wiz.busy('Menyimpan…')
    const db = getCloud().database
    try {
      const { data, error } = await db.from('completions').insert({
        assignment_id: Number(a.id),
        notes: notes.input.value.trim(),
        status: 'done',
        completed_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      const upd = await db.from('assignments').update({ status: 'done' }).eq('id', a.id)
      // The completion is the source of truth (activeAssignments skips assignments
      // that have one), so a failed status update can't cause a second completion.
      if (upd.error) showToast(`Selesai tercatat, tetapi status penugasan belum diperbarui: ${upd.error.message}`, 'warning', 6000)
      const row = Array.isArray(data) ? data[0] : data
      restore()
      const next = C.button({ label: 'Posting jurnal', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('bookkeeping', { completionId: row?.id }))
      const again = C.button({ label: 'Selesaikan lainnya', icon: 'plus', size: 'sm', variant: 'soft' })
      again.addEventListener('click', () => {
        notes.input.value = ''
        assignSel.input.value = ''
        assignSel.input.dispatchEvent(new Event('change'))
        wiz.reset()
        fillAssignments()
      })
      wiz.complete({ text: `Pekerjaan untuk ${customerLabel(flow.requestOfAssignment(a))} ditandai selesai. Siap dibukukan.`, actions: [next, again] })
      showToast('Pekerjaan ditandai selesai.', 'success')
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
    fillAssignments()
    drawList()
  }

  function drawList() {
    const unbooked = flow.completionsWithoutLedger().length
    listPanel.querySelector('.panel-meta').textContent = `${flow.completions.length} baris · ${unbooked} belum dibukukan`
    if (!flow.completions.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada pekerjaan selesai.', body: 'Pekerjaan yang ditandai selesai akan muncul di sini.' }))
      return
    }
    const rows = [...flow.completions].sort((x, y) => (C.toDate(y.completed_at || y.created_at) || 0) - (C.toDate(x.completed_at || x.created_at) || 0))
    listBody.replaceChildren(C.dataTable({
      caption: 'Riwayat penyelesaian',
      rows: pg.slice(rows),
      columns: [
        { label: 'Pelanggan', render: (c) => { const r = flow.requestOfCompletion(c); const a = flow.assignmentOfCompletion(c); return C.cellStack(customerLabel(r), a?.worker_name) } },
        { label: 'Catatan', className: 'col-wide', render: (c) => el('span', { className: 'cell-note', title: c.notes || '' }, c.notes || '—') },
        { label: 'Selesai', className: 'col-date', render: (c) => el('time', { className: 'tnum', datetime: c.completed_at || '', title: C.formatDateTime(c.completed_at) }, C.formatDate(c.completed_at || c.created_at)) },
        {
          label: 'Pembukuan',
          className: 'col-action',
          render: (c) => {
            if (flow.ledgerOf(c.id).length) return C.tag('Terbukukan', 'ok')
            const b = C.button({ label: 'Posting', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
            b.addEventListener('click', () => navigate('bookkeeping', { completionId: c.id }))
            return b
          },
        },
      ],
    }), pg.root)
  }

  await loadList()
}

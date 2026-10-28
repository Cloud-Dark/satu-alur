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
  const preview = el('div', { className: 'req-preview', hidden: true })
  const notes = C.textarea({ label: 'Catatan hasil pekerjaan', name: 'notes', rows: 5, placeholder: 'Kondisi akhir, kendala, saran perawatan…', hint: 'Catatan ini ikut tersimpan di riwayat dan membantu laporan.', attrs: { maxlength: '2000' } })
  const submit = C.button({ label: 'Tandai selesai', icon: 'checkCircle', variant: 'primary', type: 'submit' })
  const msg = C.message()

  const form = el('form', { className: 'form' },
    assignSel.wrap, preview, notes.wrap,
    el('div', { className: 'form-actions' }, submit),
    msg,
  )
  form.noValidate = true

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Riwayat penyelesaian', meta: 'memuat…', className: 'list-panel' }, listBody)

  container.replaceChildren(
    C.pageHeader({ num: '04', label: 'Penyelesaian', title: 'Penyelesaian pekerjaan', em: 'pekerjaan', description: 'Tutup penugasan yang sudah dikerjakan. Pekerjaan selesai siap dibukukan di tahap 05.' }),
    el('div', { className: 'stage-grid' },
      C.panel({ title: 'Konfirmasi selesai', meta: 'Catat hasil', raised: true, className: 'form-panel' }, form),
      listPanel,
    ),
  )

  let flow = null

  function fillAssignments() {
    const active = flow.activeAssignments()
    const opts = [{ value: '', label: active.length ? 'Pilih penugasan' : 'Tidak ada penugasan aktif' }]
    active.forEach((a) => {
      const r = flow.requestOfAssignment(a)
      opts.push({ value: a.id, label: `${customerLabel(r)} — ${a.worker_name || 'tanpa nama'} · ${C.formatDate(a.scheduled_at)}` })
    })
    const wanted = params.assignmentId != null ? String(params.assignmentId) : ''
    const keep = [assignSel.input.value, wanted].find((v) => v && active.some((a) => String(a.id) === v)) || ''
    C.setOptions(assignSel.input, opts, keep)
    submit.disabled = !active.length
    if (!active.length) {
      msg.show('info', flow.assignments.length
        ? 'Semua penugasan sudah selesai. Buat penugasan baru di tahap 03.'
        : 'Belum ada penugasan. Tugaskan pekerja di tahap 03 terlebih dahulu.')
      const go = C.button({ label: 'Ke penugasan', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('assign'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    showPreview()
  }

  function showPreview() {
    const a = flow?.assignment(assignSel.input.value)
    if (!a) { preview.hidden = true; return }
    const r = flow.requestOfAssignment(a)
    const o = flow.offerOfAssignment(a)
    preview.replaceChildren(C.defList([
      ['Pelanggan', `${customerLabel(r)}${r?.location ? ` · ${r.location}` : ''}`],
      ['Pelaksana', a.worker_name || '—'],
      ['Jadwal', C.formatDateTime(a.scheduled_at)],
      ['Nilai', el('span', { className: 'tnum strong' }, C.rupiah(o?.validated_price))],
    ]))
    preview.hidden = false
  }
  assignSel.input.addEventListener('change', () => { msg.hide(); showPreview() })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.hide()
    const a = flow?.assignment(assignSel.input.value)
    if (!a) {
      msg.show('danger', 'Pilih penugasan terlebih dahulu.')
      assignSel.input.focus()
      return
    }
    const restore = C.setBusy(submit, 'Menyimpan…')
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
      if (upd.error) console.warn('Status penugasan tidak diperbarui:', upd.error.message)
      const row = Array.isArray(data) ? data[0] : data
      notes.input.value = ''
      msg.show('ok', `Pekerjaan untuk ${customerLabel(flow.requestOfAssignment(a))} ditandai selesai. Siap dibukukan.`)
      const next = C.button({ label: 'Posting jurnal', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('bookkeeping', { completionId: row?.id }))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, next))
      showToast('Pekerjaan ditandai selesai.', 'success')
      notifyDataChanged()
      await loadList({ keepMessage: true })
    } catch (err) {
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    } finally {
      restore()
      submit.disabled = !flow?.activeAssignments().length
    }
  })

  async function loadList({ keepMessage = false } = {}) {
    try {
      flow = await loadFlow()
    } catch (err) {
      listBody.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
    const prevMsg = keepMessage && !msg.hidden ? Array.from(msg.childNodes) : null
    const prevClass = msg.className
    fillAssignments()
    if (prevMsg) { msg.className = prevClass; msg.replaceChildren(...prevMsg); msg.hidden = false }

    const unbooked = flow.completionsWithoutLedger().length
    listPanel.querySelector('.panel-meta').textContent = `${flow.completions.length} baris · ${unbooked} belum dibukukan`
    if (!flow.completions.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada pekerjaan selesai.', body: 'Pekerjaan yang ditandai selesai akan muncul di sini.' }))
      return
    }
    const rows = [...flow.completions].sort((x, y) => (C.toDate(y.completed_at || y.created_at) || 0) - (C.toDate(x.completed_at || x.created_at) || 0))
    listBody.replaceChildren(C.dataTable({
      caption: 'Riwayat penyelesaian',
      rows,
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
    }))
  }

  await loadList()
}

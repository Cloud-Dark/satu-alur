/**
 * 04 — Penyelesaian: close one job's active assignment with result notes
 * (#/app/penyelesaian?penugasan=<id>). Every job is listed in Alur kerja.
 */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'
import { jobHeader, solo, pickFromWorkflow, workflowLink } from './job.js'

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}
  if (params.assignmentId == null) {
    container.replaceChildren(C.pageHeader({ title: 'Penyelesaian pekerjaan' }),
      pickFromWorkflow(navigate, { filter: 'work', body: 'Buka Alur kerja, lalu tekan "Tandai selesai" pada pekerjaan yang sedang dikerjakan.' }))
    return
  }

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

  const headSlot = el('div', {}, C.skeletonRows(1))
  const doneSlot = el('div', {})
  container.replaceChildren(
    C.pageHeader({ title: 'Penyelesaian pekerjaan' }),
    solo(headSlot, doneSlot, wiz.root, workflowLink(navigate)),
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
    // Only this job's assignment, while it is still open.
    const active = flow.activeAssignments().filter((a) => String(a.id) === String(params.assignmentId))
    const opts = [{ value: '', label: active.length ? 'Pilih penugasan' : 'Tidak ada penugasan aktif' }]
    active.forEach((a) => {
      const r = flow.requestOfAssignment(a)
      opts.push({ value: a.id, label: `${customerLabel(r)} — ${a.worker_name || 'tanpa nama'} · ${C.formatDate(a.scheduled_at)}` })
    })
    const wanted = firstFill && params.assignmentId != null ? String(params.assignmentId) : ''
    const keep = [assignSel.input.value, wanted].find((v) => v && active.some((a) => String(a.id) === v)) || ''
    C.setOptions(assignSel.input, opts, keep)
    if (!active.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', 'Penugasan ini tidak ditemukan atau sudah ditutup.')
      const go = C.button({ label: 'Ke alur kerja', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('workflow'))
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
      const upd = await db.from('assignments').update({ status: 'done', progress: 'selesai', progress_updated_at: new Date().toISOString() }).eq('id', a.id)
      if (!upd.error) await db.from('assignment_progress_log').insert({ assignment_id: Number(a.id), progress: 'selesai', note: notes.input.value.trim().slice(0, 500) || null })
      // The completion is the source of truth (activeAssignments skips assignments
      // that have one), so a failed status update can't cause a second completion.
      if (upd.error) showToast(`Selesai tercatat, tetapi status penugasan belum diperbarui: ${upd.error.message}`, 'warning', 6000)
      const row = Array.isArray(data) ? data[0] : data
      restore()
      const next = C.button({ label: 'Posting jurnal', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('bookkeeping', { completionId: row?.id }))
      const bill = C.button({ label: 'Buat invoice', icon: 'receipt', size: 'sm', variant: 'soft' })
      bill.addEventListener('click', () => navigate('invoice', { completionId: row?.id }))
      const again = C.button({ label: 'Pekerjaan lain', icon: 'activity', size: 'sm', variant: 'ghost' })
      again.addEventListener('click', () => navigate('workflow', { filter: 'work' }))
      wiz.complete({ text: `Pekerjaan untuk ${customerLabel(flow.requestOfAssignment(a))} ditandai selesai. Siap dibukukan dan ditagih.`, actions: [next, bill, again] })
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
      headSlot.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
    drawJob()
    if (!wiz.done) fillAssignments()
  }

  // The job header; an assignment that is already closed shows its result instead of the form.
  function drawJob() {
    const a = flow.assignment(params.assignmentId)
    const r = a ? flow.requestOfAssignment(a) : null
    const c = a ? flow.completionsOf(a.id)[0] : null
    headSlot.replaceChildren(r ? jobHeader(r, { tag: c ? C.tag('Selesai', 'ok') : C.tag('Dikerjakan', 'warn'), note: `${a.worker_name || 'Tanpa petugas'} · ${C.formatDateTime(a.scheduled_at)}` }) : '')
    if (!c || wiz.done) { doneSlot.replaceChildren(); return }
    wiz.root.hidden = true
    const next = C.button({ label: flow.ledgerOf(c.id).length ? 'Lihat pembukuan' : 'Posting jurnal', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
    next.addEventListener('click', () => navigate('bookkeeping', { completionId: c.id }))
    const bill = C.button({ label: 'Invoice', icon: 'receipt', size: 'sm', variant: 'soft' })
    bill.addEventListener('click', () => navigate('invoice', { completionId: c.id }))
    doneSlot.replaceChildren(C.panel({ title: 'Pekerjaan selesai', meta: C.formatDate(c.completed_at || c.created_at), raised: true },
      C.defList([['Catatan hasil', c.notes || '—'], ['Selesai', C.formatDateTime(c.completed_at || c.created_at)]]),
      el('div', { className: 'job-actions' }, next, bill)))
  }

  await loadList()
}

/**
 * 04 — Penyelesaian: close one job's active assignment with result notes
 * (#/app/penyelesaian?penugasan=<id>). Every job is listed in Alur kerja.
 */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'
import { jobHeader, solo, pickFromWorkflow, workflowLink } from './job.js'
import { t } from '../i18n/index.js'

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}
  if (params.assignmentId == null) {
    container.replaceChildren(C.pageHeader({ title: t('complete.title') }),
      pickFromWorkflow(navigate, { filter: 'work', body: t('complete.pickBody') }))
    return
  }

  const assignSel = C.select({ label: t('complete.select.label'), name: 'assignment_id', required: true, options: [{ value: '', label: t('complete.loading') }] })
  const preview = el('div', { hidden: true })
  const ctxBox = el('div', {})
  const notes = C.textarea({ label: t('complete.notes.label'), name: 'notes', rows: 4, placeholder: t('complete.notes.ph'), hint: t('complete.notes.hint'), attrs: { maxlength: '2000' } })

  let flow = null
  const selected = () => flow?.assignment(assignSel.input.value) || null

  const wiz = C.wizard({
    label: t('complete.wiz.label'),
    steps: [
      {
        key: 'pick',
        title: t('complete.wiz.pick'),
        description: t('complete.wiz.pickDesc'),
        content: [assignSel.wrap, preview],
        validate: () => (selected() ? [] : [{ text: t('complete.error.pick'), input: assignSel.input }]),
        primary: () => ({ disabled: !flow?.activeAssignments().length }),
      },
      {
        key: 'notes',
        title: t('complete.wiz.notes'),
        description: t('complete.wiz.notesDesc'),
        content: [ctxBox, notes.wrap],
        primary: { label: t('complete.wiz.markDone'), icon: 'checkCircle', iconRight: undefined },
        validate: () => (selected() ? [] : [t('complete.error.pick')]),
        onPrimary: () => save(),
        onEnter: () => drawContext(),
      },
    ],
  })
  const msg = wiz.msg

  const headSlot = el('div', {}, C.skeletonRows(1))
  const doneSlot = el('div', {})
  container.replaceChildren(
    C.pageHeader({ title: t('complete.title') }),
    solo(headSlot, doneSlot, wiz.root, workflowLink(navigate)),
  )

  const assignmentPreview = (a) => {
    const r = flow.requestOfAssignment(a)
    const o = flow.offerOfAssignment(a)
    return C.miniPreview({
      title: customerLabel(r),
      aside: C.rupiah(o?.validated_price),
      chips: [
        { icon: 'users', text: a.worker_name || '—', title: t('complete.preview.worker', { name: a.worker_name || '—' }) },
        { icon: 'calendar', text: C.formatDateTime(a.scheduled_at), title: t('complete.preview.schedule') },
        r?.location ? { icon: 'mapPin', text: r.location } : null,
      ],
    })
  }

  let firstFill = true
  function fillAssignments() {
    // Only this job's assignment, while it is still open.
    const active = flow.activeAssignments().filter((a) => String(a.id) === String(params.assignmentId))
    const opts = [{ value: '', label: active.length ? t('complete.select.pick') : t('complete.select.none') }]
    active.forEach((a) => {
      const r = flow.requestOfAssignment(a)
      opts.push({ value: a.id, label: `${customerLabel(r)} — ${a.worker_name || t('complete.noName')} · ${C.formatDate(a.scheduled_at)}` })
    })
    const wanted = firstFill && params.assignmentId != null ? String(params.assignmentId) : ''
    const keep = [assignSel.input.value, wanted].find((v) => v && active.some((a) => String(a.id) === v)) || ''
    C.setOptions(assignSel.input, opts, keep)
    if (!active.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', t('complete.notFound'))
      const go = C.button({ label: t('complete.toWorkflow'), iconRight: 'arrowRight', size: 'sm' })
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
    const restore = wiz.busy(t('complete.saving'))
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
      if (upd.error) showToast(t('complete.partial', { error: upd.error.message }), 'warning', 6000)
      const row = Array.isArray(data) ? data[0] : data
      restore()
      const next = C.button({ label: t('complete.done.post'), iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('bookkeeping', { completionId: row?.id }))
      const bill = C.button({ label: t('complete.done.invoice'), icon: 'receipt', size: 'sm', variant: 'soft' })
      bill.addEventListener('click', () => navigate('invoice', { completionId: row?.id }))
      const again = C.button({ label: t('complete.done.other'), icon: 'activity', size: 'sm', variant: 'ghost' })
      again.addEventListener('click', () => navigate('workflow', { filter: 'work' }))
      wiz.complete({ text: t('complete.done.text', { name: customerLabel(flow.requestOfAssignment(a)) }), actions: [next, bill, again] })
      showToast(t('complete.done.toast'), 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      msg.show('danger', t('complete.saveError', { error: err.message }))
    }
  }

  async function loadList() {
    try {
      flow = await loadFlow()
    } catch (err) {
      headSlot.replaceChildren(C.errorState(t('complete.loadError', { error: err.message })))
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
    headSlot.replaceChildren(r ? jobHeader(r, { tag: c ? C.tag(t('complete.tag.done'), 'ok') : C.tag(t('complete.tag.working'), 'warn'), note: `${a.worker_name || t('complete.noWorker')} · ${C.formatDateTime(a.scheduled_at)}` }) : '')
    if (!c || wiz.done) { doneSlot.replaceChildren(); return }
    wiz.root.hidden = true
    const next = C.button({ label: flow.ledgerOf(c.id).length ? t('complete.done.viewBooks') : t('complete.done.post'), iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
    next.addEventListener('click', () => navigate('bookkeeping', { completionId: c.id }))
    const bill = C.button({ label: t('complete.done.invoiceShort'), icon: 'receipt', size: 'sm', variant: 'soft' })
    bill.addEventListener('click', () => navigate('invoice', { completionId: c.id }))
    doneSlot.replaceChildren(C.panel({ title: t('complete.panel.title'), meta: C.formatDate(c.completed_at || c.created_at), raised: true },
      C.defList([[t('complete.panel.notes'), c.notes || '—'], [t('complete.panel.doneAt'), C.formatDateTime(c.completed_at || c.created_at)]]),
      el('div', { className: 'job-actions' }, next, bill)))
  }

  await loadList()
}

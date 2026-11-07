/**
 * 03 — Penugasan: assign an approved offer to a worker with AI matching, map, and team management.
 * The Tugaskan tab shows one job (#/app/penugasan?penawaran=<offer id>): its form while it has no
 * team yet, then its team, schedule and progress. Every job is listed in Alur kerja.
 */
import { loadWorkers, loadLinks, saveWorker, removeWorker, createTeamAssignment, loadSkills, addSkill, renameSkill, deleteSkill, saveWorkerLocation } from './workers-repo.js'
import { geocode } from '../geo.js'
import { loadLeaflet, addBaseLayer, disposeMap } from '../ui/leaflet.js'
import { SKILL_LABELS, workerState, completedCount, hasHistory, inferSkill, scoreWorkers, pickRecommended, joinWorkerNames } from '../domain/workers.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'
import { labelMap, sortSkills, nameProblem, workersUsing, NAME_MAX } from '../domain/skills.js'
import { PROGRESS, progressOf, progressChip, progressCounts, planProgress, progressLabel, NOTE_MAX } from '../domain/progress.js'
import { saveProgress, loadProgressLog } from './progress-repo.js'
import { jobHeader, solo, pickFromWorkflow, workflowLink } from './job.js'
import { t, has, locale } from '../i18n/index.js'

// Progress labels live in domain/progress.js (shared with the worker); translate by value.
const progressText = (v) => t(`assign.progress.${v}`)
/** Translates a progress chip label ("Lewat jadwal" or a progress value's label). */
const chipText = (chip) => (chip.label === 'Lewat jadwal' ? t('assign.progress.overdue') : progressText(chip.value))
/** Score reasons come from domain/workers.js in Indonesian; they are shown as-is when no translation matches. */
const reasonText = (r) => (has(`assign.reason.${r}`) ? t(`assign.reason.${r}`) : r)

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
  { value: 'assign' },
  { value: 'team' },
  { value: 'map' },
  { value: 'performance' },
]
let currentTab = 'assign'
// key → display name of this business's skills (built-in names until loaded).
let labels = { ...SKILL_LABELS }

/* ================================================================ Main Render */
export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const status = C.message()
  const host = el('div', { className: 'assign-tab' })
  const tabs = C.segmented({ options: TABS.map((x) => ({ ...x, label: t(`assign.tabs.${x.value}`) })), value: currentTab, label: t('assign.tabs.aria'), onChange: (value) => {
    currentTab = value
    status.hide()
    draw()
  } })
  tabs.classList.add('workspace-tabs')

  container.replaceChildren(
    C.pageHeader({ title: t('assign.title') }),
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
      status.show('danger', t('assign.loadError', { error: err.message }))
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
    tabs.after(status) // the Tugaskan tab moves it into the job's column
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
  if (params.offerId == null) {
    target.appendChild(pickFromWorkflow(navigate, { filter: 'assign', body: t('assign.pickBody') }))
    return
  }
  const theOffer = flow.offer(params.offerId)
  if (!theOffer) {
    target.appendChild(pickFromWorkflow(navigate, { filter: 'assign', title: t('assign.offerNotFound'), body: t('assign.offerNotFoundBody') }))
    return
  }
  const theRequest = flow.requestOfOffer(theOffer)
  const teamOf = () => flow.assignmentsOf(theOffer.id)
  const hasTeam = teamOf().length > 0

  const offerSel = C.select({ label: t('assign.form.offer'), name: 'offer_id', required: true, hint: t('assign.form.offerHint'), options: [{ value: '', label: t('assign.loading') }] })
  const preview = el('div', { className: 'req-preview', hidden: true })
  const when = C.field({ label: t('assign.form.schedule'), name: 'scheduled_at', type: 'datetime-local', required: true, value: defaultSchedule(), hint: t('assign.form.scheduleHint') })
  const submit = C.button({ label: t('assign.form.submit'), icon: 'users', variant: 'primary', type: 'submit' })
  const msg = C.message()

  const pickList = el('div', { className: 'worker-pick' })
  const count = C.field({ label: t('assign.form.count'), name: 'recommend_n', type: 'number', value: '1', attrs: { min: '1' } })
  const applyRecommend = () => {
    const n = Math.max(1, parseInt(count.input.value, 10) || 1)
    checked.clear()
    pickRecommended(scored, n).forEach((w) => checked.add(w.id))
    drawPick()
  }
  const recommend = C.button({ label: t('assign.form.recommend'), icon: 'check', variant: 'soft', onClick: applyRecommend })
  count.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyRecommend() }
  })
  const summary = el('div', { className: 'muted small' })
  const picker = el('div', { className: 'field' },
    el('span', { className: 'field-label' }, t('assign.form.workers')),
    workers.some((w) => w.status === 'active')
      ? el('div', { className: 'form' }, el('div', { className: 'pick-recommend' }, count.wrap, recommend), pickList)
      : C.emptyState({ title: t('assign.noActive'), iconName: 'users', body: t('assign.noActiveBody'), action: C.button({ label: t('assign.toTeam'), icon: 'users', onClick: goTeam }) }),
  )

  const form = el('form', { className: 'form' },
    offerSel.wrap, preview,
    when.wrap,
    picker, summary,
    el('div', { className: 'form-actions' }, submit),
    msg,
  )
  form.noValidate = true

  const listBody = el('div', {})
  const listPanel = C.panel({ title: t('assign.teamPanel'), meta: t('assign.assignmentsCount', { count: teamOf().length }), className: 'list-panel' }, listBody)
  const head = jobHeader(theRequest, { tag: hasTeam ? null : C.tag(t('assign.notAssigned'), 'warn'), note: t('assign.offerNote', { id: theOffer.id, price: C.rupiah(theOffer.validated_price) }) })
  const notApproved = theOffer.status !== 'approved'
  const pending = el('div', {})
  if (notApproved) {
    const go = C.button({ label: t('assign.openOffer'), iconRight: 'arrowRight', size: 'sm' })
    go.addEventListener('click', () => navigate('offer', { offerId: theOffer.id }))
    pending.append(el('div', { className: 'note note-info' }, C.icon('info'),
      el('div', { className: 'note-body' }, el('p', {}, t('assign.notApproved')), el('div', { className: 'note-actions' }, go))))
  }
  // The page-level note (e.g. "… ditugaskan") sits in the job's column, under its header.
  target.appendChild(solo(
    head,
    status,
    pending,
    hasTeam || notApproved ? null : C.panel({ title: t('assign.form.title'), meta: t('assign.form.meta'), raised: true, className: 'form-panel' }, form),
    hasTeam ? listPanel : null,
    workflowLink(navigate),
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
    if (!job) { pickList.replaceChildren(el('p', { className: 'muted small', style: 'padding:12px;margin:0;' }, t('assign.pickOfferFirst'))); drawSummary(); return }
    if (!scored.length) { pickList.replaceChildren(el('p', { className: 'muted small', style: 'padding:12px;margin:0;' }, t('assign.error.schedule'))); drawSummary(); return }
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
            s.clash ? C.tag(t('assign.clash'), 'warn') : null,
            s.distanceKm !== null ? el('span', { className: 'muted small' }, `${s.distanceKm.toFixed(1).replace('.', ',')} km`) : null,
          ),
          el('span', { className: 'muted small' }, s.reasons.map(reasonText).join(' · ')),
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
    if (sel.some((s) => s.clash)) warns.push(t('assign.warn.clash'))
    if (job?.skill && !sel.some((s) => s.skillMatch === 'full')) warns.push(t('assign.warn.skill'))
    summary.replaceChildren(
      el('div', {}, el('strong', {}, t('assign.summary.team')), joinWorkerNames(sel.map((s) => s.worker))),
      el('div', {}, el('strong', {}, t('assign.summary.skills')), skills.map((k) => labels[k] || k).join(', ') || '—'),
      ...warns.map((t) => C.tag(t, 'warn')),
    )
  }

  function fillOffers() {
    if (!flow) return
    const approved = flow.offers.filter((o) => o.status === 'approved' && String(o.id) === String(theOffer.id))
    // Only this job's offer, while it still waits for a team.
    const free = assignableOffers(flow).filter((o) => String(o.id) === String(theOffer.id))
    const label = (o) => { const r = flow.requestOfOffer(o); return `${customerLabel(r)} — ${C.rupiah(o.validated_price)}` }
    const opts = [{ value: '', label: free.length ? t('assign.form.chooseOffer') : approved.length ? t('assign.form.allAssigned') : t('assign.form.noApproved') }]
    free.forEach((o) => opts.push({ value: o.id, label: label(o) }))
    const wanted = offerSel.input.value || (params.offerId != null ? String(params.offerId) : '')
    const keep = free.some((o) => String(o.id) === wanted) ? wanted : ''
    C.setOptions(offerSel.input, opts, keep)
    submit.disabled = !free.length
    if (approved.length && !free.length) {
      msg.show('info', t('assign.alreadyAssigned'))
    } else if (!approved.length) {
      msg.show('info', t('assign.noApprovedNote'))
      const go = C.button({ label: t('assign.toOffers'), iconRight: 'arrowRight', size: 'sm' })
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
      [t('assign.preview.customer'), `${customerLabel(r)}${r?.location ? ` · ${r.location}` : ''}`],
      [t('assign.preview.scope'), o.validated_scope || '—'],
      [t('assign.preview.value'), el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price))],
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
    if (!offer) errors.push(t('assign.error.offer'))
    if (!team.length) errors.push(t('assign.error.team'))
    if (!date) errors.push(t('assign.error.schedule'))
    if (errors.length) {
      msg.show('danger', t('assign.error.check'), errors)
      return
    }
    saving = true
    const restore = C.setBusy(submit, t('assign.saving'))
    try {
      const row = await createTeamAssignment({ offerId: Number(offer.id), scheduledAt: date.toISOString(), workers: team })
      const text = t('assign.saved.text', { team: joinWorkerNames(team), name: customerLabel(flow.requestOfOffer(offer)), date: C.formatDateTime(date) })
      showToast(t('assign.saved.toast'), 'success')
      // reload redraws this page, so the success note goes on the page-level status
      await reload()
      // "Tandai selesai" sits under the team table below; no second button in the note.
      status.show('ok', `${text} ${t('assign.saved.hint')}`)
      void row
    } catch (err) {
      msg.show('danger', t('assign.saveError', { error: err.message }))
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
    const rows = teamOf()
    if (!rows.length) return
    const now = Date.now()
    const active = rows.find((a) => !flow.completionsOf(a.id).length)
    const next = active ? C.button({ label: t('assign.markDone'), icon: 'checkCircle', size: 'sm', variant: 'primary' }) : null
    next?.addEventListener('click', () => navigate('complete', { assignmentId: active.id }))
    listBody.replaceChildren(C.dataTable({
      caption: t('assign.table.caption'),
      rows,
      columns: [
        {
          label: t('assign.table.workerSchedule'),
          render: (a) => {
            return el('div', { className: 'cell-stack' },
              el('span', { className: 'cell-primary' }, a.worker_name || '—'),
              el('time', { className: 'cell-secondary tnum', datetime: a.scheduled_at || '' }, C.formatDateTime(a.scheduled_at)),
            )
          },
        },
        {
          label: t('assign.table.progress'),
          render: (a) => {
            const chip = progressChip(a, { hasCompletion: flow.completionsOf(a.id).length > 0, now })
            const tagEl = C.tag(chipText(chip), chip.tone)
            if (chip.value === 'selesai') return tagEl
            const b = el('button', { type: 'button', className: 'progress-chip', title: t('assign.progressDlg.change'), 'aria-label': t('assign.progressDlg.chipAria', { label: chipText(chip) }) }, tagEl, C.icon('chevronDown', { size: 14 }))
            b.addEventListener('click', () => openProgress(a, b))
            return el('div', { className: 'cell-stack' }, b, a.progress_note ? el('span', { className: 'cell-secondary small', title: a.progress_note }, a.progress_note) : '')
          },
        },
        {
          label: t('assign.table.action'),
          className: 'col-action',
          render: (a) => {
            if (progressOf(a, flow.completionsOf(a.id).length > 0) === 'selesai') return el('span', { className: 'muted nil' }, '—')
            const b = C.button({ label: t('assign.progressDlg.change'), icon: 'refresh', size: 'sm', variant: 'soft' })
            b.addEventListener('click', () => openProgress(a, b))
            return b
          },
        },
      ],
    }), next ? el('div', { className: 'job-actions panel-foot-actions' }, next) : '')
  }

  /** Progress editor: choose a status, add a note, see the history. "Selesai" opens Penyelesaian. */
  async function openProgress(a, opener) {
    const from = progressOf(a, flow.completionsOf(a.id).length > 0)
    const id = `pg-${a.id}-${Date.now()}`
    let choice = from
    const opts = el('div', { className: 'progress-opts', role: 'radiogroup', 'aria-label': t('assign.progressDlg.aria') },
      ...PROGRESS.map((p) => {
        const input = el('input', { type: 'radio', name: id, value: p.value, id: `${id}-${p.value}` })
        input.checked = p.value === from
        input.addEventListener('change', () => { choice = p.value; hint.hidden = choice !== 'selesai' })
        return el('label', { className: 'progress-opt', htmlFor: `${id}-${p.value}` }, input, C.tag(progressText(p.value), p.tone))
      }))
    const hint = el('p', { className: 'muted small', hidden: true }, t('assign.progressDlg.doneHint'))
    const note = C.textarea({ label: t('assign.progressDlg.note'), id: `${id}-note`, rows: 2, value: a.progress_note || '', placeholder: t('assign.progressDlg.notePh'), attrs: { maxlength: String(NOTE_MAX) } })
    const history = el('div', { className: 'progress-history' }, el('p', { className: 'muted small' }, t('assign.progressDlg.loadingHistory')))
    const err = el('p', { className: 'field-error', role: 'alert' })
    const save = C.button({ label: t('assign.progressDlg.save'), icon: 'check', variant: 'primary', type: 'submit' })
    const r = flow.requestOfAssignment(a)
    const { form, close } = C.modal({
      title: t('assign.progressDlg.change'), description: `${customerLabel(r)} · ${a.worker_name || t('assign.noWorker')} · ${C.formatDateTime(a.scheduled_at)}`,
      opener, children: [opts, hint, note.wrap, el('div', { className: 'field' }, el('span', { className: 'field-label' }, t('assign.progressDlg.history')), history), err],
      actions: [C.button({ label: t('assign.cancel'), variant: 'ghost', dismiss: true }), save],
    })
    loadProgressLog(a.id).then((log) => {
      history.replaceChildren(log.length
        ? el('ol', { className: 'progress-log' }, ...log.map((x) => el('li', {}, C.tag(progressText(x.progress), PROGRESS.find((p) => p.value === x.progress)?.tone),
          el('time', { className: 'muted small tnum', datetime: x.created_at }, C.formatDateTime(x.created_at)), x.note ? el('span', { className: 'small' }, x.note) : '')))
        : el('p', { className: 'muted small' }, t('assign.progressDlg.noHistory')))
    }).catch(() => history.replaceChildren(el('p', { className: 'muted small' }, t('assign.progressDlg.historyError'))))
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      err.textContent = ''
      const noteText = note.input.value.trim()
      const plan = planProgress(from, choice)
      if (!plan.ok && !(choice === from && noteText !== (a.progress_note || ''))) { err.textContent = t(`assign.plan.${from === 'selesai' ? 'finished' : from === choice ? 'unchanged' : 'unknown'}`); return }
      if (plan.complete) { close(); navigate('complete', { assignmentId: a.id }); return }
      const restore = C.setBusy(save, t('assign.saving'))
      try {
        await saveProgress(a, choice, noteText)
        showToast(t('assign.progressDlg.toast', { label: progressText(choice) }), 'success')
        close()
        await reload()
      } catch (ex) { restore(); err.textContent = ex.message }
    })
  }

  fillOffers()
  loadList()
}

/** Approved offers that are not assigned yet (cancelled / rejected offers are not approved). */
export function assignableOffers(flow) {
  return flow.offers.filter((o) => o.status === 'approved' && !flow.assignmentsOf(o.id).length)
}

/* ================================================================ Tab: Team */
const PHONE_RE = /^[+()\d\s.-]{6,32}$/
const STATE_TONE = { available: 'ok', on_job: 'warn', inactive: 'neutral' }
const stateText = (s) => t(`assign.state.${s}`)

function renderTeam(target, { workers, skills, assignments, completions, links, reload, status }) {
  const dialog = el('dialog', { className: 'panel', 'aria-labelledby': 'worker-dialog-title' })
  dialog.addEventListener('close', () => dialog.replaceChildren())

  function openWorkerForm(worker = null) {
    const isEdit = !!worker
    const name = C.field({ label: t('assign.worker.name'), name: 'name', required: true, value: worker?.name || '' })
    const phone = C.field({ label: t('assign.worker.phone'), name: 'phone', type: 'tel', value: worker?.phone || '' })
    const address = C.field({ label: t('assign.worker.address'), name: 'address', value: worker?.address || '', hint: t('assign.worker.addressHint') })
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
    const newSkill = el('input', { className: 'input', type: 'text', placeholder: t('assign.skills.newPh'), maxLength: NAME_MAX, 'aria-label': t('assign.skills.newAria') })
    const addBtn = C.button({ label: t('assign.add'), icon: 'plus', size: 'sm', variant: 'soft' })
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
      el('span', { className: 'field-label', id: chipsLabelId }, t('assign.skills.title')),
      chips,
      el('div', { className: 'chip-add' }, newSkill, addBtn),
      el('span', { className: 'field-hint' }, t('assign.skills.hint')))
    const statusSel = isEdit ? C.select({ label: t('assign.worker.status'), name: 'status', options: [{ value: 'active', label: t('assign.worker.active') }, { value: 'inactive', label: t('assign.state.inactive') }], value: worker.status }) : null
    const msg = C.message()
    const submit = C.button({ label: isEdit ? t('assign.worker.saveChanges') : t('assign.worker.add'), icon: 'check', variant: 'primary', type: 'submit' })
    const cancel = C.button({ label: t('assign.cancel'), variant: 'ghost', onClick: () => dialog.close() })
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
      if (!fields.name) { msg.show('danger', t('assign.worker.nameRequired')); return }
      if (fields.phone && !PHONE_RE.test(fields.phone)) { msg.show('danger', t('assign.worker.phoneInvalid')); return }
      fields.status = isEdit ? statusSel.input.value : 'active'
      if (isEdit) fields.id = worker.id
      const restore = C.setBusy(submit, t('assign.saving'))
      try {
        await saveWorker(fields, worker || undefined)
        dialog.close()
        showToast(isEdit ? t('assign.worker.updated', { name: fields.name }) : t('assign.worker.added', { name: fields.name }), 'success')
        await reload()
      } catch (err) {
        msg.show('danger', err.message)
        restore()
      }
    })
    dialog.replaceChildren(el('h2', { className: 'panel-title', id: 'worker-dialog-title' }, isEdit ? t('assign.worker.edit') : t('assign.worker.add')), form)
    dialog.showModal()
  }

  async function act(label, run, done) {
    try { await run(); showToast(done, 'success'); await reload() }
    catch (err) { status.show('danger', `${label}: ${err.message}`) }
  }

  function removeAction(w) {
    const history = hasHistory(w.id, links)
    const verb = history ? t('assign.worker.deactivate') : t('assign.worker.delete')
    return C.button({ label: verb, icon: history ? 'x' : 'trash', variant: 'ghost', size: 'sm', onClick: () => {
      if (!window.confirm(t('assign.worker.confirm', { verb, name: w.name }))) return
      act(t('assign.worker.failed', { verb }), () => removeWorker(w, links), history ? t('assign.worker.deactivated', { name: w.name }) : t('assign.worker.deleted', { name: w.name }))
    } })
  }

  function card(w) {
    const state = workerState(w, assignments, links)
    const stateLabel = stateText(state)
    const tone = STATE_TONE[state]
    const inactive = state === 'inactive'
    return el('article', { className: 'workspace-entry' },
      el('div', { className: 'workspace-entry-head' }, el('strong', {}, w.name), C.tag(stateLabel, tone)),
      el('p', { className: 'muted small' }, [w.phone, w.zone].filter(Boolean).join(' · ') || t('assign.worker.noContact')),
      el('div', {}, ...(w.skills || []).map((s) => C.tag(labels[s] || s))),
      el('p', { className: 'muted small' }, t('assign.worker.jobsDone', { count: completedCount(w.id, links, completions) })),
      el('div', { className: 'form-actions' },
        C.button({ label: t('assign.worker.editShort'), icon: 'edit', variant: 'soft', size: 'sm', onClick: () => openWorkerForm(w) }),
        inactive
          ? C.button({ label: t('assign.worker.activate'), icon: 'check', variant: 'soft', size: 'sm', onClick: () => act(t('assign.worker.activateFailed'), () => saveWorker({ id: w.id, name: w.name, phone: w.phone, address: w.address, skills: w.skills, status: 'active' }, w), t('assign.worker.activated', { name: w.name })) })
          : null,
        // An inactive worker with history can only be reactivated; offering "Nonaktifkan" again made no sense.
        inactive && hasHistory(w.id, links) ? null : removeAction(w),
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
      const meta = el('span', { className: 'muted small' }, used ? t('assign.skills.used', { count: used }) : t('assign.skills.unused'))
      const row = el('div', { className: 'skill-row' }, el('div', { className: 'skill-text' }, name, meta))
      const edit = C.button({ label: t('assign.skills.rename'), icon: 'edit', size: 'sm', variant: 'ghost', onClick: () => {
        const input = el('input', { className: 'input', type: 'text', value: sk.name, maxLength: NAME_MAX, 'aria-label': t('assign.skills.renameAria', { name: sk.name }) })
        const save = C.button({ label: t('assign.save'), icon: 'check', size: 'sm', variant: 'soft' })
        const cancel = C.button({ label: t('assign.cancel'), size: 'sm', variant: 'ghost', onClick: draw })
        const commit = () => act(t('assign.skills.renameFailed'), () => renameSkill(sk, input.value, list), t('assign.skills.renamed', { name: input.value.trim() }))
        save.addEventListener('click', commit)
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.stopPropagation(); draw() } })
        row.replaceChildren(input, el('div', { className: 'skill-actions' }, save, cancel))
        input.focus()
        input.select()
      } })
      const del = C.button({ label: t('assign.worker.delete'), icon: 'trash', size: 'sm', variant: 'ghost', onClick: () => {
        const q = used ? t('assign.skills.confirmUsed', { name: sk.name, count: used }) : t('assign.skills.confirm', { name: sk.name })
        if (!window.confirm(q)) return
        act(t('assign.skills.deleteFailed'), () => deleteSkill(sk, workers), t('assign.skills.deleted', { name: sk.name }))
      } })
      row.append(el('div', { className: 'skill-actions' }, edit, del))
      return row
    }))
    draw()
    const input = el('input', { className: 'input', type: 'text', placeholder: t('assign.skills.newAria'), maxLength: NAME_MAX, 'aria-label': t('assign.skills.newAria') })
    const add = C.button({ label: t('assign.add'), icon: 'plus', size: 'sm', variant: 'primary' })
    const submit = () => act(t('assign.skills.addFailed'), () => addSkill(input.value, list), t('assign.skills.added', { name: input.value.trim() }))
    add.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } })
    return C.panel({ title: t('assign.skills.title'), meta: t('assign.skills.count', { count: list.length }), className: 'skills-panel' },
      el('div', { className: 'chip-add' }, input, add), rows)
  }

  const byName = [...workers].sort((a, b) => a.name.localeCompare(b.name))
  const active = byName.filter((w) => w.status === 'active')
  const inactive = byName.filter((w) => w.status !== 'active')

  target.append(
    dialog,
    el('div', { className: 'form-actions' }, C.button({ label: t('assign.worker.add'), icon: 'plus', variant: 'primary', onClick: () => openWorkerForm() })),
    C.panel({ title: t('assign.team.title'), meta: t('assign.team.active', { count: active.length }) },
      active.length ? active.map(card) : C.emptyState({ title: t('assign.noActive'), iconName: 'users', body: t('assign.team.emptyBody') })),
    inactive.length ? C.panel({ title: t('assign.state.inactive'), meta: t('assign.team.workers', { count: inactive.length }) }, inactive.map(card)) : '',
    skillsPanel(),
  )
}

/* ================================================================ Tab: Map */
const STATE_COLORS = { available: '--success', on_job: '--warning', inactive: '--text-muted' }
const located = (o) => Number.isFinite(Number(o?.lat)) && Number.isFinite(Number(o?.lng ?? o?.lon)) && o.lat !== null
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
const MAX_GEOCODE_PER_VISIT = 8

/** Leaflet map of petugas (OpenStreetMap). Returns a cleanup function. */
function renderMap(target, { workers, assignments, links, flow }) {
  let map = null
  let disposed = false
  const mapEl = el('div', { className: 'worker-lmap', role: 'region', 'aria-label': t('assign.map.aria') })
  const note = el('p', { className: 'muted small worker-map-note' })
  const legend = el('div', { className: 'worker-map-legend' },
    ['available', 'on_job', 'inactive'].map((k) => el('span', { className: 'muted small' }, el('i', { className: `worker-pin-dot is-${k}` }), stateText(k))),
    el('span', { className: 'muted small' }, el('i', { className: 'worker-pin-dot is-job' }), t('assign.map.jobToday')))

  if (!workers.length) {
    target.appendChild(C.emptyState({ title: t('assign.map.noWorkers'), iconName: 'users', body: t('assign.map.noWorkersBody') }))
    return () => {}
  }
  const withAddress = workers.filter((w) => String(w.address || '').trim().length >= 3)
  if (!workers.some(located) && !withAddress.length) {
    target.appendChild(C.emptyState({ title: t('assign.map.noLocations'), iconName: 'mapPin', body: t('assign.map.noLocationsBody') }))
    return () => {}
  }
  const panel = C.panel({ title: t('assign.map.title'), meta: t('assign.map.loading') }, mapEl, legend, note)
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
      mapEl.replaceWith(C.errorState(t('assign.map.error')))
      meta.textContent = t('assign.map.unavailable')
      legend.remove()
      return
    }
    if (disposed) return
    const pins = workers.filter(located)
    const noLoc = workers.filter((w) => !located(w))
    meta.textContent = t('assign.map.meta', { n: pins.length, total: workers.length })
    note.textContent = noLoc.length
      ? t('assign.map.missing', { names: noLoc.map((w) => w.name).join(', '), hint: noLoc.some((w) => !w.address) ? t('assign.map.fillAddress') : t('assign.map.refineAddress') })
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
        el('div', {}, C.tag(stateText(state), state === 'available' ? 'ok' : state === 'on_job' ? 'warn' : 'neutral')),
        (() => {
          const ids = new Set(links.filter((l) => l.worker_id === w.id).map((l) => l.assignment_id))
          const open = assignments.filter((a) => ids.has(a.id) && progressOf(a, flow.completionsOf(a.id).length > 0) !== 'selesai')
          if (!open.length) return ''
          const counts = progressCounts(open)
          const parts = ['dikerjakan', 'ditunda', 'belum'].filter((k) => counts[k]).map((k) => `${counts[k]} ${progressText(k).toLowerCase()}`)
          return el('div', { className: 'muted small' }, t('assign.map.openTasks', { list: parts.join(', ') }))
        })(),
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
        el('div', { className: 'muted small' }, `${a.worker_name || t('assign.noWorker')} · ${C.formatDateTime(a.scheduled_at)}`),
        (() => { const c = progressChip(a, { hasCompletion: flow.completionsOf(a.id).length > 0 }); return el('div', {}, C.tag(chipText(c), c.tone)) })())
      L.marker(ll, { icon: icon(cssVar('--accent', '#e7a13a'), surface), title: customerLabel(r), keyboard: true }).addTo(map).bindPopup(pop)
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14, animate: false })
    else map.setView([-2.5, 118], 4)
  })()

  return () => { disposed = true; disposeMap(map); map = null }
}

/* ================================================================ Tab: Performance */
function renderPerformance(target, { workers, assignments, completions, links }) {
  const completedIds = new Set((completions || []).map((c) => String(c.assignment_id)))
  const pc = progressCounts(assignments, completedIds)
  const activeList = workers.filter((w) => w.status === 'active')
  const done = new Map(workers.map((w) => [w.id, completedCount(w.id, links, completions)]))
  const total = [...done.values()].reduce((a, n) => a + n, 0)
  const onJob = activeList.filter((w) => workerState(w, assignments, links) === 'on_job').length
  const ranked = [...workers].sort((a, b) => done.get(b.id) - done.get(a.id) || a.name.localeCompare(b.name, locale()))

  target.appendChild(el('div', { className: 'kpis kpis-3' },
    C.kpi({ label: t('assign.perf.active'), value: String(activeList.length), iconName: 'users' }),
    C.kpi({ label: t('assign.perf.jobsDone'), value: String(total), iconName: 'check' }),
    C.kpi({ label: t('assign.perf.onJobToday'), value: String(onJob), iconName: 'clock' }),
  ))
  target.appendChild(C.panel({ title: t('assign.perf.progress'), meta: t('assign.assignmentsCount', { count: assignments.length }) },
    el('div', { className: 'progress-summary' }, ...PROGRESS.map((p) => el('div', { className: 'progress-stat' },
      C.tag(progressText(p.value), p.tone), el('strong', { className: 'tnum' }, String(pc[p.value])))))))
  target.appendChild(C.panel({ title: t('assign.perf.ranking'), meta: t('assign.perf.rankingMeta') },
    ranked.length
      ? C.dataTable({
        caption: t('assign.perf.caption'),
        columns: [
          { label: '#', render: (w) => String(ranked.indexOf(w) + 1) },
          { label: t('assign.form.workers'), key: 'name' },
          { label: t('assign.worker.status'), render: (w) => { const s = workerState(w, assignments, links); return C.tag(stateText(s), s === 'available' ? 'ok' : s === 'on_job' ? 'warn' : 'neutral') } },
          { label: t('assign.perf.jobsDone'), align: 'right', render: (w) => String(done.get(w.id)) },
        ],
        rows: ranked,
      })
      : C.emptyState({ title: t('assign.map.noWorkers'), body: t('assign.perf.emptyBody') })))
}

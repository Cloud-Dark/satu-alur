/**
 * 02 — Penawaran: AI drafts an offer, domain rules validate, human saves.
 *   #/app/penawaran/baru?permintaan=<id>   the wizard for that request (no other jobs on the page)
 *   #/app/penawaran/<id>                   one offer: summary and its actions
 */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { openWaDialog } from '../ui/wa-dialog.js'
import { offerMessage } from '../wa/rules.js'
import { generateOffer } from '../ai/agent.js'
import { readPartialJson } from '../offer/partial-json.js'
import { createPipeline } from '../offer/pipeline.js'
import { listTemplates } from '../offer/api.js'
import { validateAnswers, templateContext } from '../offer/templates.js'
import { suggestSchedule, priceHistory, reviewDraft } from '../offer/review.js'
import { openOfferDocument, offerNumber } from '../offer/document.js'
import { offerEmailDraft } from '../email/templates.js'
import '../styles/offer-flow.css'
import { validateOffer, OfferRules } from '../domain/rules.js'
import { loadModels } from '../ai/models.js'
import { getAgentParams } from './settings.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'
import { offerEmailButton, openOfferEmail } from '../email/offer-dialog.js'
import { jobHeader, solo, pickFromWorkflow, workflowLink } from './job.js'
import { t } from '../i18n/index.js'

const { el, icon } = C

/** Picks the preferred model from settings, falling back to the first one. */
export async function resolveModel() {
  const models = await loadModels()
  const pref = getAgentParams().modelPreference
  return models.find((m) => m.id === pref) || models[0] || null
}

/** Rejects with an AbortError as soon as `signal` aborts. */
export function abortable(promise, signal) {
  if (!signal) return promise
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const fire = () => reject(new DOMException('Dibatalkan', 'AbortError'))
      if (signal.aborted) fire()
      else signal.addEventListener('abort', fire, { once: true })
    }),
  ])
}

const offerTag = (o) => (o.status === 'approved' ? C.tag(t('offer.status.approved'), 'ok') : o.status === 'rejected' ? C.tag(t('offer.status.rejected'), 'danger') : C.tag(o.status === 'draft' ? t('offer.status.draft') : o.status, 'warn'))

/** Minimum time each "Susun dengan AI" step stays on screen (ms), so the pipeline reads as thinking. */
export const MIN_STEP_MS = { data: 1400, schedule: 1200, offer: 2600, pdf: 1300, email: 1500, review: 1100 }
const pacingOff = () => { try { return globalThis.localStorage?.getItem('satualur_fast_ai') === '1' } catch { return false } }

/** Abortable wait; no-op for ms <= 0 or when pacing is switched off (tests). */
function thinkPause(ms, signal) {
  if (!(ms > 0) || pacingOff()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(new DOMException('Dihentikan', 'AbortError')) }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function render(container, ctx = {}) {
  if (ctx.params?.offerId != null) return renderDetail(container, ctx)
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}
  const businessName = ctx.user?.name || ''

  /* ------------------------------------------------- Step 1: pick */
  const reqSelect = C.select({ label: t('offer.pick.request'), name: 'request_id', required: true, hint: t('offer.pick.requestHint'), options: [{ value: '', label: t('offer.loading') }] })
  const preview = el('div', { className: 'req-preview-slot', hidden: true })
  const tmplSelect = C.select({ label: t('offer.pick.template'), name: 'template_id', hint: t('offer.pick.templateHint'), options: [{ value: '', label: t('offer.pick.noTemplate') }] })
  const tmplDesc = el('p', { className: 'muted small tmpl-desc', hidden: true })
  const tmplFields = el('div', { className: 'tmpl-fields' })
  const tmplBox = el('div', { className: 'tmpl-box' }, tmplSelect.wrap, tmplDesc, tmplFields)

  /* -------------------------------------------- Step 2: AI pipeline */
  const forBox = el('div', {})
  const pipeList = el('ol', { className: 'pipe', 'aria-label': t('offer.pipe.aria') })
  const pipeHead = el('div', { className: 'pipe-head' })
  const stopBtn = C.button({ label: t('offer.pipe.stop'), icon: 'stop', size: 'sm', variant: 'ghost', hidden: true })
  const pipeTime = el('span', { className: 'pipe-time tnum muted small', 'aria-live': 'off' })
  pipeHead.append(el('span', { className: 'pipe-title' }, icon('sparkles', { size: 16 }), t('offer.pipe.title')), pipeTime, stopBtn)
  const liveBox = el('div', { className: 'live-offer', hidden: true, 'aria-live': 'polite' })
  const scheduleInput = el('input', { type: 'datetime-local', className: 'input input-sm', name: 'offer_schedule', 'aria-label': t('offer.schedule') })
  const modelNote = el('span', { className: 'model-note', hidden: true })
  const pipeBox = el('div', { className: 'pipe-box' }, pipeHead, pipeList, liveBox, modelNote)

  /* ----------------------------------------- Step 3: review & save */
  const reviewBox = el('div', { className: 'proposal' })

  let model = null
  let flow = null
  let templates = []
  let current = null // AbortController of the running pipeline
  let draft = null // { request, offerJson, schedule, template, answers, email, wa, review }
  let pipe = null
  let lastError = false
  let ticker = null
  let pendingWork = null // the pipeline's work in progress (kept across a stop/failure)
  ctx.signal?.addEventListener('abort', () => { current?.abort(); clearInterval(ticker) })

  const selectedRequest = () => flow?.request(reqSelect.input.value) || null
  const selectedTemplate = () => templates.find((t) => String(t.id) === String(tmplSelect.input.value)) || null
  const hasDraftFor = (r) => Boolean(draft && r && String(draft.request.id) === String(r.id))

  /* ---------------------------------------------------- Templates */
  let fieldInputs = new Map()
  function drawTemplateFields() {
    const t = selectedTemplate()
    fieldInputs = new Map()
    tmplDesc.hidden = !t?.description
    tmplDesc.textContent = t?.description || ''
    if (!t) { tmplFields.replaceChildren(); return }
    tmplFields.replaceChildren(...t.fields.map((f) => {
      const name = `tf_${f.key}`
      let w
      if (f.type === 'select') w = C.select({ label: f.label, name, required: f.required, options: [{ value: '', label: t('offer.pick.choose') }, ...f.options.map((o) => ({ value: o, label: o }))] })
      else w = C.field({ label: f.label, name, required: f.required, type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', attrs: { maxlength: '300', ...(f.type === 'number' ? { inputmode: 'decimal', min: '0', step: 'any' } : {}) } })
      fieldInputs.set(f.key, w.input)
      return w.wrap
    }))
  }
  tmplSelect.input.addEventListener('change', () => { drawTemplateFields(); if (draft) { draft = null; drawCompose() } })
  const templateAnswers = () => {
    const t = selectedTemplate()
    const raw = {}
    for (const [k, input] of fieldInputs) raw[k] = input.value
    return t ? validateAnswers(t, raw) : { answers: {}, errors: [] }
  }

  const wiz = C.wizard({
    label: t('offer.wiz.label'),
    steps: [
      {
        key: 'pick',
        title: t('offer.wiz.pick'),
        description: t('offer.wiz.pickDesc'),
        content: [reqSelect.wrap, preview, tmplBox],
        validate: () => {
          if (!selectedRequest()) return [{ text: t('offer.error.pickRequest'), input: reqSelect.input }]
          return templateAnswers().errors.map((e) => ({ text: e.text, input: fieldInputs.get(e.key) }))
        },
        primary: () => ({ disabled: !flow?.requests.length }),
      },
      {
        key: 'compose',
        title: t('offer.wiz.compose'),
        description: t('offer.wiz.composeDesc'),
        content: [forBox, pipeBox],
        primary: () => (hasDraftFor(selectedRequest()) && !current
          ? { label: t('offer.wiz.next'), iconRight: 'arrowRight' }
          : { label: lastError ? t('offer.wiz.retry') : t('offer.wiz.generate'), icon: lastError ? 'refresh' : 'sparkles', iconRight: undefined }),
        onPrimary: async () => {
          if (hasDraftFor(selectedRequest())) { wiz.next(); return }
          await runPipeline(lastError && pipe ? pipe.resumeKey : 'data')
        },
        onEnter: () => drawCompose(),
      },
      {
        key: 'review',
        title: t('offer.wiz.review'),
        description: t('offer.wiz.reviewDesc'),
        content: reviewBox,
        primary: { label: t('offer.wiz.save'), icon: 'save', iconRight: undefined },
        onPrimary: () => save(),
        onEnter: () => drawReview(),
      },
    ],
  })
  const msg = wiz.msg

  // The job this offer is for, named above the wizard (follows the request picker).
  const headSlot = el('div', {})
  const loadNote = el('div', {})
  container.replaceChildren(
    C.pageHeader({ title: t('offer.newTitle') }),
    solo(headSlot, loadNote, wiz.root, workflowLink(navigate)),
  )
  const drawHead = () => {
    const r = selectedRequest()
    headSlot.replaceChildren(r ? jobHeader(r, { note: t('offer.newTitle') }) : '')
  }

  const modelReady = resolveModel()
    .then((mdl) => { model = mdl; if (!mdl) { modelNote.textContent = t('offer.aiUnavailableShort'); modelNote.hidden = false } })
    .catch(() => { modelNote.textContent = t('offer.aiUnavailableShort'); modelNote.hidden = false })

  listTemplates().then((rows) => {
    templates = rows
    C.setOptions(tmplSelect.input, [{ value: '', label: t('offer.pick.noTemplate') }, ...rows.map((t) => ({ value: t.id, label: t.name }))], tmplSelect.input.value)
    tmplBox.hidden = !rows.length
  })

  /* ---------------------------------------------------------- Options */
  const requestPreview = (r) => C.miniPreview({
    title: customerLabel(r),
    chips: [
      { icon: 'layers', text: r.service_type || '—', title: t('offer.preview.service', { value: r.service_type || '—' }) },
      r.location ? { icon: 'mapPin', text: r.location, title: t('offer.preview.location', { value: r.location }) } : null,
      r.phone ? { icon: 'phone', text: r.phone, title: t('offer.preview.phone', { value: r.phone }) } : null,
    ],
    note: r.description || t('offer.preview.noDesc'),
  })

  let firstFill = true
  function fillRequests() {
    const fresh = flow.requestsWithoutOffer()
    const offered = flow.requests.filter((r) => flow.offersOf(r.id).length > 0)
    const opts = [{ value: '', label: flow.requests.length ? t('offer.pick.chooseRequest') : t('offer.pick.noRequests') }]
    fresh.forEach((r) => opts.push({ value: r.id, label: `${customerLabel(r)} — ${r.service_type || t('offer.service')}` }))
    offered.forEach((r) => opts.push({ value: r.id, label: `${customerLabel(r)} — ${r.service_type || t('offer.service')}${t('offer.pick.alreadyOffered')}` }))
    const keep = reqSelect.input.value || (firstFill && params.requestId != null ? String(params.requestId) : '')
    C.setOptions(reqSelect.input, opts, keep)
    if (!flow.requests.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', t('offer.pick.noRequestsNote'))
      const go = C.button({ label: t('offer.pick.toRequests'), iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('request'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    showPreview()
    drawHead()
    wiz.syncPrimary()
    // Arriving with a request preselected (dashboard / request list): skip to step 2.
    if (firstFill && params.requestId != null && selectedRequest()) wiz.go('compose', { focus: false, animate: false })
    firstFill = false
  }

  function showPreview() {
    const r = selectedRequest()
    if (!r) { preview.hidden = true; return }
    preview.replaceChildren(requestPreview(r))
    preview.hidden = false
  }
  reqSelect.input.addEventListener('change', () => { msg.hide(); showPreview(); drawHead() })

  /* -------------------------------------------------------- Pipeline */
  const STEP_DETAIL = new Map() // key -> extra node shown under the step

  function drawPipe() {
    const steps = (pipe || createPipeline()).steps
    pipeList.replaceChildren(...steps.map((s, i) => {
      const mark = s.state === 'done' ? icon('check', { size: 14 })
        : s.state === 'running' ? el('span', { className: 'pipe-spin', 'aria-hidden': 'true' })
          : s.state === 'error' ? icon('x', { size: 14 })
            : el('span', { className: 'pipe-num tnum' }, String(i + 1))
      const state = t(`offer.pipe.state.${s.state}`)
      const li = el('li', { className: `pipe-step is-${s.state}`, dataset: { step: s.key } },
        el('span', { className: 'pipe-mark' }, mark),
        el('div', { className: 'pipe-body' },
          el('span', { className: 'pipe-label' }, t(`offer.pipe.step.${s.key}`), el('span', { className: 'sr-only' }, ` (${state})`)),
          s.ms != null && s.state === 'done' ? el('span', { className: 'pipe-ms tnum' }, t('offer.pipe.seconds', { n: (s.ms / 1000).toFixed(1) })) : '',
          s.error ? el('span', { className: 'pipe-err' }, s.error) : '',
          STEP_DETAIL.get(s.key) || ''),
      )
      if ((s.state === 'error' || s.state === 'stopped') && !current) {
        const retry = C.button({ label: t('offer.pipe.retryHere'), icon: 'refresh', size: 'sm', variant: 'ghost' })
        retry.addEventListener('click', () => runPipeline(s.key))
        li.querySelector('.pipe-body').appendChild(retry)
      }
      return li
    }))
  }

  function drawCompose() {
    const r = selectedRequest()
    const t = selectedTemplate()
    forBox.replaceChildren(r ? C.miniPreview({
      title: customerLabel(r),
      chips: [{ icon: 'layers', text: r.service_type || '—' }, r.location ? { icon: 'mapPin', text: r.location } : null, t ? { icon: 'fileText', text: t.name } : null],
    }) : '')
    if (current) return
    if (!hasDraftFor(r) && !lastError) {
      pipe = null
      STEP_DETAIL.clear()
      liveBox.hidden = true
      pipeTime.textContent = ''
    }
    drawPipe()
  }

  const toLocalInput = (d) => {
    const x = new Date(d)
    if (Number.isNaN(x.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`
  }
  const scheduleValue = () => (scheduleInput.value && !Number.isNaN(new Date(scheduleInput.value).getTime()) ? new Date(scheduleInput.value) : null)

  const LIVE_FIELDS = [
    { key: 'scope' },
    { key: 'price', money: true },
    { key: 'terms' },
    { key: 'notes' },
  ]
  function drawLive(fields, closed) {
    liveBox.hidden = false
    liveBox.replaceChildren(...LIVE_FIELDS.map((f) => {
      const has = fields[f.key] !== undefined && fields[f.key] !== ''
      const writing = has && !closed.has(f.key)
      const val = !has ? el('span', { className: 'live-wait' }, t('offer.live.waiting'))
        : f.money ? el('b', { className: 'tnum' }, C.rupiah(fields[f.key])) : el('span', {}, String(fields[f.key]))
      return el('div', { className: `live-field${writing ? ' is-writing' : ''}${has ? '' : ' is-empty'}` },
        el('span', { className: 'live-label' }, t(`offer.field.${f.key}`)), el('div', { className: 'live-value' }, val, writing ? el('span', { className: 'caret', 'aria-hidden': 'true' }) : ''))
    }))
  }

  const wait = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Dibatalkan', 'AbortError')) }, { once: true })
  })

  async function runPipeline(fromKey = 'data') {
    msg.hide()
    const request = selectedRequest()
    if (!request) {
      wiz.go('pick')
      wiz.invalid([{ text: t('offer.error.pickRequest'), input: reqSelect.input }])
      return
    }
    if (!model) { try { await modelReady } catch { /* reported below */ } }
    if (!model) { msg.show('danger', t('offer.aiUnavailable')); return }

    current?.abort()
    const ac = new AbortController()
    current = ac
    if (!pipe || fromKey === 'data') { pipe = createPipeline(); STEP_DETAIL.clear() } else pipe.resetFrom(fromKey)
    const template = selectedTemplate()
    const { answers } = templateAnswers()
    const work = fromKey !== 'data' && pendingWork && String(pendingWork.request.id) === String(request.id)
      ? pendingWork : { request, template, answers, offerJson: null, schedule: null, history: null }
    work.template = template; work.answers = answers
    pendingWork = work
    draft = null
    lastError = false
    const restore = wiz.busy(t('offer.composing'))
    stopBtn.hidden = false
    const started = Date.now()
    clearInterval(ticker)
    ticker = setInterval(() => { pipeTime.textContent = t('offer.pipe.seconds', { n: ((Date.now() - started) / 1000).toFixed(0) }) }, 500)
    stopBtn.onclick = () => ac.abort()
    const order = pipe.steps.map((s) => s.key)
    const startAt = Math.max(0, order.indexOf(fromKey))
    let failed = false
    try {
      for (const key of order.slice(startAt)) {
        pipe.start(key); drawPipe()
        const t0 = Date.now()
        await STEPS[key](work, ac.signal)
        // Each step stays visible for a moment so the owner can follow what the AI is doing.
        await thinkPause(MIN_STEP_MS[key] - (Date.now() - t0), ac.signal)
        pipe.done(key); drawPipe()
      }
      draft = work
    } catch (err) {
      failed = true
      if (err.name === 'AbortError') {
        pipe.stop()
        lastError = true
        msg.show('info', t('offer.pipe.stopped'))
      } else {
        const key = pipe.running?.key
        if (key) pipe.fail(key, err)
        lastError = true
        msg.show('danger', err.message)
      }
      draft = null // pendingWork keeps what was done, so a retry continues from the failed step
    } finally {
      clearInterval(ticker)
      stopBtn.hidden = true
      if (current === ac) current = null
      restore()
      drawPipe()
    }
    if (!failed && !ctx.signal?.aborted && wiz.key === 'compose') wiz.go('review')
    else wiz.syncPrimary()
  }

  const STEPS = {
    async data(work, signal) {
      const r = work.request
      const sameService = flow.offers.filter((o) => {
        const req = flow.requestOfOffer(o)
        return req && String(req.id) !== String(r.id) && String(req.service_type || '').toLowerCase() === String(r.service_type || '').toLowerCase()
      })
      const sameCustomer = flow.requests.filter((x) => String(x.id) !== String(r.id) && String(x.customer_name || '').toLowerCase() === String(r.customer_name || '').toLowerCase())
      work.history = priceHistory(sameService)
      STEP_DETAIL.set('data', el('span', { className: 'pipe-detail' },
        [r.phone ? t('offer.pipe.data.hasPhone') : t('offer.pipe.data.noPhone'),
          sameCustomer.length ? t('offer.pipe.data.previous', { count: sameCustomer.length }) : t('offer.pipe.data.newCustomer'),
          work.history ? t('offer.pipe.data.similar', { count: work.history.count }) : t('offer.pipe.data.noSimilar')].join(' · ')))
      await wait(250, signal)
    },
    async schedule(work, signal) {
      if (!scheduleInput.value || scheduleInput.dataset.for !== String(work.request.id)) {
        const s = suggestSchedule({ requestedAt: work.request.requested_at, assignments: flow.assignments })
        scheduleInput.value = toLocalInput(s.at)
        scheduleInput.dataset.for = String(work.request.id)
        scheduleInput.dataset.reason = s.reason
      }
      const why = ['client', 'free', 'lightest'].includes(scheduleInput.dataset.reason) ? t(`offer.pipe.why.${scheduleInput.dataset.reason}`) : ''
      STEP_DETAIL.set('schedule', el('label', { className: 'pipe-detail pipe-schedule' }, el('span', {}, why), scheduleInput))
      work.schedule = scheduleValue()
      await wait(200, signal)
    },
    async offer(work, signal) {
      const parts = [templateContext(work.template, work.answers)]
      const sched = scheduleValue()
      if (sched) parts.push(`Jadwal rencana pelaksanaan: ${C.formatDateTime(sched)}`)
      if (work.history) parts.push(`Riwayat harga layanan serupa: rata-rata ${C.rupiah(work.history.avg)} dari ${work.history.count} penawaran (kisaran ${C.rupiah(work.history.min)} – ${C.rupiah(work.history.max)}).`)
      drawLive({}, new Set())
      work.offerJson = await abortable(generateOffer({
        request: work.request,
        modelId: model.id,
        signal,
        context: parts.filter(Boolean).join('\n'),
        onChunk: (_d, full) => { if (!signal.aborted) { const { fields, closed } = readPartialJson(full); drawLive(fields, closed) } },
      }), signal)
      drawLive(work.offerJson, new Set(Object.keys(work.offerJson)))
    },
    async pdf(work, signal) {
      work.schedule = scheduleValue()
      const btn = C.button({ label: t('offer.pipe.previewPdf'), icon: 'download', size: 'sm', variant: 'ghost' })
      btn.addEventListener('click', () => openOfferDocument({ businessName, request: work.request, offer: work.offerJson, schedule: work.schedule, templateName: work.template?.name }))
      STEP_DETAIL.set('pdf', el('span', { className: 'pipe-detail' }, t('offer.pipe.number', { number: offerNumber({ requestId: work.request.id }) }), btn))
      await wait(200, signal)
    },
    async email(work, signal) {
      const o = work.offerJson
      work.email = offerEmailDraft({ customer: work.request.customer_name, service: work.request.service_type, price: o.price, scope: o.scope, terms: o.terms, businessName })
      work.wa = offerMessage({ customer: work.request.customer_name, service: work.request.service_type, scope: o.scope, price: o.price, terms: o.terms, business: businessName })
      STEP_DETAIL.set('email', el('span', { className: 'pipe-detail' }, t('offer.pipe.emailSubject', { subject: work.email.subject })))
      await wait(200, signal)
    },
    async review(work, signal) {
      work.review = reviewDraft({ offer: work.offerJson, request: work.request, history: work.history, template: work.template, schedule: scheduleValue() })
      STEP_DETAIL.set('review', el('span', { className: 'pipe-detail' }, work.review.summary))
      await wait(200, signal)
    },
  }

  /* ------------------------------------------------------- Proposal */
  let review = null
  function drawReview() {
    if (!draft) { wiz.go('compose', { focus: false }); return }
    if (review?.draft === draft) { review.syncChecks(); return }
    const { request, offerJson, template } = draft
    const scopeF = C.textarea({ label: t('offer.field.scope'), name: 'offer_scope', rows: 4, value: offerJson.scope || '', required: true, attrs: { maxlength: '2000' } })
    const termsF = C.textarea({ label: t('offer.field.terms'), name: 'offer_terms', rows: 3, value: offerJson.terms || '', required: true, attrs: { maxlength: '1000' } })
    const notesF = C.textarea({ label: t('offer.field.notes'), name: 'offer_notes', rows: 2, value: offerJson.notes || '', attrs: { maxlength: '1000' } })
    const priceField = C.field({
      label: t('offer.field.finalPrice'), name: 'validated_price', type: 'number', required: true,
      value: String(Math.round(Number(offerJson?.price) || 0)),
      attrs: { min: String(OfferRules.minPrice), max: String(OfferRules.maxPrice), step: '1000', inputmode: 'numeric' },
    })
    priceField.wrap.querySelector('.field-req')?.remove()
    priceField.wrap.querySelector('.field-label').appendChild(el('span', { className: 'price-ai' }, t('offer.review.aiSuggestion'), ' ', el('b', {}, C.rupiah(offerJson?.price))))
    const schedF = C.field({ label: t('offer.schedule'), name: 'offer_schedule_final', type: 'datetime-local', value: scheduleInput.value, hint: t('offer.review.scheduleHint') })
    const checks = el('ul', { className: 'chips', role: 'list', 'aria-label': t('offer.rules.aria') })

    const candidate = () => ({ ...offerJson, scope: scopeF.input.value.trim(), terms: termsF.input.value.trim(), notes: notesF.input.value.trim(), price: Number(priceField.input.value) })
    const RULES = [
      { label: t('offer.rules.price', { min: C.rupiahCompact(OfferRules.minPrice), max: C.rupiahCompact(OfferRules.maxPrice) }), full: t('offer.rules.priceFull', { min: C.rupiah(OfferRules.minPrice), max: C.rupiah(OfferRules.maxPrice) }), test: (o) => { const p = Number(o.price); return !Number.isNaN(p) && p >= OfferRules.minPrice && p <= OfferRules.maxPrice } },
      { label: t('offer.rules.scope'), full: t('offer.rules.scopeFull'), test: (o) => String(o.scope || '').trim().length >= 10 },
      { label: t('offer.rules.terms'), full: t('offer.rules.termsFull'), test: (o) => String(o.terms || '').trim().length >= 10 },
    ]

    // Drafts follow the edited fields until the user edits the draft itself.
    const mailSubj = C.field({ label: t('offer.review.mailSubject'), name: 'mail_subject', value: draft.email.subject, attrs: { maxlength: '150' } })
    const mailBody = C.textarea({ label: t('offer.review.mailBody'), name: 'mail_body', rows: 8, value: draft.email.body, attrs: { maxlength: '10000' } })
    const waBody = C.textarea({ label: t('offer.review.waBody'), name: 'wa_body', rows: 7, value: draft.wa, attrs: { maxlength: '4000' } })
    const dirty = { mail: false, wa: false }
    mailSubj.input.addEventListener('input', () => { dirty.mail = true })
    mailBody.input.addEventListener('input', () => { dirty.mail = true })
    waBody.input.addEventListener('input', () => { dirty.wa = true })
    const refreshDrafts = () => {
      const o = candidate()
      if (!dirty.mail) {
        const m = offerEmailDraft({ customer: request.customer_name, service: request.service_type, price: o.price, scope: o.scope, terms: o.terms, businessName })
        mailSubj.input.value = m.subject; mailBody.input.value = m.body
      }
      if (!dirty.wa) waBody.input.value = offerMessage({ customer: request.customer_name, service: request.service_type, scope: o.scope, price: o.price, terms: o.terms, business: businessName })
    }

    const reviewNotes = el('ul', { className: 'review-notes' })
    const drawNotes = () => {
      const r = reviewDraft({ offer: candidate(), request, history: draft.history, template, schedule: schedF.input.value || null })
      reviewNotes.replaceChildren(...r.points.map((p) => el('li', { className: `review-note is-${p.tone}` }, icon(p.tone === 'ok' ? 'checkCircle' : p.tone === 'warn' ? 'alert' : 'info', { size: 14 }), el('span', {}, p.text))))
    }
    const syncChecks = () => {
      const o = candidate()
      checks.replaceChildren(...RULES.map((r) => {
        const ok = r.test(o)
        return el('li', { className: `chip ${ok ? 'is-ok' : 'is-bad'}`, title: `${r.full || r.label}: ${ok ? t('offer.rules.pass') : t('offer.rules.fail')}` },
          icon(ok ? 'check' : 'x', { size: 13 }), el('span', { className: 'chip-text' }, r.label),
          el('span', { className: 'sr-only' }, ok ? ` (${t('offer.rules.pass')})` : ` (${t('offer.rules.fail')})`))
      }))
      const v = validateOffer(o)
      wiz.setPrimaryDisabled(!v.valid)
      return v
    }
    for (const f of [scopeF, termsF, notesF, priceField, schedF]) f.input.addEventListener('input', () => { syncChecks(); refreshDrafts(); drawNotes() })
    priceField.wrap.appendChild(el('div', { className: 'rules-row' },
      el('span', { className: 'proposal-label' }, icon('shield', { size: 14 }), t('offer.rules.title')), checks))

    const currentOffer = () => {
      const o = candidate()
      return { validated_price: o.price, validated_scope: o.scope, ai_proposal_json: o }
    }
    const pdfBtn = C.button({ label: t('offer.actions.pdf'), icon: 'download', size: 'sm', variant: 'soft' })
    pdfBtn.addEventListener('click', () => openOfferDocument({ businessName, request, offer: candidate(), schedule: schedF.input.value || null, templateName: template?.name }))
    const mailBtn = C.button({ label: t('offer.actions.email'), icon: 'mail', size: 'sm', variant: 'ghost' })
    mailBtn.addEventListener('click', () => openOfferEmail({ offer: currentOffer(), request, businessName, opener: mailBtn, draft: { subject: mailSubj.input.value, body: mailBody.input.value } }))
    const waBtn = C.button({ label: t('offer.actions.wa'), icon: 'send', size: 'sm', variant: 'ghost', disabled: !request.phone, title: request.phone ? '' : t('offer.actions.noPhone') })
    waBtn.addEventListener('click', () => openWaDialog({ requestId: request.id, customer: customerLabel(request), phone: request.phone, kind: 'offer', opener: waBtn, openSettings: ctx.openSettings, text: waBody.input.value }))

    reviewBox.replaceChildren(
      el('div', { className: 'proposal-top' },
        el('span', { className: 'tag tag-accent' }, icon('sparkles', { size: 14 }), t('offer.review.aiSuggestion')),
        el('span', { className: 'proposal-for', title: `${customerLabel(request)} — ${request.service_type || t('offer.service')}` }, `${customerLabel(request)} — ${request.service_type || t('offer.service')}`),
        template ? C.tag(template.name, 'neutral') : '',
      ),
      scopeF.wrap, termsF.wrap, notesF.wrap,
      el('div', { className: 'form-row keep-row review-row' }, priceField.wrap, schedF.wrap),
      el('section', { className: 'review-box', 'aria-label': t('offer.review.notes') },
        el('h4', { className: 'review-box-title' }, icon('checkCircle', { size: 15 }), t('offer.review.notes')), reviewNotes),
      el('details', { className: 'draft-box' }, el('summary', {}, icon('mail', { size: 14 }), t('offer.review.mailDraft')), mailSubj.wrap, mailBody.wrap),
      el('details', { className: 'draft-box' }, el('summary', {}, icon('send', { size: 14 }), t('offer.review.waDraft')), waBody.wrap),
      el('div', { className: 'review-actions' }, pdfBtn, mailBtn, waBtn),
    )
    review = { draft, priceField, scopeF, termsF, schedF, candidate, syncChecks }
    syncChecks(); drawNotes()
  }

  async function save() {
    if (!review || !draft) return
    const { request, offerJson, template, answers } = draft
    const o = review.candidate()
    const v = review.syncChecks()
    if (!v.valid) {
      const byField = (re, input) => v.errors.filter((e) => re.test(e)).map((text) => ({ text, input }))
      wiz.invalid([...byField(/harga/i, review.priceField.input), ...byField(/lingkup|scope/i, review.scopeF.input), ...byField(/ketentuan|terms/i, review.termsF.input)].concat(v.errors.filter((e) => !/harga|lingkup|scope|ketentuan|terms/i.test(e))))
      return
    }
    const restore = wiz.busy(t('offer.saving'))
    try {
      const db = getCloud().database
      const { data, error } = await db.from('offers').insert({
        request_id: request.id,
        ai_proposal_json: { ...offerJson, scope: o.scope, terms: o.terms, notes: o.notes, price: o.price, ai_price: offerJson.price },
        validated_price: o.price,
        validated_scope: o.scope,
        status: 'approved',
        template_id: template?.id ?? null,
        template_answers_json: template ? answers : null,
      })
      if (error) throw new Error(error.message)
      const sched = review.schedF.input.value ? new Date(review.schedF.input.value) : null
      if (sched && !Number.isNaN(sched.getTime()) && sched.toISOString() !== request.requested_at) {
        await db.from('requests').update({ requested_at: sched.toISOString() }).eq('id', request.id)
      }
      const row = Array.isArray(data) ? data[0] : data
      restore()
      const next = C.button({ label: t('offer.done.assign'), iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('assign', { offerId: row?.id }))
      const again = C.button({ label: t('offer.done.another'), icon: 'plus', size: 'sm', variant: 'soft' })
      again.addEventListener('click', () => {
        draft = null; review = null; pipe = null; pendingWork = null; lastError = false
        STEP_DETAIL.clear()
        scheduleInput.value = ''
        reqSelect.input.value = ''
        reqSelect.input.dispatchEvent(new Event('change'))
        tmplSelect.input.value = ''
        drawTemplateFields()
        reviewBox.replaceChildren()
        wiz.reset()
      })
      const mail = offerEmailButton({ offer: { ...row, validated_price: o.price, validated_scope: o.scope, ai_proposal_json: { ...offerJson, ...o } }, request, businessName })
      const view = C.button({ label: t('offer.done.view'), icon: 'fileText', size: 'sm', variant: 'ghost' })
      view.addEventListener('click', () => navigate('offer', { offerId: row?.id }))
      wiz.complete({ text: t('offer.done.text', { price: C.rupiah(o.price), name: customerLabel(request) }), actions: row?.id != null ? [next, mail, view, again] : [next, mail, again] })
      showToast(t('offer.done.toast'), 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      review.syncChecks()
      msg.show('danger', t('offer.saveError', { error: err.message }))
    }
  }

  /* ------------------------------------------------------------ Load */
  async function loadList() {
    try {
      flow = await loadFlow()
    } catch (err) {
      loadNote.replaceChildren(C.errorState(t('offer.loadError', { error: err.message })))
      return
    }
    if (ctx.signal?.aborted) return
    loadNote.replaceChildren()
    fillRequests()
  }

  await loadList()
}

/* ================================================================ One offer */
/** #/app/penawaran/<id>: the offer of one job with its actions (approve, send, assign). */
async function renderDetail(container, ctx) {
  const navigate = ctx.navigate || (() => {})
  const businessName = ctx.user?.name || ''
  const id = String(ctx.params.offerId)
  const status = C.message()
  const body = el('div', { className: 'stage-solo' }, C.skeletonRows(4))
  container.replaceChildren(C.pageHeader({ title: t('offer.title') }), body)

  async function load() {
    let flow
    try {
      flow = await loadFlow()
    } catch (err) {
      body.replaceChildren(C.errorState(t('offer.loadError', { error: err.message })))
      return
    }
    if (ctx.signal?.aborted) return
    const o = flow.offer(id)
    if (!o) {
      body.replaceChildren(pickFromWorkflow(navigate, { title: t('offer.detail.notFound'), body: t('offer.detail.notFoundBody') }))
      return
    }
    draw(flow, o)
  }

  function draw(flow, o) {
    const r = flow.requestOfOffer(o)
    const proposal = typeof o.ai_proposal_json === 'object' && o.ai_proposal_json ? o.ai_proposal_json : {}
    const assigned = flow.assignmentsOf(o.id)
    const facts = C.defList([
      [t('offer.detail.service'), r?.service_type || '—'],
      [t('offer.detail.location'), r?.location || '—'],
      [t('offer.detail.phone'), r?.phone || '—'],
      [t('offer.field.scope'), o.validated_scope || proposal.scope || '—'],
      [t('offer.field.price'), el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price))],
      [t('offer.field.terms'), proposal.terms || '—'],
      ...(proposal.notes ? [[t('offer.field.notes'), proposal.notes]] : []),
      [t('offer.detail.schedule'), r?.requested_at ? C.formatDateTime(r.requested_at) : '—'],
      [t('offer.detail.status'), offerTag(o)],
      [t('offer.detail.created'), C.formatDateTime(o.created_at)],
    ])

    const actions = []
    if (o.status !== 'approved') {
      const ok = C.button({ label: t('offer.detail.approve'), icon: 'check', size: 'sm', variant: 'primary' })
      ok.addEventListener('click', () => approve(o, ok))
      actions.push(ok)
      const redo = C.button({ label: t('offer.detail.redo'), icon: 'sparkles', size: 'sm', variant: 'soft' })
      redo.addEventListener('click', () => navigate('offer', { requestId: o.request_id }))
      actions.push(redo)
    } else if (!assigned.length) {
      const go = C.button({ label: t('offer.detail.assign'), iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      go.addEventListener('click', () => navigate('assign', { offerId: o.id }))
      actions.push(go)
    } else {
      const go = C.button({ label: t('offer.detail.viewAssignment'), iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
      go.addEventListener('click', () => navigate('assign', { offerId: o.id }))
      actions.push(C.tag(t('offer.detail.assigned'), 'ok'), go)
    }
    // Send the offer by email (any address, confirmed in a dialog) or WhatsApp (needs the customer's phone).
    actions.push(offerEmailButton({ offer: o, request: r, businessName }))
    if (r?.phone) {
      const wa = C.button({ label: t('offer.actions.waShort'), icon: 'send', size: 'sm', variant: 'ghost' })
      wa.setAttribute('aria-label', t('offer.detail.waAria', { name: customerLabel(r) }))
      wa.addEventListener('click', () => openWaDialog({
        requestId: r.id, customer: customerLabel(r), phone: r.phone, kind: 'offer', opener: wa, openSettings: ctx.openSettings,
        text: offerMessage({ customer: r.customer_name, service: r.service_type, scope: o.validated_scope, price: o.validated_price, terms: proposal.terms, business: businessName }),
      }))
      actions.push(wa)
    }
    const pdf = C.button({ label: t('offer.actions.pdf'), icon: 'download', size: 'sm', variant: 'ghost' })
    pdf.addEventListener('click', () => openOfferDocument({ businessName, request: r, offer: { ...proposal, scope: o.validated_scope || proposal.scope, price: o.validated_price }, schedule: r?.requested_at || null }))
    actions.push(pdf)

    body.replaceChildren(
      jobHeader(r, { tag: offerTag(o), note: t('offer.detail.number', { id: o.id }) }),
      status,
      C.panel({ title: t('offer.title'), meta: C.rupiah(o.validated_price), className: 'offer-detail', raised: true },
        facts, el('div', { className: 'job-actions' }, actions)),
      workflowLink(navigate),
    )
  }

  async function approve(o, btnEl) {
    const proposal = typeof o.ai_proposal_json === 'object' && o.ai_proposal_json ? o.ai_proposal_json : {}
    const v = validateOffer({ ...proposal, price: o.validated_price, scope: o.validated_scope || proposal.scope })
    if (!v.valid) { status.show('danger', t('offer.detail.invalid', { id: o.id }), v.errors); return }
    const restore = C.setBusy(btnEl, t('offer.detail.approving'))
    try {
      const { error } = await getCloud().database.from('offers').update({ status: 'approved' }).eq('id', o.id)
      if (error) throw new Error(error.message)
      showToast(t('offer.detail.approvedToast'), 'success')
      notifyDataChanged()
      await load()
    } catch (err) {
      restore()
      status.show('danger', t('offer.detail.approveError', { error: err.message }))
    }
  }

  await load()
}

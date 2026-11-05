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

const offerTag = (o) => (o.status === 'approved' ? C.tag('Disetujui', 'ok') : o.status === 'rejected' ? C.tag('Ditolak', 'danger') : C.tag(o.status === 'draft' ? 'Draf' : o.status, 'warn'))

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
  const reqSelect = C.select({ label: 'Permintaan', name: 'request_id', required: true, hint: 'Permintaan tanpa penawaran ditampilkan lebih dulu.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { className: 'req-preview-slot', hidden: true })
  const tmplSelect = C.select({ label: 'Template penawaran', name: 'template_id', hint: 'Opsional. Template menambah pertanyaan khusus agar penawaran lebih tepat.', options: [{ value: '', label: 'Tanpa template' }] })
  const tmplDesc = el('p', { className: 'muted small tmpl-desc', hidden: true })
  const tmplFields = el('div', { className: 'tmpl-fields' })
  const tmplBox = el('div', { className: 'tmpl-box' }, tmplSelect.wrap, tmplDesc, tmplFields)

  /* -------------------------------------------- Step 2: AI pipeline */
  const forBox = el('div', {})
  const pipeList = el('ol', { className: 'pipe', 'aria-label': 'Proses penyusunan penawaran' })
  const pipeHead = el('div', { className: 'pipe-head' })
  const stopBtn = C.button({ label: 'Hentikan', icon: 'stop', size: 'sm', variant: 'ghost', hidden: true })
  const pipeTime = el('span', { className: 'pipe-time tnum muted small', 'aria-live': 'off' })
  pipeHead.append(el('span', { className: 'pipe-title' }, icon('sparkles', { size: 16 }), 'Proses AI'), pipeTime, stopBtn)
  const liveBox = el('div', { className: 'live-offer', hidden: true, 'aria-live': 'polite' })
  const scheduleInput = el('input', { type: 'datetime-local', className: 'input input-sm', name: 'offer_schedule', 'aria-label': 'Jadwal pelaksanaan' })
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
      if (f.type === 'select') w = C.select({ label: f.label, name, required: f.required, options: [{ value: '', label: 'Pilih' }, ...f.options.map((o) => ({ value: o, label: o }))] })
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
    label: 'Susun penawaran',
    steps: [
      {
        key: 'pick',
        title: 'Pilih permintaan',
        description: 'Pelanggan mana yang akan ditawari, dan pakai template apa?',
        content: [reqSelect.wrap, preview, tmplBox],
        validate: () => {
          if (!selectedRequest()) return [{ text: 'Pilih permintaan terlebih dahulu.', input: reqSelect.input }]
          return templateAnswers().errors.map((e) => ({ text: e.text, input: fieldInputs.get(e.key) }))
        },
        primary: () => ({ disabled: !flow?.requests.length }),
      },
      {
        key: 'compose',
        title: 'Susun dengan AI',
        description: 'AI mengambil data klien, menyusun penawaran, PDF, dan draf pesan.',
        content: [forBox, pipeBox],
        primary: () => (hasDraftFor(selectedRequest()) && !current
          ? { label: 'Lanjut', iconRight: 'arrowRight' }
          : { label: lastError ? 'Coba lagi' : 'Hasilkan penawaran', icon: lastError ? 'refresh' : 'sparkles', iconRight: undefined }),
        onPrimary: async () => {
          if (hasDraftFor(selectedRequest())) { wiz.next(); return }
          await runPipeline(lastError && pipe ? pipe.resumeKey : 'data')
        },
        onEnter: () => drawCompose(),
      },
      {
        key: 'review',
        title: 'Tinjau & simpan',
        description: 'Semua isian bisa diubah sebelum disimpan.',
        content: reviewBox,
        primary: { label: 'Simpan penawaran', icon: 'save', iconRight: undefined },
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
    C.pageHeader({ title: 'Penawaran baru' }),
    solo(headSlot, loadNote, wiz.root, workflowLink(navigate)),
  )
  const drawHead = () => {
    const r = selectedRequest()
    headSlot.replaceChildren(r ? jobHeader(r, { note: 'Penawaran baru' }) : '')
  }

  const modelReady = resolveModel()
    .then((mdl) => { model = mdl; if (!mdl) { modelNote.textContent = 'AI sedang tidak tersedia'; modelNote.hidden = false } })
    .catch(() => { modelNote.textContent = 'AI sedang tidak tersedia'; modelNote.hidden = false })

  listTemplates().then((rows) => {
    templates = rows
    C.setOptions(tmplSelect.input, [{ value: '', label: 'Tanpa template' }, ...rows.map((t) => ({ value: t.id, label: t.name }))], tmplSelect.input.value)
    tmplBox.hidden = !rows.length
  })

  /* ---------------------------------------------------------- Options */
  const requestPreview = (r) => C.miniPreview({
    title: customerLabel(r),
    chips: [
      { icon: 'layers', text: r.service_type || '—', title: `Layanan: ${r.service_type || '—'}` },
      r.location ? { icon: 'mapPin', text: r.location, title: `Lokasi: ${r.location}` } : null,
      r.phone ? { icon: 'phone', text: r.phone, title: `Telepon: ${r.phone}` } : null,
    ],
    note: r.description || 'Belum ada deskripsi kebutuhan.',
  })

  let firstFill = true
  function fillRequests() {
    const fresh = flow.requestsWithoutOffer()
    const offered = flow.requests.filter((r) => flow.offersOf(r.id).length > 0)
    const opts = [{ value: '', label: flow.requests.length ? 'Pilih permintaan' : 'Belum ada permintaan' }]
    fresh.forEach((r) => opts.push({ value: r.id, label: `${customerLabel(r)} — ${r.service_type || 'layanan'}` }))
    offered.forEach((r) => opts.push({ value: r.id, label: `${customerLabel(r)} — ${r.service_type || 'layanan'} (sudah ditawarkan)` }))
    const keep = reqSelect.input.value || (firstFill && params.requestId != null ? String(params.requestId) : '')
    C.setOptions(reqSelect.input, opts, keep)
    if (!flow.requests.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', 'Belum ada permintaan. Buat permintaan di tahap 01 terlebih dahulu.')
      const go = C.button({ label: 'Ke permintaan', iconRight: 'arrowRight', size: 'sm' })
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
      const state = { pending: 'menunggu', running: 'berjalan', done: 'selesai', error: 'gagal', stopped: 'dihentikan' }[s.state]
      const li = el('li', { className: `pipe-step is-${s.state}`, dataset: { step: s.key } },
        el('span', { className: 'pipe-mark' }, mark),
        el('div', { className: 'pipe-body' },
          el('span', { className: 'pipe-label' }, s.label, el('span', { className: 'sr-only' }, ` (${state})`)),
          s.ms != null && s.state === 'done' ? el('span', { className: 'pipe-ms tnum' }, `${(s.ms / 1000).toFixed(1)} dtk`) : '',
          s.error ? el('span', { className: 'pipe-err' }, s.error) : '',
          STEP_DETAIL.get(s.key) || ''),
      )
      if ((s.state === 'error' || s.state === 'stopped') && !current) {
        const retry = C.button({ label: 'Ulangi dari sini', icon: 'refresh', size: 'sm', variant: 'ghost' })
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
    { key: 'scope', label: 'Ruang lingkup' },
    { key: 'price', label: 'Harga', money: true },
    { key: 'terms', label: 'Ketentuan' },
    { key: 'notes', label: 'Catatan' },
  ]
  function drawLive(fields, closed) {
    liveBox.hidden = false
    liveBox.replaceChildren(...LIVE_FIELDS.map((f) => {
      const has = fields[f.key] !== undefined && fields[f.key] !== ''
      const writing = has && !closed.has(f.key)
      const val = !has ? el('span', { className: 'live-wait' }, 'menunggu…')
        : f.money ? el('b', { className: 'tnum' }, C.rupiah(fields[f.key])) : el('span', {}, String(fields[f.key]))
      return el('div', { className: `live-field${writing ? ' is-writing' : ''}${has ? '' : ' is-empty'}` },
        el('span', { className: 'live-label' }, f.label), el('div', { className: 'live-value' }, val, writing ? el('span', { className: 'caret', 'aria-hidden': 'true' }) : ''))
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
      wiz.invalid([{ text: 'Pilih permintaan terlebih dahulu.', input: reqSelect.input }])
      return
    }
    if (!model) { try { await modelReady } catch { /* reported below */ } }
    if (!model) { msg.show('danger', 'AI sedang tidak tersedia. Periksa koneksi lalu muat ulang halaman.'); return }

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
    const restore = wiz.busy('Menyusun…')
    stopBtn.hidden = false
    const started = Date.now()
    clearInterval(ticker)
    ticker = setInterval(() => { pipeTime.textContent = `${((Date.now() - started) / 1000).toFixed(0)} dtk` }, 500)
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
        msg.show('info', 'Proses dihentikan. Tidak ada yang disimpan.')
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
        [r.phone ? 'Telepon ada' : 'Tanpa telepon',
          sameCustomer.length ? `${sameCustomer.length} permintaan sebelumnya dari pelanggan ini` : 'Pelanggan baru',
          work.history ? `${work.history.count} penawaran serupa` : 'Belum ada penawaran serupa'].join(' · ')))
      await wait(250, signal)
    },
    async schedule(work, signal) {
      if (!scheduleInput.value || scheduleInput.dataset.for !== String(work.request.id)) {
        const s = suggestSchedule({ requestedAt: work.request.requested_at, assignments: flow.assignments })
        scheduleInput.value = toLocalInput(s.at)
        scheduleInput.dataset.for = String(work.request.id)
        scheduleInput.dataset.reason = s.reason
      }
      const why = { client: 'Sesuai permintaan klien.', free: 'Hari kerja terdekat yang masih kosong.', lightest: 'Hari kerja dengan tugas paling sedikit.' }[scheduleInput.dataset.reason] || ''
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
      const btn = C.button({ label: 'Pratinjau PDF', icon: 'download', size: 'sm', variant: 'ghost' })
      btn.addEventListener('click', () => openOfferDocument({ businessName, request: work.request, offer: work.offerJson, schedule: work.schedule, templateName: work.template?.name }))
      STEP_DETAIL.set('pdf', el('span', { className: 'pipe-detail' }, `Nomor ${offerNumber({ requestId: work.request.id })}`, btn))
      await wait(200, signal)
    },
    async email(work, signal) {
      const o = work.offerJson
      work.email = offerEmailDraft({ customer: work.request.customer_name, service: work.request.service_type, price: o.price, scope: o.scope, terms: o.terms, businessName })
      work.wa = offerMessage({ customer: work.request.customer_name, service: work.request.service_type, scope: o.scope, price: o.price, terms: o.terms, business: businessName })
      STEP_DETAIL.set('email', el('span', { className: 'pipe-detail' }, `Email: "${work.email.subject}"`))
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
    const scopeF = C.textarea({ label: 'Ruang lingkup', name: 'offer_scope', rows: 4, value: offerJson.scope || '', required: true, attrs: { maxlength: '2000' } })
    const termsF = C.textarea({ label: 'Ketentuan', name: 'offer_terms', rows: 3, value: offerJson.terms || '', required: true, attrs: { maxlength: '1000' } })
    const notesF = C.textarea({ label: 'Catatan', name: 'offer_notes', rows: 2, value: offerJson.notes || '', attrs: { maxlength: '1000' } })
    const priceField = C.field({
      label: 'Harga final (Rp)', name: 'validated_price', type: 'number', required: true,
      value: String(Math.round(Number(offerJson?.price) || 0)),
      attrs: { min: String(OfferRules.minPrice), max: String(OfferRules.maxPrice), step: '1000', inputmode: 'numeric' },
    })
    priceField.wrap.querySelector('.field-req')?.remove()
    priceField.wrap.querySelector('.field-label').appendChild(el('span', { className: 'price-ai' }, 'Usulan AI ', el('b', {}, C.rupiah(offerJson?.price))))
    const schedF = C.field({ label: 'Jadwal pelaksanaan', name: 'offer_schedule_final', type: 'datetime-local', value: scheduleInput.value, hint: 'Disimpan sebagai jadwal yang diminta klien dan dipakai di Penugasan.' })
    const checks = el('ul', { className: 'chips', role: 'list', 'aria-label': 'Hasil aturan domain' })

    const candidate = () => ({ ...offerJson, scope: scopeF.input.value.trim(), terms: termsF.input.value.trim(), notes: notesF.input.value.trim(), price: Number(priceField.input.value) })
    const RULES = [
      { label: `Harga ${C.rupiahCompact(OfferRules.minPrice)} – ${C.rupiahCompact(OfferRules.maxPrice)}`, full: `Harga dalam rentang ${C.rupiah(OfferRules.minPrice)} – ${C.rupiah(OfferRules.maxPrice)}`, test: (o) => { const p = Number(o.price); return !Number.isNaN(p) && p >= OfferRules.minPrice && p <= OfferRules.maxPrice } },
      { label: 'Lingkup ≥ 10 kar.', full: 'Ruang lingkup minimal 10 karakter', test: (o) => String(o.scope || '').trim().length >= 10 },
      { label: 'Ketentuan ≥ 10 kar.', full: 'Ketentuan minimal 10 karakter', test: (o) => String(o.terms || '').trim().length >= 10 },
    ]

    // Drafts follow the edited fields until the user edits the draft itself.
    const mailSubj = C.field({ label: 'Subjek email', name: 'mail_subject', value: draft.email.subject, attrs: { maxlength: '150' } })
    const mailBody = C.textarea({ label: 'Isi email', name: 'mail_body', rows: 8, value: draft.email.body, attrs: { maxlength: '10000' } })
    const waBody = C.textarea({ label: 'Pesan WhatsApp', name: 'wa_body', rows: 7, value: draft.wa, attrs: { maxlength: '4000' } })
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
        return el('li', { className: `chip ${ok ? 'is-ok' : 'is-bad'}`, title: `${r.full || r.label}: ${ok ? 'lolos' : 'belum lolos'}` },
          icon(ok ? 'check' : 'x', { size: 13 }), el('span', { className: 'chip-text' }, r.label),
          el('span', { className: 'sr-only' }, ok ? ' (lolos)' : ' (belum lolos)'))
      }))
      const v = validateOffer(o)
      wiz.setPrimaryDisabled(!v.valid)
      return v
    }
    for (const f of [scopeF, termsF, notesF, priceField, schedF]) f.input.addEventListener('input', () => { syncChecks(); refreshDrafts(); drawNotes() })
    priceField.wrap.appendChild(el('div', { className: 'rules-row' },
      el('span', { className: 'proposal-label' }, icon('shield', { size: 14 }), 'Aturan domain'), checks))

    const currentOffer = () => {
      const o = candidate()
      return { validated_price: o.price, validated_scope: o.scope, ai_proposal_json: o }
    }
    const pdfBtn = C.button({ label: 'Unduh PDF', icon: 'download', size: 'sm', variant: 'soft' })
    pdfBtn.addEventListener('click', () => openOfferDocument({ businessName, request, offer: candidate(), schedule: schedF.input.value || null, templateName: template?.name }))
    const mailBtn = C.button({ label: 'Kirim email', icon: 'mail', size: 'sm', variant: 'ghost' })
    mailBtn.addEventListener('click', () => openOfferEmail({ offer: currentOffer(), request, businessName, opener: mailBtn, draft: { subject: mailSubj.input.value, body: mailBody.input.value } }))
    const waBtn = C.button({ label: 'Kirim WhatsApp', icon: 'send', size: 'sm', variant: 'ghost', disabled: !request.phone, title: request.phone ? '' : 'Nomor telepon pelanggan belum ada' })
    waBtn.addEventListener('click', () => openWaDialog({ requestId: request.id, customer: customerLabel(request), phone: request.phone, kind: 'offer', opener: waBtn, openSettings: ctx.openSettings, text: waBody.input.value }))

    reviewBox.replaceChildren(
      el('div', { className: 'proposal-top' },
        el('span', { className: 'tag tag-accent' }, icon('sparkles', { size: 14 }), 'Usulan AI'),
        el('span', { className: 'proposal-for', title: `${customerLabel(request)} — ${request.service_type || 'layanan'}` }, `${customerLabel(request)} — ${request.service_type || 'layanan'}`),
        template ? C.tag(template.name, 'neutral') : '',
      ),
      scopeF.wrap, termsF.wrap, notesF.wrap,
      el('div', { className: 'form-row keep-row review-row' }, priceField.wrap, schedF.wrap),
      el('section', { className: 'review-box', 'aria-label': 'Draf tinjauan' },
        el('h4', { className: 'review-box-title' }, icon('checkCircle', { size: 15 }), 'Draf tinjauan'), reviewNotes),
      el('details', { className: 'draft-box' }, el('summary', {}, icon('mail', { size: 14 }), 'Draf email'), mailSubj.wrap, mailBody.wrap),
      el('details', { className: 'draft-box' }, el('summary', {}, icon('send', { size: 14 }), 'Draf WhatsApp'), waBody.wrap),
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
    const restore = wiz.busy('Menyimpan…')
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
      const next = C.button({ label: 'Tugaskan pekerja', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('assign', { offerId: row?.id }))
      const again = C.button({ label: 'Buat penawaran lain', icon: 'plus', size: 'sm', variant: 'soft' })
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
      const view = C.button({ label: 'Lihat penawaran', icon: 'fileText', size: 'sm', variant: 'ghost' })
      view.addEventListener('click', () => navigate('offer', { offerId: row?.id }))
      wiz.complete({ text: `Penawaran ${C.rupiah(o.price)} untuk ${customerLabel(request)} disimpan dan disetujui.`, actions: row?.id != null ? [next, mail, view, again] : [next, mail, again] })
      showToast('Penawaran disimpan.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      review.syncChecks()
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    }
  }

  /* ------------------------------------------------------------ Load */
  async function loadList() {
    try {
      flow = await loadFlow()
    } catch (err) {
      loadNote.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
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
  container.replaceChildren(C.pageHeader({ title: 'Penawaran' }), body)

  async function load() {
    let flow
    try {
      flow = await loadFlow()
    } catch (err) {
      body.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
    const o = flow.offer(id)
    if (!o) {
      body.replaceChildren(pickFromWorkflow(navigate, { title: 'Penawaran tidak ditemukan.', body: 'Mungkin sudah dihapus. Pilih pekerjaan lain dari Alur kerja.' }))
      return
    }
    draw(flow, o)
  }

  function draw(flow, o) {
    const r = flow.requestOfOffer(o)
    const proposal = typeof o.ai_proposal_json === 'object' && o.ai_proposal_json ? o.ai_proposal_json : {}
    const assigned = flow.assignmentsOf(o.id)
    const facts = C.defList([
      ['Layanan', r?.service_type || '—'],
      ['Lokasi', r?.location || '—'],
      ['Telepon', r?.phone || '—'],
      ['Ruang lingkup', o.validated_scope || proposal.scope || '—'],
      ['Harga', el('span', { className: 'tnum strong' }, C.rupiah(o.validated_price))],
      ['Ketentuan', proposal.terms || '—'],
      ...(proposal.notes ? [['Catatan', proposal.notes]] : []),
      ['Jadwal', r?.requested_at ? C.formatDateTime(r.requested_at) : '—'],
      ['Status', offerTag(o)],
      ['Dibuat', C.formatDateTime(o.created_at)],
    ])

    const actions = []
    if (o.status !== 'approved') {
      const ok = C.button({ label: 'Setujui', icon: 'check', size: 'sm', variant: 'primary' })
      ok.addEventListener('click', () => approve(o, ok))
      actions.push(ok)
      const redo = C.button({ label: 'Susun ulang dengan AI', icon: 'sparkles', size: 'sm', variant: 'soft' })
      redo.addEventListener('click', () => navigate('offer', { requestId: o.request_id }))
      actions.push(redo)
    } else if (!assigned.length) {
      const go = C.button({ label: 'Tugaskan', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      go.addEventListener('click', () => navigate('assign', { offerId: o.id }))
      actions.push(go)
    } else {
      const go = C.button({ label: 'Lihat penugasan', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
      go.addEventListener('click', () => navigate('assign', { offerId: o.id }))
      actions.push(C.tag('Ditugaskan', 'ok'), go)
    }
    // Send the offer by email (any address, confirmed in a dialog) or WhatsApp (needs the customer's phone).
    actions.push(offerEmailButton({ offer: o, request: r, businessName }))
    if (r?.phone) {
      const wa = C.button({ label: 'WhatsApp', icon: 'send', size: 'sm', variant: 'ghost' })
      wa.setAttribute('aria-label', `Kirim penawaran ke ${customerLabel(r)} via WhatsApp`)
      wa.addEventListener('click', () => openWaDialog({
        requestId: r.id, customer: customerLabel(r), phone: r.phone, kind: 'offer', opener: wa, openSettings: ctx.openSettings,
        text: offerMessage({ customer: r.customer_name, service: r.service_type, scope: o.validated_scope, price: o.validated_price, terms: proposal.terms, business: businessName }),
      }))
      actions.push(wa)
    }
    const pdf = C.button({ label: 'Unduh PDF', icon: 'download', size: 'sm', variant: 'ghost' })
    pdf.addEventListener('click', () => openOfferDocument({ businessName, request: r, offer: { ...proposal, scope: o.validated_scope || proposal.scope, price: o.validated_price }, schedule: r?.requested_at || null }))
    actions.push(pdf)

    body.replaceChildren(
      jobHeader(r, { tag: offerTag(o), note: `Penawaran #${o.id}` }),
      status,
      C.panel({ title: 'Penawaran', meta: C.rupiah(o.validated_price), className: 'offer-detail', raised: true },
        facts, el('div', { className: 'job-actions' }, actions)),
      workflowLink(navigate),
    )
  }

  async function approve(o, btnEl) {
    const proposal = typeof o.ai_proposal_json === 'object' && o.ai_proposal_json ? o.ai_proposal_json : {}
    const v = validateOffer({ ...proposal, price: o.validated_price, scope: o.validated_scope || proposal.scope })
    if (!v.valid) { status.show('danger', `Penawaran #${o.id} tidak lolos validasi.`, v.errors); return }
    const restore = C.setBusy(btnEl, 'Menyetujui…')
    try {
      const { error } = await getCloud().database.from('offers').update({ status: 'approved' }).eq('id', o.id)
      if (error) throw new Error(error.message)
      showToast('Penawaran disetujui.', 'success')
      notifyDataChanged()
      await load()
    } catch (err) {
      restore()
      status.show('danger', `Gagal menyetujui: ${err.message}`)
    }
  }

  await load()
}

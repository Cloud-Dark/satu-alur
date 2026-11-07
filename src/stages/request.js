/**
 * 01 — Permintaan: capture a customer request (#/app/permintaan/baru). The form only: every job
 * is listed in Alur kerja, which this page links to.
 */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged } from './data.js'
import { solo, workflowLink } from './job.js'
import { openMapPicker } from '../leads/picker.js'
import { autofillRequest } from '../ai/agent.js'
import { readPartialJson } from '../offer/partial-json.js'
import { listTemplates } from '../offer/api.js'
import { isQuotaError } from '../quota/errors.js'
import { resolveModel } from './offer.js'
import { t } from '../i18n/index.js'

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})

  /* ------------------------------------------------------------- Form */
  const name = C.field({ label: t('request.field.name'), name: 'customer_name', required: true, placeholder: t('request.field.namePh'), hint: t('request.field.nameHint'), attrs: { autocomplete: 'organization', maxlength: '120' } })
  const location = C.field({ label: t('request.field.location'), name: 'location', placeholder: t('request.field.locationPh'), attrs: { autocomplete: 'address-level2', maxlength: '120' } })
  const phone = C.field({ label: t('request.field.phone'), name: 'phone', type: 'tel', placeholder: '0812 3456 7890', attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: '32' } })
  const email = C.field({ label: t('request.field.email'), name: 'email', type: 'email', placeholder: 'info@contoh.id', hint: t('request.field.optional'), attrs: { autocomplete: 'email', inputmode: 'email', maxlength: '254' } })
  const website = C.field({ label: t('request.field.website'), name: 'website', placeholder: t('request.field.websitePh'), hint: t('request.field.websiteHint'), attrs: { maxlength: '300' } })
  const service = C.field({ label: t('request.field.service'), name: 'service_type', required: true, placeholder: t('request.field.servicePh'), hint: t('request.field.serviceHint'), attrs: { maxlength: '120' } })
  const desc = C.textarea({ label: t('request.field.desc'), name: 'description', rows: 5, placeholder: t('request.field.descPh'), hint: t('request.field.descHint'), attrs: { maxlength: '2000' } })
  const reviewBox = el('div', { className: 'proposal' })

  // Step 1 source: pick a business from the open map, or type it in by hand.
  let coords = null
  const mapBtn = C.button({ label: t('request.source.map'), icon: 'mapPin', variant: 'soft', size: 'sm' })
  const manualBtn = C.button({ label: t('request.source.manual'), icon: 'edit', variant: 'ghost', size: 'sm' })
  const pickedNote = el('p', { className: 'muted small req-picked', hidden: true })
  mapBtn.addEventListener('click', () => openMapPicker({
    opener: mapBtn,
    initialArea: location.input.value.trim(),
    onPick: (f) => {
      name.input.value = f.customer_name
      if (f.location) location.input.value = f.location
      if (f.phone) phone.input.value = f.phone
      if (f.email) email.input.value = f.email
      if (f.website) website.input.value = f.website
      // Business description only seeds an empty "Deskripsi kebutuhan"; the user edits it in step 2.
      if (f.description && !desc.input.value.trim()) { desc.input.value = f.description; desc.input.dispatchEvent(new Event('input', { bubbles: true })) }
      coords = f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : null
      pickedNote.textContent = t('request.source.picked', { name: f.customer_name })
      pickedNote.hidden = false
      ;[name, location, phone, email, website].forEach((x) => x.input.dispatchEvent(new Event('input', { bubbles: true })))
      name.input.focus()
    },
  }))
  manualBtn.addEventListener('click', () => {
    coords = null
    pickedNote.hidden = true
    name.input.focus()
  })
  // Typing a different name by hand drops the coordinates of the picked place.
  name.input.addEventListener('input', (e) => { if (e.isTrusted && coords) { coords = null; pickedNote.hidden = true } })
  const sourceRow = el('div', { className: 'req-source' }, mapBtn, manualBtn)

  const PHONE_RE = /^[+()\d\s.-]{6,32}$/
  const values = () => ({
    customer_name: name.input.value.trim(),
    service_type: service.input.value.trim(),
    location: location.input.value.trim(),
    phone: phone.input.value.trim(),
    email: email.input.value.trim(),
    website: website.input.value.trim(),
    description: desc.input.value.trim(),
  })
  const customerErrors = () => {
    const d = values()
    const errs = []
    if (!d.customer_name) errs.push({ text: t('request.error.name'), input: name.input })
    if (d.phone && !PHONE_RE.test(d.phone)) errs.push({ text: t('request.error.phone'), input: phone.input })
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.push({ text: t('request.error.email'), input: email.input })
    return errs
  }
  const needErrors = () => {
    return values().service_type ? [] : [{ text: t('request.error.service'), input: service.input }]
  }

  /* --------------------------------------------- AI autofill (step 2) */
  const hint = C.textarea({ label: t('request.ai.hint'), name: 'ai_hint', rows: 3, placeholder: t('request.ai.hintPh'), hint: t('request.ai.hintHint'), attrs: { maxlength: '4000' } })
  const fillBtn = C.button({ label: t('request.ai.fill'), icon: 'sparkles', variant: 'soft', size: 'sm' })
  const fillStatus = el('p', { className: 'muted small ai-fill-status', role: 'status', 'aria-live': 'polite' })
  const aiFill = el('div', { className: 'ai-fill' }, hint.wrap, el('div', { className: 'ai-fill-actions' }, fillBtn, fillStatus))
  let fillCtl = null
  const knownServices = async () => {
    const fromHistory = (model?.requests || []).map((r) => r.service_type)
    const fromTemplates = (await listTemplates().catch(() => [])).map((t) => t.name)
    return [...fromHistory, ...fromTemplates]
  }
  fillBtn.addEventListener('click', async () => {
    if (fillCtl) { fillCtl.abort(); return }
    const text = hint.input.value.trim()
    if (!text) { fillStatus.textContent = t('request.ai.needHint'); hint.input.focus(); return }
    const ac = new AbortController()
    fillCtl = ac
    ctx.signal?.addEventListener('abort', () => ac.abort(), { once: true })
    const label = fillBtn.querySelector('.btn-label')
    if (label) label.textContent = t('request.ai.stop')
    fillStatus.textContent = t('request.ai.writing')
    service.input.closest('.field')?.classList.add('is-filling')
    desc.input.closest('.field')?.classList.add('is-filling')
    try {
      const mdl = await resolveModel()
      if (!mdl) throw new Error(t('request.ai.unavailable'))
      const result = await autofillRequest({
        customer: values(),
        hint: text,
        services: await knownServices(),
        modelId: mdl.id,
        signal: ac.signal,
        onChunk: (_d, full) => {
          const { fields, closed } = readPartialJson(full)
          if (closed.has('service_type') && fields.service_type) service.input.value = String(fields.service_type).slice(0, 120)
          if (typeof fields.description === 'string') { desc.input.value = fields.description; desc.input.scrollTop = desc.input.scrollHeight }
        },
      })
      if (result.service_type) service.input.value = result.service_type
      if (result.description) desc.input.value = result.description
      ;[service, desc].forEach((f) => f.input.dispatchEvent(new Event('input', { bubbles: true })))
      fillStatus.textContent = t('request.ai.filled')
    } catch (err) {
      fillStatus.textContent = err.name === 'AbortError' ? t('request.ai.stopped') : isQuotaError(err) ? err.message : (err.message || t('request.ai.failed'))
    } finally {
      fillCtl = null
      if (label) label.textContent = t('request.ai.fill')
      service.input.closest('.field')?.classList.remove('is-filling')
      desc.input.closest('.field')?.classList.remove('is-filling')
    }
  })

  const wiz = C.wizard({
    label: t('request.title'),
    steps: [
      {
        key: 'customer',
        title: t('request.wiz.customer'),
        description: t('request.wiz.customerDesc'),
        content: [sourceRow, pickedNote, name.wrap, el('div', { className: 'form-row keep-row' }, location.wrap, phone.wrap), el('div', { className: 'form-row' }, email.wrap, website.wrap)],
        validate: customerErrors,
      },
      {
        key: 'need',
        title: t('request.wiz.need'),
        description: t('request.wiz.needDesc'),
        content: [aiFill, service.wrap, desc.wrap],
        validate: needErrors,
      },
      {
        key: 'review',
        title: t('request.wiz.review'),
        description: t('request.wiz.reviewDesc'),
        content: reviewBox,
        primary: { label: t('request.wiz.save'), icon: 'save', iconRight: undefined },
        validate: () => {
          const errs = [...customerErrors(), ...needErrors()]
          return errs.map((e) => e.text)
        },
        onPrimary: () => save(),
        onEnter: () => drawReview(),
      },
    ],
  })
  const msg = wiz.msg

  // Arriving with a prefill (e.g. from Radar peluang): fill the form and open step 2.
  const pre = ctx.params?.prefill
  if (pre && typeof pre === 'object') {
    const put = (f, v) => { if (v) f.input.value = String(v).slice(0, Number(f.input.maxLength) > 0 ? Number(f.input.maxLength) : 2000) }
    put(name, pre.customer_name); put(location, pre.location); put(phone, pre.phone); put(email, pre.email); put(website, pre.website); put(service, pre.service_type); put(desc, pre.description)
    if (pre.customer_name) queueMicrotask(() => wiz.go('need', { focus: false, animate: false }))
  }

  container.replaceChildren(
    C.pageHeader({ title: t('request.title') }),
    solo(wiz.root, workflowLink(navigate)),
  )

  function drawReview() {
    const d = values()
    reviewBox.replaceChildren(...[
      C.miniPreview({
        title: d.customer_name || '—',
        chips: [
          { icon: 'layers', text: d.service_type || '—', title: t('request.review.service', { value: d.service_type || '—' }) },
          d.location ? { icon: 'mapPin', text: d.location, title: t('request.review.location', { value: d.location }) } : null,
          d.phone ? { icon: 'phone', text: d.phone, title: t('request.review.phone', { value: d.phone }) } : null,
          d.email ? { icon: 'mail', text: d.email, title: t('request.review.email', { value: d.email }) } : null,
          d.website ? { icon: 'compass', text: d.website, title: t('request.review.website', { value: d.website }) } : null,
        ],
        note: d.description || t('request.review.noDesc'),
        noteLines: 4,
      }),
      d.description ? null : el('p', { className: 'wiz-pane-desc' }, t('request.review.tip')),
    ].filter(Boolean))
  }

  async function save() {
    const data = values()
    if (coords) Object.assign(data, coords)
    const restore = wiz.busy(t('request.saving'))
    try {
      const { data: created, error } = await getCloud().database.from('requests').insert(data)
      if (error) throw new Error(error.message)
      const row = Array.isArray(created) ? created[0] : created
      restore()
      const actions = []
      if (row?.id != null) {
        const next = C.button({ label: t('request.done.offer'), iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
        next.addEventListener('click', () => navigate('offer', { requestId: row.id }))
        actions.push(next)
      }
      const again = C.button({ label: t('request.done.another'), icon: 'plus', size: 'sm', variant: 'soft' })
      again.addEventListener('click', () => {
        for (const f of [name, location, phone, email, website, service, desc, hint]) f.input.value = ''
        fillStatus.textContent = ''
        coords = null
        pickedNote.hidden = true
        reviewBox.replaceChildren()
        wiz.reset()
      })
      actions.push(again)
      wiz.complete({ text: t('request.done.text', { name: data.customer_name }), actions })
      showToast(t('request.done.toast'), 'success')
      notifyDataChanged()
      await loadModel()
    } catch (err) {
      restore()
      msg.show('danger', t('request.saveError', { error: err.message }))
    }
  }

  /* ---------------------------------------- Known services (AI hint) */
  let model = null
  async function loadModel() {
    try { model = await loadFlow(['requests']) } catch { /* only used for AI suggestions */ }
  }

  await loadModel()
}

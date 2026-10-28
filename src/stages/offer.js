/** 02 — Penawaran: AI drafts an offer, domain rules validate, human saves. */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { generateOffer } from '../ai/agent.js'
import { validateOffer, OfferRules } from '../domain/rules.js'
import { loadModels } from '../ai/models.js'
import { getAgentParams } from './settings.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'

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

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  /* ------------------------------------------------- Step 1: pick */
  const reqSelect = C.select({ label: 'Permintaan', name: 'request_id', required: true, hint: 'Permintaan tanpa penawaran ditampilkan lebih dulu.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { className: 'req-preview-slot', hidden: true })

  /* -------------------------------------------- Step 2: AI compose */
  const forBox = el('div', {})
  const aiSlot = el('div', { className: 'ai-slot' })
  const modelNote = el('span', { className: 'model-note' }, 'Model: memuat…')
  const redoBtn = C.button({ label: 'Susun ulang', icon: 'refresh', size: 'sm', variant: 'soft', hidden: true })
  const redoRow = el('div', { className: 'redo-row' }, modelNote, redoBtn)

  /* ----------------------------------------- Step 3: review & save */
  const reviewBox = el('div', { className: 'proposal' })

  let model = null
  let flow = null
  let current = null // AbortController for the active generation
  let draft = null // { request, offerJson, raw } — the last parsed proposal
  let consoleUI = null
  let lastError = false
  ctx.signal?.addEventListener('abort', () => current?.abort())

  const selectedRequest = () => flow?.request(reqSelect.input.value) || null
  const hasDraftFor = (r) => Boolean(draft && r && String(draft.request.id) === String(r.id))

  const wiz = C.wizard({
    label: 'Susun penawaran',
    steps: [
      {
        key: 'pick',
        title: 'Pilih permintaan',
        description: 'Pelanggan mana yang akan ditawari?',
        content: [reqSelect.wrap, preview],
        validate: () => (selectedRequest() ? [] : [{ text: 'Pilih permintaan terlebih dahulu.', input: reqSelect.input }]),
        primary: () => ({ disabled: !flow?.requests.length }),
      },
      {
        key: 'compose',
        title: 'Susun dengan AI',
        description: 'AI menulis ruang lingkup, harga, dan ketentuan.',
        content: [forBox, aiSlot, redoRow],
        primary: () => (hasDraftFor(selectedRequest()) && !current
          ? { label: 'Lanjut', iconRight: 'arrowRight' }
          : { label: lastError ? 'Coba lagi' : 'Hasilkan penawaran', icon: lastError ? 'refresh' : 'sparkles', iconRight: undefined }),
        onPrimary: async () => {
          if (hasDraftFor(selectedRequest())) { wiz.next(); return }
          await generate()
        },
        onEnter: () => drawCompose(),
      },
      {
        key: 'review',
        title: 'Tinjau & simpan',
        description: 'Sesuaikan harga bila perlu, lalu simpan.',
        content: reviewBox,
        primary: { label: 'Simpan penawaran', icon: 'save', iconRight: undefined },
        onPrimary: () => save(),
        onEnter: () => drawReview(),
      },
    ],
  })
  const msg = wiz.msg

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar penawaran', meta: 'memuat…', className: 'list-panel' }, listBody)

  container.replaceChildren(
    C.pageHeader({ num: '02', label: 'Penawaran', title: 'Penawaran AI', em: 'AI', description: 'AI menyusun ruang lingkup dan harga. Aturan domain memeriksa hasilnya sebelum Anda menyimpan.' }),
    el('div', { className: 'stage-grid has-wizard' }, wiz.root, listPanel),
  )

  const modelReady = resolveModel()
    .then((mdl) => { model = mdl; modelNote.textContent = mdl ? `Model: ${mdl.id}` : 'Model: tidak tersedia' })
    .catch((err) => { modelNote.textContent = `Model: ${err.message}` })

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
  reqSelect.input.addEventListener('change', () => { msg.hide(); showPreview() })

  /* -------------------------------------------------------- Generate */
  function drawCompose() {
    const r = selectedRequest()
    forBox.replaceChildren(r ? C.miniPreview({
      title: customerLabel(r),
      chips: [{ icon: 'layers', text: r.service_type || '—' }, r.location ? { icon: 'mapPin', text: r.location } : null],
    }) : '')
    const ready = hasDraftFor(r)
    redoBtn.hidden = !ready || Boolean(current)
    if (current) return // keep the live console
    if (ready) {
      aiSlot.replaceChildren(el('div', { className: 'note note-ok' }, icon('checkCircle'),
        el('div', { className: 'note-body' }, el('p', {}, 'Usulan AI siap ditinjau.'))))
    } else if (consoleUI && lastError) {
      aiSlot.replaceChildren(consoleUI.root)
    } else {
      aiSlot.replaceChildren(el('div', { className: 'ai-placeholder' }, icon('sparkles', { size: 18 }),
        el('span', {}, 'Tekan Hasilkan penawaran. Hasil AI mengalir di sini dan bisa dihentikan kapan saja.')))
    }
  }
  redoBtn.addEventListener('click', () => { draft = null; lastError = false; generate() })

  async function generate() {
    msg.hide()
    const request = selectedRequest()
    if (!request) {
      wiz.go('pick')
      wiz.invalid([{ text: 'Pilih permintaan terlebih dahulu.', input: reqSelect.input }])
      return
    }
    if (!model) { try { await modelReady } catch { /* reported below */ } }
    if (!model) {
      msg.show('danger', 'Model AI tidak tersedia. Periksa koneksi lalu muat ulang halaman.')
      return
    }

    current?.abort()
    const ac = new AbortController()
    current = ac
    draft = null
    redoBtn.hidden = true
    const restore = wiz.busy('Menyusun…')
    consoleUI = C.aiConsole({ model: model.id })
    consoleUI.onStop(() => ac.abort())
    consoleUI.setStatus('Menulis…', true)
    consoleUI.write('')
    aiSlot.replaceChildren(consoleUI.root)

    let raw = ''
    let ok = false
    try {
      const offerJson = await abortable(generateOffer({
        request,
        modelId: model.id,
        signal: ac.signal,
        onChunk: (_delta, full) => { raw = full; if (!ac.signal.aborted) consoleUI.write(full) },
      }), ac.signal)
      consoleUI.done()
      consoleUI.setStatus('Selesai', false)
      draft = { request, offerJson, raw }
      lastError = false
      ok = true
    } catch (err) {
      consoleUI.done()
      lastError = true
      if (err.name === 'AbortError') {
        consoleUI.setStatus('Dihentikan', false)
        msg.show('info', 'Pembuatan penawaran dihentikan. Tidak ada yang disimpan.')
      } else {
        consoleUI.setStatus('Gagal', false)
        msg.show('danger', err.message)
      }
    } finally {
      if (current === ac) current = null
      restore()
    }
    if (ok && !ctx.signal?.aborted && wiz.key === 'compose') wiz.go('review')
    else {
      drawCompose()
      if (!msg.hidden) msg.scrollIntoView({ block: 'nearest' })
    }
  }

  /* ------------------------------------------------------- Proposal */
  let review = null // { priceField, candidate, syncChecks }
  function drawReview() {
    if (!draft) { wiz.go('compose', { focus: false }); return }
    if (review?.draft === draft) { review.syncChecks(); return }
    const { request, offerJson, raw } = draft
    const priceField = C.field({
      label: 'Harga final (Rp)', name: 'validated_price', type: 'number', required: true,
      value: String(Math.round(Number(offerJson?.price) || 0)),
      attrs: { min: String(OfferRules.minPrice), max: String(OfferRules.maxPrice), step: '1000', inputmode: 'numeric' },
    })
    priceField.wrap.querySelector('.field-req')?.remove()
    priceField.wrap.querySelector('.field-label').appendChild(
      el('span', { className: 'price-ai' }, 'Usulan AI ', el('b', {}, C.rupiah(offerJson?.price))))
    const checks = el('ul', { className: 'chips', role: 'list', 'aria-label': 'Hasil aturan domain' })

    const candidate = () => ({ ...offerJson, price: Number(priceField.input.value) })
    const RULES = [
      { label: `Harga ${C.rupiahCompact(OfferRules.minPrice)} – ${C.rupiahCompact(OfferRules.maxPrice)}`, full: `Harga dalam rentang ${C.rupiah(OfferRules.minPrice)} – ${C.rupiah(OfferRules.maxPrice)}`, test: (o) => { const p = Number(o.price); return !Number.isNaN(p) && p >= OfferRules.minPrice && p <= OfferRules.maxPrice } },
      { label: 'Lingkup ≥ 10 kar.', full: 'Ruang lingkup minimal 10 karakter', test: (o) => String(o.scope || '').trim().length >= 10 },
      { label: 'Ketentuan ≥ 10 kar.', full: 'Ketentuan minimal 10 karakter', test: (o) => String(o.terms || '').trim().length >= 10 },
    ]
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
    priceField.input.addEventListener('input', syncChecks)
    // Domain-rule results sit directly under the editable price.
    priceField.wrap.appendChild(el('div', { className: 'rules-row' },
      el('span', { className: 'proposal-label' }, icon('shield', { size: 14 }), 'Aturan domain'),
      checks))

    const sum = el('dl', { className: 'sum-grid' },
      el('div', { className: 'is-wide' }, el('dt', {}, 'Ruang lingkup'), el('dd', {}, C.clampText(offerJson?.scope || '—', 4))),
      el('div', { className: 'is-wide' }, el('dt', {}, 'Ketentuan'), el('dd', {}, C.clampText(offerJson?.terms || '—', 2))),
      offerJson?.notes ? el('div', { className: 'is-wide' }, el('dt', {}, 'Catatan'), el('dd', {}, C.clampText(offerJson.notes, 2))) : null,
    )
    const rawBox = el('details', { className: 'raw-json' },
      el('summary', {}, icon('chevronRight', { size: 14 }), 'Lihat JSON mentah'),
      el('pre', {}, raw || JSON.stringify(offerJson, null, 2)))

    reviewBox.replaceChildren(
      el('div', { className: 'proposal-top' },
        el('span', { className: 'tag tag-accent' }, icon('sparkles', { size: 14 }), 'Usulan AI'),
        el('span', { className: 'proposal-for', title: `${customerLabel(request)} — ${request.service_type || 'layanan'}` }, `${customerLabel(request)} — ${request.service_type || 'layanan'}`),
      ),
      sum,
      priceField.wrap,
      rawBox,
    )
    review = { draft, priceField, candidate, syncChecks }
    syncChecks()
  }

  async function save() {
    if (!review || !draft) return
    const { request, offerJson } = draft
    const o = review.candidate()
    const v = review.syncChecks()
    if (!v.valid) {
      const priceErr = v.errors.filter((e) => /harga/i.test(e))
      wiz.invalid([...priceErr.map((text) => ({ text, input: review.priceField.input })), ...v.errors.filter((e) => !priceErr.includes(e))])
      return
    }
    const restore = wiz.busy('Menyimpan…')
    try {
      const { data, error } = await getCloud().database.from('offers').insert({
        request_id: request.id,
        ai_proposal_json: offerJson,
        validated_price: o.price,
        validated_scope: o.scope,
        status: 'approved',
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      restore()
      const next = C.button({ label: 'Tugaskan pekerja', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
      next.addEventListener('click', () => navigate('assign', { offerId: row?.id }))
      const again = C.button({ label: 'Buat penawaran lain', icon: 'plus', size: 'sm', variant: 'soft' })
      again.addEventListener('click', () => {
        draft = null; review = null; consoleUI = null; lastError = false
        reqSelect.input.value = ''
        reqSelect.input.dispatchEvent(new Event('change'))
        reviewBox.replaceChildren()
        wiz.reset()
      })
      wiz.complete({ text: `Penawaran ${C.rupiah(o.price)} untuk ${customerLabel(request)} disimpan dan disetujui.`, actions: [next, again] })
      showToast('Penawaran disimpan.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      review.syncChecks()
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    }
  }

  /* ------------------------------------------------------------ List */
  // List actions report in the wizard message; after a save (success state)
  // that area is hidden, so fall back to a toast.
  function listMessage(type, text, list) {
    if (wiz.done) showToast(list?.length ? `${text} ${list.join(' ')}` : text, 'error')
    else msg.show(type, text, list)
  }

  async function approve(o, btnEl) {
    const proposal = typeof o.ai_proposal_json === 'object' && o.ai_proposal_json ? o.ai_proposal_json : {}
    const candidate = { ...proposal, price: o.validated_price, scope: o.validated_scope || proposal.scope }
    const v = validateOffer(candidate)
    if (!v.valid) {
      listMessage('danger', `Penawaran #${o.id} tidak lolos validasi.`, v.errors)
      return
    }
    const restore = C.setBusy(btnEl, 'Menyetujui…')
    try {
      const { error } = await getCloud().database.from('offers').update({ status: 'approved' }).eq('id', o.id)
      if (error) throw new Error(error.message)
      showToast('Penawaran disetujui.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      listMessage('danger', `Gagal menyetujui: ${err.message}`)
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
    fillRequests()
    listPanel.querySelector('.panel-meta').textContent = `${flow.offers.length} baris · ${flow.offers.filter((o) => o.status === 'approved').length} disetujui`
    if (!flow.offers.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada penawaran.', body: 'Pilih permintaan lalu hasilkan penawaran dengan AI.' }))
      return
    }
    listBody.replaceChildren(C.dataTable({
      caption: 'Daftar penawaran',
      rows: flow.offers,
      rowAttrs: (o) => ({ className: params.offerId != null && String(params.offerId) === String(o.id) ? 'is-focus' : undefined, dataset: { id: String(o.id) } }),
      columns: [
        {
          label: 'Pelanggan',
          render: (o) => {
            const r = flow.requestOfOffer(o)
            const stack = C.cellStack(customerLabel(r), r?.service_type)
            if (o.validated_scope) stack.appendChild(el('span', { className: 'cell-note', title: o.validated_scope }, o.validated_scope))
            return stack
          },
        },
        { label: 'Harga', align: 'right', render: (o) => el('span', { className: 'tnum' }, C.rupiah(o.validated_price)) },
        { label: 'Status', render: (o) => (o.status === 'approved' ? C.tag('Disetujui', 'ok') : C.tag(o.status === 'draft' ? 'Draf' : o.status, 'warn')) },
        { label: 'Dibuat', className: 'col-date', render: (o) => el('time', { className: 'tnum', datetime: o.created_at, title: C.formatDateTime(o.created_at) }, C.formatDate(o.created_at)) },
        {
          label: 'Aksi',
          className: 'col-action',
          render: (o) => {
            if (o.status !== 'approved') {
              const b = C.button({ label: 'Setujui', icon: 'check', size: 'sm', variant: 'primary' })
              b.addEventListener('click', () => approve(o, b))
              return b
            }
            if (!flow.assignmentsOf(o.id).length) {
              const b = C.button({ label: 'Tugaskan', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
              b.addEventListener('click', () => navigate('assign', { offerId: o.id }))
              return b
            }
            return el('span', { className: 'muted small' }, 'Ditugaskan')
          },
        },
      ],
    }))
    const focusRow = listBody.querySelector('tr.is-focus')
    if (focusRow) focusRow.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  await loadList()
}

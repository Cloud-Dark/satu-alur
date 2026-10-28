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

  const reqSelect = C.select({ label: 'Permintaan', name: 'request_id', required: true, hint: 'Permintaan tanpa penawaran ditampilkan lebih dulu.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { className: 'req-preview', hidden: true })
  const genBtn = C.button({ label: 'Hasilkan penawaran', icon: 'sparkles', variant: 'primary' })
  const modelNote = el('span', { className: 'model-note' }, 'Model: memuat…')
  const msg = C.message()
  const resultArea = el('div', { className: 'offer-result' })

  const genPanel = C.panel({ title: 'Susun penawaran', meta: 'Dibantu AI', raised: true, className: 'form-panel' },
    el('div', { className: 'form' },
      reqSelect.wrap,
      preview,
      el('div', { className: 'form-actions' }, genBtn, modelNote),
      msg,
    ),
    resultArea,
  )

  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar penawaran', meta: 'memuat…', className: 'list-panel' }, listBody)

  container.replaceChildren(
    C.pageHeader({ num: '02', label: 'Penawaran', title: 'Penawaran AI', em: 'AI', description: 'AI menyusun ruang lingkup dan harga. Aturan domain memeriksa hasilnya sebelum Anda menyimpan.' }),
    el('div', { className: 'stage-grid' }, genPanel, listPanel),
  )

  let model = null
  let flow = null
  let current = null // AbortController for the active generation
  ctx.signal?.addEventListener('abort', () => current?.abort())

  resolveModel()
    .then((mdl) => { model = mdl; modelNote.textContent = mdl ? `Model: ${mdl.id}` : 'Model: tidak tersedia' })
    .catch((err) => { modelNote.textContent = `Model: ${err.message}` })

  /* ---------------------------------------------------------- Options */
  function fillRequests() {
    const fresh = flow.requestsWithoutOffer()
    const offered = flow.requests.filter((r) => flow.offersOf(r.id).length > 0)
    const opts = [{ value: '', label: flow.requests.length ? 'Pilih permintaan' : 'Belum ada permintaan' }]
    fresh.forEach((r) => opts.push({ value: r.id, label: `${customerLabel(r)} — ${r.service_type || 'layanan'}` }))
    offered.forEach((r) => opts.push({ value: r.id, label: `${customerLabel(r)} — ${r.service_type || 'layanan'} (sudah ditawarkan)` }))
    const keep = reqSelect.input.value || (params.requestId != null ? String(params.requestId) : '')
    C.setOptions(reqSelect.input, opts, keep)
    if (!flow.requests.length) {
      genBtn.disabled = true
      msg.show('info', 'Belum ada permintaan. Buat permintaan di tahap 01 terlebih dahulu.')
      const go = C.button({ label: 'Ke permintaan', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('request'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    } else {
      genBtn.disabled = false
    }
    showPreview()
  }

  function showPreview() {
    const r = flow?.request(reqSelect.input.value)
    if (!r) { preview.hidden = true; return }
    preview.replaceChildren(C.defList([
      ['Layanan', r.service_type || '—'],
      ['Lokasi', r.location || '—'],
      ['Telepon', r.phone || '—'],
      ['Kebutuhan', r.description || '—'],
    ]))
    preview.hidden = false
  }
  reqSelect.input.addEventListener('change', () => { msg.hide(); showPreview() })

  /* -------------------------------------------------------- Generate */
  genBtn.addEventListener('click', async () => {
    msg.hide()
    const request = flow?.request(reqSelect.input.value)
    if (!request) {
      msg.show('danger', 'Pilih permintaan terlebih dahulu.')
      reqSelect.input.focus()
      return
    }
    if (!model) {
      msg.show('danger', 'Model AI tidak tersedia. Periksa koneksi lalu muat ulang halaman.')
      return
    }

    current?.abort()
    const ac = new AbortController()
    current = ac
    const restore = C.setBusy(genBtn, 'Menyusun…')
    const consoleUI = C.aiConsole({ model: model.id })
    consoleUI.onStop(() => ac.abort())
    consoleUI.setStatus('Menulis…', true)
    consoleUI.write('')
    resultArea.replaceChildren(consoleUI.root)

    try {
      const offerJson = await abortable(generateOffer({
        request,
        modelId: model.id,
        signal: ac.signal,
        onChunk: (_delta, full) => { if (!ac.signal.aborted) consoleUI.write(full) },
      }), ac.signal)
      consoleUI.done()
      consoleUI.setStatus('Selesai', false)
      resultArea.appendChild(renderProposal(request, offerJson))
    } catch (err) {
      consoleUI.done()
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
  })

  /* ------------------------------------------------------- Proposal */
  function renderProposal(request, offerJson) {
    const box = el('div', { className: 'proposal' })
    const priceField = C.field({
      label: 'Harga final (Rp)', name: 'validated_price', type: 'number', required: true,
      value: String(Math.round(Number(offerJson?.price) || 0)),
      hint: `Boleh disesuaikan. Rentang valid ${C.rupiah(OfferRules.minPrice)} – ${C.rupiah(OfferRules.maxPrice)}.`,
      attrs: { min: String(OfferRules.minPrice), max: String(OfferRules.maxPrice), step: '1000', inputmode: 'numeric' },
    })
    const checks = el('ul', { className: 'checks' })
    const saveBtn = C.button({ label: 'Simpan penawaran', icon: 'save', variant: 'primary' })
    const saveMsg = C.message()

    const candidate = () => ({ ...offerJson, price: Number(priceField.input.value) })
    const RULES = [
      { label: `Harga ${C.rupiahCompact(OfferRules.minPrice)} – ${C.rupiahCompact(OfferRules.maxPrice)}`, test: (o) => { const p = Number(o.price); return !Number.isNaN(p) && p >= OfferRules.minPrice && p <= OfferRules.maxPrice } },
      { label: 'Ruang lingkup minimal 10 karakter', test: (o) => String(o.scope || '').trim().length >= 10 },
      { label: 'Ketentuan minimal 10 karakter', test: (o) => String(o.terms || '').trim().length >= 10 },
    ]
    const syncChecks = () => {
      const o = candidate()
      checks.replaceChildren(...RULES.map((r) => {
        const ok = r.test(o)
        return el('li', { className: ok ? 'is-ok' : 'is-bad' }, icon(ok ? 'check' : 'x', { size: 14 }), r.label)
      }))
      const v = validateOffer(o)
      saveBtn.disabled = !v.valid
      return v
    }
    priceField.input.addEventListener('input', syncChecks)

    box.append(
      el('div', { className: 'proposal-head' },
        el('span', { className: 'tag tag-accent' }, icon('sparkles', { size: 14 }), 'Usulan AI'),
        el('span', { className: 'proposal-for' }, `${customerLabel(request)} — ${request.service_type || 'layanan'}`),
      ),
      C.defList([
        ['Ruang lingkup', offerJson?.scope || '—'],
        ['Harga usulan AI', el('span', { className: 'tnum strong' }, C.rupiah(offerJson?.price))],
        ['Ketentuan', offerJson?.terms || '—'],
        ['Catatan', offerJson?.notes || '—'],
      ]),
      el('div', { className: 'proposal-validate' },
        el('span', { className: 'proposal-label' }, icon('shield', { size: 15 }), 'Aturan domain'),
        checks,
      ),
      priceField.wrap,
      el('div', { className: 'form-actions' }, saveBtn),
      saveMsg,
    )
    syncChecks()

    saveBtn.addEventListener('click', async () => {
      saveMsg.hide()
      const o = candidate()
      const v = syncChecks()
      if (!v.valid) { saveMsg.show('danger', 'Penawaran belum lolos validasi.', v.errors); return }
      const restore = C.setBusy(saveBtn, 'Menyimpan…')
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
        saveBtn.disabled = true
        priceField.input.disabled = true
        saveMsg.show('ok', `Penawaran ${C.rupiah(o.price)} untuk ${customerLabel(request)} disimpan dan disetujui.`)
        const next = C.button({ label: 'Tugaskan pekerja', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
        next.addEventListener('click', () => navigate('assign', { offerId: row?.id }))
        saveMsg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, next))
        showToast('Penawaran disimpan.', 'success')
        notifyDataChanged()
        await loadList()
      } catch (err) {
        restore()
        saveMsg.show('danger', `Gagal menyimpan: ${err.message}`)
      }
    })
    return box
  }

  /* ------------------------------------------------------------ List */
  async function approve(o, btnEl) {
    const proposal = typeof o.ai_proposal_json === 'object' && o.ai_proposal_json ? o.ai_proposal_json : {}
    const candidate = { ...proposal, price: o.validated_price, scope: o.validated_scope || proposal.scope }
    const v = validateOffer(candidate)
    if (!v.valid) {
      msg.show('danger', `Penawaran #${o.id} tidak lolos validasi.`, v.errors)
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
      msg.show('danger', `Gagal menyetujui: ${err.message}`)
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

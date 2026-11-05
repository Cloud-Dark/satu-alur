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

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})

  /* ------------------------------------------------------------- Form */
  const name = C.field({ label: 'Nama pelanggan', name: 'customer_name', required: true, placeholder: 'PT Maju Jaya', hint: 'Perusahaan atau perorangan yang meminta layanan.', attrs: { autocomplete: 'organization', maxlength: '120' } })
  const location = C.field({ label: 'Lokasi', name: 'location', placeholder: 'Jakarta Selatan', attrs: { autocomplete: 'address-level2', maxlength: '120' } })
  const phone = C.field({ label: 'Telepon', name: 'phone', type: 'tel', placeholder: '0812 3456 7890', attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: '32' } })
  const email = C.field({ label: 'Email', name: 'email', type: 'email', placeholder: 'info@contoh.id', hint: 'Opsional.', attrs: { autocomplete: 'email', inputmode: 'email', maxlength: '254' } })
  const website = C.field({ label: 'Website / kontak lain', name: 'website', placeholder: 'contoh.id · IG @usaha · WA 0812…', hint: 'Opsional: website, Instagram, WhatsApp, dll.', attrs: { maxlength: '300' } })
  const service = C.field({ label: 'Jenis layanan', name: 'service_type', required: true, placeholder: 'Pembersihan AC', hint: 'Satu layanan utama per permintaan.', attrs: { maxlength: '120' } })
  const desc = C.textarea({ label: 'Deskripsi kebutuhan', name: 'description', rows: 5, placeholder: 'Jumlah unit, luas area, waktu yang diinginkan…', hint: 'Semakin rinci, semakin akurat penawaran AI di tahap 02.', attrs: { maxlength: '2000' } })
  const reviewBox = el('div', { className: 'proposal' })

  // Step 1 source: pick a business from the open map, or type it in by hand.
  let coords = null
  const mapBtn = C.button({ label: 'Cari dari peta', icon: 'mapPin', variant: 'soft', size: 'sm' })
  const manualBtn = C.button({ label: 'Isi manual', icon: 'edit', variant: 'ghost', size: 'sm' })
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
      pickedNote.textContent = `Diisi dari peta: ${f.customer_name}. Periksa dan ubah bila perlu.`
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
    if (!d.customer_name) errs.push({ text: 'Nama pelanggan wajib diisi.', input: name.input })
    if (d.phone && !PHONE_RE.test(d.phone)) errs.push({ text: 'Nomor telepon hanya boleh berisi angka, spasi, +, -, dan tanda kurung.', input: phone.input })
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.push({ text: 'Format email belum benar, contoh: info@contoh.id.', input: email.input })
    return errs
  }
  const needErrors = () => {
    return values().service_type ? [] : [{ text: 'Jenis layanan wajib diisi.', input: service.input }]
  }

  /* --------------------------------------------- AI autofill (step 2) */
  const hint = C.textarea({ label: 'Petunjuk singkat', name: 'ai_hint', rows: 3, placeholder: 'Contoh: AC 3 unit bocor di ruang rapat, minta Sabtu pagi. Atau tempel chat WhatsApp pelanggan.', hint: 'AI mengisi jenis layanan dan deskripsi. Hasilnya tetap bisa Anda ubah.', attrs: { maxlength: '4000' } })
  const fillBtn = C.button({ label: 'Isi otomatis dengan AI', icon: 'sparkles', variant: 'soft', size: 'sm' })
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
    if (!text) { fillStatus.textContent = 'Tulis petunjuk singkat dulu, misalnya "AC 3 unit bocor".'; hint.input.focus(); return }
    const ac = new AbortController()
    fillCtl = ac
    ctx.signal?.addEventListener('abort', () => ac.abort(), { once: true })
    const label = fillBtn.querySelector('.btn-label')
    if (label) label.textContent = 'Hentikan'
    fillStatus.textContent = 'AI sedang menulis…'
    service.input.closest('.field')?.classList.add('is-filling')
    desc.input.closest('.field')?.classList.add('is-filling')
    try {
      const mdl = await resolveModel()
      if (!mdl) throw new Error('AI sedang tidak tersedia.')
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
      fillStatus.textContent = 'Terisi. Periksa dan ubah bila perlu.'
    } catch (err) {
      fillStatus.textContent = err.name === 'AbortError' ? 'Dihentikan.' : isQuotaError(err) ? err.message : (err.message || 'Gagal mengisi otomatis.')
    } finally {
      fillCtl = null
      if (label) label.textContent = 'Isi otomatis dengan AI'
      service.input.closest('.field')?.classList.remove('is-filling')
      desc.input.closest('.field')?.classList.remove('is-filling')
    }
  })

  const wiz = C.wizard({
    label: 'Permintaan baru',
    steps: [
      {
        key: 'customer',
        title: 'Pelanggan',
        description: 'Siapa yang meminta, dan di mana.',
        content: [sourceRow, pickedNote, name.wrap, el('div', { className: 'form-row keep-row' }, location.wrap, phone.wrap), el('div', { className: 'form-row' }, email.wrap, website.wrap)],
        validate: customerErrors,
      },
      {
        key: 'need',
        title: 'Kebutuhan',
        description: 'Layanan yang diminta dan rinciannya.',
        content: [aiFill, service.wrap, desc.wrap],
        validate: needErrors,
      },
      {
        key: 'review',
        title: 'Tinjau',
        description: 'Periksa sebelum disimpan.',
        content: reviewBox,
        primary: { label: 'Simpan permintaan', icon: 'save', iconRight: undefined },
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
    C.pageHeader({ title: 'Permintaan baru' }),
    solo(wiz.root, workflowLink(navigate)),
  )

  function drawReview() {
    const d = values()
    reviewBox.replaceChildren(...[
      C.miniPreview({
        title: d.customer_name || '—',
        chips: [
          { icon: 'layers', text: d.service_type || '—', title: `Layanan: ${d.service_type || '—'}` },
          d.location ? { icon: 'mapPin', text: d.location, title: `Lokasi: ${d.location}` } : null,
          d.phone ? { icon: 'phone', text: d.phone, title: `Telepon: ${d.phone}` } : null,
          d.email ? { icon: 'mail', text: d.email, title: `Email: ${d.email}` } : null,
          d.website ? { icon: 'compass', text: d.website, title: `Website / kontak lain: ${d.website}` } : null,
        ],
        note: d.description || 'Tanpa deskripsi kebutuhan.',
        noteLines: 4,
      }),
      d.description ? null : el('p', { className: 'wiz-pane-desc' }, 'Tip: deskripsi yang rinci membuat penawaran AI lebih akurat.'),
    ].filter(Boolean))
  }

  async function save() {
    const data = values()
    if (coords) Object.assign(data, coords)
    const restore = wiz.busy('Menyimpan…')
    try {
      const { data: created, error } = await getCloud().database.from('requests').insert(data)
      if (error) throw new Error(error.message)
      const row = Array.isArray(created) ? created[0] : created
      restore()
      const actions = []
      if (row?.id != null) {
        const next = C.button({ label: 'Buat penawaran', iconRight: 'arrowRight', size: 'sm', variant: 'primary' })
        next.addEventListener('click', () => navigate('offer', { requestId: row.id }))
        actions.push(next)
      }
      const again = C.button({ label: 'Catat permintaan lain', icon: 'plus', size: 'sm', variant: 'soft' })
      again.addEventListener('click', () => {
        for (const f of [name, location, phone, email, website, service, desc, hint]) f.input.value = ''
        fillStatus.textContent = ''
        coords = null
        pickedNote.hidden = true
        reviewBox.replaceChildren()
        wiz.reset()
      })
      actions.push(again)
      wiz.complete({ text: `Permintaan ${data.customer_name} tersimpan. Lanjutkan dengan membuat penawaran.`, actions })
      showToast('Permintaan baru tersimpan.', 'success')
      notifyDataChanged()
      await loadModel()
    } catch (err) {
      restore()
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    }
  }

  /* ---------------------------------------- Known services (AI hint) */
  let model = null
  async function loadModel() {
    try { model = await loadFlow(['requests']) } catch { /* only used for AI suggestions */ }
  }

  await loadModel()
}

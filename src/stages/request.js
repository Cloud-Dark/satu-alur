/** 01 — Permintaan: capture a customer request; list with derived status. */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})

  /* ------------------------------------------------------------- Form */
  const name = C.field({ label: 'Nama pelanggan', name: 'customer_name', required: true, placeholder: 'PT Maju Jaya', hint: 'Perusahaan atau perorangan yang meminta layanan.', attrs: { autocomplete: 'organization', maxlength: '120' } })
  const location = C.field({ label: 'Lokasi', name: 'location', placeholder: 'Jakarta Selatan', attrs: { autocomplete: 'address-level2', maxlength: '120' } })
  const phone = C.field({ label: 'Telepon', name: 'phone', type: 'tel', placeholder: '0812 3456 7890', attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: '32' } })
  const service = C.field({ label: 'Jenis layanan', name: 'service_type', required: true, placeholder: 'Pembersihan AC', hint: 'Satu layanan utama per permintaan.', attrs: { maxlength: '120' } })
  const desc = C.textarea({ label: 'Deskripsi kebutuhan', name: 'description', rows: 5, placeholder: 'Jumlah unit, luas area, waktu yang diinginkan…', hint: 'Semakin rinci, semakin akurat penawaran AI di tahap 02.', attrs: { maxlength: '2000' } })
  const reviewBox = el('div', { className: 'proposal' })

  const PHONE_RE = /^[+()\d\s.-]{6,32}$/
  const values = () => ({
    customer_name: name.input.value.trim(),
    service_type: service.input.value.trim(),
    location: location.input.value.trim(),
    phone: phone.input.value.trim(),
    description: desc.input.value.trim(),
  })
  const customerErrors = () => {
    const d = values()
    const errs = []
    if (!d.customer_name) errs.push({ text: 'Nama pelanggan wajib diisi.', input: name.input })
    if (d.phone && !PHONE_RE.test(d.phone)) errs.push({ text: 'Nomor telepon hanya boleh berisi angka, spasi, +, -, dan tanda kurung.', input: phone.input })
    return errs
  }
  const needErrors = () => (values().service_type ? [] : [{ text: 'Jenis layanan wajib diisi.', input: service.input }])

  const wiz = C.wizard({
    label: 'Permintaan baru',
    steps: [
      {
        key: 'customer',
        title: 'Pelanggan',
        description: 'Siapa yang meminta, dan di mana.',
        content: [name.wrap, el('div', { className: 'form-row keep-row' }, location.wrap, phone.wrap)],
        validate: customerErrors,
      },
      {
        key: 'need',
        title: 'Kebutuhan',
        description: 'Layanan yang diminta dan rinciannya.',
        content: [service.wrap, desc.wrap],
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

  const listBody = el('div', {}, C.skeletonRows(5))
  const search = el('input', { type: 'search', className: 'input input-sm', placeholder: 'Cari pelanggan atau layanan', 'aria-label': 'Cari permintaan' })
  const searchBox = el('label', { className: 'search-box' }, C.icon('search', { size: 16 }), search)
  const listPanel = C.panel({ title: 'Daftar permintaan', meta: 'memuat…', actions: searchBox, className: 'list-panel' }, listBody)

  container.replaceChildren(
    C.pageHeader({ num: '01', label: 'Permintaan', title: 'Permintaan masuk', em: 'masuk', description: 'Catat kebutuhan pelanggan. Status setiap permintaan mengikuti seberapa jauh ia sudah bergerak di alur.' }),
    el('div', { className: 'stage-grid has-wizard' }, wiz.root, listPanel),
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
        ],
        note: d.description || 'Tanpa deskripsi kebutuhan.',
        noteLines: 4,
      }),
      d.description ? null : el('p', { className: 'wiz-pane-desc' }, 'Tip: deskripsi yang rinci membuat penawaran AI lebih akurat.'),
    ].filter(Boolean))
  }

  async function save() {
    const data = values()
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
        for (const f of [name, location, phone, service, desc]) f.input.value = ''
        reviewBox.replaceChildren()
        wiz.reset()
      })
      actions.push(again)
      wiz.complete({ text: `Permintaan ${data.customer_name} tersimpan. Lanjutkan dengan membuat penawaran.`, actions })
      showToast('Permintaan baru tersimpan.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      msg.show('danger', `Gagal menyimpan: ${err.message}`)
    }
  }

  /* ------------------------------------------------------------- List */
  let model = null
  async function loadList() {
    try {
      model = await loadFlow(['requests', 'offers', 'assignments', 'completions', 'ledger_entries'])
    } catch (err) {
      listBody.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
    drawList()
  }

  function drawList() {
    const q = search.value.trim().toLowerCase()
    const rows = model.requests.filter((r) => !q || [r.customer_name, r.service_type, r.location].some((v) => String(v || '').toLowerCase().includes(q)))
    listPanel.querySelector('.panel-meta').textContent = q ? `${rows.length} dari ${model.requests.length} baris` : `${model.requests.length} baris`
    if (!model.requests.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada permintaan.', body: 'Isi formulir di samping untuk mencatat permintaan pertama.' }))
      return
    }
    if (!rows.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Tidak ditemukan', title: `Tidak ada yang cocok dengan "${search.value.trim()}".` }))
      return
    }
    listBody.replaceChildren(C.dataTable({
      caption: 'Daftar permintaan',
      rows,
      columns: [
        {
          label: 'Pelanggan',
          render: (r) => {
            const stack = C.cellStack(customerLabel(r), [r.service_type, r.location].filter(Boolean).join(' · '))
            stack.querySelector('.cell-primary').prepend(el('span', { className: 'cell-id tnum' }, `#${r.id}`))
            if (r.description) stack.appendChild(el('span', { className: 'cell-note', title: r.description }, r.description))
            if (r.phone) stack.appendChild(el('span', { className: 'cell-secondary tnum' }, r.phone))
            return stack
          },
        },
        { label: 'Status', render: (r) => { const s = model.requestStage(r); return C.tag(s.label, s.tone) } },
        { label: 'Masuk', className: 'col-date', render: (r) => el('time', { className: 'tnum', datetime: r.created_at, title: C.formatDateTime(r.created_at) }, C.formatDate(r.created_at)) },
        {
          label: 'Aksi',
          className: 'col-action',
          render: (r) => {
            if (model.offersOf(r.id).length) return el('span', { className: 'muted nil' }, '—')
            const b = C.button({ label: 'Tawarkan', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
            b.setAttribute('aria-label', `Buat penawaran untuk ${customerLabel(r)}`)
            b.addEventListener('click', () => navigate('offer', { requestId: r.id }))
            return b
          },
        },
      ],
    }))
  }
  search.addEventListener('input', () => model && drawList())

  await loadList()
}

import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListVouchers, adminCreateVoucher, adminUpdateVoucher, adminListRedemptions } from '../../quota/api.js'
import { adminListPlans } from '../../business/api.js'
import { validateVoucher, voucherValue, VOUCHER_TYPE_LABEL, MAX_VOUCHER_CREDIT, rupiah, todayWib } from '../../quota/rules.js'
import { LEAVE_MSG } from './site-doc.js'

const { el } = C
const TYPE_OPTIONS = Object.entries(VOUCHER_TYPE_LABEL).map(([value, label]) => ({ value, label }))
let seq = 0

function status(v, today) {
  if (!v.active) return C.tag('Nonaktif', 'neutral')
  if (v.expires_on && v.expires_on < today) return C.tag('Kedaluwarsa', 'warn')
  if (v.max_redemptions !== null && v.redeemed_count >= v.max_redemptions) return C.tag('Habis', 'warn')
  return C.tag('Aktif', 'ok')
}

function voucherDialog(plans, opener, onSaved, setDirty) {
  const id = ++seq
  const type = C.select({ label: 'Jenis voucher', id: `of-vc-type-${id}`, options: TYPE_OPTIONS, value: 'plan' })
  const code = C.field({ label: 'Kode', id: `of-vc-code-${id}`, hint: 'Kosongkan untuk kode otomatis (SATU-XXXX-XXXX).', attrs: { maxlength: '32', autocomplete: 'off', spellcheck: 'false' } })
  const plan = C.select({ label: 'Paket', id: `of-vc-plan-${id}`, options: plans.map((p) => ({ value: String(p.id), label: p.name })), value: String((plans.find((p) => p.slug === 'pro') || plans[0])?.id ?? '') })
  const days = C.field({ label: 'Durasi paket (hari)', id: `of-vc-days-${id}`, type: 'number', value: '30', attrs: { min: '1', max: '366', step: '1' } })
  const credit = C.field({ label: 'Saldo AI (Rp)', id: `of-vc-credit-${id}`, type: 'number', value: '50000', hint: `Maksimal ${rupiah(MAX_VOUCHER_CREDIT)}; lebih dari itu lewat tim.`, attrs: { min: '1000', step: '1000' } })
  const max = C.field({ label: 'Batas penukaran', id: `of-vc-max-${id}`, type: 'number', value: '20', hint: 'Kosong = tanpa batas.', attrs: { min: '1', step: '1' } })
  const exp = C.field({ label: 'Berlaku sampai', id: `of-vc-exp-${id}`, type: 'date', hint: 'Kosong = tanpa batas waktu.' })
  const note = C.field({ label: 'Catatan internal', id: `of-vc-note-${id}`, hint: 'Mis. "Soft launch Garuda Spark".', attrs: { maxlength: '200' } })
  const planRow = el('div', { className: 'form-row' }, plan.wrap, days.wrap)
  const err = el('p', { className: 'field-error', role: 'alert' })
  const sync = () => {
    planRow.hidden = type.input.value === 'credit'
    credit.wrap.hidden = type.input.value === 'plan'
  }
  type.input.addEventListener('change', sync)
  sync()

  const gather = () => ({
    type: type.input.value, code: code.input.value, plan_id: Number(plan.input.value), plan_days: Number(days.input.value),
    credit_idr: Number(credit.input.value), max_redemptions: max.input.value.trim() === '' ? null : Number(max.input.value),
    expires_on: exp.input.value || null, note: note.input.value,
  })
  const save = C.button({ label: 'Buat voucher', icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: 'Buat voucher', opener, actions: [cancel, save],
    description: 'Jenis dan nilai voucher tidak bisa diubah setelah dibuat. Status, batas, tanggal, dan catatan bisa.',
    children: [type.wrap, code.wrap, planRow, credit.wrap, el('div', { className: 'form-row' }, max.wrap, exp.wrap), note.wrap, err],
  })
  const base = JSON.stringify(gather())
  const dirty = () => JSON.stringify(gather()) !== base
  form.addEventListener('input', () => setDirty(dirty()))
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validateVoucher(gather(), plans.map((p) => p.id)) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      const v = await adminCreateVoucher(clean)
      close()
      showToast(`Voucher ${v.code} dibuat.`, 'success')
      onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  async function load() {
    const mine = ++run
    setDirty(false)
    host.replaceChildren(C.panel({ title: 'Voucher' }, C.skeletonRows(4)))
    let rows; let plans; let reds
    try {
      [rows, plans, reds] = await Promise.all([adminListVouchers(), adminListPlans(), adminListRedemptions()])
    } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', load)
      host.replaceChildren(C.panel({ title: 'Voucher' }, C.errorState(e.message), again))
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    const today = todayWib()
    const planName = (pid) => plans.find((p) => p.id === pid)?.name || 'Paket'
    const add = C.button({ label: 'Buat voucher', icon: 'plus', variant: 'primary', size: 'sm', disabled: !plans.length })
    add.addEventListener('click', () => voucherDialog(plans, add, () => { if (!ctx.signal.aborted) load() }, setDirty))

    const toggle = (v) => {
      const b = C.button({ label: v.active ? 'Nonaktifkan' : 'Aktifkan', variant: v.active ? 'ghost' : 'soft', size: 'sm', 'aria-label': `${v.active ? 'Nonaktifkan' : 'Aktifkan'} ${v.code}` })
      b.addEventListener('click', async () => {
        const restore = C.setBusy(b, 'Menyimpan…')
        try {
          await adminUpdateVoucher(v.id, { active: v.active ? 0 : 1 })
          showToast(v.active ? `Voucher ${v.code} dinonaktifkan.` : `Voucher ${v.code} aktif lagi.`, 'success')
          if (!ctx.signal.aborted) load()
        } catch (ex) { restore(); showToast(ex.message, 'error') }
      })
      return b
    }
    const list = rows.length
      ? C.dataTable({
        caption: 'Daftar voucher',
        columns: [
          { label: 'Kode', render: (v) => C.cellStack(el('span', { className: 'of-voucher-code' }, v.code), v.note || null) },
          { label: 'Jenis', render: (v) => VOUCHER_TYPE_LABEL[v.type] },
          { label: 'Nilai', render: (v) => voucherValue(v, planName) },
          { label: 'Ditukar', align: 'right', render: (v) => el('span', { className: 'tnum' }, `${v.redeemed_count}${v.max_redemptions !== null ? ` / ${v.max_redemptions}` : ''}`) },
          { label: 'Berlaku sampai', render: (v) => (v.expires_on ? C.formatDate(v.expires_on) : 'Tanpa batas') },
          { label: 'Status', render: (v) => status(v, today) },
          { label: 'Aksi', render: toggle },
        ],
        rows,
        rowAttrs: (v) => ({ dataset: { code: v.code } }),
      })
      : C.emptyState({ title: 'Belum ada voucher', body: 'Buat voucher paket, saldo AI, atau gabungan untuk peluncuran dan calon pelanggan.', iconName: 'sprout' })

    const redList = reds.length
      ? C.dataTable({
        caption: 'Penukaran voucher terbaru',
        columns: [
          { label: 'Waktu', render: (r) => C.formatDateTime(r.redeemed_at) },
          { label: 'Kode', render: (r) => el('span', { className: 'of-voucher-code' }, r.code) },
          { label: 'Pengguna', render: (r) => C.cellStack(r.name || r.email, r.name ? r.email : null) },
          { label: 'Usaha', render: (r) => C.cellStack(r.company || null, r.phone || null) },
          { label: 'Tindak lanjut', render: (r) => (r.email ? el('a', { className: 'btn btn-ghost btn-sm', href: `mailto:${r.email}?subject=${encodeURIComponent('Voucher Satu Alur')}` }, 'Email') : null) },
        ],
        rows: reds,
      })
      : C.emptyState({ title: 'Belum ada penukaran', body: 'Pengguna yang menukar voucher muncul di sini, lengkap dengan kontaknya.', iconName: 'inbox' })

    host.replaceChildren(
      C.panel({ title: 'Voucher', meta: `${rows.length} voucher`, actions: add },
        el('p', { className: 'muted small' }, 'Satu akun hanya bisa menukar satu kode sekali. Voucher saldo AI dibatasi agar biaya tetap terkendali; kebutuhan lebih besar diarahkan ke tim.'),
        list),
      C.panel({ title: 'Penukaran terbaru', meta: `${reds.length} penukaran` }, redList))
  }
  load()
}

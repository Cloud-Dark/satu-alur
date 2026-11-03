/**
 * Invoice: bill a finished job. List (paged, filter by status) + editor dialog
 * (lines qty × harga, diskon, PPN 11% opsional, tempo, cara pembayaran) and
 * actions: Unduh PDF / Cetak, kirim lewat email atau WhatsApp, Tandai lunas
 * (posts or links the job's revenue in Pembukuan, once).
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel } from './data.js'
import { STATUSES, statusLabel, computeTotals, invoiceProblems, canTransition, isEditable, addDays, todayLocal, invoiceText, PPN_RATE, LIMITS, lineAmount } from '../invoice/rules.js'
import { loadInvoices, loadItems, loadSettings, saveSettings, nextNumber, saveInvoice, setStatus, markPaid } from '../invoice/api.js'
import { printInvoice } from '../invoice/print.js'
import { openWaDialog } from '../ui/wa-dialog.js'
import { sendBusinessEmail } from '../integrations/api.js'
import { isDemoEmail } from '../auth/demo-accounts.js'
import { isEmail } from '../admin/constants.js'
import '../styles/invoice.css'

const { el } = C
const FILTERS = [{ value: 'all', label: 'Semua' }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]
const toneOf = (status) => STATUSES.find((s) => s.value === status)?.tone || 'neutral'
let currentFilter = 'all'
let seq = 0

export async function render(container, ctx = {}) {
  const params = ctx.params || {}
  const navigate = ctx.navigate || (() => {})
  const businessName = ctx.user?.name || 'Usaha Anda'
  const demo = isDemoEmail(ctx.user?.email)

  const status = C.message()
  const createBtn = C.button({ label: 'Buat invoice', icon: 'plus', variant: 'primary' })
  const settingsBtn = C.button({ label: 'Cara pembayaran', icon: 'settings', variant: 'soft' })
  const filter = C.segmented({ options: FILTERS, value: currentFilter, label: 'Saring status invoice', scroll: true, onChange: (v) => { currentFilter = v; drawList({ reset: true }) } })
  const kpis = el('div', { className: 'kpis kpis-3' })
  const listBody = el('div', {}, C.skeletonRows(5))
  const listPanel = C.panel({ title: 'Daftar invoice', meta: 'memuat…', className: 'list-panel' }, listBody)
  const pg = C.pager({ key: 'invoices', label: 'daftar invoice', onChange: () => drawList(), scrollTarget: listPanel })

  container.replaceChildren(
    C.pageHeader({ title: 'Invoice', actions: [settingsBtn, createBtn] }),
    status, kpis, filter, listPanel,
  )

  let flow = null
  let invoices = []
  let settings = null

  async function load() {
    try {
      ;[flow, invoices, settings] = await Promise.all([loadFlow(), loadInvoices(), loadSettings().catch(() => null)])
    } catch (err) {
      listBody.replaceChildren(C.errorState(`Gagal memuat invoice: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
    drawKpis()
    drawList()
  }

  function drawKpis() {
    const open = invoices.filter((i) => i.status === 'draft' || i.status === 'terkirim')
    const paid = invoices.filter((i) => i.status === 'lunas')
    const sum = (rows) => rows.reduce((s, i) => s + (Number(i.total) || 0), 0)
    const overdue = open.filter((i) => i.due_date && i.due_date < todayLocal())
    kpis.replaceChildren(
      C.kpi({ label: 'Belum dibayar', iconName: 'receipt', value: C.rupiah(sum(open)), sub: `${open.length} invoice` }),
      C.kpi({ label: 'Sudah lunas', iconName: 'wallet', value: C.rupiah(sum(paid)), sub: `${paid.length} invoice`, tone: paid.length ? 'ok' : null }),
      C.kpi({ label: 'Lewat jatuh tempo', iconName: 'alert', value: String(overdue.length), sub: overdue.length ? C.rupiah(sum(overdue)) : 'Tidak ada', tone: overdue.length ? 'danger' : null }),
    )
  }

  function drawList({ reset = false } = {}) {
    const rows = [...invoices]
      .filter((i) => currentFilter === 'all' || i.status === currentFilter)
      .sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)) || b.id - a.id)
    listPanel.querySelector('.panel-meta').textContent = `${invoices.length} invoice`
    if (!invoices.length) {
      const go = C.button({ label: 'Buat invoice pertama', icon: 'plus', variant: 'soft', onClick: () => openCreate() })
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Belum ada invoice.', body: 'Buat invoice dari pekerjaan yang sudah selesai, lalu kirim ke pelanggan.', iconName: 'receipt', action: go }))
      return
    }
    if (!rows.length) {
      listBody.replaceChildren(C.emptyState({ title: 'Tidak ada invoice dengan status ini.', iconName: 'receipt' }))
      return
    }
    listBody.replaceChildren(C.dataTable({
      caption: 'Daftar invoice',
      rows: pg.slice(rows, { resetKey: reset ? `${currentFilter}:${Date.now()}` : currentFilter }),
      columns: [
        { label: 'Invoice', render: (i) => C.cellStack(i.number, i.customer_name) },
        { label: 'Tanggal', className: 'col-date', render: (i) => C.cellStack(C.formatDate(i.issue_date), i.due_date ? `Tempo ${C.formatDate(i.due_date)}` : '') },
        { label: 'Total', align: 'right', render: (i) => el('span', { className: 'tnum strong' }, C.rupiah(i.total)) },
        { label: 'Status', render: (i) => C.tag(i.status !== 'lunas' && i.status !== 'batal' && i.due_date && i.due_date < todayLocal() ? 'Lewat tempo' : statusLabel(i.status), i.status !== 'lunas' && i.status !== 'batal' && i.due_date && i.due_date < todayLocal() ? 'danger' : toneOf(i.status)) },
        { label: 'Aksi', className: 'col-action', render: (i) => C.button({ label: 'Buka', iconRight: 'arrowRight', size: 'sm', variant: 'soft', onClick: (e) => openEditor(i, e.currentTarget) }) },
      ],
    }), pg.root)
  }

  /* ---------------------------------------------------------- create */
  const invoicedCompletions = () => new Set(invoices.filter((i) => i.status !== 'batal').map((i) => String(i.completion_id)))

  function openCreate(opener) {
    const done = flow?.completions || []
    if (!done.length) {
      status.show('info', 'Belum ada pekerjaan selesai. Tandai pekerjaan selesai di tahap 04 untuk membuat invoice.')
      return
    }
    const taken = invoicedCompletions()
    const label = (c) => `${customerLabel(flow.requestOfCompletion(c))} — ${C.rupiah(flow.offerOfCompletion(c)?.validated_price)}${taken.has(String(c.id)) ? ' (sudah ada invoice)' : ''}`
    const sorted = [...done].sort((a, b) => (taken.has(String(a.id)) - taken.has(String(b.id))) || String(b.completed_at || '').localeCompare(String(a.completed_at || '')))
    const pick = C.select({ label: 'Pekerjaan selesai', id: `inv-pick-${++seq}`, required: true, options: [{ value: '', label: 'Pilih pekerjaan' }, ...sorted.map((c) => ({ value: c.id, label: label(c) }))] })
    const err = el('p', { className: 'field-error', role: 'alert' })
    const next = C.button({ label: 'Lanjut', iconRight: 'arrowRight', variant: 'primary', type: 'submit' })
    const { form, close } = C.modal({ title: 'Buat invoice', description: 'Pilih pekerjaan yang ditagihkan. Rincian bisa diubah setelahnya.', opener, children: [pick.wrap, err], actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), next] })
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const c = flow.completion(pick.input.value)
      if (!c) { err.textContent = 'Pilih pekerjaan terlebih dahulu.'; return }
      close()
      openEditor(draftFor(c), opener)
    })
  }

  function draftFor(c) {
    const r = flow.requestOfCompletion(c)
    const o = flow.offerOfCompletion(c)
    const issue = todayLocal()
    return {
      completion_id: c.id, request_id: r?.id ?? null, number: '',
      customer_name: r?.customer_name || customerLabel(r), customer_phone: r?.phone || '', customer_email: '', customer_address: r?.location || '',
      issue_date: issue, due_date: addDays(issue, settings?.due_days ?? 14), discount: 0, tax_rate: 0,
      payment_info: settings?.payment_info || '', notes: '', status: 'draft',
      _items: [{ description: [r?.service_type, o?.validated_scope].filter(Boolean).join(' — ').slice(0, LIMITS.description) || 'Jasa', qty: 1, unit_price: Math.round(Number(o?.validated_price) || 0) }],
    }
  }

  /* ---------------------------------------------------------- editor */
  async function openEditor(inv, opener) {
    const id = ++seq
    let items = inv._items || (inv.id ? await loadItems(inv.id).catch(() => []) : [])
    items = items.map((it) => ({ description: it.description, qty: it.qty, unit_price: it.unit_price }))
    let current = { ...inv }
    delete current._items
    const editable = !current.id || isEditable(current.status)

    const f = (label, key, type = 'text', attrs = {}) => {
      const x = C.field({ label, id: `inv-${key}-${id}`, type, value: current[key] ?? '', attrs: { ...attrs, ...(editable ? {} : { readonly: true }) } })
      x.input.addEventListener('input', () => { current[key] = x.input.value; drawTotals() })
      return x
    }
    const name = f('Nama pelanggan', 'customer_name', 'text', { maxlength: '120' })
    const phone = f('No. WhatsApp', 'customer_phone', 'tel', { maxlength: '20', inputmode: 'tel' })
    const email = f('Email', 'customer_email', 'email', { maxlength: '254' })
    const addr = f('Alamat', 'customer_address', 'text', { maxlength: '200' })
    const issue = f('Tanggal invoice', 'issue_date', 'date')
    const due = f('Jatuh tempo', 'due_date', 'date')
    const disc = f('Diskon (Rp)', 'discount', 'number', { min: '0', step: '1', inputmode: 'numeric' })
    const ppn = el('input', { type: 'checkbox', id: `inv-ppn-${id}`, disabled: !editable })
    ppn.checked = Number(current.tax_rate) > 0
    ppn.addEventListener('change', () => { current.tax_rate = ppn.checked ? PPN_RATE : 0; drawTotals() })
    const ppnRow = el('label', { className: 'check-row', htmlFor: `inv-ppn-${id}` }, ppn, el('span', {}, `Tambahkan PPN ${PPN_RATE}%`))
    const pay = C.textarea({ label: 'Cara pembayaran', id: `inv-pay-${id}`, value: current.payment_info || '', rows: 3, hint: 'Misalnya rekening bank atau QRIS. Tersimpan sebagai bawaan untuk invoice berikutnya.', attrs: { maxlength: String(LIMITS.payment), ...(editable ? {} : { readonly: true }) } })
    pay.input.addEventListener('input', () => { current.payment_info = pay.input.value })
    const notes = C.textarea({ label: 'Catatan (opsional)', id: `inv-notes-${id}`, value: current.notes || '', rows: 2, attrs: { maxlength: String(LIMITS.notes), ...(editable ? {} : { readonly: true }) } })
    notes.input.addEventListener('input', () => { current.notes = notes.input.value })

    const linesHost = el('div', { className: 'inv-lines' })
    const addLine = C.button({ label: 'Tambah baris', icon: 'plus', size: 'sm', variant: 'soft', onClick: () => { items.push({ description: '', qty: 1, unit_price: 0 }); drawLines(); linesHost.querySelector('.inv-line:last-child input')?.focus() } })
    addLine.hidden = !editable
    const totalsBox = el('dl', { className: 'inv-totals' })

    function drawLines() {
      linesHost.replaceChildren(...items.map((it, i) => {
        const d = el('input', { className: 'input', value: it.description, placeholder: 'Keterangan', 'aria-label': `Keterangan baris ${i + 1}`, maxlength: String(LIMITS.description), readonly: !editable })
        const q = el('input', { className: 'input tnum', type: 'number', min: '0', step: 'any', value: String(it.qty), 'aria-label': `Jumlah baris ${i + 1}`, inputmode: 'decimal', readonly: !editable })
        const p = el('input', { className: 'input tnum', type: 'number', min: '0', step: '1', value: String(it.unit_price), 'aria-label': `Harga baris ${i + 1}`, inputmode: 'numeric', readonly: !editable })
        const amt = el('span', { className: 'inv-line-amt tnum' }, C.rupiah(lineAmount(it)))
        const sync = () => { it.description = d.value; it.qty = q.value; it.unit_price = p.value; amt.textContent = C.rupiah(lineAmount(it)); drawTotals() }
        ;[d, q, p].forEach((x) => x.addEventListener('input', sync))
        const del = C.button({ label: 'Hapus baris', icon: 'trash', size: 'sm', variant: 'ghost', className: 'icon-only', onClick: () => { items.splice(i, 1); drawLines(); drawTotals() } })
        del.hidden = !editable || items.length < 2
        return el('div', { className: 'inv-line' },
          el('div', { className: 'inv-line-desc' }, d),
          el('div', { className: 'inv-line-nums' },
            el('label', { className: 'inv-mini' }, el('span', {}, 'Jumlah'), q),
            el('label', { className: 'inv-mini' }, el('span', {}, 'Harga'), p),
            el('div', { className: 'inv-mini inv-mini-amt' }, el('span', {}, 'Subtotal'), amt),
            del))
      }))
    }
    function drawTotals() {
      const t = computeTotals(items, current)
      totalsBox.replaceChildren(
        el('div', {}, el('dt', {}, 'Subtotal'), el('dd', { className: 'tnum' }, C.rupiah(t.subtotal))),
        t.discount ? el('div', {}, el('dt', {}, 'Diskon'), el('dd', { className: 'tnum' }, `−${C.rupiah(t.discount)}`)) : '',
        t.tax_amount ? el('div', {}, el('dt', {}, `PPN ${PPN_RATE}%`), el('dd', { className: 'tnum' }, C.rupiah(t.tax_amount))) : '',
        el('div', { className: 'inv-grand' }, el('dt', {}, 'Total'), el('dd', { className: 'tnum' }, C.rupiah(t.total))),
      )
    }
    drawLines()
    drawTotals()

    const err = C.message()
    const showErr = (list) => (list.length ? err.show('danger', list.length > 1 ? 'Periksa kembali isian berikut.' : list[0], list.length > 1 ? list : undefined) : err.hide())
    const head = el('div', { className: 'inv-head' },
      el('strong', { className: 'inv-number' }, current.number || 'Nomor dibuat saat disimpan'),
      C.tag(statusLabel(current.status), toneOf(current.status)))

    const save = C.button({ label: current.id ? 'Simpan' : 'Simpan invoice', icon: 'check', variant: 'primary', type: 'submit' })
    save.hidden = !editable
    const pdf = C.button({ label: 'Unduh PDF', icon: 'download', variant: 'soft' })
    const more = el('div', { className: 'inv-actions' })
    const { form, close } = C.modal({
      title: current.id ? `Invoice ${current.number}` : 'Invoice baru', wide: true, opener,
      children: [head,
        el('div', { className: 'form-grid-2' }, name.wrap, phone.wrap, email.wrap, addr.wrap, issue.wrap, due.wrap),
        el('div', { className: 'field' }, el('span', { className: 'field-label' }, 'Rincian tagihan'), linesHost, addLine),
        el('div', { className: 'form-grid-2' }, disc.wrap, el('div', { className: 'field inv-ppn' }, ppnRow)),
        totalsBox, pay.wrap, notes.wrap, more, err],
      actions: [C.button({ label: 'Tutup', variant: 'ghost', dismiss: true }), pdf, save],
    })

    const persist = async () => {
      const problems = invoiceProblems(current, items)
      if (problems.length) { showErr(problems); return null }
      showErr([])
      if (!current.number) current.number = await nextNumber(Number(String(current.issue_date).slice(0, 4)) || new Date().getFullYear())
      const saved = await saveInvoice(current, items)
      current = { ...current, ...saved }
      if ((current.payment_info || '') !== (settings?.payment_info || '')) {
        await saveSettings(settings, { payment_info: current.payment_info, due_days: settings?.due_days ?? 14 }).catch(() => {})
        settings = await loadSettings().catch(() => settings)
      }
      return current
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const restore = C.setBusy(save, 'Menyimpan…')
      try {
        const saved = await persist()
        if (!saved) { restore(); return }
        showToast(`Invoice ${saved.number} tersimpan.`, 'success')
        close()
        await load()
        notifyDataChanged()
      } catch (ex) { restore(); showErr([ex.message]) }
    })
    pdf.addEventListener('click', async () => {
      try {
        // Print what is on screen; an editable invoice is saved first so it has its number.
        if (editable) { const s = await persist(); if (!s) return; drawMore() }
        const t = computeTotals(items, current)
        const okWin = printInvoice({ ...current, ...t }, items, { businessName, businessEmail: ctx.user?.email, demo })
        if (!okWin) showErr(['Browser memblokir jendela cetak. Izinkan pop-up untuk situs ini lalu coba lagi.'])
      } catch (ex) { showErr([ex.message]) }
    })

    // Actions that need a saved invoice.
    function drawMore() {
      more.replaceChildren()
      if (!current.id) return
      const wa = C.button({ label: 'Kirim WhatsApp', icon: 'send', size: 'sm', variant: 'soft' })
      wa.addEventListener('click', () => {
        const t = computeTotals(items, current)
        openWaDialog({ requestId: current.request_id, customer: current.customer_name, phone: current.customer_phone, kind: 'invoice', opener: wa, openSettings: ctx.openSettings,
          text: invoiceText({ ...current, ...t }, items, { businessName }), onSent: () => markSent() })
      })
      const mail = C.button({ label: 'Kirim email', icon: 'mail', size: 'sm', variant: 'soft' })
      mail.addEventListener('click', () => openEmail(mail))
      const paid = C.button({ label: 'Tandai lunas', icon: 'checkCircle', size: 'sm', variant: 'primary' })
      paid.addEventListener('click', async () => {
        if (!window.confirm(`Tandai ${current.number} lunas? Pendapatan pekerjaan ini akan tercatat di Pembukuan.`)) return
        const restore = C.setBusy(paid, 'Menyimpan…')
        try {
          const latest = await loadFlow()
          const plan = await markPaid(current, latest.ledger)
          showToast(plan.action === 'post' ? `Lunas. Pendapatan ${C.rupiah(plan.amount)} diposting ke Pembukuan.` : 'Lunas. Pendapatan pekerjaan ini sudah ada di Pembukuan.', 'success')
          close()
          await load()
          notifyDataChanged()
        } catch (ex) { restore(); showErr([ex.message]) }
      })
      const cancel = C.button({ label: 'Batalkan invoice', icon: 'x', size: 'sm', variant: 'ghost' })
      cancel.addEventListener('click', async () => {
        if (!window.confirm(`Batalkan ${current.number}?`)) return
        try { await setStatus(current, 'batal'); showToast('Invoice dibatalkan.', 'success'); close(); await load() } catch (ex) { showErr([ex.message]) }
      })
      const reopen = C.button({ label: 'Buka lagi sebagai draft', icon: 'refresh', size: 'sm', variant: 'soft' })
      reopen.addEventListener('click', async () => {
        try { await setStatus(current, 'draft'); close(); await load() } catch (ex) { showErr([ex.message]) }
      })
      const can = (to) => canTransition(current.status, to)
      more.append(...[
        current.status !== 'batal' ? wa : null,
        current.status !== 'batal' ? mail : null,
        can('lunas') ? paid : null,
        can('batal') ? cancel : null,
        current.status === 'batal' ? reopen : null,
      ].filter(Boolean))
      if (current.status === 'lunas') more.append(C.tag(`Lunas ${C.formatDate(current.paid_at)}`, 'ok'))
    }
    async function markSent() {
      if (current.status !== 'draft') return
      try { await setStatus(current, 'terkirim', { sent_at: new Date().toISOString() }); current.status = 'terkirim' } catch { /* keep draft */ }
    }
    function openEmail(btn) {
      const t = computeTotals(items, current)
      const to = C.field({ label: 'Email pelanggan', id: `inv-mail-${id}`, type: 'email', required: true, value: current.customer_email || '', attrs: { maxlength: '254' } })
      const subject = C.field({ label: 'Subjek', id: `inv-subj-${id}`, value: `Invoice ${current.number} dari ${businessName}`, attrs: { maxlength: '150' } })
      const body = C.textarea({ label: 'Isi email', id: `inv-body-${id}`, rows: 12, value: invoiceText({ ...current, ...t }, items, { businessName }), attrs: { maxlength: '10000' } })
      const e2 = el('p', { className: 'field-error', role: 'alert' })
      const send = C.button({ label: 'Kirim email', icon: 'mail', variant: 'primary', type: 'submit' })
      const dlg = C.modal({ title: 'Kirim invoice lewat email', description: 'Periksa penerima dan isinya. Email baru terkirim setelah Anda menekan Kirim.', opener: btn, wide: true,
        children: [to.wrap, subject.wrap, body.wrap, e2], actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), send] })
      dlg.form.addEventListener('submit', async (ev) => {
        ev.preventDefault()
        const addr = to.input.value.trim()
        if (!isEmail(addr)) { e2.textContent = 'Isi email pelanggan yang valid.'; return }
        const restore = C.setBusy(send, 'Mengirim…')
        try {
          const r = await sendBusinessEmail({ kind: 'invoice', to: addr, subject: subject.input.value, body: body.input.value })
          showToast(r.simulated ? 'Simulasi: email tidak dikirim dari akun demo.' : `Invoice terkirim ke ${r.to}.`, 'success')
          dlg.close()
          await markSent()
        } catch (ex) { e2.textContent = ex.message } finally { restore() }
      })
    }
    drawMore()
  }

  /* ---------------------------------------------------------- settings */
  function openSettingsDialog(opener) {
    const pay = C.textarea({ label: 'Cara pembayaran bawaan', id: `inv-set-pay-${++seq}`, value: settings?.payment_info || '', rows: 4, hint: 'Contoh: Transfer BCA 1234567890 a.n. Nama Usaha.', attrs: { maxlength: String(LIMITS.payment) } })
    const days = C.field({ label: 'Tempo bawaan (hari)', id: `inv-set-days-${seq}`, type: 'number', value: String(settings?.due_days ?? 14), attrs: { min: '0', max: '120', step: '1' } })
    const err = el('p', { className: 'field-error', role: 'alert' })
    const save = C.button({ label: 'Simpan', icon: 'check', variant: 'primary', type: 'submit' })
    const { form, close } = C.modal({ title: 'Cara pembayaran', description: 'Dipakai otomatis di invoice baru.', opener, children: [pay.wrap, days.wrap, err], actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), save] })
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const d = Number(days.input.value)
      if (!Number.isInteger(d) || d < 0 || d > 120) { err.textContent = 'Tempo 0–120 hari.'; return }
      const restore = C.setBusy(save, 'Menyimpan…')
      try { await saveSettings(settings, { payment_info: pay.input.value.trim(), due_days: d }); settings = await loadSettings(); showToast('Tersimpan.', 'success'); close() } catch (ex) { restore(); err.textContent = ex.message }
    })
  }

  createBtn.addEventListener('click', () => openCreate(createBtn))
  settingsBtn.addEventListener('click', () => openSettingsDialog(settingsBtn))

  await load()
  // Opened from Penyelesaian / Pembukuan: start an invoice for that job, or open its invoice.
  if (params.completionId != null && flow) {
    const existing = invoices.find((i) => String(i.completion_id) === String(params.completionId) && i.status !== 'batal')
    const c = flow.completion(params.completionId)
    if (existing) openEditor(existing)
    else if (c) openEditor(draftFor(c))
  }
}

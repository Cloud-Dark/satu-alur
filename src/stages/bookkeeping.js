/** 05 — Pembukuan: post revenue and cost entries per completed job. */
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadFlow, notifyDataChanged, customerLabel, LEDGER_CATEGORIES, categoryLabel, isRevenue, ledgerDate, totals } from './data.js'

const { el } = C

export async function render(container, ctx = {}) {
  const navigate = ctx.navigate || (() => {})
  const params = ctx.params || {}

  const complSel = C.select({ label: 'Pekerjaan selesai', name: 'completion_id', required: true, hint: 'Satu pekerjaan boleh punya beberapa jurnal: pendapatan dan biaya-biayanya.', options: [{ value: '', label: 'Memuat…' }] })
  const preview = el('div', { hidden: true })
  const ctxBox = el('div', {})
  const category = C.select({ label: 'Kategori', name: 'category', required: true, options: [{ value: '', label: 'Pilih kategori' }, ...LEDGER_CATEGORIES] })
  const amount = C.field({ label: 'Jumlah (Rp)', name: 'amount', type: 'number', required: true, placeholder: '1500000', attrs: { min: '1', step: '1', inputmode: 'numeric' } })
  // Optional link to a VAS catalog item: this is what makes "Porsi VAS" measurable
  // instead of a guess. Only revenue entries can carry it.
  const vasSel = C.select({
    label: 'Layanan tambahan (opsional)', name: 'vas_item_id',
    hint: 'Tandai bila pendapatan ini berasal dari item di menu Layanan tambahan.',
    options: [{ value: '', label: 'Bukan layanan tambahan' }],
  })
  vasSel.wrap.hidden = true
  let vasItems = null
  async function ensureVasOptions() {
    if (vasItems) return
    const { data, error } = await getCloud().database.from('vas_items').select('id,name,status')
    if (error) { msg.show('danger', `Gagal memuat layanan tambahan: ${error.message}`); return }
    if (ctx.signal?.aborted) return
    vasItems = (data || []).filter((v) => v.status === 'active')
    C.setOptions(vasSel.input, [
      { value: '', label: 'Bukan layanan tambahan' },
      ...vasItems.map((v) => ({ value: v.id, label: v.name })),
    ], vasSel.input.value)
  }
  const fillBtn = el('button', { type: 'button', className: 'link-btn', hidden: true }, '')
  amount.wrap.appendChild(fillBtn)
  const reviewBox = el('div', { className: 'proposal' })

  const summary = el('div', { className: 'kpis kpis-3' })
  const listBody = el('div', {}, C.skeletonRows(6))
  const listPanel = C.panel({ title: 'Buku besar', meta: 'memuat…', className: 'list-panel' }, summary, listBody)
  const pg = C.pager({ key: 'ledger', label: 'buku besar', onChange: () => drawList(), scrollTarget: () => listBody })

  let flow = null
  const selected = () => flow?.completion(complSel.input.value) || null
  const amountValue = () => Number(amount.input.value)
  // One revenue entry per completion; costs can be posted as many times as needed.
  const revenueTaken = () => {
    const c = selected()
    return Boolean(c && category.input.value === 'pendapatan' && flow?.ledgerOf(c.id).some(isRevenue))
  }

  const wiz = C.wizard({
    label: 'Posting jurnal',
    steps: [
      {
        key: 'pick',
        title: 'Pilih pekerjaan',
        description: 'Pekerjaan selesai yang akan dibukukan.',
        content: [complSel.wrap, preview],
        validate: () => (selected() ? [] : [{ text: 'Pilih pekerjaan selesai.', input: complSel.input }]),
        primary: () => ({ disabled: !flow?.completions.length }),
      },
      {
        key: 'entry',
        title: 'Jurnal',
        description: 'Pendapatan atau biaya, beserta jumlahnya.',
        content: [ctxBox, category.wrap, vasSel.wrap, amount.wrap],
        validate: () => {
          const errs = []
          if (!category.input.value) errs.push({ text: 'Pilih kategori.', input: category.input })
          const amt = amountValue()
          if (!amount.input.value || !Number.isFinite(amt) || amt <= 0) errs.push({ text: 'Jumlah harus angka lebih dari nol.', input: amount.input })
          if (revenueTaken()) errs.push({ text: 'Pendapatan pekerjaan ini sudah diposting. Pilih kategori biaya, atau pekerjaan lain.', input: category.input })
          return errs
        },
        onEnter: () => drawContext(),
      },
      {
        key: 'review',
        title: 'Tinjau',
        description: 'Periksa jurnal sebelum diposting.',
        content: reviewBox,
        primary: { label: 'Posting jurnal', icon: 'ledger', iconRight: undefined },
        validate: () => {
          const errs = []
          if (!selected()) errs.push('Pilih pekerjaan selesai.')
          if (!category.input.value) errs.push('Pilih kategori.')
          if (!(amountValue() > 0)) errs.push('Jumlah harus angka lebih dari nol.')
          if (revenueTaken()) errs.push('Pendapatan pekerjaan ini sudah diposting.')
          return errs
        },
        onPrimary: () => save(),
        onEnter: () => drawReview(),
      },
    ],
  })
  const msg = wiz.msg

  container.replaceChildren(
    C.pageHeader({ title: 'Pembukuan & saldo' }),
    el('div', { className: 'stage-grid has-wizard' }, wiz.root, listPanel),
  )

  const offerPrice = (c) => Number(flow?.offerOfCompletion(c)?.validated_price) || 0

  const completionPreview = (c) => {
    const n = flow.ledgerOf(c.id).length
    const a = flow.assignmentOfCompletion(c)
    return C.miniPreview({
      title: customerLabel(flow.requestOfCompletion(c)),
      aside: C.rupiah(offerPrice(c)),
      chips: [
        a?.worker_name ? { icon: 'users', text: a.worker_name } : null,
        { icon: 'calendar', text: C.formatDate(c.completed_at || c.created_at), title: 'Tanggal selesai' },
        { icon: 'ledger', text: n ? `${n} jurnal` : 'Belum dibukukan' },
      ],
    })
  }

  function syncFill() {
    const c = selected()
    const price = c ? offerPrice(c) : 0
    if (c && price && category.input.value === 'pendapatan') {
      fillBtn.textContent = `Isi nilai penawaran ${C.rupiah(price)}`
      fillBtn.hidden = false
    } else {
      fillBtn.hidden = true
    }
  }
  fillBtn.addEventListener('click', () => {
    const c = selected()
    if (c) {
      amount.input.value = String(offerPrice(c))
      amount.input.dispatchEvent(new Event('input'))
      amount.input.focus()
    }
  })
  complSel.input.addEventListener('change', () => { msg.hide(); syncFill(); showPreview() })
  category.input.addEventListener('change', () => {
    syncFill()
    const revenue = category.input.value === 'pendapatan'
    vasSel.wrap.hidden = !revenue
    if (revenue) ensureVasOptions()
    else vasSel.input.value = ''
    if (revenue && !amount.input.value) {
      const c = selected()
      if (c && offerPrice(c)) amount.input.value = String(offerPrice(c))
    }
  })

  function showPreview() {
    const c = selected()
    if (!c) { preview.hidden = true; return }
    preview.replaceChildren(completionPreview(c))
    preview.hidden = false
  }

  function drawContext() {
    const c = selected()
    ctxBox.replaceChildren(c ? completionPreview(c) : '')
    syncFill()
  }

  function drawReview() {
    const c = selected()
    if (!c) { reviewBox.replaceChildren(); return }
    const rev = isRevenue({ category: category.input.value })
    const amt = amountValue()
    reviewBox.replaceChildren(
      el('dl', { className: 'sum-grid' },
        el('div', { className: 'is-wide' }, el('dt', {}, 'Pekerjaan'), el('dd', {}, customerLabel(flow.requestOfCompletion(c)))),
        el('div', {}, el('dt', {}, 'Kategori'), el('dd', {}, categoryLabel(category.input.value))),
        el('div', {}, el('dt', {}, rev ? 'Masuk' : 'Keluar'), el('dd', {}, el('span', { className: `tnum strong ${rev ? 'amt-in' : 'amt-out'}` }, `${rev ? '+' : '−'}${C.rupiah(amt)}`))),
        el('div', {}, el('dt', {}, 'Nilai penawaran'), el('dd', {}, el('span', { className: 'tnum' }, C.rupiah(offerPrice(c))))),
        el('div', {}, el('dt', {}, 'Jurnal sebelumnya'), el('dd', {}, String(flow.ledgerOf(c.id).length))),
      ),
    )
  }

  let firstFill = true
  function fillCompletions() {
    const all = [...flow.completions]
    const unbooked = all.filter((c) => !flow.ledgerOf(c.id).length)
    const booked = all.filter((c) => flow.ledgerOf(c.id).length)
    const label = (c) => `${customerLabel(flow.requestOfCompletion(c))} — ${C.rupiah(offerPrice(c))}`
    const opts = [{ value: '', label: all.length ? 'Pilih pekerjaan' : 'Belum ada pekerjaan selesai' }]
    unbooked.forEach((c) => opts.push({ value: c.id, label: label(c) }))
    booked.forEach((c) => opts.push({ value: c.id, label: `${label(c)} (${flow.ledgerOf(c.id).length} jurnal)` }))
    const keep = complSel.input.value || (firstFill && params.completionId != null ? String(params.completionId) : '')
    C.setOptions(complSel.input, opts, keep)
    if (!all.length && wiz.index === 0 && !wiz.done) {
      msg.show('info', 'Belum ada pekerjaan selesai. Tandai pekerjaan selesai di tahap 04 terlebih dahulu.')
      const go = C.button({ label: 'Ke penyelesaian', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('complete'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    syncFill()
    showPreview()
    wiz.syncPrimary()
    if (firstFill && params.completionId != null && selected()) wiz.go('entry', { focus: false, animate: false })
    firstFill = false
  }

  async function save() {
    const c = selected()
    const amt = amountValue()
    const restore = wiz.busy('Memposting…')
    try {
      const { error } = await getCloud().database.from('ledger_entries').insert({
        completion_id: Number(c.id),
        vas_item_id: category.input.value === 'pendapatan' && vasSel.input.value ? Number(vasSel.input.value) : null,
        amount: Math.round(amt),
        category: category.input.value,
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      restore()
      const catText = categoryLabel(category.input.value)
      const clearEntry = () => {
        amount.input.value = ''
        category.input.value = ''
        category.input.dispatchEvent(new Event('change'))
      }
      const more = C.button({ label: 'Tambah jurnal', icon: 'plus', size: 'sm', variant: 'primary' })
      more.addEventListener('click', () => { clearEntry(); wiz.reset({ to: 1 }) })
      const other = C.button({ label: 'Pekerjaan lain', icon: 'refresh', size: 'sm', variant: 'soft' })
      other.addEventListener('click', () => {
        clearEntry()
        complSel.input.value = ''
        complSel.input.dispatchEvent(new Event('change'))
        wiz.reset()
      })
      const report = C.button({ label: 'Lihat laporan', iconRight: 'arrowRight', size: 'sm', variant: 'ghost' })
      report.addEventListener('click', () => navigate('report'))
      wiz.complete({ text: `${catText} ${C.rupiah(amt)} untuk ${customerLabel(flow.requestOfCompletion(c))} diposting.`, actions: [more, other, report] })
      showToast('Jurnal diposting.', 'success')
      notifyDataChanged()
      await loadList()
    } catch (err) {
      restore()
      msg.show('danger', `Gagal memposting: ${err.message}`)
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
    fillCompletions()
    drawList()
  }

  function drawList() {

    const t = totals(flow.ledger)
    summary.replaceChildren(
      C.kpi({ label: 'Pendapatan', iconName: 'wallet', value: C.rupiah(t.revenue) }),
      C.kpi({ label: 'Biaya', iconName: 'receipt', value: C.rupiah(t.cost) }),
      C.kpi({ label: t.profit >= 0 ? 'Laba' : 'Rugi', iconName: 'sprout', value: C.rupiah(t.profit), sub: t.revenue > 0 ? `Margin ${((t.profit / t.revenue) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : 'Margin —', tone: t.revenue > 0 ? (t.profit >= 0 ? 'ok' : 'danger') : null }),
    )
    listPanel.querySelector('.panel-meta').textContent = `${flow.ledger.length} jurnal`

    if (!flow.ledger.length) {
      listBody.replaceChildren(C.emptyState({ kicker: 'Belum ada data', title: 'Buku besar masih kosong.', body: 'Jurnal pertama akan muncul di sini beserta saldo berjalan.' }))
      return
    }
    // Running balance, oldest first; displayed newest first.
    const asc = [...flow.ledger].sort((a, b) => (C.toDate(ledgerDate(a)) || 0) - (C.toDate(ledgerDate(b)) || 0) || (Number(a.id) - Number(b.id)))
    let bal = 0
    const balance = new Map()
    for (const l of asc) {
      bal += isRevenue(l) ? Number(l.amount) || 0 : -(Number(l.amount) || 0)
      balance.set(l, bal)
    }
    const rows = asc.reverse()
    listBody.replaceChildren(C.dataTable({
      caption: 'Buku besar',
      rows: pg.slice(rows),
      columns: [
        { label: 'Tanggal', className: 'col-date', render: (l) => el('time', { className: 'tnum', datetime: ledgerDate(l) || '', title: C.formatDateTime(ledgerDate(l)) }, C.formatDate(ledgerDate(l))) },
        { label: 'Keterangan', render: (l) => C.cellStack(customerLabel(flow.requestOfLedger(l)), categoryLabel(l.category)) },
        { label: 'Masuk', align: 'right', render: (l) => (isRevenue(l) ? el('span', { className: 'tnum amt-in' }, `+${C.rupiah(l.amount)}`) : el('span', { className: 'muted nil' }, '—')) },
        { label: 'Keluar', align: 'right', render: (l) => (!isRevenue(l) ? el('span', { className: 'tnum amt-out' }, `−${C.rupiah(l.amount)}`) : el('span', { className: 'muted nil' }, '—')) },
        { label: 'Saldo', align: 'right', render: (l) => { const b = balance.get(l); return el('span', { className: `tnum strong ${b < 0 ? 'amt-neg' : ''}` }, C.rupiah(b)) } },
      ],
    }), pg.root)
  }

  await loadList()
}

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
  const category = C.select({ label: 'Kategori', name: 'category', required: true, options: [{ value: '', label: 'Pilih kategori' }, ...LEDGER_CATEGORIES] })
  const amount = C.field({ label: 'Jumlah (Rp)', name: 'amount', type: 'number', required: true, placeholder: '1500000', attrs: { min: '1', step: '1', inputmode: 'numeric' } })
  const fillBtn = el('button', { type: 'button', className: 'link-btn', hidden: true }, '')
  amount.wrap.appendChild(fillBtn)
  const submit = C.button({ label: 'Posting jurnal', icon: 'ledger', variant: 'primary', type: 'submit' })
  const msg = C.message()

  const form = el('form', { className: 'form' },
    complSel.wrap,
    el('div', { className: 'form-row' }, category.wrap, amount.wrap),
    el('div', { className: 'form-actions' }, submit),
    msg,
  )
  form.noValidate = true

  const summary = el('div', { className: 'kpis kpis-3' })
  const listBody = el('div', {}, C.skeletonRows(6))
  const listPanel = C.panel({ title: 'Buku besar', meta: 'memuat…', className: 'list-panel' }, summary, listBody)

  container.replaceChildren(
    C.pageHeader({ num: '05', label: 'Pembukuan', title: 'Pembukuan & saldo', em: 'saldo', description: 'Catat pendapatan dan biaya dari setiap pekerjaan selesai. Saldo dihitung berjalan dari jurnal tertua.' }),
    el('div', { className: 'stage-grid' },
      C.panel({ title: 'Posting jurnal', meta: 'Pendapatan atau biaya', raised: true, className: 'form-panel' }, form),
      listPanel,
    ),
  )

  let flow = null

  const offerPrice = (c) => Number(flow?.offerOfCompletion(c)?.validated_price) || 0

  function syncFill() {
    const c = flow?.completion(complSel.input.value)
    const price = c ? offerPrice(c) : 0
    if (c && price && category.input.value === 'pendapatan') {
      fillBtn.textContent = `Isi nilai penawaran ${C.rupiah(price)}`
      fillBtn.hidden = false
    } else {
      fillBtn.hidden = true
    }
  }
  fillBtn.addEventListener('click', () => {
    const c = flow?.completion(complSel.input.value)
    if (c) { amount.input.value = String(offerPrice(c)); amount.input.focus() }
  })
  complSel.input.addEventListener('change', () => { msg.hide(); syncFill() })
  category.input.addEventListener('change', () => {
    syncFill()
    if (category.input.value === 'pendapatan' && !amount.input.value) {
      const c = flow?.completion(complSel.input.value)
      if (c && offerPrice(c)) amount.input.value = String(offerPrice(c))
    }
  })

  function fillCompletions() {
    const all = [...flow.completions]
    const unbooked = all.filter((c) => !flow.ledgerOf(c.id).length)
    const booked = all.filter((c) => flow.ledgerOf(c.id).length)
    const label = (c) => `${customerLabel(flow.requestOfCompletion(c))} — ${C.rupiah(offerPrice(c))}`
    const opts = [{ value: '', label: all.length ? 'Pilih pekerjaan' : 'Belum ada pekerjaan selesai' }]
    unbooked.forEach((c) => opts.push({ value: c.id, label: label(c) }))
    booked.forEach((c) => opts.push({ value: c.id, label: `${label(c)} (${flow.ledgerOf(c.id).length} jurnal)` }))
    const keep = complSel.input.value || (params.completionId != null ? String(params.completionId) : '')
    C.setOptions(complSel.input, opts, keep)
    submit.disabled = !all.length
    if (!all.length) {
      msg.show('info', 'Belum ada pekerjaan selesai. Tandai pekerjaan selesai di tahap 04 terlebih dahulu.')
      const go = C.button({ label: 'Ke penyelesaian', iconRight: 'arrowRight', size: 'sm' })
      go.addEventListener('click', () => navigate('complete'))
      msg.querySelector('.note-body').appendChild(el('div', { className: 'note-actions' }, go))
    }
    syncFill()
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.hide()
    const c = flow?.completion(complSel.input.value)
    const amt = Number(amount.input.value)
    const errors = []
    if (!c) errors.push('Pilih pekerjaan selesai.')
    if (!category.input.value) errors.push('Pilih kategori.')
    if (!amount.input.value || !Number.isFinite(amt) || amt <= 0) errors.push('Jumlah harus angka lebih dari nol.')
    if (errors.length) {
      msg.show('danger', 'Periksa kembali isian berikut.', errors)
      ;(!c ? complSel.input : !category.input.value ? category.input : amount.input).focus()
      return
    }
    const restore = C.setBusy(submit, 'Memposting…')
    try {
      const { error } = await getCloud().database.from('ledger_entries').insert({
        completion_id: Number(c.id),
        amount: Math.round(amt),
        category: category.input.value,
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      const catText = categoryLabel(category.input.value)
      msg.show('ok', `${catText} ${C.rupiah(amt)} untuk ${customerLabel(flow.requestOfCompletion(c))} diposting.`)
      amount.input.value = ''
      category.input.value = ''
      showToast('Jurnal diposting.', 'success')
      notifyDataChanged()
      await loadList({ keepMessage: true })
    } catch (err) {
      msg.show('danger', `Gagal memposting: ${err.message}`)
    } finally {
      restore()
    }
  })

  async function loadList({ keepMessage = false } = {}) {
    try {
      flow = await loadFlow()
    } catch (err) {
      listBody.replaceChildren(C.errorState(`Gagal memuat: ${err.message}`))
      return
    }
    if (ctx.signal?.aborted) return
    const saved = keepMessage && !msg.hidden ? { cls: msg.className, nodes: Array.from(msg.childNodes) } : null
    fillCompletions()
    if (saved) { msg.className = saved.cls; msg.replaceChildren(...saved.nodes); msg.hidden = false }

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
      rows,
      columns: [
        { label: 'Tanggal', className: 'col-date', render: (l) => el('time', { className: 'tnum', datetime: ledgerDate(l) || '', title: C.formatDateTime(ledgerDate(l)) }, C.formatDate(ledgerDate(l))) },
        { label: 'Keterangan', render: (l) => C.cellStack(customerLabel(flow.requestOfLedger(l)), categoryLabel(l.category)) },
        { label: 'Masuk', align: 'right', render: (l) => (isRevenue(l) ? el('span', { className: 'tnum amt-in' }, `+${C.rupiah(l.amount)}`) : el('span', { className: 'muted nil' }, '—')) },
        { label: 'Keluar', align: 'right', render: (l) => (!isRevenue(l) ? el('span', { className: 'tnum amt-out' }, `−${C.rupiah(l.amount)}`) : el('span', { className: 'muted nil' }, '—')) },
        { label: 'Saldo', align: 'right', render: (l) => { const b = balance.get(l); return el('span', { className: `tnum strong ${b < 0 ? 'amt-neg' : ''}` }, C.rupiah(b)) } },
      ],
    }))
  }

  await loadList()
}

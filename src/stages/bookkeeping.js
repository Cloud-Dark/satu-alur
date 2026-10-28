import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { showToast, animateEntrance } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

  let completions = []
  try {
    const cloud = getCloud()
    const { data } = await cloud.database.from('completions')
      .select('*')
      .eq('status', 'done')
      .order('created_at', { ascending: false })
    completions = data || []
  } catch (err) {
    container.appendChild(Components.el('p', { style: 'color:var(--danger)' }, 'Gagal memuat: ' + err.message))
    return
  }

  if (completions.length === 0) {
    container.appendChild(Components.el('p', { style: 'color:var(--text-muted);padding:20px;' }, 'Tidak ada pekerjaan selesai. Selesaikan pekerjaan di tahap sebelumnya.'))
    return
  }

  const cloud = getCloud()

  // Build select options
  const selectOptions = [{ value: '', label: '-- Pilih penyelesaian --' }]
  for (const c of completions) {
    const assignRes = await cloud.database.from('assignments').select('offer_id').eq('id', c.assignment_id).maybeSingle()
    const offerRes = assignRes.data?.offer_id ? await cloud.database.from('offers').select('request_id,validated_price').eq('id', assignRes.data.offer_id).maybeSingle() : { data: null }
    const reqRes = offerRes.data?.request_id ? await cloud.database.from('requests').select('customer_name').eq('id', offerRes.data.request_id).maybeSingle() : { data: null }
    const label = `${reqRes.data?.customer_name || 'Pelanggan'} \u2014 Rp${Number(offerRes.data?.validated_price || 0).toLocaleString('id-ID')}`
    selectOptions.push({ value: String(c.id), label })
  }

  const formCard = Components.el('div', { className: 'form-card card-accent-sand' },
    Components.el('h3', { className: 'form-title' }, '\ud83d\udcca Posting Jurnal Keuangan'),
    Components.el('p', { className: 'form-subtitle' }, 'Catat transaksi keuangan dari setiap penyelesaian pekerjaan ke buku besar.')
  )

  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const postBtn = Components.el('button', { type: 'button' }, '\ud83d\udccc Posting Jurnal')

  const compSelect = Components.selectField({
    label: 'Penyelesaian',
    id: 'completion_id',
    required: true,
    options: selectOptions,
  })

  const amountGroup = Components.inputField({
    label: 'Jumlah (Rp)',
    type: 'number',
    id: 'ledger_amount',
    placeholder: 'Contoh: 1500000',
    required: true,
  })

  const categoryGroup = Components.selectField({
    label: 'Kategori',
    id: 'ledger_category',
    required: true,
    options: [
      { value: '', label: '-- Pilih kategori --' },
      { value: 'pendapatan', label: 'Pendapatan' },
      { value: 'biaya_tenaga', label: 'Biaya Tenaga Kerja' },
      { value: 'biaya_bahan', label: 'Biaya Bahan / Material' },
      { value: 'biaya_transport', label: 'Biaya Transportasi' },
      { value: 'biaya_lain', label: 'Biaya Lain-lain' },
    ],
  })

  const form = Components.el('form', { id: 'ledger-form' },
    compSelect,
    amountGroup,
    categoryGroup,
    Components.el('div', { className: 'form-actions' }, postBtn),
    msg
  )

  formCard.appendChild(form)

  const listCard = Components.section('\ud83d\udccb Daftar Jurnal',
    Components.el('div', { id: 'ledger-list' }, Components.skeleton({ type: 'text', lines: 4 }))
  )
  listCard.classList.add('card-accent-brown')

  container.appendChild(formCard)
  container.appendChild(listCard)

  animateEntrance(formCard, 0)
  animateEntrance(listCard, 100)

  postBtn.addEventListener('click', async () => {
    msg.style.display = 'none'
    const compEl = form.querySelector('#completion_id')
    const amountEl = form.querySelector('#ledger_amount')
    const catEl = form.querySelector('#ledger_category')

    if (!compEl.value) { msg.className = 'form-message error'; msg.textContent = 'Pilih penyelesaian.'; msg.style.display = 'block'; return }
    if (!amountEl.value) { msg.className = 'form-message error'; msg.textContent = 'Isi jumlah.'; msg.style.display = 'block'; return }
    if (!catEl.value) { msg.className = 'form-message error'; msg.textContent = 'Pilih kategori.'; msg.style.display = 'block'; return }

    try {
      const { error } = await cloud.database.from('ledger_entries').insert({
        completion_id: Number(compEl.value),
        amount: Number(amountEl.value),
        category: catEl.value,
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      msg.className = 'form-message success'
      msg.textContent = '\u2705 Jurnal berhasil diposting.'
      msg.style.display = 'block'
      amountEl.value = ''
      catEl.value = ''
      showToast('Jurnal berhasil diposting!', 'success')
      await loadList()
    } catch (err) {
      msg.className = 'form-message error'
      msg.textContent = err.message
      msg.style.display = 'block'
    }
  })

  async function loadList() {
    const el = container.querySelector('#ledger-list')
    if (!el) return
    el.innerHTML = ''
    el.appendChild(Components.skeleton({ type: 'text', lines: 4 }))

    try {
      const { data, error } = await cloud.database.from('ledger_entries')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted)">Belum ada jurnal.</p>'
        return
      }
      el.innerHTML = ''
      let totalPendapatan = 0
      let totalBiaya = 0

      data.forEach(l => {
        if (l.category === 'pendapatan') totalPendapatan += Number(l.amount)
        else totalBiaya += Number(l.amount)
      })
      const laba = totalPendapatan - totalBiaya

      // Stats grid
      const statsGrid = Components.el('div', { className: 'stats-grid' },
        Components.statCard({
          label: 'Total Pendapatan',
          value: `Rp${totalPendapatan.toLocaleString('id-ID')}`,
          variant: 'olive',
        }),
        Components.statCard({
          label: 'Total Biaya',
          value: `Rp${totalBiaya.toLocaleString('id-ID')}`,
          variant: 'terracotta',
        }),
        Components.statCard({
          label: 'Laba / Rugi',
          value: `Rp${laba.toLocaleString('id-ID')}`,
          variant: 'orange',
          delta: laba >= 0 ? '\ud83d\udcc8 Profit' : '\ud83d\udcc9 Loss',
          deltaType: laba >= 0 ? 'positive' : 'negative',
        })
      )
      el.appendChild(statsGrid)
      animateEntrance(statsGrid)

      // Ledger items
      data.forEach((l, i) => {
        const isIncome = l.category === 'pendapatan'
        const card = Components.el('div', { className: 'card', style: 'margin-bottom:10px;' },
          Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
            Components.el('div', {},
              Components.el('strong', { style: 'font-size:1.1rem;' }, `Rp${Number(l.amount).toLocaleString('id-ID')}`),
              Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;display:block;margin-top:4px;' },
                `${l.category} \u2022 ${new Date(l.posted_at).toLocaleString('id-ID')}`
              )
            ),
            Components.badge(isIncome ? 'PENDAPATAN' : 'BIAYA', isIncome ? 'approved' : 'rejected')
          )
        )
        animateEntrance(card, 100 + i * 50)
        el.appendChild(card)
      })
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

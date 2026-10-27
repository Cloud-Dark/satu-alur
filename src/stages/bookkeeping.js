import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.section('Pembukuan',
    Components.el('p', {}, 'Catat jurnal keuangan dari setiap penyelesaian pekerjaan.')
  )
  container.appendChild(formCard)

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
    container.appendChild(Components.el('p', { style: 'color:var(--muted)' }, 'Tidak ada pekerjaan selesai. Selesaikan pekerjaan di tahap sebelumnya.'))
    return
  }

  const cloud = getCloud()
  const compSelect = Components.el('select', { name: 'completion_id', style: 'width:100%;padding:8px;margin-bottom:10px;' })
  compSelect.appendChild(Components.el('option', { value: '' }, '-- Pilih penyelesaian --'))
  for (const c of completions) {
    const assignRes = await cloud.database.from('assignments').select('offer_id').eq('id', c.assignment_id).maybeSingle()
    const offerRes = assignRes.data?.offer_id ? await cloud.database.from('offers').select('request_id,validated_price').eq('id', assignRes.data.offer_id).maybeSingle() : { data: null }
    const reqRes = offerRes.data?.request_id ? await cloud.database.from('requests').select('customer_name').eq('id', offerRes.data.request_id).maybeSingle() : { data: null }
    const label = `${reqRes.data?.customer_name || 'Pelanggan'} \u2014 Rp${Number(offerRes.data?.validated_price || 0).toLocaleString('id-ID')}`
    compSelect.appendChild(Components.el('option', { value: c.id }, label))
  }

  const amountInput = Components.el('input', { type: 'number', placeholder: 'Jumlah (Rp)', required: true })
  const categoryInput = Components.el('input', { type: 'text', placeholder: 'Kategori: pendapatan/biaya_tenaga/biaya_bahan', required: true })
  const postBtn = Components.el('button', { type: 'button' }, 'Posting Jurnal')
  const msg = Components.el('div', { className: 'message' })

  postBtn.addEventListener('click', async () => {
    msg.textContent = ''
    if (!compSelect.value) { msg.textContent = 'Pilih penyelesaian.'; return }
    if (!amountInput.value) { msg.textContent = 'Isi jumlah.'; return }
    if (!categoryInput.value.trim()) { msg.textContent = 'Isi kategori.'; return }
    try {
      const { error } = await cloud.database.from('ledger_entries').insert({
        completion_id: Number(compSelect.value),
        amount: Number(amountInput.value),
        category: categoryInput.value.trim(),
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      msg.style.color = 'var(--success)'
      msg.textContent = 'Jurnal berhasil diposting.'
      amountInput.value = ''
      categoryInput.value = ''
      await loadList()
    } catch (err) {
      msg.style.color = 'var(--danger)'
      msg.textContent = err.message
    }
  })

  container.appendChild(Components.el('div', { className: 'card' },
    Components.el('label', {}, 'Penyelesaian', compSelect),
    Components.el('label', {}, 'Jumlah (Rp)', amountInput),
    Components.el('label', {}, 'Kategori', categoryInput),
    postBtn,
    msg
  ))

  const listCard = Components.section('Daftar Jurnal', Components.el('div', { id: 'ledger-list' }, 'Memuat...'))
  container.appendChild(listCard)

  async function loadList() {
    const el = container.querySelector('#ledger-list')
    try {
      const { data, error } = await cloud.database.from('ledger_entries')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--muted)">Belum ada jurnal.</p>'
        return
      }
      el.innerHTML = ''
      let totalPendapatan = 0
      let totalBiaya = 0
      for (const l of data) {
        if (l.category === 'pendapatan') totalPendapatan += Number(l.amount)
        else totalBiaya += Number(l.amount)
        el.appendChild(Components.el('div', { className: 'card', style: 'margin-bottom:10px;' },
          Components.el('strong', {}, `Rp${Number(l.amount).toLocaleString('id-ID')}`),
          Components.el('span', { style: 'color:var(--muted);font-size:0.85rem;display:block;' }, `${l.category} \u2022 ${new Date(l.posted_at).toLocaleString('id-ID')}`)
        ))
      }
      const laba = totalPendapatan - totalBiaya
      el.insertBefore(Components.el('div', { className: 'card', style: 'background:var(--bg);' },
        Components.el('p', {}, `Total Pendapatan: Rp${totalPendapatan.toLocaleString('id-ID')}`),
        Components.el('p', {}, `Total Biaya: Rp${totalBiaya.toLocaleString('id-ID')}`),
        Components.el('p', { style: 'font-weight:600;color:' + (laba >= 0 ? 'var(--success)' : 'var(--danger)') }, `Laba/Rugi: Rp${laba.toLocaleString('id-ID')}`)
      ), el.firstChild)
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

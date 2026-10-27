import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.section('Penugasan Tenaga Pelaksana',
    Components.el('p', {}, 'Pilih penawaran yang sudah disetujui untuk ditugaskan kepada pekerja.')
  )
  container.appendChild(formCard)

  let offers = []
  try {
    const cloud = getCloud()
    const { data } = await cloud.database.from('offers')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
    offers = data || []
  } catch (err) {
    container.appendChild(Components.el('p', { style: 'color:var(--danger)' }, 'Gagal memuat: ' + err.message))
    return
  }

  if (offers.length === 0) {
    container.appendChild(Components.el('p', { style: 'color:var(--muted)' }, 'Tidak ada penawaran yang disetujui. Setujui penawaran di tahap sebelumnya.'))
    return
  }

  const cloud = getCloud()
  const offerSelect = Components.el('select', { name: 'offer_id', style: 'width:100%;padding:8px;margin-bottom:10px;' })
  offerSelect.appendChild(Components.el('option', { value: '' }, '-- Pilih penawaran --'))
  for (const o of offers) {
    const reqRes = await cloud.database.from('requests').select('customer_name,service_type').eq('id', o.request_id).maybeSingle()
    const req = reqRes.data || {}
    offerSelect.appendChild(Components.el('option', { value: o.id }, `${req.customer_name || 'Pelanggan'} \u2014 ${req.service_type || '-'}`))
  }

  const workerInput = Components.el('input', { type: 'text', placeholder: 'Nama pekerja', required: true })
  const dateInput = Components.el('input', { type: 'datetime-local', required: true })
  const assignBtn = Components.el('button', { type: 'button' }, 'Tugaskan')
  const msg = Components.el('div', { className: 'message' })

  assignBtn.addEventListener('click', async () => {
    msg.textContent = ''
    if (!offerSelect.value) { msg.textContent = 'Pilih penawaran.'; return }
    if (!workerInput.value.trim()) { msg.textContent = 'Isi nama pekerja.'; return }
    try {
      const { error } = await cloud.database.from('assignments').insert({
        offer_id: Number(offerSelect.value),
        worker_name: workerInput.value.trim(),
        scheduled_at: new Date(dateInput.value).toISOString(),
        status: 'assigned',
      })
      if (error) throw new Error(error.message)
      msg.style.color = 'var(--success)'
      msg.textContent = 'Penugasan berhasil disimpan.'
      workerInput.value = ''
      await loadList()
    } catch (err) {
      msg.style.color = 'var(--danger)'
      msg.textContent = err.message
    }
  })

  container.appendChild(Components.el('div', { className: 'card' },
    Components.el('label', {}, 'Penawaran', offerSelect),
    Components.el('label', {}, 'Nama Pekerja', workerInput),
    Components.el('label', {}, 'Jadwal', dateInput),
    assignBtn,
    msg
  ))

  const listCard = Components.section('Daftar Penugasan', Components.el('div', { id: 'assign-list' }, 'Memuat...'))
  container.appendChild(listCard)

  async function loadList() {
    const el = container.querySelector('#assign-list')
    try {
      const { data, error } = await cloud.database.from('assignments')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--muted)">Belum ada penugasan.</p>'
        return
      }
      el.innerHTML = ''
      for (const a of data) {
        const offerRes = await cloud.database.from('offers').select('request_id').eq('id', a.offer_id).maybeSingle()
        const reqId = offerRes.data?.request_id
        const reqRes = reqId ? await cloud.database.from('requests').select('customer_name,service_type').eq('id', reqId).maybeSingle() : { data: null }
        const req = reqRes.data || {}
        el.appendChild(Components.el('div', { className: 'card', style: 'margin-bottom:10px;' },
          Components.el('strong', {}, req.customer_name || 'Pelanggan'),
          Components.el('span', { style: 'color:var(--muted);font-size:0.85rem;display:block;' }, `${req.service_type || '-'} \u2022 ${a.worker_name}`),
          Components.el('p', { style: 'margin:6px 0;font-size:0.9rem;' }, `Jadwal: ${new Date(a.scheduled_at).toLocaleString('id-ID')}`),
          Components.el('span', { style: 'font-size:0.8rem;color:var(--muted);' }, `Status: ${a.status} \u2022 ${new Date(a.created_at).toLocaleString('id-ID')}`)
        ))
      }
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

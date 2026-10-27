import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { showToast, animateEntrance } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.el('div', { className: 'form-card card-accent-brown' },
    Components.el('h3', { className: 'form-title' }, '👷 Penugasan Tenaga Pelaksana'),
    Components.el('p', { className: 'form-subtitle' }, 'Pilih penawaran yang sudah disetujui untuk ditugaskan kepada pekerja.')
  )

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
    container.appendChild(Components.el('p', { style: 'color:var(--text-muted);padding:20px;' }, 'Tidak ada penawaran yang disetujui. Setujui penawaran di tahap sebelumnya.'))
    return
  }

  const cloud = getCloud()
  const offerSelect = Components.el('select', { name: 'offer_id' })
  offerSelect.appendChild(Components.el('option', { value: '' }, '-- Pilih penawaran --'))
  for (const o of offers) {
    const reqRes = await cloud.database.from('requests').select('customer_name,service_type').eq('id', o.request_id).maybeSingle()
    const req = reqRes.data || {}
    offerSelect.appendChild(Components.el('option', { value: o.id }, `${req.customer_name || 'Pelanggan'} \u2014 ${req.service_type || '-'}`))
  }

  const workerInput = Components.el('input', { type: 'text', placeholder: 'Nama pekerja', required: true })
  const dateInput = Components.el('input', { type: 'datetime-local', required: true })
  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const assignBtn = Components.el('button', { type: 'button' }, '📌 Tugaskan')
  assignBtn.addEventListener('click', async () => {
    msg.style.display = 'none'
    if (!offerSelect.value) {
      msg.className = 'form-message error'
      msg.textContent = 'Pilih penawaran.'
      msg.style.display = 'block'
      return
    }
    if (!workerInput.value.trim()) {
      msg.className = 'form-message error'
      msg.textContent = 'Isi nama pekerja.'
      msg.style.display = 'block'
      return
    }
    try {
      const { error } = await cloud.database.from('assignments').insert({
        offer_id: Number(offerSelect.value),
        worker_name: workerInput.value.trim(),
        scheduled_at: new Date(dateInput.value).toISOString(),
        status: 'assigned',
      })
      if (error) throw new Error(error.message)
      msg.className = 'form-message success'
      msg.textContent = '✅ Penugasan berhasil disimpan.'
      msg.style.display = 'block'
      workerInput.value = ''
      showToast('Penugasan berhasil dibuat!', 'success')
      await loadList()
    } catch (err) {
      msg.className = 'form-message error'
      msg.textContent = err.message
      msg.style.display = 'block'
    }
  })

  const form = Components.el('div', {},
    Components.el('div', { className: 'form-group' },
      Components.el('label', {}, 'Penawaran', Components.el('span', { className: 'required' }, '*')),
      offerSelect,
      Components.el('span', { className: 'field-hint' }, 'Hanya penawaran dengan status disetujui yang muncul di daftar.')
    ),
    Components.el('div', { className: 'form-row' },
      Components.el('div', { className: 'form-group' },
        Components.el('label', {}, 'Nama Pekerja', Components.el('span', { className: 'required' }, '*')),
        workerInput
      ),
      Components.el('div', { className: 'form-group' },
        Components.el('label', {}, 'Jadwal Pelaksanaan', Components.el('span', { className: 'required' }, '*')),
        dateInput
      )
    ),
    Components.el('div', { className: 'form-actions' }, assignBtn),
    msg
  )
  formCard.appendChild(form)
  container.appendChild(formCard)
  animateEntrance(formCard, 100)

  const listCard = Components.section('📋 Daftar Penugasan',
    Components.el('div', { id: 'assign-list' }, Components.el('div', { className: 'spinner' }))
  )
  listCard.classList.add('card-accent-orange')
  container.appendChild(listCard)
  animateEntrance(listCard, 200)

  async function loadList() {
    const el = container.querySelector('#assign-list')
    try {
      const { data, error } = await cloud.database.from('assignments')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted)">Belum ada penugasan.</p>'
        return
      }
      el.innerHTML = ''
      for (let i = 0; i < data.length; i++) {
        const a = data[i]
        const offerRes = await cloud.database.from('offers').select('request_id').eq('id', a.offer_id).maybeSingle()
        const reqId = offerRes.data?.request_id
        const reqRes = reqId ? await cloud.database.from('requests').select('customer_name,service_type').eq('id', reqId).maybeSingle() : { data: null }
        const req = reqRes.data || {}
        const card = Components.el('div', { className: 'card', style: 'margin-bottom:12px;' },
          Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
            Components.el('div', {},
              Components.el('strong', {}, req.customer_name || 'Pelanggan'),
              Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;display:block;margin-top:4px;' },
                `${req.service_type || '-'} \u2022 ${a.worker_name}`
              )
            ),
            Components.el('span', { className: `badge badge-${a.status}` }, a.status.toUpperCase())
          ),
          Components.el('p', { style: 'margin:10px 0;font-size:0.9rem;color:var(--text-muted);' },
            `📅 Jadwal: ${new Date(a.scheduled_at).toLocaleString('id-ID')}`
          ),
          Components.el('span', { style: 'font-size:0.75rem;color:var(--text-dim);' },
            '🕐 ' + new Date(a.created_at).toLocaleString('id-ID')
          )
        )
        animateEntrance(card, i * 60)
        el.appendChild(card)
      }
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

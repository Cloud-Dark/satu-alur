import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.section('Penyelesaian Pekerjaan',
    Components.el('p', {}, 'Konfirmasi pekerjaan selesai dan catat hasil.')
  )
  container.appendChild(formCard)

  let assignments = []
  try {
    const cloud = getCloud()
    const { data } = await cloud.database.from('assignments')
      .select('*')
      .eq('status', 'assigned')
      .order('created_at', { ascending: false })
    assignments = data || []
  } catch (err) {
    container.appendChild(Components.el('p', { style: 'color:var(--danger)' }, 'Gagal memuat: ' + err.message))
    return
  }

  if (assignments.length === 0) {
    container.appendChild(Components.el('p', { style: 'color:var(--muted)' }, 'Tidak ada penugasan aktif. Buat penugasan di tahap sebelumnya.'))
    return
  }

  const cloud = getCloud()
  const assignSelect = Components.el('select', { name: 'assignment_id', style: 'width:100%;padding:8px;margin-bottom:10px;' })
  assignSelect.appendChild(Components.el('option', { value: '' }, '-- Pilih penugasan --'))
  for (const a of assignments) {
    const offerRes = await cloud.database.from('offers').select('request_id').eq('id', a.offer_id).maybeSingle()
    const reqId = offerRes.data?.request_id
    const reqRes = reqId ? await cloud.database.from('requests').select('customer_name,service_type').eq('id', reqId).maybeSingle() : { data: null }
    const req = reqRes.data || {}
    assignSelect.appendChild(Components.el('option', { value: a.id }, `${req.customer_name || 'Pelanggan'} \u2014 ${req.service_type || '-'}`))
  }

  const notesInput = Components.el('textarea', { rows: 3, placeholder: 'Catatan hasil pekerjaan...' })
  const completeBtn = Components.el('button', { type: 'button' }, 'Tandai Selesai')
  const msg = Components.el('div', { className: 'message' })

  completeBtn.addEventListener('click', async () => {
    msg.textContent = ''
    if (!assignSelect.value) { msg.textContent = 'Pilih penugasan.'; return }
    try {
      const { error } = await cloud.database.from('completions').insert({
        assignment_id: Number(assignSelect.value),
        notes: notesInput.value.trim(),
        status: 'done',
        completed_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)

      // Update assignment status
      await cloud.database.from('assignments').update({ status: 'done' }).eq('id', Number(assignSelect.value))

      msg.style.color = 'var(--success)'
      msg.textContent = 'Pekerjaan ditandai selesai.'
      notesInput.value = ''
      await loadList()
    } catch (err) {
      msg.style.color = 'var(--danger)'
      msg.textContent = err.message
    }
  })

  container.appendChild(Components.el('div', { className: 'card' },
    Components.el('label', {}, 'Penugasan', assignSelect),
    Components.el('label', {}, 'Catatan Hasil', notesInput),
    completeBtn,
    msg
  ))

  const listCard = Components.section('Riwayat Penyelesaian', Components.el('div', { id: 'complete-list' }, 'Memuat...'))
  container.appendChild(listCard)

  async function loadList() {
    const el = container.querySelector('#complete-list')
    try {
      const { data, error } = await cloud.database.from('completions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--muted)">Belum ada penyelesaian.</p>'
        return
      }
      el.innerHTML = ''
      for (const c of data) {
        const assignRes = await cloud.database.from('assignments').select('offer_id,worker_name').eq('id', c.assignment_id).maybeSingle()
        const offerRes = assignRes.data?.offer_id ? await cloud.database.from('offers').select('request_id').eq('id', assignRes.data.offer_id).maybeSingle() : { data: null }
        const reqRes = offerRes.data?.request_id ? await cloud.database.from('requests').select('customer_name').eq('id', offerRes.data.request_id).maybeSingle() : { data: null }
        el.appendChild(Components.el('div', { className: 'card', style: 'margin-bottom:10px;' },
          Components.el('strong', {}, reqRes.data?.customer_name || 'Pelanggan'),
          Components.el('span', { style: 'color:var(--muted);font-size:0.85rem;display:block;' }, `Pekerja: ${assignRes.data?.worker_name || '-'}`),
          Components.el('p', { style: 'margin:6px 0;font-size:0.9rem;' }, c.notes || '-'),
          Components.el('span', { style: 'font-size:0.8rem;color:var(--muted);' }, `Selesai: ${new Date(c.completed_at).toLocaleString('id-ID')}`)
        ))
      }
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

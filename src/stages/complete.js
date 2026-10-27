import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { showToast, animateEntrance } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

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
    container.appendChild(Components.el('p', { style: 'color:var(--text-muted);padding:20px;' }, 'Tidak ada penugasan aktif. Buat penugasan di tahap sebelumnya.'))
    return
  }

  const cloud = getCloud()

  // Build select options
  const selectOptions = [{ value: '', label: '-- Pilih penugasan --' }]
  for (const a of assignments) {
    const offerRes = await cloud.database.from('offers').select('request_id').eq('id', a.offer_id).maybeSingle()
    const reqId = offerRes.data?.request_id
    const reqRes = reqId ? await cloud.database.from('requests').select('customer_name,service_type').eq('id', reqId).maybeSingle() : { data: null }
    const req = reqRes.data || {}
    selectOptions.push({ value: String(a.id), label: `${req.customer_name || 'Pelanggan'} \u2014 ${req.service_type || '-'}` })
  }

  const formCard = Components.el('div', { className: 'form-card card-accent-olive' },
    Components.el('h3', { className: 'form-title' }, '\u2705 Tandai Pekerjaan Selesai'),
    Components.el('p', { className: 'form-subtitle' }, 'Pilih penugasan aktif dan catat hasil pekerjaan untuk diproses ke pembukuan.')
  )

  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const completeBtn = Components.el('button', { type: 'button' }, '\u2705 Tandai Selesai')

  const assignSelect = Components.selectField({
    label: 'Penugasan',
    id: 'assignment_id',
    required: true,
    options: selectOptions,
  })

  const notesGroup = Components.textareaField({
    label: 'Catatan Hasil Pekerjaan',
    id: 'completion_notes',
    placeholder: 'Deskripsikan hasil pekerjaan: kondisi akhir, catatan khusus, saran perawatan, dll.',
    rows: 4,
  })

  const form = Components.el('form', { id: 'complete-form' },
    assignSelect,
    notesGroup,
    Components.el('div', { className: 'form-actions' }, completeBtn),
    msg
  )

  formCard.appendChild(form)

  const listCard = Components.section('\ud83d\udccb Riwayat Penyelesaian',
    Components.el('div', { id: 'complete-list' }, Components.el('div', { className: 'spinner' }))
  )
  listCard.classList.add('card-accent-secondary')

  container.appendChild(formCard)
  container.appendChild(listCard)

  animateEntrance(formCard, 0)
  animateEntrance(listCard, 100)

  completeBtn.addEventListener('click', async () => {
    msg.style.display = 'none'
    const selectEl = form.querySelector('#assignment_id')
    const notesEl = form.querySelector('#completion_notes')
    if (!selectEl.value) {
      msg.className = 'form-message error'
      msg.textContent = 'Pilih penugasan terlebih dahulu.'
      msg.style.display = 'block'
      return
    }
    try {
      const { error } = await cloud.database.from('completions').insert({
        assignment_id: Number(selectEl.value),
        notes: notesEl.value.trim(),
        status: 'done',
        completed_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)

      await cloud.database.from('assignments').update({ status: 'done' }).eq('id', Number(selectEl.value))

      msg.className = 'form-message success'
      msg.textContent = '\u2705 Pekerjaan ditandai selesai.'
      msg.style.display = 'block'
      notesEl.value = ''
      showToast('Pekerjaan selesai! Siap untuk pembukuan.', 'success')
      await loadList()
    } catch (err) {
      msg.className = 'form-message error'
      msg.textContent = err.message
      msg.style.display = 'block'
    }
  })

  async function loadList() {
    const el = container.querySelector('#complete-list')
    try {
      const { data, error } = await cloud.database.from('completions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted)">Belum ada penyelesaian.</p>'
        return
      }
      el.innerHTML = ''
      for (let i = 0; i < data.length; i++) {
        const c = data[i]
        const assignRes = await cloud.database.from('assignments').select('offer_id,worker_name').eq('id', c.assignment_id).maybeSingle()
        const offerRes = assignRes.data?.offer_id ? await cloud.database.from('offers').select('request_id').eq('id', assignRes.data.offer_id).maybeSingle() : { data: null }
        const reqRes = offerRes.data?.request_id ? await cloud.database.from('requests').select('customer_name').eq('id', offerRes.data.request_id).maybeSingle() : { data: null }
        const card = Components.el('div', { className: 'card', style: 'margin-bottom:12px;' },
          Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
            Components.el('div', {},
              Components.el('strong', {}, reqRes.data?.customer_name || 'Pelanggan'),
              Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;display:block;margin-top:4px;' },
                `\ud83d\udc77 ${assignRes.data?.worker_name || '-'}`
              )
            ),
            Components.badge('SELESAI', 'completed')
          ),
          Components.el('p', { style: 'margin:10px 0;font-size:0.9rem;color:var(--text-muted);' }, c.notes || '-'),
          Components.el('span', { style: 'font-size:0.75rem;color:var(--text-dim);' },
            '\u2705 ' + new Date(c.completed_at).toLocaleString('id-ID')
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

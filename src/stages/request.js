import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.section('Buat Permintaan Jasa',
    Components.el('form', { id: 'request-form' },
      Components.el('label', {}, 'Nama Pelanggan'),
      Components.el('input', { type: 'text', name: 'customer_name', required: true, placeholder: 'Contoh: PT Maju Jaya' }),
      Components.el('label', {}, 'Jenis Layanan'),
      Components.el('input', { type: 'text', name: 'service_type', required: true, placeholder: 'Contoh: Pembersihan AC, Cuci karpet' }),
      Components.el('label', {}, 'Lokasi'),
      Components.el('input', { type: 'text', name: 'location', placeholder: 'Contoh: Jakarta Selatan' }),
      Components.el('label', {}, 'Deskripsi'),
      Components.el('textarea', { name: 'description', rows: 3, placeholder: 'Jelaskan kebutuhan pelanggan...' }),
      Components.el('button', { type: 'submit' }, 'Simpan Permintaan')
    ),
    Components.el('div', { id: 'request-msg', className: 'message', style: 'margin-top:10px;' })
  )

  const listCard = Components.section('Daftar Permintaan',
    Components.el('div', { id: 'request-list' }, 'Memuat...')
  )

  container.appendChild(formCard)
  container.appendChild(listCard)

  const form = container.querySelector('#request-form')
  const msg = container.querySelector('#request-msg')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.textContent = ''
    const fd = new FormData(form)
    const data = Object.fromEntries(fd.entries())
    try {
      const cloud = getCloud()
      const { error } = await cloud.database.from('requests').insert(data)
      if (error) throw new Error(error.message)
      msg.style.color = 'var(--success)'
      msg.textContent = 'Permintaan berhasil disimpan.'
      form.reset()
      await loadList()
    } catch (err) {
      msg.style.color = 'var(--danger)'
      msg.textContent = err.message
    }
  })

  async function loadList() {
    const listEl = container.querySelector('#request-list')
    try {
      const cloud = getCloud()
      const { data, error } = await cloud.database.from('requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        listEl.innerHTML = '<p style="color:var(--muted);">Belum ada permintaan.</p>'
        return
      }
      listEl.innerHTML = ''
      data.forEach((r) => {
        const card = Components.el('div', { className: 'card', style: 'margin-bottom:10px;' },
          Components.el('strong', {}, r.customer_name),
          Components.el('span', { style: 'color:var(--muted);font-size:0.85rem;display:block;' }, `${r.service_type} \u2022 ${r.location || '-'}`),
          Components.el('p', { style: 'margin:6px 0;font-size:0.9rem;' }, r.description || '-'),
          Components.el('span', { style: 'font-size:0.8rem;color:var(--muted);' }, new Date(r.created_at).toLocaleString('id-ID'))
        )
        listEl.appendChild(card)
      })
    } catch (err) {
      listEl.innerHTML = `<p style="color:var(--danger);">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

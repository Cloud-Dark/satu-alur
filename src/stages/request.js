import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { showToast, animateEntrance } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.el('div', { className: 'form-card card-accent-orange' },
    Components.el('h3', { className: 'form-title' }, '📋 Buat Permintaan Jasa'),
    Components.el('p', { className: 'form-subtitle' }, 'Catat permintaan pelanggan baru untuk diproses ke tahap penawaran.')
  )

  const form = Components.el('form', { id: 'request-form' },
    Components.el('div', { className: 'form-group' },
      Components.el('label', {}, 'Nama Pelanggan', Components.el('span', { className: 'required' }, '*')),
      Components.el('input', { type: 'text', name: 'customer_name', required: true, placeholder: 'Contoh: PT Maju Jaya' }),
      Components.el('span', { className: 'field-hint' }, 'Nama perusahaan atau individu yang meminta layanan.')
    ),
    Components.el('div', { className: 'form-group' },
      Components.el('label', {}, 'Jenis Layanan', Components.el('span', { className: 'required' }, '*')),
      Components.el('input', { type: 'text', name: 'service_type', required: true, placeholder: 'Contoh: Pembersihan AC, Cuci karpet' }),
      Components.el('span', { className: 'field-hint' }, 'Jenis layanan yang diminta oleh pelanggan.')
    ),
    Components.el('div', { className: 'form-row' },
      Components.el('div', { className: 'form-group' },
        Components.el('label', {}, 'Lokasi'),
        Components.el('input', { type: 'text', name: 'location', placeholder: 'Contoh: Jakarta Selatan' })
      ),
      Components.el('div', { className: 'form-group' },
        Components.el('label', {}, 'Nomor Telepon'),
        Components.el('input', { type: 'tel', name: 'phone', placeholder: 'Contoh: 0812-3456-7890' })
      )
    ),
    Components.el('div', { className: 'form-group' },
      Components.el('label', {}, 'Deskripsi Kebutuhan'),
      Components.el('textarea', { name: 'description', rows: 4, placeholder: 'Jelaskan detail kebutuhan pelanggan: jumlah unit, ukuran area, preferensi waktu, dll.' }),
      Components.el('span', { className: 'field-hint' }, 'Semakin detail deskripsi, semakin akurat penawaran AI yang dihasilkan.')
    ),
    Components.el('div', { className: 'form-actions' },
      Components.el('button', { type: 'submit' }, '💾 Simpan Permintaan')
    )
  )

  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })
  formCard.appendChild(form)
  formCard.appendChild(msg)

  const listCard = Components.section('📋 Daftar Permintaan',
    Components.skeleton({ type: 'text', lines: 4 })
  )
  listCard.classList.add('card-accent-brown')

  container.appendChild(formCard)
  container.appendChild(listCard)

  animateEntrance(formCard, 0)
  animateEntrance(listCard, 100)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.style.display = 'none'
    const fd = new FormData(form)
    const data = Object.fromEntries(fd.entries())
    try {
      const cloud = getCloud()
      const { error } = await cloud.database.from('requests').insert(data)
      if (error) throw new Error(error.message)
      msg.className = 'form-message success'
      msg.textContent = '✅ Permintaan berhasil disimpan.'
      msg.style.display = 'block'
      form.reset()
      showToast('Permintaan baru berhasil dibuat!', 'success')
      await loadList()
    } catch (err) {
      msg.className = 'form-message error'
      msg.textContent = err.message
      msg.style.display = 'block'
    }
  })

  async function loadList() {
    const listEl = container.querySelector('#request-list')
    if (!listEl) return
    listEl.innerHTML = ''
    listEl.appendChild(Components.skeleton({ type: 'text', lines: 4 }))

    try {
      const cloud = getCloud()
      const { data, error } = await cloud.database.from('requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        listEl.innerHTML = '<p style="color:var(--text-muted);">Belum ada permintaan. Buat permintaan pertama Anda di atas!</p>'
        return
      }
      listEl.innerHTML = ''
      data.forEach((r, i) => {
        const card = Components.el('div', { className: 'card', style: 'margin-bottom:12px;' },
          Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
            Components.el('div', {},
              Components.el('strong', { style: 'font-size:1.05rem;' }, r.customer_name),
              Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;display:block;margin-top:4px;' },
                `${r.service_type} \u2022 ${r.location || '-'}`
              )
            ),
            Components.badge('BARU', 'draft')
          ),
          Components.el('p', { style: 'margin:10px 0;font-size:0.9rem;color:var(--text-muted);' }, r.description || '-'),
          Components.el('span', { style: 'font-size:0.75rem;color:var(--text-dim);' },
            '🕐 ' + new Date(r.created_at).toLocaleString('id-ID')
          )
        )
        animateEntrance(card, i * 80)
        listEl.appendChild(card)
      })
    } catch (err) {
      listEl.innerHTML = `<p style="color:var(--danger);">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadList()
}

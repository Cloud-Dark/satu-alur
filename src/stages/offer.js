import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { generateOffer } from '../ai/agent.js'
import { validateOffer } from '../domain/rules.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import { showToast, animateEntrance } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

  const formCard = Components.el('div', { className: 'form-card card-accent-sand' },
    Components.el('h3', { className: 'form-title' }, '💡 Penawaran AI'),
    Components.el('p', { className: 'form-subtitle' }, 'Pilih permintaan untuk menghasilkan penawaran AI. Sistem akan memvalidasi hasil sebelum disetujui.')
  )

  let models = []
  let selectedModel = null
  try {
    models = await loadModels()
    selectedModel = pickDefaultModel()
  } catch (e) {
    console.warn('Model load error:', e.message)
  }

  let requests = []
  try {
    const cloud = getCloud()
    const { data } = await cloud.database.from('requests')
      .select('*')
      .order('created_at', { ascending: false })
    requests = data || []
  } catch (err) {
    container.appendChild(Components.el('p', { style: 'color:var(--danger)' }, 'Gagal memuat permintaan: ' + err.message))
    return
  }

  if (requests.length === 0) {
    container.appendChild(Components.el('p', { style: 'color:var(--text-muted);padding:20px;' }, 'Belum ada permintaan. Buat permintaan di tahap sebelumnya.'))
    return
  }

  const select = Components.el('select', { name: 'request_id' })
  select.appendChild(Components.el('option', { value: '' }, '-- Pilih permintaan --'))
  requests.forEach((r) => {
    select.appendChild(Components.el('option', { value: r.id }, `${r.customer_name} \u2014 ${r.service_type}`))
  })

  const generateBtn = Components.el('button', { type: 'button' }, '🤖 Hasilkan Penawaran AI')
  const stopBtn = Components.el('button', { type: 'button', className: 'btn-secondary' }, '⏹ Batal')
  const resultArea = Components.el('div', { id: 'offer-result', style: 'margin-top:16px;' })
  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  let abortController = null

  generateBtn.addEventListener('click', async () => {
    const reqId = select.value
    if (!reqId) {
      msg.className = 'form-message error'
      msg.textContent = 'Pilih permintaan terlebih dahulu.'
      msg.style.display = 'block'
      return
    }
    const request = requests.find(r => r.id == reqId)
    if (!request) {
      msg.className = 'form-message error'
      msg.textContent = 'Permintaan tidak ditemukan.'
      msg.style.display = 'block'
      return
    }

    msg.style.display = 'none'
    resultArea.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:12px 0;"><div class="spinner"></div> AI sedang menghasilkan penawaran...</div>'
    generateBtn.disabled = true

    if (!selectedModel) {
      resultArea.innerHTML = '<p style="color:var(--danger)">Model AI tidak tersedia.</p>'
      generateBtn.disabled = false
      return
    }

    abortController = new AbortController()
    let accumulated = ''
    const preview = Components.el('div', { className: 'ai-stream' })
    resultArea.innerHTML = ''
    resultArea.appendChild(preview)

    try {
      const offerJson = await generateOffer({
        request,
        modelId: selectedModel.id,
        signal: abortController.signal,
        onChunk: (delta, full) => {
          accumulated = full
          preview.textContent = full
        }
      })

      const validation = validateOffer(offerJson)
      if (!validation.valid) {
        resultArea.appendChild(Components.el('div', { className: 'card card-accent-terracotta', style: 'margin-top:16px;' },
          Components.el('h3', {}, '❌ Validasi Gagal'),
          Components.el('ul', {}, ...validation.errors.map(e => Components.el('li', {}, e)))
        ))
        generateBtn.disabled = false
        return
      }

      const validatedCard = Components.el('div', { className: 'card card-accent-olive', style: 'margin-top:16px;' },
        Components.el('h3', {}, '✅ Proposal Tervalidasi'),
        Components.el('div', { style: 'display:grid;gap:10px;margin-top:12px;' },
          Components.el('div', {},
            Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Ruang Lingkup'),
            Components.el('p', { style: 'margin:4px 0;' }, offerJson.scope)
          ),
          Components.el('div', {},
            Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Harga'),
            Components.el('p', { style: 'margin:4px 0;font-size:1.2rem;font-weight:800;color:var(--primary);' },
              `Rp${Number(offerJson.price).toLocaleString('id-ID')}`
            )
          ),
          Components.el('div', {},
            Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Ketentuan'),
            Components.el('p', { style: 'margin:4px 0;' }, offerJson.terms)
          ),
          Components.el('div', {},
            Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Catatan'),
            Components.el('p', { style: 'margin:4px 0;color:var(--text-muted);' }, offerJson.notes || '-')
          )
        )
      )
      resultArea.appendChild(validatedCard)
      animateEntrance(validatedCard)

      const saveBtn = Components.el('button', { type: 'button', className: 'btn-success' }, '💾 Simpan Penawaran')
      saveBtn.addEventListener('click', async () => {
        try {
          const cloud = getCloud()
          const { error } = await cloud.database.from('offers').insert({
            request_id: request.id,
            ai_proposal_json: offerJson,
            validated_price: offerJson.price,
            validated_scope: offerJson.scope,
            status: 'draft',
          })
          if (error) throw new Error(error.message)
          msg.className = 'form-message success'
          msg.textContent = '✅ Penawaran berhasil disimpan ke database.'
          msg.style.display = 'block'
          saveBtn.disabled = true
          showToast('Penawaran AI berhasil disimpan!', 'success')
          await loadOffers()
        } catch (err) {
          msg.className = 'form-message error'
          msg.textContent = err.message
          msg.style.display = 'block'
        }
      })
      resultArea.appendChild(saveBtn)

    } catch (err) {
      if (err.name === 'AbortError') {
        resultArea.innerHTML = '<p style="color:var(--text-muted)">Dibatalkan.</p>'
      } else {
        resultArea.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`
      }
    } finally {
      generateBtn.disabled = false
    }
  })

  stopBtn.addEventListener('click', () => abortController?.abort())

  const form = Components.el('div', {},
    Components.el('div', { className: 'form-group' },
      Components.el('label', {}, 'Pilih Permintaan'),
      select,
      Components.el('span', { className: 'field-hint' }, 'Pilih permintaan pelanggan yang akan dibuatkan penawaran.')
    ),
    Components.el('div', { className: 'form-actions' }, generateBtn, stopBtn),
    msg,
    resultArea
  )
  formCard.appendChild(form)
  container.appendChild(formCard)
  animateEntrance(formCard, 100)

  const listCard = Components.section('📋 Daftar Penawaran',
    Components.skeleton({ type: 'text', lines: 4 })
  )
  listCard.classList.add('card-accent-secondary')
  container.appendChild(listCard)
  animateEntrance(listCard, 200)

  async function loadOffers() {
    const el = container.querySelector('#offer-list')
    if (!el) return
    el.innerHTML = ''
    el.appendChild(Components.skeleton({ type: 'text', lines: 4 }))

    try {
      const cloud = getCloud()
      const { data, error } = await cloud.database.from('offers')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted)">Belum ada penawaran.</p>'
        return
      }
      el.innerHTML = ''
      for (let i = 0; i < data.length; i++) {
        const o = data[i]
        const reqRes = await cloud.database.from('requests').select('customer_name,service_type').eq('id', o.request_id).maybeSingle()
        const req = reqRes.data || {}
        const card = Components.el('div', { className: 'card', style: 'margin-bottom:12px;' },
          Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
            Components.el('div', {},
              Components.el('strong', {}, req.customer_name || 'Pelanggan'),
              Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;display:block;margin-top:4px;' },
                `${req.service_type || '-'} \u2022 Rp${Number(o.validated_price || 0).toLocaleString('id-ID')}`
              )
            ),
            Components.badge(o.status, o.status === 'approved' ? 'approved' : 'draft')
          ),
          Components.el('p', { style: 'margin:10px 0;font-size:0.9rem;color:var(--text-muted);' }, o.validated_scope || '-'),
          Components.el('span', { style: 'font-size:0.75rem;color:var(--text-dim);' },
            '🕐 ' + new Date(o.created_at).toLocaleString('id-ID')
          )
        )
        animateEntrance(card, i * 60)
        el.appendChild(card)
      }
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadOffers()
}

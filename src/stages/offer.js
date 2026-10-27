import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { generateOffer } from '../ai/agent.js'
import { validateOffer } from '../domain/rules.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'

export async function render(container) {
  container.innerHTML = ''

  const header = Components.section('Penawaran (AI)',
    Components.el('p', {}, 'Pilih permintaan untuk menghasilkan penawaran AI. Sistem akan memvalidasi hasil sebelum disetujui.')
  )
  container.appendChild(header)

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
    container.appendChild(Components.el('p', { style: 'color:var(--muted)' }, 'Belum ada permintaan. Buat permintaan di tahap sebelumnya.'))
    return
  }

  const select = Components.el('select', { name: 'request_id', style: 'width:100%;padding:8px;margin-bottom:10px;' })
  select.appendChild(Components.el('option', { value: '' }, '-- Pilih permintaan --'))
  requests.forEach((r) => {
    select.appendChild(Components.el('option', { value: r.id }, `${r.customer_name} \u2014 ${r.service_type}`))
  })

  const generateBtn = Components.el('button', { type: 'button' }, 'Hasilkan Penawaran AI')
  const resultArea = Components.el('div', { id: 'offer-result', style: 'margin-top:16px;' })
  const msg = Components.el('div', { className: 'message' })

  let abortController = null

  generateBtn.addEventListener('click', async () => {
    const reqId = select.value
    if (!reqId) { msg.textContent = 'Pilih permintaan terlebih dahulu.'; return }
    const request = requests.find(r => r.id == reqId)
    if (!request) { msg.textContent = 'Permintaan tidak ditemukan.'; return }

    msg.textContent = ''
    resultArea.innerHTML = '<p style="color:var(--muted)">AI sedang menghasilkan penawaran...</p>'
    generateBtn.disabled = true

    if (!selectedModel) {
      resultArea.innerHTML = '<p style="color:var(--danger)">Model AI tidak tersedia.</p>'
      generateBtn.disabled = false
      return
    }

    abortController = new AbortController()
    let accumulated = ''
    let preview = Components.el('pre', { style: 'background:var(--bg);padding:12px;border-radius:8px;overflow:auto;max-height:300px;' })
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
        resultArea.appendChild(Components.el('div', { className: 'message', style: 'color:var(--danger);margin-top:10px;' },
          Components.el('strong', {}, 'Validasi Gagal:'),
          Components.el('ul', {}, ...validation.errors.map(e => Components.el('li', {}, e)))
        ))
        generateBtn.disabled = false
        return
      }

      resultArea.appendChild(Components.el('div', { style: 'margin-top:12px;' },
        Components.el('h3', {}, 'Proposal Tervalidasi'),
        Components.el('p', {}, `Ruang Lingkup: ${offerJson.scope}`),
        Components.el('p', {}, `Harga: Rp${Number(offerJson.price).toLocaleString('id-ID')}`),
        Components.el('p', {}, `Ketentuan: ${offerJson.terms}`),
        Components.el('p', { style: 'color:var(--muted);font-size:0.85rem;' }, `Catatan: ${offerJson.notes || '-'}`)
      ))

      const saveBtn = Components.el('button', { type: 'button' }, 'Simpan Penawaran')
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
          msg.style.color = 'var(--success)'
          msg.textContent = 'Penawaran berhasil disimpan ke database.'
          saveBtn.disabled = true
          await loadOffers()
        } catch (err) {
          msg.style.color = 'var(--danger)'
          msg.textContent = err.message
        }
      })
      resultArea.appendChild(saveBtn)

    } catch (err) {
      if (err.name === 'AbortError') {
        resultArea.innerHTML = '<p style="color:var(--muted)">Dibatalkan.</p>'
      } else {
        resultArea.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`
      }
    } finally {
      generateBtn.disabled = false
    }
  })

  const stopBtn = Components.el('button', { type: 'button', style: 'margin-left:8px;' }, 'Batal')
  stopBtn.addEventListener('click', () => abortController?.abort())

  container.appendChild(Components.el('div', { className: 'card' },
    Components.el('label', {}, 'Pilih Permintaan', select),
    Components.el('div', {}, generateBtn, stopBtn),
    msg,
    resultArea
  ))

  const listCard = Components.section('Daftar Penawaran', Components.el('div', { id: 'offer-list' }, 'Memuat...'))
  container.appendChild(listCard)

  async function loadOffers() {
    const el = container.querySelector('#offer-list')
    try {
      const cloud = getCloud()
      const { data, error } = await cloud.database.from('offers')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        el.innerHTML = '<p style="color:var(--muted)">Belum ada penawaran.</p>'
        return
      }
      el.innerHTML = ''
      for (const o of data) {
        const reqRes = await cloud.database.from('requests').select('customer_name,service_type').eq('id', o.request_id).maybeSingle()
        const req = reqRes.data || {}
        el.appendChild(Components.el('div', { className: 'card', style: 'margin-bottom:10px;' },
          Components.el('strong', {}, req.customer_name || 'Pelanggan'),
          Components.el('span', { style: 'color:var(--muted);font-size:0.85rem;display:block;' }, `${req.service_type || '-'} \u2022 Rp${Number(o.validated_price || 0).toLocaleString('id-ID')}`),
          Components.el('p', { style: 'margin:6px 0;font-size:0.9rem;' }, o.validated_scope || '-'),
          Components.el('span', { style: 'font-size:0.8rem;color:var(--muted);' }, `Status: ${o.status} \u2022 ${new Date(o.created_at).toLocaleString('id-ID')}`)
        ))
      }
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`
    }
  }

  await loadOffers()
}

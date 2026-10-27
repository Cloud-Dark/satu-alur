import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { explainReport } from '../ai/agent.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'

export async function render(container) {
  container.innerHTML = ''

  const header = Components.section('Laporan & Penjelasan AI',
    Components.el('p', {}, 'AI menjelaskan laporan keuangan/operasional dalam bahasa yang mudah dipahami.')
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

  const cloud = getCloud()

  // Aggregate report data
  let reportData = { total_revenue: 0, total_cost: 0, period: 'Oktober 2026', entries: [] }
  try {
    const { data: ledger } = await cloud.database.from('ledger_entries').select('*')
    if (ledger) {
      reportData.entries = ledger
      ledger.forEach(l => {
        if (l.category === 'pendapatan') reportData.total_revenue += Number(l.amount)
        else reportData.total_cost += Number(l.amount)
      })
    }
  } catch (err) {
    console.warn('Ledger load error:', err.message)
  }

  // Summary card
  const summaryCard = Components.el('div', { className: 'card', style: 'background:var(--bg);' },
    Components.el('h3', {}, 'Ringkasan Keuangan'),
    Components.el('p', {}, `Periode: ${reportData.period}`),
    Components.el('p', {}, `Total Pendapatan: Rp${reportData.total_revenue.toLocaleString('id-ID')}`),
    Components.el('p', {}, `Total Biaya: Rp${reportData.total_cost.toLocaleString('id-ID')}`),
    Components.el('p', { style: 'font-weight:600;' }, `Laba Bersih: Rp${(reportData.total_revenue - reportData.total_cost).toLocaleString('id-ID')}`)
  )
  container.appendChild(summaryCard)

  // AI explanation
  const explainBtn = Components.el('button', { type: 'button' }, 'Jelaskan dengan AI')
  const resultArea = Components.el('div', { id: 'report-explain', style: 'margin-top:16px;' })
  const msg = Components.el('div', { className: 'message' })

  let abortController = null

  explainBtn.addEventListener('click', async () => {
    msg.textContent = ''
    resultArea.innerHTML = '<p style="color:var(--muted)">AI sedang menjelaskan...</p>'
    explainBtn.disabled = true

    if (!selectedModel) {
      resultArea.innerHTML = '<p style="color:var(--danger)">Model AI tidak tersedia.</p>'
      explainBtn.disabled = false
      return
    }

    abortController = new AbortController()
    const preview = Components.el('div', { style: 'background:var(--bg);padding:12px;border-radius:8px;' })
    resultArea.innerHTML = ''
    resultArea.appendChild(preview)

    try {
      const html = await explainReport({
        report: reportData,
        modelId: selectedModel.id,
        signal: abortController.signal,
        onChunk: (delta, full) => {
          preview.innerHTML = full
        }
      })
      preview.innerHTML = html
    } catch (err) {
      if (err.name === 'AbortError') {
        resultArea.innerHTML = '<p style="color:var(--muted)">Dibatalkan.</p>'
      } else {
        resultArea.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`
      }
    } finally {
      explainBtn.disabled = false
    }
  })

  const stopBtn = Components.el('button', { type: 'button', style: 'margin-left:8px;' }, 'Batal')
  stopBtn.addEventListener('click', () => abortController?.abort())

  container.appendChild(Components.el('div', { className: 'card' },
    Components.el('h3', {}, 'Penjelasan AI'),
    Components.el('div', {}, explainBtn, stopBtn),
    msg,
    resultArea
  ))
}

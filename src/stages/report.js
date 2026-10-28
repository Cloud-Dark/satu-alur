import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { explainReport } from '../ai/agent.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import { showToast, animateEntrance } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

  const header = Components.section('\ud83d\udcc8 Laporan & Penjelasan AI',
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.9rem;' }, 'AI menjelaskan laporan keuangan/operasional dalam bahasa yang mudah dipahami.')
  )
  header.classList.add('card-accent-sand')
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

  // Stats grid
  const statsGrid = Components.el('div', { className: 'stats-grid' },
    Components.el('div', { className: 'stat-card olive' },
      Components.el('div', { className: 'stat-label' }, 'Total Pendapatan'),
      Components.el('div', { className: 'stat-value' }, `Rp${reportData.total_revenue.toLocaleString('id-ID')}`)
    ),
    Components.el('div', { className: 'stat-card terracotta' },
      Components.el('div', { className: 'stat-label' }, 'Total Biaya'),
      Components.el('div', { className: 'stat-value' }, `Rp${reportData.total_cost.toLocaleString('id-ID')}`)
    ),
    Components.el('div', { className: 'stat-card orange' },
      Components.el('div', { className: 'stat-label' }, 'Laba Bersih'),
      Components.el('div', { className: 'stat-value' }, `Rp${(reportData.total_revenue - reportData.total_cost).toLocaleString('id-ID')}`)
    )
  )
  container.appendChild(statsGrid)
  animateEntrance(statsGrid)

  // Summary card
  const summaryCard = Components.el('div', { className: 'card card-accent-brown' },
    Components.el('h3', {}, '\ud83d\udcca Ringkasan Keuangan'),
    Components.el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:12px;' },
      Components.el('div', {},
        Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Periode'),
        Components.el('p', { style: 'margin:4px 0;font-weight:600;' }, reportData.period)
      ),
      Components.el('div', {},
        Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Total Pendapatan'),
        Components.el('p', { style: 'margin:4px 0;font-weight:600;color:var(--accent-olive);' }, `Rp${reportData.total_revenue.toLocaleString('id-ID')}`)
      ),
      Components.el('div', {},
        Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Total Biaya'),
        Components.el('p', { style: 'margin:4px 0;font-weight:600;color:var(--accent-terracotta);' }, `Rp${reportData.total_cost.toLocaleString('id-ID')}`)
      ),
      Components.el('div', {},
        Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;' }, 'Laba Bersih'),
        Components.el('p', { style: 'margin:4px 0;font-weight:600;color:var(--primary);' }, `Rp${(reportData.total_revenue - reportData.total_cost).toLocaleString('id-ID')}`)
      )
    )
  )
  container.appendChild(summaryCard)
  animateEntrance(summaryCard, 100)

  // AI explanation form card
  const explainCard = Components.el('div', { className: 'form-card card-accent-secondary' },
    Components.el('h3', { className: 'form-title' }, '\ud83e\udde0 Penjelasan AI'),
    Components.el('p', { className: 'form-subtitle' }, 'AI akan menganalisis data keuangan dan memberikan insight dalam bahasa Indonesia.')
  )

  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })
  const resultArea = Components.el('div', { id: 'report-explain', style: 'margin-top:16px;' })

  const explainBtn = Components.el('button', { type: 'button' }, '\ud83e\udd16 Jelaskan dengan AI')
  const stopBtn = Components.el('button', { type: 'button', className: 'btn-secondary' }, '\u23f9 Batal')

  const actions = Components.el('div', { className: 'form-actions', style: 'border-top:none;padding-top:0;margin-top:0;' }, explainBtn, stopBtn)

  let abortController = null

  explainBtn.addEventListener('click', async () => {
    msg.style.display = 'none'
    resultArea.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:12px 0;"><div class="spinner"></div> AI sedang menjelaskan...</div>'
    explainBtn.disabled = true

    if (!selectedModel) {
      resultArea.innerHTML = '<p style="color:var(--danger)">Model AI tidak tersedia.</p>'
      explainBtn.disabled = false
      return
    }

    abortController = new AbortController()
    const preview = Components.el('div', { className: 'ai-stream' })
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
      showToast('Penjelasan laporan selesai!', 'success')
    } catch (err) {
      if (err.name === 'AbortError') {
        resultArea.innerHTML = '<p style="color:var(--text-muted)">Dibatalkan.</p>'
      } else {
        resultArea.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`
      }
    } finally {
      explainBtn.disabled = false
    }
  })

  stopBtn.addEventListener('click', () => abortController?.abort())

  explainCard.appendChild(actions)
  explainCard.appendChild(msg)
  explainCard.appendChild(resultArea)
  container.appendChild(explainCard)
  animateEntrance(explainCard, 200)
}

import * as Superpowers from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as Components from '../ui/components.js'
import { showToast, animateEntrance } from '../ui/animations.js'

let selectedModel = null
let currentAgent = 'general'
let abortController = null

const AGENT_OPTIONS = [
  { key: 'general', label: '🤖 Asisten Umum', desc: 'Bantuan umum & troubleshooting' },
  { key: 'offer', label: '💡 Agen Penawaran', desc: 'Membuat proposal penawaran' },
  { key: 'report', label: '📈 Analis Laporan', desc: 'Analisis keuangan & laporan' },
  { key: 'analyst', label: '📊 Analis Bisnis', desc: 'Analisis data dengan query DB' },
]

export async function render(container) {
  container.innerHTML = ''

  try {
    await loadModels()
    selectedModel = pickDefaultModel()
  } catch (e) {
    console.warn('Model load error:', e.message)
  }

  // Header
  const header = Components.el('div', { className: 'form-card card-accent-orange' },
    Components.el('h3', { className: 'form-title' }, '🦸 AI Superpowers'),
    Components.el('p', { className: 'form-subtitle' }, 'AI Engine dengan multi-agent routing, conversation memory, tool calling, smart retry, dan analytics.')
  )

  // Agent selector
  const agentSelect = Components.el('div', { className: 'form-row', style: 'margin-bottom:16px;' })
  AGENT_OPTIONS.forEach(opt => {
    const btn = Components.el('button', {
      type: 'button',
      style: `padding:10px 14px;border:1px solid ${opt.key === currentAgent ? 'var(--primary)' : 'var(--border)'};border-radius:var(--radius-sm);background:${opt.key === currentAgent ? 'var(--primary-soft)' : 'var(--bg-card)'};color:${opt.key === currentAgent ? 'var(--primary)' : 'var(--text-muted)'};cursor:pointer;font-size:0.85rem;font-weight:600;transition:all 0.2s;`,
      onClick: () => {
        currentAgent = opt.key
        render(container)
      },
    }, opt.label)
    agentSelect.appendChild(btn)
  })

  // Chat area
  const chatCard = Components.el('div', { className: 'form-card', style: 'padding:0;overflow:hidden;' })

  // Chat header
  const chatHeader = Components.el('div', {
    style: 'padding:16px 20px;background:var(--primary-soft);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;'
  },
    Components.el('div', {},
      Components.el('strong', { style: 'font-size:0.95rem;color:var(--text);' }, AGENT_OPTIONS.find(a => a.key === currentAgent)?.label || 'AI'),
      Components.el('span', { style: 'font-size:0.75rem;color:var(--text-muted);display:block;' }, AGENT_OPTIONS.find(a => a.key === currentAgent)?.desc || '')
    ),
    Components.el('div', { style: 'display:flex;gap:8px;' },
      Components.el('button', {
        type: 'button',
        style: 'padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-muted);font-size:0.8rem;cursor:pointer;',
        onClick: () => {
          Superpowers.clearHistory(currentAgent)
          chatMessages.innerHTML = ''
          addBotMessage('Percakapan telah direset. Ada yang bisa saya bantu?')
          showToast('Percakapan direset', 'info')
        },
      }, '🗑 Reset'),
      Components.el('button', {
        type: 'button',
        style: 'padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-muted);font-size:0.8rem;cursor:pointer;',
        onClick: () => {
          const summary = Superpowers.getAnalyticsSummary()
          addBotMessage(`📊 **AI Analytics**\n\n- Total chat: ${summary.total}\n- Success rate: ${summary.successRate}%\n- Rata-rata latency: ${summary.avgLatency}ms\n- Distribusi agent: ${Object.entries(summary.byAgent).map(([k,v]) => `${k}: ${v}`).join(', ')}`)
        },
      }, '📈 Stats')
    )
  )

  // Messages container
  const chatMessages = Components.el('div', {
    style: 'height:360px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--bg);'
  })

  // Load history
  const history = Superpowers.getConversationHistory(currentAgent)
  if (history.length === 0) {
    addBotMessage(`Halo! Saya adalah ${AGENT_OPTIONS.find(a => a.key === currentAgent)?.label || 'AI Assistant'}.\n\nSaya memiliki beberapa "superpower":\n• 🧠 **Memory** — mengingat percakapan kita\n• 🔧 **Tool Calling** — kalkulator, query database, format rupiah\n• 🔄 **Smart Retry** — auto-switch model jika gagal\n• 📊 **Analytics** — tracking performa\n\nAda yang bisa saya bantu?`)
  } else {
    history.forEach(h => {
      if (h.role === 'user') addUserMessage(h.content)
      else addBotMessage(h.content)
    })
  }

  // Input area
  const chatInput = Components.el('input', {
    type: 'text',
    placeholder: 'Ketik pesan Anda...',
    style: 'flex:1;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-warm);font-family:inherit;font-size:0.9rem;outline:none;'
  })

  const sendBtn = Components.el('button', {
    type: 'button',
    style: 'padding:12px 20px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius-sm);font-weight:700;cursor:pointer;transition:all 0.2s;',
  }, 'Kirim')

  const inputArea = Components.el('div', {
    style: 'display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);background:var(--bg-surface);'
  }, chatInput, sendBtn)

  chatCard.appendChild(chatHeader)
  chatCard.appendChild(chatMessages)
  chatCard.appendChild(inputArea)

  container.appendChild(header)
  container.appendChild(agentSelect)
  container.appendChild(chatCard)

  animateEntrance(header, 0)
  animateEntrance(chatCard, 100)

  // Scroll to bottom
  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight
  }

  function addUserMessage(text) {
    const msg = Components.el('div', {
      style: 'align-self:flex-end;max-width:80%;padding:10px 14px;background:var(--primary);color:#fff;border-radius:var(--radius-sm);border-bottom-right-radius:4px;font-size:0.9rem;line-height:1.5;animation:msgIn 0.2s ease;'
    }, text)
    chatMessages.appendChild(msg)
    scrollToBottom()
  }

  function addBotMessage(text) {
    const msg = Components.el('div', {
      style: 'align-self:flex-start;max-width:80%;padding:10px 14px;background:var(--bg-surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);border-bottom-left-radius:4px;font-size:0.9rem;line-height:1.5;animation:msgIn 0.2s ease;white-space:pre-wrap;'
    })
    msg.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
    chatMessages.appendChild(msg)
    scrollToBottom()
  }

  function addTypingIndicator() {
    const indicator = Components.el('div', {
      id: 'typing-indicator',
      style: 'align-self:flex-start;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.9rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;'
    },
      Components.el('div', { className: 'spinner', style: 'width:14px;height:14px;border-width:1.5px;' }),
      'AI sedang mengetik...'
    )
    chatMessages.appendChild(indicator)
    scrollToBottom()
    return indicator
  }

  async function sendMessage() {
    const text = chatInput.value.trim()
    if (!text) return
    if (!selectedModel) {
      addBotMessage('❌ Model AI tidak tersedia. Silakan cek pengaturan.')
      return
    }

    chatInput.value = ''
    addUserMessage(text)

    const typing = addTypingIndicator()
    sendBtn.disabled = true
    sendBtn.style.opacity = '0.5'

    abortController = new AbortController()
    let fullText = ''

    try {
      const generator = Superpowers.chatWithAgent({
        agentKey: currentAgent,
        message: text,
        modelId: selectedModel.id,
        signal: abortController.signal,
      })

      for await (const event of generator) {
        if (event.type === 'text') {
          if (!fullText) {
            typing.remove()
            const msgEl = Components.el('div', {
              id: 'streaming-msg',
              style: 'align-self:flex-start;max-width:80%;padding:10px 14px;background:var(--bg-surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);border-bottom-left-radius:4px;font-size:0.9rem;line-height:1.5;white-space:pre-wrap;'
            })
            chatMessages.appendChild(msgEl)
          }
          fullText = event.full
          const msgEl = chatMessages.querySelector('#streaming-msg')
          if (msgEl) msgEl.innerHTML = fullText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
          scrollToBottom()
        }
        if (event.type === 'tool') {
          typing.remove()
          addBotMessage(`🔧 **Tool Executed:** ${event.result.tool}\n\n\`\`\`json\n${JSON.stringify(event.result.result, null, 2)}\n\`\`\``)
        }
        if (event.type === 'error') {
          typing.remove()
          addBotMessage('❌ ' + event.message)
        }
        if (event.type === 'done') {
          const msgEl = chatMessages.querySelector('#streaming-msg')
          if (msgEl) msgEl.removeAttribute('id')
        }
      }
    } catch (err) {
      typing.remove()
      if (err.name === 'AbortError') {
        addBotMessage('⏹ Dibatalkan.')
      } else {
        addBotMessage('❌ Error: ' + err.message)
      }
    } finally {
      sendBtn.disabled = false
      sendBtn.style.opacity = '1'
      abortController = null
    }
  }

  sendBtn.addEventListener('click', sendMessage)
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage()
  })
}

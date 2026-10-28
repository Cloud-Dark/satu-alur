import * as AI from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'

const { el } = C
let currentAgent = 'general'

export async function render(container, ctx = {}) {
  let controller = null
  const agents = AI.getAgents().filter((a) => a.key !== 'social')
  const agent = C.select({ label: 'Asisten', id: 'chat-agent', value: currentAgent,
    options: agents.map((a) => ({ value: a.key, label: a.name })) })
  const model = C.select({ label: 'Model AI', id: 'chat-model', options: [{ value: '', label: 'Memuat model…' }] })
  const desc = el('p', { className: 'panel-lead' })
  const messages = el('div', { className: 'assistant-messages', role: 'log', 'aria-label': 'Percakapan AI' })
  const input = C.textarea({ label: 'Pesan Anda', id: 'chat-message', rows: 3, required: true,
    placeholder: 'Apa yang ingin Anda kerjakan?', hint: 'Enter untuk mengirim · Shift + Enter untuk baris baru.', attrs: { maxlength: '8000' } })
  const send = C.button({ label: 'Kirim pesan', icon: 'arrowUpRight', variant: 'primary', type: 'submit', disabled: true })
  const stop = C.button({ label: 'Hentikan', icon: 'stop', variant: 'soft', hidden: true, onClick: () => controller?.abort() })
  const reset = C.button({ label: 'Reset', icon: 'refresh', variant: 'ghost', size: 'sm', onClick: () => {
    AI.clearHistory(currentAgent)
    drawHistory()
  } })
  const error = C.message()
  const stats = el('div', { className: 'workspace-stats' })
  const form = el('form', { className: 'form assistant-composer' }, input.wrap,
    el('div', { className: 'form-actions' }, send, stop), error)

  container.replaceChildren(
    C.pageHeader({ title: 'Asisten untuk bisnis Anda', em: 'bisnis', description: 'Pilih spesialis, lanjutkan percakapan, dan gunakan data operasional untuk menentukan langkah berikutnya.' }),
    el('div', { className: 'stage-grid workspace-grid' },
      el('div', { className: 'workspace-stack' },
        C.panel({ title: 'AI Superpowers', meta: 'Satu spesialis per percakapan' },
          el('div', { className: 'form' }, agent.wrap, model.wrap, desc),
          el('p', { className: 'field-hint' }, 'Riwayat disimpan di browser ini. Jangan masukkan rahasia atau data sensitif.')),
        C.panel({ title: 'Aktivitas AI', meta: '100 interaksi terakhir' }, stats)),
      C.panel({ title: 'Percakapan', actions: reset, className: 'assistant-panel' }, messages, form)))

  function drawStats() {
    const s = AI.getAnalyticsSummary()
    stats.replaceChildren(C.defList([
      ['Percakapan', String(s.total)], ['Berhasil', `${s.successRate}%`], ['Rata-rata respons', `${s.avgLatency} ms`],
    ]))
  }
  function addMessage(role, text) {
    const body = el('div', { className: 'assistant-message-text' })
    body.innerHTML = C.sanitizeHTML(text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'))
    const row = el('article', { className: `assistant-message is-${role}` },
      el('span', { className: 'assistant-avatar', 'aria-hidden': 'true' }, C.icon(role === 'user' ? 'user' : 'bot')),
      el('div', {}, el('b', { className: 'assistant-author' }, role === 'user' ? 'Anda' : agent.input.selectedOptions[0]?.textContent || 'Asisten'), body))
    if (role === 'user') body.textContent = text
    messages.appendChild(row)
    messages.scrollTop = messages.scrollHeight
    return body
  }
  function drawHistory() {
    desc.textContent = agents.find((a) => a.key === currentAgent)?.description || ''
    const history = AI.getConversationHistory(currentAgent)
    messages.replaceChildren()
    if (!history.length) messages.appendChild(C.emptyState({ kicker: 'Mulai percakapan', iconName: 'message',
      title: 'Ada yang ingin Anda diskusikan?', body: 'Tanyakan alur kerja, siapkan penawaran, atau minta ringkasan bisnis.' }))
    history.forEach((h) => addMessage(h.role === 'user' ? 'user' : 'assistant', h.content))
  }
  agent.input.addEventListener('change', () => { currentAgent = agent.input.value; error.hide(); drawHistory() })
  ctx.signal?.addEventListener('abort', () => controller?.abort(), { once: true })
  drawHistory()
  drawStats()

  try {
    const models = await loadModels()
    if (ctx.signal?.aborted) return
    C.setOptions(model.input, models.map((m) => ({ value: m.id, label: m.name || m.id })), pickDefaultModel()?.id)
    send.disabled = false
  } catch (err) { error.show('danger', `Model tidak tersedia: ${err.message}`) }

  input.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!send.disabled) form.requestSubmit() }
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (controller || !input.input.value.trim() || !model.input.value) return
    const text = input.input.value.trim()
    input.input.value = ''
    error.hide()
    messages.querySelector('.empty')?.remove()
    addMessage('user', text)
    const response = addMessage('assistant', 'Sedang menyiapkan jawaban…')
    controller = new AbortController()
    const restore = C.setBusy(send, 'Menjawab…')
    agent.input.disabled = true
    model.input.disabled = true
    reset.disabled = true
    stop.hidden = false
    messages.setAttribute('aria-busy', 'true')
    let received = false
    try {
      for await (const event of AI.chatWithAgent({ agentKey: currentAgent, message: text, modelId: model.input.value, signal: controller.signal })) {
        if (ctx.signal?.aborted) break
        if (event.type === 'error') throw new Error(event.message)
        if (event.type === 'text') {
          received = true
          response.innerHTML = C.sanitizeHTML(event.full.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'))
          messages.scrollTop = messages.scrollHeight
        }
      }
      if (!received) response.textContent = 'AI tidak mengembalikan jawaban. Silakan coba lagi.'
    } catch (err) {
      if (err.name === 'AbortError') {
        if (!received) response.textContent = 'Percakapan dihentikan.'
      } else {
        if (!received) response.textContent = 'Jawaban belum tersedia.'
        error.show('danger', err.message)
      }
    } finally {
      controller = null
      restore()
      agent.input.disabled = false
      model.input.disabled = false
      reset.disabled = false
      stop.hidden = true
      messages.setAttribute('aria-busy', 'false')
      drawStats()
    }
  })
}

import * as AI from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'
import { t, has } from '../i18n/index.js'

const { el } = C
let currentAgent = 'general'
// Agent names/descriptions live in ai/superpowers.js (also loaded by tests); translate them here by key.
const agentText = (a, field) => (has(`assistant.agents.${a.key}.${field}`) ? t(`assistant.agents.${a.key}.${field}`) : a[field])

export async function render(container, ctx = {}) {
  let controller = null
  const agents = AI.getAgents().filter((a) => a.key !== 'social')
  const agent = C.select({ label: t('assistant.agentLabel'), id: 'chat-agent', value: currentAgent,
    options: agents.map((a) => ({ value: a.key, label: agentText(a, 'name') })) })
  const model = C.select({ label: t('assistant.modelLabel'), id: 'chat-model', options: [{ value: '', label: t('assistant.modelLoading') }] })
  const desc = el('p', { className: 'panel-lead' })
  const messages = el('div', { className: 'assistant-messages', role: 'log', 'aria-label': t('assistant.logLabel') })
  const input = C.textarea({ label: t('assistant.messageLabel'), id: 'chat-message', rows: 3, required: true,
    placeholder: t('assistant.messagePlaceholder'), hint: t('assistant.messageHint'), attrs: { maxlength: '8000' } })
  const send = C.button({ label: t('assistant.send'), icon: 'arrowUpRight', variant: 'primary', type: 'submit', disabled: true })
  const stop = C.button({ label: t('assistant.stop'), icon: 'stop', variant: 'soft', hidden: true, onClick: () => controller?.abort() })
  const reset = C.button({ label: t('assistant.reset'), icon: 'refresh', variant: 'ghost', size: 'sm', onClick: () => {
    AI.clearHistory(currentAgent)
    drawHistory()
  } })
  const error = C.message()
  const stats = el('div', { className: 'workspace-stats' })
  const form = el('form', { className: 'form assistant-composer' }, input.wrap,
    el('div', { className: 'form-actions' }, send, stop), error)

  container.replaceChildren(
    C.pageHeader({ title: t('assistant.title'), em: t('assistant.titleEm'), description: t('assistant.description') }),
    el('div', { className: 'stage-grid workspace-grid' },
      el('div', { className: 'workspace-stack' },
        C.panel({ title: t('assistant.panels.superpowers'), meta: t('assistant.panels.superpowersMeta') },
          el('div', { className: 'form' }, agent.wrap, model.wrap, desc),
          el('p', { className: 'field-hint' }, t('assistant.privacyHint'))),
        C.panel({ title: t('assistant.panels.activity'), meta: t('assistant.panels.activityMeta') }, stats)),
      C.panel({ title: t('assistant.panels.conversation'), actions: reset, className: 'assistant-panel' }, messages, form)))

  function drawStats() {
    const s = AI.getAnalyticsSummary()
    stats.replaceChildren(C.defList([
      [t('assistant.stats.conversations'), String(s.total)], [t('assistant.stats.success'), `${s.successRate}%`], [t('assistant.stats.avgResponse'), `${s.avgLatency} ms`],
    ]))
  }
  function addMessage(role, text) {
    const body = el('div', { className: 'assistant-message-text' })
    body.innerHTML = C.sanitizeHTML(text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'))
    const row = el('article', { className: `assistant-message is-${role}` },
      el('span', { className: 'assistant-avatar', 'aria-hidden': 'true' }, C.icon(role === 'user' ? 'user' : 'bot')),
      el('div', {}, el('b', { className: 'assistant-author' }, role === 'user' ? t('assistant.you') : agent.input.selectedOptions[0]?.textContent || t('assistant.agentLabel')), body))
    if (role === 'user') body.textContent = text
    messages.appendChild(row)
    messages.scrollTop = messages.scrollHeight
    return body
  }
  function drawHistory() {
    const cur = agents.find((a) => a.key === currentAgent)
    desc.textContent = cur ? agentText(cur, 'description') || '' : ''
    const history = AI.getConversationHistory(currentAgent)
    messages.replaceChildren()
    if (!history.length) messages.appendChild(C.emptyState({ kicker: t('assistant.empty.kicker'), iconName: 'message',
      title: t('assistant.empty.title'), body: t('assistant.empty.body') }))
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
  } catch (err) { error.show('danger', t('assistant.modelUnavailable', { message: err.message })) }

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
    const response = addMessage('assistant', t('assistant.preparing'))
    controller = new AbortController()
    const restore = C.setBusy(send, t('assistant.answering'))
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
      if (!received) response.textContent = t('assistant.noAnswer')
    } catch (err) {
      if (err.name === 'AbortError') {
        if (!received) response.textContent = t('assistant.stopped')
      } else {
        if (!received) response.textContent = t('assistant.notAvailable')
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

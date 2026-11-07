/**
 * Pengaturan › Email & AI: how this business sends email (Satu Alur's service or its own SMTP)
 * and which AI engine its features use (built-in, OpenAI-compatible, Anthropic-compatible).
 * Saved on the server (business_integrations); passwords and API keys are sent once and never shown again.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { getIntegrations, saveEmailIntegration, saveAiIntegration, testEmailIntegration, testAiIntegration, listAiModels } from '../integrations/api.js'
import { modelPicker } from '../ui/model-picker.js'
import { SMTP_PORTS_LIST } from '../admin/constants.js'
import { ANTHROPIC_DEFAULT_BASE } from '../admin/rules.js'
import { t } from '../i18n/index.js'

const { el } = C
let seq = 0
const KEEP = () => t('settings.integrations.keep')

function radios(legend, name, options, value) {
  const g = C.choiceGroup({ legend, type: 'radio', name, options: options.map((o) => ({ ...o, checked: o.value === value })) })
  g.value = () => Object.values(g.inputs).find((i) => i.checked)?.value
  return g
}

export async function renderIntegrationsTab(container) {
  container.replaceChildren(C.skeletonRows(4))
  let data
  try { data = await getIntegrations() } catch (ex) {
    const again = C.button({ label: t('settings.common.retry'), variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => renderIntegrationsTab(container))
    container.replaceChildren(C.errorState(ex.message), again)
    return
  }
  const parts = [emailSection(data, container), aiSection(data, container)]
  if (data.options.demo) {
    // Demo is 100% demo: sample data and simulated AI; nothing here can be changed.
    const note = C.message()
    note.show('info', t('settings.integrations.demoNote'))
    parts.forEach((p) => p.querySelectorAll('input, select, textarea, button').forEach((x) => { x.disabled = true }))
    parts.unshift(note)
  }
  container.replaceChildren(...parts)
}

function section(num, title, desc, ...children) {
  return el('section', { className: 'set-section' },
    el('div', { className: 'set-head' }, el('div', {},
      el('span', { className: 'set-num' }, num), el('h3', { className: 'set-title' }, title), el('p', { className: 'set-desc' }, desc))),
    ...children)
}

function emailSection(data, container) {
  const id = ++seq
  const e = data.email
  const opt = data.options
  const smtpOff = !opt.custom_smtp_allowed || !opt.secrets_enabled
  const mode = radios(t('settings.integrations.sendVia'), `set-email-mode-${id}`, [
    { value: 'platform', label: t('settings.integrations.platform'), hint: t('settings.integrations.platformHint') },
    { value: 'smtp', label: t('settings.integrations.ownSmtp'), hint: smtpOff ? (opt.custom_smtp_allowed ? t('settings.integrations.notAvailable') : t('settings.integrations.disabledByAdmin')) : t('settings.integrations.smtpHint'), disabled: smtpOff },
  ], e.mode)
  const off = { autocomplete: 'off', spellcheck: 'false', maxlength: '200' }
  const host = C.field({ label: t('settings.integrations.smtpHost'), id: `set-smtp-host-${id}`, value: e.smtp_host, placeholder: 'smtp.gmail.com', attrs: off })
  const port = C.select({ label: 'Port', id: `set-smtp-port-${id}`, options: SMTP_PORTS_LIST.map((p) => ({ value: String(p), label: [465, 2465].includes(p) ? `${p} (SSL/TLS)` : `${p} (STARTTLS)` })), value: String(e.smtp_port || 465) })
  const user = C.field({ label: 'Username', id: `set-smtp-user-${id}`, value: e.smtp_user, attrs: off })
  const pass = C.field({ label: t('settings.integrations.appPassword'), id: `set-smtp-pass-${id}`, type: 'password', placeholder: e.has_password ? KEEP() : undefined,
    hint: t('settings.integrations.secretHint'), attrs: { ...off, autocomplete: 'new-password' } })
  const fromEmail = C.field({ label: t('settings.email.fromEmail'), id: `set-smtp-from-${id}`, type: 'email', value: e.smtp_from_email, attrs: off })
  const fromName = C.field({ label: t('settings.email.fromName'), id: `set-smtp-name-${id}`, value: e.smtp_from_name, attrs: { maxlength: '60' } })
  const smtpBox = el('div', { className: 'set-subgrid' }, host.wrap, port.wrap, user.wrap, pass.wrap, fromEmail.wrap, fromName.wrap)
  const sync = () => { smtpBox.hidden = mode.value() !== 'smtp' }
  mode.wrap.addEventListener('change', sync)
  sync()

  const out = C.message()
  const save = C.button({ label: t('settings.integrations.saveEmail'), icon: 'save', variant: 'primary', size: 'sm' })
  const test = C.button({ label: t('settings.integrations.sendTestEmail'), icon: 'mail', variant: 'soft', size: 'sm' })
  save.addEventListener('click', async () => {
    const restore = C.setBusy(save, t('settings.common.saving'))
    try {
      await saveEmailIntegration({
        email_mode: mode.value(), smtp_host: host.input.value, smtp_port: Number(port.input.value), smtp_user: user.input.value,
        smtp_pass: pass.input.value, smtp_from_email: fromEmail.input.value, smtp_from_name: fromName.input.value,
      })
      showToast(t('settings.integrations.emailSaved'), 'success')
      renderIntegrationsTab(container)
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  test.addEventListener('click', async () => {
    const restore = C.setBusy(test, t('settings.common.sending'))
    try {
      const r = await testEmailIntegration()
      out.show('ok', r.simulated ? t('settings.integrations.emailSimulated') : t('settings.integrations.emailSent', { to: r.to }))
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  return section(t('settings.integrations.emailNum'), t('settings.integrations.emailTitle'), t('settings.integrations.emailDesc'),
    mode.wrap, smtpBox, el('div', { className: 'form-actions' }, save, test), out)
}

function aiSection(data, container) {
  const id = ++seq
  const a = data.ai
  const opt = data.options
  const customOff = !opt.custom_ai_allowed || !opt.secrets_enabled
  const why = opt.custom_ai_allowed ? t('settings.integrations.notAvailable') : t('settings.integrations.disabledByAdmin')
  const mode = radios(t('settings.integrations.aiEngine'), `set-ai-mode-${id}`, [
    { value: 'builtin', label: t('settings.integrations.builtin'), hint: t('settings.integrations.builtinHint') },
    { value: 'openai', label: 'OpenAI-compatible', hint: customOff ? why : t('settings.integrations.openaiHint'), disabled: customOff },
    { value: 'anthropic', label: 'Anthropic-compatible', hint: customOff ? why : t('settings.integrations.anthropicHint'), disabled: customOff },
  ], a.mode)
  const off = { autocomplete: 'off', spellcheck: 'false', maxlength: '300' }
  const base = C.field({ label: t('settings.integrations.apiBase'), id: `set-ai-base-${id}`, value: a.base_url, placeholder: 'https://api.openai.com/v1', attrs: off })
  const formValues = () => ({ ai_mode: mode.value(), ai_base_url: base.input.value, ai_model: model.input.value, ai_key: key.input.value })
  const picker = modelPicker({ id: `set-ai-model-${id}`, value: a.model, placeholder: 'gpt-4o-mini', fetchModels: () => listAiModels(formValues()) })
  const model = { input: picker.input, wrap: picker.wrap }
  const key = C.field({ label: 'API key', id: `set-ai-key-${id}`, type: 'password', placeholder: a.has_key ? KEEP() : undefined,
    hint: t('settings.integrations.secretHint'), attrs: { ...off, autocomplete: 'new-password' } })
  const box = el('div', { className: 'set-subgrid' }, base.wrap, model.wrap, key.wrap)
  const note = el('p', { className: 'muted small' }, t('settings.integrations.ownNote'))
  const sync = () => {
    const m = mode.value()
    box.hidden = m === 'builtin'
    note.hidden = m === 'builtin'
    if (m === 'anthropic' && !base.input.value) base.input.value = ANTHROPIC_DEFAULT_BASE
    base.input.placeholder = m === 'anthropic' ? ANTHROPIC_DEFAULT_BASE : 'https://api.openai.com/v1'
    model.input.placeholder = m === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'
    picker.reset()
  }
  mode.wrap.addEventListener('change', sync)
  sync()

  const out = C.message()
  const save = C.button({ label: t('settings.integrations.saveAi'), icon: 'save', variant: 'primary', size: 'sm' })
  const test = C.button({ label: t('settings.integrations.testAi'), icon: 'sparkles', variant: 'soft', size: 'sm' })
  // Saving a custom provider wants a passing test with the same values (or an explicit confirm).
  let tested = null
  save.addEventListener('click', async () => {
    const v = formValues()
    if (v.ai_mode !== 'builtin' && tested !== JSON.stringify(v) && !confirm(t('settings.integrations.confirmUntested'))) return
    const restore = C.setBusy(save, t('settings.common.saving'))
    try {
      await saveAiIntegration(v)
      showToast(t('settings.integrations.aiSaved'), 'success')
      renderIntegrationsTab(container)
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  test.addEventListener('click', async () => {
    const restore = C.setBusy(test, t('settings.common.testing'))
    try {
      const v = formValues()
      const r = await testAiIntegration(v)
      tested = JSON.stringify(v)
      out.show('ok', r.mode === 'builtin' ? (r.reply || t('settings.integrations.builtinReady')) : t('settings.integrations.aiConnected', { model: r.model || t('settings.integrations.yourModel'), reply: r.reply, ms: r.ms ? t('settings.integrations.inMs', { ms: r.ms }) : '' }))
    } catch (ex) { tested = null; out.show('danger', ex.message) } finally { restore() }
  })
  return section('AI · 02', t('settings.integrations.aiEngine'), t('settings.integrations.aiDesc'),
    mode.wrap, box, note, el('div', { className: 'form-actions' }, save, test), out)
}

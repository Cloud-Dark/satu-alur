/**
 * Pengaturan › Email & AI: how this business sends email (Satu Alur's service or its own SMTP)
 * and which AI engine its features use (built-in, OpenAI-compatible, Anthropic-compatible).
 * Saved on the server (business_integrations); passwords and API keys are sent once and never shown again.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { getIntegrations, saveEmailIntegration, saveAiIntegration, testEmailIntegration, testAiIntegration } from '../integrations/api.js'
import { SMTP_PORTS_LIST } from '../admin/constants.js'
import { ANTHROPIC_DEFAULT_BASE } from '../admin/rules.js'

const { el } = C
let seq = 0
const KEEP = 'Tersimpan. Kosongkan untuk tetap memakai yang lama.'

function radios(legend, name, options, value) {
  const g = C.choiceGroup({ legend, type: 'radio', name, options: options.map((o) => ({ ...o, checked: o.value === value })) })
  g.value = () => Object.values(g.inputs).find((i) => i.checked)?.value
  return g
}

export async function renderIntegrationsTab(container) {
  container.replaceChildren(C.skeletonRows(4))
  let data
  try { data = await getIntegrations() } catch (ex) {
    const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => renderIntegrationsTab(container))
    container.replaceChildren(C.errorState(ex.message), again)
    return
  }
  const parts = [emailSection(data, container), aiSection(data, container)]
  if (data.options.demo) {
    // Demo is 100% demo: sample data and simulated AI; nothing here can be changed.
    const note = C.message()
    note.show('info', 'Akun demo memakai data dan AI contoh. Pengaturan email dan mesin AI hanya bisa diubah di akun sungguhan.')
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
  const mode = radios('Kirim email lewat', `set-email-mode-${id}`, [
    { value: 'platform', label: 'Layanan email Satu Alur', hint: 'Paling mudah. Dikirim dari alamat Satu Alur dengan nama usaha Anda.' },
    { value: 'smtp', label: 'Server email saya sendiri (SMTP)', hint: smtpOff ? (opt.custom_smtp_allowed ? 'Belum tersedia di server ini.' : 'Dimatikan oleh admin Satu Alur.') : 'Mis. Gmail, Zoho, atau email domain usaha Anda.', disabled: smtpOff },
  ], e.mode)
  const off = { autocomplete: 'off', spellcheck: 'false', maxlength: '200' }
  const host = C.field({ label: 'Host SMTP', id: `set-smtp-host-${id}`, value: e.smtp_host, placeholder: 'smtp.gmail.com', attrs: off })
  const port = C.select({ label: 'Port', id: `set-smtp-port-${id}`, options: SMTP_PORTS_LIST.map((p) => ({ value: String(p), label: [465, 2465].includes(p) ? `${p} (SSL/TLS)` : `${p} (STARTTLS)` })), value: String(e.smtp_port || 465) })
  const user = C.field({ label: 'Username', id: `set-smtp-user-${id}`, value: e.smtp_user, attrs: off })
  const pass = C.field({ label: 'Password / app password', id: `set-smtp-pass-${id}`, type: 'password', placeholder: e.has_password ? KEEP : undefined,
    hint: 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.', attrs: { ...off, autocomplete: 'new-password' } })
  const fromEmail = C.field({ label: 'Email pengirim', id: `set-smtp-from-${id}`, type: 'email', value: e.smtp_from_email, attrs: off })
  const fromName = C.field({ label: 'Nama pengirim', id: `set-smtp-name-${id}`, value: e.smtp_from_name, attrs: { maxlength: '60' } })
  const smtpBox = el('div', { className: 'set-subgrid' }, host.wrap, port.wrap, user.wrap, pass.wrap, fromEmail.wrap, fromName.wrap)
  const sync = () => { smtpBox.hidden = mode.value() !== 'smtp' }
  mode.wrap.addEventListener('change', sync)
  sync()

  const out = C.message()
  const save = C.button({ label: 'Simpan email', icon: 'save', variant: 'primary', size: 'sm' })
  const test = C.button({ label: 'Kirim email uji', icon: 'mail', variant: 'soft', size: 'sm' })
  save.addEventListener('click', async () => {
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await saveEmailIntegration({
        email_mode: mode.value(), smtp_host: host.input.value, smtp_port: Number(port.input.value), smtp_user: user.input.value,
        smtp_pass: pass.input.value, smtp_from_email: fromEmail.input.value, smtp_from_name: fromName.input.value,
      })
      showToast('Pengaturan email disimpan.', 'success')
      renderIntegrationsTab(container)
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  test.addEventListener('click', async () => {
    const restore = C.setBusy(test, 'Mengirim…')
    try {
      const r = await testEmailIntegration()
      out.show('ok', r.simulated ? 'Simulasi: di akun demo email tidak benar-benar dikirim.' : `Email uji terkirim ke ${r.to}.`)
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  return section('Email · 01', 'Pengiriman email', 'Dipakai untuk mengirim penawaran ke pelanggan dan laporan ke Anda.',
    mode.wrap, smtpBox, el('div', { className: 'form-actions' }, save, test), out)
}

function aiSection(data, container) {
  const id = ++seq
  const a = data.ai
  const opt = data.options
  const customOff = !opt.custom_ai_allowed || !opt.secrets_enabled
  const why = opt.custom_ai_allowed ? 'Belum tersedia di server ini.' : 'Dimatikan oleh admin Satu Alur.'
  const mode = radios('Mesin AI', `set-ai-mode-${id}`, [
    { value: 'builtin', label: 'Mesin AI Satu Alur (bawaan)', hint: 'Termasuk kuota paket Anda.' },
    { value: 'openai', label: 'OpenAI-compatible', hint: customOff ? why : 'OpenAI, OpenRouter, Groq, Together, atau server lain yang kompatibel. Memakai API key Anda sendiri.', disabled: customOff },
    { value: 'anthropic', label: 'Anthropic-compatible', hint: customOff ? why : 'Claude atau server lain yang kompatibel. Memakai API key Anda sendiri.', disabled: customOff },
  ], a.mode)
  const off = { autocomplete: 'off', spellcheck: 'false', maxlength: '300' }
  const base = C.field({ label: 'Alamat API', id: `set-ai-base-${id}`, value: a.base_url, placeholder: 'https://api.openai.com/v1', attrs: off })
  const model = C.field({ label: 'Model', id: `set-ai-model-${id}`, value: a.model, placeholder: 'gpt-4o-mini', attrs: off })
  const key = C.field({ label: 'API key', id: `set-ai-key-${id}`, type: 'password', placeholder: a.has_key ? KEEP : undefined,
    hint: 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.', attrs: { ...off, autocomplete: 'new-password' } })
  const box = el('div', { className: 'set-subgrid' }, base.wrap, model.wrap, key.wrap)
  const note = el('p', { className: 'muted small' }, 'Dengan penyedia sendiri, biaya AI ditagih penyedia Anda dan kuota AI Satu Alur tidak terpakai.')
  const sync = () => {
    const m = mode.value()
    box.hidden = m === 'builtin'
    note.hidden = m === 'builtin'
    if (m === 'anthropic' && !base.input.value) base.input.value = ANTHROPIC_DEFAULT_BASE
    base.input.placeholder = m === 'anthropic' ? ANTHROPIC_DEFAULT_BASE : 'https://api.openai.com/v1'
    model.input.placeholder = m === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'
  }
  mode.wrap.addEventListener('change', sync)
  sync()

  const out = C.message()
  const save = C.button({ label: 'Simpan mesin AI', icon: 'save', variant: 'primary', size: 'sm' })
  const test = C.button({ label: 'Uji koneksi AI', icon: 'sparkles', variant: 'soft', size: 'sm' })
  save.addEventListener('click', async () => {
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await saveAiIntegration({ ai_mode: mode.value(), ai_base_url: base.input.value, ai_model: model.input.value, ai_key: key.input.value })
      showToast('Mesin AI disimpan.', 'success')
      renderIntegrationsTab(container)
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  test.addEventListener('click', async () => {
    const restore = C.setBusy(test, 'Menguji…')
    try {
      const r = await testAiIntegration()
      out.show('ok', r.mode === 'builtin' ? (r.reply || 'Mesin AI bawaan siap dipakai.') : `Terhubung ke ${r.model || 'model Anda'}: "${r.reply}".`)
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  return section('AI · 02', 'Mesin AI', 'Dipakai semua fitur AI: penawaran, laporan, radar, penasihat, media sosial, dan optimasi pendapatan.',
    mode.wrap, box, note, el('div', { className: 'form-actions' }, save, test), out)
}

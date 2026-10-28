/**
 * Settings / Configuration Stage
 * MCP Config (WhatsApp WAPilot, Email), Agent Skill Editor, Cloud Settings
 */

import * as Components from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { isUsingMockCloud } from '../cloud.js'

const STORAGE_KEYS = {
  mcp: 'satualur_settings_mcp',
  agent: 'satualur_settings_agent',
}

const DEFAULT_AGENT_PROMPTS = {
  offer: `Anda adalah agen penawaran untuk perusahaan jasa layanan di Indonesia.

Tugas Anda:
1. Analisis permintaan pelanggan (jenis layanan, lokasi, deskripsi)
2. Buat penawaran profesional dengan:
   - scope: ruang lingkup pekerjaan detail
   - price: estimasi harga dalam Rupiah (angka bulat)
   - terms: syarat dan ketentuan
   - notes: catatan tambahan

Aturan:
- Harga wajib realistis untuk pasar Indonesia
- Gunakan bahasa Indonesia profesional
- Sertakan garansi jika relevan
- Berikan estimasi waktu pengerjaan`,

  report: `Anda adalah analis laporan keuangan untuk perusahaan jasa.

Tugas Anda:
1. Analisis data keuangan periode terkini
2. Buat penjelasan komprehensif dalam format HTML yang mencakup:
   - Ringkasan pendapatan dan biaya
   - Analisis tren
   - Rekomendasi bisnis
   - Perbandingan dengan periode sebelumnya (jika data tersedia)

Aturan:
- Gunakan bahasa Indonesia profesional
- Format dengan tag HTML (h3, p, ul, li, strong)
- Berikan insight actionable, bukan sekadar data
- Gunakan format mata uang Rupiah`,
}

function loadSettings(key, defaults = {}) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
  } catch { return defaults }
}
function saveSettings(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

function getMcpSettings() {
  return loadSettings(STORAGE_KEYS.mcp, {
    whatsapp: { enabled: false, apiKey: '', wapilotEndpoint: 'https://api.wapilot.io/v1', phoneNumber: '', webhookUrl: '' },
    email: { enabled: false, smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '', fromName: '', fromEmail: '' },
  })
}

function getAgentSettings() {
  return loadSettings(STORAGE_KEYS.agent, {
    offerPrompt: DEFAULT_AGENT_PROMPTS.offer,
    reportPrompt: DEFAULT_AGENT_PROMPTS.report,
    temperature: 0.7,
    maxTokens: 2000,
    modelPreference: 'auto',
  })
}

let currentTab = 'mcp'

export function render(container) {
  container.innerHTML = ''

  const tabs = Components.el('div', { className: 'tab-group' })
  const tabDefs = [
    { key: 'mcp', label: 'MCP Connectors' },
    { key: 'agent', label: 'Agent Skills' },
    { key: 'cloud', label: 'Cloud' },
  ]
  tabDefs.forEach(t => {
    const btn = Components.el('button', {
      className: t.key === currentTab ? 'active' : '',
      onClick: () => { currentTab = t.key; render(container) },
    }, t.label)
    tabs.appendChild(btn)
  })

  const content = Components.el('div', {})
  if (currentTab === 'mcp') renderMcpTab(content)
  else if (currentTab === 'agent') renderAgentTab(content)
  else if (currentTab === 'cloud') renderCloudTab(content)

  container.appendChild(tabs)
  container.appendChild(content)
}

/* ---- MCP Tab ---- */
function renderMcpTab(container) {
  const settings = getMcpSettings()

  // WhatsApp WAPilot Section
  const waCard = Components.el('div', { className: 'form-card card-accent-orange' },
    Components.el('h3', { className: 'form-title' }, 'WhatsApp (WAPilot)'),
    Components.el('p', { className: 'form-subtitle' }, 'Hubungkan akun WhatsApp Business untuk notifikasi otomatis ke pelanggan dan tenaga kerja.')
  )

  const waToggle = createToggle('whatsapp-enabled', 'Aktifkan WhatsApp', settings.whatsapp.enabled, (v) => {
    settings.whatsapp.enabled = v
    saveSettings(STORAGE_KEYS.mcp, settings)
  })

  const waFields = Components.el('div', {},
    createField('WAPilot API Key', 'whatsapp-apikey', settings.whatsapp.apiKey, 'password', (v) => {
      settings.whatsapp.apiKey = v
      saveSettings(STORAGE_KEYS.mcp, settings)
    }, 'Dapatkan dari dashboard WAPilot'),
    createField('Endpoint API', 'whatsapp-endpoint', settings.whatsapp.wapilotEndpoint, 'text', (v) => {
      settings.whatsapp.wapilotEndpoint = v
      saveSettings(STORAGE_KEYS.mcp, settings)
    }),
    createField('Nomor WhatsApp', 'whatsapp-phone', settings.whatsapp.phoneNumber, 'text', (v) => {
      settings.whatsapp.phoneNumber = v
      saveSettings(STORAGE_KEYS.mcp, settings)
    }, 'Format: 628123456789'),
    createField('Webhook URL', 'whatsapp-webhook', settings.whatsapp.webhookUrl, 'text', (v) => {
      settings.whatsapp.webhookUrl = v
      saveSettings(STORAGE_KEYS.mcp, settings)
    }, 'URL untuk menerima pesan masuk')
  )

  const waActions = Components.el('div', { className: 'form-actions' },
    Components.el('button', { type: 'button', className: 'btn-secondary', onClick: () => testConnection('whatsapp') }, 'Test Koneksi')
  )

  waCard.appendChild(waToggle)
  waCard.appendChild(waFields)
  waCard.appendChild(waActions)

  // Email Section
  const emailCard = Components.el('div', { className: 'form-card card-accent-brown' },
    Components.el('h3', { className: 'form-title' }, 'Email (SMTP)'),
    Components.el('p', { className: 'form-subtitle' }, 'Konfigurasi SMTP untuk mengirim penawaran, invoice, dan laporan via email.')
  )

  const emailToggle = createToggle('email-enabled', 'Aktifkan Email', settings.email.enabled, (v) => {
    settings.email.enabled = v
    saveSettings(STORAGE_KEYS.mcp, settings)
  })

  const emailFields = Components.el('div', {},
    Components.el('div', { className: 'form-row' },
      createField('SMTP Host', 'email-host', settings.email.smtpHost, 'text', (v) => {
        settings.email.smtpHost = v
        saveSettings(STORAGE_KEYS.mcp, settings)
      }, 'Contoh: smtp.gmail.com'),
      createField('SMTP Port', 'email-port', settings.email.smtpPort, 'text', (v) => {
        settings.email.smtpPort = v
        saveSettings(STORAGE_KEYS.mcp, settings)
      })
    ),
    createField('SMTP Username', 'email-user', settings.email.smtpUser, 'text', (v) => {
      settings.email.smtpUser = v
      saveSettings(STORAGE_KEYS.mcp, settings)
    }),
    createField('SMTP Password', 'email-pass', settings.email.smtpPass, 'password', (v) => {
      settings.email.smtpPass = v
      saveSettings(STORAGE_KEYS.mcp, settings)
    }),
    Components.el('div', { className: 'form-row' },
      createField('From Name', 'email-fromname', settings.email.fromName, 'text', (v) => {
        settings.email.fromName = v
        saveSettings(STORAGE_KEYS.mcp, settings)
      }, 'Nama pengirim email'),
      createField('From Email', 'email-fromemail', settings.email.fromEmail, 'email', (v) => {
        settings.email.fromEmail = v
        saveSettings(STORAGE_KEYS.mcp, settings)
      })
    )
  )

  const emailActions = Components.el('div', { className: 'form-actions' },
    Components.el('button', { type: 'button', className: 'btn-secondary', onClick: () => testConnection('email') }, 'Test Koneksi')
  )

  emailCard.appendChild(emailToggle)
  emailCard.appendChild(emailFields)
  emailCard.appendChild(emailActions)

  container.appendChild(waCard)
  container.appendChild(emailCard)
}

/* ---- Agent Tab ---- */
function renderAgentTab(container) {
  const settings = getAgentSettings()

  const offerCard = Components.el('div', { className: 'form-card card-accent-sand' },
    Components.el('h3', { className: 'form-title' }, 'Prompt Penawaran AI'),
    Components.el('p', { className: 'form-subtitle' }, 'Instruksi sistem yang diberikan ke AI saat membuat penawaran. Sesuaikan sesuai kebutuhan bisnis Anda.')
  )

  const offerTextarea = Components.textareaField({
    label: 'Prompt',
    id: 'offer-prompt',
    value: settings.offerPrompt,
    rows: 10,
    onInput: (v) => {
      settings.offerPrompt = v
      saveSettings(STORAGE_KEYS.agent, settings)
    },
  })

  const offerActions = Components.el('div', { className: 'form-actions' },
    Components.el('button', { type: 'button', className: 'btn-secondary', onClick: () => {
      settings.offerPrompt = DEFAULT_AGENT_PROMPTS.offer
      saveSettings(STORAGE_KEYS.agent, settings)
      render(container.parentElement)
      showToast('Prompt penawaran direset ke default', 'info')
    } }, 'Reset ke Default')
  )

  offerCard.appendChild(offerTextarea)
  offerCard.appendChild(offerActions)

  const reportCard = Components.el('div', { className: 'form-card card-accent-secondary' },
    Components.el('h3', { className: 'form-title' }, 'Prompt Laporan AI'),
    Components.el('p', { className: 'form-subtitle' }, 'Instruksi sistem untuk AI saat menjelaskan laporan keuangan. Sesuaikan gaya dan format yang diinginkan.')
  )

  const reportTextarea = Components.textareaField({
    label: 'Prompt',
    id: 'report-prompt',
    value: settings.reportPrompt,
    rows: 10,
    onInput: (v) => {
      settings.reportPrompt = v
      saveSettings(STORAGE_KEYS.agent, settings)
    },
  })

  const reportActions = Components.el('div', { className: 'form-actions' },
    Components.el('button', { type: 'button', className: 'btn-secondary', onClick: () => {
      settings.reportPrompt = DEFAULT_AGENT_PROMPTS.report
      saveSettings(STORAGE_KEYS.agent, settings)
      render(container.parentElement)
      showToast('Prompt laporan direset ke default', 'info')
    } }, 'Reset ke Default')
  )

  reportCard.appendChild(reportTextarea)
  reportCard.appendChild(reportActions)

  const paramsCard = Components.el('div', { className: 'form-card card-accent-olive' },
    Components.el('h3', { className: 'form-title' }, 'Parameter AI'),
    Components.el('p', { className: 'form-subtitle' }, 'Pengaturan teknis untuk output AI.')
  )

  const paramsFields = Components.el('div', {},
    createSlider('Temperature', 'agent-temp', settings.temperature, 0, 1, 0.1, (v) => {
      settings.temperature = parseFloat(v)
      saveSettings(STORAGE_KEYS.agent, settings)
    }, '0 = deterministik, 1 = kreatif'),
    createSlider('Max Tokens', 'agent-tokens', settings.maxTokens, 500, 4000, 100, (v) => {
      settings.maxTokens = parseInt(v)
      saveSettings(STORAGE_KEYS.agent, settings)
    }),
    createSelect('Preferensi Model', 'agent-model', settings.modelPreference, [
      { value: 'auto', label: 'Auto (Rekomendasi Sistem)' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'claude-3', label: 'Claude 3' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Hemat)' },
    ], (v) => {
      settings.modelPreference = v
      saveSettings(STORAGE_KEYS.agent, settings)
    })
  )

  paramsCard.appendChild(paramsFields)

  container.appendChild(offerCard)
  container.appendChild(reportCard)
  container.appendChild(paramsCard)
}

/* ---- Cloud Tab ---- */
function renderCloudTab(container) {
  const cloudCard = Components.el('div', { className: 'form-card card-accent-orange' },
    Components.el('h3', { className: 'form-title' }, 'Cloud'),
    Components.el('p', { className: 'form-subtitle' }, 'Satu Alur berjalan di Cloudflare Workers + D1. Data dan AI diakses lewat API same-origin (/api), tanpa konfigurasi tambahan di browser.')
  )

  const mode = isUsingMockCloud() ? 'Mock lokal (dev, data di browser)' : 'Cloudflare Worker + D1'
  const statusBox = Components.el('div', { style: 'margin-top:16px;padding:16px;background:var(--primary-soft);border:1px solid rgba(230,126,34,0.2);border-radius:var(--radius-sm);' },
    Components.el('p', { style: 'margin:0;font-size:0.85rem;color:var(--text-muted);' }, `Mode aktif: ${mode}`)
  )

  cloudCard.appendChild(statusBox)
  container.appendChild(cloudCard)
}

/* ---- Helpers ---- */
function createField(label, id, value, type, onChange, hint = '') {
  const input = Components.el('input', {
    id,
    type,
    value,
    onInput: (e) => onChange(e.target.value),
  })
  const children = [
    Components.el('label', { htmlFor: id }, label),
    input,
  ]
  if (hint) children.push(Components.el('span', { className: 'field-hint' }, hint))
  return Components.el('div', { className: 'form-group' }, ...children)
}

function createTextArea(id, value, onChange, placeholder) {
  return Components.el('div', { className: 'form-group' },
    Components.el('textarea', {
      id,
      placeholder,
      value,
      onInput: (e) => onChange(e.target.value),
    })
  )
}

function createToggle(id, label, checked, onChange) {
  const input = Components.el('input', {
    id,
    type: 'checkbox',
    checked,
    onChange: (e) => onChange(e.target.checked),
  })
  return Components.el('div', { className: 'form-group', style: 'display:flex;align-items:center;gap:12px;flex-direction:row;' },
    Components.el('label', { className: 'toggle-switch' }, input,
      Components.el('span', { className: 'slider' })
    ),
    Components.el('label', { htmlFor: id, style: 'margin:0;cursor:pointer;font-weight:600;' }, label)
  )
}

function createSlider(label, id, value, min, max, step, onChange, hint = '') {
  const valDisplay = Components.el('span', { style: 'color:var(--primary);font-weight:700;' }, String(value))
  const input = Components.el('input', {
    id,
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    style: 'width:100%;margin-top:8px;',
    onInput: (e) => {
      valDisplay.textContent = e.target.value
      onChange(e.target.value)
    },
  })
  const children = [
    Components.el('label', { htmlFor: id }, `${label}: `, valDisplay),
    input,
  ]
  if (hint) children.push(Components.el('span', { className: 'field-hint' }, hint))
  return Components.el('div', { className: 'form-group' }, ...children)
}

function createSelect(label, id, value, options, onChange) {
  const select = Components.el('select', {
    id,
    onChange: (e) => onChange(e.target.value),
  })
  options.forEach(opt => {
    const option = Components.el('option', { value: opt.value }, opt.label)
    if (opt.value === value) option.setAttribute('selected', '')
    select.appendChild(option)
  })
  return Components.el('div', { className: 'form-group' },
    Components.el('label', { htmlFor: id }, label),
    select,
  )
}

function testConnection(type) {
  showToast(`Testing ${type} connection...`, 'info')
  setTimeout(() => {
    showToast(`${type === 'whatsapp' ? 'WhatsApp' : 'Email'} connection: OK (Mock)`, 'success')
  }, 1500)
}

/* ---- Public API for other modules ---- */
export function getAgentPrompts() {
  const s = getAgentSettings()
  return { offer: s.offerPrompt, report: s.reportPrompt }
}

export function getAgentParams() {
  const s = getAgentSettings()
  return { temperature: s.temperature, maxTokens: s.maxTokens, modelPreference: s.modelPreference }
}

export function getMcpConfig() {
  return getMcpSettings()
}

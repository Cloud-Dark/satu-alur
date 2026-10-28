/**
 * Settings (rendered inside the shell's right drawer):
 * MCP connectors (WhatsApp WAPilot, Email SMTP), agent prompts + parameters,
 * cloud status. Everything is stored in this browser's localStorage.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { isUsingMockCloud } from '../cloud.js'
import { loadModels } from '../ai/models.js'

const { el, icon } = C

const STORAGE_KEYS = {
  mcp: 'satualur_settings_mcp',
  agent: 'satualur_settings_agent',
  tab: 'satualur_settings_tab',
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
    const stored = JSON.parse(localStorage.getItem(key) || '{}')
    // Merge one level deep so new default fields survive older saved objects.
    const out = { ...defaults }
    for (const [k, v] of Object.entries(stored)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && defaults[k] && typeof defaults[k] === 'object'
        ? { ...defaults[k], ...v }
        : v
    }
    return out
  } catch { return { ...defaults } }
}
function saveSettings(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* storage unavailable */ }
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

let currentTab = null

export function render(container) {
  if (!currentTab) {
    try { currentTab = localStorage.getItem(STORAGE_KEYS.tab) || 'mcp' } catch { currentTab = 'mcp' }
  }
  const tabs = C.segmented({
    label: 'Bagian pengaturan',
    value: currentTab,
    options: [
      { value: 'mcp', label: 'Konektor' },
      { value: 'agent', label: 'Agen AI' },
      { value: 'cloud', label: 'Cloud' },
    ],
    onChange: (v) => {
      currentTab = v
      try { localStorage.setItem(STORAGE_KEYS.tab, v) } catch { /* ignore */ }
      draw()
    },
  })
  tabs.classList.add('seg-block')
  const content = el('div', { className: 'set-content' })
  container.replaceChildren(tabs, content)

  function draw() {
    content.replaceChildren()
    if (currentTab === 'agent') renderAgentTab(content, draw)
    else if (currentTab === 'cloud') renderCloudTab(content)
    else renderMcpTab(content)
  }
  draw()
}

/* ------------------------------------------------------------- Helpers */

function setSection({ num, title, desc, toggle }, ...children) {
  return el('section', { className: 'set-section' },
    el('div', { className: 'set-head' },
      el('div', {},
        el('span', { className: 'set-num' }, num),
        el('h3', { className: 'set-title' }, title),
        desc ? el('p', { className: 'set-desc' }, desc) : null,
      ),
      toggle || null,
    ),
    ...children,
  )
}

function switchControl({ id, label, checked, onChange }) {
  const input = el('input', { id, type: 'checkbox', className: 'switch-input', role: 'switch', checked })
  input.addEventListener('change', () => onChange(input.checked))
  return el('label', { className: 'switch', htmlFor: id }, input, el('span', { className: 'switch-track', 'aria-hidden': 'true' }), el('span', { className: 'switch-label' }, label))
}

function textField(label, id, value, type, onChange, hint = '') {
  const f = C.field({ label, id, type, value, hint, attrs: { autocomplete: type === 'password' ? 'new-password' : 'off', spellcheck: 'false' } })
  f.input.addEventListener('input', () => onChange(f.input.value))
  return f.wrap
}

function rangeField({ label, id, value, min, max, step, hint, onChange }) {
  const out = el('output', { className: 'range-out tnum', htmlFor: id }, String(value))
  const input = el('input', { id, type: 'range', className: 'range', min: String(min), max: String(max), step: String(step), value: String(value) })
  input.addEventListener('input', () => { out.textContent = input.value; onChange(input.value) })
  return el('div', { className: 'field' },
    el('label', { className: 'field-label', htmlFor: id }, el('span', {}, label), out),
    input,
    hint ? el('span', { className: 'field-hint' }, hint) : null,
  )
}

function testConnection(type, cfg) {
  const name = type === 'whatsapp' ? 'WhatsApp' : 'Email'
  const missing = type === 'whatsapp'
    ? [!cfg.apiKey && 'API key', !cfg.phoneNumber && 'nomor WhatsApp'].filter(Boolean)
    : [!cfg.smtpHost && 'SMTP host', !cfg.smtpUser && 'username', !cfg.fromEmail && 'email pengirim'].filter(Boolean)
  if (missing.length) {
    showToast(`${name}: lengkapi ${missing.join(', ')} terlebih dahulu.`, 'error')
    return
  }
  // There is no server-side connector endpoint yet; be honest about it.
  showToast(`${name}: konfigurasi lengkap dan tersimpan di browser. Uji kirim membutuhkan konektor server yang belum tersedia.`, 'info', 5200)
}

/* ------------------------------------------------------------- MCP tab */
function renderMcpTab(container) {
  const settings = getMcpSettings()
  const save = () => saveSettings(STORAGE_KEYS.mcp, settings)
  const wa = settings.whatsapp
  const em = settings.email

  container.append(
    el('p', { className: 'set-lead' }, 'Konektor dipakai untuk mengirim notifikasi ke pelanggan dan tenaga kerja. Kredensial tersimpan lokal di browser ini.'),
    setSection({
      num: 'MCP · 01', title: 'WhatsApp (WAPilot)', desc: 'Notifikasi otomatis lewat WhatsApp Business.',
      toggle: switchControl({ id: 'whatsapp-enabled', label: 'Aktif', checked: wa.enabled, onChange: (v) => { wa.enabled = v; save() } }),
    },
      textField('WAPilot API key', 'whatsapp-apikey', wa.apiKey, 'password', (v) => { wa.apiKey = v; save() }, 'Dari dasbor WAPilot.'),
      textField('Endpoint API', 'whatsapp-endpoint', wa.wapilotEndpoint, 'url', (v) => { wa.wapilotEndpoint = v; save() }),
      el('div', { className: 'form-row' },
        textField('Nomor WhatsApp', 'whatsapp-phone', wa.phoneNumber, 'tel', (v) => { wa.phoneNumber = v; save() }, 'Format 628123456789.'),
        textField('Webhook URL', 'whatsapp-webhook', wa.webhookUrl, 'url', (v) => { wa.webhookUrl = v; save() }, 'Untuk pesan masuk.'),
      ),
      el('div', { className: 'form-actions' }, C.button({ label: 'Periksa konfigurasi', icon: 'plug', size: 'sm', onClick: () => testConnection('whatsapp', wa) })),
    ),
    setSection({
      num: 'MCP · 02', title: 'Email (SMTP)', desc: 'Kirim penawaran, invoice, dan laporan lewat email.',
      toggle: switchControl({ id: 'email-enabled', label: 'Aktif', checked: em.enabled, onChange: (v) => { em.enabled = v; save() } }),
    },
      el('div', { className: 'form-row form-row-2-1' },
        textField('SMTP host', 'email-host', em.smtpHost, 'text', (v) => { em.smtpHost = v; save() }, 'Contoh: smtp.gmail.com'),
        textField('Port', 'email-port', em.smtpPort, 'text', (v) => { em.smtpPort = v; save() }),
      ),
      el('div', { className: 'form-row' },
        textField('Username', 'email-user', em.smtpUser, 'text', (v) => { em.smtpUser = v; save() }),
        textField('Password', 'email-pass', em.smtpPass, 'password', (v) => { em.smtpPass = v; save() }),
      ),
      el('div', { className: 'form-row' },
        textField('Nama pengirim', 'email-fromname', em.fromName, 'text', (v) => { em.fromName = v; save() }),
        textField('Email pengirim', 'email-fromemail', em.fromEmail, 'email', (v) => { em.fromEmail = v; save() }),
      ),
      el('div', { className: 'form-actions' }, C.button({ label: 'Periksa konfigurasi', icon: 'plug', size: 'sm', onClick: () => testConnection('email', em) })),
    ),
  )
}

/* ----------------------------------------------------------- Agent tab */
function renderAgentTab(container, redraw) {
  const settings = getAgentSettings()
  const save = () => saveSettings(STORAGE_KEYS.agent, settings)

  const promptBlock = (num, title, desc, key, defKey, id) => {
    const ta = C.textarea({ label: 'Prompt sistem', id, rows: 12, value: settings[key], attrs: { spellcheck: 'false', className: 'input input-code' } })
    ta.input.addEventListener('input', () => { settings[key] = ta.input.value; save() })
    const isDefault = settings[key] === DEFAULT_AGENT_PROMPTS[defKey]
    return setSection({ num, title, desc },
      ta.wrap,
      el('div', { className: 'form-actions' },
        C.button({
          label: 'Kembalikan default', icon: 'refresh', size: 'sm', variant: 'ghost', disabled: isDefault,
          onClick: () => { settings[key] = DEFAULT_AGENT_PROMPTS[defKey]; save(); redraw(); showToast('Prompt dikembalikan ke default.', 'info') },
        }),
        el('span', { className: 'field-hint tnum' }, `${settings[key].length} karakter`),
      ),
    )
  }

  const modelSel = C.select({ label: 'Preferensi model', id: 'agent-model', options: [{ value: 'auto', label: 'Otomatis (model pertama yang tersedia)' }], value: 'auto', hint: 'Dipakai untuk penawaran dan laporan.' })
  modelSel.input.addEventListener('change', () => { settings.modelPreference = modelSel.input.value; save() })
  loadModels().then((models) => {
    const opts = [{ value: 'auto', label: 'Otomatis (model pertama yang tersedia)' }, ...models.map((m) => ({ value: m.id, label: m.name || m.id }))]
    const pref = settings.modelPreference
    if (pref && pref !== 'auto' && !models.some((m) => m.id === pref)) opts.push({ value: pref, label: `${pref} (tidak tersedia)` })
    C.setOptions(modelSel.input, opts, pref || 'auto')
  }).catch(() => C.setOptions(modelSel.input, [{ value: 'auto', label: 'Otomatis' }], 'auto'))

  container.append(
    promptBlock('Agen · 01', 'Prompt penawaran', 'Instruksi untuk AI saat menyusun penawaran (tahap 02). Output wajib JSON: scope, price, terms, notes.', 'offerPrompt', 'offer', 'offer-prompt'),
    promptBlock('Agen · 02', 'Prompt laporan', 'Instruksi untuk AI saat menjelaskan laporan (tahap 06). Output HTML disanitasi sebelum ditampilkan.', 'reportPrompt', 'report', 'report-prompt'),
    setSection({ num: 'Agen · 03', title: 'Parameter', desc: 'Pengaturan teknis output AI.' },
      rangeField({ label: 'Temperature', id: 'agent-temp', value: settings.temperature, min: 0, max: 1, step: 0.1, hint: '0 = konsisten, 1 = lebih kreatif.', onChange: (v) => { settings.temperature = parseFloat(v); save() } }),
      rangeField({ label: 'Maks token', id: 'agent-tokens', value: settings.maxTokens, min: 500, max: 4000, step: 100, onChange: (v) => { settings.maxTokens = parseInt(v, 10); save() } }),
      modelSel.wrap,
    ),
  )
}

/* ----------------------------------------------------------- Cloud tab */
function renderCloudTab(container) {
  const mock = isUsingMockCloud()
  container.append(
    setSection({ num: 'Cloud · 01', title: 'Infrastruktur', desc: 'Satu Alur berjalan di Cloudflare Workers + D1. Data dan AI diakses lewat API same-origin (/api), tanpa konfigurasi tambahan di browser.' },
      el('div', { className: `cloud-status ${mock ? 'is-demo' : 'is-live'}` },
        el('span', { className: 'pulse-dot mode-dot', 'aria-hidden': 'true' }),
        el('div', {},
          el('span', { className: 'set-num' }, 'Mode aktif'),
          el('p', { className: 'cloud-mode' }, mock ? 'Mock lokal — data disimpan di browser ini' : 'Cloudflare Worker + D1'),
        ),
      ),
      C.defList([
        ['Database', mock ? 'localStorage (satualur_mock_v1)' : 'Cloudflare D1'],
        ['AI', mock ? 'Simulasi streaming lokal' : 'Workers AI melalui /api/llm'],
        ['Sesi', mock ? 'Di memori; hilang saat halaman dimuat ulang' : 'Token di localStorage'],
      ]),
    ),
  )
  if (mock) {
    container.append(el('div', { className: 'note note-info' }, icon('info'),
      el('div', { className: 'note-body' }, el('p', {}, 'Mode demo cocok untuk mencoba alur. Data contoh dibuat otomatis pada kunjungan pertama.'))))
  }
}

/* ---------------------------------------------- Public API (ai/agent.js) */
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

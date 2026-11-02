/**
 * Settings (rendered inside the shell's right drawer):
 * connectors (WhatsApp WAPilot, Email SMTP), MCP / ERP integration, migration
 * wizard, sync logs, and agent prompts + parameters.
 * Notification credentials live in this browser's localStorage; MCP connectors,
 * mappings and migrations live in D1 behind /api/mcp/*.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { loadModels } from '../ai/models.js'
import {
  listConnectors, createConnector, updateConnector, deleteConnector,
  testConnection, runSync, listSyncLogs, listSyncErrors,
  listMappings, saveMapping, deleteMapping,
  columnsFromRows, csvToRows, CONNECTOR_TEMPLATES, CONNECTOR_TYPE_LABELS,
} from '../mcp/connector.js'
import { SATU_ALUR_SCHEMA, suggestMapping, validateMapping, previewTransform } from '../mcp/mapper.js'
import {
  listMigrations, createMigration, getMigration, runMigrationPhase,
  rollbackMigration, generateValidationReport, MIGRATION_PHASES,
} from '../mcp/migration.js'

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
  if (!['mcp', 'erp', 'migration', 'logs', 'agent'].includes(currentTab)) currentTab = 'mcp'
  const tabs = C.segmented({
    label: 'Bagian pengaturan',
    value: currentTab,
    options: [
      { value: 'mcp', label: 'Konektor' },
      { value: 'erp', label: 'ERP & Integrasi' },
      { value: 'migration', label: 'Migrasi' },
      { value: 'logs', label: 'Log' },
      { value: 'agent', label: 'Agen AI' },
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
    else if (currentTab === 'erp') renderErpTab(content, draw)
    else if (currentTab === 'migration') renderMigrationTab(content, draw)
    else if (currentTab === 'logs') renderLogsTab(content)
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

function selectField({ label, id, options, value, hint, onChange }) {
  const sel = C.select({ label, id, options, value, hint })
  sel.input.addEventListener('change', () => onChange(sel.input.value))
  return sel.wrap
}

function testConnectionLegacy(type, cfg) {
  const name = type === 'whatsapp' ? 'WhatsApp' : 'Email'
  const missing = type === 'whatsapp'
    ? [!cfg.apiKey && 'API key', !cfg.phoneNumber && 'nomor WhatsApp'].filter(Boolean)
    : [!cfg.smtpHost && 'SMTP host', !cfg.smtpUser && 'username', !cfg.fromEmail && 'email pengirim'].filter(Boolean)
  if (missing.length) {
    showToast(`${name}: lengkapi ${missing.join(', ')} terlebih dahulu.`, 'error')
    return
  }
  showToast(`${name}: konfigurasi lengkap dan tersimpan di browser. Uji kirim membutuhkan konektor server yang belum tersedia.`, 'info', 5200)
}

/* ------------------------------------------------------------- MCP tab (legacy: WhatsApp + Email) */
function renderMcpTab(container) {
  const settings = getMcpSettings()
  const save = () => saveSettings(STORAGE_KEYS.mcp, settings)
  const wa = settings.whatsapp
  const em = settings.email

  container.append(
    el('p', { className: 'set-lead' }, 'Konektor dipakai untuk mengirim notifikasi ke pelanggan dan tenaga kerja. Kredensial tersimpan lokal di browser ini.'),
    setSection({
      num: 'Konektor · 01', title: 'WhatsApp (WAPilot)', desc: 'Notifikasi otomatis lewat WhatsApp Business.',
      toggle: switchControl({ id: 'whatsapp-enabled', label: 'Aktif', checked: wa.enabled, onChange: (v) => { wa.enabled = v; save() } }),
    },
      textField('WAPilot API key', 'whatsapp-apikey', wa.apiKey, 'password', (v) => { wa.apiKey = v; save() }, 'Dari dasbor WAPilot.'),
      textField('Endpoint API', 'whatsapp-endpoint', wa.wapilotEndpoint, 'url', (v) => { wa.wapilotEndpoint = v; save() }),
      el('div', { className: 'form-row' },
        textField('Nomor WhatsApp', 'whatsapp-phone', wa.phoneNumber, 'tel', (v) => { wa.phoneNumber = v; save() }, 'Format 628123456789.'),
        textField('Webhook URL', 'whatsapp-webhook', wa.webhookUrl, 'url', (v) => { wa.webhookUrl = v; save() }, 'Untuk pesan masuk.'),
      ),
      el('div', { className: 'form-actions' }, C.button({ label: 'Periksa konfigurasi', icon: 'plug', size: 'sm', onClick: () => testConnectionLegacy('whatsapp', wa) })),
    ),
    setSection({
      num: 'Konektor · 02', title: 'Email (SMTP)', desc: 'Kirim penawaran, invoice, dan laporan lewat email.',
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
      el('div', { className: 'form-actions' }, C.button({ label: 'Periksa konfigurasi', icon: 'plug', size: 'sm', onClick: () => testConnectionLegacy('email', em) })),
    ),
  )
}
/* ------------------------------------------------------------- ERP & Integrasi tab */

function loadingBox(message = 'Memuat…') {
  return el('div', { className: 'mcp-loading' },
    el('span', { className: 'mcp-spinner', 'aria-hidden': 'true' }),
    el('span', {}, message),
  )
}

function errorBox(err, retry) {
  return el('div', { className: 'mcp-error-box' },
    el('span', { className: 'mcp-error-ic', 'aria-hidden': 'true' }, icon('alert', { size: 18 })),
    el('div', { className: 'mcp-error-body' },
      el('strong', {}, 'Gagal memuat data'),
      el('p', {}, String(err?.message || err)),
    ),
    retry ? C.button({ label: 'Coba lagi', icon: 'refresh', size: 'xs', variant: 'ghost', onClick: retry }) : null,
  )
}

function statusLabel(connector) {
  if (!connector.enabled) return 'nonaktif'
  return connector.status === 'error' ? 'error' : 'aktif'
}

function connectorSummary(connector) {
  const c = connector.config || {}
  if (connector.type === 'rest') return c.endpoint?.baseUrl || 'URL belum diisi'
  if (connector.type === 'database') {
    const conn = c.connection || {}
    return `${conn.driver || 'mysql'}://${conn.host || '-'}${conn.database ? `/${conn.database}` : ''}`
  }
  if (connector.type === 'file') return `Format ${String(c.format || 'csv').toUpperCase()}`
  return 'Webhook masuk'
}

function renderErpTab(container) {
  let sampleRows = null
  let sampleColumns = []

  /* ---------------------------------------------------------------- list */
  async function showList() {
    container.replaceChildren(loadingBox('Memuat konektor…'))
    let connectors
    try {
      connectors = await listConnectors()
    } catch (err) {
      container.replaceChildren(errorBox(err, showList))
      return
    }

    const header = el('div', { className: 'set-head-flex' },
      el('div', {},
        el('h3', { className: 'set-title' }, 'Konektor Sistem Eksternal'),
        el('p', { className: 'set-desc' }, 'Hubungkan Satu Alur dengan ERP, database, atau sistem lain yang sudah Anda pakai.'),
      ),
      C.button({ label: 'Tambah Konektor', icon: 'plus', size: 'sm', onClick: () => showForm() }),
    )

    const grid = el('div', { className: 'mcp-connector-grid' })

    if (connectors.length === 0) {
      grid.append(el('div', { className: 'mcp-empty' },
        icon('plug', { size: 30 }),
        el('p', {}, 'Belum ada konektor'),
        el('p', { className: 'set-desc' }, 'Tambahkan konektor ke ERP, database, atau impor file untuk mulai mengintegrasikan data.'),
      ))
    } else {
      for (const conn of connectors) {
        grid.append(el('div', { className: 'mcp-card' },
          el('div', { className: 'mcp-card-head' },
            el('div', { className: 'mcp-card-title' },
              el('span', { className: `mcp-status ${conn.enabled ? 'active' : 'inactive'}` }),
              el('strong', {}, conn.name),
              el('span', { className: 'mcp-type-badge' }, CONNECTOR_TYPE_LABELS[conn.type] || conn.type),
            ),
            el('div', { className: 'mcp-card-actions' },
              C.button({
                label: 'Uji', icon: 'plug', size: 'xs', variant: 'ghost',
                onClick: async () => {
                  showToast('Memeriksa koneksi…', 'info')
                  try {
                    const res = await testConnection(conn.id)
                    showToast(res.message, res.ok ? 'success' : 'error', 6000)
                    showList()
                  } catch (err) { showToast(String(err.message || err), 'error', 6000) }
                },
              }),
              C.button({ label: 'Peta', icon: 'map', size: 'xs', variant: 'ghost', onClick: () => showMapping(conn) }),
              conn.type === 'file'
                ? C.button({ label: 'Impor', icon: 'upload', size: 'xs', variant: 'ghost', onClick: () => showImport(conn) })
                : null,
              C.button({
                label: conn.enabled ? 'Nonaktifkan' : 'Aktifkan', icon: 'power', size: 'xs', variant: 'ghost',
                onClick: async () => {
                  try {
                    await updateConnector(conn.id, { enabled: !conn.enabled })
                    showList()
                  } catch (err) { showToast(String(err.message || err), 'error') }
                },
              }),
              C.button({
                label: 'Hapus', icon: 'trash', size: 'xs', variant: 'ghost',
                onClick: async () => {
                  if (!confirm(`Hapus konektor "${conn.name}"? Pemetaan dan lognya ikut terhapus.`)) return
                  try {
                    await deleteConnector(conn.id)
                    showToast('Konektor dihapus.', 'success')
                    showList()
                  } catch (err) { showToast(String(err.message || err), 'error') }
                },
              }),
            ),
          ),
          el('div', { className: 'mcp-card-meta' }, connectorSummary(conn)),
          el('div', { className: 'mcp-card-stats' },
            el('span', {}, `status: ${statusLabel(conn)}`),
            el('span', {}, conn.lastSyncAt
              ? `sinkron terakhir ${new Date(conn.lastSyncAt).toLocaleString('id-ID')}`
              : 'belum pernah sinkron'),
            conn.hasSecrets ? el('span', {}, 'kredensial tersimpan') : null,
          ),
          conn.lastError ? el('p', { className: 'mcp-card-error' }, conn.lastError) : null,
        ))
      }
    }

    const templates = el('div', { className: 'mcp-templates' },
      el('h4', {}, 'Template cepat'),
      el('div', { className: 'mcp-template-grid' },
        templateCard('Odoo', 'rest', 'REST API, open source'),
        templateCard('SAP B1', 'rest', 'Service Layer'),
        templateCard('MySQL', 'database', 'Database langsung'),
        templateCard('PostgreSQL', 'database', 'Database langsung'),
        templateCard('CSV / Excel', 'file', 'Impor dari file'),
        templateCard('Webhook', 'webhook', 'Event real-time'),
      ),
    )

    container.replaceChildren(header, grid, templates)
  }

  function templateCard(name, type, desc) {
    return el('button', { className: 'mcp-template-card', onclick: () => showForm(type, name) },
      el('strong', {}, name),
      el('span', {}, desc),
    )
  }

  /* ---------------------------------------------------------------- form */
  function showForm(presetType = 'rest', presetName = '') {
    let type = presetType
    const form = { name: presetName, enabled: false, ...structuredClone(CONNECTOR_TEMPLATES[type]) }
    form.name = presetName

    const typeSelect = C.select({
      label: 'Tipe konektor', id: 'mcp-type',
      options: [
        { value: 'rest', label: 'REST API (Odoo, SAP, NetSuite)' },
        { value: 'database', label: 'Database langsung (MySQL, PostgreSQL)' },
        { value: 'file', label: 'Impor file (CSV, Excel)' },
        { value: 'webhook', label: 'Webhook (real-time)' },
      ],
      value: type,
      onChange: (v) => {
        type = v
        const fresh = structuredClone(CONNECTOR_TEMPLATES[v])
        Object.assign(form, fresh)
        form.name = typeSelect.input.value === v ? form.name : form.name
        renderFields()
      },
    })

    const fields = el('div', {})

    function renderFields() {
      fields.replaceChildren()

      const nameField = textField('Nama konektor', 'mcp-name', form.name, 'text', (v) => { form.name = v }, 'Contoh: Odoo Production')
      fields.append(nameField)

      if (type === 'rest') {
        fields.append(
          textField('Base URL', 'mcp-url', form.endpoint?.baseUrl || '', 'url', (v) => { form.endpoint.baseUrl = v }, 'https://erp.perusahaan.id/api/v1'),
          el('div', { className: 'form-row' },
            C.select({
              label: 'Autentikasi', id: 'mcp-auth',
              options: [
                { value: 'apikey', label: 'API Key' },
                { value: 'basic', label: 'Basic Auth' },
                { value: 'oauth2', label: 'OAuth 2.0 (bearer token)' },
              ],
              value: form.auth?.type || 'apikey',
              onChange: (v) => { form.auth.type = v },
            }).wrap,
            textField('API key / token', 'mcp-key', form.auth?.apiKey || '', 'password', (v) => { form.auth.apiKey = v }, 'Disimpan terenkripsi di server.'),
          ),
          textField('Username (Basic Auth)', 'mcp-user', form.auth?.username || '', 'text', (v) => { form.auth.username = v }, 'Kosongkan jika memakai API key.'),
        )
      } else if (type === 'database') {
        fields.append(
          C.select({
            label: 'Driver', id: 'mcp-driver',
            options: [
              { value: 'mysql', label: 'MySQL' },
              { value: 'postgresql', label: 'PostgreSQL' },
              { value: 'mssql', label: 'SQL Server' },
              { value: 'sqlite', label: 'SQLite' },
            ],
            value: form.connection?.driver || 'mysql',
            onChange: (v) => { form.connection.driver = v },
          }).wrap,
          el('div', { className: 'form-row' },
            textField('Host', 'mcp-host', form.connection?.host || '', 'text', (v) => { form.connection.host = v }, 'db.perusahaan.id'),
            textField('Port', 'mcp-port', String(form.connection?.port || 3306), 'text', (v) => { form.connection.port = parseInt(v, 10) || 3306 }),
          ),
          textField('Nama database', 'mcp-db', form.connection?.database || '', 'text', (v) => { form.connection.database = v }),
          el('div', { className: 'form-row' },
            textField('Username', 'mcp-dbuser', form.connection?.username || '', 'text', (v) => { form.connection.username = v }),
            textField('Password', 'mcp-dbpass', form.connection?.password || '', 'password', (v) => { form.connection.password = v }, 'Disimpan terenkripsi.'),
          ),
          el('p', { className: 'field-hint' }, 'Koneksi database langsung memerlukan agen jembatan (bridge agent) di jaringan Anda. Tanpa itu, gunakan impor file atau REST API.'),
        )
      } else if (type === 'file') {
        fields.append(
          C.select({
            label: 'Format', id: 'mcp-format',
            options: [
              { value: 'csv', label: 'CSV' },
              { value: 'xlsx', label: 'Excel (.xlsx)' },
              { value: 'json', label: 'JSON' },
            ],
            value: form.format || 'csv',
            onChange: (v) => { form.format = v },
          }).wrap,
          el('div', { className: 'form-row' },
            textField('Delimiter', 'mcp-delim', form.delimiter || ',', 'text', (v) => { form.delimiter = v }, 'Koma untuk CSV standar; titik koma untuk ekspor Excel Indonesia.'),
            textField('Encoding', 'mcp-encoding', form.encoding || 'utf-8', 'text', (v) => { form.encoding = v }),
          ),
        )
      } else if (type === 'webhook') {
        fields.append(
          textField('Secret webhook', 'mcp-secret', form.secret || '', 'password', (v) => { form.secret = v }, 'Minimal 16 karakter. Dipakai untuk verifikasi HMAC-SHA256.'),
          el('p', { className: 'field-hint' }, 'Endpoint yang dibagikan ke sistem sumber: POST /api/mcp/webhook/<id konektor>, header X-MCP-Signature.'),
        )
      }

      fields.append(
        C.select({
          label: 'Strategi sinkronisasi', id: 'mcp-strategy',
          options: [
            { value: 'manual', label: 'Manual' },
            { value: 'scheduled', label: 'Terjadwal' },
            { value: 'realtime', label: 'Real-time (webhook)' },
          ],
          value: form.sync?.strategy || 'manual',
          onChange: (v) => { form.sync.strategy = v },
        }).wrap,
      )

      if ((form.sync?.strategy || 'manual') === 'scheduled') {
        fields.append(textField('Jadwal (cron)', 'mcp-cron', form.sync?.schedule || '', 'text', (v) => { form.sync.schedule = v }, 'Contoh: 0 2 * * * (setiap hari pukul 02.00).'))
      }
    }

    renderFields()

    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        C.button({ label: 'Kembali', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: showList }),
        el('h3', { className: 'set-title' }, 'Tambah konektor'),
      ),
      typeSelect.wrap,
      fields,
      el('label', { className: 'checkbox-label' },
        el('input', { type: 'checkbox', checked: form.enabled, onchange: (e) => { form.enabled = e.target.checked } }),
        el('span', {}, 'Aktifkan setelah disimpan'),
      ),
      el('div', { className: 'form-actions' },
        C.button({ label: 'Batal', icon: 'x', size: 'sm', variant: 'ghost', onClick: showList }),
        C.button({
          label: 'Simpan konektor', icon: 'save', size: 'sm',
          onClick: async () => {
            try {
              await createConnector({ ...form, type, enabled: form.enabled })
              showToast('Konektor dibuat.', 'success')
              showList()
            } catch (err) { showToast(String(err.message || err), 'error', 6000) }
          },
        }),
      ),
    )
  }

  /* ------------------------------------------------------------- mapping */
  async function showMapping(connector) {
    container.replaceChildren(loadingBox('Memuat pemetaan…'))

    let existing = []
    try {
      existing = await listMappings(connector.id)
    } catch (err) {
      container.replaceChildren(errorBox(err, () => showMapping(connector)))
      return
    }

    let entity = existing[0]?.entity || 'requests'
    let suggestions = []
    let mapping = { fields: [] }

    const body = el('div', { className: 'mcp-mapping-body' })

    const entitySelect = C.select({
      label: 'Entitas Satu Alur', id: 'mcp-entity',
      options: Object.entries(SATU_ALUR_SCHEMA).map(([key, spec]) => ({ value: key, label: spec.label })),
      value: entity,
      onChange: (v) => {
        entity = v
        buildSuggestions()
      },
    })

    function buildSuggestions() {
      if (!sampleColumns.length) {
        body.replaceChildren(el('p', { className: 'set-desc' }, 'Unggah file contoh atau ambil data dari konektor untuk mendeteksi kolom sumber.'))
        return
      }
      suggestions = suggestMapping(sampleColumns, entity)
      const saved = existing.find((m) => m.entity === entity)
      if (saved) {
        for (const s of suggestions) {
          const savedField = (saved.fields || []).find((f) => f.target === s.target)
          if (savedField) {
            s.source = savedField.source || null
            s.suggestedTransform = (savedField.transform || [])[0] || null
            s.confidence = 'saved'
          }
        }
      }
      mapping = {
        entity,
        direction: 'inbound',
        mode: 'upsert',
        fields: suggestions
          .filter((s) => s.source)
          .map((s) => ({
            source: s.source,
            target: s.target,
            transform: s.suggestedTransform ? [s.suggestedTransform] : [],
            mapping: null,
          })),
      }
      drawTable()
    }

    function drawTable() {
      const table = el('table', { className: 'mcp-mapping-table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Kolom sumber'),
          el('th', {}, '→'),
          el('th', {}, 'Kolom Satu Alur'),
          el('th', {}, 'Transformasi'),
        )),
      )

      const tbody = el('tbody', {})
      const sourceOptions = [{ value: '', label: '(tidak dipakai)' }, ...sampleColumns.map((c) => ({ value: c.name, label: c.name }))]

      for (const s of suggestions) {
        const select = C.select({
          label: '', id: `map-src-${s.target}`,
          options: sourceOptions,
          value: s.source || '',
          onChange: (v) => {
            s.source = v || null
            const field = mapping.fields.find((f) => f.target === s.target)
            if (v) {
              if (field) field.source = v
              else mapping.fields.push({ source: v, target: s.target, transform: s.suggestedTransform ? [s.suggestedTransform] : [], mapping: null })
            } else if (field) {
              mapping.fields = mapping.fields.filter((f) => f.target !== s.target)
            }
            drawValidation()
          },
        })

        tbody.append(el('tr', { className: `conf-${s.confidence === 'high' ? 'high' : s.confidence === 'medium' ? 'med' : s.confidence === 'saved' ? 'high' : 'low'}` },
          el('td', {}, select.wrap),
          el('td', {}, '→'),
          el('td', {},
            el('strong', {}, s.target),
            s.targetRequired ? el('span', { className: 'badge-required' }, 'WAJIB') : null,
            s.targetValues ? el('div', { className: 'mcp-enum-hint' }, s.targetValues.join(' · ')) : null,
          ),
          el('td', {}, s.suggestedTransform || '—'),
        ))
      }

      table.append(tbody)
      const validation = el('div', { className: 'mcp-validation-slot' })

      function drawValidation() {
        validation.replaceChildren()
        const errors = validateMapping(mapping, entity)
        if (errors.length) {
          validation.append(el('div', { className: 'mcp-validation-errors' },
            el('strong', {}, 'Perlu diperbaiki'),
            el('ul', {}, ...errors.map((e) => el('li', {}, e.message))),
          ))
        } else {
          validation.append(el('div', { className: 'mcp-validation-ok' },
            el('span', { 'aria-hidden': 'true' }, icon('checkCircle', { size: 14 })),
            el('span', {}, 'Semua kolom wajib sudah dipetakan.'),
          ))
        }
      }
      drawValidation()

      const previewSlot = el('div', { className: 'mcp-preview-slot' })

      body.replaceChildren(
        table,
        validation,
        el('div', { className: 'form-actions' },
          C.button({
            label: 'Pratinjau', icon: 'eye', size: 'sm', variant: 'secondary',
            onClick: () => {
              const rows = previewTransform(sampleRows || [], mapping, entity, 10)
              if (!rows.length) {
                showToast('Belum ada baris contoh untuk dipratinjau.', 'info')
                return
              }
              previewSlot.replaceChildren(el('div', { className: 'mcp-preview-wrap' },
                el('table', { className: 'mcp-preview-table' },
                  el('thead', {}, el('tr', {},
                    el('th', {}, '#'),
                    ...Object.keys(rows[0]).filter((k) => !k.startsWith('_')).map((k) => el('th', {}, k)),
                    el('th', {}, 'Status'),
                  )),
                  el('tbody', {}, ...rows.map((r) => el('tr', { className: r._valid ? '' : 'row-invalid' },
                    el('td', { className: 'tnum' }, String(r._rowIndex)),
                    ...Object.keys(rows[0]).filter((k) => !k.startsWith('_')).map((k) => el('td', {}, String(r[k] ?? ''))),
                    el('td', {}, r._valid ? 'ok' : r._errors.join('; ')),
                  ))),
                ),
              ))
            },
          }),
          C.button({
            label: 'Simpan pemetaan', icon: 'save', size: 'sm',
            onClick: async () => {
              const errors = validateMapping(mapping, entity)
              if (errors.length) {
                showToast(errors[0].message, 'error', 6000)
                return
              }
              try {
                await saveMapping(connector.id, mapping)
                showToast('Pemetaan disimpan.', 'success')
              } catch (err) { showToast(String(err.message || err), 'error', 6000) }
            },
          }),
          existing.some((m) => m.entity === entity)
            ? C.button({
              label: 'Hapus pemetaan', icon: 'trash', size: 'sm', variant: 'ghost',
              onClick: async () => {
                if (!confirm(`Hapus pemetaan untuk ${entity}?`)) return
                try {
                  await deleteMapping(connector.id, entity)
                  existing = existing.filter((m) => m.entity !== entity)
                  showToast('Pemetaan dihapus.', 'success')
                } catch (err) { showToast(String(err.message || err), 'error') }
              },
            })
            : null,
        ),
        previewSlot,
      )
    }

    const fileInput = el('input', {
      type: 'file', accept: '.csv,text/csv,.json,.xlsx',
      className: 'mcp-file-input',
      onchange: async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const delimiter = connector.config?.delimiter || ','
          sampleRows = /\.json$/i.test(file.name) ? JSON.parse(text) : csvToRows(text, delimiter)
          sampleColumns = columnsFromRows(sampleRows)
          if (!sampleRows.length) {
            showToast('File tidak berisi baris data.', 'error')
            return
          }
          showToast(`${sampleRows.length} baris contoh dibaca.`, 'success')
          buildSuggestions()
        } catch (err) {
          showToast(`Gagal membaca file: ${err.message || err}`, 'error', 6000)
        }
      },
    })

    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        C.button({ label: 'Kembali', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: showList }),
        el('h3', { className: 'set-title' }, `Pemetaan · ${connector.name}`),
      ),
      el('p', { className: 'set-desc' }, 'Petakan kolom sistem sumber ke kolom Satu Alur. Unggah file contoh agar kolom terdeteksi otomatis.'),
      entitySelect.wrap,
      el('div', { className: 'mcp-file-row' },
        el('label', { className: 'mcp-file-label' },
          icon('upload', { size: 15 }),
          el('span', {}, 'Unggah file contoh'),
          fileInput,
        ),
      ),
      body,
    )

    buildSuggestions()
  }

  /* -------------------------------------------------------------- import */
  function showImport(connector) {
    let rows = []
    let entity = 'requests'
    const slot = el('div', {})
    const previewSlot = el('div', { className: 'mcp-preview-slot' })

    const entitySelect = C.select({
      label: 'Entitas tujuan', id: 'mcp-import-entity',
      options: Object.entries(SATU_ALUR_SCHEMA).map(([key, spec]) => ({ value: key, label: spec.label })),
      value: entity,
      onChange: (v) => { entity = v },
    })

    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        C.button({ label: 'Kembali', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: showList }),
        el('h3', { className: 'set-title' }, `Impor · ${connector.name}`),
      ),
      el('p', { className: 'set-desc' }, 'Unggah CSV atau JSON. Baris ditulis ke Satu Alur memakai pemetaan yang sudah disimpan untuk entitas ini.'),
      entitySelect.wrap,
      el('label', { className: 'mcp-file-label' },
        icon('upload', { size: 15 }),
        el('span', {}, 'Pilih file CSV / JSON'),
        el('input', {
          type: 'file', accept: '.csv,text/csv,.json',
          className: 'mcp-file-input',
          onchange: async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            try {
              const text = await file.text()
              rows = /\.json$/i.test(file.name) ? JSON.parse(text) : csvToRows(text, connector.config?.delimiter || ',')
              if (!Array.isArray(rows)) throw new Error('Isi file bukan daftar baris.')
              const columns = columnsFromRows(rows)
              previewSlot.replaceChildren(el('div', { className: 'mcp-preview-wrap' },
                el('p', { className: 'set-desc' }, `${rows.length} baris · ${columns.length} kolom terdeteksi`),
                el('table', { className: 'mcp-preview-table' },
                  el('thead', {}, el('tr', {}, ...columns.map((c) => el('th', {}, c.name)))),
                  el('tbody', {}, ...rows.slice(0, 5).map((r) => el('tr', {}, ...columns.map((c) => el('td', {}, String(r[c.name] ?? '')))))),
                ),
              ))
              slot.replaceChildren(
                el('div', { className: 'form-actions' },
                  C.button({
                    label: `Impor ${rows.length} baris`, icon: 'upload', size: 'sm',
                    onClick: async () => {
                      try {
                        const res = await runSync(connector.id, { rows, entity, trigger: 'manual' })
                        showToast(`Selesai: ${res.stats.inserted} dimasukkan, ${res.stats.updated} diperbarui, ${res.stats.failed} gagal.`,
                          res.stats.failed ? 'info' : 'success', 7000)
                        if (res.errorCount) {
                          showToast(`${res.errorCount} baris gagal: ${res.errors?.[0]?.message || ''}`, 'error', 8000)
                        }
                      } catch (err) { showToast(String(err.message || err), 'error', 7000) }
                    },
                  }),
                ),
              )
            } catch (err) {
              showToast(`Gagal membaca file: ${err.message || err}`, 'error', 6000)
            }
          },
        }),
      ),
      slot,
      previewSlot,
    )
  }

  showList()
}

/* ------------------------------------------------------------- Migration tab */

function renderMigrationTab(container) {
  async function showList() {
    container.replaceChildren(loadingBox('Memuat migrasi…'))
    let migrations
    try {
      migrations = await listMigrations()
    } catch (err) {
      container.replaceChildren(errorBox(err, showList))
      return
    }

    const header = el('div', { className: 'set-head-flex' },
      el('div', {},
        el('h3', { className: 'set-title' }, 'Migrasi database'),
        el('p', { className: 'set-desc' }, 'Pindahkan data dari sistem lama secara bertahap. Tanpa big bang.'),
      ),
      C.button({ label: 'Migrasi baru', icon: 'plus', size: 'sm', onClick: showWizard }),
    )

    const list = el('div', { className: 'mcp-migration-list' })

    if (migrations.length === 0) {
      list.append(el('div', { className: 'mcp-empty' },
        icon('database', { size: 30 }),
        el('p', {}, 'Belum ada migrasi'),
        el('p', { className: 'set-desc' }, 'Buat migrasi untuk memindahkan data dari ERP atau database lama.'),
      ))
    } else {
      for (const mig of migrations) {
        const phases = mig.phases || []
        const done = phases.filter((p) => p.status === 'completed' || p.status === 'completed_with_errors').length
        list.append(el('div', { className: 'mcp-migration-card' },
          el('div', { className: 'mcp-mig-head' },
            el('div', {},
              el('strong', {}, mig.name),
              el('span', { className: `mcp-status-badge status-${mig.status}` }, mig.status),
            ),
            el('span', { className: 'tnum text-muted' }, new Date(mig.createdAt).toLocaleDateString('id-ID')),
          ),
          el('div', { className: 'mcp-mig-phases' },
            ...phases.map((p) => el('div', { className: `mcp-phase ${p.status}` },
              el('span', { className: 'mcp-phase-dot' }),
              el('span', {}, p.name),
              p.recordsInserted ? el('span', { className: 'tnum text-muted' }, `${p.recordsInserted} baris`) : null,
            )),
          ),
          el('div', { className: 'mcp-mig-actions' },
            el('span', { className: 'text-muted tnum' }, `${done}/${phases.length} fase`),
            C.button({ label: 'Jalankan', icon: 'play', size: 'xs', onClick: () => showRun(mig.id) }),
            C.button({ label: 'Laporan', icon: 'fileText', size: 'xs', variant: 'ghost', onClick: () => showReport(mig) }),
            (mig.status === 'completed' || mig.status === 'completed_with_errors')
              ? C.button({
                label: 'Rollback', icon: 'rotateCcw', size: 'xs', variant: 'ghost',
                onClick: async () => {
                  if (!confirm('Rollback menghapus baris yang dibuat migrasi ini. Data lama tidak disentuh. Lanjutkan?')) return
                  try {
                    const res = await rollbackMigration(mig.id)
                    showToast(`Rollback selesai. ${res.removedRows || 0} baris dihapus.`, 'success')
                    showList()
                  } catch (err) { showToast(String(err.message || err), 'error') }
                },
              })
              : null,
          ),
        ))
      }
    }

    container.replaceChildren(
      header,
      list,
      el('div', { className: 'mcp-info-box' },
        el('h4', {}, icon('info', { size: 16 }), ' Strategi parallel running'),
        el('p', {}, 'Satu Alur menyarankan migrasi bertahap: data master dulu, lalu transaksi aktif, terakhir data historis. Dua sistem berjalan bersamaan selama transisi.'),
        el('a', { href: '#/dokumentasi/migrasi', className: 'link' }, 'Baca panduan lengkap →'),
      ),
    )
  }

  async function showWizard() {
    let connectors = []
    try { connectors = await listConnectors() } catch { /* offline: still allow file-less migration */ }

    let step = 1
    const form = { name: '', connectorId: connectors[0]?.id || '', strategy: 'parallel' }
    const slot = el('div', {})

    function drawStep() {
      slot.replaceChildren()

      if (step === 1) {
        slot.append(
          textField('Nama migrasi', 'mig-name', form.name, 'text', (v) => { form.name = v }, 'Contoh: Migrasi Odoo Q4 2026'),
          C.select({
            label: 'Sumber data', id: 'mig-source',
            options: [
              { value: '', label: 'Tanpa konektor (unggah file nanti)' },
              ...connectors.map((c) => ({ value: c.id, label: `${c.name} · ${CONNECTOR_TYPE_LABELS[c.type] || c.type}` })),
            ],
            value: form.connectorId,
            onChange: (v) => { form.connectorId = v },
          }).wrap,
          C.select({
            label: 'Strategi', id: 'mig-strategy',
            options: [
              { value: 'parallel', label: 'Parallel running (disarankan)' },
              { value: 'phased', label: 'Phased per modul' },
              { value: 'bigbang', label: 'Big bang (tidak disarankan)' },
            ],
            value: form.strategy,
            onChange: (v) => { form.strategy = v },
          }).wrap,
        )
      } else if (step === 2) {
        slot.append(
          el('p', { className: 'set-desc' }, 'Fase dijalankan berurutan. Data master wajib; transaksi aktif disarankan; historis opsional.'),
          ...MIGRATION_PHASES.map((p, i) => el('div', { className: 'mcp-phase-checkbox' },
            el('div', {},
              el('strong', {}, `${i + 1}. ${p.name}`),
              el('span', {}, p.description),
              p.optional ? el('span', { className: 'badge-optional' }, 'Opsional') : el('span', { className: 'badge-required' }, 'Wajib'),
            ),
          )),
        )
      } else {
        slot.append(el('div', { className: 'mcp-confirm-box' },
          el('div', { className: 'mcp-confirm-row' }, el('span', {}, 'Nama'), el('strong', {}, form.name || '—')),
          el('div', { className: 'mcp-confirm-row' }, el('span', {}, 'Sumber'), el('strong', {}, connectors.find((c) => c.id === form.connectorId)?.name || 'Unggah file')),
          el('div', { className: 'mcp-confirm-row' }, el('span', {}, 'Strategi'), el('strong', {}, form.strategy)),
          el('div', { className: 'mcp-confirm-row' }, el('span', {}, 'Fase'), el('strong', {}, `${MIGRATION_PHASES.length} fase`)),
        ))
      }
    }

    drawStep()

    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        C.button({ label: 'Batal', icon: 'x', size: 'sm', variant: 'ghost', onClick: showList }),
        el('h3', { className: 'set-title' }, 'Wizard migrasi'),
      ),
      el('div', { className: 'mcp-stepper' },
        ...[1, 2, 3].map((n) => el('div', { className: `mcp-step ${step >= n ? 'active' : ''}` }, `${n}. ${['Info', 'Fase', 'Konfirmasi'][n - 1]}`)),
      ),
      slot,
      el('div', { className: 'form-actions' },
        step > 1 ? C.button({ label: 'Sebelumnya', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: () => { step--; drawStep() } }) : el('span', {}),
        step < 3
          ? C.button({ label: 'Selanjutnya', icon: 'arrowRight', size: 'sm', onClick: () => { step++; drawStep() } })
          : C.button({
            label: 'Buat migrasi', icon: 'save', size: 'sm',
            onClick: async () => {
              if (form.name.trim().length < 3) { showToast('Nama migrasi minimal 3 karakter.', 'error'); return }
              try {
                const created = await createMigration({
                  name: form.name,
                  connectorId: form.connectorId || null,
                  strategy: form.strategy,
                  phases: MIGRATION_PHASES.map((p) => p.key),
                })
                showToast('Migrasi dibuat.', 'success')
                showRun(created.id)
              } catch (err) { showToast(String(err.message || err), 'error', 6000) }
            },
          }),
      ),
    )
  }

  async function showRun(id) {
    container.replaceChildren(loadingBox('Memuat migrasi…'))
    let migration
    try {
      migration = await getMigration(id)
    } catch (err) {
      container.replaceChildren(errorBox(err, () => showRun(id)))
      return
    }
    if (!migration) {
      container.replaceChildren(errorBox(new Error('Migrasi tidak ditemukan.'), showList))
      return
    }

    const phases = migration.phases || []
    const nextIndex = phases.findIndex((p) => p.status === 'pending')
    const progress = el('div', { className: 'mcp-run-progress' })

    for (const phase of phases) {
      const done = phase.status === 'completed' || phase.status === 'completed_with_errors'
      progress.append(el('div', { className: `mcp-run-phase ${phase.status === 'running' ? 'running' : ''} ${done ? 'done' : ''}` },
        el('div', { className: 'mcp-run-phase-head' },
          el('span', { className: `mcp-phase-icon ${done ? 'done' : phase.status === 'running' ? 'spin' : ''}` },
            done ? icon('checkCircle', { size: 18 }) : phase.status === 'running' ? icon('loader', { size: 18 }) : icon('circle', { size: 18 }),
          ),
          el('div', {},
            el('strong', {}, phase.name),
            el('span', { className: 'text-muted' }, phase.description || ''),
          ),
        ),
        phase.recordsProcessed
          ? el('div', { className: 'mcp-run-stats' },
            el('span', {}, `${phase.recordsProcessed} diproses`),
            el('span', {}, `${phase.recordsInserted || 0} baru`),
            el('span', {}, `${phase.recordsUpdated || 0} diperbarui`),
            phase.recordsFailed ? el('span', { className: 'text-error' }, `${phase.recordsFailed} gagal`) : null,
          )
          : null,
        (phase.errors || []).length
          ? el('div', { className: 'mcp-run-errors' }, ...phase.errors.slice(0, 3).map((e) => el('div', {}, `${e.entity}: ${e.message}`)))
          : null,
      ))
    }

    const actions = el('div', { className: 'form-actions' })
    if (nextIndex >= 0) {
      actions.append(
        C.button({
          label: `Jalankan fase ${nextIndex + 1}`, icon: 'play', size: 'sm',
          onClick: async () => {
            try {
              await runMigrationPhase(id, { phaseIndex: nextIndex })
              showRun(id)
            } catch (err) { showToast(String(err.message || err), 'error', 7000) }
          },
        }),
        C.button({
          label: 'Jalankan semua', icon: 'playCircle', size: 'sm', variant: 'secondary',
          onClick: async () => {
            try {
              let guard = 0
              let current = await getMigration(id)
              while (guard++ < 10) {
                const idx = (current.phases || []).findIndex((p) => p.status === 'pending')
                if (idx < 0) break
                current = await runMigrationPhase(id, { phaseIndex: idx })
              }
              showRun(id)
            } catch (err) { showToast(String(err.message || err), 'error', 7000) }
          },
        }),
      )
    }
    actions.append(C.button({ label: 'Kembali', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: showList }))

    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        C.button({ label: 'Kembali', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: showList }),
        el('h3', { className: 'set-title' }, migration.name),
      ),
      el('p', { className: 'set-desc' }, `Status: ${migration.status}. ${migration.connectorId ? 'Baris diambil dari konektor.' : 'Migrasi ini belum terhubung ke konektor — baris tidak akan terbaca.'}`),
      progress,
      actions,
    )
  }

  function showReport(migration) {
    const report = generateValidationReport(migration)
    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        C.button({ label: 'Kembali', icon: 'arrowLeft', size: 'sm', variant: 'ghost', onClick: showList }),
        el('h3', { className: 'set-title' }, `Laporan · ${report.name}`),
      ),
      el('div', { className: 'mcp-report-summary' },
        reportCard(String(report.summary.processed), 'Diproses'),
        reportCard(String(report.summary.inserted), 'Baru'),
        reportCard(String(report.summary.updated), 'Diperbarui'),
        reportCard(String(report.summary.failed), 'Gagal'),
        reportCard(`${report.summary.successRate}%`, 'Tingkat sukses'),
      ),
      el('table', { className: 'mcp-report-table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Fase'), el('th', {}, 'Status'), el('th', {}, 'Diproses'),
          el('th', {}, 'Baru'), el('th', {}, 'Diperbarui'), el('th', {}, 'Gagal'), el('th', {}, 'Durasi'),
        )),
        el('tbody', {}, ...report.phases.map((p) => el('tr', {},
          el('td', {}, p.name),
          el('td', {}, el('span', { className: `mcp-status-badge status-${p.status === 'completed' ? 'completed' : p.status === 'completed_with_errors' ? 'completed_with_errors' : 'draft'}` }, p.status)),
          el('td', { className: 'tnum' }, String(p.recordsProcessed)),
          el('td', { className: 'tnum' }, String(p.recordsInserted)),
          el('td', { className: 'tnum' }, String(p.recordsUpdated)),
          el('td', { className: 'tnum' }, String(p.recordsFailed)),
          el('td', { className: 'tnum' }, `${p.durationSeconds}s`),
        ))),
      ),
      report.errors.length
        ? el('div', { className: 'mcp-report-errors' },
          el('h4', {}, `Error (${report.errors.length})`),
          el('ul', {}, ...report.errors.slice(0, 50).map((e) => el('li', {}, `[${e.phase}] ${e.message}`))),
        )
        : null,
      el('div', { className: 'form-actions' },
        C.button({
          label: 'Ekspor JSON', icon: 'download', size: 'sm', variant: 'ghost',
          onClick: () => {
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `migrasi-${report.id}.json`
            a.click()
            URL.revokeObjectURL(url)
          },
        }),
      ),
    )
  }

  function reportCard(value, label) {
    return el('div', { className: 'mcp-report-card' },
      el('span', { className: 'tnum' }, value),
      el('span', {}, label),
    )
  }

  showList()
}

/* ------------------------------------------------------------- Logs tab */

function renderLogsTab(container) {
  async function show() {
    container.replaceChildren(loadingBox('Memuat log…'))
    let logs
    let errors
    try {
      [logs, errors] = await Promise.all([listSyncLogs(), listSyncErrors('open')])
    } catch (err) {
      container.replaceChildren(errorBox(err, show))
      return
    }

    const rows = (logs || []).slice(0, 100)
    const table = el('table', { className: 'mcp-log-table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Waktu'), el('th', {}, 'Konektor'), el('th', {}, 'Status'),
        el('th', {}, 'Diproses'), el('th', {}, 'Baru'), el('th', {}, 'Gagal'), el('th', {}, 'Durasi'),
      )),
    )
    const tbody = el('tbody', {})

    if (!rows.length) {
      tbody.append(el('tr', {}, el('td', { colSpan: 7, className: 'text-center text-muted' }, 'Belum ada sinkronisasi.')))
    } else {
      for (const log of rows) {
        const duration = log.endedAt
          ? Math.max(0, Math.round((new Date(log.endedAt) - new Date(log.startedAt)) / 1000))
          : null
        const stats = log.stats || {}
        tbody.append(el('tr', {},
          el('td', { className: 'tnum' }, new Date(log.startedAt).toLocaleString('id-ID')),
          el('td', {}, log.connectorName || log.connectorId),
          el('td', {}, el('span', { className: `mcp-status-badge status-${log.status}` }, log.status)),
          el('td', { className: 'tnum' }, String(stats.processed || 0)),
          el('td', { className: 'tnum' }, String(stats.inserted || 0)),
          el('td', { className: 'tnum' }, String(stats.failed || 0)),
          el('td', { className: 'tnum' }, duration === null ? '—' : `${duration}s`),
        ))
      }
    }
    table.append(tbody)

    container.replaceChildren(
      el('div', { className: 'set-head-flex' },
        el('div', {},
          el('h3', { className: 'set-title' }, 'Log sinkronisasi'),
          el('p', { className: 'set-desc' }, 'Riwayat sinkronisasi dan baris yang gagal ditulis.'),
        ),
        C.button({ label: 'Muat ulang', icon: 'refresh', size: 'sm', variant: 'ghost', onClick: show }),
      ),
      table,
      (errors || []).length
        ? el('div', { className: 'mcp-report-errors' },
          el('h4', {}, `${errors.length} baris gagal (dead letter)`),
          el('ul', {}, ...errors.slice(0, 20).map((e) => el('li', {}, `[${e.entity}] ${e.message}`))),
        )
        : null,
    )
  }

  show()
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
    promptBlock('Agen · 01', 'Prompt penawaran', 'Instruksi untuk AI saat menyusun penawaran (tahap 02). Hasilnya berisi ruang lingkup, harga, syarat, dan catatan.', 'offerPrompt', 'offer', 'offer-prompt'),
    promptBlock('Agen · 02', 'Prompt laporan', 'Instruksi untuk AI saat menjelaskan laporan (tahap 06). Output HTML disanitasi sebelum ditampilkan.', 'reportPrompt', 'report', 'report-prompt'),
    setSection({ num: 'Agen · 03', title: 'Parameter', desc: 'Pengaturan teknis output AI.' },
      rangeField({ label: 'Temperature', id: 'agent-temp', value: settings.temperature, min: 0, max: 1, step: 0.1, hint: '0 = konsisten, 1 = lebih kreatif.', onChange: (v) => { settings.temperature = parseFloat(v); save() } }),
      rangeField({ label: 'Maks token', id: 'agent-tokens', value: settings.maxTokens, min: 500, max: 4000, step: 100, onChange: (v) => { settings.maxTokens = parseInt(v, 10); save() } }),
      modelSel.wrap,
    ),
  )
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

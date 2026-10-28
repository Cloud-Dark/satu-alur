import { isUsingMockCloud } from '../cloud.js'
import { getSession, onAuthStateChange, signOut, restoreAuth, sendEmailCode, submitEmailOtp } from '../auth/auth.js'
import * as Components from './components.js'
import { createParticleBackground, animateEntrance, showToast } from './animations.js'

import * as StageDashboard from '../stages/dashboard.js'
import * as StageRequest from '../stages/request.js'
import * as StageOffer from '../stages/offer.js'
import * as StageAssign from '../stages/assign.js'
import * as StageComplete from '../stages/complete.js'
import * as StageBookkeeping from '../stages/bookkeeping.js'
import * as StageReport from '../stages/report.js'
import * as StageSettings from '../stages/settings.js'

const navItems = [
  { key: 'dashboard', label: 'Dashboard', module: StageDashboard, icon: '🏠' },
  { key: 'request', label: 'Permintaan', module: StageRequest, icon: '📋' },
  { key: 'offer', label: 'Penawaran', module: StageOffer, icon: '💡' },
  { key: 'assign', label: 'Penugasan', module: StageAssign, icon: '👷' },
  { key: 'complete', label: 'Penyelesaian', module: StageComplete, icon: '✅' },
  { key: 'bookkeeping', label: 'Pembukuan', module: StageBookkeeping, icon: '📊' },
  { key: 'report', label: 'Laporan', module: StageReport, icon: '📈' },
]

let currentUser = null
let currentStage = 'dashboard'
let settingsOpen = false
let particleCleanup = null

export async function mountApp(root) {
  root.innerHTML = ''

  if (!particleCleanup) {
    particleCleanup = createParticleBackground(root)
  }

  try {
    const oauthResult = await restoreAuth()
    if (oauthResult?.type === 'oauth') {
      currentUser = oauthResult.session.user
    }
  } catch (e) {
    console.warn('OAuth restore error:', e.message)
  }

  try {
    const { data: session } = await getSession()
    currentUser = session?.user ?? null
  } catch {
    currentUser = null
  }

  render(root)

  try {
    onAuthStateChange((event, session) => {
      currentUser = session?.user ?? null
      render(root)
    })
  } catch (e) {
    console.warn('Auth state observer error:', e.message)
  }
}

function render(root) {
  root.innerHTML = ''
  if (!currentUser) {
    root.appendChild(renderLogin())
    return
  }
  root.appendChild(renderDashboard())
}

function renderLogin() {
  const logoImg = Components.el('img', {
    src: '/assets/logo-satu-alur.png',
    alt: 'Satu Alur',
    style: 'width:100%;max-width:260px;margin:0 auto 16px;display:block;',
  })
  const container = Components.el('div', { className: 'login-container' },
    logoImg,
    Components.el('p', { style: 'text-align:center;color:var(--text-muted);' }, 'Satu alur lengkap untuk semua operasi jasa Anda.')
  )

  const emailInput = Components.el('input', { type: 'email', placeholder: 'email@contoh.com' })
  const codeInput = Components.el('input', { type: 'text', placeholder: 'Kode OTP', disabled: true })
  const sendBtn = Components.btn('Kirim Kode', { type: 'button' })
  const submitBtn = Components.el('button', { type: 'submit', disabled: true }, 'Masuk')
  const message = Components.el('div', { className: 'message' })
  const otpDisplay = Components.el('div', { className: 'otp-display', style: 'display:none;' })

  window.addEventListener('mock-otp-sent', (ev) => {
    if (ev.detail.email === emailInput.value.trim()) {
      otpDisplay.style.display = 'block'
      otpDisplay.innerHTML = `<strong>Mode Prototype &mdash; Kode OTP:</strong><br><span style="font-size:1.4rem;letter-spacing:4px;font-weight:700;color:var(--primary);">${ev.detail.code}</span>`
    }
  })

  sendBtn.addEventListener('click', async () => {
    message.textContent = ''
    otpDisplay.style.display = 'none'
    try {
      await sendEmailCode(emailInput.value.trim())
      codeInput.disabled = false
      submitBtn.disabled = false
      message.style.color = 'var(--success)'
      message.textContent = 'Kode OTP telah dikirim. Lihat kotak di bawah.'
    } catch (e) {
      message.style.color = 'var(--danger)'
      message.textContent = e.message
    }
  })

  const form = Components.el('form', {},
    Components.el('label', {}, 'Email', emailInput),
    Components.el('div', { className: 'otp-row' }, sendBtn),
    otpDisplay,
    Components.el('label', {}, 'Kode OTP', codeInput),
    submitBtn,
    message
  )

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    message.textContent = ''
    try {
      const result = await submitEmailOtp(emailInput.value.trim(), codeInput.value.trim())
      currentUser = result.user
      showToast('Selamat datang di Satu Alur!', 'success')
      render(document.getElementById('app'))
    } catch (e) {
      message.style.color = 'var(--danger)'
      message.textContent = e.message
    }
  })

  container.appendChild(form)
  return container
}

function renderDashboard() {
  const isMock = isUsingMockCloud()

  const appWrapper = Components.el('div', { className: 'app-wrapper' })

  // Top bar
  const topBar = Components.el('header', { className: 'app-topbar' },
    Components.el('div', { style: 'display:flex;align-items:center;gap:10px;' },
      Components.el('img', { src: '/assets/icon-satu-alur.png', alt: '', style: 'width:28px;height:28px;border-radius:6px;' }),
      Components.solidText('Satu Alur', 'primary')
    ),
    Components.el('div', { style: 'display:flex;align-items:center;gap:10px;' },
      Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;' }, currentUser?.email || currentUser?.name || 'Pengguna'),
      Components.el('button', {
        className: 'settings-btn',
        title: 'Pengaturan',
        onClick: () => toggleSettings(true),
      }, '⚙️'),
      Components.el('button', { className: 'logout-btn', onClick: async () => { await signOut() } }, 'Keluar')
    )
  )

  // Sidebar
  const sidebar = Components.el('aside', { className: 'app-sidebar' })

  const navList = Components.el('nav', { className: 'sidebar-nav' })
  navItems.forEach((s) => {
    const isActive = s.key === currentStage
    const btn = Components.el('button', {
      className: isActive ? 'active' : '',
      onClick: () => { currentStage = s.key; render(document.getElementById('app')) },
    },
      Components.el('span', { className: 'nav-icon' }, s.icon),
      Components.el('span', { className: 'nav-label' }, s.label)
    )
    navList.appendChild(btn)
  })
  sidebar.appendChild(navList)

  // Bottom of sidebar — prototype badge
  if (isMock) {
    sidebar.appendChild(Components.el('div', { className: 'sidebar-footer' },
      Components.el('span', { style: 'font-size:0.75rem;color:var(--text-muted);' }, 'Mode Prototype'),
      Components.el('span', { style: 'font-size:0.7rem;color:var(--text-dim);display:block;' }, 'Data lokal di browser')
    ))
  }

  // Content area
  const content = Components.el('main', { className: 'app-content' })
  const active = navItems.find((s) => s.key === currentStage)
  if (active?.module?.render) {
    active.module.render(content)
  } else {
    content.appendChild(Components.el('p', {}, `Tahap "${active.label}" — belum diimplementasikan.`))
  }

  appWrapper.appendChild(sidebar)
  appWrapper.appendChild(Components.el('div', { className: 'app-main-area' }, topBar, content))
  appWrapper.appendChild(renderSettingsOverlay())

  return appWrapper
}

function renderSettingsOverlay() {
  const overlay = Components.el('div', {
    className: `settings-overlay ${settingsOpen ? 'open' : ''}`,
    onClick: () => toggleSettings(false),
  })

  const panel = Components.el('div', {
    className: `settings-panel ${settingsOpen ? 'open' : ''}`,
    onClick: (e) => e.stopPropagation(),
  })

  const panelHeader = Components.el('div', { className: 'panel-header' },
    Components.solidText('Pengaturan', 'primary'),
    Components.el('button', {
      className: 'close-btn',
      onClick: () => toggleSettings(false),
    }, '✕')
  )

  const panelContent = Components.el('div', {})
  StageSettings.render(panelContent)

  const saveBtn = Components.btn('Simpan & Tutup', {
    className: 'save-btn',
    style: 'margin-top:20px;',
    onClick: () => {
      showToast('Pengaturan berhasil disimpan!', 'success')
      toggleSettings(false)
    },
  })

  panel.appendChild(panelHeader)
  panel.appendChild(panelContent)
  panel.appendChild(saveBtn)

  const wrapper = Components.el('div', {})
  wrapper.appendChild(overlay)
  wrapper.appendChild(panel)
  return wrapper
}

function toggleSettings(open) {
  settingsOpen = open
  render(document.getElementById('app'))
}

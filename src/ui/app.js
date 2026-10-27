import { isUsingMockCloud } from '../cloud.js'
import { getSession, onAuthStateChange, signOut, restoreAuth, sendEmailCode, submitEmailOtp } from '../auth/auth.js'
import * as Components from './components.js'

import * as StageRequest from '../stages/request.js'
import * as StageOffer from '../stages/offer.js'
import * as StageAssign from '../stages/assign.js'
import * as StageComplete from '../stages/complete.js'
import * as StageBookkeeping from '../stages/bookkeeping.js'
import * as StageReport from '../stages/report.js'

const stages = [
  { key: 'request', label: 'Permintaan', module: StageRequest },
  { key: 'offer', label: 'Penawaran', module: StageOffer },
  { key: 'assign', label: 'Penugasan', module: StageAssign },
  { key: 'complete', label: 'Penyelesaian', module: StageComplete },
  { key: 'bookkeeping', label: 'Pembukuan', module: StageBookkeeping },
  { key: 'report', label: 'Laporan', module: StageReport },
]

let currentUser = null
let currentStage = 'request'

export async function mountApp(root) {
  root.innerHTML = ''

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
  const container = Components.el('div', { className: 'login-container' },
    Components.el('h1', {}, 'ServiceOps AI'),
    Components.el('p', {}, 'Masuk dengan email untuk melanjutkan.')
  )

  const emailInput = Components.el('input', { type: 'email', placeholder: 'email@contoh.com' })
  const codeInput = Components.el('input', { type: 'text', placeholder: 'Kode OTP', disabled: true })
  const sendBtn = Components.el('button', { type: 'button' }, 'Kirim Kode')
  const submitBtn = Components.el('button', { type: 'submit', disabled: true }, 'Masuk')
  const message = Components.el('div', { className: 'message' })

  sendBtn.addEventListener('click', async () => {
    message.textContent = ''
    try {
      await sendEmailCode(emailInput.value.trim())
      codeInput.disabled = false
      submitBtn.disabled = false
      message.style.color = 'var(--success)'
      message.textContent = 'Kode OTP telah dikirim. Periksa inbox/spam (lihat console untuk kode mock).'
    } catch (e) {
      message.style.color = 'var(--danger)'
      message.textContent = e.message
    }
  })

  const form = Components.el('form', {},
    Components.el('label', {}, 'Email', emailInput),
    Components.el('div', { className: 'otp-row' }, sendBtn),
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

  const header = Components.el('header', { className: 'app-header' },
    Components.el('h1', {}, 'ServiceOps AI'),
    Components.el('span', { className: 'user' }, currentUser?.email || currentUser?.name || 'Pengguna'),
    Components.el('button', { onClick: async () => { await signOut() } }, 'Keluar')
  )

  const banner = isMock
    ? Components.el('div', { style: 'background:#fef3c7;color:#92400e;padding:8px 20px;font-size:0.85rem;border-bottom:1px solid #f59e0b;' },
        Components.el('strong', {}, 'Mode Prototype: '),
        'Data tersimpan secara lokal di browser. Cloud WorkBuddy belum diaktifkan — fitur ini akan otomatis aktif saat cloud tersedia.'
      )
    : null

  const nav = Components.el('nav', { className: 'stage-nav' })
  stages.forEach((s) => {
    const btn = Components.el('button', {
      className: s.key === currentStage ? 'active' : '',
      onClick: () => { currentStage = s.key; render(document.getElementById('app')) }
    }, s.label)
    nav.appendChild(btn)
  })

  const main = Components.el('main', { className: 'stage-container' })
  const active = stages.find((s) => s.key === currentStage)
  if (active?.module?.render) {
    active.module.render(main)
  } else {
    main.appendChild(Components.el('p', {}, `Tahap "${active.label}" — belum diimplementasikan.`))
  }

  const children = banner ? [banner, header, nav, main] : [header, nav, main]
  return Components.el('div', { className: 'app-shell' }, ...children)
}

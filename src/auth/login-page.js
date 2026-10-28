/**
 * Login page (#/masuk) — passwordless email OTP in two steps.
 *   01 Email  -> sendEmailCode(email)
 *   02 Kode   -> submitEmailOtp(email, code) -> ctx.onSignedIn(user)
 * Left: framed Three.js "loop" panel. Right: the form on paper.
 */
import '../styles/auth.css'
import { sendEmailCode, submitEmailOtp } from './auth.js'
import { logoLink } from '../ui/brand.js'
import { themeToggleButton } from '../ui/theme.js'
import { icon, iconHTML } from '../ui/icons.js'
import { prefersReducedMotion } from '../ui/reveal.js'

const STAGES = ['Permintaan', 'Penawaran AI', 'Penugasan', 'Penyelesaian', 'Pembukuan', 'Laporan AI']
const CODE_LENGTH = 6
const RESEND_SECONDS = 30
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const COPY = {
  email: {
    title: 'Masuk ke Satu Alur.',
    helper: 'Masukkan email kerja Anda. Kami kirim kode 6 digit, tanpa kata sandi. Akun baru dibuat otomatis saat pertama masuk.',
    status: 'Menunggu email',
  },
  code: {
    title: 'Cek kotak masuk Anda.',
    status: 'Menunggu kode',
  },
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k === 'text') el.textContent = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

function formatTime(s) {
  return `0:${String(s).padStart(2, '0')}`
}

export function renderLoginPage(root, ctx = {}) {
  const reduced = prefersReducedMotion()
  let step = 'email'
  let email = ''
  let pendingEmail = ''
  let demoCode = ''
  let busy = false
  let resendLeft = 0
  let resendTimer = 0
  let successTimer = 0
  let scene = null
  let disposed = false

  /* ================= Left: stage panel ================= */
  const sceneBox = h('div', { class: 'auth-scene dot-grid', 'aria-hidden': 'true' })
  const statusText = h('span', { class: 'auth-status-text', text: COPY.email.status })
  const stagePanel = h('aside', { class: 'auth-stage', 'aria-label': 'Satu Alur' },
    sceneBox,
    h('div', { class: 'auth-stage-top' },
      logoLink({ size: 30 }),
      h('span', { class: 'auth-stage-meta mono', 'aria-hidden': 'true' }, 'SA / 0', h('b', {}, '1'), ' — Akses'),
    ),
    h('div', { class: 'auth-stage-bottom' },
      h('p', { class: 'kicker auth-stage-kicker' }, 'Satu alur · enam tahap'),
      h('p', { class: 'auth-statement' }, 'Masuk ke alur kerja Anda', h('span', { class: 'auth-dot' }, '.')),
      h('ol', { class: 'auth-stage-list mono', 'aria-label': 'Enam tahap alur kerja' },
        STAGES.map((s, i) => h('li', {}, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), ' ', s)),
      ),
      h('p', { class: 'auth-status mono' },
        h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'auth-status-label' }, 'Sistem aktif'),
        h('span', { class: 'auth-status-sep', 'aria-hidden': 'true' }, '/'),
        statusText,
      ),
    ),
  )

  /* ================= Right: form column ================= */
  const backLink = h('a', { href: '#/', class: 'auth-back' }, icon('arrowLeft', { size: 16 }), h('span', {}, 'Kembali ke beranda'))
  backLink.addEventListener('click', (e) => {
    if (typeof ctx.navigate === 'function') { e.preventDefault(); ctx.navigate('/') }
  })
  const themeBtn = themeToggleButton()

  const title = h('h1', { class: 'auth-title', id: 'auth-title', tabindex: '-1', text: COPY.email.title })
  const helper = h('p', { class: 'auth-helper', text: COPY.email.helper })

  const stepEmailItem = h('li', { class: 'auth-step', 'data-step': 'email', 'aria-current': 'step' },
    h('span', { class: 'auth-step-n mono' }, h('span', { class: 'num' }, '01'), h('span', { class: 'ok', html: iconHTML('check', { size: 14, stroke: 2.5 }) })),
    h('span', { class: 'auth-step-label' }, 'Email'),
  )
  const stepCodeItem = h('li', { class: 'auth-step', 'data-step': 'code' },
    h('span', { class: 'auth-step-n mono' }, h('span', { class: 'num' }, '02'), h('span', { class: 'ok', html: iconHTML('check', { size: 14, stroke: 2.5 }) })),
    h('span', { class: 'auth-step-label' }, 'Kode'),
  )
  const stepper = h('ol', { class: 'auth-steps', 'aria-label': 'Langkah masuk' },
    stepEmailItem, h('li', { class: 'auth-steps-rail', 'aria-hidden': 'true' }), stepCodeItem,
  )

  /* ---- Step 1: email ---- */
  const emailInput = h('input', {
    id: 'auth-email', class: 'auth-input', type: 'email', name: 'email', autocomplete: 'email',
    inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', placeholder: 'nama@usaha.id', required: true,
    'aria-describedby': 'auth-email-hint',
  })
  const emailHint = h('p', { class: 'auth-field-hint', id: 'auth-email-hint', text: 'Kode berlaku sekali pakai.' })
  const emailError = h('p', { class: 'auth-field-error', id: 'auth-email-error', hidden: true })
  const sendBtn = h('button', { type: 'submit', class: 'btn btn-signal btn-lg auth-primary' },
    h('span', { class: 'auth-btn-label' }, 'Kirim kode'), h('span', { class: 'auth-btn-icon', html: iconHTML('arrowRight', { size: 18, stroke: 2 }) }),
  )
  const emailForm = h('form', { class: 'auth-form auth-form-email', novalidate: true, 'aria-labelledby': 'auth-title' },
    h('div', { class: 'auth-field' },
      h('label', { for: 'auth-email', class: 'auth-label' }, 'Alamat email'),
      h('div', { class: 'auth-input-wrap' }, h('span', { class: 'auth-input-icon', html: iconHTML('mail', { size: 18 }) }), emailInput),
      emailError,
      emailHint,
    ),
    sendBtn,
  )

  /* ---- Step 2: code ---- */
  const sentTo = h('strong', { class: 'auth-sent-to' })
  const changeEmailBtn = h('button', { type: 'button', class: 'auth-link' }, 'Ganti email')
  const sentLine = h('p', { class: 'auth-sent' }, 'Kode 6 digit dikirim ke ', sentTo, '. ', changeEmailBtn)

  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => h('input', {
    class: 'auth-digit', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '1',
    autocomplete: i === 0 ? 'one-time-code' : 'off', 'aria-label': `Digit ${i + 1} dari ${CODE_LENGTH}`,
    name: i === 0 ? 'code' : null, enterkeyhint: i === CODE_LENGTH - 1 ? 'go' : 'next',
  }))
  const otpGroup = h('div', { class: 'auth-otp', role: 'group', 'aria-labelledby': 'auth-code-label' },
    digits.slice(0, 3), h('span', { class: 'auth-otp-sep', 'aria-hidden': 'true' }), digits.slice(3),
  )

  const demoDigits = h('span', { class: 'auth-demo-code mono tnum', 'aria-label': '' })
  const fillBtn = h('button', { type: 'button', class: 'btn btn-ink btn-sm auth-demo-fill' }, 'Isi otomatis')
  const demoBox = h('div', { class: 'auth-demo', hidden: true },
    h('div', { class: 'auth-demo-head' },
      h('span', { class: 'auth-demo-tag mono' }, 'Mode demo'),
      h('span', { class: 'auth-demo-note' }, 'Email tidak dikirim. Kode Anda:'),
    ),
    h('div', { class: 'auth-demo-body' }, demoDigits, fillBtn),
  )

  const verifyBtn = h('button', { type: 'submit', class: 'btn btn-signal btn-lg auth-primary' },
    h('span', { class: 'auth-btn-label' }, 'Masuk'), h('span', { class: 'auth-btn-icon', html: iconHTML('arrowRight', { size: 18, stroke: 2 }) }),
  )
  const resendBtn = h('button', { type: 'button', class: 'auth-link auth-resend', disabled: true }, 'Kirim ulang')
  const codeForm = h('form', { class: 'auth-form auth-form-code', novalidate: true, hidden: true, 'aria-labelledby': 'auth-title' },
    sentLine,
    h('div', { class: 'auth-field' },
      h('span', { class: 'auth-label', id: 'auth-code-label' }, 'Kode verifikasi'),
      otpGroup,
    ),
    demoBox,
    verifyBtn,
    h('div', { class: 'auth-row' },
      resendBtn,
      h('span', { class: 'auth-row-note mono' }, 'Tidak masuk? Cek folder spam.'),
    ),
  )

  const message = h('p', { class: 'auth-msg', 'aria-live': 'polite', role: 'status' })

  const formCol = h('main', { class: 'auth-main', id: 'konten' },
    h('header', { class: 'auth-bar' }, backLink, themeBtn),
    h('div', { class: 'auth-body' },
      h('div', { class: 'auth-panel' },
        h('p', { class: 'kicker auth-kicker' }, 'Masuk / Daftar'),
        title,
        helper,
        stepper,
        emailForm,
        codeForm,
        message,
      ),
    ),
    h('footer', { class: 'auth-foot' },
      h('p', {}, 'Email Anda hanya dipakai untuk masuk dan pemberitahuan akun. Tanpa kata sandi, tanpa spam.'),
      h('p', { class: 'mono' }, '© 2026 Satu Alur'),
    ),
  )

  const page = h('div', { class: 'auth', 'data-step': 'email' }, stagePanel, formCol)
  if (!reduced) page.classList.add('is-entering')
  root.replaceChildren(page)

  // Stagger index for the entrance animation.
  ;[...formCol.querySelectorAll('.auth-bar, .auth-kicker, .auth-title, .auth-helper, .auth-steps, .auth-form-email, .auth-foot')]
    .forEach((el, i) => el.style.setProperty('--i', String(i)))

  /* ================= Behaviour ================= */
  function setStatus(text) { statusText.textContent = text }

  function say(text, tone = 'info') {
    message.textContent = text
    message.dataset.tone = tone
    message.hidden = !text
  }
  say('')

  function setSceneState(s) { scene?.setState?.(s) }

  function setBusy(btn, on, label) {
    busy = on
    btn.classList.toggle('is-loading', on)
    btn.setAttribute('aria-busy', on ? 'true' : 'false')
    btn.disabled = on
    if (label) btn.querySelector('.auth-btn-label').textContent = label
  }

  function showEmailError(text) {
    emailError.textContent = text
    emailError.hidden = !text
    emailInput.setAttribute('aria-invalid', text ? 'true' : 'false')
    emailInput.setAttribute('aria-describedby', text ? 'auth-email-error auth-email-hint' : 'auth-email-hint')
  }

  function goTo(next, { focus = true } = {}) {
    step = next
    page.dataset.step = next
    emailForm.hidden = next !== 'email'
    codeForm.hidden = next !== 'code'
    stepEmailItem.toggleAttribute('aria-current', next === 'email')
    if (next === 'email') stepEmailItem.setAttribute('aria-current', 'step')
    stepCodeItem.toggleAttribute('aria-current', next === 'code')
    if (next === 'code') stepCodeItem.setAttribute('aria-current', 'step')
    stepEmailItem.classList.toggle('is-done', next === 'code')
    title.textContent = COPY[next].title
    if (next === 'email') {
      helper.textContent = COPY.email.helper
      setStatus(COPY.email.status)
      setSceneState('idle')
      stopResend()
      if (focus) emailInput.focus()
    } else {
      helper.textContent = 'Masukkan kodenya di bawah. Kode yang dikirim sebelumnya otomatis tidak berlaku.'
      setStatus(COPY.code.status)
      setSceneState('code')
      if (focus) digits[0].focus()
    }
    // Replay the swap animation.
    const active = next === 'email' ? emailForm : codeForm
    if (!reduced) {
      active.classList.remove('is-swapping')
      void active.offsetWidth
      active.classList.add('is-swapping')
    }
  }

  /* ---- demo code (mock / demo backend) ---- */
  function renderDemo() {
    const ok = demoCode && step === 'code'
    demoBox.hidden = !ok
    if (!ok) return
    demoDigits.replaceChildren(...demoCode.split('').map((d) => h('span', { text: d })))
    demoDigits.setAttribute('aria-label', `Kode demo: ${demoCode.split('').join(' ')}`)
  }
  const onMockOtp = (e) => {
    const d = e.detail || {}
    if (!d.code || !pendingEmail || (d.email || '').toLowerCase() !== pendingEmail.toLowerCase()) return
    demoCode = String(d.code)
    renderDemo()
  }
  window.addEventListener('mock-otp-sent', onMockOtp)

  fillBtn.addEventListener('click', () => {
    if (!demoCode) return
    fillDigits(demoCode)
  })

  /* ---- resend countdown ---- */
  function stopResend() {
    clearInterval(resendTimer)
    resendTimer = 0
  }
  function startResend() {
    stopResend()
    resendLeft = RESEND_SECONDS
    const paint = () => {
      if (resendLeft > 0) {
        resendBtn.disabled = true
        resendBtn.innerHTML = `Kirim ulang dalam <span class="tnum">${formatTime(resendLeft)}</span>`
      } else {
        resendBtn.disabled = false
        resendBtn.textContent = 'Kirim ulang kode'
      }
    }
    paint()
    resendTimer = setInterval(() => {
      resendLeft -= 1
      paint()
      if (resendLeft <= 0) stopResend()
    }, 1000)
  }

  /* ---- step 1 ---- */
  emailInput.addEventListener('input', () => {
    if (emailInput.getAttribute('aria-invalid') === 'true' && EMAIL_RE.test(emailInput.value.trim())) showEmailError('')
  })

  async function requestCode({ resend = false } = {}) {
    const value = emailInput.value.trim()
    if (!value) {
      showEmailError('Isi alamat email Anda terlebih dahulu.')
      emailInput.focus()
      return
    }
    if (!EMAIL_RE.test(value)) {
      showEmailError('Format email belum benar, contoh: nama@usaha.id')
      emailInput.focus()
      return
    }
    showEmailError('')
    say('')
    email = value
    pendingEmail = value
    demoCode = ''
    const btn = resend ? resendBtn : sendBtn
    if (resend) {
      busy = true
      resendBtn.disabled = true
      resendBtn.textContent = 'Mengirim ulang…'
    } else {
      setBusy(sendBtn, true, 'Mengirim kode…')
    }
    setStatus('Mengirim kode')
    setSceneState('sending')
    try {
      const res = await sendEmailCode(value)
      if (disposed) return
      sentTo.textContent = value
      clearDigits()
      if (!resend) goTo('code')
      else {
        setStatus(COPY.code.status)
        setSceneState('code')
        digits[0].focus()
      }
      renderDemo()
      startResend()
      say(res?.isExistingUser
        ? 'Kode terkirim. Selamat datang kembali.'
        : resend ? 'Kode baru terkirim.' : 'Kode terkirim. Akun baru akan dibuat setelah verifikasi.', 'ok')
    } catch (err) {
      if (disposed) return
      pendingEmail = resend ? pendingEmail : ''
      setStatus(resend ? COPY.code.status : COPY.email.status)
      setSceneState('error')
      setTimeout(() => !disposed && setSceneState(resend ? 'code' : 'idle'), 600)
      say(err?.message || 'Gagal mengirim kode. Coba lagi.', 'error')
      if (resend) { resendBtn.disabled = false; resendBtn.textContent = 'Kirim ulang kode' }
    } finally {
      if (!disposed) {
        busy = false
        if (btn === sendBtn) setBusy(sendBtn, false, 'Kirim kode')
      }
    }
  }

  emailForm.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!busy) requestCode()
  })
  resendBtn.addEventListener('click', () => {
    if (!busy && resendLeft <= 0) requestCode({ resend: true })
  })
  changeEmailBtn.addEventListener('click', () => {
    if (busy) return
    say('')
    pendingEmail = ''
    demoCode = ''
    renderDemo()
    goTo('email')
    emailInput.select()
  })

  /* ---- step 2: digit boxes ---- */
  function code() { return digits.map((d) => d.value).join('') }
  function paintDigits() {
    digits.forEach((d) => d.classList.toggle('is-filled', !!d.value))
    otpGroup.classList.remove('is-error')
  }
  function clearDigits() {
    digits.forEach((d) => { d.value = '' })
    paintDigits()
  }
  function fillDigits(str, from = 0) {
    const clean = String(str).replace(/\D/g, '').slice(0, CODE_LENGTH - from)
    if (!clean) return
    clean.split('').forEach((ch, i) => { digits[from + i].value = ch })
    paintDigits()
    const nextEmpty = digits.findIndex((d) => !d.value)
    ;(digits[nextEmpty === -1 ? CODE_LENGTH - 1 : nextEmpty]).focus()
    maybeSubmit()
  }
  function maybeSubmit() {
    if (code().length === CODE_LENGTH && !busy) verify()
  }

  digits.forEach((input, i) => {
    input.addEventListener('focus', () => input.select())
    input.addEventListener('input', () => {
      const v = input.value.replace(/\D/g, '')
      if (v.length > 1) {
        // Autofill / IME may drop the whole code into one box.
        input.value = ''
        fillDigits(v, v.length >= CODE_LENGTH ? 0 : i)
        return
      }
      input.value = v
      paintDigits()
      if (v && message.dataset.tone === 'error') say('')
      if (v && i < CODE_LENGTH - 1) digits[i + 1].focus()
      maybeSubmit()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (input.value) { input.value = ''; paintDigits(); e.preventDefault() }
        else if (i > 0) { e.preventDefault(); digits[i - 1].value = ''; paintDigits(); digits[i - 1].focus() }
      } else if (e.key === 'Delete') {
        input.value = ''; paintDigits(); e.preventDefault()
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault(); digits[i - 1].focus()
      } else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) {
        e.preventDefault(); digits[i + 1].focus()
      } else if (e.key === 'Home') {
        e.preventDefault(); digits[0].focus()
      } else if (e.key === 'End') {
        e.preventDefault(); digits[CODE_LENGTH - 1].focus()
      } else if (e.key.length === 1 && /\d/.test(e.key) && input.value && input.selectionStart === input.selectionEnd) {
        // Typing over a filled box replaces it.
        input.value = ''
      }
    })
    input.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData('text') || ''
      const clean = text.replace(/\D/g, '')
      if (!clean) { e.preventDefault(); return }
      e.preventDefault()
      fillDigits(clean, clean.length >= CODE_LENGTH ? 0 : i)
    })
  })

  function shake() {
    otpGroup.classList.remove('is-error')
    void otpGroup.offsetWidth
    otpGroup.classList.add('is-error')
  }

  async function verify() {
    const value = code()
    if (value.length < CODE_LENGTH) {
      say(`Lengkapi ${CODE_LENGTH} digit kode terlebih dahulu.`, 'error')
      shake()
      digits[digits.findIndex((d) => !d.value)]?.focus()
      return
    }
    say('')
    setBusy(verifyBtn, true, 'Memverifikasi…')
    digits.forEach((d) => { d.readOnly = true })
    setStatus('Memverifikasi')
    setSceneState('verifying')
    try {
      const result = await submitEmailOtp(email, value)
      if (disposed) return
      page.classList.add('is-success')
      verifyBtn.classList.remove('is-loading')
      verifyBtn.classList.add('is-success')
      verifyBtn.querySelector('.auth-btn-label').textContent = 'Berhasil masuk'
      verifyBtn.querySelector('.auth-btn-icon').innerHTML = iconHTML('check', { size: 18, stroke: 2.5 })
      stepCodeItem.classList.add('is-done')
      setStatus('Terverifikasi')
      setSceneState('success')
      say('Berhasil. Membuka dasbor…', 'ok')
      stopResend()
      successTimer = setTimeout(() => {
        if (!disposed) ctx.onSignedIn?.(result?.user)
      }, reduced ? 250 : 900)
    } catch (err) {
      if (disposed) return
      setBusy(verifyBtn, false, 'Masuk')
      digits.forEach((d) => { d.readOnly = false })
      setStatus(COPY.code.status)
      setSceneState('error')
      setTimeout(() => !disposed && step === 'code' && setSceneState('code'), 600)
      say(err?.message || 'Kode salah. Periksa lagi lalu coba ulang.', 'error')
      shake()
      digits.forEach((d) => { d.value = '' })
      digits.forEach((d) => d.classList.remove('is-filled'))
      digits[0].focus()
    }
  }

  codeForm.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!busy) verify()
  })

  /* ================= Scene ================= */
  import('../three/auth-scene.js')
    .then(({ mountAuthScene }) => mountAuthScene(sceneBox, { labels: STAGES.map((_, i) => String(i + 1).padStart(2, '0')) }))
    .then((cleanup) => {
      if (disposed) { cleanup?.(); return }
      scene = cleanup
      scene?.setState?.(step === 'code' ? 'code' : 'idle')
    })
    .catch(() => sceneBox.classList.add('is-fallback'))

  // Initial focus: email field (keyboard users land in the form).
  // Only on fine pointers: on phones this would pop the keyboard over the page.
  if (window.matchMedia?.('(pointer: fine)').matches) {
    requestAnimationFrame(() => { if (!disposed && step === 'email') emailInput.focus({ preventScroll: true }) })
  }
  const enterTimer = setTimeout(() => page.classList.remove('is-entering'), 1400)

  return () => {
    disposed = true
    stopResend()
    clearTimeout(successTimer)
    clearTimeout(enterTimer)
    window.removeEventListener('mock-otp-sent', onMockOtp)
    if (typeof scene === 'function') scene()
    scene = null
  }
}

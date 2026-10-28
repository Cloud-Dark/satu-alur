// E2E: login "Live" mode (email -> OTP -> app) in mock mode, wrong code, digit
// boxes, resend countdown (fake clock), change email, sign out. TC-LIV-*, FR-001..FR-003.
const { waitDashboard } = require('./lib.cjs')

module.exports = async function loginLive(t) {
  const p = await t.page()
  await p.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await p.waitForSelector('#auth-email')
  t.check(await p.getAttribute('#auth-mode-live', 'aria-selected') === 'true', 'Live mode selected by default')

  // validation
  await p.click('.auth-form-email button[type=submit]')
  await p.waitForTimeout(150)
  t.check(/Isi alamat email/.test(await p.textContent('#auth-email-error')), 'empty email -> inline error')
  await p.fill('#auth-email', 'bukan-email')
  await p.click('.auth-form-email button[type=submit]')
  await p.waitForTimeout(150)
  t.check(await p.isVisible('#auth-email-error') && /Format email/.test(await p.textContent('#auth-email-error')), 'invalid email -> format error')
  t.check(await p.getAttribute('#auth-email', 'aria-invalid') === 'true', 'invalid email sets aria-invalid')
  await p.fill('#auth-email', 'qa.live@usaha.id')
  t.check(await p.getAttribute('#auth-email', 'aria-invalid') !== 'true', 'typing a valid email clears the error')

  // send code (Enter key)
  await p.keyboard.press('Enter')
  await p.waitForSelector('.auth-form-code:not([hidden])', { timeout: 8000 })
  await p.waitForSelector('.auth-demo:not([hidden])')
  const code = (await p.textContent('.auth-demo-code')).replace(/\D/g, '')
  t.check(/^\d{6}$/.test(code), 'demo code (6 digits) shown in mock/demo mode', code)
  t.check(/qa\.live@usaha\.id/.test(await p.textContent('.auth-sent-to')), 'code step shows the email')
  t.check(await p.evaluate(() => document.activeElement.classList.contains('auth-digit')), 'first digit box focused')
  t.check(await p.isDisabled('.auth-resend'), 'resend disabled during countdown')
  t.check(/Kirim ulang dalam/.test(await p.textContent('.auth-resend')), 'resend shows countdown')

  // wrong code
  const wrong = code.split('').map((d) => String((+d + 1) % 10)).join('')
  await p.keyboard.type(wrong, { delay: 20 })
  await p.waitForSelector('.auth-msg[data-tone=error]', { timeout: 5000 })
  t.check(/salah|kadaluarsa/i.test(await p.textContent('.auth-msg')), 'wrong code -> error message', await p.textContent('.auth-msg'))
  t.check(await p.evaluate(() => [...document.querySelectorAll('.auth-digit')].every((d) => !d.value)), 'digits cleared after wrong code')
  t.check(await p.evaluate(() => location.hash) === '#/masuk', 'wrong code stays on login')

  // digit box keyboard + paste
  await p.focus('.auth-digit >> nth=0')
  await p.keyboard.type('12')
  await p.keyboard.press('Backspace')
  await p.keyboard.press('Backspace')
  t.check(await p.evaluate(() => document.activeElement === document.querySelectorAll('.auth-digit')[0]), 'Backspace walks back to first box')
  await p.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text', '9 8 7')
    document.querySelectorAll('.auth-digit')[0].dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  t.check(await p.evaluate(() => [...document.querySelectorAll('.auth-digit')].map((d) => d.value).join('')) === '987', 'paste "9 8 7" fills 3 boxes')
  await p.evaluate(() => document.querySelectorAll('.auth-digit').forEach((d) => { d.value = '' }))

  // right code via "Isi otomatis" -> app
  await p.click('.auth-demo-fill')
  await p.waitForFunction(() => location.hash === '#/app', null, { timeout: 8000 })
  await waitDashboard(p)
  t.check(true, 'correct code lands on #/app with dashboard')
  t.check(/qa\.live@usaha\.id/.test(await p.textContent('.side-user-email').catch(() => '')), 'sidebar shows signed-in email')
  t.check(await p.locator('.auth').count() === 0, 'login page cleaned up')

  // sign out
  const out = p.locator('button[aria-label="Keluar"]')
  if (!(await out.isVisible())) await p.click('.topbar-menu')
  await out.click()
  await p.waitForFunction(() => location.hash === '#/' || location.hash === '', null, { timeout: 8000 })
  t.check(true, 'sign out returns to landing')
  await p.evaluate(() => { location.hash = '#/app' })
  await p.waitForTimeout(800)
  t.check(await p.evaluate(() => location.hash) === '#/masuk', '#/app without session redirects to #/masuk')
  await t.noErrors(p)

  /* ----- resend countdown + change email (fake clock) ----- */
  // reduced motion: the WebGL scene stays still, so fast-forwarding 30 s of fake time is cheap
  const r = await t.page({ reducedMotion: 'reduce' })
  await r.clock.install()
  await r.goto(`${t.base}/#/masuk`, { waitUntil: 'load' })
  await r.clock.runFor(1500)
  await r.waitForSelector('#auth-email')
  await r.fill('#auth-email', 'qa.resend@usaha.id')
  await r.click('.auth-form-email button[type=submit]')
  await r.waitForSelector('.auth-demo:not([hidden])')
  const c1 = (await r.textContent('.auth-demo-code')).replace(/\D/g, '')
  await r.clock.runFor(10000)
  t.check(/0:2\d|00:2\d/.test(await r.textContent('.auth-resend')), 'countdown ticks down (~20 s left after 10 s)', await r.textContent('.auth-resend'))
  await r.clock.runFor(21000)
  t.check(!(await r.isDisabled('.auth-resend')) && /Kirim ulang kode/.test(await r.textContent('.auth-resend')), 'resend enabled after 30 s')
  await r.click('.auth-resend')
  await r.clock.runFor(500)
  const c2 = (await r.textContent('.auth-demo-code')).replace(/\D/g, '')
  t.check(/^\d{6}$/.test(c2) && /Kode baru terkirim/.test(await r.textContent('.auth-msg')), 'resend issues a new code', `${c1} -> ${c2}`)
  t.check(await r.isDisabled('.auth-resend'), 'countdown restarts after resend')
  await r.click('.auth-sent .auth-link')
  await r.clock.runFor(500)
  t.check(await r.isVisible('#auth-email') && (await r.inputValue('#auth-email')) === 'qa.resend@usaha.id', '"Ganti email" returns to step 1 with the email kept')
  await t.noErrors(r)
}

/**
 * Kantor Satu Alur › Sistem: Ringkasan, Email, AI, Login, WhatsApp & sosial, Log aktivitas.
 * Admins only (staff sessions or ADMIN_EMAILS logins). Secrets are never shown here, only whether
 * they are configured; everything editable is a non-secret platform setting (system_settings).
 */
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { OFFICE_PAGE_SIZE } from '../../office/paging.js'
import { listPlatformModels, testPlatformAi, savePlatformAi } from '../../admin/api.js'
import { modelPicker } from '../../ui/model-picker.js'
import { getSystem, saveSystemSetting, saveEmailTransport, testSystemEmail, testSystemAi, getSummary, getActivity, listAdmins, addAdmin, removeAdmin } from '../../admin/api.js'
import { t } from '../../i18n/index.js'
import { featureLabel } from '../../quota/labels.js'

const { el } = C
let seq = 0

const yes = (on, onText = t('office.sys.configured'), offText = t('office.sys.notYet')) => C.tag(on ? onText : offText, on ? 'ok' : 'warn')

async function loadInto(host, ctx, loader, render) {
  host.replaceChildren(C.skeletonRows(4))
  let data
  try { data = await loader() } catch (ex) {
    if (ctx.signal.aborted) return
    const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => loadInto(host, ctx, loader, render))
    host.replaceChildren(C.errorState(ex.message), again)
    return
  }
  if (!ctx.signal.aborted) render(data)
}

function toggle(label, checked, hint) {
  const id = `of-sys-t-${++seq}`
  const input = el('input', { type: 'checkbox', id, checked: Boolean(checked) })
  const wrap = el('div', { className: 'choice' },
    el('label', { className: 'choice-label', htmlFor: id }, input, el('span', {}, label)),
    hint ? el('span', { className: 'field-hint' }, hint) : null)
  return { wrap, input }
}

/** A settings form for one system_settings key: fields + Simpan with dirty tracking. */
function settingsForm({ key, ctx, setDirty, fields, read, onSaved }) {
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'form', noValidate: true }, ...fields, err, el('div', { className: 'form-actions' }, save))
  let saved = JSON.stringify(read())
  const sync = () => setDirty(JSON.stringify(read()) !== saved)
  form.addEventListener('input', sync)
  form.addEventListener('change', sync)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      const res = await saveSystemSetting(key, read())
      saved = JSON.stringify(read())
      setDirty(false)
      showToast(t('office.sys.settingsSaved'), 'success')
      onSaved?.(res.value)
    } catch (ex) { err.textContent = ex.message } finally { restore() }
    if (ctx.signal.aborted) return
  })
  return form
}

/* -------------------------------------------------------------- Ringkasan */

export function drawOverview(host, ctx) {
  loadInto(host, ctx, async () => ({ sum: await getSummary(), sys: await getSystem() }), ({ sum, sys }) => {
    const st = sys.status
    const kpis = el('div', { className: 'kpis of-sys-kpis' },
      C.kpi({ label: t('office.menu.users'), value: C.number(sum.users), sub: t('office.sys.newThisWeek', { n: C.number(sum.new_this_week) }), iconName: 'users' }),
      C.kpi({ label: t('office.sys.active7'), value: C.number(sum.active_this_week), sub: t('office.sys.suspendedCount', { n: C.number(sum.suspended) }), iconName: 'shield' }),
      C.kpi({ label: t('office.sys.aiCallsMonth'), value: C.number(sum.ai_calls_month), sub: t('office.sys.viaOwnProvider', { n: C.number(sum.ai_calls_own_provider_month) }), iconName: 'sparkles' }),
      C.kpi({ label: t('office.sys.emailsMonth'), value: C.number(sum.emails_month), sub: sum.emails_failed_month ? t('office.sys.failedCount', { n: C.number(sum.emails_failed_month) }) : t('office.sys.noneFailed'), iconName: 'mail' }),
      C.kpi({ label: t('office.sys.vouchersRedeemed'), value: C.number(sum.vouchers_redeemed_month), sub: t('office.sys.period', { period: sum.period }), iconName: 'receipt' }),
    )
    const health = C.panel({ title: t('office.sys.health') }, C.defList([
      ['Email (Resend)', yes(st.email.resend)],
      [t('office.sys.encKey'), yes(st.encryption, t('office.common.active'), t('office.sys.notSet'))],
      [t('office.sys.otpLogin'), yes(st.login.otp_email, t('office.common.active'), t('office.sys.demoMode'))],
      [t('office.sys.google'), yes(st.login.google)],
      [t('office.sys.adminViaEmail'), el('span', {}, t('office.sys.addresses', { count: st.login.admin_emails }))],
    ]))
    host.replaceChildren(kpis, health, sys.demo ? C.message() : '')
    if (sys.demo) host.lastChild.show('info', t('office.sys.demoNote'))
  })
}

/* ------------------------------------------------------------------ Email */

export function drawEmail(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const s = sys.settings.email
    const st = sys.status.email
    const fromName = C.field({ label: t('office.email.fromName'), id: `of-sys-from-${++seq}`, value: s.from_name, hint: t('office.sys.addressHint', { from: st.from }), attrs: { maxlength: '60' } })
    const allow = toggle(t('office.sys.allowSmtp'), s.allow_custom_smtp, sys.status.encryption ? t('office.sys.smtpEncrypted') : t('office.sys.needKey'))
    const cap = C.field({ label: t('office.sys.offerCap'), id: `of-sys-cap-${seq}`, type: 'number', value: String(s.offer_daily_cap), attrs: { min: '1', max: '200' } })
    const form = settingsForm({
      key: 'email', ctx, setDirty, fields: [fromName.wrap, allow.wrap, cap.wrap],
      read: () => ({ from_name: fromName.input.value, allow_custom_smtp: allow.input.checked, offer_daily_cap: Number(cap.input.value) || 20 }),
    })
    const to = C.field({ label: t('office.sys.testTo'), id: `of-sys-to-${seq}`, type: 'email', hint: t('office.sys.testToHint'), attrs: { maxlength: '254' } })
    const out = C.message()
    const testBtn = C.button({ label: t('office.sys.sendTest'), icon: 'mail', variant: 'soft' })
    testBtn.addEventListener('click', async () => {
      const restore = C.setBusy(testBtn, t('office.common.sending'))
      try {
        const r = await testSystemEmail(to.input.value.trim())
        const via = providerLabel(r.provider)
        out.show('ok', r.simulated ? t('office.sys.testSimulated', { via }) : t('office.sys.testSent', { to: r.to, via }))
      } catch (ex) { out.show('danger', ex.message) } finally { restore() }
    })
    host.replaceChildren(
      transportPanel(sys, ctx, setDirty),
      C.panel({ title: t('office.sys.delivery'), meta: t('office.sys.deliveryMeta') },
        C.defList([['Resend', yes(st.resend)], [t('office.sys.fromAddress'), el('code', {}, st.from)], [t('office.sys.bizWithSmtp'), el('span', {}, C.number(st.businesses_with_smtp))]]),
        form),
      C.panel({ title: t('office.sys.testDelivery') }, to.wrap, el('div', { className: 'form-actions' }, testBtn), out),
    )
  })
}

function noKey() {
  const m = C.message()
  m.show('warn', t('office.sys.noKeySmtp'))
  return m
}

const PROVIDER_KEYS = ['resend', 'platform_smtp', 'smtp', 'demo']
const providerLabel = (p) => (PROVIDER_KEYS.includes(p) ? t(`office.sys.provider.${p}`) : p)

/**
 * Platform transport: Resend (default) or the admin's own SMTP server. It carries system email
 * (login codes, notifications) and is the default for businesses without their own SMTP.
 * If the custom SMTP fails, the Worker falls back to Resend so sign-in never breaks.
 */
function transportPanel(sys, ctx, setDirty) {
  const tr = sys.status.email.transport || { mode: 'resend' }
  const n = ++seq
  let modeValue = tr.mode === 'smtp' ? 'smtp' : 'resend'
  const mode = C.segmented({ label: t('office.sys.transport'), scroll: true, value: modeValue, options: [{ value: 'resend', label: t('office.sys.resendDefault') }, { value: 'smtp', label: t('office.sys.customSmtp') }], onChange: (v) => { modeValue = v; sync(); markDirty() } })
  const host = C.field({ label: t('office.sys.smtpHost'), id: `of-tr-host-${n}`, value: tr.host || '', attrs: { placeholder: 'smtp.resend.com', autocomplete: 'off', spellcheck: 'false' } })
  const port = C.select({ label: 'Port', id: `of-tr-port-${n}`, options: [465, 587, 2465, 2587].map((p) => ({ value: String(p), label: String(p) })), value: String(tr.port || 465) })
  const secure = C.select({ label: t('office.sys.security'), id: `of-tr-sec-${n}`, options: [{ value: 'tls', label: t('office.sys.tlsDirect') }, { value: 'starttls', label: 'STARTTLS (587/2587)' }], value: tr.secure || 'tls' })
  const user = C.field({ label: 'Username', id: `of-tr-user-${n}`, value: tr.user || '', attrs: { autocomplete: 'off' } })
  const pass = C.field({ label: 'Password', id: `of-tr-pass-${n}`, type: 'password', hint: tr.pass_saved ? t('office.sys.savedLast4', { last4: tr.pass_last4 || '****' }) : t('office.sys.encryptedServer'), attrs: { autocomplete: 'new-password', placeholder: tr.pass_saved ? '••••••••' : '' } })
  const fromName = C.field({ label: t('office.email.fromName'), id: `of-tr-fn-${n}`, value: tr.from_name || '', attrs: { maxlength: '60', placeholder: 'Satu Alur' } })
  const fromEmail = C.field({ label: t('office.email.fromEmail'), id: `of-tr-fe-${n}`, type: 'email', value: tr.from_email || '', attrs: { placeholder: 'noreply@domainanda.id' } })
  const replyTo = C.field({ label: t('office.sys.replyTo'), id: `of-tr-rt-${n}`, type: 'email', value: tr.reply_to || '', hint: t('office.sys.optional') })
  port.input.addEventListener('change', () => { secure.input.value = ['465', '2465'].includes(port.input.value) ? 'tls' : 'starttls' })
  const smtpBox = el('div', { className: 'of-tr-smtp' },
    el('div', { className: 'form-row' }, host.wrap, port.wrap), el('div', { className: 'form-row' }, secure.wrap, user.wrap), pass.wrap,
    el('div', { className: 'form-row' }, fromName.wrap, fromEmail.wrap), replyTo.wrap)
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.sys.useTransport'), icon: 'save', variant: 'primary', type: 'submit' })
  const read = () => ({ mode: modeValue, host: host.input.value.trim(), port: Number(port.input.value), secure: secure.input.value, user: user.input.value.trim(), pass: pass.input.value, from_name: fromName.input.value.trim(), from_email: fromEmail.input.value.trim(), reply_to: replyTo.input.value.trim() })
  const sync = () => { smtpBox.hidden = modeValue !== 'smtp' }
  let saved = JSON.stringify(read())
  const markDirty = () => setDirty(JSON.stringify(read()) !== saved)
  const form = el('form', { className: 'form', noValidate: true }, mode, smtpBox, err, el('div', { className: 'form-actions' }, save))
  form.addEventListener('input', markDirty)
  form.addEventListener('change', markDirty)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      const r = await saveEmailTransport(read())
      pass.input.value = ''
      if (r.transport?.pass_saved) pass.wrap.querySelector('.field-hint').textContent = t('office.sys.savedLast4', { last4: r.transport.pass_last4 || '****' })
      saved = JSON.stringify(read())
      setDirty(false)
      showToast(r.transport?.mode === 'smtp' ? t('office.sys.smtpSaved') : t('office.sys.backToResend'), 'success')
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  sync()
  if (!sys.status.encryption) mode.querySelector('[data-value="smtp"]')?.setAttribute('disabled', '')
  return C.panel({ title: t('office.sys.transport'), meta: tr.mode === 'smtp' ? t('office.sys.customSmtpActive') : t('office.sys.resendDefault') },
    el('p', { className: 'muted small' }, t('office.sys.transportDesc')),
    sys.status.encryption ? '' : noKey(),
    form)
}

/* --------------------------------------------------------------------- AI */

const OPENAI_BASE = 'https://api.openai.com/v1'
const ANTHROPIC_BASE = 'https://api.anthropic.com'

/**
 * Platform AI provider: what "Bawaan Satu Alur" runs on for every live business (quota still
 * applies). Workers AI by default, or an OpenAI-/Anthropic-compatible provider with the
 * platform's key. Saving needs a successful "Uji" with the same values, or an explicit confirm.
 */
function providerPanel(sys, setDirty) {
  const p = sys.status.ai.provider || { mode: 'workers' }
  const PROVIDER_MODES = { workers: t('office.sys.workersDefault'), openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' }
  // The Worker sends Indonesian labels; show ours for the modes we know.
  const labels = Object.fromEntries(Object.keys(sys.status.ai.provider_modes || PROVIDER_MODES).map((k) => [k, PROVIDER_MODES[k] || sys.status.ai.provider_modes[k]]))
  const n = ++seq
  let mode = p.mode || 'workers'
  const seg = C.segmented({ label: t('office.sys.platformAi'), scroll: true, value: mode, options: Object.entries(labels).map(([value, label]) => ({ value, label })), onChange: (v) => { mode = v; sync(); changed() } })
  const base = C.field({ label: t('office.sys.apiBase'), id: `of-ai-base-${n}`, value: p.base_url || '', attrs: { autocomplete: 'off', spellcheck: 'false', maxlength: '300' } })
  const key = C.field({ label: 'API key', id: `of-ai-key-${n}`, type: 'password', hint: p.key_saved ? t('office.sys.savedLast4', { last4: p.key_last4 || '****' }) : t('office.sys.encryptedNever'), attrs: { autocomplete: 'new-password', placeholder: p.key_saved ? '••••••••' : '' } })
  const values = () => ({ mode, base_url: base.input.value.trim(), model: picker.input.value.trim(), api_key: key.input.value.trim(), max_tokens: maxTok.input.value, temperature: temp.input.value })
  const picker = modelPicker({ id: `of-ai-model-${n}`, value: p.model || '', fetchModels: () => listPlatformModels(values()) })
  const maxTok = C.field({ label: t('office.sys.maxTokens'), id: `of-ai-mt-${n}`, type: 'number', value: p.max_tokens ? String(p.max_tokens) : '', hint: t('office.sys.maxTokensHint'), attrs: { min: '16', max: '8192' } })
  const temp = C.field({ label: t('office.sys.temp'), id: `of-ai-tp-${n}`, type: 'number', value: p.temperature ?? '', hint: t('office.sys.tempHint'), attrs: { min: '0', max: '2', step: '0.1' } })
  const box = el('div', { className: 'of-ai-provider' }, base.wrap, key.wrap, picker.wrap, el('div', { className: 'form-row' }, maxTok.wrap, temp.wrap))
  const out = C.message()
  const testBtn = C.button({ label: t('office.sys.test'), icon: 'sparkles', variant: 'soft' })
  const save = C.button({ label: t('office.sys.saveProvider'), icon: 'save', variant: 'primary' })
  let tested = null
  const snapshot = () => JSON.stringify(values())
  let saved = snapshot()
  const changed = () => { tested = tested === snapshot() ? tested : null; setDirty(snapshot() !== saved) }
  function sync() {
    box.hidden = mode === 'workers'
    if (mode === 'openai' && (!base.input.value || base.input.value === ANTHROPIC_BASE)) base.input.value = OPENAI_BASE
    if (mode === 'anthropic' && (!base.input.value || base.input.value === OPENAI_BASE)) base.input.value = ANTHROPIC_BASE
    picker.input.placeholder = mode === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'
    picker.reset()
  }
  box.addEventListener('input', changed)
  box.addEventListener('change', changed)
  testBtn.addEventListener('click', async () => {
    out.hide()
    const restore = C.setBusy(testBtn, t('office.common.testing'))
    try {
      const r = await testPlatformAi(values())
      tested = snapshot()
      out.show('ok', t('office.sys.aiAnswered', { model: mode === 'workers' ? 'Workers AI' : r.model, reply: r.reply || '…', ms: C.number(r.ms || 0) }))
    } catch (ex) { tested = null; out.show('danger', ex.message) } finally { restore() }
  })
  save.addEventListener('click', async () => {
    out.hide()
    if (mode !== 'workers' && tested !== snapshot() && !confirm(t('office.sys.confirmUntested'))) return
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      const r = await savePlatformAi(values())
      key.input.value = ''
      if (r.provider?.key_saved) key.wrap.querySelector('.field-hint').textContent = t('office.sys.savedLast4', { last4: r.provider.key_last4 || '****' })
      saved = snapshot()
      setDirty(false)
      showToast(r.provider?.mode === 'workers' ? t('office.sys.backToWorkers') : t('office.sys.providerSet', { name: labels[r.provider.mode] }), 'success')
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  sync()
  return C.panel({ title: t('office.sys.platformAi'), meta: labels[p.mode] || labels.workers },
    el('p', { className: 'muted small' }, t('office.sys.platformAiDesc')),
    sys.status.encryption ? null : (() => { const m = C.message(); m.show('warn', t('office.sys.noKeyAi')); return m })(),
    seg, box, el('div', { className: 'form-actions' }, testBtn, save), out)
}

export function drawAi(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const s = sys.settings.ai
    const st = sys.status.ai
    const model = C.select({ label: t('office.sys.workersModel'), id: `of-sys-model-${++seq}`, options: st.builtin_models.map((m) => ({ value: m.id, label: m.name })), value: s.default_model, hint: t('office.sys.workersModelHint') })
    const allow = toggle(t('office.sys.allowAi'), s.allow_custom, t('office.sys.allowAiHint'))
    const form = settingsForm({
      key: 'ai', ctx, setDirty, fields: [model.wrap, allow.wrap],
      read: () => ({ default_model: model.input.value, allow_custom: allow.input.checked }),
    })
    const out = C.message()
    const testBtn = C.button({ label: t('office.sys.testWorkers'), icon: 'sparkles', variant: 'soft' })
    testBtn.addEventListener('click', async () => {
      const restore = C.setBusy(testBtn, t('office.common.testing'))
      try {
        const r = await testSystemAi()
        out.show('ok', t('office.sys.modelAnswered', { model: r.model, reply: r.reply || '…', ms: r.ms ? t('office.sys.inMs', { ms: r.ms }) : '' }))
      } catch (ex) { out.show('danger', ex.message) } finally { restore() }
    })
    form.querySelector('.form-actions')?.append(testBtn)
    host.replaceChildren(
      providerPanel(sys, setDirty),
      C.panel({ title: t('office.sys.workersBiz'), meta: t('office.sys.fallbackModel') },
        C.defList([
          [t('office.sys.perBusinessChoice'), el('span', {}, Object.keys(st.modes).map((k) => (['builtin', 'openai', 'anthropic'].includes(k) ? t(`office.sys.aiMode.${k}`) : st.modes[k])).join(' · '))],
          [t('office.sys.bizWithAi'), el('span', {}, C.number(st.businesses_with_custom))],
          [t('office.sys.encKey'), yes(sys.status.encryption, t('office.common.active'), t('office.sys.notSet'))],
        ]),
        form, out),
    )
  })
}

/* ------------------------------------------------------------------ Login */

export function drawLogin(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const l = sys.status.login
    const otp = toggle(t('office.sys.allowOtp'), sys.settings.login.otp_email, t('office.sys.allowOtpHint'))
    const form = settingsForm({ key: 'login', ctx, setDirty, fields: [otp.wrap], read: () => ({ otp_email: otp.input.checked }) })
    host.replaceChildren(
      C.panel({ title: t('office.sys.signInMethods') },
        C.defList([
          [t('office.sys.otpCode'), l.demo_otp ? C.tag(t('office.sys.otpDemo'), 'warn') : yes(l.otp_email, t('office.sys.sentToEmail'), t('office.sys.off'))],
          [t('office.sys.demoAccounts'), yes(l.demo_login, t('office.common.active'), t('office.sys.off'))],
          [t('office.sys.google'), yes(l.google)],
          [t('office.sys.googleRedirect'), el('code', { className: 'of-sys-code' }, l.google_redirect_uri)],
          [t('office.sys.adminByEmail'), el('span', {}, t('office.sys.addressesEnv', { count: l.admin_emails }))],
        ]),
        form),
    )
  })
}

/* ------------------------------------------------------- WhatsApp & sosial */

export function drawWhatsapp(host, ctx) {
  loadInto(host, ctx, getSystem, (sys) => {
    const w = sys.status.whatsapp
    const n = (v) => (v === null || v === undefined ? el('span', { className: 'muted' }, t('office.sys.notAvailable')) : el('span', {}, t('office.sys.businesses', { n: C.number(v) })))
    host.replaceChildren(C.panel({ title: t('office.sys.waTitle'), meta: t('office.sys.perBusiness') },
      el('p', { className: 'muted small' }, t('office.sys.waDesc')),
      C.defList([
        ['WAPilot', n(w.wapilot)],
        ['WAConsole', n(w.waconsole)],
        [t('office.sys.repliz'), n(w.repliz)],
        [t('office.sys.waSent'), w.wa_sent_month == null ? el('span', { className: 'muted' }, t('office.sys.notAvailable')) : el('span', { className: 'tnum' }, C.number(w.wa_sent_month))],
        [t('office.sys.socialPosts'), w.repliz_posts_month == null ? el('span', { className: 'muted' }, t('office.sys.notAvailable')) : el('span', { className: 'tnum' }, C.number(w.repliz_posts_month))],
        [t('office.sys.platformFallback'), C.tag(w.platform_fallback ? t('office.common.active') : t('office.sys.offDefault'), w.platform_fallback ? 'warn' : 'neutral')],
      ])))
  })
}

/* ---------------------------------------------------------- Log aktivitas */

const KIND_KEYS = ['', 'otp', 'offer', 'report', 'test', 'admin_test']
const kindLabel = (k) => t(`office.sys.kind.${k || 'all'}`)

export function drawActivity(host, ctx) {
  const kind = C.select({ label: t('office.sys.emailKind'), id: `of-sys-kind-${++seq}`, options: KIND_KEYS.map((value) => ({ value, label: kindLabel(value) })), value: '' })
  const body = el('div', { className: 'of-content', 'aria-live': 'polite' })
  const pg = C.pager({ label: t('office.sys.pagerLabel'), pageSize: OFFICE_PAGE_SIZE, sizes: [OFFICE_PAGE_SIZE], hideSize: true, onChange: () => load(pg.page), scrollTarget: () => body })
  host.replaceChildren(body)
  const load = (page = 1) => loadInto(body, ctx, () => getActivity(kind.input.value, page), (a) => {
    if (page === 1) pg.reset()
    pg.slice(new Array(a.emails_total ?? a.emails.length))
    const emails = a.emails.length
      ? C.dataTable({
        columns: [
          { label: t('office.common.time'), render: (r) => C.formatDateTime(r.created_at) },
          { label: t('office.vouchers.typeCol'), render: (r) => (KIND_KEYS.includes(r.kind) ? kindLabel(r.kind) : r.kind) },
          { label: t('office.sys.recipient'), render: (r) => r.recipient },
          { label: t('office.requests.business'), render: (r) => r.owner_email || '—' },
          { label: t('office.sys.via'), render: (r) => providerLabel(r.provider) },
          { label: t('office.common.status'), render: (r) => C.tag(r.status === 'sent' ? t('office.sys.sent') : t('office.sys.failed'), r.status === 'sent' ? 'ok' : 'danger') },
        ],
        rows: a.emails,
      })
      : C.emptyState({ title: t('office.sys.noEmails'), body: t('office.sys.noEmailsBody'), iconName: 'mail' })
    const usage = a.usage.length
      ? C.dataTable({
        columns: [
          { label: t('office.sys.feature'), render: (r) => (r.feature.startsWith('byo_') ? t('office.sys.ownProvider', { feature: featureLabel(r.feature.slice(4)) }) : featureLabel(r.feature)) },
          { label: t('office.sys.calls'), align: 'right', render: (r) => C.number(r.calls) },
          { label: t('office.requests.business'), align: 'right', render: (r) => C.number(r.users) },
        ],
        rows: a.usage,
      })
      : C.emptyState({ title: t('office.sys.noUsage'), body: t('office.sys.periodDot', { period: a.period }), iconName: 'sparkles' })
    const events = (a.ai_events || []).length
      ? C.dataTable({
        columns: [
          { label: t('office.common.time'), render: (r) => C.formatDateTime(r.created_at) },
          { label: t('office.sys.providerCol'), render: (r) => r.target || '—' },
          { label: t('office.customers.reasonLabel'), render: (r) => r.detail || '—' },
        ],
        rows: a.ai_events,
      })
      : C.emptyState({ title: t('office.sys.noIncidents'), body: t('office.sys.noIncidentsBody'), iconName: 'sparkles' })
    body.replaceChildren(
      C.panel({ title: t('office.sys.emailsSent'), meta: t('office.sys.emailCount', { n: C.number(a.emails_total ?? a.emails.length) }) }, kind.wrap, emails, pg.root),
      C.panel({ title: t('office.sys.usageByFeature'), meta: t('office.sys.period', { period: a.period }) }, usage),
      C.panel({ title: t('office.sys.aiFallbackTitle'), meta: t('office.sys.latest', { n: 20 }) }, events),
    )
  })
  kind.input.addEventListener('change', () => load(1))
  load(1)
}

/* ----------------------------------------------------------- Akses admin */

const ACTION_KEYS = { 'admin.add': 'adminAdd', 'admin.remove': 'adminRemove', 'setting.update': 'settingUpdate', 'user.tier': 'userTier', 'ai.fallback': 'aiFallback' }

export function drawAccess(host, ctx) {
  const load = () => loadInto(host, ctx, listAdmins, (d) => {
    const email = C.field({ label: t('office.sys.newAdmin'), id: `of-sys-adm-${++seq}`, type: 'email', hint: t('office.sys.newAdminHint'), attrs: { maxlength: '254', autocomplete: 'off' } })
    const err = el('p', { className: 'field-error', role: 'alert' })
    const add = C.button({ label: t('office.sys.addAdmin'), icon: 'plus', variant: 'primary', type: 'submit' })
    const form = el('form', { className: 'form', noValidate: true }, email.wrap, err, el('div', { className: 'form-actions' }, add))
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      err.textContent = ''
      const restore = C.setBusy(add, t('office.sys.adding'))
      try { await addAdmin(email.input.value); showToast(t('office.sys.adminAdded'), 'success'); if (!ctx.signal.aborted) load() } catch (ex) { err.textContent = ex.message } finally { restore() }
    })
    const rows = d.admins.length
      ? C.paginate({ key: 'office-admins', label: t('office.sys.adminPager'), pageSize: 10, items: d.admins, render: (page) => el('div', { className: 'of-cust-list' }, page.map((a) => {
        const rm = C.button({ label: t('office.common.delete'), variant: 'ghost', size: 'sm' })
        rm.addEventListener('click', async () => {
          if (!confirm(t('office.sys.confirmRevokeAdmin', { email: a.email }))) return
          const restore = C.setBusy(rm, t('office.common.deleting'))
          try { await removeAdmin(a.email); showToast(t('office.sys.adminRevoked'), 'success'); if (!ctx.signal.aborted) load() } catch (ex) { showToast(ex.message, 'error') } finally { restore() }
        })
        return el('div', { className: 'of-user of-admin-row' },
          el('span', { className: 'of-cust-main' }, el('strong', {}, a.email), el('span', { className: 'muted small' }, t('office.sys.addedBy', { date: C.formatDate(a.added_at), who: a.added_by }))),
          el('span', { className: 'of-cust-meta' }, d.bootstrap.includes(a.email) ? C.tag(t('office.sys.alsoBuiltin'), 'brand') : null),
          el('span', { className: 'of-cust-meta' }, rm))
      })) }).root
      : C.emptyState({ title: t('office.sys.noExtraAdmins'), body: t('office.sys.noExtraAdminsBody'), iconName: 'shield' })
    const auditList = d.audit.length
      ? C.paginate({ key: 'office-audit', label: t('office.sys.auditPager'), pageSize: 10, items: d.audit, render: (page) => C.dataTable({
        columns: [
          { label: t('office.common.time'), render: (r) => C.formatDateTime(r.created_at) },
          { label: t('office.sys.by'), render: (r) => r.actor },
          { label: t('office.sys.actionCol'), render: (r) => (ACTION_KEYS[r.action] ? t(`office.sys.action.${ACTION_KEYS[r.action]}`) : r.action) },
          { label: t('office.sys.target'), render: (r) => r.target || '—' },
        ],
        rows: page,
      }) }).root
      : C.emptyState({ title: t('office.sys.noAudit'), body: t('office.sys.noAuditBody'), iconName: 'activity' })
    host.replaceChildren(
      C.panel({ title: t('office.menu.sysAccess'), meta: t('office.sys.adminCount', { count: d.admins.length }) },
        d.email_admins_active ? null : (() => { const m = C.message(); m.show('warn', t('office.sys.demoOtpWarn')); return m })(),
        rows, form),
      C.panel({ title: t('office.sys.builtinAdmins'), meta: 'ADMIN_EMAILS' },
        el('p', { className: 'muted small' }, t('office.sys.builtinAdminsDesc')),
        d.bootstrap.length ? el('ul', {}, d.bootstrap.map((x) => el('li', {}, x))) : el('p', { className: 'muted' }, '—')),
      C.panel({ title: t('office.sys.audit'), meta: t('office.sys.latest', { n: 50 }) }, auditList),
    )
  })
  load()
}

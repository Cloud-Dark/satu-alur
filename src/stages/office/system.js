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

const { el } = C
let seq = 0

const yes = (on, onText = 'Terkonfigurasi', offText = 'Belum') => C.tag(on ? onText : offText, on ? 'ok' : 'warn')

async function loadInto(host, ctx, loader, render) {
  host.replaceChildren(C.skeletonRows(4))
  let data
  try { data = await loader() } catch (ex) {
    if (ctx.signal.aborted) return
    const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
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
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'form', noValidate: true }, ...fields, err, el('div', { className: 'form-actions' }, save))
  let saved = JSON.stringify(read())
  const sync = () => setDirty(JSON.stringify(read()) !== saved)
  form.addEventListener('input', sync)
  form.addEventListener('change', sync)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      const res = await saveSystemSetting(key, read())
      saved = JSON.stringify(read())
      setDirty(false)
      showToast('Pengaturan disimpan.', 'success')
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
      C.kpi({ label: 'Pengguna', value: C.number(sum.users), sub: `+${C.number(sum.new_this_week)} minggu ini`, iconName: 'users' }),
      C.kpi({ label: 'Aktif 7 hari', value: C.number(sum.active_this_week), sub: `${C.number(sum.suspended)} ditangguhkan`, iconName: 'shield' }),
      C.kpi({ label: 'Panggilan AI bulan ini', value: C.number(sum.ai_calls_month), sub: `${C.number(sum.ai_calls_own_provider_month)} lewat penyedia sendiri`, iconName: 'sparkles' }),
      C.kpi({ label: 'Email bulan ini', value: C.number(sum.emails_month), sub: sum.emails_failed_month ? `${C.number(sum.emails_failed_month)} gagal` : 'Tidak ada yang gagal', iconName: 'mail' }),
      C.kpi({ label: 'Voucher ditukar', value: C.number(sum.vouchers_redeemed_month), sub: `Periode ${sum.period}`, iconName: 'receipt' }),
    )
    const health = C.panel({ title: 'Kesehatan sistem' }, C.defList([
      ['Email (Resend)', yes(st.email.resend)],
      ['Kunci enkripsi', yes(st.encryption, 'Aktif', 'Belum diatur')],
      ['Login kode email', yes(st.login.otp_email, 'Aktif', 'Mode demo')],
      ['Masuk dengan Google', yes(st.login.google)],
      ['Admin via email', el('span', {}, `${st.login.admin_emails} alamat`)],
    ]))
    host.replaceChildren(kpis, health, sys.demo ? C.message() : '')
    if (sys.demo) host.lastChild.show('info', 'Mode demo lokal: angka dan status di halaman Sistem disimulasikan.')
  })
}

/* ------------------------------------------------------------------ Email */

export function drawEmail(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const s = sys.settings.email
    const st = sys.status.email
    const fromName = C.field({ label: 'Nama pengirim', id: `of-sys-from-${++seq}`, value: s.from_name, hint: `Alamat: ${st.from}`, attrs: { maxlength: '60' } })
    const allow = toggle('Izinkan bisnis memakai SMTP sendiri', s.allow_custom_smtp, sys.status.encryption ? 'Password SMTP bisnis disimpan terenkripsi.' : 'Butuh kunci enkripsi server (TOKEN_KEY).')
    const cap = C.field({ label: 'Batas email penawaran per bisnis per hari', id: `of-sys-cap-${seq}`, type: 'number', value: String(s.offer_daily_cap), attrs: { min: '1', max: '200' } })
    const form = settingsForm({
      key: 'email', ctx, setDirty, fields: [fromName.wrap, allow.wrap, cap.wrap],
      read: () => ({ from_name: fromName.input.value, allow_custom_smtp: allow.input.checked, offer_daily_cap: Number(cap.input.value) || 20 }),
    })
    const to = C.field({ label: 'Kirim email uji ke', id: `of-sys-to-${seq}`, type: 'email', hint: 'Kosongkan untuk mengirim ke email Anda sendiri.', attrs: { maxlength: '254' } })
    const out = C.message()
    const testBtn = C.button({ label: 'Kirim email uji', icon: 'mail', variant: 'soft' })
    testBtn.addEventListener('click', async () => {
      const restore = C.setBusy(testBtn, 'Mengirim…')
      try {
        const r = await testSystemEmail(to.input.value.trim())
        const via = PROVIDER_LABEL[r.provider] || r.provider
        out.show('ok', r.simulated ? `Simulasi: email uji dicatat (mode demo lokal) lewat ${via}.` : `Terkirim ke ${r.to} lewat ${via}.`)
      } catch (ex) { out.show('danger', ex.message) } finally { restore() }
    })
    host.replaceChildren(
      transportPanel(sys, ctx, setDirty),
      C.panel({ title: 'Pengiriman email', meta: 'Default: Resend' },
        C.defList([['Resend', yes(st.resend)], ['Alamat pengirim', el('code', {}, st.from)], ['Bisnis dengan SMTP sendiri', el('span', {}, C.number(st.businesses_with_smtp))]]),
        form),
      C.panel({ title: 'Uji pengiriman' }, to.wrap, el('div', { className: 'form-actions' }, testBtn), out),
    )
  })
}

function noKey() {
  const m = C.message()
  m.show('warn', 'Kunci enkripsi server belum diatur, jadi SMTP kustom belum bisa dipakai.')
  return m
}

const PROVIDER_LABEL = { resend: 'Resend', platform_smtp: 'SMTP platform', smtp: 'SMTP bisnis', demo: 'simulasi' }

/**
 * Platform transport: Resend (default) or the admin's own SMTP server. It carries system email
 * (login codes, notifications) and is the default for businesses without their own SMTP.
 * If the custom SMTP fails, the Worker falls back to Resend so sign-in never breaks.
 */
function transportPanel(sys, ctx, setDirty) {
  const t = sys.status.email.transport || { mode: 'resend' }
  const n = ++seq
  let modeValue = t.mode === 'smtp' ? 'smtp' : 'resend'
  const mode = C.segmented({ label: 'Transport email platform', scroll: true, value: modeValue, options: [{ value: 'resend', label: 'Resend (bawaan)' }, { value: 'smtp', label: 'SMTP kustom' }], onChange: (v) => { modeValue = v; sync(); markDirty() } })
  const host = C.field({ label: 'Host SMTP', id: `of-tr-host-${n}`, value: t.host || '', attrs: { placeholder: 'smtp.resend.com', autocomplete: 'off', spellcheck: 'false' } })
  const port = C.select({ label: 'Port', id: `of-tr-port-${n}`, options: [465, 587, 2465, 2587].map((p) => ({ value: String(p), label: String(p) })), value: String(t.port || 465) })
  const secure = C.select({ label: 'Keamanan', id: `of-tr-sec-${n}`, options: [{ value: 'tls', label: 'TLS langsung (465/2465)' }, { value: 'starttls', label: 'STARTTLS (587/2587)' }], value: t.secure || 'tls' })
  const user = C.field({ label: 'Username', id: `of-tr-user-${n}`, value: t.user || '', attrs: { autocomplete: 'off' } })
  const pass = C.field({ label: 'Password', id: `of-tr-pass-${n}`, type: 'password', hint: t.pass_saved ? `Tersimpan • …${t.pass_last4 || '****'}. Kosongkan untuk tetap memakai yang lama.` : 'Disimpan terenkripsi di server.', attrs: { autocomplete: 'new-password', placeholder: t.pass_saved ? '••••••••' : '' } })
  const fromName = C.field({ label: 'Nama pengirim', id: `of-tr-fn-${n}`, value: t.from_name || '', attrs: { maxlength: '60', placeholder: 'Satu Alur' } })
  const fromEmail = C.field({ label: 'Email pengirim', id: `of-tr-fe-${n}`, type: 'email', value: t.from_email || '', attrs: { placeholder: 'noreply@domainanda.id' } })
  const replyTo = C.field({ label: 'Balas ke (reply-to)', id: `of-tr-rt-${n}`, type: 'email', value: t.reply_to || '', hint: 'Opsional.' })
  port.input.addEventListener('change', () => { secure.input.value = ['465', '2465'].includes(port.input.value) ? 'tls' : 'starttls' })
  const smtpBox = el('div', { className: 'of-tr-smtp' },
    el('div', { className: 'form-row' }, host.wrap, port.wrap), el('div', { className: 'form-row' }, secure.wrap, user.wrap), pass.wrap,
    el('div', { className: 'form-row' }, fromName.wrap, fromEmail.wrap), replyTo.wrap)
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Pakai transport ini', icon: 'save', variant: 'primary', type: 'submit' })
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
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      const r = await saveEmailTransport(read())
      pass.input.value = ''
      if (r.transport?.pass_saved) pass.wrap.querySelector('.field-hint').textContent = `Tersimpan • …${r.transport.pass_last4 || '****'}. Kosongkan untuk tetap memakai yang lama.`
      saved = JSON.stringify(read())
      setDirty(false)
      showToast(r.transport?.mode === 'smtp' ? 'SMTP platform disimpan.' : 'Kembali memakai Resend.', 'success')
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  sync()
  if (!sys.status.encryption) mode.querySelector('[data-value="smtp"]')?.setAttribute('disabled', '')
  return C.panel({ title: 'Transport email platform', meta: t.mode === 'smtp' ? 'SMTP kustom aktif' : 'Resend (bawaan)' },
    el('p', { className: 'muted small' }, 'Dipakai untuk kode masuk, notifikasi, dan email bisnis yang belum memakai SMTP sendiri. Jika SMTP kustom gagal, email otomatis dikirim lewat Resend agar login tetap jalan.'),
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
  const labels = sys.status.ai.provider_modes || { workers: 'Workers AI (bawaan)', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' }
  const n = ++seq
  let mode = p.mode || 'workers'
  const seg = C.segmented({ label: 'Penyedia AI platform', scroll: true, value: mode, options: Object.entries(labels).map(([value, label]) => ({ value, label })), onChange: (v) => { mode = v; sync(); changed() } })
  const base = C.field({ label: 'Alamat API', id: `of-ai-base-${n}`, value: p.base_url || '', attrs: { autocomplete: 'off', spellcheck: 'false', maxlength: '300' } })
  const key = C.field({ label: 'API key', id: `of-ai-key-${n}`, type: 'password', hint: p.key_saved ? `Tersimpan • …${p.key_last4 || '****'}. Kosongkan untuk tetap memakai yang lama.` : 'Disimpan terenkripsi di server, tidak pernah ditampilkan lagi.', attrs: { autocomplete: 'new-password', placeholder: p.key_saved ? '••••••••' : '' } })
  const values = () => ({ mode, base_url: base.input.value.trim(), model: picker.input.value.trim(), api_key: key.input.value.trim(), max_tokens: maxTok.input.value, temperature: temp.input.value })
  const picker = modelPicker({ id: `of-ai-model-${n}`, value: p.model || '', fetchModels: () => listPlatformModels(values()) })
  const maxTok = C.field({ label: 'Maks token bawaan', id: `of-ai-mt-${n}`, type: 'number', value: p.max_tokens ? String(p.max_tokens) : '', hint: 'Opsional, 16–8192.', attrs: { min: '16', max: '8192' } })
  const temp = C.field({ label: 'Temperature bawaan', id: `of-ai-tp-${n}`, type: 'number', value: p.temperature ?? '', hint: 'Opsional, 0–2.', attrs: { min: '0', max: '2', step: '0.1' } })
  const box = el('div', { className: 'of-ai-provider' }, base.wrap, key.wrap, picker.wrap, el('div', { className: 'form-row' }, maxTok.wrap, temp.wrap))
  const out = C.message()
  const testBtn = C.button({ label: 'Uji', icon: 'sparkles', variant: 'soft' })
  const save = C.button({ label: 'Simpan penyedia', icon: 'save', variant: 'primary' })
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
    const restore = C.setBusy(testBtn, 'Menguji…')
    try {
      const r = await testPlatformAi(values())
      tested = snapshot()
      out.show('ok', `${mode === 'workers' ? 'Workers AI' : r.model} menjawab "${r.reply || '…'}" dalam ${C.number(r.ms || 0)} ms.`)
    } catch (ex) { tested = null; out.show('danger', ex.message) } finally { restore() }
  })
  save.addEventListener('click', async () => {
    out.hide()
    if (mode !== 'workers' && tested !== snapshot() && !confirm('Penyedia ini belum diuji dengan nilai saat ini. Simpan tanpa uji?')) return
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      const r = await savePlatformAi(values())
      key.input.value = ''
      if (r.provider?.key_saved) key.wrap.querySelector('.field-hint').textContent = `Tersimpan • …${r.provider.key_last4 || '****'}. Kosongkan untuk tetap memakai yang lama.`
      saved = snapshot()
      setDirty(false)
      showToast(r.provider?.mode === 'workers' ? 'Kembali ke Workers AI.' : `Penyedia AI platform: ${labels[r.provider.mode]}.`, 'success')
    } catch (ex) { out.show('danger', ex.message) } finally { restore() }
  })
  sync()
  return C.panel({ title: 'Penyedia AI platform', meta: labels[p.mode] || labels.workers },
    el('p', { className: 'muted small' }, 'Mesin di balik "Bawaan Satu Alur" untuk semua bisnis live (tetap memakai kuota paket). Akun demo selalu memakai AI contoh. Jika penyedia ini gagal, permintaan otomatis dijawab Workers AI dan dicatat di Log aktivitas.'),
    sys.status.encryption ? null : (() => { const m = C.message(); m.show('warn', 'Kunci enkripsi server belum diatur, jadi API key belum bisa disimpan.'); return m })(),
    seg, box, el('div', { className: 'form-actions' }, testBtn, save), out)
}

export function drawAi(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const s = sys.settings.ai
    const st = sys.status.ai
    const model = C.select({ label: 'Model Workers AI', id: `of-sys-model-${++seq}`, options: st.builtin_models.map((m) => ({ value: m.id, label: m.name })), value: s.default_model, hint: 'Dipakai saat penyedia platform Workers AI, dan sebagai cadangan.' })
    const allow = toggle('Izinkan bisnis memakai penyedia AI sendiri', s.allow_custom, 'OpenAI-compatible atau Anthropic-compatible, dengan API key milik bisnis. Tidak memakai kuota AI Satu Alur.')
    const form = settingsForm({
      key: 'ai', ctx, setDirty, fields: [model.wrap, allow.wrap],
      read: () => ({ default_model: model.input.value, allow_custom: allow.input.checked }),
    })
    const out = C.message()
    const testBtn = C.button({ label: 'Uji Workers AI', icon: 'sparkles', variant: 'soft' })
    testBtn.addEventListener('click', async () => {
      const restore = C.setBusy(testBtn, 'Menguji…')
      try {
        const r = await testSystemAi()
        out.show('ok', `Model ${r.model} menjawab "${r.reply || '…'}"${r.ms ? ` dalam ${r.ms} ms` : ''}.`)
      } catch (ex) { out.show('danger', ex.message) } finally { restore() }
    })
    form.querySelector('.form-actions')?.append(testBtn)
    host.replaceChildren(
      providerPanel(sys, setDirty),
      C.panel({ title: 'Workers AI & bisnis', meta: 'Model cadangan' },
        C.defList([
          ['Pilihan per bisnis', el('span', {}, Object.values(st.modes).join(' · '))],
          ['Bisnis dengan penyedia sendiri', el('span', {}, C.number(st.businesses_with_custom))],
          ['Kunci enkripsi', yes(sys.status.encryption, 'Aktif', 'Belum diatur')],
        ]),
        form, out),
    )
  })
}

/* ------------------------------------------------------------------ Login */

export function drawLogin(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const l = sys.status.login
    const otp = toggle('Izinkan masuk dengan kode email', sys.settings.login.otp_email, 'Matikan hanya jika ada cara masuk lain (Google). Akun demo tidak terpengaruh.')
    const form = settingsForm({ key: 'login', ctx, setDirty, fields: [otp.wrap], read: () => ({ otp_email: otp.input.checked }) })
    host.replaceChildren(
      C.panel({ title: 'Cara masuk' },
        C.defList([
          ['Kode email (OTP)', l.demo_otp ? C.tag('Mode demo: kode tampil di layar', 'warn') : yes(l.otp_email, 'Dikirim ke email', 'Mati')],
          ['Akun demo', yes(l.demo_login, 'Aktif', 'Mati')],
          ['Masuk dengan Google', yes(l.google)],
          ['Redirect URI Google', el('code', { className: 'of-sys-code' }, l.google_redirect_uri)],
          ['Admin lewat email', el('span', {}, `${l.admin_emails} alamat (ADMIN_EMAILS)`)],
        ]),
        form),
    )
  })
}

/* ------------------------------------------------------- WhatsApp & sosial */

export function drawWhatsapp(host, ctx) {
  loadInto(host, ctx, getSystem, (sys) => {
    const w = sys.status.whatsapp
    const n = (v) => (v === null || v === undefined ? el('span', { className: 'muted' }, 'Belum tersedia') : el('span', {}, `${C.number(v)} bisnis`))
    host.replaceChildren(C.panel({ title: 'WhatsApp & media sosial', meta: 'Per bisnis' },
      el('p', { className: 'muted small' }, 'Setiap bisnis menghubungkan akun WAPilot, WAConsole, atau Repliz miliknya sendiri. Kredensialnya disimpan terenkripsi dan tidak ditampilkan di sini.'),
      C.defList([
        ['WAPilot', n(w.wapilot)],
        ['WAConsole', n(w.waconsole)],
        ['Repliz (sosial)', n(w.repliz)],
        ['Pesan WhatsApp terkirim bulan ini', w.wa_sent_month == null ? el('span', { className: 'muted' }, 'Belum tersedia') : el('span', { className: 'tnum' }, C.number(w.wa_sent_month))],
        ['Unggahan sosial bulan ini', w.repliz_posts_month == null ? el('span', { className: 'muted' }, 'Belum tersedia') : el('span', { className: 'tnum' }, C.number(w.repliz_posts_month))],
        ['Cadangan pengirim platform', C.tag(w.platform_fallback ? 'Aktif' : 'Mati (default)', w.platform_fallback ? 'warn' : 'neutral')],
      ])))
  })
}

/* ---------------------------------------------------------- Log aktivitas */

const KINDS = [
  { value: '', label: 'Semua email' }, { value: 'otp', label: 'Kode masuk' }, { value: 'offer', label: 'Penawaran' },
  { value: 'report', label: 'Laporan' }, { value: 'test', label: 'Uji bisnis' }, { value: 'admin_test', label: 'Uji admin' },
]

export function drawActivity(host, ctx) {
  const kind = C.select({ label: 'Jenis email', id: `of-sys-kind-${++seq}`, options: KINDS, value: '' })
  const body = el('div', { className: 'of-content', 'aria-live': 'polite' })
  const pg = C.pager({ label: 'log email', pageSize: OFFICE_PAGE_SIZE, sizes: [OFFICE_PAGE_SIZE], hideSize: true, onChange: () => load(pg.page), scrollTarget: () => body })
  host.replaceChildren(body)
  const load = (page = 1) => loadInto(body, ctx, () => getActivity(kind.input.value, page), (a) => {
    if (page === 1) pg.reset()
    pg.slice(new Array(a.emails_total ?? a.emails.length))
    const emails = a.emails.length
      ? C.dataTable({
        columns: [
          { label: 'Waktu', render: (r) => C.formatDateTime(r.created_at) },
          { label: 'Jenis', render: (r) => KINDS.find((k) => k.value === r.kind)?.label || r.kind },
          { label: 'Penerima', render: (r) => r.recipient },
          { label: 'Bisnis', render: (r) => r.owner_email || '—' },
          { label: 'Lewat', render: (r) => PROVIDER_LABEL[r.provider] || r.provider },
          { label: 'Status', render: (r) => C.tag(r.status === 'sent' ? 'Terkirim' : 'Gagal', r.status === 'sent' ? 'ok' : 'danger') },
        ],
        rows: a.emails,
      })
      : C.emptyState({ title: 'Belum ada email', body: 'Email yang dikirim sistem akan tercatat di sini.', iconName: 'mail' })
    const usage = a.usage.length
      ? C.dataTable({
        columns: [
          { label: 'Fitur', render: (r) => (r.feature.startsWith('byo_') ? `${r.feature.slice(4)} (penyedia sendiri)` : r.feature) },
          { label: 'Panggilan', align: 'right', render: (r) => C.number(r.calls) },
          { label: 'Bisnis', align: 'right', render: (r) => C.number(r.users) },
        ],
        rows: a.usage,
      })
      : C.emptyState({ title: 'Belum ada pemakaian AI', body: `Periode ${a.period}.`, iconName: 'sparkles' })
    const events = (a.ai_events || []).length
      ? C.dataTable({
        columns: [
          { label: 'Waktu', render: (r) => C.formatDateTime(r.created_at) },
          { label: 'Penyedia', render: (r) => r.target || '—' },
          { label: 'Alasan', render: (r) => r.detail || '—' },
        ],
        rows: a.ai_events,
      })
      : C.emptyState({ title: 'Tidak ada gangguan', body: 'Jika penyedia AI platform gagal dan Workers AI menjawab sebagai cadangan, kejadiannya tercatat di sini.', iconName: 'sparkles' })
    body.replaceChildren(
      C.panel({ title: 'Email terkirim', meta: `${C.number(a.emails_total ?? a.emails.length)} email` }, kind.wrap, emails, pg.root),
      C.panel({ title: 'Pemakaian AI per fitur', meta: `Periode ${a.period}` }, usage),
      C.panel({ title: 'Cadangan AI', meta: '20 terbaru' }, events),
    )
  })
  kind.input.addEventListener('change', () => load(1))
  load(1)
}

/* ----------------------------------------------------------- Akses admin */

const ACTIONS = { 'admin.add': 'Menambah admin', 'admin.remove': 'Menghapus admin', 'setting.update': 'Mengubah pengaturan', 'user.tier': 'Mengubah skala akun', 'ai.fallback': 'AI cadangan (Workers AI) dipakai' }

export function drawAccess(host, ctx) {
  const load = () => loadInto(host, ctx, listAdmins, (d) => {
    const email = C.field({ label: 'Email admin baru', id: `of-sys-adm-${++seq}`, type: 'email', hint: 'Orang ini mendapat akses Kantor Satu Alur saat masuk dengan email atau Google.', attrs: { maxlength: '254', autocomplete: 'off' } })
    const err = el('p', { className: 'field-error', role: 'alert' })
    const add = C.button({ label: 'Tambah admin', icon: 'plus', variant: 'primary', type: 'submit' })
    const form = el('form', { className: 'form', noValidate: true }, email.wrap, err, el('div', { className: 'form-actions' }, add))
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      err.textContent = ''
      const restore = C.setBusy(add, 'Menambah…')
      try { await addAdmin(email.input.value); showToast('Admin ditambahkan.', 'success'); if (!ctx.signal.aborted) load() } catch (ex) { err.textContent = ex.message } finally { restore() }
    })
    const rows = d.admins.length
      ? C.paginate({ key: 'office-admins', label: 'daftar admin', pageSize: 10, items: d.admins, render: (page) => el('div', { className: 'of-cust-list' }, page.map((a) => {
        const rm = C.button({ label: 'Hapus', variant: 'ghost', size: 'sm' })
        rm.addEventListener('click', async () => {
          if (!confirm(`Cabut akses admin ${a.email}?`)) return
          const restore = C.setBusy(rm, 'Menghapus…')
          try { await removeAdmin(a.email); showToast('Akses admin dicabut.', 'success'); if (!ctx.signal.aborted) load() } catch (ex) { showToast(ex.message, 'error') } finally { restore() }
        })
        return el('div', { className: 'of-user of-admin-row' },
          el('span', { className: 'of-cust-main' }, el('strong', {}, a.email), el('span', { className: 'muted small' }, `Ditambahkan ${C.formatDate(a.added_at)} oleh ${a.added_by}`)),
          el('span', { className: 'of-cust-meta' }, d.bootstrap.includes(a.email) ? C.tag('Juga bawaan', 'brand') : null),
          el('span', { className: 'of-cust-meta' }, rm))
      })) }).root
      : C.emptyState({ title: 'Belum ada admin tambahan', body: 'Admin bawaan tetap bisa masuk.', iconName: 'shield' })
    const auditList = d.audit.length
      ? C.paginate({ key: 'office-audit', label: 'catatan audit', pageSize: 10, items: d.audit, render: (page) => C.dataTable({
        columns: [
          { label: 'Waktu', render: (r) => C.formatDateTime(r.created_at) },
          { label: 'Oleh', render: (r) => r.actor },
          { label: 'Tindakan', render: (r) => ACTIONS[r.action] || r.action },
          { label: 'Sasaran', render: (r) => r.target || '—' },
        ],
        rows: page,
      }) }).root
      : C.emptyState({ title: 'Belum ada catatan', body: 'Perubahan akses dan pengaturan akan tercatat di sini.', iconName: 'activity' })
    host.replaceChildren(
      C.panel({ title: 'Akses admin', meta: `${d.admins.length} admin` },
        d.email_admins_active ? null : (() => { const m = C.message(); m.show('warn', 'Mode kode demo aktif: admin lewat email tidak berlaku sampai DEMO_OTP dimatikan.'); return m })(),
        rows, form),
      C.panel({ title: 'Admin bawaan', meta: 'ADMIN_EMAILS' },
        el('p', { className: 'muted small' }, 'Selalu punya akses agar tidak ada yang terkunci. Diubah lewat konfigurasi server.'),
        d.bootstrap.length ? el('ul', {}, d.bootstrap.map((x) => el('li', {}, x))) : el('p', { className: 'muted' }, '—')),
      C.panel({ title: 'Catatan audit', meta: '50 terbaru' }, auditList),
    )
  })
  load()
}

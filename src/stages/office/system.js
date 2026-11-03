/**
 * Kantor Satu Alur › Sistem: Ringkasan, Email, AI, Login, WhatsApp & sosial, Log aktivitas.
 * Admins only (staff sessions or ADMIN_EMAILS logins). Secrets are never shown here, only whether
 * they are configured; everything editable is a non-secret platform setting (system_settings).
 */
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { getSystem, saveSystemSetting, testSystemEmail, testSystemAi, getSummary, getActivity, listAdmins, addAdmin, removeAdmin } from '../../admin/api.js'

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
        out.show('ok', r.simulated ? 'Simulasi: email uji dicatat (mode demo lokal).' : `Terkirim ke ${r.to} lewat ${r.provider}.`)
      } catch (ex) { out.show('danger', ex.message) } finally { restore() }
    })
    host.replaceChildren(
      C.panel({ title: 'Pengiriman email', meta: 'Default: Resend' },
        C.defList([['Resend', yes(st.resend)], ['Alamat pengirim', el('code', {}, st.from)], ['Bisnis dengan SMTP sendiri', el('span', {}, C.number(st.businesses_with_smtp))]]),
        form),
      C.panel({ title: 'Uji pengiriman' }, to.wrap, el('div', { className: 'form-actions' }, testBtn), out),
    )
  })
}

/* --------------------------------------------------------------------- AI */

export function drawAi(host, ctx, setDirty) {
  loadInto(host, ctx, getSystem, (sys) => {
    const s = sys.settings.ai
    const st = sys.status.ai
    const model = C.select({ label: 'Model bawaan', id: `of-sys-model-${++seq}`, options: st.builtin_models.map((m) => ({ value: m.id, label: m.name })), value: s.default_model })
    const allow = toggle('Izinkan bisnis memakai penyedia AI sendiri', s.allow_custom, 'OpenAI-compatible atau Anthropic-compatible, dengan API key milik bisnis. Tidak memakai kuota AI Satu Alur.')
    const form = settingsForm({
      key: 'ai', ctx, setDirty, fields: [model.wrap, allow.wrap],
      read: () => ({ default_model: model.input.value, allow_custom: allow.input.checked }),
    })
    const out = C.message()
    const testBtn = C.button({ label: 'Uji mesin AI', icon: 'sparkles', variant: 'soft' })
    testBtn.addEventListener('click', async () => {
      const restore = C.setBusy(testBtn, 'Menguji…')
      try {
        const r = await testSystemAi()
        out.show('ok', `Model ${r.model} menjawab "${r.reply || '…'}"${r.ms ? ` dalam ${r.ms} ms` : ''}.`)
      } catch (ex) { out.show('danger', ex.message) } finally { restore() }
    })
    host.replaceChildren(
      C.panel({ title: 'Mesin AI', meta: 'Workers AI (bawaan)' },
        C.defList([
          ['Pilihan per bisnis', el('span', {}, Object.values(st.modes).join(' · '))],
          ['Bisnis dengan penyedia sendiri', el('span', {}, C.number(st.businesses_with_custom))],
          ['Kunci enkripsi', yes(sys.status.encryption, 'Aktif', 'Belum diatur')],
        ]),
        form, el('div', { className: 'form-actions' }, testBtn), out),
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
  const body = el('div', { 'aria-live': 'polite' })
  host.replaceChildren(body)
  const load = () => loadInto(body, ctx, () => getActivity(kind.input.value), (a) => {
    const emails = a.emails.length
      ? C.dataTable({
        columns: [
          { label: 'Waktu', render: (r) => C.formatDateTime(r.created_at) },
          { label: 'Jenis', render: (r) => KINDS.find((k) => k.value === r.kind)?.label || r.kind },
          { label: 'Penerima', render: (r) => r.recipient },
          { label: 'Bisnis', render: (r) => r.owner_email || '—' },
          { label: 'Lewat', render: (r) => r.provider },
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
    body.replaceChildren(
      C.panel({ title: 'Email terkirim', meta: '100 terbaru' }, kind.wrap, emails),
      C.panel({ title: 'Pemakaian AI per fitur', meta: `Periode ${a.period}` }, usage),
    )
  })
  kind.input.addEventListener('change', load)
  load()
}

/* ----------------------------------------------------------- Akses admin */

const ACTIONS = { 'admin.add': 'Menambah admin', 'admin.remove': 'Menghapus admin', 'setting.update': 'Mengubah pengaturan', 'user.tier': 'Mengubah skala akun' }

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
      ? el('div', { className: 'of-cust-list' }, d.admins.map((a) => {
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
      }))
      : C.emptyState({ title: 'Belum ada admin tambahan', body: 'Admin bawaan tetap bisa masuk.', iconName: 'shield' })
    const auditList = d.audit.length
      ? C.dataTable({
        columns: [
          { label: 'Waktu', render: (r) => C.formatDateTime(r.created_at) },
          { label: 'Oleh', render: (r) => r.actor },
          { label: 'Tindakan', render: (r) => ACTIONS[r.action] || r.action },
          { label: 'Sasaran', render: (r) => r.target || '—' },
        ],
        rows: d.audit,
      })
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

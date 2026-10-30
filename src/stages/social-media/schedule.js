import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { igEligibility, threadsEligibility, toUtcIso, validateScheduleAt, SCHEDULE_STATUS_LABEL } from '../../social/rules.js'
import { PLATFORM_LABEL, RECONNECT, connectedPlatforms, platformReason } from './platforms.js'

const { el } = C
const TONE = { scheduled: 'brand', publishing: 'warn', posted: 'ok', failed: 'danger', cancelled: 'neutral' }
let sub = 'list'
let seq = 0

function localMin() {
  const d = new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}

function openDialog(ctx, item, opener) {
  const id = ++seq
  const date = C.field({ label: 'Tanggal dan waktu', id: `sm-when-${id}`, type: 'datetime-local', required: true,
    hint: 'Tayang dalam ± 5 menit dari waktu yang dipilih.', attrs: { min: localMin() } })
  const dateErr = el('p', { className: 'field-error', role: 'alert', id: `sm-when-${id}-err` })
  date.input.setAttribute('aria-describedby', `${date.input.getAttribute('aria-describedby')} ${dateErr.id}`)
  const platErr = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan jadwal', icon: 'calendar', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const connected = connectedPlatforms(ctx)
  // A platform waiting for a reconnect is not offered at all; say so when that leaves nothing.
  const platforms = connected.filter((p) => platformReason(ctx.account, p) !== RECONNECT)
  if (connected.length && !platforms.length) platErr.textContent = RECONNECT
  const hasImage = Boolean(item.image_key)
  const elig = {
    instagram: igEligibility({ hasImage, width: item.meta_json?.width ?? 1, height: item.meta_json?.height ?? 1, caption: item.body }),
    threads: threadsEligibility({ hasImage, caption: item.body }),
  }
  const group = C.choiceGroup({ legend: 'Platform', name: `sm-dlg-plat-${id}`, required: true, options: platforms.map((p) => {
    const reason = platformReason(ctx.account, p, elig)
    return { value: p, label: PLATFORM_LABEL[p], disabled: Boolean(reason), hint: reason || undefined }
  }) })
  const checks = group.inputs
  const goAkun = C.button({ label: 'Hubungkan akun di tab Akun untuk menjadwalkan.', variant: 'ghost', size: 'sm', type: 'button' })
  const { form, close } = C.modal({
    title: 'Jadwalkan tayang',
    children: [
      el('p', { className: 'workspace-preview' }, item.body.slice(0, 120)),
      date.wrap, dateErr,
      platforms.length ? group.wrap : (connected.length ? null : goAkun),
      platErr,
    ],
    actions: [cancel, platforms.length ? save : null], opener,
  })
  goAkun.addEventListener('click', () => { close(); ctx.goto('account') })
  cancel.addEventListener('click', close)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    dateErr.textContent = ''
    platErr.textContent = ''
    const chosen = platforms.filter((p) => checks[p].checked)
    let iso = ''
    if (!date.input.value || Number.isNaN(Date.parse(date.input.value))) dateErr.textContent = 'Pilih tanggal dan waktu.'
    else dateErr.textContent = validateScheduleAt(iso = toUtcIso(date.input.value)) || ''
    if (!chosen.length) platErr.textContent = 'Pilih minimal satu platform.'
    if (dateErr.textContent || platErr.textContent) return
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await Social.schedulePost(item.id, chosen, iso)
      close()
      showToast('Jadwal tersimpan.', 'success')
    } catch (err) { dateErr.textContent = err.message } finally { restore() }
  })
}

export async function render(host, ctx) {
  const body = el('div')
  let run = 0
  const seg = C.segmented({ options: [{ value: 'list', label: 'Daftar konten' }, { value: 'report', label: 'Laporan tayang' }], value: sub, label: 'Jadwal',
    onChange: (v) => { sub = v; draw() } })
  host.replaceChildren(el('div', { className: 'workspace-stack' }, seg, body))

  async function drawList(mine) {
    let items
    try { items = await Social.listContents('content') } catch (err) { if (!ctx.signal.aborted && mine === run) body.replaceChildren(C.errorState(err.message)); return }
    if (ctx.signal.aborted || mine !== run) return
    if (!items.length) { body.replaceChildren(C.emptyState({ title: 'Belum ada konten tersimpan', iconName: 'file', body: 'Simpan konten di tab Konten, lalu jadwalkan di sini.' })); return }
    body.replaceChildren(...items.map((s) => {
      const btn = C.button({ label: 'Jadwalkan tayang', icon: 'calendar', variant: 'soft', size: 'sm' })
      btn.addEventListener('click', () => openDialog(ctx, s, btn))
      return el('article', { className: 'workspace-entry sm-schedule-item' },
        el('p', { className: 'workspace-preview' }, s.body.slice(0, 160)), el('div', { className: 'form-actions' }, btn))
    }))
  }

  async function drawReport(mine) {
    body.replaceChildren(C.skeletonRows(3))
    let rows
    try { rows = await Social.listSchedules() } catch (err) { if (!ctx.signal.aborted && mine === run) body.replaceChildren(C.errorState(err.message)); return }
    if (ctx.signal.aborted || mine !== run) return
    rows = [...rows].sort((a, b) => (b.scheduled_at < a.scheduled_at ? -1 : b.scheduled_at > a.scheduled_at ? 1 : b.id - a.id))
    const reload = C.button({ label: 'Muat ulang', icon: 'refresh', variant: 'ghost', size: 'sm' })
    reload.addEventListener('click', () => draw())
    body.replaceChildren(el('div', { className: 'form-actions' }, reload), ...(rows.length ? rows.map((r) => {
      let action = null
      if (r.status === 'posted' && String(r.permalink || '').startsWith('https://')) action = el('a', { href: r.permalink, target: '_blank', rel: 'noopener' }, 'Lihat posting ↗')
      else if (r.status === 'scheduled') {
        action = C.button({ label: 'Batalkan', variant: 'ghost', size: 'sm' })
        action.addEventListener('click', async () => {
          const restore = C.setBusy(action, 'Membatalkan…')
          ctx.status.hide()
          try { await Social.cancelSchedule(r.id) } catch (err) { ctx.status.show('danger', err.message) }
          restore()
          if (!ctx.signal.aborted) draw()
        })
      }
      return el('article', { className: 'workspace-entry sm-report-row' },
        el('div', { className: 'workspace-entry-head' }, el('strong', {}, PLATFORM_LABEL[r.platform] || r.platform),
          C.tag(SCHEDULE_STATUS_LABEL[r.status] || r.status, TONE[r.status] || 'neutral'), el('span', { className: 'muted small' }, C.formatDateTime(r.scheduled_at))),
        el('p', { className: 'workspace-preview' }, (r.content || '').slice(0, 120)),
        r.status === 'failed' && r.error ? el('p', { className: 'field-error' }, r.error) : null, action)
    }) : [C.emptyState({ title: 'Belum ada jadwal', iconName: 'calendar', body: 'Jadwalkan konten dari Daftar konten.' })]))
  }

  function draw() {
    const mine = ++run
    return sub === 'list' ? drawList(mine) : drawReport(mine)
  }
  await draw()
}

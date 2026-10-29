import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { REQUEST_STATUS_LABEL } from '../../social/rules.js'
import { GOALS } from '../social-media/requests.js'
import { adminCreateCampaign } from '../../agency/api.js'
import { openCampaignEditor } from './campaigns.js'

const { el } = C
const FILTERS = [{ value: 'new', label: 'Baru' }, { value: 'in_progress', label: 'Diproses' }, { value: 'done', label: 'Selesai' }, { value: 'all', label: 'Semua' }]
const TONE = { new: 'brand', in_progress: 'warn', done: 'ok' }
const KIND = { collab: 'Kolaborasi', ads: 'Iklan' }
const PAYLOAD_LABEL = { campaign: 'Kampanye', budget_range: 'Kisaran anggaran', timing: 'Waktu', service: 'Layanan', location: 'Lokasi', daily_budget: 'Budget harian', duration_days: 'Durasi', goal: 'Tujuan', notes: 'Catatan' }
let filter = 'new'

function payloadPairs(r) {
  const p = r.payload || {}
  return Object.entries(PAYLOAD_LABEL).filter(([k]) => p[k] !== undefined && p[k] !== null && p[k] !== '').map(([k, label]) => {
    let v = p[k]
    if (k === 'daily_budget') v = `${C.rupiah(v)}/hari`
    else if (k === 'duration_days') v = `${v} hari`
    else if (k === 'goal') v = GOALS.find((g) => g.value === v)?.label || v
    return [label, String(v)]
  })
}

function requestCard(r, onSaved, ctx, setDirty) {
  const { signal } = ctx
  const id = `of-req-${r.id}`
  const status = C.select({ label: 'Status', id: `${id}-status`, value: r.status,
    options: Object.entries(REQUEST_STATUS_LABEL).map(([value, label]) => ({ value, label })) })
  const note = C.textarea({ label: 'Catatan untuk bisnis', id: `${id}-note`, rows: 3, value: r.admin_note || '', attrs: { maxlength: '2000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', size: 'sm' })
  save.addEventListener('click', async () => {
    err.textContent = ''
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await Social.adminUpdateRequest(r.id, { status: status.input.value, admin_note: note.input.value })
      showToast('Permintaan diperbarui.', 'success')
      if (!signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  let camp = null
  if (r.kind === 'collab') {
    camp = C.button({ label: r.campaign_id ? 'Lihat kampanye' : 'Buat kampanye', icon: 'users', variant: 'soft', size: 'sm' })
    camp.addEventListener('click', async () => {
      if (r.campaign_id) { openCampaignEditor(ctx, r.campaign_id, camp, setDirty, onSaved); return }
      err.textContent = ''
      const restore = C.setBusy(camp, 'Membuat…') // disabled at once: a double-click sends one request
      const story = String(r.payload?.campaign || '').trim()
      try {
        const { id: cid } = await adminCreateCampaign({ request_id: r.id, title: (story.split('\n')[0].slice(0, 120).trim() || `Kolaborasi ${r.influencer_name || ''}`.trim()), brief: story.slice(0, 3000) })
        showToast('Kampanye dibuat.', 'success')
        if (!signal.aborted) openCampaignEditor(ctx, cid, null, setDirty, onSaved)
      } catch (ex) { err.textContent = ex.message; restore() }
    })
  }
  return el('article', { className: 'workspace-entry of-request', dataset: { id: String(r.id) } },
    el('div', { className: 'workspace-entry-head' },
      el('strong', {}, r.business_name || 'Bisnis'),
      el('span', { className: 'muted small' }, r.business_email || ''),
      C.tag(KIND[r.kind] || r.kind, 'neutral'),
      C.tag(REQUEST_STATUS_LABEL[r.status] || r.status, TONE[r.status] || 'neutral'),
      el('span', { className: 'muted small' }, C.formatDateTime(r.created_at))),
    r.influencer_name ? el('p', {}, el('strong', {}, 'Influencer: '), r.influencer_name) : null,
    C.defList(payloadPairs(r)), status.wrap, note.wrap, err, el('div', { className: 'of-row-actions' }, save, camp))
}

export function draw(host, ctx, setDirty) {
  const list = el('div')
  let run = 0
  async function load() {
    const mine = ++run
    list.replaceChildren(C.skeletonRows(3))
    let rows
    try { rows = await Social.adminListRequests(filter === 'all' ? undefined : filter) } catch (e) {
      if (!ctx.signal.aborted && mine === run) list.replaceChildren(C.errorState(e.message))
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    rows.sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id))
    list.replaceChildren(...(rows.length ? rows.map((r) => requestCard(r, load, ctx, setDirty))
      : [C.emptyState({ title: 'Tidak ada permintaan', iconName: 'inbox', body: 'Belum ada permintaan dengan status ini.' })]))
  }
  const seg = C.segmented({ options: FILTERS, value: filter, label: 'Filter status', onChange: (v) => { filter = v; load() } })
  host.replaceChildren(seg, list)
  load()
}

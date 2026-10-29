import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import * as Social from '../social/api.js'
import { toJpeg } from '../social/image.js'
import { validateInfluencer } from '../office/rules.js'
import { REQUEST_STATUS_LABEL } from '../social/rules.js'
import { GOALS } from './social-media/requests.js'

const { el } = C
const TABS = [{ value: 'influencers', label: 'Influencer' }, { value: 'requests', label: 'Permintaan' }]
const FILTERS = [{ value: 'new', label: 'Baru' }, { value: 'in_progress', label: 'Diproses' }, { value: 'done', label: 'Selesai' }, { value: 'all', label: 'Semua' }]
const TONE = { new: 'brand', in_progress: 'warn', done: 'ok' }
const KIND = { collab: 'Kolaborasi', ads: 'Iklan' }
const PAYLOAD_LABEL = { campaign: 'Kampanye', budget_range: 'Kisaran anggaran', timing: 'Waktu', service: 'Layanan', location: 'Lokasi', daily_budget: 'Budget harian', duration_days: 'Durasi', goal: 'Tujuan', notes: 'Catatan' }
let tab = 'influencers'
let filter = 'new'
let seq = 0

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

function influencerDialog(ctx, inf, opener, onSaved) {
  const id = ++seq
  const dialog = el('dialog', { className: 'sm-dialog', 'aria-labelledby': `of-inf-title-${id}` })
  const v = inf || {}
  const f = (label, key, extra = {}) => C.field({ label, id: `of-inf-${key}-${id}`, value: v[key] ?? '', ...extra })
  const name = f('Nama', 'name', { required: true })
  const niche = f('Niche', 'niche', { required: true })
  const city = f('Kota', 'city', { required: true })
  const ig = f('Pengikut Instagram', 'ig_followers', { type: 'number', value: v.ig_followers ?? 0, attrs: { min: '0' } })
  const tt = f('Pengikut TikTok', 'tiktok_followers', { type: 'number', value: v.tiktok_followers ?? 0, attrs: { min: '0' } })
  const bio = C.textarea({ label: 'Bio', id: `of-inf-bio-${id}`, value: v.bio || '' })
  let photoKey = v.photo_key || null
  const preview = el('img', { className: 'sm-inf-photo', alt: 'Pratinjau foto', hidden: true })
  const showPhoto = () => { const u = photoKey ? Social.mediaUrl(photoKey) : ''; preview.hidden = !u; if (u) preview.src = u }
  showPhoto()
  const file = C.field({ label: 'Foto', id: `of-inf-photo-${id}`, type: 'file', attrs: { accept: 'image/*' } })
  const visible = el('input', { type: 'checkbox', id: `of-inf-visible-${id}`, checked: v.visible !== 0 })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const form = el('form', { className: 'form', method: 'dialog', noValidate: true },
    el('h2', { id: `of-inf-title-${id}` }, inf ? `Ubah ${inf.name}` : 'Tambah influencer'),
    name.wrap, niche.wrap, city.wrap, ig.wrap, tt.wrap, bio.wrap, file.wrap, preview,
    el('label', { htmlFor: `of-inf-visible-${id}` }, visible, ' Tampilkan di katalog'),
    err, el('div', { className: 'form-actions' }, cancel, save))
  dialog.append(form)
  file.input.addEventListener('change', async () => {
    const f0 = file.input.files[0]
    if (!f0) return
    err.textContent = ''
    save.disabled = true
    try { photoKey = await Social.uploadImage(await toJpeg(f0)); showPhoto() } catch (ex) { err.textContent = ex.message } finally { save.disabled = false }
  })
  cancel.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { dialog.remove(); opener.focus() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let row
    try {
      row = validateInfluencer({ name: name.input.value, niche: niche.input.value, city: city.input.value, ig_followers: ig.input.value, tiktok_followers: tt.input.value,
        bio: bio.input.value, photo_key: photoKey, visible: visible.checked ? 1 : 0 })
    } catch (ex) { err.textContent = ex.message; return }
    if (inf) row.id = inf.id
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      await Social.adminSaveInfluencer(row)
      dialog.close()
      showToast('Influencer tersimpan.', 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  document.body.append(dialog)
  dialog.showModal()
}

function drawInfluencers(ctx, host) {
  let run = 0
  async function load() {
    const mine = ++run
    host.replaceChildren(C.skeletonRows(4))
    let rows
    try { rows = await Social.adminListInfluencers() } catch (e) {
      if (!ctx.signal.aborted && mine === run) host.replaceChildren(C.errorState(e.message))
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    const add = C.button({ label: 'Tambah influencer', icon: 'plus', variant: 'primary', size: 'sm' })
    add.addEventListener('click', () => influencerDialog(ctx, null, add, load))
    const items = rows.map((i) => {
      const b = C.button({ label: 'Ubah', variant: 'soft', size: 'sm' })
      b.setAttribute('aria-label', `Ubah ${i.name}`)
      b.addEventListener('click', () => influencerDialog(ctx, i, b, load))
      return el('article', { className: 'workspace-entry of-inf' },
        el('div', { className: 'workspace-entry-head' }, el('strong', {}, i.name), i.visible === 0 ? C.tag('Disembunyikan', 'neutral') : null),
        el('p', { className: 'muted small' }, `${i.niche} · ${i.city}`),
        el('p', { className: 'small' }, `Instagram ${C.number(i.ig_followers)} · TikTok ${C.number(i.tiktok_followers)}`), b)
    })
    host.replaceChildren(C.panel({ title: 'Katalog influencer', meta: `${rows.length} influencer`, actions: add },
      ...(items.length ? items : [C.emptyState({ title: 'Belum ada influencer', iconName: 'users' })])))
  }
  load()
}

function requestCard(r, onSaved, signal) {
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
  return el('article', { className: 'workspace-entry of-request', dataset: { id: String(r.id) } },
    el('div', { className: 'workspace-entry-head' },
      el('strong', {}, r.business_name || 'Bisnis'),
      el('span', { className: 'muted small' }, r.business_email || ''),
      C.tag(KIND[r.kind] || r.kind, 'neutral'),
      C.tag(REQUEST_STATUS_LABEL[r.status] || r.status, TONE[r.status] || 'neutral'),
      el('span', { className: 'muted small' }, C.formatDateTime(r.created_at))),
    r.influencer_name ? el('p', {}, el('strong', {}, 'Influencer: '), r.influencer_name) : null,
    C.defList(payloadPairs(r)), status.wrap, note.wrap, err, save)
}

function drawRequests(ctx, host) {
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
    list.replaceChildren(...(rows.length ? rows.map((r) => requestCard(r, load, ctx.signal))
      : [C.emptyState({ title: 'Tidak ada permintaan', iconName: 'inbox', body: 'Belum ada permintaan dengan status ini.' })]))
  }
  const seg = C.segmented({ options: FILTERS, value: filter, label: 'Filter status', onChange: (v) => { filter = v; load() } })
  host.replaceChildren(seg, list)
  load()
}

export async function render(container, ctx) {
  const host = el('div')
  const draw = () => (tab === 'influencers' ? drawInfluencers : drawRequests)(ctx, host)
  const tabs = C.segmented({ options: TABS, value: tab, label: 'Kantor Satu Alur', onChange: (v) => { tab = v; draw() } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: 'Kantor Satu Alur', description: 'Kelola katalog influencer dan permintaan dari bisnis.' }), tabs, host)
  draw()
}

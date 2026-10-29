import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { toJpeg } from '../../social/image.js'
import { validateInfluencer } from '../../office/rules.js'

const { el } = C
let seq = 0

function influencerDialog(ctx, inf, opener, onSaved) {
  const id = ++seq
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
  const vis = C.choiceGroup({ legend: 'Visibilitas', name: `of-inf-visible-${id}`,
    options: [{ value: 'on', label: 'Tampilkan di katalog', checked: v.visible !== 0, hint: 'Bisnis hanya melihat influencer yang ditampilkan.' }] })
  const visible = vis.inputs.on
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const { form, close } = C.modal({
    title: inf ? `Ubah ${inf.name}` : 'Tambah influencer',
    children: [name.wrap, el('div', { className: 'form-row' }, niche.wrap, city.wrap), el('div', { className: 'form-row' }, ig.wrap, tt.wrap),
      bio.wrap, file.wrap, preview, vis.wrap, err],
    actions: [cancel, save], opener,
  })
  file.input.addEventListener('change', async () => {
    const f0 = file.input.files[0]
    if (!f0) return
    err.textContent = ''
    save.disabled = true
    try { photoKey = await Social.uploadImage((await toJpeg(f0)).blob); showPhoto() } catch (ex) { err.textContent = ex.message } finally { save.disabled = false }
  })
  cancel.addEventListener('click', close)
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
      close()
      showToast('Influencer tersimpan.', 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx) {
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

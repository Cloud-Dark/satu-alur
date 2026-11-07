import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { toJpeg } from '../../social/image.js'
import { validateInfluencer } from '../../office/rules.js'
import { LEAVE_MSG } from './site-doc.js'
import { t } from '../../i18n/index.js'

const { el } = C
let seq = 0

const handles = (i) => [['IG', i.handle_ig], ['TikTok', i.handle_tiktok], ['YouTube', i.handle_youtube]].filter(([, h]) => h).map(([k, h]) => `${k} @${h}`).join(' · ')
const rateSummary = (r) => (r.length ? t('office.influencers.rateSummary', { count: r.length, from: C.rupiah(Math.min(...r.map((x) => x.price_idr))) }) : t('office.influencers.noRates'))

function influencerDialog(ctx, inf, opener, onSaved, setDirty) {
  const id = ++seq
  const v = inf || {}
  const f = (label, key, extra = {}) => C.field({ label, id: `of-inf-${key}-${id}`, value: v[key] ?? '', ...extra })
  const name = f(t('office.influencers.name'), 'name', { required: true })
  const niche = f(t('office.influencers.niche'), 'niche', { required: true })
  const city = f(t('office.influencers.city'), 'city', { required: true })
  const ig = f(t('office.influencers.igFollowers'), 'ig_followers', { type: 'number', value: v.ig_followers ?? 0, attrs: { min: '0' } })
  const tt = f(t('office.influencers.ttFollowers'), 'tiktok_followers', { type: 'number', value: v.tiktok_followers ?? 0, attrs: { min: '0' } })
  const bio = C.textarea({ label: t('office.influencers.bio'), id: `of-inf-bio-${id}`, value: v.bio || '' })
  let photoKey = v.photo_key || null
  const preview = el('img', { className: 'sm-inf-photo', alt: t('office.influencers.photoPreview'), hidden: true })
  const showPhoto = () => { const u = photoKey ? Social.mediaUrl(photoKey) : ''; preview.hidden = !u; if (u) preview.src = u }
  showPhoto()
  const file = C.field({ label: t('office.influencers.photo'), id: `of-inf-photo-${id}`, type: 'file', attrs: { accept: 'image/*' } })
  const vis = C.choiceGroup({ legend: t('office.influencers.visibility'), name: `of-inf-visible-${id}`,
    options: [{ value: 'on', label: t('office.influencers.showInCatalog'), checked: v.visible !== 0, hint: t('office.influencers.visibleHint') }] })
  const visible = vis.inputs.on
  const handle = (label, key) => f(label, key, { hint: t('office.influencers.noAt'), attrs: { maxlength: '60', placeholder: '@namaakun' } })
  const hIg = handle('Instagram', 'handle_ig')
  const hTt = handle('TikTok', 'handle_tiktok')
  const hYt = handle('YouTube', 'handle_youtube')
  const phone = f(t('office.influencers.phone'), 'contact_phone', { attrs: { maxlength: '30' } })
  const email = f('Email', 'contact_email', { type: 'email', attrs: { maxlength: '120' } })
  const notes = C.textarea({ label: t('office.common.internalNote'), id: `of-inf-notes-${id}`, value: v.internal_notes || '' })
  const rateRows = el('div', { className: 'of-list' })
  const addRate = C.button({ label: t('office.influencers.addRate'), icon: 'plus', variant: 'soft', size: 'sm' })
  const syncAdd = () => { addRate.disabled = rateRows.children.length >= 8 }
  function addRow(vals = {}) {
    const n = rateRows.children.length + 1
    const rid = `of-inf-rate-${id}-${++seq}`
    const a = C.field({ label: t('office.influencers.rateKind', { n }), id: `${rid}-d`, value: vals.deliverable || '', attrs: { maxlength: '40', 'data-k': 'deliverable' } })
    const b = C.field({ label: t('office.influencers.ratePrice', { n }), id: `${rid}-p`, type: 'number', value: vals.price_idr ?? '', attrs: { min: '0', step: '1', 'data-k': 'price_idr' } })
    const rm = C.button({ label: t('office.common.delete'), variant: 'ghost', size: 'sm' })
    rm.setAttribute('aria-label', t('office.influencers.removeRate', { n }))
    const row = el('div', { className: 'of-row of-row-wrap' }, a.wrap, b.wrap, rm)
    rm.addEventListener('click', () => {
      row.remove()
      ;[...rateRows.children].forEach((r, i) => {
        const ls = r.querySelectorAll('label')
        ls[0].textContent = t('office.influencers.rateKind', { n: i + 1 }); ls[1].textContent = t('office.influencers.ratePrice', { n: i + 1 })
        r.querySelector('button').setAttribute('aria-label', t('office.influencers.removeRate', { n: i + 1 }))
      })
      syncAdd(); touch()
    })
    rateRows.append(row)
  }
  ;(v.rates || []).forEach((r) => addRow(r))
  syncAdd()
  addRate.addEventListener('click', () => { addRow(); syncAdd(); touch(); rateRows.lastChild.querySelector('input').focus() })
  const gather = () => ({ name: name.input.value, niche: niche.input.value, city: city.input.value, ig_followers: ig.input.value, tiktok_followers: tt.input.value,
    bio: bio.input.value, photo_key: photoKey, visible: visible.checked ? 1 : 0,
    handle_ig: hIg.input.value, handle_tiktok: hTt.input.value, handle_youtube: hYt.input.value,
    contact_phone: phone.input.value, contact_email: email.input.value, internal_notes: notes.input.value,
    rates: [...rateRows.children].map((r) => ({ deliverable: r.querySelector('[data-k=deliverable]').value, price_idr: r.querySelector('[data-k=price_idr]').value })) })
  let base = null
  const touch = () => { if (base !== null) setDirty(JSON.stringify(gather()) !== base) }
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('office.common.cancel'), variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: inf ? t('office.common.editName', { name: inf.name }) : t('office.influencers.add'),
    wide: true,
    children: [el('h3', { className: 'field-label' }, t('office.influencers.profile')), name.wrap, el('div', { className: 'form-row' }, niche.wrap, city.wrap), el('div', { className: 'form-row' }, ig.wrap, tt.wrap),
      bio.wrap, file.wrap, preview, vis.wrap,
      el('h3', { className: 'field-label' }, t('office.influencers.social')), el('div', { className: 'form-row' }, hIg.wrap, hTt.wrap), hYt.wrap,
      el('h3', { className: 'field-label' }, t('office.influencers.privateContact')), el('p', { className: 'muted small' }, t('office.common.teamOnly')), el('div', { className: 'form-row' }, phone.wrap, email.wrap),
      el('h3', { className: 'field-label' }, t('office.influencers.rates')), rateRows, addRate,
      notes.wrap, err],
    actions: [cancel, save], opener,
  })
  base = JSON.stringify(gather())
  form.addEventListener('input', touch)
  form.addEventListener('change', touch)
  const dirty = () => base !== null && JSON.stringify(gather()) !== base
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  file.input.addEventListener('change', async () => {
    const f0 = file.input.files[0]
    if (!f0) return
    err.textContent = ''
    save.disabled = true
    try { photoKey = await Social.uploadImage((await toJpeg(f0)).blob); showPhoto(); touch() } catch (ex) { err.textContent = ex.message } finally { save.disabled = false }
  })
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let row
    try {
      row = validateInfluencer(gather())
    } catch (ex) { err.textContent = ex.message; return }
    if (inf) row.id = inf.id
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      await Social.adminSaveInfluencer(row)
      base = null
      close()
      showToast(t('office.influencers.saved'), 'success')
      if (!ctx.signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
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
    const add = C.button({ label: t('office.influencers.add'), icon: 'plus', variant: 'primary', size: 'sm' })
    add.addEventListener('click', () => influencerDialog(ctx, null, add, load, setDirty))
    const items = rows.map((i) => {
      const b = C.button({ label: t('office.common.edit'), variant: 'soft', size: 'sm' })
      b.setAttribute('aria-label', t('office.common.editName', { name: i.name }))
      b.addEventListener('click', () => influencerDialog(ctx, i, b, load, setDirty))
      return el('article', { className: 'workspace-entry of-inf' },
        el('div', { className: 'workspace-entry-head' }, el('strong', {}, i.name), i.visible === 0 ? C.tag(t('office.common.hidden'), 'neutral') : null),
        el('p', { className: 'muted small' }, `${i.niche} · ${i.city}`),
        el('p', { className: 'small' }, `Instagram ${C.number(i.ig_followers)} · TikTok ${C.number(i.tiktok_followers)}`),
        handles(i) ? el('p', { className: 'small' }, handles(i)) : null,
        el('p', { className: 'small muted' }, rateSummary(i.rates || [])), b)
    })
    const paged = items.length ? C.paginate({ key: 'office-influencers', label: t('office.influencers.pagerLabel'), pageSize: 10, items, render: (page) => page }).root : null
    host.replaceChildren(C.panel({ title: t('office.influencers.title'), meta: t('office.influencers.count', { count: rows.length }), actions: add },
      paged || C.emptyState({ title: t('office.influencers.empty'), iconName: 'users' })))
  }
  load()
}

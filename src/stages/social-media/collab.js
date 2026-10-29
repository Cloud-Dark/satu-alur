import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { validateServiceRequest } from '../../office/rules.js'
import { requestsPanel, SENT } from './requests.js'

const { el } = C
let seq = 0

function openDialog(ctx, inf, opener, onSent) {
  const id = ++seq
  const dialog = el('dialog', { className: 'sm-dialog', 'aria-labelledby': `sm-collab-title-${id}` })
  const campaign = C.textarea({ label: 'Ceritakan kampanye Anda', id: `sm-collab-campaign-${id}`, required: true })
  const budget = C.field({ label: 'Kisaran anggaran', id: `sm-collab-budget-${id}`, required: true, placeholder: 'Rp2–5 juta' })
  const timing = C.field({ label: 'Waktu kampanye', id: `sm-collab-timing-${id}`, required: true, placeholder: 'Desember 2026' })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim permintaan', icon: 'message', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', type: 'button' })
  const form = el('form', { className: 'form', method: 'dialog', noValidate: true },
    el('h2', { id: `sm-collab-title-${id}` }, `Ajukan kolaborasi dengan ${inf.name}`),
    campaign.wrap, budget.wrap, timing.wrap, err, el('div', { className: 'form-actions' }, cancel, send))
  dialog.append(form)
  cancel.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { dialog.remove(); opener.focus() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let body
    try {
      body = validateServiceRequest({ kind: 'collab', influencer_id: inf.id, payload: { campaign: campaign.input.value, budget_range: budget.input.value, timing: timing.input.value } })
    } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(send, 'Mengirim…')
    try {
      await Social.sendRequest(body)
      dialog.close()
      showToast(SENT, 'success')
      if (!ctx.signal.aborted) onSent()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  document.body.append(dialog)
  dialog.showModal()
}

function card(ctx, inf, onSent) {
  const url = Social.mediaUrl(inf.photo_key)
  const initials = inf.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const btn = C.button({ label: 'Ajukan kolaborasi', icon: 'users', variant: 'soft', size: 'sm' })
  btn.addEventListener('click', () => openDialog(ctx, inf, btn, onSent))
  return el('article', { className: 'sm-inf-card' },
    url ? el('img', { className: 'sm-inf-photo', src: url, alt: '', loading: 'lazy' }) : el('span', { className: 'sm-inf-photo sm-inf-initials', 'aria-hidden': 'true' }, initials),
    el('h3', { className: 'workspace-entry-title' }, inf.name),
    el('p', { className: 'muted small' }, `${inf.niche} · ${inf.city}`),
    el('p', { className: 'small' }, `Instagram ${C.number(inf.ig_followers)} · TikTok ${C.number(inf.tiktok_followers)}`),
    el('p', {}, inf.bio), btn)
}

export async function render(host, ctx) {
  const list = requestsPanel('collab', ctx.signal)
  const grid = el('div', { className: 'sm-inf-grid' }, C.skeletonRows(3))
  host.replaceChildren(el('div', { className: 'workspace-stack' },
    C.panel({ title: 'Kolaborasi dengan influencer', meta: 'Tim Satu Alur menghubungkan Anda' }, grid), list))
  list.load()
  let rows
  try { rows = await Social.listInfluencers() } catch (e) { if (!ctx.signal.aborted) grid.replaceChildren(C.errorState(e.message)); return }
  if (ctx.signal.aborted) return
  grid.replaceChildren(...(rows.length ? rows.map((i) => card(ctx, i, () => list.load()))
    : [C.emptyState({ title: 'Belum ada influencer', iconName: 'users', body: 'Daftar influencer akan muncul di sini.' })]))
}

import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { validateServiceRequest } from '../../office/rules.js'
import { t } from '../../i18n/index.js'
import { requestsPanel, SENT } from './requests.js'

const { el } = C
let seq = 0

function openDialog(ctx, inf, opener, onSent) {
  const id = ++seq
  const campaign = C.textarea({ label: t('social.collab.campaign'), id: `sm-collab-campaign-${id}`, required: true,
    placeholder: t('social.collab.campaignPlaceholder') })
  const budget = C.field({ label: t('social.collab.budget'), id: `sm-collab-budget-${id}`, required: true, placeholder: t('social.collab.budgetPlaceholder') })
  const timing = C.field({ label: t('social.collab.timing'), id: `sm-collab-timing-${id}`, required: true, placeholder: t('social.collab.timingPlaceholder') })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: t('social.collab.send'), icon: 'message', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('social.cancel'), variant: 'ghost', type: 'button' })
  const { form, close } = C.modal({
    title: t('social.collab.dialogTitle', { name: inf.name }),
    description: t('social.collab.dialogBody'),
    children: [campaign.wrap, el('div', { className: 'form-row' }, budget.wrap, timing.wrap), err],
    actions: [cancel, send], opener,
  })
  cancel.addEventListener('click', close)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let body
    try {
      body = validateServiceRequest({ kind: 'collab', influencer_id: inf.id, payload: { campaign: campaign.input.value, budget_range: budget.input.value, timing: timing.input.value } })
    } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(send, t('social.sending'))
    try {
      await Social.sendRequest(body)
      close()
      showToast(SENT, 'success')
      if (!ctx.signal.aborted) onSent()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

function card(ctx, inf, onSent) {
  const url = Social.mediaUrl(inf.photo_key)
  const initials = inf.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const btn = C.button({ label: t('social.collab.request'), icon: 'users', variant: 'soft', size: 'sm' })
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
    C.panel({ title: t('social.collab.title'), meta: t('social.collab.meta') }, grid), list))
  list.load()
  let rows
  try { rows = await Social.listInfluencers() } catch (e) { if (!ctx.signal.aborted) grid.replaceChildren(C.errorState(e.message)); return }
  if (ctx.signal.aborted) return
  grid.replaceChildren(...(rows.length ? rows.map((i) => card(ctx, i, () => list.load()))
    : [C.emptyState({ title: t('social.collab.emptyTitle'), iconName: 'users', body: t('social.collab.emptyBody') })]))
}

import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { REQUEST_STATUS_LABEL } from '../../social/rules.js'
import { GOALS } from '../social-media/requests.js'
import { adminCreateCampaign } from '../../agency/api.js'
import { openCampaignEditor } from './campaigns.js'
import { OFFICE_PAGE_SIZE } from '../../office/paging.js'
import { t } from '../../i18n/index.js'

const { el } = C
const FILTER_KEYS = ['new', 'in_progress', 'done']
const TONE = { new: 'brand', in_progress: 'warn', done: 'ok' }
const KIND = ['collab', 'ads']
const PAYLOAD_KEYS = ['campaign', 'budget_range', 'timing', 'service', 'location', 'daily_budget', 'duration_days', 'goal', 'notes']
// REQUEST_STATUS_LABEL comes from social/rules.js (shared with the Worker): translate by key.
const statusLabel = (s) => (REQUEST_STATUS_LABEL[s] ? t(`office.requests.status.${s}`) : s)
let filter = 'new'

function payloadPairs(r) {
  const p = r.payload || {}
  return PAYLOAD_KEYS.filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '').map((k) => {
    const label = t(`office.requests.payload.${k}`)
    let v = p[k]
    if (k === 'daily_budget') v = t('office.requests.perDay', { amount: C.rupiah(v) })
    else if (k === 'duration_days') v = t('office.requests.days', { count: v })
    else if (k === 'goal') v = GOALS.find((g) => g.value === v)?.label || v
    return [label, String(v)]
  })
}

function requestCard(r, onSaved, ctx, setDirty) {
  const { signal } = ctx
  const id = `of-req-${r.id}`
  const status = C.select({ label: t('office.common.status'), id: `${id}-status`, value: r.status,
    options: Object.keys(REQUEST_STATUS_LABEL).map((value) => ({ value, label: statusLabel(value) })) })
  const note = C.textarea({ label: t('office.requests.noteForBusiness'), id: `${id}-note`, rows: 3, value: r.admin_note || '', attrs: { maxlength: '2000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', size: 'sm' })
  save.addEventListener('click', async () => {
    err.textContent = ''
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      await Social.adminUpdateRequest(r.id, { status: status.input.value, admin_note: note.input.value })
      showToast(t('office.requests.updated'), 'success')
      if (!signal.aborted) onSaved()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  let camp = null
  if (r.kind === 'collab' && (r.campaign_id || r.status !== 'done')) {
    camp = C.button({ label: r.campaign_id ? t('office.requests.viewCampaign') : t('office.requests.createCampaign'), icon: 'users', variant: 'soft', size: 'sm' })
    camp.addEventListener('click', async () => {
      if (r.campaign_id) { openCampaignEditor(ctx, r.campaign_id, camp, setDirty, onSaved); return }
      err.textContent = ''
      const restore = C.setBusy(camp, t('office.common.creating')) // disabled at once: a double-click sends one request
      const story = String(r.payload?.campaign || '').trim()
      try {
        const { id: cid } = await adminCreateCampaign({ request_id: r.id, title: (story.split('\n')[0].slice(0, 120).trim() || `Kolaborasi ${r.influencer_name || ''}`.trim()), brief: story.slice(0, 3000) })
        restore() // enabled again so focus can return to it when the editor closes (the list then reloads)
        showToast(t('office.requests.campaignCreated'), 'success')
        if (!signal.aborted) openCampaignEditor(ctx, cid, camp, setDirty, onSaved)
      } catch (ex) { err.textContent = ex.message; restore() }
    })
  }
  return el('article', { className: 'workspace-entry of-request', dataset: { id: String(r.id) } },
    el('div', { className: 'workspace-entry-head' },
      el('strong', {}, r.business_name || t('office.requests.business')),
      el('span', { className: 'muted small' }, r.business_email || ''),
      C.tag(KIND.includes(r.kind) ? t(`office.requests.kind.${r.kind}`) : r.kind, 'neutral'),
      C.tag(statusLabel(r.status), TONE[r.status] || 'neutral'),
      el('span', { className: 'muted small' }, C.formatDateTime(r.created_at))),
    r.influencer_name ? el('p', {}, el('strong', {}, t('office.requests.influencerLabel')), r.influencer_name) : null,
    C.defList(payloadPairs(r)), status.wrap, note.wrap, err, el('div', { className: 'of-row-actions' }, save, camp))
}

export function draw(host, ctx, setDirty) {
  const list = el('div')
  let run = 0
  const pg = C.pager({ label: t('office.requests.pagerLabel'), pageSize: OFFICE_PAGE_SIZE, sizes: [OFFICE_PAGE_SIZE], hideSize: true, onChange: () => load(pg.page), scrollTarget: () => list })
  async function load(page = 1) {
    const mine = ++run
    list.replaceChildren(C.skeletonRows(3))
    let data
    try { data = await Social.adminListRequests(filter === 'all' ? undefined : filter, { page }) } catch (e) {
      if (!ctx.signal.aborted && mine === run) list.replaceChildren(C.errorState(e.message))
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    if (page === 1) pg.reset()
    pg.slice(new Array(data.total))
    // The list shrank under us (page now past the end): show the last page that exists.
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    const reload = () => load(pg.page)
    list.replaceChildren(...(data.items.length ? data.items.map((r) => requestCard(r, reload, ctx, setDirty))
      : [C.emptyState({ title: t('office.requests.empty'), iconName: 'inbox', body: t('office.requests.emptyBody') })]))
  }
  const seg = C.segmented({ options: [...FILTER_KEYS.map((value) => ({ value, label: statusLabel(value) })), { value: 'all', label: t('office.common.all') }], value: filter, label: t('office.common.filterStatus'), onChange: (v) => { filter = v; load(1) } })
  host.replaceChildren(C.panel({ title: t('office.requests.title') }, seg, list, pg.root))
  load(1)
}

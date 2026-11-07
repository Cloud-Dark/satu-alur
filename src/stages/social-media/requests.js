import * as C from '../../ui/components.js'
import * as Social from '../../social/api.js'
import { REQUEST_STATUS_LABEL } from '../../social/rules.js'
import { getRequestCampaign } from '../../agency/api.js'
import { t, has } from '../../i18n/index.js'
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_TONE, DELIVERABLE_STATUS_LABEL, DELIVERABLE_KIND_LABEL, isHttpsLink } from '../../agency/rules.js'

const { el } = C
const TONE = { new: 'brand', in_progress: 'warn', done: 'ok' }
// Browser-only module (language is fixed per page load), so module-level t() is safe; other pages import GOALS as an array.
export const SENT = t('social.requests.sent')
const GOAL_KEYS = ['awareness', 'traffic', 'leads', 'messages']
const goalLabel = (k) => (GOAL_KEYS.includes(k) ? t(`social.requests.goals.${k}`) : '')
export const GOALS = GOAL_KEYS.map((value) => ({ value, label: goalLabel(value) }))
// Status labels come from rules files shared with the worker; translate them by their stable key.
const label = (group, key, fallback) => (has(`social.status.${group}.${key}`) ? t(`social.status.${group}.${key}`) : fallback || key)

function summary(r) {
  const p = r.payload || {}
  if (r.kind === 'collab') return [p.campaign, p.budget_range, p.timing].filter(Boolean).join(' · ')
  return [p.service, p.location, p.daily_budget ? t('social.requests.perDay', { amount: C.rupiah(p.daily_budget) }) : '', p.duration_days ? t('social.requests.days', { n: p.duration_days }) : '', goalLabel(p.goal)].filter(Boolean).join(' · ')
}

const day = (d) => (d ? C.formatDate(`${d}T00:00:00`) : '')
let seq = 0

// Business view of a campaign (campaignProjection): text only; a link is an anchor only when it is https://.
function progressView(p) {
  const dates = p.start_date || p.end_date ? `${day(p.start_date) || '…'} – ${day(p.end_date) || '…'}` : ''
  return [
    el('div', { className: 'workspace-entry-head' }, el('strong', {}, p.title), C.tag(label('campaign', p.status, CAMPAIGN_STATUS_LABEL[p.status]), CAMPAIGN_TONE[p.status] || 'neutral')),
    dates ? el('p', { className: 'muted small' }, dates) : null,
    p.influencers.length ? el('p', { className: 'small' }, t('social.requests.influencers', { names: p.influencers.map((i) => i.name).join(', ') })) : null,
    p.deliverables.length
      ? el('ul', { className: 'ag-check', 'aria-label': t('social.requests.deliverables') }, ...p.deliverables.map((d) => el('li', {},
        el('span', {}, [d.influencer_name, label('kind', d.kind, DELIVERABLE_KIND_LABEL[d.kind]), d.due_date ? t('social.requests.due', { date: day(d.due_date) }) : ''].filter(Boolean).join(' · ')),
        C.tag(label('deliverable', d.status, DELIVERABLE_STATUS_LABEL[d.status]), d.status === 'published' ? 'ok' : 'neutral'),
        isHttpsLink(d.link) ? el('a', { href: d.link, target: '_blank', rel: 'noopener noreferrer' }, t('social.requests.viewContent')) : null)))
      : el('p', { className: 'muted small' }, t('social.requests.planning')),
  ]
}

// "Lihat progres" toggle for a collab request with a campaign; loads the projection on first open.
function progressToggle(r, signal) {
  const box = el('div', { className: 'sm-progress', id: `sm-progress-${r.id}-${++seq}`, hidden: true })
  const btn = C.button({ label: t('social.requests.showProgress'), variant: 'soft', size: 'sm', 'aria-expanded': 'false', 'aria-controls': box.id })
  let loaded = false
  async function load() {
    box.replaceChildren(C.skeletonRows(2))
    try {
      const p = await getRequestCampaign(r.id)
      if (!signal.aborted) { box.replaceChildren(...progressView(p)); loaded = true }
    } catch (e) {
      if (signal.aborted) return
      const again = C.button({ label: t('social.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', load)
      box.replaceChildren(C.errorState(e.message), again)
    }
  }
  btn.addEventListener('click', () => {
    const open = box.hidden
    box.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
    btn.querySelector('.btn-label').textContent = open ? t('social.requests.hideProgress') : t('social.requests.showProgress')
    if (open && !loaded) load()
  })
  return [btn, box]
}

/** Panel "Permintaan saya" for one request kind. Call .load() to (re)fetch; stale and aborted loads are dropped. */
export function requestsPanel(kind, signal) {
  const body = el('div')
  let run = 0
  async function load() {
    const mine = ++run
    body.replaceChildren(C.skeletonRows(2))
    let rows
    try { rows = (await Social.listMyRequests()).filter((r) => r.kind === kind) } catch (err) {
      if (!signal.aborted && mine === run) body.replaceChildren(C.errorState(err.message))
      return
    }
    if (signal.aborted || mine !== run) return
    rows.sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id))
    const renderRow = (r) => el('article', { className: 'workspace-entry sm-request' },
      el('div', { className: 'workspace-entry-head' },
        el('strong', {}, kind === 'collab' ? (r.influencer_name || 'Influencer') : t('social.requests.adRequest')),
        C.tag(label('request', r.status, REQUEST_STATUS_LABEL[r.status]), TONE[r.status] || 'neutral'),
        el('span', { className: 'muted small' }, C.formatDateTime(r.created_at))),
      el('p', {}, summary(r)),
      r.admin_note ? el('p', {}, el('strong', {}, t('social.requests.teamNote')), r.admin_note) : null,
      kind === 'collab' && r.has_campaign ? progressToggle(r, signal) : null)
    body.replaceChildren(rows.length ? C.paginate({ key: `sm-requests-${kind}`, label: t('social.requests.pagingLabel'), pageSize: 10, items: rows, render: (page) => page.map(renderRow) }).root
      : C.emptyState({ title: t('social.requests.emptyTitle'), iconName: 'message', body: t('social.requests.emptyBody') }))
  }
  const panel = C.panel({ title: t('social.requests.title') }, body)
  panel.load = load
  return panel
}

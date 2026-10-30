import * as C from '../../ui/components.js'
import * as Social from '../../social/api.js'
import { REQUEST_STATUS_LABEL } from '../../social/rules.js'
import { getRequestCampaign } from '../../agency/api.js'
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_TONE, DELIVERABLE_STATUS_LABEL, DELIVERABLE_KIND_LABEL, isHttpsLink } from '../../agency/rules.js'

const { el } = C
const TONE = { new: 'brand', in_progress: 'warn', done: 'ok' }
export const SENT = 'Permintaan terkirim. Tim Satu Alur akan menghubungi Anda.'
const GOAL = { awareness: 'Dikenal lebih banyak orang', traffic: 'Kunjungan ke situs', leads: 'Calon pelanggan', messages: 'Pesan WhatsApp/Messenger' }
export const GOALS = Object.entries(GOAL).map(([value, label]) => ({ value, label }))

function summary(r) {
  const p = r.payload || {}
  if (r.kind === 'collab') return [p.campaign, p.budget_range, p.timing].filter(Boolean).join(' · ')
  return [p.service, p.location, p.daily_budget ? `${C.rupiah(p.daily_budget)}/hari` : '', p.duration_days ? `${p.duration_days} hari` : '', GOAL[p.goal]].filter(Boolean).join(' · ')
}

const day = (d) => (d ? C.formatDate(`${d}T00:00:00`) : '')
let seq = 0

// Business view of a campaign (campaignProjection): text only; a link is an anchor only when it is https://.
function progressView(p) {
  const dates = p.start_date || p.end_date ? `${day(p.start_date) || '…'} – ${day(p.end_date) || '…'}` : ''
  return [
    el('div', { className: 'workspace-entry-head' }, el('strong', {}, p.title), C.tag(CAMPAIGN_STATUS_LABEL[p.status] || p.status, CAMPAIGN_TONE[p.status] || 'neutral')),
    dates ? el('p', { className: 'muted small' }, dates) : null,
    p.influencers.length ? el('p', { className: 'small' }, `Influencer: ${p.influencers.map((i) => i.name).join(', ')}`) : null,
    p.deliverables.length
      ? el('ul', { className: 'ag-check', 'aria-label': 'Daftar konten' }, ...p.deliverables.map((d) => el('li', {},
        el('span', {}, [d.influencer_name, DELIVERABLE_KIND_LABEL[d.kind] || d.kind, d.due_date ? `Tenggat ${day(d.due_date)}` : ''].filter(Boolean).join(' · ')),
        C.tag(DELIVERABLE_STATUS_LABEL[d.status] || d.status, d.status === 'published' ? 'ok' : 'neutral'),
        isHttpsLink(d.link) ? el('a', { href: d.link, target: '_blank', rel: 'noopener noreferrer' }, 'Lihat konten ↗') : null)))
      : el('p', { className: 'muted small' }, 'Konten kampanye sedang direncanakan.'),
  ]
}

// "Lihat progres" toggle for a collab request with a campaign; loads the projection on first open.
function progressToggle(r, signal) {
  const box = el('div', { className: 'sm-progress', id: `sm-progress-${r.id}-${++seq}`, hidden: true })
  const btn = C.button({ label: 'Lihat progres', variant: 'soft', size: 'sm', 'aria-expanded': 'false', 'aria-controls': box.id })
  let loaded = false
  async function load() {
    box.replaceChildren(C.skeletonRows(2))
    try {
      const p = await getRequestCampaign(r.id)
      if (!signal.aborted) { box.replaceChildren(...progressView(p)); loaded = true }
    } catch (e) {
      if (signal.aborted) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', load)
      box.replaceChildren(C.errorState(e.message), again)
    }
  }
  btn.addEventListener('click', () => {
    const open = box.hidden
    box.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
    btn.querySelector('.btn-label').textContent = open ? 'Sembunyikan progres' : 'Lihat progres'
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
    body.replaceChildren(...(rows.length ? rows.map((r) => el('article', { className: 'workspace-entry sm-request' },
      el('div', { className: 'workspace-entry-head' },
        el('strong', {}, kind === 'collab' ? (r.influencer_name || 'Influencer') : 'Permintaan iklan'),
        C.tag(REQUEST_STATUS_LABEL[r.status] || r.status, TONE[r.status] || 'neutral'),
        el('span', { className: 'muted small' }, C.formatDateTime(r.created_at))),
      el('p', {}, summary(r)),
      r.admin_note ? el('p', {}, el('strong', {}, 'Catatan tim Satu Alur: '), r.admin_note) : null,
      kind === 'collab' && r.has_campaign ? progressToggle(r, signal) : null))
      : [C.emptyState({ title: 'Belum ada permintaan', iconName: 'message', body: 'Permintaan yang Anda kirim akan muncul di sini.' })]))
  }
  const panel = C.panel({ title: 'Permintaan saya' }, body)
  panel.load = load
  return panel
}

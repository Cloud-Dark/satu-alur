import * as C from '../../ui/components.js'
import * as Social from '../../social/api.js'
import { REQUEST_STATUS_LABEL } from '../../social/rules.js'

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
      r.admin_note ? el('p', {}, el('strong', {}, 'Catatan tim Satu Alur: '), r.admin_note) : null))
      : [C.emptyState({ title: 'Belum ada permintaan', iconName: 'message', body: 'Permintaan yang Anda kirim akan muncul di sini.' })]))
  }
  const panel = C.panel({ title: 'Permintaan saya' }, body)
  panel.load = load
  return panel
}

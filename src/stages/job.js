/**
 * Shared bits of the one-job stage pages (Permintaan, Penawaran, Penugasan, Penyelesaian,
 * Pembukuan). Alur kerja is the only list of jobs; each stage page shows one job, named in a
 * clear header, and points back to Alur kerja when it was opened without one.
 */
import * as C from '../ui/components.js'
import { customerLabel } from './data.js'
import '../styles/flow-pages.css'
import { t } from '../i18n/index.js'

const { el } = C

/** "#12 · PT Maju Jaya" plus service and location; `tag` is an optional status tag. */
export function jobHeader(request, { tag = null, note = '' } = {}) {
  if (!request) return el('div', { className: 'job-head', hidden: true })
  const sub = [request.service_type, request.location].filter(Boolean).join(' · ')
  return el('section', { className: 'job-head', 'aria-label': t('workflow.job.aria'), dataset: { request: String(request.id) } },
    el('div', { className: 'job-head-main' },
      el('span', { className: 'job-head-id tnum' }, `#${request.id}`),
      el('h2', { className: 'job-head-name' }, customerLabel(request)),
      tag),
    sub || note ? el('p', { className: 'job-head-sub muted small' }, [sub, note].filter(Boolean).join(' · ')) : null)
}

/** Empty state for a stage page opened without a job: the job is picked in Alur kerja. */
export function pickFromWorkflow(navigate, { title = t('workflow.job.pickTitle'), body = t('workflow.job.pickBody'), filter } = {}) {
  const go = C.button({ label: t('workflow.job.open'), icon: 'activity', variant: 'primary', size: 'sm' })
  go.addEventListener('click', () => navigate('workflow', filter ? { filter } : {}))
  return el('div', { className: 'job-pick' }, C.emptyState({ kicker: t('workflow.job.kicker'), title, body, iconName: 'activity', action: go }))
}

/** "Lihat semua di Alur kerja" link-style button. */
export function workflowLink(navigate, label = t('workflow.job.seeAll'), params = {}) {
  const b = C.button({ label, iconRight: 'arrowRight', variant: 'ghost', size: 'sm', className: 'job-all' })
  b.addEventListener('click', () => navigate('workflow', params))
  return b
}

/** One column at a comfortable reading width. */
export function solo(...children) {
  return el('div', { className: 'stage-solo' }, ...children)
}

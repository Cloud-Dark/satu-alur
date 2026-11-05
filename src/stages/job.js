/**
 * Shared bits of the one-job stage pages (Permintaan, Penawaran, Penugasan, Penyelesaian,
 * Pembukuan). Alur kerja is the only list of jobs; each stage page shows one job, named in a
 * clear header, and points back to Alur kerja when it was opened without one.
 */
import * as C from '../ui/components.js'
import { customerLabel } from './data.js'

const { el } = C

/** "#12 · PT Maju Jaya" plus service and location; `tag` is an optional status tag. */
export function jobHeader(request, { tag = null, note = '' } = {}) {
  if (!request) return el('div', { className: 'job-head', hidden: true })
  const sub = [request.service_type, request.location].filter(Boolean).join(' · ')
  return el('section', { className: 'job-head', 'aria-label': 'Pekerjaan', dataset: { request: String(request.id) } },
    el('div', { className: 'job-head-main' },
      el('span', { className: 'job-head-id tnum' }, `#${request.id}`),
      el('h2', { className: 'job-head-name' }, customerLabel(request)),
      tag),
    sub || note ? el('p', { className: 'job-head-sub muted small' }, [sub, note].filter(Boolean).join(' · ')) : null)
}

/** Empty state for a stage page opened without a job: the job is picked in Alur kerja. */
export function pickFromWorkflow(navigate, { title = 'Pilih pekerjaan dari Alur kerja', body = 'Halaman ini menampilkan satu pekerjaan. Buka Alur kerja, lalu tekan tombol di kolom Langkah berikutnya.', filter } = {}) {
  const go = C.button({ label: 'Buka Alur kerja', icon: 'activity', variant: 'primary', size: 'sm' })
  go.addEventListener('click', () => navigate('workflow', filter ? { filter } : {}))
  return el('div', { className: 'job-pick' }, C.emptyState({ kicker: 'Satu pekerjaan per halaman', title, body, iconName: 'activity', action: go }))
}

/** "Lihat semua di Alur kerja" link-style button. */
export function workflowLink(navigate, label = 'Lihat semua di Alur kerja', params = {}) {
  const b = C.button({ label, iconRight: 'arrowRight', variant: 'ghost', size: 'sm', className: 'job-all' })
  b.addEventListener('click', () => navigate('workflow', params))
  return b
}

/** One column at a comfortable reading width. */
export function solo(...children) {
  return el('div', { className: 'stage-solo' }, ...children)
}

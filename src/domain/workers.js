export const SKILL_LABELS = {
  ac: 'Service AC', cleaning: 'Cleaning', waterproofing: 'Waterproofing',
  roof: 'Roof Repair', carpet: 'Cuci Karpet', sofa: 'Cuci Sofa',
  electrical: 'Listrik', pool: 'Kolam Renang', garden: 'Taman',
  pest: 'Pest Control',
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function inferSkill(serviceType) {
  const s = (serviceType || '').toLowerCase()
  if (/\bac\b/.test(s)) return 'ac'
  if (s.includes('sofa') || s.includes('karpet')) return 'cleaning'
  if (s.includes('kolam')) return 'pool'
  if (s.includes('taman')) return 'garden'
  if (s.includes('hama') || s.includes('pest')) return 'pest'
  if (s.includes('waterproofing') || s.includes('bocor')) return 'waterproofing'
  if (s.includes('kaca') || s.includes('gedung')) return 'cleaning'
  return null
}

export function sameLocalDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export const activeWorkers = (workers) => (workers || []).filter((w) => w.status === 'active')

// Assigned jobs of this worker that fall on the same local day as `day`.
function dayJobs(workerId, day, assignments, links, excludeId) {
  const ids = new Set((links || []).filter((l) => l.worker_id === workerId).map((l) => l.assignment_id))
  return (assignments || []).filter((a) =>
    ids.has(a.id) && a.id !== excludeId && a.status === 'assigned' && sameLocalDay(a.scheduled_at, day))
}

export function workerState(worker, assignments, links, now = new Date()) {
  if (worker.status !== 'active') return 'inactive'
  return dayJobs(worker.id, now, assignments, links).length ? 'on_job' : 'available'
}

export function completedCount(workerId, links, completions) {
  const done = new Set((completions || []).map((c) => c.assignment_id))
  return (links || []).filter((l) => l.worker_id === workerId && done.has(l.assignment_id)).length
}

export const hasHistory = (workerId, links) => (links || []).some((l) => l.worker_id === workerId)

export const joinWorkerNames = (workers) => (workers || []).map((w) => w.name).join(', ')

// full: has the skill; none: lists skills but not this one; partial: lists no skills (generalist)
function skillMatchOf(worker, skill) {
  if (!skill) return 'unknown'
  const skills = worker.skills || []
  if (skills.includes(skill)) return 'full'
  return skills.length ? 'none' : 'partial'
}

const hasCoord = (lat, lng) => lat != null && lng != null

// Priority skill > clash > distance; with no distance its weight moves to skill and clash.
export function scoreWorkers({ workers, job, assignments, links, excludeAssignmentId }) {
  const out = activeWorkers(workers).map((worker) => {
    const skillMatch = skillMatchOf(worker, job.skill)
    const clash = dayJobs(worker.id, job.scheduledAt, assignments, links, excludeAssignmentId).length > 0
    const distanceKm = hasCoord(worker.lat, worker.lng) && hasCoord(job.lat, job.lng)
      ? haversine(worker.lat, worker.lng, job.lat, job.lng) : null
    const skillPts = { full: 1, partial: 0.5, unknown: 0.5, none: 0 }[skillMatch]
    const clashPts = clash ? 0 : 1
    const score = distanceKm == null
      ? 0.65 * skillPts + 0.35 * clashPts
      : 0.55 * skillPts + 0.3 * clashPts + 0.15 * Math.max(0, 1 - distanceKm / 30)
    const reasons = []
    if (skillMatch === 'full') reasons.push('Keahlian cocok')
    else if (skillMatch === 'none') reasons.push('Keahlian tidak cocok')
    else if (skillMatch === 'partial') reasons.push('Keahlian umum')
    reasons.push(clash ? 'Bentrok: ada tugas di hari yang sama' : 'Tidak bentrok')
    if (distanceKm != null) reasons.push(`${distanceKm.toFixed(1).replace('.', ',')} km`)
    return { worker, skillMatch, clash, distanceKm, score, reasons }
  })
  return out.sort((a, b) => b.score - a.score)
}

export function pickRecommended(scored, n) {
  const free = scored.filter((s) => !s.clash)
  const good = free.filter((s) => s.skillMatch === 'full' || s.skillMatch === 'partial')
  const rest = free.filter((s) => !good.includes(s))
  return [...good, ...rest].slice(0, n).map((s) => s.worker)
}

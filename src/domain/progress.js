/**
 * Progres penugasan (pure; no I/O). Stored in assignments.progress; a penugasan
 * that already has a penyelesaian (or status 'done') is always "Selesai", so rows
 * created before the column existed need no backfill.
 */

export const PROGRESS = [
  { value: 'belum', label: 'Belum dikerjakan', tone: 'neutral' },
  { value: 'dikerjakan', label: 'Sedang dikerjakan', tone: 'brand' },
  { value: 'ditunda', label: 'Ditunda', tone: 'warn' },
  { value: 'selesai', label: 'Selesai', tone: 'ok' },
]
export const PROGRESS_KEYS = new Set(PROGRESS.map((p) => p.value))
export const progressLabel = (v) => PROGRESS.find((p) => p.value === v)?.label || 'Belum dikerjakan'
export const NOTE_MAX = 500

/** Effective progress of an assignment, given whether it already has a completion. */
export function progressOf(assignment, hasCompletion = false) {
  if (!assignment) return 'belum'
  if (hasCompletion || assignment.status === 'done') return 'selesai'
  return PROGRESS_KEYS.has(assignment.progress) && assignment.progress !== 'selesai' ? assignment.progress : 'belum'
}

/**
 * What happens when the user picks `to` for an assignment currently at `from`.
 * - { ok: false, reason } when not allowed (already finished, unknown value, no change)
 * - { ok: true, complete: true } for "selesai": go through the penyelesaian flow
 *   (it creates the single completion and sets progress there)
 * - { ok: true } otherwise
 */
export function planProgress(from, to) {
  if (!PROGRESS_KEYS.has(to)) return { ok: false, reason: 'Status progres tidak dikenal.' }
  if (from === 'selesai') return { ok: false, reason: 'Pekerjaan ini sudah selesai.' }
  if (from === to) return { ok: false, reason: 'Status tidak berubah.' }
  if (to === 'selesai') return { ok: true, complete: true }
  return { ok: true }
}

/** Status chip for a list row: label + tone, including the overdue warning. */
export function progressChip(assignment, { hasCompletion = false, now = Date.now() } = {}) {
  const p = progressOf(assignment, hasCompletion)
  if (p === 'belum') {
    const t = assignment?.scheduled_at ? new Date(assignment.scheduled_at).getTime() : NaN
    if (Number.isFinite(t) && t < now) return { value: p, label: 'Lewat jadwal', tone: 'warn' }
  }
  const def = PROGRESS.find((x) => x.value === p)
  return { value: p, label: def.label, tone: def.tone }
}

/** Counts per effective progress for Performa / dashboard. */
export function progressCounts(assignments, completedIds = new Set()) {
  const out = { belum: 0, dikerjakan: 0, ditunda: 0, selesai: 0 }
  for (const a of assignments || []) out[progressOf(a, completedIds.has(String(a.id)))]++
  return out
}

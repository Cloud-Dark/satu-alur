import { getCloud } from '../cloud.js'
import { PROGRESS_KEYS, NOTE_MAX } from '../domain/progress.js'

const db = () => getCloud().database

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

/** Stores a progress change (not "selesai": that goes through Penyelesaian) and logs it. */
export async function saveProgress(assignment, progress, note = '') {
  if (!PROGRESS_KEYS.has(progress) || progress === 'selesai') throw new Error('Status progres tidak valid.')
  const text = String(note || '').trim().slice(0, NOTE_MAX) || null
  const at = new Date().toISOString()
  check(await db().from('assignments').update({ progress, progress_note: text, progress_updated_at: at }).eq('id', assignment.id))
  // The history row is best effort: the status itself is already saved.
  const { error } = await db().from('assignment_progress_log').insert({ assignment_id: Number(assignment.id), progress, note: text })
  if (error) console.warn('Riwayat progres tidak tersimpan:', error.message)
}

export async function loadProgressLog(assignmentId) {
  const rows = check(await db().from('assignment_progress_log').select('*').eq('assignment_id', assignmentId)) || []
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
}

import { getCloud } from '../cloud.js'
import { geocode } from '../geo.js'
import { hasHistory, joinWorkerNames } from '../domain/workers.js'
import { DEFAULT_SKILLS, cleanName, keyFor, nameProblem, withoutSkill, workersUsing } from '../domain/skills.js'

const db = () => getCloud().database

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

export async function loadWorkers() {
  return check(await db().from('workers').select('*')) || []
}

export async function loadLinks() {
  return check(await db().from('assignment_workers').select('*')) || []
}

export async function saveWorker(fields, previous) {
  const { id, owner_id, created_at, ...row } = fields
  if (fields.address !== previous?.address) {
    const geo = await geocode(fields.address)
    row.lat = geo?.lat ?? null
    row.lng = geo?.lng ?? null
    row.zone = geo?.zone ?? null
  }
  const table = db().from('workers')
  check(await (id ? table.update(row).eq('id', id) : table.insert(row)))
}

export async function removeWorker(worker, links) {
  if (hasHistory(worker.id, links)) {
    check(await db().from('workers').update({ status: 'inactive' }).eq('id', worker.id))
    return 'deactivated'
  }
  check(await db().from('workers').delete().eq('id', worker.id))
  return 'deleted'
}

export async function createTeamAssignment({ offerId, scheduledAt, workers }) {
  if (!workers?.length) throw new Error('Pilih minimal satu petugas.')
  const unique = [...new Map(workers.map((w) => [w.id, w])).values()]
  const [assignment] = check(await db().from('assignments').insert({
    offer_id: offerId, scheduled_at: scheduledAt, status: 'assigned', worker_name: joinWorkerNames(unique),
  })) || []
  if (!assignment) throw new Error('Penugasan gagal dibuat.')
  const { error } = await db().from('assignment_workers').insert(
    unique.map((w) => ({ assignment_id: assignment.id, worker_id: w.id })))
  if (error) {
    const { error: rollbackError } = await db().from('assignments').delete().eq('id', assignment.id)
    throw new Error(rollbackError ? `${error.message}; rollback gagal: ${rollbackError.message}` : error.message)
  }
  return assignment
}

/** Stores coordinates found for a petugas address (Peta tab fills missing ones lazily). */
export async function saveWorkerLocation(id, geo) {
  check(await db().from('workers').update({ lat: geo?.lat ?? null, lng: geo?.lng ?? null, zone: geo?.zone ?? null }).eq('id', id))
}

/* ------------------------------------------------------------ Keahlian */

/** The business's skill list; the built-in list is created the first time it is empty. */
export async function loadSkills() {
  const rows = check(await db().from('worker_skills').select('*')) || []
  if (rows.length) return rows
  const { error } = await db().from('worker_skills').insert(DEFAULT_SKILLS.map((s) => ({ key: s.key, name: s.name })))
  // Another tab may have seeded at the same moment (unique key); read whatever is there now.
  if (error) console.warn('Keahlian bawaan tidak tersimpan:', error.message)
  return check(await db().from('worker_skills').select('*')) || []
}

export async function addSkill(name, skills) {
  const problem = nameProblem(name, skills)
  if (problem) throw new Error(problem)
  const n = cleanName(name)
  check(await db().from('worker_skills').insert({ key: keyFor(n, skills), name: n }))
}

export async function renameSkill(skill, name, skills) {
  const problem = nameProblem(name, skills, { exceptId: skill.id })
  if (problem) throw new Error(problem)
  check(await db().from('worker_skills').update({ name: cleanName(name) }).eq('id', skill.id))
}

/** Deletes the skill and removes it from every petugas that had it. Returns how many petugas changed. */
export async function deleteSkill(skill, workers) {
  const using = workersUsing(skill.key, workers)
  for (const w of using) check(await db().from('workers').update({ skills: withoutSkill(w.skills, skill.key) }).eq('id', w.id))
  check(await db().from('worker_skills').delete().eq('id', skill.id))
  return using.length
}


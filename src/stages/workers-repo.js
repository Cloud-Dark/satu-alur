import { getCloud } from '../cloud.js'
import { geocode } from '../geo.js'
import { hasHistory, joinWorkerNames } from '../domain/workers.js'

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
  const row = { ...fields }
  if (fields.address !== previous?.address) {
    const geo = await geocode(fields.address)
    row.lat = geo?.lat ?? null
    row.lng = geo?.lng ?? null
    row.zone = geo?.zone ?? null
  }
  const table = db().from('workers')
  check(await (fields.id ? table.update(row).eq('id', fields.id) : table.insert(row)))
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

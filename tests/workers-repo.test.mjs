import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

const data = new Map()
const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
globalThis.localStorage = storage
globalThis.sessionStorage = storage

async function setup() {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('true') } })
  const repo = await server.ssrLoadModule('/src/stages/workers-repo.js')
  const { getCloud } = await server.ssrLoadModule('/src/cloud.js')
  const mock = await server.ssrLoadModule('/src/mock/mock-cloud.js')
  return { server, repo, cloud: getCloud(), mock }
}

test('workers repository and seed', async () => {
  const { server, repo, cloud, mock } = await setup()
  try {
    assert.equal((await repo.loadWorkers()).length, 6)

    await repo.saveWorker({ name: 'Zed', phone: '1', address: 'Jl. X', skills: ['ac'], status: 'active' })
    let zed = (await repo.loadWorkers()).find((w) => w.name === 'Zed')
    assert.equal(zed.lat, null)
    await repo.saveWorker({ ...zed, phone: '2' }, zed)
    zed = (await repo.loadWorkers()).find((w) => w.name === 'Zed')
    assert.equal(zed.phone, '2')

    const links = await repo.loadLinks()
    assert.equal(await repo.removeWorker(zed, links), 'deleted')
    const budi = (await repo.loadWorkers()).find((w) => w.id === 6001)
    assert.equal(await repo.removeWorker(budi, links), 'deactivated')
    assert.equal((await repo.loadWorkers()).find((w) => w.id === 6001).status, 'inactive')

    const [a, b, c] = (await repo.loadWorkers()).slice(0, 3)
    const made = await repo.createTeamAssignment({ offerId: 2005, scheduledAt: '2026-11-01T09:00', workers: [a, b, c] })
    assert.equal(made.worker_name, `${a.name}, ${b.name}, ${c.name}`)
    assert.equal((await repo.loadLinks()).filter((l) => l.assignment_id === made.id).length, 3)
    await assert.rejects(repo.createTeamAssignment({ offerId: 2006, scheduledAt: 'x', workers: [] }), /minimal satu petugas/)

    const original = cloud.database.from
    cloud.database.from = (table) => {
      const builder = original(table)
      if (table === 'assignment_workers') builder.insert = () => ({ then: (r) => r({ data: null, error: { message: 'x' } }) })
      return builder
    }
    try {
      await assert.rejects(repo.createTeamAssignment({ offerId: 2007, scheduledAt: 'x', workers: [a] }), /x/)
    } finally { cloud.database.from = original }
    const { data: left } = await cloud.database.from('assignments').select('*').eq('offer_id', 2007)
    assert.equal(left.length, 0)

    const state = JSON.parse(storage.getItem('satualur_mock_v1'))
    delete state.workers
    delete state.assignment_workers
    storage.setItem('satualur_mock_v1', JSON.stringify(state))
    mock.createMockWorkBuddyCloud()
    assert.equal((await repo.loadWorkers()).length, 6)
    assert.ok((await repo.loadLinks()).length >= 6)
  } finally { await server.close() }
})

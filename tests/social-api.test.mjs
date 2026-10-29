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
  const api = await server.ssrLoadModule('/src/social/api.js')
  const { getCloud } = await server.ssrLoadModule('/src/cloud.js')
  return { server, api, cloud: getCloud() }
}

test('social client demo mode', async () => {
  const { server, api, cloud } = await setup()
  try {
    let t = Date.parse('2026-11-01T10:00:00Z')
    api.__setNow(() => t)
    await cloud.auth.demoLogin({ email: 'demo@satualur.id' })
    const session = await cloud.auth.getSession()
    assert.equal(session.data.is_admin, true)

    assert.deepEqual(await api.getAccount(), { configured: true, account: null })
    await api.startConnect()
    assert.equal((await api.getAccount()).account.page_name, 'Demo Page')

    await api.saveContent({ kind: 'content', body: 'Halo dunia' })
    await api.saveContent({ kind: 'content', body: 'Ini #gagal' })
    await api.saveContent({ kind: 'brainstorm', body: 'Ide' })
    assert.equal((await api.listContents('content')).length, 2)
    const all = await api.listContents()
    const ok = all.find((c) => c.body === 'Halo dunia')
    const bad = all.find((c) => c.body === 'Ini #gagal')

    await assert.rejects(api.publishNow(ok.id, ['instagram']), /Instagram wajib memakai gambar/)
    await assert.rejects(api.publishNow(999, ['facebook']), /Konten tidak ditemukan/)

    const iso = new Date(t + 120000).toISOString()
    await api.schedulePost(ok.id, ['facebook'], iso)
    await api.schedulePost(bad.id, ['facebook'], iso)
    await assert.rejects(api.schedulePost(ok.id, ['facebook'], new Date(t + 1000).toISOString()), /minimal 1 menit/)
    assert.deepEqual((await api.listSchedules()).map((r) => r.status), ['scheduled', 'scheduled'])
    t += 180000
    const rows = await api.listSchedules()
    const byContent = (id) => rows.find((r) => r.content_id === id)
    assert.equal(byContent(ok.id).status, 'posted')
    assert.match(byContent(ok.id).permalink, /^https:\/\/facebook\.com\/demo\//)
    assert.equal(byContent(bad.id).status, 'failed')
    assert.equal(byContent(bad.id).error, 'Meta menolak posting (simulasi).')

    const [row] = await api.publishNow(ok.id, ['facebook'])
    assert.equal(row.status, 'publishing')
    t += 2500
    assert.equal((await api.listSchedules()).find((r) => r.id === row.id).status, 'posted')

    const [s] = await api.schedulePost(ok.id, ['facebook'], new Date(t + 120000).toISOString())
    await api.cancelSchedule(s.id)
    assert.equal((await api.listSchedules()).find((r) => r.id === s.id).status, 'cancelled')
    await assert.rejects(api.cancelSchedule(s.id), /sudah diproses/)

    const key = await api.uploadImage(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }))
    assert.ok(key)
    await api.saveContent({ kind: 'content', body: 'Foto', image_key: key })
    const withImg = (await api.listContents()).find((c) => c.image_key === key)
    const [ig] = await api.publishNow(withImg.id, ['instagram'])
    t += 2500
    assert.match((await api.listSchedules()).find((r) => r.id === ig.id).permalink, /^https:\/\/instagram\.com\/p\/demo/)

    await api.deleteContent(withImg.id)
    assert.equal((await api.listContents()).some((c) => c.id === withImg.id), false)

    await api.disconnect()
    assert.equal((await api.getAccount()).account, null)
    await assert.rejects(api.publishNow(ok.id, ['facebook']), /Hubungkan akun Facebook/)

    assert.equal((await api.listInfluencers()).length, 6)
    await api.adminSaveInfluencer({ name: 'Rani Baru', niche: 'Kuliner', city: 'Medan' })
    assert.equal((await api.listInfluencers()).length, 7)
    const inf = (await api.adminListInfluencers()).find((i) => i.name === 'Rani Baru')
    await api.adminSaveInfluencer({ id: inf.id, name: 'Rani Baru', niche: 'Kuliner', city: 'Medan', visible: 0 })
    assert.equal((await api.listInfluencers()).length, 6)

    await assert.rejects(api.sendRequest({ kind: 'ads', payload: {} }), /Layanan yang diiklankan wajib diisi/)
    await api.sendRequest({ kind: 'ads', payload: { service: 'Servis AC' } })
    let mine = await api.listMyRequests()
    assert.equal(mine[0].status, 'new')
    await api.adminUpdateRequest(mine[0].id, { status: 'done', admin_note: 'ok' })
    mine = await api.listMyRequests()
    assert.equal(mine[0].status, 'done')
    assert.equal((await api.adminListRequests())[0].admin_note, 'ok')
  } finally { await server.close() }
})

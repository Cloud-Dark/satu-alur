// Keahlian petugas: name rules, keys, labels, and the repo's lazy seed + CRUD on the mock cloud.
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const S = await import('../src/domain/skills.js')
const { SKILL_LABELS } = await import('../src/domain/workers.js')

test('nameProblem: length and case-insensitive duplicates', () => {
  const skills = [{ id: 1, key: 'ac', name: 'Service AC' }]
  assert.match(S.nameProblem('a', skills), /minimal/)
  assert.match(S.nameProblem('x'.repeat(41), skills), /maksimal/)
  assert.match(S.nameProblem('  service   ac ', skills), /sudah ada/)
  assert.equal(S.nameProblem('Service AC', skills, { exceptId: 1 }), null, 'renaming to its own name is fine')
  assert.equal(S.nameProblem('Instalasi CCTV', skills), null)
})

test('keyFor: url-safe, unique, stable for accents', () => {
  const skills = [{ key: 'instalasi-cctv' }, { key: 'instalasi-cctv-2' }]
  assert.equal(S.keyFor('Instalasi CCTV', []), 'instalasi-cctv')
  assert.equal(S.keyFor('Instalasi CCTV', skills), 'instalasi-cctv-3')
  assert.equal(S.keyFor('Pérbaikan  Pompa!', []), 'perbaikan-pompa')
  assert.equal(S.keyFor('!!!', []), 'keahlian')
})

test('labelMap: business names win, built-ins and raw keys fall back', () => {
  const m = S.labelMap([{ key: 'ac', name: 'AC Split' }, { key: 'cctv', name: 'CCTV' }])
  assert.equal(m.ac, 'AC Split')
  assert.equal(m.cctv, 'CCTV')
  assert.equal(m.pool, SKILL_LABELS.pool)
})

test('workersUsing / withoutSkill', () => {
  const ws = [{ id: 1, skills: ['ac', 'pool'] }, { id: 2, skills: ['pool'] }, { id: 3 }]
  assert.deepEqual(S.workersUsing('pool', ws).map((w) => w.id), [1, 2])
  assert.deepEqual(S.withoutSkill(['ac', 'pool'], 'pool'), ['ac'])
  assert.deepEqual(S.withoutSkill(undefined, 'pool'), [])
})

test('repo: lazy defaults once, add/rename/delete, delete strips the skill from petugas', async () => {
  const { createServer } = await import('vite')
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('true') } })
  try {
    const repo = await server.ssrLoadModule('/src/stages/workers-repo.js')
    const { getCloud } = await server.ssrLoadModule('/src/cloud.js')
    const db = getCloud().database
    for (const r of (await db.from('worker_skills').select('*')).data || []) await db.from('worker_skills').delete().eq('id', r.id)

    const first = await repo.loadSkills()
    assert.equal(first.length, S.DEFAULT_SKILLS.length, 'defaults seeded on first load')
    const again = await repo.loadSkills()
    assert.equal(again.length, first.length, 'no second seed')

    await repo.addSkill('Instalasi CCTV', again)
    let list = await repo.loadSkills()
    const cctv = list.find((x) => x.name === 'Instalasi CCTV')
    assert.equal(cctv.key, 'instalasi-cctv')
    await assert.rejects(() => repo.addSkill('instalasi cctv', list), /sudah ada/)

    await repo.renameSkill(cctv, 'CCTV & Alarm', list)
    list = await repo.loadSkills()
    assert.equal(list.find((x) => x.id === cctv.id).name, 'CCTV & Alarm')
    assert.equal(list.find((x) => x.id === cctv.id).key, 'instalasi-cctv', 'rename keeps the key')
    await assert.rejects(() => repo.renameSkill(cctv, 'service ac', list), /sudah ada/)

    const ins = await db.from('workers').insert({ name: 'Uji Keahlian', skills: ['instalasi-cctv', 'ac'], status: 'active' })
    const worker = ins.data[0]
    const changed = await repo.deleteSkill(list.find((x) => x.id === cctv.id), [worker])
    assert.equal(changed, 1)
    const after = ((await db.from('workers').select('*')).data || []).find((w) => w.id === worker.id)
    assert.deepEqual(after.skills, ['ac'])
    assert.ok(!(await repo.loadSkills()).some((x) => x.id === cctv.id))
  } finally {
    await server.close()
  }
})

test('worker whitelists worker_skills with owner scoping (no client owner_id write)', async () => {
  const src = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  assert.match(src, /worker_skills: \{\s*columns: \['id', 'owner_id', 'key', 'name', 'created_at'\]/)
  const mig = await readFile(new URL('../migrations/0017_worker_skills.sql', import.meta.url), 'utf8')
  assert.match(mig, /UNIQUE \(owner_id, key\)/)
  assert.match(mig, /owner_id, name COLLATE NOCASE/)
  assert.doesNotMatch(mig, /INSERT/i, 'no bulk seed writes in the migration')
})

test('geo: zoneOf, and geocode never throws (mock: offline gazetteer)', async () => {
  const { createServer } = await import('vite')
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('true') } })
  try {
    const geo = await server.ssrLoadModule('/src/geo.js')
    assert.equal(geo.zoneOf('Kota Bekasi, Jawa Barat, Indonesia'), 'Kota Bekasi')
    assert.equal(geo.zoneOf('Bekasi, Indonesia (contoh)'), 'Bekasi')
    assert.equal(await geo.geocode(''), null)
    const r = await geo.geocode('Jl. Melati 3, Bekasi')
    assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.zone === 'Bekasi', JSON.stringify(r))
  } finally {
    await server.close()
  }
})

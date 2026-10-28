import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inferSkill, scoreWorkers, pickRecommended, hasHistory, joinWorkerNames,
  workerState, activeWorkers, completedCount, sameLocalDay,
} from '../src/domain/workers.js'

const W = (o) => ({ id: 1, name: 'X', skills: [], status: 'active', lat: null, lng: null, ...o })
const DAY = new Date(2026, 9, 28, 8, 0).toISOString()
const NOW = new Date(2026, 9, 28, 12, 0)

test('inferSkill returns null for unmatched service', () => {
  assert.equal(inferSkill('Ducting & Exhaust Cleaning'), null)
  assert.equal(inferSkill('Service AC split'), 'ac')
})
test('inferSkill matches ac as a whole word only', () => {
  assert.equal(inferSkill('Pembersihan Kaca Gedung'), 'cleaning')
  assert.equal(inferSkill('Cuci AC split'), 'ac')
})
test('scoreWorkers: no coordinates → no distance', () => {
  const [s] = scoreWorkers({ workers: [W({ id: 1, skills: ['ac'] })], job: { skill: 'ac', scheduledAt: DAY }, assignments: [], links: [] })
  assert.equal(s.distanceKm, null)
  assert.ok(!s.reasons.some((r) => /km/.test(r)))
})
test('scoreWorkers: distance shown when both have coordinates', () => {
  const [s] = scoreWorkers({ workers: [W({ skills: ['ac'], lat: -6.2, lng: 106.8 })], job: { skill: 'ac', lat: -6.25, lng: 106.85, scheduledAt: DAY }, assignments: [], links: [] })
  assert.ok(s.distanceKm > 0)
  assert.ok(s.reasons.some((r) => /km/.test(r)))
})
test('scoreWorkers: same-day assigned job marks clash and ranks lower', () => {
  const workers = [W({ id: 1, skills: ['ac'] }), W({ id: 2, skills: ['ac'] })]
  const assignments = [{ id: 9, scheduled_at: DAY, status: 'assigned' }]
  const links = [{ assignment_id: 9, worker_id: 1 }]
  const out = scoreWorkers({ workers, job: { skill: 'ac', scheduledAt: DAY }, assignments, links })
  assert.deepEqual(out.map((s) => s.worker.id), [2, 1])
  assert.equal(out[1].clash, true)
})
test('scoreWorkers: excludeAssignmentId ignores that assignment', () => {
  const assignments = [{ id: 9, scheduled_at: DAY, status: 'assigned' }]
  const links = [{ assignment_id: 9, worker_id: 1 }]
  const [s] = scoreWorkers({ workers: [W({ skills: ['ac'] })], job: { skill: 'ac', scheduledAt: DAY }, assignments, links, excludeAssignmentId: 9 })
  assert.equal(s.clash, false)
})
test('scoreWorkers: unknown skill is not a full match', () => {
  const [s] = scoreWorkers({ workers: [W({ id: 1, skills: ['ac'] })], job: { skill: null, scheduledAt: DAY }, assignments: [], links: [] })
  assert.equal(s.skillMatch, 'unknown')
})
test('scoreWorkers excludes inactive workers', () => {
  const out = scoreWorkers({ workers: [W({ id: 1, status: 'inactive' })], job: { skill: 'ac', scheduledAt: DAY }, assignments: [], links: [] })
  assert.equal(out.length, 0)
})
test('pickRecommended skips clashing workers', () => {
  const workers = [W({ id: 1, skills: ['ac'] }), W({ id: 2, skills: ['ac'] }), W({ id: 3, skills: ['ac'] })]
  const assignments = [{ id: 9, scheduled_at: DAY, status: 'assigned' }]
  const links = [{ assignment_id: 9, worker_id: 1 }]
  const scored = scoreWorkers({ workers, job: { skill: 'ac', scheduledAt: DAY }, assignments, links })
  const picked = pickRecommended(scored, 2).map((w) => w.id).sort()
  assert.deepEqual(picked, [2, 3])
  assert.ok(!pickRecommended(scored, 3).some((w) => w.id === 1))
})
test('hasHistory, completedCount, joinWorkerNames', () => {
  assert.equal(hasHistory(1, [{ assignment_id: 9, worker_id: 1 }]), true)
  assert.equal(hasHistory(2, [{ assignment_id: 9, worker_id: 1 }]), false)
  assert.equal(completedCount(1, [{ assignment_id: 9, worker_id: 1 }, { assignment_id: 8, worker_id: 1 }], [{ assignment_id: 9 }]), 1)
  assert.equal(joinWorkerNames([{ name: 'Ahmad' }, { name: 'Budi' }]), 'Ahmad, Budi')
})
test('activeWorkers and sameLocalDay', () => {
  assert.deepEqual(activeWorkers([W({ id: 1 }), W({ id: 2, status: 'inactive' })]).map((w) => w.id), [1])
  assert.equal(sameLocalDay(DAY, NOW), true)
  assert.equal(sameLocalDay(DAY, new Date(2026, 9, 29)), false)
})
test('workerState: inactive, on_job today, available', () => {
  const assignments = [{ id: 9, scheduled_at: DAY, status: 'assigned' }]
  const links = [{ assignment_id: 9, worker_id: 1 }]
  assert.equal(workerState(W({ id: 1, status: 'inactive' }), assignments, links, NOW), 'inactive')
  assert.equal(workerState(W({ id: 1 }), assignments, links, NOW), 'on_job')
  assert.equal(workerState(W({ id: 2 }), assignments, links, NOW), 'available')
})

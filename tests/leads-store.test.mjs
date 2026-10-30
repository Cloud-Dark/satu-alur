// Pencari prospek: localStorage store for the last search and its history.
import './helpers/setup.mjs'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const {
  makeEntry, pushHistory, removeHistory, loadLeadsStore, saveLeadsStore, lastEntry,
  HISTORY_MAX, STORED_LEADS_MAX, getLeadJob, isJobRunning,
} = await import('../src/leads/job.js')

const criteria = { point: { lat: -6.2, lon: 106.9 }, pointLabel: 'Bekasi', radiusKm: 5, keywords: ['hotel'], source: 'osm' }
const lead = (i) => ({ id: `osm:${i}`, name: `Usaha ${i}`, lat: -6.2, lon: 106.9, distance_km: i / 10, ai: { keep: true, relevance: 50 } })

beforeEach(() => localStorage.clear())

test('makeEntry drops raw results and caps stored leads', () => {
  const e = makeEntry({ id: 'a', criteria, search: { source: 'osm', results: [1, 2, 3] }, leads: Array.from({ length: 400 }, (_, i) => lead(i)), rankBasis: 'ai' })
  assert.equal(e.search.results, undefined)
  assert.equal(e.search.source, 'osm')
  assert.equal(e.leads.length, STORED_LEADS_MAX)
  assert.deepEqual(e.criteria.keywords, ['hotel'])
  assert.notEqual(e.criteria.keywords, criteria.keywords)
})

test('history is newest first, unique and capped', () => {
  let data = { lastId: null, history: [] }
  for (let i = 0; i < HISTORY_MAX + 3; i++) data = pushHistory(data, makeEntry({ id: `s${i}`, criteria, search: {}, leads: [] }))
  assert.equal(data.history.length, HISTORY_MAX)
  assert.equal(data.history[0].id, `s${HISTORY_MAX + 2}`)
  assert.equal(data.lastId, `s${HISTORY_MAX + 2}`)
  data = pushHistory(data, makeEntry({ id: 's5', criteria, search: {}, leads: [] }))
  assert.equal(data.history.filter((e) => e.id === 's5').length, 1)
  assert.equal(data.history[0].id, 's5')
})

test('removing the last entry moves lastId to the next newest', () => {
  let data = pushHistory(pushHistory({ history: [] }, makeEntry({ id: 'a', criteria, search: {}, leads: [] })), makeEntry({ id: 'b', criteria, search: {}, leads: [] }))
  data = removeHistory(data, 'b')
  assert.equal(data.lastId, 'a')
  assert.equal(lastEntry(data).id, 'a')
  assert.equal(lastEntry(removeHistory(data, 'a')), null)
})

test('store round-trips per owner and survives bad JSON', () => {
  const data = pushHistory({ history: [] }, makeEntry({ id: 'x', criteria, search: { source: 'osm' }, leads: [lead(1)], rankBasis: 'ai' }))
  saveLeadsStore('u1', data)
  assert.equal(loadLeadsStore('u1').history[0].leads[0].name, 'Usaha 1')
  assert.deepEqual(loadLeadsStore('u2').history, [])
  localStorage.setItem('satualur_leads_v1:u3', '{broken')
  assert.deepEqual(loadLeadsStore('u3'), { lastId: null, history: [] })
})

test('a full quota drops the oldest history entries instead of failing', () => {
  const real = localStorage.setItem
  let calls = 0
  localStorage.setItem = (k, v) => { calls++; if (JSON.parse(v).history.length > 2) throw new Error('QuotaExceededError'); real.call(localStorage, k, v) }
  try {
    let data = { history: [] }
    for (const id of ['a', 'b', 'c', 'd']) data = pushHistory(data, makeEntry({ id, criteria, search: {}, leads: [] }))
    const saved = saveLeadsStore('u1', data)
    assert.deepEqual(saved.history.map((e) => e.id), ['d', 'c'])
    assert.ok(calls >= 3)
  } finally {
    localStorage.setItem = real
  }
  assert.deepEqual(loadLeadsStore('u1').history.map((e) => e.id), ['d', 'c'])
})

test('no job is running by default', () => {
  assert.equal(getLeadJob('u1'), null)
  assert.equal(isJobRunning(null), false)
  assert.equal(isJobRunning({ status: 'ranking' }), true)
  assert.equal(isJobRunning({ status: 'done' }), false)
})

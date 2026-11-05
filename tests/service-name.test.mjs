// Unit tests: src/ai/service-name.js — the request autofill never borrows an unrelated existing service.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveServiceType, matchKnown, serviceFromHint, mentions } from '../src/ai/service-name.js'

const known = ['Pengembangan agentic AI / chatbot', 'Pembuatan website', 'Servis AC']

test('an unrelated existing service is replaced by a name from the hint', () => {
  const s = resolveServiceType('aplikasi kasir lengkap dengan absensi', 'Pengembangan agentic AI / chatbot', known)
  assert.equal(s, 'Aplikasi kasir lengkap dengan absensi')
})

test('an existing service the hint mentions is kept', () => {
  assert.equal(resolveServiceType('servis 3 unit AC di kantor', 'Servis AC', known), 'Servis AC')
  assert.equal(resolveServiceType('mau bikin website toko', '', known), 'Pembuatan website')
  assert.equal(matchKnown('butuh chatbot WhatsApp', known), 'Pengembangan agentic AI / chatbot')
})

test('a new name from the model is kept', () => {
  assert.equal(resolveServiceType('aplikasi kasir', 'Pembuatan aplikasi kasir & absensi', known), 'Pembuatan aplikasi kasir & absensi')
})

test('helpers', () => {
  assert.equal(matchKnown('aplikasi kasir', known), null)
  assert.equal(serviceFromHint('cuci sofa 3 dudukan, besok pagi'), 'Cuci sofa 3 dudukan')
  assert.equal(mentions('aplikasi kasir', 'Pengembangan agentic AI / chatbot'), false)
})

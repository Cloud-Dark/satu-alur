// Unit tests: src/ai/agent.js pure helpers (parseModelJson, normalizeOffer). FR-011.
// agent.js imports stages/settings.js -> ui/components.js -> *.css; the CSS is
// stubbed by tests/helpers/css-hooks.mjs, so the real module is imported unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

const { parseModelJson, normalizeOffer } = await import('../src/ai/agent.js')

test('parseModelJson: plain JSON', () => {
  assert.deepEqual(parseModelJson('{"scope":"a","price":1}'), { scope: 'a', price: 1 })
})

test('parseModelJson: strips ```json fences and prose around the object', () => {
  const text = 'Berikut penawarannya:\n```json\n{"scope":"Cuci AC","price":350000}\n```\nSemoga membantu.'
  assert.deepEqual(parseModelJson(text), { scope: 'Cuci AC', price: 350000 })
})

test('parseModelJson: repairs trailing commas', () => {
  assert.deepEqual(parseModelJson('{"a": 1, "b": [1, 2,],}'), { a: 1, b: [1, 2] })
})

test('parseModelJson: repairs smart quotes', () => {
  assert.deepEqual(parseModelJson('{“scope”: “Cuci AC”}'), { scope: 'Cuci AC' })
})

test('parseModelJson: repairs a key missing its closing quote ("terms: ...")', () => {
  const text = '{"scope": "Servis AC", "price": 500000, "terms: Bayar setelah selesai", "notes": "-"}'
  assert.deepEqual(parseModelJson(text), { scope: 'Servis AC', price: 500000, terms: 'Bayar setelah selesai', notes: '-' })
})

test('parseModelJson: throws when there is no object', () => {
  assert.throws(() => parseModelJson('maaf, saya tidak bisa'), /no-json/)
  assert.throws(() => parseModelJson(''), /no-json/)
  assert.throws(() => parseModelJson(null), /no-json/)
  assert.throws(() => parseModelJson('} {'), /no-json/)
})

test('parseModelJson: unrepairable JSON throws a SyntaxError', () => {
  assert.throws(() => parseModelJson('{"scope": }'), SyntaxError)
})

test('normalizeOffer: keeps exactly four fields, trims strings', () => {
  const o = normalizeOffer({ scope: '  Cuci AC  ', price: 350000, terms: ' Lunas ', notes: ' - ', extra: 'x' })
  assert.deepEqual(o, { scope: 'Cuci AC', price: 350000, terms: 'Lunas', notes: '-' })
})

test('normalizeOffer: Indonesian synonyms', () => {
  const o = normalizeOffer({ ruang_lingkup: 'Lingkup', harga: 1000, ketentuan: 'Syarat', catatan: 'Cat' })
  assert.deepEqual(o, { scope: 'Lingkup', price: 1000, terms: 'Syarat', notes: 'Cat' })
  assert.equal(normalizeOffer({ lingkup: 'L', total: 5, syarat: 'S', keterangan: 'K' }).terms, 'S')
})

test('normalizeOffer: price from formatted text and floats', () => {
  assert.equal(normalizeOffer({ price: 'Rp 1.500.000' }).price, 1500000)
  assert.equal(normalizeOffer({ price: '2,500,000 IDR' }).price, 2500000)
  assert.equal(normalizeOffer({ price: 1234.6 }).price, 1235)
  assert.ok(Number.isNaN(normalizeOffer({ price: 'gratis' }).price))
  assert.ok(Number.isNaN(normalizeOffer({}).price))
})

test('normalizeOffer: empty-string field falls through to a synonym', () => {
  assert.equal(normalizeOffer({ scope: '', ruang_lingkup: 'Dari sinonim' }).scope, 'Dari sinonim')
})

test('normalizeOffer: tolerates null input', () => {
  const o = normalizeOffer(null)
  assert.deepEqual({ ...o, price: 0 }, { scope: '', price: 0, terms: '', notes: '' })
})

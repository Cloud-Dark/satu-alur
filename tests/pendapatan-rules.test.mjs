// Unit tests: src/pendapatan/rules.js (shared by the Worker, the mock cloud and
// both stages) and src/business/list-view.js (search / CSV helpers).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

const R = await import('../src/pendapatan/rules.js')
const L = await import('../src/business/list-view.js')

const rejects = (fn, pattern) => assert.throws(fn, (e) => pattern.test(e.message) && e.validation === true)

/* ---------------------------------------------------------------- Parsing */

test('moneyInt reads pasted Rupiah and ignores separators', () => {
  assert.equal(R.moneyInt('Rp 450.000'), 450000)
  assert.equal(R.moneyInt('1.200.000'), 1200000)
  assert.equal(R.moneyInt(450000), 450000)
  assert.equal(R.moneyInt(''), 0)
  assert.equal(R.moneyInt(null), 0)
  assert.equal(R.moneyInt('-100'), -100)
  assert.ok(Number.isNaN(R.moneyInt('abc100')))
})

test('percentInt reads 30, "30%", and 0.3 as thirty percent', () => {
  assert.equal(R.percentInt('30'), 30)
  assert.equal(R.percentInt('30%'), 30)
  assert.equal(R.percentInt(0.3), 30)
  assert.equal(R.percentInt(1), 1)
  assert.equal(R.percentInt(150), 100)
  assert.equal(R.percentInt('-5'), 0)
  assert.ok(Number.isNaN(R.percentInt('abc25')))
  assert.ok(Number.isNaN(R.percentInt('')))
})

/* -------------------------------------------------------------- VAS items */

test('validateVasItem normalises a pasted row', () => {
  const row = R.validateVasItem({
    name: '  Cuci   karpet  ', price: 'Rp 250.000', cost: '', attach_to: ' Cuci Sofa ',
    attach_rate: '20', category: 'kecepatan', description: '', status: 'draft',
  })
  assert.deepEqual(row, {
    name: 'Cuci karpet', category: 'kecepatan', price: 250000, cost: 0,
    attach_to: 'Cuci Sofa', attach_rate: 20, description: null, status: 'draft',
  })
})

test('validateVasItem rejects the rows a catalog must never hold', () => {
  rejects(() => R.validateVasItem({ name: 'A', price: 1000 }), /minimal 2 karakter/)
  rejects(() => R.validateVasItem({ name: 'Cuci karpet', price: 0 }), /Harga jual/)
  rejects(() => R.validateVasItem({ name: 'Cuci karpet', price: 1000, cost: -1 }), /tidak boleh negatif/)
  rejects(() => R.validateVasItem({ name: 'Cuci karpet', price: 1000, attach_rate: 'abc' }), /Tingkat pasang/)
  rejects(() => R.validateVasItem({ name: 'Cuci karpet', price: 1000, category: 'ajaib' }), /Kategori/)
  rejects(() => R.validateVasItem({ name: 'Cuci karpet', price: 2_000_000_000 }), /maksimal/)
  rejects(() => R.validateVasItem({ name: 'x'.repeat(81), price: 1000 }), /maksimal 80/)
})

test('validateVasItem partial mode only touches the keys given', () => {
  assert.deepEqual(R.validateVasItem({ price: '300000' }, { partial: true }), { price: 300000 })
  assert.deepEqual(R.validateVasItem({}, { partial: true }), {})
  rejects(() => R.validateVasItem({ price: 0 }, { partial: true }), /Harga jual/)
})

/* ----------------------------------------------------------- Waste entries */

test('validateWasteEntry accepts a finding and defaults the optional fields', () => {
  const row = R.validateWasteEntry({ stream: 'perjalanan', title: 'Rute tidak diurutkan', monthly_loss: '900.000' })
  assert.deepEqual(row, {
    stream: 'perjalanan', title: 'Rute tidak diurutkan', detail: null,
    monthly_loss: 900000, saved: 0, action: null, owner: null, status: 'open',
  })
})

test('validateWasteEntry rejects bad streams, titles and amounts', () => {
  rejects(() => R.validateWasteEntry({ stream: 'listrik', title: 'Boros', monthly_loss: 1000 }), /Sumber pemborosan/)
  rejects(() => R.validateWasteEntry({ stream: 'waktu', title: 'ab', monthly_loss: 1000 }), /minimal 3/)
  rejects(() => R.validateWasteEntry({ stream: 'waktu', title: 'Boros', monthly_loss: 0 }), /Kerugian per bulan/)
  rejects(() => R.validateWasteEntry({ stream: 'waktu', title: 'Boros', monthly_loss: 1000, saved: -5 }), /negatif/)
})

test('a done finding always counts as fully saved', () => {
  const row = R.withWasteCompletion(R.validateWasteEntry({
    stream: 'bahan', title: 'Dosis kimia berlebih', monthly_loss: 180000, saved: 0, status: 'done',
  }))
  assert.equal(row.saved, 180000)
  assert.doesNotThrow(() => R.assertWasteInvariants(row))
})

test('saved above the recorded loss is refused', () => {
  rejects(() => R.assertWasteInvariants({ monthly_loss: 100000, saved: 200000, status: 'progress' }), /melebihi kerugian/)
  rejects(() => R.assertWasteInvariants({ monthly_loss: 100000, saved: 0, status: 'done' }), /terhenti penuh/)
})

/* ---------------------------------------------------------------- Imports */

test('splitDuplicates keeps the first occurrence and flags the rest', () => {
  const existing = [{ name: 'Perawatan AC 3 bulan' }, { name: 'Cuci karpet express' }]
  const rows = [
    { name: 'perawatan   ac 3 BULAN' },
    { name: 'Deep clean outdoor' },
    { name: 'Deep clean outdoor' },
  ]
  const { fresh, duplicates } = R.splitDuplicates(rows, existing, (r) => R.vasKey(r.name))
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].name, 'Deep clean outdoor')
  assert.equal(duplicates.length, 2)
})

test('assertImportSize guards the Worker batch limit', () => {
  assert.equal(R.assertImportSize(3), 3)
  rejects(() => R.assertImportSize(0), /Tidak ada data/)
  rejects(() => R.assertImportSize(101), /Maksimal 100/)
})

/* -------------------------------------------------------------- List view */

const ROWS = [
  { name: 'Perawatan AC', status: 'active', description: 'Kunjungan ringan' },
  { name: 'Cuci karpet', status: 'draft', description: 'Enam jam' },
  { name: 'Poles marmer', status: 'active', description: null },
]

test('filterRows matches across fields and filters by status', () => {
  assert.equal(L.filterRows(ROWS, { query: 'karpet', fields: ['name'] }).length, 1)
  assert.equal(L.filterRows(ROWS, { query: 'enam', fields: ['description'] }).length, 1)
  assert.equal(L.filterRows(ROWS, { query: '', fields: ['name'], filters: { status: 'active' } }).length, 2)
  assert.equal(L.filterRows(ROWS, { query: '', fields: ['name'], filters: { status: 'all' } }).length, 3)
  assert.equal(L.filterRows(ROWS, { query: 'zzz', fields: ['name'] }).length, 0)
  assert.equal(L.filterRows(ROWS, { query: '  ', fields: ['name'] }).length, 3)
})

test('toCsv quotes separators, quotes and newlines', () => {
  const csv = L.toCsv([
    { label: 'Item', value: (r) => r.name },
    { label: 'Catatan', value: (r) => r.description },
  ], [{ name: 'Cuci, karpet', description: 'baris "satu"\nbaris dua' }])
  assert.equal(csv, 'Item,Catatan\r\n"Cuci, karpet","baris ""satu""\nbaris dua"')
})

test('CSV export escapes spreadsheet formulas from user-entered fields', () => {
  const columns = [{ key: 'name', label: 'Item' }]
  assert.equal(L.toCsv(columns, [{ name: '=1+1' }, { name: ' @SUM(A1)' }]), "Item\r\n'=1+1\r\n' @SUM(A1)")
})

test('debounce runs once for a burst of calls', async () => {
  let calls = 0
  const fn = L.debounce(() => { calls += 1 }, 10)
  fn(); fn(); fn()
  assert.equal(calls, 0)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(calls, 1)
})

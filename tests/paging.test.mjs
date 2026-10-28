// Unit: display pagination helpers (src/ui/paging.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageWindow, pageCount, clampPage, pageBounds, rangeLabel, pageOfIndex, readPageSize, writePageSize, GAP } from '../src/ui/paging.js'

test('pageWindow: all pages when 7 or fewer', () => {
  assert.deepEqual(pageWindow(1, 1), [1])
  assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7])
})

test('pageWindow: compact with ellipsis, constant 7 slots', () => {
  assert.deepEqual(pageWindow(5, 25), [1, GAP, 4, 5, 6, GAP, 25])
  assert.deepEqual(pageWindow(1, 25), [1, 2, 3, 4, 5, GAP, 25])
  assert.deepEqual(pageWindow(4, 25), [1, 2, 3, 4, 5, GAP, 25])
  assert.deepEqual(pageWindow(22, 25), [1, GAP, 21, 22, 23, 24, 25])
  assert.deepEqual(pageWindow(25, 25), [1, GAP, 21, 22, 23, 24, 25])
  assert.deepEqual(pageWindow(99, 25), [1, GAP, 21, 22, 23, 24, 25])
  for (let p = 1; p <= 25; p++) assert.equal(pageWindow(p, 25).length, 7)
})

test('pageCount / clampPage / pageBounds', () => {
  assert.equal(pageCount(0, 10), 1)
  assert.equal(pageCount(248, 10), 25)
  assert.equal(pageCount(250, 25), 10)
  assert.equal(clampPage(0, 5), 1)
  assert.equal(clampPage(9, 5), 5)
  assert.deepEqual(pageBounds(1, 10, 248), { start: 0, end: 10 })
  assert.deepEqual(pageBounds(25, 10, 248), { start: 240, end: 248 })
  assert.deepEqual(pageBounds(30, 10, 248), { start: 240, end: 248 })
  assert.deepEqual(pageBounds(1, 10, 0), { start: 0, end: 0 })
})

test('rangeLabel', () => {
  assert.equal(rangeLabel(1, 10, 248), 'Menampilkan 1–10 dari 248')
  assert.equal(rangeLabel(25, 10, 248), 'Menampilkan 241–248 dari 248')
  assert.equal(rangeLabel(1, 10, 7), 'Menampilkan 7 dari 7')
  assert.equal(rangeLabel(1, 10, 0), 'Tidak ada data')
  assert.equal(rangeLabel(2, 10, 1200, (n) => n.toLocaleString('id-ID')), 'Menampilkan 11–20 dari 1.200')
})

test('pageOfIndex keeps the first visible row when the page size changes', () => {
  assert.equal(pageOfIndex(0, 10), 1)
  assert.equal(pageOfIndex(9, 10), 1)
  assert.equal(pageOfIndex(10, 10), 2)
  assert.equal(pageOfIndex(40, 25), 2)
})

test('page size memory falls back without sessionStorage and validates values', () => {
  assert.equal(readPageSize('x', [10, 25, 50], 10), 10)
  const mem = new Map()
  globalThis.sessionStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) }
  try {
    writePageSize('requests', 25)
    assert.equal(readPageSize('requests', [10, 25, 50], 10), 25)
    assert.equal(readPageSize('offers', [10, 25, 50], 10), 10)
    mem.set('satualur_pagesize:bad', '7')
    assert.equal(readPageSize('bad', [10, 25, 50], 10), 10)
  } finally {
    delete globalThis.sessionStorage
  }
})

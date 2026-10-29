// Pure rules for Social Media publishing (src/social/rules.js). Run: node --test tests/social-rules.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLATFORMS, validateScheduleAt, toUtcIso, igEligibility, SCHEDULE_STATUS_LABEL, REQUEST_STATUS_LABEL,
} from '../src/social/rules.js'

test('platforms are Facebook and Instagram only', () => {
  assert.deepEqual(PLATFORMS, ['facebook', 'instagram'])
})
test('schedule window', () => {
  const now = Date.parse('2026-11-01T00:00:00Z')
  assert.equal(validateScheduleAt('2026-11-01T00:00:30Z', now), 'Waktu tayang minimal 1 menit dari sekarang.')
  assert.equal(validateScheduleAt('2026-11-01T00:01:00Z', now), null)
  assert.equal(validateScheduleAt('2026-11-01T00:02:00Z', now), null)
  assert.equal(validateScheduleAt('2027-01-16T00:00:00Z', now), 'Waktu tayang maksimal 75 hari ke depan.')
  assert.equal(validateScheduleAt('bukan tanggal', now), 'Tanggal dan waktu tidak valid.')
})
test('toUtcIso keeps the local wall time', () => {
  assert.equal(toUtcIso('2026-11-01T09:00'), new Date('2026-11-01T09:00').toISOString())
})
test('instagram eligibility', () => {
  assert.equal(igEligibility({ hasImage: false, caption: 'x' }).reason, 'Instagram wajib memakai gambar.')
  assert.equal(igEligibility({ hasImage: true, width: 1000, height: 2000, caption: 'x' }).ok, false) // 0.5 < 0.8
  assert.equal(igEligibility({ hasImage: true, width: 1080, height: 1350, caption: 'x' }).ok, true)  // 0.8
  assert.equal(igEligibility({ hasImage: true, width: 1080, height: 1080, caption: 'a'.repeat(2201) }).ok, false)
  assert.equal(igEligibility({ hasImage: true, width: 1080, height: 1080, caption: Array(31).fill('#a').join(' ') }).ok, false)
})
test('status labels', () => {
  assert.deepEqual(Object.values(SCHEDULE_STATUS_LABEL), ['Terjadwal', 'Memproses', 'Tayang', 'Gagal', 'Dibatalkan'])
  assert.deepEqual(Object.values(REQUEST_STATUS_LABEL), ['Baru', 'Diproses', 'Selesai'])
})

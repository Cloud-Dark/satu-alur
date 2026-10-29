import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCustomer, CUSTOMER_STATUS_LABEL, escapeLike, isBlocked, SUSPENDED_MESSAGE, validateSuspendReason } from '../src/customers/rules.js'

test('isBlocked: only a flag with suspended = 1 blocks', () => {
  assert.equal(isBlocked(null), false)
  assert.equal(isBlocked(undefined), false)
  assert.equal(isBlocked({ suspended: 0, reason: 'lama' }), false)
  assert.equal(isBlocked({ suspended: 1 }), true)
  assert.equal(isBlocked({ suspended: true }), true)
})

test('suspension message and reason validation', () => {
  assert.equal(SUSPENDED_MESSAGE, 'Akun Anda ditangguhkan. Hubungi tim Satu Alur.')
  assert.equal(validateSuspendReason({ reason: '  spam  ' }), 'spam')
  assert.throws(() => validateSuspendReason({ reason: '   ' }), (e) => e.validation && e.message === 'Alasan wajib diisi.')
  assert.throws(() => validateSuspendReason(null), (e) => e.validation && e.message === 'Alasan wajib diisi.')
  assert.throws(() => validateSuspendReason({ reason: 'x'.repeat(301) }), (e) => e.validation && e.message === 'Alasan maksimal 300 karakter.')
  assert.equal(validateSuspendReason({ reason: 'x'.repeat(300) }).length, 300)
})

const base = { plan_id: 2, status: 'active', period_end: '2026-12-31', company: 'CV Maju', phone: '0812', notes: 'ok' }
const fails = (body, re) => assert.throws(() => validateCustomer(body), (e) => e.validation === true && re.test(e.message))

test('labels', () => {
  assert.deepEqual(CUSTOMER_STATUS_LABEL, { trial: 'Uji coba', active: 'Aktif', past_due: 'Tertunggak', cancelled: 'Berhenti' })
})

test('validateCustomer: accepts a good body and normalises blanks', () => {
  assert.deepEqual(validateCustomer(base), base)
  const v = validateCustomer({ status: 'trial', plan_id: '', period_end: '' })
  assert.equal(v.plan_id, null)
  assert.equal(v.period_end, null)
  assert.equal(v.company, '')
})

test('validateCustomer: bad status', () => {
  fails({ ...base, status: 'gratis' }, /Status/)
  fails({ ...base, status: undefined }, /Status/)
  fails({ ...base, status: ['active'] }, /Status/)
})

test('validateCustomer: period_end must be a real YYYY-MM-DD date', () => {
  fails({ ...base, period_end: '31-12-2026' }, /Berlaku sampai/)
  fails({ ...base, period_end: '2026-02-30' }, /Berlaku sampai/)
  fails({ ...base, period_end: 20261231 }, /Tanggal tidak valid\./)
  fails({ ...base, period_end: {} }, /Tanggal tidak valid\./)
  fails({ ...base, period_end: '2026-13-01' }, /Berlaku sampai/)
  assert.equal(validateCustomer({ ...base, period_end: '2028-02-29' }).period_end, '2028-02-29')
})

test('validateCustomer: plan_id and lengths', () => {
  fails({ ...base, plan_id: 1.5 }, /Paket/)
  fails({ ...base, plan_id: 'abc' }, /Paket/)
  fails({ ...base, notes: 'x'.repeat(2001) }, /Catatan.*2000/)
  fails({ ...base, company: 'x'.repeat(121) }, /Perusahaan/)
  fails({ ...base, phone: '1'.repeat(31) }, /Telepon/)
  assert.equal(validateCustomer({ ...base, notes: 'x'.repeat(2000) }).notes.length, 2000)
})

test('escapeLike escapes %, _ and the escape char', () => {
  assert.equal(escapeLike('50%_a\\b'), '50\\%\\_a\\\\b')
})

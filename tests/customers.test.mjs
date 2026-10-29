import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCustomer, CUSTOMER_STATUS_LABEL, escapeLike } from '../src/customers/rules.js'

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

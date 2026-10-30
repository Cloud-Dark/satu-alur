import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  validateContact, validateContactUpdate, isHoneypot, contactRateLimited, mailtoHref,
  CONTACT_STATUS_LABEL, CONTACT_OK_MESSAGE, CONTACT_LIMIT_MESSAGE,
} from '../src/customers/rules.js'

const good = { name: 'Budi', email: 'budi@contoh.id', phone: '0812', subject: 'Tanya paket', message: 'Halo, saya mau tanya.' }
const fails = (body, re) => assert.throws(() => validateContact(body), (e) => e.validation === true && re.test(e.message))

test('contact copy and labels', () => {
  assert.equal(CONTACT_OK_MESSAGE, 'Pesan terkirim. Tim Satu Alur akan membalas lewat email.')
  assert.equal(CONTACT_LIMIT_MESSAGE, 'Terlalu banyak pesan. Coba lagi nanti.')
  assert.deepEqual(Object.keys(CONTACT_STATUS_LABEL), ['new', 'read', 'replied', 'archived'])
})

test('validateContact: accepts a good body, trims, phone optional', () => {
  assert.deepEqual(validateContact({ ...good, name: '  Budi ', website: '' }), good)
  assert.equal(validateContact({ ...good, phone: undefined }).phone, '')
})

test('validateContact: required fields and limits', () => {
  fails({ ...good, name: ' ' }, /Nama wajib/)
  fails({ ...good, name: 'x'.repeat(81) }, /Nama maksimal 80/)
  fails({ ...good, subject: '' }, /Subjek wajib/)
  fails({ ...good, subject: 'x'.repeat(121) }, /Subjek maksimal 120/)
  fails({ ...good, message: '' }, /Pesan wajib/)
  fails({ ...good, message: 'x'.repeat(3001) }, /Pesan maksimal 3000/)
  fails({ ...good, phone: '1'.repeat(31) }, /Telepon maksimal 30/)
  fails({ ...good, name: { a: 1 } }, /Nama wajib/)
  fails(null, /Nama wajib/)
  assert.equal(validateContact({ ...good, message: 'x'.repeat(3000) }).message.length, 3000)
})

test('validateContact: email format', () => {
  for (const bad of ['', 'budi', 'budi@', '@x.id', 'a b@x.id', 'a@x', 'a@x.id>', '"a"@x.id', `${'a'.repeat(120)}@x.id`]) fails({ ...good, email: bad }, /Email/)
})

test('honeypot: any non-blank website is a bot', () => {
  assert.equal(isHoneypot({ website: 'http://spam' }), true)
  assert.equal(isHoneypot({ website: ' x ' }), true)
  assert.equal(isHoneypot({ website: '' }), false)
  assert.equal(isHoneypot({ website: '  ' }), false)
  assert.equal(isHoneypot({}), false)
  assert.equal(isHoneypot(null), false)
})

test('contactRateLimited: at 5 or more in the last hour', () => {
  assert.equal(contactRateLimited(0), false)
  assert.equal(contactRateLimited(4), false)
  assert.equal(contactRateLimited(5), true)
  assert.equal(contactRateLimited(9), true)
})

test('validateContactUpdate: status and note', () => {
  assert.deepEqual(validateContactUpdate({ status: 'read' }), { status: 'read' })
  assert.deepEqual(validateContactUpdate({ staff_note: ' tindak ' }), { staff_note: 'tindak' })
  assert.deepEqual(validateContactUpdate({ status: 'replied', staff_note: '' }), { status: 'replied', staff_note: '' })
  assert.throws(() => validateContactUpdate({}), (e) => e.validation)
  assert.throws(() => validateContactUpdate({ status: 'selesai' }), (e) => e.validation && /Status/.test(e.message))
  assert.throws(() => validateContactUpdate({ staff_note: 'x'.repeat(2001) }), (e) => e.validation && /2000/.test(e.message))
})

test('mailtoHref: only for a strict email; address and subject are percent-encoded', () => {
  assert.equal(mailtoHref('budi@contoh.id', 'Tanya paket'), 'mailto:budi%40contoh.id?subject=Re%3A%20Tanya%20paket')
  assert.equal(mailtoHref('budi@contoh.id', 'a&b=c'), 'mailto:budi%40contoh.id?subject=Re%3A%20a%26b%3Dc')
  assert.equal(mailtoHref('x@y.id?cc=evil@z.id', 's'), null)
  assert.equal(mailtoHref('javascript:alert(1)', 's'), null)
  assert.equal(mailtoHref('', 's'), null)
})

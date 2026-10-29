import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  validateTicket, validateReply, validateTicketStatus, nextStatusOnReply, customerAuthorName, staffAuthorName,
  ticketLimitReached, TICKET_STATUS_LABEL, TICKET_CATEGORY_LABEL, TICKET_LIMIT_MESSAGE, TICKET_CLOSED_MESSAGE, TICKET_NOT_FOUND,
} from '../src/support/rules.js'

const good = { category: 'teknis', subject: 'Tidak bisa login', body: 'Halo,\nsaya tidak bisa masuk.' }
const fails = (fn, re) => assert.throws(fn, (e) => e.validation === true && re.test(e.message))

test('labels and copy', () => {
  assert.deepEqual(TICKET_STATUS_LABEL, { open: 'Terbuka', in_progress: 'Diproses', resolved: 'Selesai', closed: 'Ditutup' })
  assert.deepEqual(TICKET_CATEGORY_LABEL, { teknis: 'Teknis', tagihan: 'Tagihan', akun: 'Akun', lainnya: 'Lainnya' })
  assert.equal(TICKET_LIMIT_MESSAGE, 'Terlalu banyak tiket terbuka.')
  assert.equal(TICKET_CLOSED_MESSAGE, 'Tiket sudah ditutup.')
  assert.equal(TICKET_NOT_FOUND, 'Tiket tidak ditemukan.')
})

test('validateTicket: accepts a good body, trims, keeps line breaks', () => {
  assert.deepEqual(validateTicket({ ...good, subject: '  Tidak bisa login ' }), good)
})

test('validateTicket: category, subject and body rules', () => {
  fails(() => validateTicket({ ...good, category: 'lain' }), /Kategori/)
  fails(() => validateTicket({ ...good, category: undefined }), /Kategori/)
  fails(() => validateTicket({ ...good, subject: ' ' }), /Subjek wajib/)
  fails(() => validateTicket({ ...good, subject: 'x'.repeat(121) }), /Subjek maksimal 120/)
  fails(() => validateTicket({ ...good, body: '' }), /Pesan wajib/)
  fails(() => validateTicket({ ...good, body: 'x'.repeat(3001) }), /Pesan maksimal 3000/)
  fails(() => validateTicket({ ...good, subject: { a: 1 } }), /Subjek wajib/)
  fails(() => validateTicket(null), /Kategori/)
  assert.equal(validateTicket({ ...good, body: 'x'.repeat(3000) }).body.length, 3000)
})

test('validateReply and validateTicketStatus', () => {
  assert.equal(validateReply({ body: ' oke ' }), 'oke')
  fails(() => validateReply({ body: '  ' }), /Pesan wajib/)
  fails(() => validateReply({ body: 'x'.repeat(3001) }), /Pesan maksimal 3000/)
  fails(() => validateReply(null), /Pesan wajib/)
  for (const s of Object.keys(TICKET_STATUS_LABEL)) assert.equal(validateTicketStatus({ status: s }), s)
  fails(() => validateTicketStatus({ status: 'new' }), /Status/)
  fails(() => validateTicketStatus({}), /Status/)
})

test('nextStatusOnReply: customer', () => {
  assert.equal(nextStatusOnReply('open', 'customer'), 'open')
  assert.equal(nextStatusOnReply('in_progress', 'customer'), 'in_progress')
  assert.equal(nextStatusOnReply('resolved', 'customer'), 'open')
  fails(() => nextStatusOnReply('closed', 'customer'), /^Tiket sudah ditutup\.$/)
})

test('nextStatusOnReply: staff', () => {
  assert.equal(nextStatusOnReply('open', 'staff'), 'in_progress')
  assert.equal(nextStatusOnReply('in_progress', 'staff'), 'in_progress')
  assert.equal(nextStatusOnReply('resolved', 'staff'), 'resolved')
  assert.equal(nextStatusOnReply('closed', 'staff'), 'closed')
})

test('author names: company, else name, else email; staff never by email', () => {
  assert.equal(customerAuthorName({ company: 'CV Maju', name: 'Budi', email: 'b@x.id' }), 'CV Maju')
  assert.equal(customerAuthorName({ company: ' ', name: 'Budi', email: 'b@x.id' }), 'Budi')
  assert.equal(customerAuthorName({ company: null, name: '', email: 'b@x.id' }), 'b@x.id')
  assert.equal(staffAuthorName('budi'), 'Tim Satu Alur (budi)')
  assert.equal(staffAuthorName(''), 'Tim Satu Alur')
})

test('ticketLimitReached: 20 open tickets per business', () => {
  assert.equal(ticketLimitReached(19), false)
  assert.equal(ticketLimitReached(20), true)
})

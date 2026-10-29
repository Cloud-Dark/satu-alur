// Final-review hardening: staff-suffix signups, IPv6 contact buckets, demo accounts can't be suspended.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isStaffEmail, ipBucket, contactGloballyLimited, CONTACT_GLOBAL_LIMIT, DEMO_SUSPEND_MESSAGE,
} from '../src/customers/rules.js'

test('isStaffEmail: the staff suffix in any case or padding', () => {
  assert.equal(isStaffEmail('budi@staff.satualur.internal'), true)
  assert.equal(isStaffEmail('  Budi@STAFF.Satualur.Internal '), true)
  assert.equal(isStaffEmail('budi@satualur.internal'), false)
  assert.equal(isStaffEmail('staff.satualur.internal@x.id'), false)
  assert.equal(isStaffEmail(null), false)
})

test('ipBucket: IPv4 as is, IPv6 by /64 whatever the spelling', () => {
  assert.equal(ipBucket('203.0.113.7'), '203.0.113.7')
  assert.equal(ipBucket('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3:8d3')
  // same /64, different hosts and spellings → one bucket
  assert.equal(ipBucket('2001:db8:1:2::1'), '2001:db8:1:2')
  assert.equal(ipBucket('2001:0DB8:0001:0002:ffff::9'), '2001:db8:1:2')
  // compressed inside the /64
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0')
  assert.equal(ipBucket('2001:db8::abcd'), '2001:db8:0:0')
  assert.equal(ipBucket('::1'), '0:0:0:0')
  // IPv4-mapped IPv6 counts as the IPv4 address
  assert.equal(ipBucket('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(ipBucket(''), '')
  assert.equal(ipBucket(null), '')
})

test('global contact cap: 200 in the last hour', () => {
  assert.equal(CONTACT_GLOBAL_LIMIT, 200)
  assert.equal(contactGloballyLimited(199), false)
  assert.equal(contactGloballyLimited(200), true)
})

test('demo accounts cannot be suspended', () => {
  assert.equal(DEMO_SUSPEND_MESSAGE, 'Akun demo bersama tidak bisa ditangguhkan.')
})

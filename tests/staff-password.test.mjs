// Staff password hashing (src/staff/password.js). Run: node --test tests/staff-password.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword, validateUsername, validatePassword } from '../src/staff/password.js'

test('hash + verify round trip; wrong password fails; salt makes hashes differ', async () => {
  const h = await hashPassword('benar-sekali-123')
  assert.match(h, /^pbkdf2-sha256\$100000\$[^$]+\$[^$]+$/)
  assert.equal(await verifyPassword('benar-sekali-123', h), true)
  assert.equal(await verifyPassword('salah-sekali-123', h), false)
  assert.notEqual(await hashPassword('benar-sekali-123'), h)
})

test('malformed or downgraded hashes never verify and never throw', async () => {
  for (const bad of ['', null, 'plain', 'md5$1$a$b', 'pbkdf2-sha256$abc$a$b', 'pbkdf2-sha256$100000$!!$!!', 'pbkdf2-sha256$999999$YQ==$YQ==']) {
    assert.equal(await verifyPassword('x', bad), false, String(bad))
  }
})

test('username and password rules', () => {
  assert.equal(validateUsername('budi.s'), null)
  assert.ok(validateUsername('Budi'))
  assert.ok(validateUsername('ab'))
  assert.ok(validateUsername("a'; DROP TABLE x;--"))
  assert.equal(validatePassword('dua-belas-kar'), null)
  assert.equal(validatePassword('pendek'), 'Password minimal 12 karakter.')
  assert.equal(validatePassword('x'.repeat(129)), 'Password maksimal 128 karakter.')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptToken, decryptToken, signState, verifyState } from '../src/social/crypto.js'

const key = (b) => Buffer.alloc(32, b).toString('base64')

test('encryptToken/decryptToken round trip', async () => {
  const blob = await encryptToken('EAAB-page-token', key(1))
  assert.match(blob, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.ok(!blob.includes('EAAB'))
  assert.equal(await decryptToken(blob, key(1)), 'EAAB-page-token')
  assert.notEqual(await encryptToken('EAAB-page-token', key(1)), blob) // fresh IV each time
})

test('decryptToken with another key rejects', async () => {
  const blob = await encryptToken('secret', key(1))
  await assert.rejects(decryptToken(blob, key(2)))
})

test('verifyState: fresh, tampered, expired', async () => {
  const now = Date.now()
  const state = await signState({ ownerId: 'u1', exp: now + 600000, nonce: 'n1' }, 'app-secret')
  assert.deepEqual(await verifyState(state, 'app-secret', now), { ownerId: 'u1', nonce: 'n1' })
  const [p, s] = state.split('.')
  const forged = Buffer.from(JSON.stringify({ ownerId: 'u2', exp: now + 600000, nonce: 'n1' })).toString('base64url')
  assert.equal(await verifyState(`${forged}.${s}`, 'app-secret', now), null)
  assert.equal(await verifyState(`${p}.${s.slice(0, -2)}AA`, 'app-secret', now), null)
  assert.equal(await verifyState(state, 'other-secret', now), null)
  assert.equal(await verifyState(state, 'app-secret', now + 600001), null)
  assert.equal(await verifyState('garbage', 'app-secret', now), null)
  assert.equal(await verifyState(null, 'app-secret', now), null)
})

test('verifyState: nonce round trip, and a swapped nonce breaks the signature', async () => {
  const now = Date.now()
  const nonce = 'a'.repeat(32)
  const state = await signState({ ownerId: 'u1', exp: now + 600000, nonce }, 'app-secret')
  assert.equal((await verifyState(state, 'app-secret', now)).nonce, nonce)
  const [, s] = state.split('.')
  const swapped = Buffer.from(JSON.stringify({ ownerId: 'u1', exp: now + 600000, nonce: 'b'.repeat(32) })).toString('base64url')
  assert.equal(await verifyState(`${swapped}.${s}`, 'app-secret', now), null)
  // No nonce signed in: still verifies, nonce comes back null (the callback then rejects it).
  const bare = await signState({ ownerId: 'u1', exp: now + 600000 }, 'app-secret')
  assert.deepEqual(await verifyState(bare, 'app-secret', now), { ownerId: 'u1', nonce: null })
})

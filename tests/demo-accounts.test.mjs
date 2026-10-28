// Unit tests: src/auth/demo-accounts.js and its sync with the Worker allow-list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import './helpers/setup.mjs'

const { DEMO_ACCOUNTS, DEMO_SCALES, isDemoEmail, demoAccount } = await import('../src/auth/demo-accounts.js')

test('nine demo accounts, three per scale', () => {
  assert.equal(DEMO_ACCOUNTS.length, 9)
  assert.deepEqual(DEMO_SCALES.map((s) => s.value), ['sole', 'ukm', 'enterprise'])
  for (const s of DEMO_SCALES) assert.equal(DEMO_ACCOUNTS.filter((a) => a.scale === s.value).length, 3, s.value)
  assert.equal(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size, 9)
})

test('isDemoEmail / demoAccount are case-insensitive', () => {
  assert.equal(isDemoEmail('DEMO-AC@satualur.id'), true)
  assert.equal(isDemoEmail('demo@satualur.id'), false)
  assert.equal(isDemoEmail(null), false)
  assert.equal(demoAccount('Demo-Pest@SatuAlur.id').city, 'Surabaya')
  assert.equal(demoAccount('x@y.z'), null)
})

test('client list matches DEMO_EMAILS in worker/index.js', async () => {
  const src = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  const block = src.match(/const DEMO_EMAILS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(block, 'DEMO_EMAILS found in worker')
  const worker = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(worker, DEMO_ACCOUNTS.map((a) => a.email).sort())
})

test('seed summary covers the same nine accounts', async () => {
  const summary = JSON.parse(await readFile(new URL('../seeds/demo-summary.json', import.meta.url), 'utf8'))
  assert.deepEqual(summary.businesses.map((b) => b.email).sort(), DEMO_ACCOUNTS.map((a) => a.email).sort())
})

// Linked social accounts (src/stages/social-accounts.js): input parsing,
// links, per-user storage. Nothing here talks to a platform.
import './helpers/setup.mjs'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const A = await import('../src/stages/social-accounts.js')
const S = await import('../src/ai/social-agent.js')

beforeEach(() => localStorage.clear())

test('handles: @name, bare name and profile URLs all give the same handle', () => {
  for (const input of ['@jasa.ac', 'jasa.ac', 'https://www.instagram.com/jasa.ac/', 'instagram.com/jasa.ac?igsh=1']) {
    assert.deepEqual(A.parseAccount('instagram', input), { handle: 'jasa.ac', display: '@jasa.ac' }, input)
  }
  assert.equal(A.parseAccount('threads', 'https://www.threads.net/@jasa.ac').handle, 'jasa.ac')
  assert.equal(A.parseAccount('tiktok', 'https://www.tiktok.com/@jasa_ac').handle, 'jasa_ac')
  assert.equal(A.parseAccount('x', 'https://twitter.com/JasaAC').handle, 'JasaAC')
  assert.equal(A.parseAccount('facebook', 'fb.com/jasa.ac.bekasi').handle, 'jasa.ac.bekasi')
})

test('handles: invalid input and foreign links are rejected with a message', () => {
  assert.match(A.parseAccount('instagram', '').error, /Isi/)
  assert.match(A.parseAccount('instagram', 'jasa ac!').error, /tidak valid/)
  assert.match(A.parseAccount('instagram', 'https://x.com/jasa').error, /bukan profil Instagram/)
  assert.match(A.parseAccount('x', 'nama_yang_terlalu_panjang').error, /tidak valid/)
  assert.match(A.parseAccount('nope', 'a').error, /tidak dikenal/)
})

test('LinkedIn accepts /in/ and /company/ links', () => {
  assert.deepEqual(A.parseAccount('linkedin', 'https://www.linkedin.com/company/jasa-ac/'), { handle: 'company/jasa-ac', display: 'jasa-ac' })
  assert.equal(A.parseAccount('linkedin', 'budi-santoso').handle, 'in/budi-santoso')
  assert.match(A.parseAccount('linkedin', 'https://www.linkedin.com/feed/').error, /linkedin.com\/in/)
})

test('WhatsApp numbers are normalised to 62…', () => {
  assert.equal(A.normalizeWaNumber('0812-3456-7890'), '6281234567890')
  assert.equal(A.normalizeWaNumber('+62 812 3456 7890'), '6281234567890')
  assert.equal(A.normalizeWaNumber('https://wa.me/6281234567890'), '6281234567890')
  assert.equal(A.normalizeWaNumber('12345'), null)
  assert.deepEqual(A.parseAccount('whatsapp', '081234567890'), { handle: '6281234567890', display: '+6281234567890' })
})

test('links: profile and composer URLs (text encoded)', () => {
  assert.equal(A.profileUrl('threads', { handle: 'jasa.ac' }), 'https://www.threads.net/@jasa.ac')
  assert.equal(A.profileUrl('instagram', null), null)
  assert.equal(A.composeUrl('threads', 'Halo & #ac'), 'https://www.threads.net/intent/post?text=Halo%20%26%20%23ac')
  assert.equal(A.composeUrl('x', 'a b'), 'https://x.com/intent/post?text=a%20b')
  assert.equal(A.composeUrl('instagram', 'x'), 'https://www.instagram.com/')
  assert.equal(A.composeUrl('facebook', 'x', { handle: 'halaman' }), 'https://www.facebook.com/halaman')
})

test('storage is per user and survives reload; disconnect removes one platform', () => {
  assert.ok(A.connectAccount('u1', 'threads', '@jasa.ac', '  Jasa AC  ').account)
  A.connectAccount('u1', 'whatsapp', '081234567890')
  assert.match(A.connectAccount('u1', 'x', 'bad name').error, /tidak valid/)
  const a = A.loadAccounts('u1')
  assert.deepEqual(Object.keys(a).sort(), ['threads', 'whatsapp'])
  assert.equal(a.threads.name, 'Jasa AC')
  assert.deepEqual(A.loadAccounts('u2'), {})
  A.disconnectAccount('u1', 'threads')
  assert.deepEqual(Object.keys(A.loadAccounts('u1')), ['whatsapp'])
})

test('storage: corrupt or foreign data is ignored', () => {
  localStorage.setItem('satualur_social_accounts:u1', '{not json')
  assert.deepEqual(A.loadAccounts('u1'), {})
  localStorage.setItem('satualur_social_accounts:u1', JSON.stringify({ myspace: { handle: 'a' }, x: { handle: '' }, threads: { handle: 'ok' } }))
  assert.deepEqual(Object.keys(A.loadAccounts('u1')), ['threads'])
})

test('connectedPlatforms keeps page order; every writer platform can be linked', () => {
  assert.deepEqual(A.connectedPlatforms({ x: {}, threads: {} }, S.PLATFORMS.map((p) => p.value)), ['threads', 'x'])
  for (const p of S.PLATFORMS) assert.ok(A.accountPlatform(p.value), p.value)
})

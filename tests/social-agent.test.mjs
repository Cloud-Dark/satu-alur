// Unit tests: src/ai/social-agent.js exported helpers. NORMALIZE/splitInlineHashtags are
// module-private; they are covered end to end through generateContent() etc. in
// tests/ai-integration.test.mjs (stubbed LLM).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/setup.mjs'

const S = await import('../src/ai/social-agent.js')

test('normalizeHashtags: adds #, strips spaces/punctuation, dedupes case-insensitively', () => {
  assert.deepEqual(S.normalizeHashtags(['#Jasa AC', 'jasa ac', '#jasaAC', '##Bekasi', 'servis-ac!']), ['#JasaAC', '#Bekasi', '#servisac'])
})

test('normalizeHashtags: splits "#a #b" strings and comma/newline lists', () => {
  assert.deepEqual(S.normalizeHashtags('#cuciac #bekasi'), ['#cuciac', '#bekasi'])
  assert.deepEqual(S.normalizeHashtags('cuci ac, bekasi\nservis'), ['#cuciac', '#bekasi', '#servis'])
})

test('normalizeHashtags: keeps Unicode letters and digits, drops empties', () => {
  assert.deepEqual(S.normalizeHashtags(['#Promo2026', '#', '  ', '#café']), ['#Promo2026', '#café'])
})

test('normalizeHashtags: honours max and empty input', () => {
  const many = Array.from({ length: 40 }, (_, i) => `tag${i}`)
  assert.equal(S.normalizeHashtags(many).length, 30)
  assert.equal(S.normalizeHashtags(many, 5).length, 5)
  assert.deepEqual(S.normalizeHashtags(null), [])
  assert.deepEqual(S.normalizeHashtags(''), [])
})

test('contentText joins body and hashtags with a blank line', () => {
  assert.equal(S.contentText(' Isi konten ', ['#a', '#b']), 'Isi konten\n\n#a #b')
  assert.equal(S.contentText('Isi', []), 'Isi')
  assert.equal(S.contentText('', ['#a']), '#a')
})

test('ideaText / partnershipText skip empty parts', () => {
  assert.equal(S.ideaText({ format: 'Reels', hook: 'Hook', concept: 'Konsep' }), 'Format: Reels\nHook: Hook\nKonsep')
  assert.equal(S.ideaText({ concept: 'Konsep' }), 'Konsep')
  assert.equal(S.partnershipText({ why: 'W', pitch: 'P' }), 'Alasan: W\n\nPesan ajakan:\nP')
})

test('adsText renders sections and collapses blank lines', () => {
  const txt = S.adsText({
    audience: { age_range: '28–50', gender: 'Semua', locations: ['Bekasi 10 km'], interests: ['Rumah'], behaviors: [] },
    placements: ['Feed Instagram'], schedule: '', budget_plan: 'Uji 7 hari',
    ad_copies: [{ headline: 'AC dingin lagi', primary_text: 'Servis hari ini.', cta: 'Kirim Pesan' }],
    hashtags: ['#servisac'], tips: ['Pantau CTR'],
  })
  assert.match(txt, /^Audiens\n- Usia: 28–50/)
  assert.match(txt, /Materi 1: AC dingin lagi\nServis hari ini\.\nTombol: Kirim Pesan/)
  assert.doesNotMatch(txt, /\n\n\n/)
  assert.doesNotMatch(txt, /Perilaku|Jam tayang/)
})

test('labels and option lists', () => {
  assert.equal(S.platformLabel('meta'), 'Meta (FB & IG)')
  assert.equal(S.platformLabel(''), 'Semua platform')
  assert.equal(S.platformLabel('myspace'), 'myspace')
  assert.equal(S.labelOf(S.TONES, 'nope'), 'nope')
  assert.equal(S.labelOf(S.TONES, ''), '—')
  assert.ok(S.PLATFORMS.length >= 4)
  assert.equal(S.SOCIAL_MARKER, '[agent:social]')
})

test('Threads is a platform: 500 characters, one topic tag', () => {
  const t = S.PLATFORMS.find((p) => p.value === 'threads')
  assert.ok(t, 'threads listed')
  assert.equal(t.label, 'Threads')
  assert.equal(t.limit, 500)
  assert.equal(t.maxTags, 1)
  assert.equal(S.platformLabel('threads'), 'Threads')
})

test('capHashtags follows each platform budget', () => {
  const tags = ['#a', '#b', '#c', '#d', '#e', '#f', '#g']
  assert.deepEqual(S.capHashtags('threads', tags), ['#a'])
  assert.deepEqual(S.capHashtags('whatsapp', tags), [])
  assert.deepEqual(S.capHashtags('x', tags), ['#a', '#b'])
  assert.equal(S.capHashtags('instagram', tags).length, 7)
  assert.deepEqual(S.capHashtags('unknown', tags), tags)
  assert.deepEqual(S.capHashtags('threads', null), [])
})

test('every platform has a hashtag budget', () => {
  for (const p of S.PLATFORMS) assert.ok(Number.isInteger(p.maxTags) && p.maxTags >= 0, p.value)
})

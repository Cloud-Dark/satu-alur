import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SITE_KEYS, validateSiteContent, parseDoc } from '../src/site/content-rules.js'

const landing = (over = {}) => ({
  hero: { badge: ' Baru ', title: 'Kelola *usaha* Anda', subtitle: 'Sub', points: ['a', 'b'], extra: 1 },
  faqs: [{ q: 'Apa?', a: 'Ini.', x: 1 }],
  ...over,
})

test('SITE_KEYS are the five pages', () => {
  assert.deepEqual(SITE_KEYS, ['landing', 'about', 'privacy', 'terms', 'cookies'])
})

test('valid landing passes, trims and drops unknown fields', () => {
  const v = validateSiteContent('landing', landing())
  assert.equal(v.hero.badge, 'Baru')
  assert.equal(v.hero.extra, undefined)
  assert.deepEqual(v.faqs, [{ q: 'Apa?', a: 'Ini.' }])
})

test('valid doc passes', () => {
  assert.deepEqual(validateSiteContent('privacy', { title: ' Privasi ', body: 'Isi', z: 1 }), { title: 'Privasi', body: 'Isi' })
})

test('5th hero point and 21st FAQ are rejected', () => {
  const pts = landing(); pts.hero.points = ['1', '2', '3', '4', '5']
  assert.throws(() => validateSiteContent('landing', pts), /Maksimal 4 poin\./)
  const faqs = landing({ faqs: Array.from({ length: 21 }, () => ({ q: 'q', a: 'a' })) })
  assert.throws(() => validateSiteContent('landing', faqs), /Maksimal 20 FAQ\./)
})

test('unknown key throws', () => {
  assert.throws(() => validateSiteContent('x', { title: 't', body: 'b' }))
})

test('length limits and validation tag', () => {
  assert.throws(() => validateSiteContent('about', { title: 'x'.repeat(121), body: '' }), (e) => e.validation === true && /Judul/.test(e.message))
  assert.throws(() => validateSiteContent('about', { title: 't', body: 'x'.repeat(50001) }), /Isi/)
  const l = landing(); l.hero.subtitle = 'x'.repeat(301)
  assert.throws(() => validateSiteContent('landing', l), /Subjudul/)
  assert.throws(() => validateSiteContent('about', 'nope'), /tidak valid/)
})

test('whole value over 64 KB is rejected', () => {
  const faqs = Array.from({ length: 20 }, () => ({ q: 'q', a: '€'.repeat(1200) }))
  assert.throws(() => validateSiteContent('landing', landing({ faqs })), /64 KB/)
})

test('HTML is kept as literal text', () => {
  assert.equal(validateSiteContent('terms', { title: 't', body: '<b>x</b>' }).body, '<b>x</b>')
})

test('parseDoc builds h/p/ul blocks', () => {
  assert.deepEqual(parseDoc('## A\n\nteks\n- satu\n- dua'), [
    { type: 'h', text: 'A' },
    { type: 'p', text: 'teks' },
    { type: 'ul', items: ['satu', 'dua'] },
  ])
  assert.deepEqual(parseDoc('baris 1\nbaris 2\n\nlain'), [{ type: 'p', text: 'baris 1 baris 2' }, { type: 'p', text: 'lain' }])
  assert.deepEqual(parseDoc(''), [])
})

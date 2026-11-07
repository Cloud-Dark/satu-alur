// Unit tests: src/i18n/core.js and the /lang catalogs (every namespace exists in both languages with the same keys).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectLang, translate, registerCatalog, keyPaths, interpolate, LANGS } from '../src/i18n/core.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lang')
const read = (lang) => Object.fromEntries(fs.readdirSync(path.join(ROOT, lang)).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(ROOT, lang, f), 'utf8'))]))

test('detectLang: stored choice, then browser language', () => {
  assert.equal(detectLang({ stored: 'en', languages: ['id-ID'] }), 'en')
  assert.equal(detectLang({ stored: 'xx', languages: ['id-ID'] }), 'id')
  assert.equal(detectLang({ languages: ['en-US', 'id'] }), 'en')
  assert.equal(detectLang({ languages: ['ms-MY'] }), 'id')
  assert.equal(detectLang({ languages: ['fr-FR'] }), 'en')
  assert.equal(detectLang({ languages: [] }), 'id')
})

test('translate: lookup, interpolation and fallback', () => {
  registerCatalog('id', 'zz', { a: { b: 'Halo {nama}' }, only: 'Hanya ID' })
  registerCatalog('en', 'zz', { a: { b: 'Hello {nama}' } })
  assert.equal(translate('en', 'zz.a.b', { nama: 'Sari' }), 'Hello Sari')
  assert.equal(translate('en', 'zz.only'), 'Hanya ID')
  assert.equal(translate('en', 'zz.none', null, 'Cadangan'), 'Cadangan')
  assert.equal(translate('en', 'zz.none'), 'zz.none')
  assert.equal(interpolate('{a} {b}', { a: 1 }), '1 {b}')
})

test('catalogs: both languages have the same files and the same keys', () => {
  const langs = LANGS.map((l) => l.code)
  const cats = Object.fromEntries(langs.map((l) => [l, read(l)]))
  const files = (l) => Object.keys(cats[l]).sort()
  assert.deepEqual(files('en'), files('id'), 'same namespace files in lang/id and lang/en')
  for (const ns of files('id')) {
    const idKeys = keyPaths(cats.id[ns]).sort()
    const enKeys = keyPaths(cats.en[ns]).sort()
    const missing = idKeys.filter((k) => !enKeys.includes(k))
    const extra = enKeys.filter((k) => !idKeys.includes(k))
    assert.deepEqual({ ns, missing, extra }, { ns, missing: [], extra: [] })
    for (const k of enKeys) {
      const v = k.split('.').reduce((o, p) => o?.[p], cats.en[ns])
      assert.ok(v !== '' && v !== null, `lang/en/${ns}.json ${k} is empty`)
    }
  }
})

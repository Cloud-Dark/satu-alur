// Checks the translation files in src/lang: every namespace exists in both languages with
// the same keys and the same {placeholders}, and language detection picks the right one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectLang } from '../src/i18n/index.js'

const LANG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lang')
const read = (lang) => Object.fromEntries(fs.readdirSync(path.join(LANG_DIR, lang)).filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(LANG_DIR, lang, f), 'utf8'))]))

function flatten(obj, pre = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = pre ? `${pre}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = v
  }
  return out
}
const vars = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [])

const id = read('id')
const en = read('en')

test('every namespace exists in both id and en', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(id).sort())
})

for (const file of Object.keys(id)) {
  test(`${file}: same keys and placeholders in id and en`, () => {
    const a = flatten(id[file])
    const b = flatten(en[file] || {})
    const missing = Object.keys(a).filter((k) => !(k in b))
    const extra = Object.keys(b).filter((k) => !(k in a))
    assert.deepEqual(missing, [], `missing in en/${file}`)
    assert.deepEqual(extra, [], `only in en/${file}`)
    for (const k of Object.keys(a)) {
      assert.deepEqual(vars(b[k]), vars(a[k]), `placeholders differ for ${file} → ${k}`)
      if (typeof a[k] === 'string') assert.ok(String(b[k]).trim(), `empty translation for ${file} → ${k}`)
    }
  })
}

test('detectLang follows the browser preference', () => {
  assert.equal(detectLang(['en-GB', 'id']), 'en')
  assert.equal(detectLang(['id-ID', 'en']), 'id')
  assert.equal(detectLang(['ms-MY']), 'id')
  assert.equal(detectLang(['fr-FR', 'en-US']), 'en')
  assert.equal(detectLang(['fr-FR', 'de']), 'id')
  assert.equal(detectLang([]), 'id')
})

// Offer flow: progressive JSON reader, pipeline state machine, template rules,
// prompt context, schedule suggestion, review draft, offer document, simulator.
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { readPartialJson } = await import('../src/offer/partial-json.js')
const { createPipeline, PIPELINE_STEPS } = await import('../src/offer/pipeline.js')
const T = await import('../src/offer/templates.js')
const { suggestSchedule, priceHistory, reviewDraft } = await import('../src/offer/review.js')
const { offerDocumentHTML, offerNumber } = await import('../src/offer/document.js')
const { simulateAnswer } = await import('../src/ai/simulate.js')

test('readPartialJson: reads fields as they stream in', () => {
  const full = JSON.stringify({ scope: 'Cuci AC 3 unit "split"\ndi lantai 2', price: 450000, terms: 'Bayar setelah selesai', notes: '' }, null, 2)
  const seen = []
  for (let i = 1; i <= full.length; i += 7) seen.push(readPartialJson(full.slice(0, i)))
  const mid = seen.find((r) => r.fields.scope && !r.closed.has('scope'))
  assert.ok(mid, 'an open scope string is returned while it is being written')
  assert.ok('Cuci AC 3 unit "split"\ndi lantai 2'.startsWith(mid.fields.scope))
  const end = readPartialJson(full)
  assert.equal(end.fields.scope, 'Cuci AC 3 unit "split"\ndi lantai 2')
  assert.equal(end.fields.price, 450000)
  assert.equal(end.fields.terms, 'Bayar setelah selesai')
  assert.ok(end.closed.has('scope') && end.closed.has('price') && end.closed.has('terms'))
})

test('readPartialJson: tolerates no object, cut escapes and a number still being written', () => {
  assert.deepEqual(readPartialJson('').fields, {})
  assert.deepEqual(readPartialJson('Menyusun…').fields, {})
  assert.equal(readPartialJson('{"scope": "a\\').fields.scope, 'a')
  assert.equal(readPartialJson('{"scope": "\\u00e9t\\u00').fields.scope, 'ét')
  const r = readPartialJson('{"scope":"x","price": 12')
  assert.equal(r.fields.price, 12)
  assert.ok(!r.closed.has('price'), 'a number at the very end may still grow')
})

test('pipeline: runs, fails, stops and resumes from the right step', () => {
  const p = createPipeline()
  assert.equal(p.steps.length, PIPELINE_STEPS.length)
  assert.equal(p.resumeKey, 'data')
  p.start('data', 0); p.done('data', 250)
  assert.equal(p.get('data').ms, 250)
  p.start('schedule'); p.done('schedule')
  p.start('offer'); p.fail('offer', new Error('Kuota habis'))
  assert.equal(p.get('offer').state, 'error')
  assert.equal(p.get('offer').error, 'Kuota habis')
  assert.equal(p.resumeKey, 'offer')
  p.resetFrom('offer')
  assert.equal(p.get('offer').state, 'pending')
  assert.equal(p.get('data').state, 'done', 'earlier steps stay done')
  p.start('offer'); p.stop()
  assert.equal(p.get('offer').state, 'stopped')
  assert.equal(p.get('pdf').state, 'stopped')
  assert.throws(() => p.done('pdf'), /belum berjalan/)
  assert.throws(() => p.start('nope'), /tidak dikenal/)
  const q = createPipeline()
  for (const s of q.steps) { q.start(s.key); q.done(s.key) }
  assert.ok(q.complete)
})

test('templates: defaults are valid and fields normalise', () => {
  assert.equal(T.DEFAULT_TEMPLATES.length, 8)
  for (const t of T.DEFAULT_TEMPLATES) assert.doesNotThrow(() => T.validateTemplate(t), t.name)
  const v = T.validateTemplate({ name: 'Uji', category: 'jasa', fields: [
    { label: 'Jumlah Unit!', type: 'number' },
    { label: 'Jumlah Unit!', type: 'text' },
    { label: 'Paket', type: 'select', options: 'Basic\nPro\nPro' },
  ] })
  assert.deepEqual(v.fields.map((f) => f.key), ['jumlah_unit', 'jumlah_unit_2'].concat(['paket']))
  assert.deepEqual(v.fields[2].options, ['Basic', 'Pro'])
  assert.equal(v.active, 1)
})

test('templates: validation errors are readable', () => {
  const bad = (t, re) => assert.throws(() => T.validateTemplate({ name: 'Uji', category: 'jasa', ...t }), re)
  bad({ name: 'x' }, /minimal 2/)
  bad({ category: 'mainan' }, /kategori/)
  bad({ fields: [{ label: '', type: 'text' }] }, /label/)
  bad({ fields: [{ label: 'A', type: 'warna' }] }, /tidak dikenal/)
  bad({ fields: [{ label: 'A', type: 'select', options: ['satu'] }] }, /minimal 2 opsi/)
  bad({ price_hint_min: 500, price_hint_max: 100 }, /tidak boleh lebih besar/)
  bad({ fields: Array.from({ length: 13 }, (_, i) => ({ label: `F${i}`, type: 'text' })) }, /Maksimal 12/)
})

test('templates: answers are checked against the fields', () => {
  const t = T.validateTemplate(T.DEFAULT_TEMPLATES[0]) // website
  const empty = T.validateAnswers(t, {})
  assert.deepEqual(empty.errors.map((e) => e.key), ['jenis', 'fitur'])
  const r = T.validateAnswers(t, { jenis: 'Toko online', fitur: 'Keranjang, pembayaran', halaman: '12', tenggat: '2026-12-01' })
  assert.deepEqual(r.errors, [])
  assert.equal(r.answers.halaman, '12')
  assert.match(T.validateAnswers(t, { jenis: 'Game', fitur: 'x' }).errors[0].text, /Pilih salah satu/)
  assert.match(T.validateAnswers(t, { jenis: 'Toko online', fitur: 'x', halaman: 'banyak' }).errors[0].text, /angka/)
})

test('templateContext: carries answers, hints, price range and default terms to the AI', () => {
  const t = T.validateTemplate(T.DEFAULT_TEMPLATES[0])
  const ctx = T.templateContext(t, { jenis: 'Toko online', fitur: 'Keranjang' })
  assert.match(ctx, /Template penawaran: Pengembangan website \(Digital\)/)
  assert.match(ctx, /- Jenis website: Toko online/)
  assert.match(ctx, /- Fitur utama: Keranjang/)
  assert.match(ctx, /Kisaran harga wajar: Rp3\.000\.000 – Rp45\.000\.000/)
  assert.match(ctx, /Ketentuan bawaan/)
  assert.equal(T.templateContext(null, {}), '')
})

test('migration 0018 seeds exactly the default templates', async () => {
  const sql = await readFile(new URL('../migrations/0018_offer_templates.sql', import.meta.url), 'utf8')
  for (const t of T.DEFAULT_TEMPLATES) assert.ok(sql.includes(`'${t.name.replace(/'/g, "''")}'`), t.name)
  assert.match(sql, /ALTER TABLE offers ADD COLUMN template_id INTEGER/)
  assert.match(sql, /ALTER TABLE offers ADD COLUMN template_answers_json TEXT/)
})

test('suggestSchedule: client time first, else the lightest working day', () => {
  const now = new Date('2026-11-04T08:00:00') // Wednesday
  const asked = suggestSchedule({ requestedAt: '2026-11-10T13:00:00', now })
  assert.equal(asked.reason, 'client')
  const past = suggestSchedule({ requestedAt: '2026-11-01T13:00:00', now, assignments: [{ scheduled_at: '2026-11-05T09:00:00' }] })
  assert.notEqual(past.reason, 'client')
  assert.equal(past.at.getDate(), 6, 'skips the busy Thursday')
  assert.equal(past.at.getHours(), 9)
  const sat = new Date('2026-11-07T08:00:00')
  assert.notEqual(suggestSchedule({ now: sat }).at.getDay(), 0, 'never a Sunday')
})

test('reviewDraft: compares price with history and template range', () => {
  const history = priceHistory([{ validated_price: 1_000_000 }, { validated_price: 1_200_000 }, { validated_price: 0 }])
  assert.deepEqual(history, { count: 2, avg: 1_100_000, min: 1_000_000, max: 1_200_000 })
  assert.equal(priceHistory([]), null)
  const high = reviewDraft({ offer: { price: 2_000_000 }, request: { phone: '0812' }, history, schedule: new Date() })
  assert.match(high.points[0].text, /di atas rata-rata/)
  const t = T.validateTemplate(T.DEFAULT_TEMPLATES[2])
  const out = reviewDraft({ offer: { price: 50 }, request: {}, template: t })
  assert.ok(out.points.some((p) => /di luar kisaran template/.test(p.text)))
  assert.ok(out.points.some((p) => /telepon/.test(p.text)))
  assert.ok(out.points.some((p) => /Jadwal/.test(p.text)))
  assert.match(out.summary, /perlu diperhatikan/)
})

test('offer document: escaped, numbered, totals and validity', () => {
  const html = offerDocumentHTML({ businessName: 'Bersih <Jaya>', request: { id: 42, customer_name: 'Hotel "A"', service_type: 'Laundry' }, offer: { scope: 'Cuci <b>linen</b>', price: 1_500_000, terms: 'DP 50%' }, date: new Date('2026-11-04T10:00:00') })
  assert.ok(html.includes('Bersih &lt;Jaya&gt;') && !html.includes('<b>linen</b>'))
  assert.ok(html.includes('Rp1.500.000'))
  assert.equal(offerNumber({ requestId: 42, date: new Date('2026-11-04T10:00:00') }), 'PNW-20261104-0042')
  assert.match(html, /Berlaku sampai 18 November 2026/)
})

test('simulator: request autofill and template-aware offers (demo/mock never call AI)', async () => {
  const run = async (messages, rf) => { let t = ''; for await (const c of simulateAnswer({ messages, response_format: rf })) t += c.choices[0]?.delta?.content || ''; return t }
  const fill = JSON.parse(await run([{ role: 'system', content: '[agent:request-autofill] x' }, { role: 'user', content: 'Pelanggan: PT A\nLokasi: Bekasi\nLayanan yang sudah ada: Servis AC kantor\nPetunjuk dari pemilik usaha:\nAC 3 unit bocor' }], { type: 'json_schema' }))
  assert.equal(fill.service_type, 'Servis AC kantor')
  assert.match(fill.description, /3 unit/)
  const offer = JSON.parse(await run([{ role: 'system', content: 'agen penawaran' }, { role: 'user', content: `Permintaan jasa:\n${JSON.stringify({ customer_name: 'PT A', service_type: 'Website' }, null, 2)}\n\nTemplate penawaran: Pengembangan website (Digital)\nKisaran harga wajar: Rp3.000.000 – Rp45.000.000\nKetentuan bawaan (pakai sebagai dasar "terms"): DP 50% saat mulai.` }]))
  assert.ok(offer.price >= 3_000_000 && offer.price <= 45_000_000, String(offer.price))
  assert.equal(offer.terms, 'DP 50% saat mulai.')
  assert.match(offer.scope, /Pengembangan website/)
})

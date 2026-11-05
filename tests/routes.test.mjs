import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAppRoute, formatAppRoute, isAppHash, sameRoute, APP_ROUTES, OFFICE_ROUTES, resolveStage } from '../src/ui/routes.js'

const CANONICAL = [
  '#/app',
  '#/app/alur-kerja',
  '#/app/alur-kerja?posisi=offer&q=pt%20maju',
  '#/app/alur-kerja/12',
  '#/app/permintaan/baru',
  '#/app/penawaran',
  '#/app/penawaran/baru?permintaan=12',
  '#/app/penawaran/34',
  '#/app/penugasan?penawaran=34',
  '#/app/penyelesaian?penugasan=5',
  '#/app/pembukuan?penyelesaian=7',
  '#/app/laporan',
  '#/app/invoice',
  '#/app/invoice/9',
  '#/app/invoice?penyelesaian=7',
  '#/app/layanan-tambahan',
  '#/app/tanpa-limbah',
  '#/app/radar',
  '#/app/prospek',
  '#/app/media-sosial',
  '#/app/penasihat',
  '#/app/ai-superpowers',
  '#/app/pertumbuhan',
  '#/app/paket',
  '#/app/paket?fokus=voucher',
  '#/app/bantuan',
  '#/app/bantuan?tiket=abc',
  '#/app/pengaturan',
  '#/app/kantor',
  '#/app/kantor/kontak',
  '#/app/kantor/sistem/email',
]

test('canonical routes round-trip through parse and format', () => {
  for (const hash of CANONICAL) {
    const r = parseAppRoute(hash)
    assert.ok(r, hash)
    assert.equal(formatAppRoute(r), hash, hash)
  }
})

test('every stage and office section formats to a route that parses back to it', () => {
  for (const { stage } of APP_ROUTES) {
    const r = parseAppRoute(formatAppRoute({ stage }))
    assert.equal(r.stage, stage === 'dashboard' ? null : stage, stage)
  }
  for (const key of Object.keys(OFFICE_ROUTES)) {
    const r = parseAppRoute(formatAppRoute({ stage: key, office: true }))
    assert.equal(r.office, true)
    assert.equal(r.stage, key)
  }
})

test('stage params map to path segments and query keys', () => {
  assert.equal(formatAppRoute({ stage: 'offer', params: { requestId: 12 } }), '#/app/penawaran/baru?permintaan=12')
  assert.equal(formatAppRoute({ stage: 'offer', params: { offerId: 34 } }), '#/app/penawaran/34')
  assert.equal(formatAppRoute({ stage: 'assign', params: { offerId: 34 } }), '#/app/penugasan?penawaran=34')
  assert.equal(formatAppRoute({ stage: 'complete', params: { assignmentId: 5 } }), '#/app/penyelesaian?penugasan=5')
  assert.equal(formatAppRoute({ stage: 'bookkeeping', params: { completionId: 7 } }), '#/app/pembukuan?penyelesaian=7')
  assert.equal(formatAppRoute({ stage: 'request' }), '#/app/permintaan/baru')
  assert.equal(formatAppRoute({ stage: 'dashboard' }), '#/app')
  assert.deepEqual(parseAppRoute('#/app/penawaran/34').params, { offerId: 34 })
  assert.deepEqual(parseAppRoute('#/app/penawaran/baru?permintaan=12'), { stage: 'offer', params: { requestId: 12 }, settings: false, office: false, bare: false, unknown: false })
  assert.deepEqual(parseAppRoute('#/app/alur-kerja/12?posisi=book').params, { id: 12, filter: 'book' })
})

test('free text is encoded and decoded; ids that are not numbers stay strings', () => {
  const hash = formatAppRoute({ stage: 'workflow', params: { q: 'PT Maju & Jaya?/#1' } })
  assert.ok(!hash.slice(2).includes('#') && !hash.includes(' '), hash)
  assert.equal(parseAppRoute(hash).params.q, 'PT Maju & Jaya?/#1')
  assert.equal(parseAppRoute('#/app/alur-kerja?q=007').params.q, '007')
  assert.equal(parseAppRoute('#/app/invoice/abc-9').params.invoiceId, 'abc-9')
  assert.equal(parseAppRoute('#/app/alur-kerja?q=pt+maju').params.q, 'pt maju')
})

test('request prefill travels as readable query keys', () => {
  const prefill = { customer_name: 'Ibu Sari', location: 'Depok', phone: '0812', service_type: 'Cuci AC', description: 'AC 2 unit' }
  const hash = formatAppRoute({ stage: 'request', params: { prefill } })
  assert.match(hash, /^#\/app\/permintaan\/baru\?nama=Ibu%20Sari&lokasi=Depok/)
  assert.deepEqual(parseAppRoute(hash).params, { prefill })
})

test('empty params and objects are left out of the URL', () => {
  assert.equal(formatAppRoute({ stage: 'workflow', params: { q: '', filter: null } }), '#/app/alur-kerja')
  assert.equal(formatAppRoute({ stage: 'offer', params: { requestId: undefined } }), '#/app/penawaran')
})

test('bare #/app, unknown routes and non-app hashes', () => {
  assert.deepEqual(parseAppRoute('#/app'), { stage: null, params: {}, settings: false, office: false, bare: true, unknown: false })
  assert.equal(parseAppRoute('#/app/').bare, true)
  const u = parseAppRoute('#/app/tidak-ada/1')
  assert.equal(u.stage, 'dashboard')
  assert.equal(u.unknown, true)
  assert.equal(parseAppRoute('#/app/laporan/3/4').unknown, true)
  assert.equal(parseAppRoute('#/app/kantor/tidak-ada').unknown, true)
  assert.equal(parseAppRoute('#/app/kantor/tidak-ada').office, true)
  assert.equal(parseAppRoute('#/'), null)
  assert.equal(parseAppRoute('#harga'), null)
  assert.equal(parseAppRoute('#/masuk?demo'), null)
  assert.equal(parseAppRoute('#/apps'), null)
  assert.equal(parseAppRoute(''), null)
  assert.equal(isAppHash('#/app?x=1'), true)
  assert.equal(isAppHash('#/application'), false)
  assert.equal(formatAppRoute({ stage: 'nope' }), '#/app')
})

test('aliases and sameRoute', () => {
  assert.equal(resolveStage('social'), 'social-media')
  assert.equal(formatAppRoute({ stage: 'social' }), '#/app/media-sosial')
  assert.ok(sameRoute({ stage: 'offer', params: { offerId: 3 } }, { stage: 'offer', params: { offerId: '3' } }))
  assert.ok(!sameRoute({ stage: 'offer', params: { offerId: 3 } }, { stage: 'offer', params: { offerId: 4 } }))
})

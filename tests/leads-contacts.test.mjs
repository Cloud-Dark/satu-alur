// "Cari dari peta": contact / hours / description parsing from OSM tags and the
// values the Permintaan form receives. Run: node --test tests/leads-contacts.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contactsFromTags, cleanEmail, cleanSocial, openingHoursText, cuisineText, describeBusiness, normalizeElement, resolveKeywords,
} from '../src/leads/osm.js'
import { pickedFields, otherContacts } from '../src/leads/pick.js'
import { demoSearch } from '../src/leads/demo.js'

const BEKASI = { lat: -6.2383, lon: 106.9756 }

test('contactsFromTags reads every contact tag and drops junk', () => {
  const c = contactsFromTags({
    phone: '021 555 1234', 'contact:mobile': '0813-1111-2222', 'contact:whatsapp': '+62 812 3456 7890',
    'contact:email': 'mailto:Info@Hotel.co.id; sales@hotel.co.id', 'contact:website': 'hotelbumi.id',
    'contact:instagram': 'https://www.instagram.com/hotelbumi/', 'contact:facebook': 'https://web.facebook.com/HotelBumi',
  })
  assert.deepEqual(c, {
    email: 'info@hotel.co.id', phone: '0215551234', mobile: '081311112222', whatsapp: '+6281234567890',
    website: 'https://hotelbumi.id/', instagram: '@hotelbumi', facebook: 'facebook.com/HotelBumi',
  })
  // Plain tags and fallbacks: phone falls back to contact:phone; mobile equal to phone is not repeated.
  assert.deepEqual(contactsFromTags({ 'contact:phone': '0811 222 333', mobile: '0811222333', email: 'a@b.id', instagram: '@kopi_kita' }),
    { email: 'a@b.id', phone: '0811222333', instagram: '@kopi_kita' })
  assert.deepEqual(contactsFromTags({}), {})
  assert.deepEqual(contactsFromTags({ email: 'not an email', website: 'javascript:alert(1)', 'contact:instagram': 'https://facebook.com/x', phone: 'call' }), {})
})

test('cleaners for email and social handles', () => {
  assert.equal(cleanEmail('A.B+tag@Example.CO.ID'), 'a.b+tag@example.co.id')
  assert.equal(cleanEmail('x@y'), '')
  assert.equal(cleanEmail(''), '')
  assert.equal(cleanSocial('kopi.kita', 'instagram'), '@kopi.kita')
  assert.equal(cleanSocial('instagram.com/kopi.kita?hl=id', 'instagram'), '@kopi.kita')
  assert.equal(cleanSocial('https://instagram.com/x', 'facebook'), '')
  assert.equal(cleanSocial('<script>', 'facebook'), '')
})

test('opening hours become readable Indonesian', () => {
  assert.equal(openingHoursText('Mo-Su 08:00-21:00'), 'setiap hari 08:00–21:00')
  assert.equal(openingHoursText('24/7'), '24 jam')
  assert.equal(openingHoursText('Mo-Fr 08:00-17:00; Sa 08:00-12:00; Su off'), 'Sen–Jum 08:00–17:00; Sab 08:00–12:00; Min tutup')
  assert.equal(openingHoursText('08:00-21:00'), '08:00–21:00')
  assert.equal(openingHoursText(''), '')
  assert.ok(openingHoursText('x'.repeat(200)).length <= 80)
})

test('describeBusiness builds a short description', () => {
  assert.equal(describeBusiness({ shop: 'laundry', opening_hours: '08:00-21:00' }), 'Laundry · buka 08:00–21:00')
  assert.equal(cuisineText('padang;seafood;regional;x_y'), 'Padang, seafood, daerah')
  assert.equal(describeBusiness({ amenity: 'restaurant', cuisine: 'padang', description: 'Rumah makan keluarga' }), 'Restoran · masakan Padang · Rumah makan keluarga')
  assert.equal(describeBusiness({ craft: 'carpenter' }), 'Usaha kerajinan (carpenter)')
  assert.equal(describeBusiness({ office: 'company' }), 'Kantor perusahaan')
  assert.equal(describeBusiness({}), '')
})

test('normalizeElement carries email, contacts, hours and description', () => {
  const lead = normalizeElement({
    type: 'node', id: 7, lat: -6.24, lon: 106.98,
    tags: { name: 'Laundry Bersih', shop: 'laundry', email: 'halo@bersih.id', 'contact:whatsapp': '0812 9999 0000', opening_hours: 'Mo-Su 08:00-21:00', 'addr:street': 'Jl. Melati' },
  }, BEKASI, resolveKeywords(['laundry']))
  assert.equal(lead.email, 'halo@bersih.id')
  assert.equal(lead.phone, '081299990000')
  assert.deepEqual(lead.contacts, { whatsapp: '081299990000' })
  assert.equal(lead.opening_hours, 'setiap hari 08:00–21:00')
  assert.equal(lead.description, 'Laundry · buka setiap hari 08:00–21:00')
})

test('pickedFields fills email, other contacts and description', () => {
  const f = pickedFields({
    name: 'Laundry Bersih', address: 'Jl. Melati', phone: '0812 9999 0000', email: 'Halo@Bersih.id', website: 'https://bersih.id/',
    contacts: { whatsapp: '081299990000', instagram: '@bersih' }, description: 'Laundry · buka 08:00–21:00', lat: 1, lon: 2,
  }, 'Bekasi')
  assert.equal(f.email, 'halo@bersih.id')
  assert.equal(f.website, 'bersih.id · WA 081299990000 · IG @bersih')
  assert.equal(f.description, 'Laundry · buka 08:00–21:00')
  assert.equal(pickedFields({ name: 'X', email: 'bad' }, '').email, '')
  assert.deepEqual(otherContacts({}), [])
})

test('demo search results include the new fields (stable sample)', () => {
  const a = demoSearch({ ...BEKASI, radiusKm: 5, keywords: ['hotel'] })
  const b = demoSearch({ ...BEKASI, radiusKm: 5, keywords: ['hotel'] })
  assert.deepEqual(a.results.map(({ fetched_at, ...r }) => r), b.results.map(({ fetched_at, ...r }) => r))
  assert.ok(a.results.some((r) => r.email))
  assert.ok(a.results.every((r) => typeof r.description === 'string' && r.description.length > 0))
})

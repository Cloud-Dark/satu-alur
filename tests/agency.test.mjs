import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import {
  validateCampaign, validateDeliverable, validatePayout, campaignProjection, campaignMoney,
  CAMPAIGN_STATUS_LABEL, DELIVERABLE_STATUS_LABEL,
} from '../src/agency/rules.js'

test('validateCampaign: title, status, real dates, end ≥ start, fee', () => {
  const ok = validateCampaign({ title: ' Promo ', start_date: '2026-11-01', end_date: '2026-11-30', client_fee_idr: '5000000' })
  assert.deepEqual(ok, { title: 'Promo', brief: '', status: 'draft', start_date: '2026-11-01', end_date: '2026-11-30', client_fee_idr: 5000000 })
  assert.equal(validateCampaign({ title: 'x', client_fee_idr: '' }).client_fee_idr, null)
  assert.equal(validateCampaign({ title: 'x', start_date: '' }).start_date, null)
  assert.throws(() => validateCampaign({ title: '' }), { message: 'Judul wajib diisi.' })
  assert.throws(() => validateCampaign({ title: 'x'.repeat(121) }), /Judul maksimal 120/)
  assert.throws(() => validateCampaign({ title: 'x', brief: 'x'.repeat(3001) }), /Brief maksimal 3000/)
  assert.throws(() => validateCampaign({ title: 'x', status: 'paused' }), /Status kampanye tidak dikenal/)
  assert.throws(() => validateCampaign({ title: 'x', start_date: '2026-02-30' }), /Tanggal mulai tidak valid/)
  assert.throws(() => validateCampaign({ title: 'x', start_date: '2026-11-10', end_date: '2026-11-09' }), { message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' })
  assert.throws(() => validateCampaign({ title: 'x', client_fee_idr: -1 }), /Biaya klien/)
  assert.throws(() => validateCampaign({ title: 'x', client_fee_idr: 1.5 }), /Biaya klien/)
})

test('validateDeliverable: kind, status, https link, published needs a link', () => {
  const d = validateDeliverable({ influencer_id: '3', kind: 'reel', due_date: '2026-11-05', link: ' https://instagram.com/p/x ', note: ' n ' })
  assert.deepEqual(d, { influencer_id: 3, kind: 'reel', due_date: '2026-11-05', status: 'planned', link: 'https://instagram.com/p/x', note: 'n' })
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'podcast' }), { message: 'Jenis konten tidak dikenal.' })
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', status: 'done' }), /Status konten tidak dikenal/)
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', link: 'http://x.id' }), { message: 'Tautan harus diawali https://.' })
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', link: 'javascript:alert(1)' }), /https:\/\//)
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', link: `https://${'x'.repeat(300)}` }), /Tautan maksimal 300/)
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', status: 'published' }), { message: 'Tambahkan tautan konten yang sudah tayang.' })
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', note: 'x'.repeat(501) }), /Catatan maksimal 500/)
  assert.throws(() => validateDeliverable({ kind: 'reel' }), /Pilih influencer/)
  assert.throws(() => validateDeliverable({ influencer_id: 3, kind: 'reel', due_date: '2026-13-01' }), /Tenggat tidak valid/)
  assert.equal(validateDeliverable({ influencer_id: 3, kind: 'reel', status: 'published', link: 'https://t.co/a' }).status, 'published')
})

test('validatePayout: optional non-negative integer', () => {
  assert.deepEqual(validatePayout({ influencer_id: 2, payout_idr: '750000' }), { influencer_id: 2, payout_idr: 750000 })
  assert.equal(validatePayout({ influencer_id: 2 }).payout_idr, null)
  assert.throws(() => validatePayout({ influencer_id: 2, payout_idr: -5 }), /Bayaran/)
})

test('labels match the binding copy', () => {
  assert.deepEqual(CAMPAIGN_STATUS_LABEL, { draft: 'Draf', active: 'Berjalan', completed: 'Selesai', cancelled: 'Dibatalkan' })
  assert.deepEqual(DELIVERABLE_STATUS_LABEL, { planned: 'Direncanakan', briefed: 'Brief terkirim', in_progress: 'Dikerjakan', submitted: 'Menunggu persetujuan', approved: 'Disetujui', published: 'Tayang' })
})

test('campaignProjection is an allow-list: pinned keys, no staff-only data', () => {
  const campaign = { id: 1, request_id: 2, owner_id: 'ua', title: 'T', brief: 'rahasia', status: 'active', start_date: '2026-11-01', end_date: null, client_fee_idr: 9000000, updated_by: 'budi' }
  const influencers = [{ influencer_id: 5, name: 'Aulia', niche: 'Kuliner', city: 'Jakarta', photo_key: null, payout_idr: 1500000, contact_phone: '0812', contact_email: 'a@b.id', rates_json: '[]', internal_notes: 'x', visible: 0 }]
  const deliverables = [
    { id: 9, influencer_id: 5, kind: 'reel', due_date: '2026-11-05', status: 'published', link: 'https://ig.com/p/1', note: 'internal', updated_by: 'budi' },
    { id: 10, influencer_id: 5, kind: 'story', due_date: null, status: 'submitted', link: 'https://draft.example/x', note: '' },
  ]
  const p = campaignProjection(campaign, influencers, deliverables)
  assert.deepEqual(Object.keys(p), ['title', 'status', 'start_date', 'end_date', 'influencers', 'deliverables'])
  assert.deepEqual(Object.keys(p.influencers[0]), ['name', 'niche', 'city', 'photo_key'])
  assert.deepEqual(Object.keys(p.deliverables[0]), ['influencer_name', 'kind', 'due_date', 'status', 'link'])
  assert.equal(p.deliverables[0].influencer_name, 'Aulia')
  assert.equal(p.deliverables[0].link, 'https://ig.com/p/1')
  assert.equal(p.deliverables[1].link, null, 'only a published deliverable shows its link')
  const json = JSON.stringify(p)
  for (const leak of ['9000000', '1500000', '0812', 'a@b.id', 'internal', 'rahasia', 'budi', 'ua']) assert.ok(!json.includes(leak), leak)
})

test('campaignMoney: margin = fee − payouts; null fee → null margin', () => {
  assert.deepEqual(campaignMoney({ client_fee_idr: 5000000 }, [{ payout_idr: 1000000 }, { payout_idr: null }, { payout_idr: 500000 }]), { fee: 5000000, payout: 1500000, margin: 3500000 })
  assert.deepEqual(campaignMoney({ client_fee_idr: null }, [{ payout_idr: 1 }]), { fee: null, payout: 1, margin: null })
})

// The demo (mock) client must enforce the same rules as the Worker.
test('agency client demo mode: rules, owner scoping, projection', async () => {
  const data = new Map()
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
  globalThis.localStorage = storage
  globalThis.sessionStorage = storage
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    define: { 'import.meta.env.VITE_USE_MOCK': JSON.stringify('true') } })
  try {
    const social = await server.ssrLoadModule('/src/social/api.js')
    const agency = await server.ssrLoadModule('/src/agency/api.js')
    const cloud = (await server.ssrLoadModule('/src/cloud.js')).getCloud()
    await cloud.auth.demoLogin({ email: 'demo@satualur.id' })
    const [aulia, bima] = await social.listInfluencers()
    await social.sendRequest({ kind: 'collab', influencer_id: aulia.id, payload: { campaign: 'Promo kedai', budget_range: 'Rp5 juta', timing: 'Desember' } })
    await social.sendRequest({ kind: 'ads', payload: { service: 'Servis AC' } })
    const mine = await social.listMyRequests()
    const collab = mine.find((r) => r.kind === 'collab')
    const ads = mine.find((r) => r.kind === 'ads')
    assert.equal(collab.has_campaign, false)

    await assert.rejects(agency.adminCreateCampaign({ request_id: ads.id, title: 'x' }), { message: 'Kampanye hanya untuk permintaan kolaborasi.' })
    await assert.rejects(agency.adminCreateCampaign({ request_id: 99999, title: 'x' }), { message: 'Permintaan tidak ditemukan.' })
    const { id } = await agency.adminCreateCampaign({ request_id: collab.id, title: 'Promo kedai', client_fee_idr: 5000000 })
    await assert.rejects(agency.adminCreateCampaign({ request_id: collab.id, title: 'lagi' }), { message: 'Permintaan ini sudah punya kampanye.' })
    assert.equal((await social.listMyRequests()).find((r) => r.id === collab.id).status, 'in_progress')
    assert.equal((await social.listMyRequests()).find((r) => r.id === collab.id).has_campaign, true)
    assert.equal((await social.adminListRequests()).find((r) => r.id === collab.id).campaign_id, id)

    let c = await agency.adminGetCampaign(id)
    assert.deepEqual(c.influencers.map((i) => i.influencer_id), [aulia.id], 'the requested influencer is pre-assigned')

    await social.adminSaveInfluencer({ id: bima.id, visible: 0 })
    await assert.rejects(agency.adminAssignInfluencer(id, { influencer_id: bima.id }), { message: 'Influencer ini tidak aktif.' })
    await agency.adminAssignInfluencer(id, { influencer_id: aulia.id, payout_idr: 1500000 })
    await social.adminSaveInfluencer({ id: aulia.id, visible: 0 })
    await agency.adminAssignInfluencer(id, { influencer_id: aulia.id, payout_idr: 1600000 })
    c = await agency.adminGetCampaign(id)
    assert.equal(c.influencers[0].payout_idr, 1600000, 'a hidden influencer already on the campaign stays and can be edited')

    await assert.rejects(agency.adminAddDeliverable(id, { influencer_id: bima.id, kind: 'reel' }), { message: 'Influencer ini belum ditugaskan di kampanye ini.' })
    const d1 = await agency.adminAddDeliverable(id, { influencer_id: aulia.id, kind: 'reel', due_date: '2026-11-05', note: 'catatan staf' })
    await assert.rejects(agency.adminUpdateDeliverable(d1.id, { status: 'published' }), { message: 'Tambahkan tautan konten yang sudah tayang.' })
    await agency.adminUpdateDeliverable(d1.id, { status: 'published', link: 'https://instagram.com/p/abc' })
    await assert.rejects(agency.adminRemoveInfluencer(id, aulia.id), { message: 'Hapus atau pindahkan konten influencer ini terlebih dahulu.' })

    const p = await agency.getRequestCampaign(collab.id)
    assert.deepEqual(Object.keys(p), ['title', 'status', 'start_date', 'end_date', 'influencers', 'deliverables'])
    assert.equal(p.deliverables[0].link, 'https://instagram.com/p/abc')
    assert.ok(!/1600000|5000000|catatan staf/.test(JSON.stringify(p)))

    // another business: A's request reads as missing, and A's request is not in B's list
    await cloud.auth.signOut()
    await cloud.auth.demoLogin({ email: 'demo-ac@satualur.id' })
    await assert.rejects(agency.getRequestCampaign(collab.id), { message: 'Kampanye tidak ditemukan.' })
    assert.equal((await social.listMyRequests()).length, 0)

    await agency.adminDeleteDeliverable(d1.id)
    await agency.adminRemoveInfluencer(id, aulia.id)
    assert.equal((await agency.adminGetCampaign(id)).influencers.length, 0)
    const list = await agency.adminListCampaigns({ status: 'draft' })
    assert.equal(list.total, 1)
    await agency.adminUpdateCampaign(id, { status: 'active' })
    assert.equal((await agency.adminListCampaigns({ status: 'draft' })).total, 0)
  } finally {
    await server.close()
  }
})

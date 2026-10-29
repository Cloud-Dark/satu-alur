// Publish runner. Run: node --test tests/social-runner.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishRow, runDue, sweepStuck } from '../src/social/runner.js'

const NOW = Date.parse('2026-10-29T10:00:00.000Z')
const MISMATCH = 'Akun Facebook berubah atau terputus, jadwalkan ulang'
const ACCOUNT = { page_id: 'PAGE', pageToken: 'TOKEN', ig_user_id: 'IG' }

// In-memory store with the same guards as the D1 SQL: claim only from 'scheduled', marks only from 'publishing'.
function memStore(rows) {
  const flagged = []
  const byId = (id) => rows.find((r) => r.id === id)
  const fromPublishing = (id, patch) => {
    const r = byId(id)
    if (r && r.status === 'publishing') Object.assign(r, patch(r))
  }
  return {
    rows,
    flagged,
    async listDue(nowIso, limit) {
      return rows.filter((r) => r.status === 'scheduled' && r.scheduled_at <= nowIso).slice(0, limit).map((r) => ({ ...r }))
    },
    async claim(id, nowIso) {
      const r = byId(id)
      if (!r || r.status !== 'scheduled') return false
      r.status = 'publishing'
      r.claimed_at = nowIso
      return true
    },
    async markPosted(id, v) { fromPublishing(id, () => ({ status: 'posted', error: null, ...v })) },
    async requeue(id, error) { fromPublishing(id, (r) => ({ status: 'scheduled', attempts: r.attempts + 1, error })) },
    async markFailed(id, error) { fromPublishing(id, () => ({ status: 'failed', error })) },
    async flagReconnect(ownerId) { flagged.push(ownerId) },
    async listStuck(beforeIso) {
      return rows.filter((r) => r.status === 'publishing' && r.claimed_at < beforeIso).map((r) => ({ ...r }))
    },
  }
}

function row(over = {}) {
  return {
    id: 1, owner_id: 'u1', platform: 'facebook', content: 'Halo', image_key: null, page_id: 'PAGE',
    scheduled_at: '2026-10-29T09:59:00.000Z', status: 'scheduled', attempts: 0, claimed_at: null, ...over,
  }
}

function stubFetch(replies) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' })
    const r = replies.length ? replies.shift() : { json: {} }
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.json }
  }
  fn.calls = calls
  fn.posts = () => calls.filter((c) => c.method === 'POST').length
  return fn
}

function deps(store, fetchFn, account = ACCOUNT) {
  return {
    store,
    getAccount: async () => account,
    mediaUrl: (key) => `https://app.example/api/media/${key}`,
    fetchFn,
    now: () => NOW,
  }
}

test('happy Facebook post is marked posted with permalink', async () => {
  const store = memStore([row()])
  const f = stubFetch([{ json: { id: 'POST_1' } }, { json: { permalink_url: 'https://facebook.com/p/1' } }])
  assert.equal(await publishRow(store.rows[0], deps(store, f)), 'posted')
  const r = store.rows[0]
  assert.equal(r.status, 'posted')
  assert.equal(r.platform_post_id, 'POST_1')
  assert.equal(r.permalink, 'https://facebook.com/p/1')
  assert.equal(r.published_at, new Date(NOW).toISOString())
})

test('Instagram post uses the media URL of the image key', async () => {
  const store = memStore([row({ platform: 'instagram', image_key: 'abc' })])
  const f = stubFetch([{ json: { id: 'C' } }, { json: { id: 'M' } }, { json: { permalink: 'https://instagram.com/p/M' } }])
  assert.equal(await publishRow(store.rows[0], deps(store, f)), 'posted')
  assert.match(f.calls[0].url, /\/IG\/media$/)
  assert.equal(store.rows[0].permalink, 'https://instagram.com/p/M')
})

test('page mismatch fails without calling Meta', async () => {
  const store = memStore([row({ page_id: 'OTHER' })])
  const f = stubFetch([])
  assert.equal(await publishRow(store.rows[0], deps(store, f)), 'failed')
  assert.equal(store.rows[0].error, MISMATCH)
  assert.equal(f.calls.length, 0)
})

test('no account fails without calling Meta', async () => {
  const store = memStore([row()])
  const f = stubFetch([])
  assert.equal(await publishRow(store.rows[0], deps(store, f, null)), 'failed')
  assert.equal(store.rows[0].status, 'failed')
  assert.equal(store.rows[0].error, MISMATCH)
  assert.equal(f.calls.length, 0)
})

test('transient error requeues until the third attempt', async () => {
  const store = memStore([row({ attempts: 0 }), row({ id: 2, attempts: 2 })])
  const busy = () => ({ status: 500, json: { error: { message: 'busy', code: 2 } } })
  assert.equal(await publishRow(store.rows[0], deps(store, stubFetch([busy()]))), 'requeued')
  assert.equal(store.rows[0].status, 'scheduled')
  assert.equal(store.rows[0].attempts, 1)
  assert.equal(await publishRow(store.rows[1], deps(store, stubFetch([busy()]))), 'failed')
  assert.equal(store.rows[1].status, 'failed')
  assert.equal(store.rows[1].error, 'busy')
})

test('token error (190) fails and flags reconnect', async () => {
  const store = memStore([row()])
  const f = stubFetch([{ status: 400, json: { error: { message: 'Token kedaluwarsa', code: 190 } } }])
  assert.equal(await publishRow(store.rows[0], deps(store, f)), 'failed')
  assert.equal(store.rows[0].error, 'Token kedaluwarsa')
  assert.deepEqual(store.flagged, ['u1'])
})

test('unexpected exception fails with a generic message', async () => {
  const store = memStore([row()])
  const d = { ...deps(store, stubFetch([])), getAccount: async () => { throw new TypeError('secret detail') } }
  const orig = console.error
  console.error = () => {}
  try {
    assert.equal(await publishRow(store.rows[0], d), 'failed')
  } finally {
    console.error = orig
  }
  assert.equal(store.rows[0].error, 'Gagal memposting ke Meta.')
})

test('two concurrent runDue calls post a due row exactly once', async () => {
  const store = memStore([row()])
  const f = stubFetch([{ json: { id: 'POST_1' } }, { json: { permalink_url: 'u' } }])
  const [a, b] = await Promise.all([runDue(deps(store, f)), runDue(deps(store, f))])
  assert.equal(f.posts(), 1)
  assert.equal(a.posted + b.posted, 1)
  assert.equal(store.rows[0].status, 'posted')
})

test('runDue ignores rows not yet due', async () => {
  const store = memStore([row({ scheduled_at: '2026-10-29T11:00:00.000Z' })])
  const f = stubFetch([])
  assert.deepEqual(await runDue(deps(store, f)), { posted: 0, failed: 0, requeued: 0 })
  assert.equal(f.calls.length, 0)
})

test('sweepStuck fails rows publishing for over 15 minutes only', async () => {
  const at = (min) => new Date(NOW - min * 60 * 1000).toISOString()
  const store = memStore([
    row({ id: 1, status: 'publishing', claimed_at: at(16) }),
    row({ id: 2, status: 'publishing', claimed_at: at(5) }),
  ])
  assert.equal(await sweepStuck(deps(store, stubFetch([]))), 1)
  assert.equal(store.rows[0].status, 'failed')
  assert.equal(store.rows[0].error, 'Status tidak pasti, periksa halaman Anda')
  assert.equal(store.rows[1].status, 'publishing')
})

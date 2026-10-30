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
    async flagReconnect(ownerId, platform) { flagged.push(`${ownerId}:${platform}`) },
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
  const f = stubFetch([{ json: { id: 'C' } }, { json: { status_code: 'FINISHED' } }, { json: { id: 'M' } }, { json: { permalink: 'https://instagram.com/p/M' } }])
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

test('ambiguous error on the final publish call fails and is never requeued', async () => {
  const store = memStore([row({ attempts: 0 })])
  let requeued = 0
  const requeue = store.requeue
  store.requeue = async (...a) => { requeued++; return requeue(...a) }
  const f = stubFetch([{ status: 503, json: { error: { message: 'timeout', code: 2 } } }])
  assert.equal(await publishRow(store.rows[0], deps(store, f)), 'failed')
  assert.equal(store.rows[0].status, 'failed')
  assert.equal(store.rows[0].error, 'Status tidak pasti, periksa halaman Anda')
  assert.equal(requeued, 0)
})

test('a store error on one row does not stop runDue', async () => {
  const store = memStore([row({ id: 1 }), row({ id: 2 })])
  const claim = store.claim
  store.claim = async (id, iso) => { if (id === 1) throw new Error('D1 down'); return claim(id, iso) }
  const f = stubFetch([{ json: { id: 'P' } }, { json: { permalink_url: 'u' } }])
  const orig = console.error
  console.error = () => {}
  try {
    assert.equal((await runDue(deps(store, f))).posted, 1)
  } finally {
    console.error = orig
  }
  assert.equal(store.rows[1].status, 'posted')
})

test('transient (rate limit) error requeues until the third attempt', async () => {
  const store = memStore([row({ attempts: 0 }), row({ id: 2, attempts: 2 })])
  const busy = () => ({ status: 400, json: { error: { message: 'busy', code: 4 } } })
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
  assert.deepEqual(store.flagged, ['u1:facebook'])
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

test('publish-now (requeue: false) fails a transient error instead of requeueing', async () => {
  const store = memStore([row({ attempts: 0 })])
  const f = stubFetch([{ status: 400, json: { error: { message: 'busy', code: 4 } } }])
  assert.equal(await publishRow(store.rows[0], { ...deps(store, f), requeue: false }), 'failed')
  assert.equal(store.rows[0].status, 'failed')
  assert.equal(store.rows[0].error, 'busy')
  assert.equal(store.rows[0].attempts, 0)
})

test('a 2xx without an id is still marked posted', async () => {
  const store = memStore([row()])
  const f = stubFetch([{ json: {} }, { json: {} }])
  assert.equal(await publishRow(store.rows[0], deps(store, f)), 'posted')
  assert.equal(store.rows[0].status, 'posted')
  assert.equal(store.rows[0].platform_post_id, null)
  assert.equal(store.rows[0].permalink, null)
})

// ------------------------------------------------------------------ Threads
const TH_MISMATCH = 'Akun Threads berubah atau terputus, jadwalkan ulang'
const TH_ACCOUNT = { page_id: null, pageToken: null, ig_user_id: null, threads_user_id: 'TU', threadsToken: 'TT' }
const thRow = (over = {}) => row({ platform: 'threads', page_id: 'TU', ...over })

test('Threads post goes to the Threads account and is marked posted', async () => {
  const store = memStore([thRow()])
  const f = stubFetch([{ json: { id: 'C' } }, { json: { status: 'FINISHED' } }, { json: { id: 'T1' } }, { json: { permalink: 'https://www.threads.net/@k/post/1' } }])
  assert.equal(await publishRow(store.rows[0], { ...deps(store, f, TH_ACCOUNT), wait: async () => {} }), 'posted')
  assert.equal(f.calls[0].url, 'https://graph.threads.net/v1.0/TU/threads')
  assert.equal(store.rows[0].platform_post_id, 'T1')
  assert.equal(store.rows[0].permalink, 'https://www.threads.net/@k/post/1')
})

test('Threads: mismatched threads_user_id fails with the Threads message without calling Meta', async () => {
  for (const account of [{ ...TH_ACCOUNT, threads_user_id: 'OTHER' }, { ...ACCOUNT, threads_user_id: null }, null]) {
    const store = memStore([thRow()])
    const f = stubFetch([])
    assert.equal(await publishRow(store.rows[0], deps(store, f, account)), 'failed')
    assert.equal(store.rows[0].error, TH_MISMATCH)
    assert.equal(f.calls.length, 0)
  }
})

test('Facebook row on a Threads-only account fails with the Facebook message', async () => {
  for (const r of [row(), row({ page_id: null })]) {
    const store = memStore([r])
    const f = stubFetch([])
    assert.equal(await publishRow(store.rows[0], deps(store, f, TH_ACCOUNT)), 'failed')
    assert.equal(store.rows[0].error, MISMATCH)
    assert.equal(f.calls.length, 0)
  }
})

test('Threads: ambiguous final publish fails as uncertain and is never requeued', async () => {
  const store = memStore([thRow()])
  const f = stubFetch([{ json: { id: 'C' } }, { json: { status: 'FINISHED' } }, { status: 503, json: { error: { message: 'timeout', code: 2 } } }])
  assert.equal(await publishRow(store.rows[0], { ...deps(store, f, TH_ACCOUNT), wait: async () => {} }), 'failed')
  assert.equal(store.rows[0].error, 'Status tidak pasti, periksa halaman Anda')
  assert.equal(store.rows[0].attempts, 0)
})

test('Threads: token error flags the Threads connection, not Facebook', async () => {
  const store = memStore([thRow()])
  const f = stubFetch([{ status: 400, json: { error: { message: 'Token kedaluwarsa', code: 190 } } }])
  assert.equal(await publishRow(store.rows[0], deps(store, f, TH_ACCOUNT)), 'failed')
  assert.deepEqual(store.flagged, ['u1:threads'])
})

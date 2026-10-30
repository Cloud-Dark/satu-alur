// Meta Graph client. Run: node --test tests/social-meta.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oauthUrl, parsePages, postFacebook, postInstagram, classifyMetaError, MetaError, exchangeCode, listPages } from '../src/social/meta.js'

const SCOPE = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management'

function stub(replies) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? new URLSearchParams(init.body) : null })
    const r = replies.shift()
    if (r instanceof Error) throw r
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.json }
  }
  fn.calls = calls
  return fn
}

test('postFacebook text-only posts to feed then fetches permalink', async () => {
  const f = stub([{ json: { id: 'PAGE_1' } }, { json: { permalink_url: 'https://facebook.com/p/1' } }])
  const r = await postFacebook({ pageId: 'PAGE', pageToken: 'T', message: 'hi' }, f)
  assert.deepEqual(r, { id: 'PAGE_1', permalink: 'https://facebook.com/p/1' })
  assert.equal(f.calls.length, 2)
  assert.match(f.calls[0].url, /\/PAGE\/feed$/)
  assert.equal(f.calls[0].method, 'POST')
  assert.equal(f.calls[0].body.get('message'), 'hi')
  assert.equal(f.calls[0].body.get('access_token'), 'T')
  assert.match(f.calls[1].url, /\/PAGE_1\?.*fields=permalink_url/)
})

test('postFacebook with image uses photos', async () => {
  const f = stub([{ json: { id: 'P2' } }, { json: { permalink_url: 'u' } }])
  await postFacebook({ pageId: 'PAGE', pageToken: 'T', message: 'hi', imageUrl: 'https://x/i.jpg' }, f)
  assert.match(f.calls[0].url, /\/PAGE\/photos$/)
  assert.equal(f.calls[0].body.get('url'), 'https://x/i.jpg')
  assert.equal(f.calls[0].body.get('caption'), 'hi')
})

test('postInstagram creates container, publishes, fetches permalink', async () => {
  const f = stub([{ json: { id: 'C1' } }, { json: { status_code: 'FINISHED' } }, { json: { id: 'M1' } }, { json: { permalink: 'https://instagram.com/p/1' } }])
  const r = await postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'cap', imageUrl: 'https://x/i.jpg' }, f)
  assert.deepEqual(r, { id: 'M1', permalink: 'https://instagram.com/p/1' })
  assert.match(f.calls[0].url, /\/IG\/media$/)
  assert.equal(f.calls[0].body.get('image_url'), 'https://x/i.jpg')
  assert.equal(f.calls[0].body.get('caption'), 'cap')
  assert.match(f.calls[1].url, /\/C1\?.*fields=status_code/)
  assert.match(f.calls[2].url, /\/IG\/media_publish$/)
  assert.equal(f.calls[2].body.get('creation_id'), 'C1')
  assert.match(f.calls[3].url, /\/M1\?.*fields=permalink/)
})

test('Graph error 190 rejects with token MetaError', async () => {
  const f = stub([{ status: 400, json: { error: { code: 190, message: 'expired' } } }])
  await assert.rejects(postFacebook({ pageId: 'P', pageToken: 'T', message: 'x' }, f), (e) => {
    assert.ok(e instanceof MetaError)
    assert.equal(e.kind, 'token')
    assert.equal(e.message, 'expired')
    assert.equal(e.code, 190)
    return true
  })
})

test('network failure is transient; missing message falls back to HTTP status', async () => {
  await assert.rejects(postFacebook({ pageId: 'P', pageToken: 'T', message: 'x' }, stub([new Error('boom')])), (e) => e instanceof MetaError && e.kind === 'transient')
  await assert.rejects(postFacebook({ pageId: 'P', pageToken: 'T', message: 'x' }, stub([{ status: 502, json: {} }])), (e) => e.kind === 'transient' && e.message === 'Meta API error (HTTP 502)')
})

test('classifyMetaError', () => {
  assert.equal(classifyMetaError(500, {}), 'transient')
  assert.equal(classifyMetaError(400, { error: { code: 4 } }), 'transient')
  assert.equal(classifyMetaError(400, { error: { code: 100 } }), 'fatal')
  assert.equal(classifyMetaError(400, { error: { code: 102 } }), 'token')
  assert.equal(classifyMetaError(400, { error: { code: 1, is_transient: true } }), 'transient')
})

test('parsePages', () => {
  assert.deepEqual(parsePages({ data: [{ id: '1', name: 'A', access_token: 't' }] }), [{ id: '1', name: 'A', token: 't', igUserId: null, igUsername: null }])
  assert.deepEqual(parsePages({ data: [{ id: '1', name: 'A', access_token: 't', instagram_business_account: { id: 'i', username: 'u' } }] })[0].igUsername, 'u')
})

test('oauthUrl', () => {
  const u = oauthUrl({ appId: 'APP', redirectUri: 'https://a.b/cb?x=1', state: 'S' })
  assert.ok(u.startsWith('https://www.facebook.com/v21.0/dialog/oauth?'))
  assert.match(u, /client_id=APP/)
  assert.ok(u.includes('redirect_uri=' + encodeURIComponent('https://a.b/cb?x=1')))
  assert.match(u, /state=S/)
  assert.equal(new URL(u).searchParams.get('scope'), SCOPE)
})

test('exchangeCode does code then long-lived exchange', async () => {
  const f = stub([{ json: { access_token: 'short' } }, { json: { access_token: 'long' } }])
  assert.equal(await exchangeCode({ appId: 'A', appSecret: 'S', redirectUri: 'R', code: 'C' }, f), 'long')
  assert.equal(new URL(f.calls[0].url).searchParams.get('code'), 'C')
  assert.equal(new URL(f.calls[1].url).searchParams.get('fb_exchange_token'), 'short')
  assert.equal(new URL(f.calls[1].url).searchParams.get('grant_type'), 'fb_exchange_token')
})

test('postFacebook: permalink lookup failure still resolves with null permalink', async () => {
  const f = stub([{ json: { id: 'PAGE_1' } }, { status: 500, json: {} }])
  assert.deepEqual(await postFacebook({ pageId: 'PAGE', pageToken: 'T', message: 'hi' }, f), { id: 'PAGE_1', permalink: null })
})

test('postInstagram: permalink fetch rejection still resolves with null permalink', async () => {
  const f = stub([{ json: { id: 'C1' } }, { json: { status_code: 'FINISHED' } }, { json: { id: 'M1' } }, new Error('boom')])
  assert.deepEqual(await postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u' }, f), { id: 'M1', permalink: null })
})

test('listPages parses /me/accounts', async () => {
  const f = stub([{ json: { data: [{ id: '1', name: 'A', access_token: 't' }] } }])
  const pages = await listPages('UT', f)
  assert.equal(pages[0].token, 't')
  assert.match(f.calls[0].url, /\/me\/accounts\?/)
  assert.equal(new URL(f.calls[0].url).searchParams.get('access_token'), 'UT')
})

test('5xx on the final publish call is ambiguous (the post may be live)', async () => {
  const f = stub([{ status: 500, json: { error: { message: 'boom', code: 2 } } }])
  await assert.rejects(postFacebook({ pageId: 'PAGE', pageToken: 'T', message: 'hi' }, f),
    (e) => e instanceof MetaError && e.kind === 'transient' && e.ambiguous === true)
})

test('a network failure on media_publish is ambiguous', async () => {
  const f = stub([{ json: { id: 'C' } }, { json: { status_code: 'FINISHED' } }, new Error('reset')])
  await assert.rejects(postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u' }, f),
    (e) => e.kind === 'transient' && e.ambiguous === true)
})

test('5xx on the IG container step is not ambiguous', async () => {
  const f = stub([{ status: 500, json: { error: { message: 'boom', code: 2 } } }])
  await assert.rejects(postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u' }, f),
    (e) => e.kind === 'transient' && !e.ambiguous)
})

test('rate limit (code 4) on the final publish call is not ambiguous', async () => {
  const f = stub([{ status: 400, json: { error: { message: 'limit', code: 4 } } }])
  await assert.rejects(postFacebook({ pageId: 'PAGE', pageToken: 'T', message: 'hi' }, f),
    (e) => e.kind === 'transient' && !e.ambiguous)
})

test('postInstagram polls the container until FINISHED before publishing', async () => {
  const waits = []
  const wait = async (ms) => { waits.push(ms) }
  const f = stub([{ json: { id: 'C1' } }, { json: { status_code: 'IN_PROGRESS' } }, { json: { status_code: 'FINISHED' } },
    { json: { id: 'M1' } }, { json: { permalink: 'p' } }])
  assert.deepEqual(await postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u', wait }, f), { id: 'M1', permalink: 'p' })
  assert.deepEqual(waits, [1500])
  assert.match(f.calls[3].url, /\/IG\/media_publish$/)
})

test('postInstagram: container ERROR is fatal and never publishes', async () => {
  const f = stub([{ json: { id: 'C1' } }, { json: { status_code: 'ERROR' } }])
  await assert.rejects(postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u', wait: async () => {} }, f),
    (e) => e instanceof MetaError && e.kind === 'fatal' && e.message === 'Instagram menolak gambar ini.')
  assert.equal(f.calls.length, 2)
})

test('postInstagram: still IN_PROGRESS after 5 polls is transient, not ambiguous', async () => {
  const f = stub([{ json: { id: 'C1' } }, ...Array.from({ length: 5 }, () => ({ json: { status_code: 'IN_PROGRESS' } }))])
  await assert.rejects(postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u', wait: async () => {} }, f),
    (e) => e.kind === 'transient' && !e.ambiguous)
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1)
})

// ------------------------------------------------------------------ Threads
const M = await import('../src/social/meta.js')
const TH = 'https://graph.threads.net'

test('threadsOauthUrl uses threads.net with the Threads scopes', () => {
  const u = new URL(M.threadsOauthUrl({ appId: 'TA', redirectUri: 'https://a.b/api/social/threads/callback', state: 'S' }))
  assert.equal(`${u.origin}${u.pathname}`, 'https://threads.net/oauth/authorize')
  assert.equal(u.searchParams.get('client_id'), 'TA')
  assert.equal(u.searchParams.get('redirect_uri'), 'https://a.b/api/social/threads/callback')
  assert.equal(u.searchParams.get('scope'), 'threads_basic,threads_content_publish')
  assert.equal(u.searchParams.get('response_type'), 'code')
  assert.equal(u.searchParams.get('state'), 'S')
})

test('exchangeThreadsCode posts the code, then swaps for a long-lived token', async () => {
  const f = stub([{ json: { access_token: 'short', user_id: 42 } }, { json: { access_token: 'long', expires_in: 5184000 } }])
  assert.deepEqual(await M.exchangeThreadsCode({ appId: 'TA', appSecret: 'TS', redirectUri: 'R', code: 'C' }, f), { token: 'long', expiresIn: 5184000 })
  assert.equal(f.calls[0].url, `${TH}/oauth/access_token`)
  assert.equal(f.calls[0].method, 'POST')
  assert.deepEqual(Object.fromEntries(f.calls[0].body), { client_id: 'TA', client_secret: 'TS', grant_type: 'authorization_code', redirect_uri: 'R', code: 'C' })
  const u = new URL(f.calls[1].url)
  assert.equal(`${u.origin}${u.pathname}`, `${TH}/access_token`)
  assert.equal(f.calls[1].method, 'GET')
  assert.equal(u.searchParams.get('grant_type'), 'th_exchange_token')
  assert.equal(u.searchParams.get('client_secret'), 'TS')
  assert.equal(u.searchParams.get('access_token'), 'short')
})

test('threadsProfile reads id and username', async () => {
  const f = stub([{ json: { id: 'TU', username: 'kedai' } }])
  assert.deepEqual(await M.threadsProfile('LT', f), { id: 'TU', username: 'kedai' })
  const u = new URL(f.calls[0].url)
  assert.equal(`${u.origin}${u.pathname}`, `${TH}/v1.0/me`)
  assert.equal(u.searchParams.get('fields'), 'id,username')
  assert.equal(u.searchParams.get('access_token'), 'LT')
})

test('refreshThreadsToken uses th_refresh_token', async () => {
  const f = stub([{ json: { access_token: 'new', expires_in: 5184000 } }])
  assert.deepEqual(await M.refreshThreadsToken('old', f), { token: 'new', expiresIn: 5184000 })
  const u = new URL(f.calls[0].url)
  assert.equal(`${u.origin}${u.pathname}`, `${TH}/refresh_access_token`)
  assert.equal(u.searchParams.get('grant_type'), 'th_refresh_token')
  assert.equal(u.searchParams.get('access_token'), 'old')
})

test('refreshThreadsToken: code 190 is a token error', async () => {
  const f = stub([{ status: 400, json: { error: { message: 'expired', code: 190 } } }])
  await assert.rejects(M.refreshThreadsToken('old', f), (e) => e instanceof MetaError && e.kind === 'token')
})

test('postThreads text-only: container, status, publish, permalink', async () => {
  const f = stub([{ json: { id: 'C1' } }, { json: { status: 'FINISHED' } }, { json: { id: 'T1' } }, { json: { permalink: 'https://www.threads.net/@k/post/1' } }])
  const r = await M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'halo', wait: async () => {} }, f)
  assert.deepEqual(r, { id: 'T1', permalink: 'https://www.threads.net/@k/post/1' })
  assert.equal(f.calls[0].url, `${TH}/v1.0/TU/threads`)
  assert.equal(f.calls[0].method, 'POST')
  assert.equal(f.calls[0].body.get('media_type'), 'TEXT')
  assert.equal(f.calls[0].body.get('text'), 'halo')
  assert.equal(f.calls[0].body.get('image_url'), null)
  assert.equal(f.calls[0].body.get('access_token'), 'TT')
  assert.match(f.calls[1].url, /^https:\/\/graph\.threads\.net\/v1\.0\/C1\?.*fields=status/)
  assert.equal(f.calls[2].url, `${TH}/v1.0/TU/threads_publish`)
  assert.equal(f.calls[2].body.get('creation_id'), 'C1')
  assert.match(f.calls[3].url, /^https:\/\/graph\.threads\.net\/v1\.0\/T1\?.*fields=permalink/)
})

test('postThreads with an image uses IMAGE and image_url', async () => {
  const f = stub([{ json: { id: 'C1' } }, { json: { status: 'FINISHED' } }, { json: { id: 'T1' } }, { json: { permalink: 'p' } }])
  await M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'halo', imageUrl: 'https://x/i.jpg', wait: async () => {} }, f)
  assert.equal(f.calls[0].body.get('media_type'), 'IMAGE')
  assert.equal(f.calls[0].body.get('image_url'), 'https://x/i.jpg')
})

test('postThreads polls until FINISHED', async () => {
  const waits = []
  const f = stub([{ json: { id: 'C1' } }, { json: { status: 'IN_PROGRESS' } }, { json: { status: 'FINISHED' } }, { json: { id: 'T1' } }, { json: { permalink: 'p' } }])
  await M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'x', wait: async (ms) => { waits.push(ms) } }, f)
  assert.deepEqual(waits, [1500])
  assert.equal(f.calls[3].url, `${TH}/v1.0/TU/threads_publish`)
})

test('postThreads: container ERROR or EXPIRED is fatal and never publishes', async () => {
  for (const status of ['ERROR', 'EXPIRED']) {
    const f = stub([{ json: { id: 'C1' } }, { json: { status } }])
    await assert.rejects(M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'x', wait: async () => {} }, f),
      (e) => e instanceof MetaError && e.kind === 'fatal' && e.message === 'Threads menolak konten ini.')
    assert.equal(f.calls.length, 2)
  }
})

test('postThreads: still in progress after 5 polls is transient, not ambiguous', async () => {
  const f = stub([{ json: { id: 'C1' } }, ...Array.from({ length: 5 }, () => ({ json: { status: 'IN_PROGRESS' } }))])
  await assert.rejects(M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'x', wait: async () => {} }, f),
    (e) => e.kind === 'transient' && !e.ambiguous)
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1)
})

test('postThreads: 5xx or network failure on threads_publish is ambiguous', async () => {
  for (const fail of [{ status: 500, json: { error: { message: 'boom', code: 2 } } }, new Error('reset')]) {
    const f = stub([{ json: { id: 'C1' } }, { json: { status: 'FINISHED' } }, fail])
    await assert.rejects(M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'x', wait: async () => {} }, f),
      (e) => e.kind === 'transient' && e.ambiguous === true)
  }
})

test('postThreads: 5xx creating the container is not ambiguous', async () => {
  const f = stub([{ status: 500, json: { error: { message: 'boom', code: 2 } } }])
  await assert.rejects(M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'x', wait: async () => {} }, f),
    (e) => e.kind === 'transient' && !e.ambiguous)
})

test('postThreads: permalink failure still resolves with null permalink', async () => {
  const f = stub([{ json: { id: 'C1' } }, { json: { status: 'FINISHED' } }, { json: { id: 'T1' } }, new Error('boom')])
  assert.deepEqual(await M.postThreads({ threadsUserId: 'TU', token: 'TT', text: 'x', wait: async () => {} }, f), { id: 'T1', permalink: null })
})

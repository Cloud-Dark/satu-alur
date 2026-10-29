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
  const f = stub([{ json: { id: 'C1' } }, { json: { id: 'M1' } }, { json: { permalink: 'https://instagram.com/p/1' } }])
  const r = await postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'cap', imageUrl: 'https://x/i.jpg' }, f)
  assert.deepEqual(r, { id: 'M1', permalink: 'https://instagram.com/p/1' })
  assert.match(f.calls[0].url, /\/IG\/media$/)
  assert.equal(f.calls[0].body.get('image_url'), 'https://x/i.jpg')
  assert.equal(f.calls[0].body.get('caption'), 'cap')
  assert.match(f.calls[1].url, /\/IG\/media_publish$/)
  assert.equal(f.calls[1].body.get('creation_id'), 'C1')
  assert.match(f.calls[2].url, /\/M1\?.*fields=permalink/)
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
  const f = stub([{ json: { id: 'C1' } }, { json: { id: 'M1' } }, new Error('boom')])
  assert.deepEqual(await postInstagram({ igUserId: 'IG', pageToken: 'T', caption: 'c', imageUrl: 'u' }, f), { id: 'M1', permalink: null })
})

test('listPages parses /me/accounts', async () => {
  const f = stub([{ json: { data: [{ id: '1', name: 'A', access_token: 't' }] } }])
  const pages = await listPages('UT', f)
  assert.equal(pages[0].token, 't')
  assert.match(f.calls[0].url, /\/me\/accounts\?/)
  assert.equal(new URL(f.calls[0].url).searchParams.get('access_token'), 'UT')
})

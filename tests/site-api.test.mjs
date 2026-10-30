import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

const data = new Map([['satualur_use_mock', '0']])
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }

test('real mode: admin read bypasses the HTTP cache; save refreshes the public copy', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', cache: init.cache })
    return new Response(JSON.stringify({ data: { value: { title: 'x', body: 'y' }, updated_at: 't', updated_by: 'staff' } }), { status: 200 })
  }
  try {
    const { loadSite, saveSite } = await server.ssrLoadModule('/src/site/api.js')
    await loadSite('about')
    assert.equal(calls[0].cache, 'no-store')
    await saveSite('about', { title: 'x', body: 'y' })
    const reload = calls.find((c) => c.method === 'GET' && c.cache === 'reload')
    assert.ok(reload && reload.url === '/api/site/about', 'public copy refreshed after PUT')
  } finally {
    globalThis.fetch = realFetch
    await server.close()
  }
})

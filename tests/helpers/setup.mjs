/**
 * Shared setup for the node:test unit tests.
 *
 * - Registers module hooks that turn browser-only asset imports (`*.css`)
 *   into empty modules, so modules such as src/ai/agent.js (which pulls in
 *   UI code through stages/settings.js) can be imported under node.
 * - Installs minimal browser globals the app modules touch at runtime:
 *   `window` (an EventTarget), `localStorage`/`sessionStorage` (in memory).
 *
 * Idempotent: safe to import from every test file and via `node --import`.
 * No app code is modified; this is the only shim layer.
 */
import { register } from 'node:module'

if (!globalThis.__satualurTestSetup) {
  globalThis.__satualurTestSetup = true
  register('./css-hooks.mjs', import.meta.url)

  const memoryStorage = () => {
    const data = new Map()
    return {
      getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
      setItem: (k, v) => { data.set(String(k), String(v)) },
      removeItem: (k) => { data.delete(String(k)) },
      clear: () => data.clear(),
      key: (i) => [...data.keys()][i] ?? null,
      get length() { return data.size },
    }
  }
  // Node 22 may expose an experimental (file-less, warning-emitting) localStorage; always replace it.
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: memoryStorage(), configurable: true, writable: true })

  if (typeof globalThis.window === 'undefined') {
    const target = new EventTarget()
    globalThis.addEventListener = target.addEventListener.bind(target)
    globalThis.removeEventListener = target.removeEventListener.bind(target)
    globalThis.dispatchEvent = target.dispatchEvent.bind(target)
    globalThis.window = globalThis
  }
}

/** Collects window events of the given type until `stop()` is called. */
export function captureEvents(type) {
  const events = []
  const fn = (e) => events.push(e)
  window.addEventListener(type, fn)
  return { events, stop: () => window.removeEventListener(type, fn) }
}

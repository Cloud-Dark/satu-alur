/**
 * The six visible steps of "Susun dengan AI". Pure state: the offer page drives
 * it and renders `steps` as a checklist (pending → running → done | error).
 */

export const PIPELINE_STEPS = [
  { key: 'data', label: 'Mengambil data klien' },
  { key: 'schedule', label: 'Menyesuaikan jadwal' },
  { key: 'offer', label: 'Membuat penawaran berdasarkan kebutuhan klien' },
  { key: 'pdf', label: 'Membuat PDF penawaran' },
  { key: 'email', label: 'Membuat draf email & WhatsApp' },
  { key: 'review', label: 'Membuat draf tinjauan' },
]

const STATES = new Set(['pending', 'running', 'done', 'error', 'stopped'])

export function createPipeline(steps = PIPELINE_STEPS) {
  const list = steps.map((s) => ({ ...s, state: 'pending', startedAt: null, ms: null, error: null }))
  const find = (key) => {
    const s = list.find((x) => x.key === key)
    if (!s) throw new Error(`Langkah tidak dikenal: ${key}`)
    return s
  }
  const api = {
    steps: list,
    get(key) { return find(key) },
    start(key, now = Date.now()) {
      const s = find(key)
      s.state = 'running'; s.startedAt = now; s.ms = null; s.error = null
      return s
    },
    done(key, now = Date.now()) {
      const s = find(key)
      if (s.state !== 'running') throw new Error(`Langkah ${key} belum berjalan`)
      s.state = 'done'; s.ms = now - s.startedAt
      return s
    },
    fail(key, error, now = Date.now()) {
      const s = find(key)
      s.state = 'error'; s.error = String(error?.message || error || 'Gagal'); s.ms = s.startedAt ? now - s.startedAt : null
      return s
    },
    /** Marks the running step and every later pending step as stopped. */
    stop() {
      let hit = false
      for (const s of list) {
        if (s.state === 'running') { s.state = 'stopped'; hit = true } else if (hit && s.state === 'pending') s.state = 'stopped'
      }
    },
    /** Resets `key` and every step after it back to pending (retry from there). */
    resetFrom(key) {
      const idx = list.findIndex((x) => x.key === key)
      if (idx === -1) throw new Error(`Langkah tidak dikenal: ${key}`)
      for (const s of list.slice(idx)) Object.assign(s, { state: 'pending', startedAt: null, ms: null, error: null })
    },
    get complete() { return list.every((s) => s.state === 'done') },
    get running() { return list.find((s) => s.state === 'running') || null },
    /** First step that is not done (where a retry should restart). */
    get resumeKey() { return list.find((s) => s.state !== 'done')?.key || null },
  }
  for (const s of list) if (!STATES.has(s.state)) throw new Error('bad state')
  return api
}

/**
 * Picking the service type for a new request (pure). An existing service is
 * only reused when the owner's hint actually mentions it; otherwise the name
 * comes from the hint itself, so "aplikasi kasir" never turns into whatever
 * service happened to be recorded first.
 */
const STOP = new Set(['dan', 'atau', 'untuk', 'dengan', 'yang', 'di', 'ke', 'dari', 'pada', 'lengkap', 'jasa', 'layanan', 'pembuatan', 'pengembangan', 'mau', 'ingin', 'butuh', 'minta', 'tolong', 'bisa', 'saya', 'kami', 'kita', 'buat', 'bikin', 'unit', 'plus', 'serta', 'juga', 'baru', 'sebuah', 'satu'])

export const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOP.has(w))

/** True when the service name and the hint share a meaningful word (or a 5-letter stem). */
export function mentions(hint, service) {
  const h = words(hint)
  const stems = new Set(h.map((w) => w.slice(0, 5)))
  return words(service).some((w) => h.includes(w) || (w.length >= 5 && stems.has(w.slice(0, 5))))
}

/** Existing service mentioned by the hint, best overlap first; null when none fits. */
export function matchKnown(hint, known = []) {
  let best = null
  let score = 0
  for (const k of known) {
    const h = new Set(words(hint))
    const s = words(k).filter((w) => h.has(w) || [...h].some((x) => x.length >= 5 && w.length >= 5 && x.slice(0, 5) === w.slice(0, 5))).length
    if (s > score) { score = s; best = k }
  }
  return best
}

/** A short service name from the hint: first clause, at most 6 words, capitalised. */
export function serviceFromHint(hint) {
  const first = String(hint || '').replace(/\s+/g, ' ').trim()
    .split(/[.,;:\n!?]| di (?=[A-Z])| untuk | pada /)[0].trim()
  const name = first.split(' ').slice(0, 6).join(' ').slice(0, 80)
  return name ? name[0].toUpperCase() + name.slice(1) : ''
}

/**
 * Final service type: keep the model's answer unless it is an existing service
 * the hint never mentions (the "first item of the list" failure), then prefer an
 * existing service the hint does mention, then a name taken from the hint.
 */
export function resolveServiceType(hint, proposed, known = []) {
  const p = String(proposed || '').trim()
  const isKnown = known.some((k) => k.toLowerCase() === p.toLowerCase())
  if (p && (!isKnown || mentions(hint, p))) return p
  return matchKnown(hint, known) || serviceFromHint(hint) || p
}

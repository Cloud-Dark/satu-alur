/**
 * App URL routes (pure, no DOM): the one mapping table between the shell's stage keys + params
 * and readable hash URLs under #/app/…, with Indonesian slugs.
 *
 *   #/app                                   Ringkasan (a bare #/app on first load reopens the last page)
 *   #/app/alur-kerja?posisi=offer&q=maju    Alur kerja, filtered and searched
 *   #/app/alur-kerja/12                     Alur kerja with the detail of job (request) 12 open
 *   #/app/permintaan/baru                   new request form
 *   #/app/penawaran/baru?permintaan=12      offer wizard for request 12
 *   #/app/penawaran/34                      offer 34
 *   #/app/penugasan?penawaran=34            assign the team for offer 34
 *   #/app/penyelesaian?penugasan=5          close assignment 5
 *   #/app/pembukuan?penyelesaian=7          post the journal of completion 7
 *   #/app/invoice/9                         invoice 9 open in its editor
 *   #/app/pengaturan                        settings drawer (over the current page)
 *   #/app/kantor/<bagian>                   Kantor Satu Alur (staff office) section
 *
 * parseAppRoute(hash) -> { stage, params, settings, office, bare, unknown } | null (not an app URL)
 * formatAppRoute({ stage, params, settings, office }) -> '#/app/…'
 */

/**
 * stage: shell stage key. slug: path under #/app. id: param carried as the path segment after the
 * slug. query: url key -> param name (dotted names go one level deep, e.g. prefill.customer_name).
 * sub: extra path segment; `subWhen` lists params whose presence adds it (always when omitted).
 */
export const APP_ROUTES = [
  { stage: 'dashboard', slug: '' },
  { stage: 'workflow', slug: 'alur-kerja', id: 'id', query: { posisi: 'filter', q: 'q' } },
  {
    stage: 'request', slug: 'permintaan', sub: 'baru',
    query: { nama: 'prefill.customer_name', lokasi: 'prefill.location', telepon: 'prefill.phone', layanan: 'prefill.service_type', kebutuhan: 'prefill.description' },
  },
  { stage: 'offer', slug: 'penawaran', id: 'offerId', sub: 'baru', subWhen: ['requestId'], query: { permintaan: 'requestId' } },
  { stage: 'assign', slug: 'penugasan', query: { penawaran: 'offerId' } },
  { stage: 'complete', slug: 'penyelesaian', query: { penugasan: 'assignmentId' } },
  { stage: 'bookkeeping', slug: 'pembukuan', query: { penyelesaian: 'completionId' } },
  { stage: 'report', slug: 'laporan' },
  { stage: 'invoice', slug: 'invoice', id: 'invoiceId', query: { penyelesaian: 'completionId' } },
  { stage: 'vas', slug: 'layanan-tambahan' },
  { stage: 'zero-waste', slug: 'tanpa-limbah' },
  { stage: 'radar', slug: 'radar' },
  { stage: 'leads', slug: 'prospek' },
  { stage: 'social-media', slug: 'media-sosial' },
  { stage: 'advisor', slug: 'penasihat' },
  { stage: 'ai-assistant', slug: 'ai-superpowers' },
  { stage: 'pertumbuhan', slug: 'pertumbuhan' },
  { stage: 'plan', slug: 'paket', query: { fokus: 'focus' } },
  { stage: 'support', slug: 'bantuan', query: { tiket: 'tiket' } },
]

/** Kantor Satu Alur sections (src/stages/office/index.js ITEMS) -> slug under #/app/kantor/. */
export const OFFICE_ROUTES = {
  landing: 'landing',
  about: 'tentang',
  legal: 'legal',
  plans: 'paket',
  gateway: 'pembayaran',
  vouchers: 'voucher',
  'offer-templates': 'template-penawaran',
  customers: 'pelanggan',
  users: 'pengguna',
  contact: 'kontak',
  tickets: 'pengaduan',
  influencers: 'influencer',
  requests: 'permintaan',
  campaigns: 'kampanye',
  'sys-overview': 'sistem',
  'sys-email': 'sistem/email',
  'sys-ai': 'sistem/ai',
  'sys-login': 'sistem/login',
  'sys-access': 'sistem/akses',
  'sys-whatsapp': 'sistem/whatsapp',
  'sys-activity': 'sistem/log',
}

/** Older stage keys still used by some callers. */
export const STAGE_ALIASES = { social: 'social-media' }

export const SETTINGS_SLUG = 'pengaturan'
export const OFFICE_SLUG = 'kantor'

const BY_STAGE = new Map(APP_ROUTES.map((r) => [r.stage, r]))
const BY_SLUG = new Map(APP_ROUTES.filter((r) => r.slug).map((r) => [r.slug, r]))
const OFFICE_BY_SLUG = new Map(Object.entries(OFFICE_ROUTES).map(([k, s]) => [s, k]))

export const resolveStage = (key) => STAGE_ALIASES[key] || key

/** True for #/app and anything under it. */
export function isAppHash(hash) {
  const path = String(hash || '').replace(/^#/, '').split('?')[0]
  return path === '/app' || path.startsWith('/app/')
}

// Ids are numbers in the database; keep other values (uuids) as strings.
const idValue = (s) => (/^\d{1,15}$/.test(s) ? Number(s) : s)
const present = (v) => v !== undefined && v !== null && v !== ''

function getParam(params, name) {
  const [a, b] = name.split('.')
  const v = params?.[a]
  if (b === undefined) return v
  return v && typeof v === 'object' ? v[b] : undefined
}

function setParam(params, name, value) {
  const [a, b] = name.split('.')
  if (b === undefined) { params[a] = value; return }
  params[a] = params[a] && typeof params[a] === 'object' ? params[a] : {}
  params[a][b] = value
}

// Values that look like ids map back to numbers; free text (q, prefill…) stays a string.
const ID_PARAMS = new Set(['id', 'requestId', 'offerId', 'assignmentId', 'completionId', 'invoiceId', 'tiket'])

/** Parses a location.hash. Returns null when it is not an app route. */
export function parseAppRoute(hash) {
  if (!isAppHash(hash)) return null
  const raw = String(hash).replace(/^#/, '')
  const qi = raw.indexOf('?')
  const path = qi < 0 ? raw : raw.slice(0, qi)
  const search = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1))
  const parts = path.split('/').filter(Boolean).slice(1).map((p) => { try { return decodeURIComponent(p) } catch { return p } })
  const out = { stage: null, params: {}, settings: false, office: false, bare: false, unknown: false }
  if (!parts.length) { out.bare = true; return out }

  if (parts[0] === SETTINGS_SLUG && parts.length === 1) { out.settings = true; return out }
  if (parts[0] === OFFICE_SLUG) {
    out.office = true
    if (parts.length > 1) {
      const key = OFFICE_BY_SLUG.get(parts.slice(1).join('/'))
      if (key) out.stage = key
      else out.unknown = true
    }
    return out
  }

  const route = BY_SLUG.get(parts[0])
  if (!route) return { ...out, stage: 'dashboard', unknown: true }
  out.stage = route.stage
  let rest = parts.slice(1)
  if (route.sub && rest[0] === route.sub) rest = rest.slice(1)
  if (rest.length === 1 && route.id) setParam(out.params, route.id, idValue(rest[0]))
  else if (rest.length) out.unknown = true
  for (const [key, name] of Object.entries(route.query || {})) {
    const v = search.get(key)
    if (!present(v)) continue
    setParam(out.params, name, ID_PARAMS.has(name) ? idValue(v) : v)
  }
  return out
}

/** Formats a route (as parseAppRoute returns, or { stage, params }) into a '#/app/…' hash. */
export function formatAppRoute({ stage, params = {}, settings = false, office = false } = {}) {
  if (settings) return `#/app/${SETTINGS_SLUG}`
  if (office) {
    const slug = stage ? OFFICE_ROUTES[stage] || encodeURIComponent(stage) : ''
    return `#/app/${OFFICE_SLUG}${slug ? `/${slug}` : ''}`
  }
  const route = BY_STAGE.get(resolveStage(stage)) || BY_STAGE.get('dashboard')
  const segs = route.slug ? [route.slug] : []
  const id = route.id ? getParam(params, route.id) : undefined
  if (present(id)) segs.push(encodeURIComponent(String(id)))
  else if (route.sub && (!route.subWhen || route.subWhen.some((n) => present(getParam(params, n))))) segs.push(route.sub)
  const q = new URLSearchParams()
  for (const [key, name] of Object.entries(route.query || {})) {
    const v = getParam(params, name)
    if (present(v) && typeof v !== 'object') q.set(key, String(v))
  }
  const qs = q.toString().replace(/\+/g, '%20')
  return `#/app${segs.length ? `/${segs.join('/')}` : ''}${qs ? `?${qs}` : ''}`
}

/** Same page and params? (ignores param order and number/string differences) */
export function sameRoute(a, b) {
  return formatAppRoute(a || {}) === formatAppRoute(b || {})
}

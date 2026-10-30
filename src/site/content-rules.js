// Pure validators + body parser for editable site content. Errors carry Indonesian text.

export const SITE_KEYS = ['landing', 'about', 'privacy', 'terms', 'cookies']

const MAX_VALUE_BYTES = 64 * 1024

// Tagged so the worker turns only these into 400s (anything else is a real bug).
function fail(message) {
  throw Object.assign(new Error(message), { validation: true })
}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v.trim() : '')
function text(v, label, max) {
  const s = str(v)
  if (s.length > max) fail(`${label} maksimal ${max} karakter.`)
  return s
}

function validateLanding(v) {
  const h = isObj(v.hero) ? v.hero : {}
  const points = Array.isArray(h.points) ? h.points : []
  if (points.length > 4) fail('Maksimal 4 poin.')
  const faqs = Array.isArray(v.faqs) ? v.faqs : []
  if (faqs.length > 20) fail('Maksimal 20 FAQ.')
  return {
    hero: {
      badge: text(h.badge, 'Badge', 80),
      title: text(h.title, 'Judul', 120),
      subtitle: text(h.subtitle, 'Subjudul', 300),
      points: points.map((p) => text(p, 'Poin', 60)),
    },
    faqs: faqs.map((f) => ({ q: text(f?.q, 'Pertanyaan', 160), a: text(f?.a, 'Jawaban', 1200) })),
  }
}

export function validateSiteContent(key, value) {
  if (!SITE_KEYS.includes(key)) fail('Halaman tidak dikenal.')
  if (!isObj(value)) fail('Isi halaman tidak valid.')
  const clean = key === 'landing'
    ? validateLanding(value)
    : { title: text(value.title, 'Judul', 120), body: text(value.body, 'Isi', 50000) }
  if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_VALUE_BYTES) fail('Isi halaman melebihi 64 KB.')
  return clean
}

// "## x" heading, "- x" list item, blank line ends a paragraph. Output is meant for text nodes only.
export function parseDoc(body) {
  const blocks = []
  let para = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') })
    para = []
  }
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) flush()
    else if (line.startsWith('## ')) { flush(); blocks.push({ type: 'h', text: line.slice(3).trim() }) }
    else if (line.startsWith('- ')) {
      flush()
      const last = blocks[blocks.length - 1]
      if (last?.type === 'ul') last.items.push(line.slice(2).trim())
      else blocks.push({ type: 'ul', items: [line.slice(2).trim()] })
    } else para.push(line)
  }
  flush()
  return blocks
}

/**
 * Tiny, safe text formatter for Waguri's answers: builds DOM nodes (never
 * parses HTML). Handles paragraphs, "-", "*" and "•" bullet lists (also when the
 * bullets were glued into one line), "1." lists and **bold**.
 */
const BULLET = /^(?:[-*•+])\s+(.*)$/
const NUMBERED = /^\d{1,2}[.)]\s+(.*)$/

function inline(text) {
  const out = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)))
    const b = document.createElement('strong')
    b.textContent = m[1]
    out.push(b)
    last = re.lastIndex
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)))
  return out
}

/** Splits "a • b • c" glued on one line into separate bullet lines. */
export function normalizeLines(src) {
  return String(src || '').replace(/\r\n?/g, '\n')
    .replace(/\s+•\s+/g, '\n• ')
    .split('\n')
}

export function formatText(src) {
  const frag = document.createDocumentFragment()
  let para = []
  let list = null
  const flushPara = () => {
    if (!para.length) return
    const p = document.createElement('p')
    para.forEach((t, i) => { if (i) p.append(document.createElement('br')); p.append(...inline(t)) })
    frag.append(p)
    para = []
  }
  const flushList = () => { if (list) frag.append(list.node); list = null }
  for (const raw of normalizeLines(src)) {
    const line = raw.trim()
    if (!line) { flushPara(); flushList(); continue }
    let m = line.match(BULLET)
    const type = m ? 'ul' : (m = line.match(NUMBERED)) ? 'ol' : null
    if (type) {
      flushPara()
      if (list?.type !== type) { flushList(); list = { type, node: document.createElement(type) } }
      const li = document.createElement('li')
      li.append(...inline(m[1]))
      list.node.append(li)
      continue
    }
    flushList()
    para.push(line.replace(/^#{1,6}\s+/, ''))
  }
  flushPara()
  flushList()
  return frag
}

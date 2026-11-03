/**
 * Reads the fields of a JSON object that is still being streamed, so the UI can
 * show "Ruang lingkup", "Harga"… filling in as the model writes them instead of
 * raw JSON. Only top-level string and number values are read; a string that is
 * still open is returned as far as it has arrived.
 */

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

// Reads a JSON string body starting right after its opening quote.
function readString(text, i) {
  let out = ''
  while (i < text.length) {
    const c = text[i]
    if (c === '"') return { value: out, end: i + 1, closed: true }
    if (c === '\\') {
      const n = text[i + 1]
      if (n === undefined) break // escape cut off by the stream
      if (n === 'u') {
        const hex = text.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
        continue
      }
      out += ESCAPES[n] ?? n
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return { value: out, end: text.length, closed: false }
}

/**
 * Returns { fields, closed } where `fields` maps each key seen so far to its
 * (possibly partial) value and `closed` lists the keys whose value is complete.
 */
export function readPartialJson(text) {
  const src = String(text || '')
  const fields = {}
  const closed = new Set()
  let i = src.indexOf('{')
  if (i === -1) return { fields, closed }
  i += 1
  const keyRe = /\s*,?\s*"/y
  while (i < src.length) {
    keyRe.lastIndex = i
    if (!keyRe.test(src)) break
    const key = readString(src, keyRe.lastIndex)
    if (!key.closed) break
    let j = key.end
    while (j < src.length && /\s/.test(src[j])) j += 1
    if (src[j] !== ':') break
    j += 1
    while (j < src.length && /\s/.test(src[j])) j += 1
    if (j >= src.length) break
    if (src[j] === '"') {
      const val = readString(src, j + 1)
      fields[key.value] = val.value
      if (val.closed) closed.add(key.value)
      i = val.end
      if (!val.closed) break
    } else {
      const m = /^-?[\d.]+(?:[eE][+-]?\d+)?/.exec(src.slice(j))
      if (!m) break
      const num = Number(m[0])
      if (Number.isFinite(num)) fields[key.value] = num
      const after = j + m[0].length
      if (after < src.length) closed.add(key.value)
      i = after
    }
  }
  return { fields, closed }
}

/**
 * "Living UI" terminal mock: streams a sample AI offer line by line, then
 * loops. Purely a demo — runs only while on screen; reduced motion renders
 * every line statically. Returns a cleanup function.
 */
import { prefersReducedMotion } from '../ui/reveal.js'

const PREFIX = { cmd: '$', dim: '›', code: ' ', ok: '', done: '→' }

function lineEl(line) {
  const row = document.createElement('div')
  row.className = `lp-term-line is-${line.t}`
  if (line.t === 'ok') {
    const tag = document.createElement('span')
    tag.className = 'lp-term-ok'
    tag.textContent = 'OK'
    row.append(tag)
  } else {
    const p = document.createElement('span')
    p.className = 'lp-term-prefix'
    p.textContent = PREFIX[line.t] ?? ''
    row.append(p)
  }
  const text = document.createElement('span')
  text.className = 'lp-term-text'
  row.append(text)
  return { row, text }
}

export function mountTerminal(body, lines) {
  if (!body) return () => {}

  if (prefersReducedMotion()) {
    lines.forEach((l) => {
      const { row, text } = lineEl(l)
      text.textContent = l.s
      body.append(row)
    })
    return () => {}
  }

  let timer = 0
  let running = false
  let visible = false
  let li = 0
  let ci = 0
  let current = null
  const caret = document.createElement('span')
  caret.className = 'lp-term-caret'

  const schedule = (fn, ms) => { timer = window.setTimeout(fn, ms) }

  function step() {
    if (!visible || document.hidden) { running = false; return }
    running = true
    if (li >= lines.length) {
      schedule(() => {
        body.replaceChildren()
        li = 0; ci = 0; current = null
        step()
      }, 3600)
      return
    }
    const line = lines[li]
    if (!current) {
      current = lineEl(line)
      body.append(current.row)
      current.text.after(caret)
    }
    const typed = line.t === 'cmd' || line.t === 'code'
    if (typed && ci < line.s.length) {
      ci = Math.min(line.s.length, ci + (line.t === 'code' ? 2 : 1))
      current.text.textContent = line.s.slice(0, ci)
      schedule(step, line.t === 'cmd' ? 42 : 14)
      return
    }
    current.text.textContent = line.s
    li += 1; ci = 0; current = null
    const pause = line.t === 'cmd' ? 520 : line.t === 'dim' ? 380 : line.t === 'ok' ? 300 : 70
    schedule(step, pause)
  }

  const resume = () => {
    if (!running && visible && !document.hidden) step()
  }
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    resume()
  }, { threshold: 0.2 })
  io.observe(body)
  document.addEventListener('visibilitychange', resume)

  return () => {
    window.clearTimeout(timer)
    io.disconnect()
    document.removeEventListener('visibilitychange', resume)
  }
}

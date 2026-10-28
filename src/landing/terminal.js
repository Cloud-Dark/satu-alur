/**
 * Living AI demo for the landing page: a calm chat-style card in which the
 * offer agent "streams" a sample proposal, validates it and hands it back
 * for approval — then loops. Purely illustrative.
 *
 * The full layout is built up front (with invisible placeholders) so the card
 * never changes height while it streams. Runs only while on screen and the
 * tab is visible; reduced motion shows the finished state statically.
 *
 * mountAgentDemo(body, demo) -> cleanup
 */
import { prefersReducedMotion } from '../ui/reveal.js'
import { iconHTML } from '../ui/icons.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function build(body, demo) {
  body.innerHTML = `
    <div class="lp-chat-msg lp-chat-user" data-step>
      <span class="lp-chat-who">Permintaan masuk</span>
      <p class="lp-chat-bubble">${esc(demo.request)}</p>
    </div>
    <div class="lp-chat-msg lp-chat-ai" data-step>
      <span class="lp-chat-who"><span class="lp-chat-avatar">${iconHTML('sparkles', { size: 14, stroke: 2 })}</span>Agen penawaran</span>
      <div class="lp-chat-card">
        <span class="lp-chat-typing" data-typing aria-hidden="true"><i></i><i></i><i></i></span>
        <dl class="lp-offer">
          ${demo.fields.map((f) => `
            <div class="lp-offer-row${f.key === 'price' ? ' is-price' : ''}" data-step>
              <dt>${esc(f.label)}</dt>
              <dd><span class="lp-type"><span class="lp-type-ghost">${esc(f.value)}</span><span class="lp-type-live" data-type="${esc(f.value)}"></span></span></dd>
            </div>`).join('')}
        </dl>
        <ul class="lp-checks">
          ${demo.checks.map((c) => `<li data-step><span class="lp-check-ic">${iconHTML('check', { size: 12, stroke: 3 })}</span>${esc(c)}</li>`).join('')}
        </ul>
        <div class="lp-chat-status" data-step>
          <span class="lp-chat-status-dot" aria-hidden="true"></span>${esc(demo.status)}
          <span class="lp-chat-actions" aria-hidden="true"><span>Ubah</span><span class="is-primary">Setujui</span></span>
        </div>
      </div>
    </div>`
}

export function mountAgentDemo(body, demo) {
  if (!body || !demo) return () => {}
  build(body, demo)

  const steps = [...body.querySelectorAll('[data-step]')]
  const typing = body.querySelector('[data-typing]')
  const showAll = () => {
    steps.forEach((s) => s.classList.add('is-shown'))
    body.querySelectorAll('[data-type]').forEach((el) => { el.textContent = el.dataset.type })
    body.classList.add('is-done')
  }

  if (prefersReducedMotion()) {
    showAll()
    return () => {}
  }

  let timer = 0
  let running = false
  let visible = false
  // Start on the finished proposal (never an empty card), hold, then replay.
  // Whenever it leaves the screen it snaps back to the finished state.
  const replay = () => [
    () => 2400,
    () => { body.classList.add('is-fading'); return 420 },
    () => { body.classList.remove('is-fading'); reset(); return 300 },
  ]
  showAll()
  let queue = replay()

  function reset() {
    steps.forEach((s) => s.classList.remove('is-shown'))
    body.querySelectorAll('[data-type]').forEach((el) => { el.textContent = '' })
    typing.classList.remove('is-on')
    body.classList.remove('is-done')
  }

  // A tiny script of timed actions; each returns the delay before the next.
  function script() {
    const q = []
    steps.forEach((el) => {
      const live = el.querySelector('[data-type]')
      if (el.classList.contains('lp-chat-ai')) {
        q.push(() => { el.classList.add('is-shown'); typing.classList.add('is-on'); return 1100 })
        q.push(() => { typing.classList.remove('is-on'); return 120 })
        return
      }
      q.push(() => { el.classList.add('is-shown'); return live ? 160 : el.classList.contains('lp-chat-user') ? 900 : 420 })
      if (live) {
        const text = live.dataset.type
        for (let i = 1; i <= text.length; i += 2) {
          q.push(() => { live.textContent = text.slice(0, i); return 22 })
        }
        q.push(() => { live.textContent = text; return 260 })
      }
    })
    q.push(() => { body.classList.add('is-done'); return 4200 })
    q.push(() => { body.classList.add('is-fading'); return 420 })
    q.push(() => { body.classList.remove('is-fading'); reset(); return 500 })
    return q
  }

  function step() {
    if (!visible || document.hidden) { running = false; return }
    running = true
    if (!queue.length) queue = script()
    const delay = queue.shift()()
    timer = window.setTimeout(step, delay)
  }

  const resume = () => {
    if (!running && visible && !document.hidden) step()
  }
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    if (!visible) {
      window.clearTimeout(timer)
      running = false
      body.classList.remove('is-fading')
      showAll()
      queue = replay()
    }
    resume()
  }, { threshold: 0.25 })
  io.observe(body)
  document.addEventListener('visibilitychange', resume)

  return () => {
    window.clearTimeout(timer)
    io.disconnect()
    document.removeEventListener('visibilitychange', resume)
  }
}

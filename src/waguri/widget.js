/**
 * "Tanya Waguri": the floating assistant on every page.
 *
 *   mountWaguri({ mode: 'app', user, navigate })   inside the signed-in shell (reads the user's data)
 *   mountWaguri({ mode: 'public', navigate })      landing, login and the other public pages
 *
 * Returns a cleanup function. Consent and chat history stay on this device (localStorage,
 * per account in the app); every storage access is wrapped so a blocked storage only
 * means nothing is remembered.
 */
import '../styles/waguri.css'
import { icon } from '../ui/icons.js'
import { waguriImage } from './avatar.js'
import { skillsFor, skillById, greeting } from './skills.js'
import { answerFor, wantsAi } from './engine.js'
import { askApp, askPublic, aiErrorNote } from './ai.js'
import { STEPS } from '../domain/workflow.js'

const CONSENT_KEY = 'satualur_waguri_consent'
const MAX_SAVED = 40
const NARROW = '(max-width: 640px)'

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k) } catch { /* storage unavailable */ } },
}

/** Tiny element helper (no dependency on the app's component kit, so public pages stay light). */
function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'className') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v)
    else n.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return n
}

let seq = 0

export function mountWaguri({ mode = 'public', user = null, navigate = () => {} } = {}) {
  const app = mode === 'app'
  const id = `wg-${++seq}`
  const chatKey = `satualur_waguri_chat:${app ? 'app' : 'public'}:${(app && user?.id) || 'anon'}`
  const skillKey = `satualur_waguri_skill:${app ? 'app' : 'public'}`
  const firstName = app ? String(user?.name || '').trim().split(/\s+/)[0] || '' : ''
  const skills = skillsFor(mode)
  let skill = skillById(store.get(skillKey), mode)
  let history = loadHistory()
  let open = false
  let busy = false
  let ctl = null
  let returnFocus = null
  let flowCache = null
  const disposers = []
  const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); disposers.push(() => t.removeEventListener(type, fn, o)) }

  function loadHistory() {
    try {
      const v = JSON.parse(store.get(chatKey) || '[]')
      return Array.isArray(v) ? v.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).slice(-MAX_SAVED) : []
    } catch { return [] }
  }
  const saveHistory = () => store.set(chatKey, JSON.stringify(history.slice(-MAX_SAVED)))

  /* ------------------------------------------------------------- Data */

  const loaders = {
    async flow() {
      if (flowCache && Date.now() - flowCache.at < 15000) return flowCache.data
      const [{ loadFlow }, { workflowRows }, { loadInvoices }] = await Promise.all([
        import('../stages/data.js'), import('../domain/workflow.js'), import('../invoice/api.js'),
      ])
      const [m, invoices] = await Promise.all([loadFlow(), loadInvoices().catch(() => [])])
      const data = { rows: workflowRows(m, { invoices }), ledger: m.ledger, pendingBookkeeping: m.completionsWithoutLedger().length, invoices }
      flowCache = { at: Date.now(), data }
      return data
    },
    async plans() {
      const { getPlans } = await import('../business/api.js')
      return getPlans()
    },
  }
  const dropCache = () => { flowCache = null }
  on(window, 'satualur:data-changed', dropCache)
  on(window, 'satualur:db-write', dropCache)

  /* ----------------------------------------------------------- Markup */

  const fabAvatar = h('span', { className: 'wg-fab-ava', 'aria-hidden': 'true' }, waguriImage('avatar', { className: 'wg-ava-img' }), h('i', { className: 'wg-online' }))
  const fabClose = h('span', { className: 'wg-fab-x', 'aria-hidden': 'true' }, icon('x', { size: 18 }))
  const fab = h('button', {
    type: 'button', className: 'wg-fab', 'aria-expanded': 'false', 'aria-controls': `${id}-panel`, 'data-waguri-fab': '',
  }, fabAvatar, fabClose, h('span', { className: 'wg-fab-label' }, 'Tanya Waguri'))

  const headAva = h('button', { type: 'button', className: 'wg-head-ava', 'aria-label': 'Lihat Waguri seluruh badan', title: 'Lihat Waguri' },
    waguriImage('avatar', { className: 'wg-ava-img' }), h('i', { className: 'wg-online' }))
  const trashBtn = h('button', { type: 'button', className: 'wg-icon', 'aria-label': 'Hapus obrolan', title: 'Hapus obrolan' }, icon('trash', { size: 18 }))
  const closeBtn = h('button', { type: 'button', className: 'wg-icon', 'aria-label': 'Tutup Waguri', title: 'Tutup (Esc)' }, icon('x', { size: 18 }))
  const head = h('header', { className: 'wg-head' },
    headAva,
    h('div', { className: 'wg-head-text' },
      h('h2', { className: 'wg-name', id: `${id}-title` }, 'Waguri'),
      h('p', { className: 'wg-sub' }, 'Asisten AI Satu Alur')),
    trashBtn, closeBtn)

  const body = h('div', { className: 'wg-body' })
  const panel = h('section', {
    className: 'wg-panel', id: `${id}-panel`, role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': `${id}-title`, hidden: true, 'data-waguri-panel': '',
  }, head, body)
  const root = h('div', { className: `wg wg-${mode}`, 'data-waguri': mode }, panel, fab)
  document.body.append(root)
  document.body.classList.add('has-waguri')

  /* --------------------------------------------------- Consent screen */

  function consentScreen() {
    const agree = h('button', { type: 'button', className: 'wg-primary', 'data-waguri-consent': '' }, 'Setuju, mulai ngobrol ', icon('arrowRight', { size: 16 }))
    agree.addEventListener('click', () => {
      store.set(CONSENT_KEY, '1')
      showChat({ focus: true })
    })
    const point = (ic, text) => h('li', {}, h('span', { className: 'wg-point-ico', 'aria-hidden': 'true' }, icon(ic, { size: 16 })), h('span', {}, text))
    return h('div', { className: 'wg-consent' },
      h('div', { className: 'wg-consent-ava', 'aria-hidden': 'true' }, waguriImage('avatar', { className: 'wg-ava-img' })),
      h('span', { className: 'wg-chip' }, icon('lock', { size: 14 }), 'Obrolan pribadi'),
      h('h3', { className: 'wg-consent-title' }, 'Yuk, mulai dari kebutuhanmu.'),
      h('p', { className: 'wg-consent-lede' }, app
        ? 'Aku bisa mengecek posisi proyek pelanggan, menjelaskan menu, meringkas keuangan, dan menyiapkan draf pesan dari data usahamu sendiri.'
        : 'Aku bisa menjelaskan Satu Alur, paket dan harganya, serta cara mulai memakainya.'),
      h('ul', { className: 'wg-points' },
        point('message', 'Waguri menjawab satu hal per giliran, jadi tanyakan satu per satu.'),
        point('compass', 'Waguri bisa menunjukkan halaman atau data yang cocok untuk dibuka.'),
        point('trash', 'Kamu bebas menutup atau menghapus obrolan kapan saja.')),
      h('p', { className: 'wg-note' }, 'Riwayat obrolan disimpan di perangkat ini saja.' + (app ? ' Jawaban dari AI memakai kuota Penasihat AI.' : '')),
      agree)
  }

  /* ------------------------------------------------------ Chat screen */

  const log = h('div', { className: 'wg-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Percakapan dengan Waguri' })
  const skillBar = h('div', { className: 'wg-skills', role: 'group', 'aria-label': 'Keahlian Waguri' })
  const skillHint = h('p', { className: 'wg-skill-hint' })
  const suggest = h('div', { className: 'wg-suggest' })
  const input = h('textarea', { className: 'wg-input', rows: '1', 'aria-label': 'Tulis pertanyaan untuk Waguri', maxlength: '800', 'data-waguri-input': '' })
  const send = h('button', { type: 'submit', className: 'wg-send', 'aria-label': 'Kirim' }, icon('send', { size: 18 }))
  const form = h('form', { className: 'wg-form' }, input, send)
  const chat = h('div', { className: 'wg-chat' }, skillBar, skillHint, log, suggest, form)

  function drawSkills() {
    skillBar.replaceChildren(...skills.map((s) => {
      const b = h('button', { type: 'button', className: `wg-skill${s.id === skill.id ? ' is-active' : ''}`, 'aria-pressed': s.id === skill.id ? 'true' : 'false', 'data-skill': s.id },
        icon(s.icon, { size: 14 }), s.label)
      b.addEventListener('click', () => {
        if (skill.id === s.id) return
        skill = s
        store.set(skillKey, s.id)
        drawSkills()
        drawSuggest(true)
        input.focus()
      })
      return b
    }))
    skillHint.textContent = skill.hint
    input.placeholder = skill.placeholder
  }

  function chips(list, cls = 'wg-sug') {
    return list.map((q) => {
      const b = h('button', { type: 'button', className: cls }, q)
      b.addEventListener('click', () => ask(q))
      return b
    })
  }

  function drawSuggest(force = false) {
    const show = force || !history.some((m) => m.role === 'user')
    suggest.hidden = !show
    if (show) suggest.replaceChildren(h('p', { className: 'wg-sug-title' }, 'Coba tanyakan'), h('div', { className: 'wg-sug-list' }, chips(skill.suggestions)))
  }

  function goTo(a) {
    if (a.href) {
      if (a.href === '#harga' || a.href.startsWith('#') && !a.href.startsWith('#/')) {
        const target = document.getElementById(a.href.slice(1))
        if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
        else navigate('/')
      } else navigate(a.href.slice(1))
    } else navigate(a.stage, a.params || {})
    if (matchMedia(NARROW).matches) close({ restore: false })
  }

  function actionButtons(actions = []) {
    if (!actions.length) return null
    return h('div', { className: 'wg-actions' }, actions.map((a) => {
      const b = h('button', { type: 'button', className: 'wg-action', 'data-waguri-action': a.stage || a.href }, a.label, icon('arrowRight', { size: 14 }))
      b.addEventListener('click', () => goTo(a))
      return b
    }))
  }

  function jobCard(c) {
    const steps = h('ol', { className: 'wg-steps', 'aria-label': c.done ? 'Semua tahap selesai' : `Tahap ${Math.min(c.stepIndex + 1, STEPS.length)} dari ${STEPS.length}: ${c.stage}` },
      STEPS.map((s, i) => h('li', { className: `wg-step is-${i < c.stepIndex || c.done ? 'done' : i === c.stepIndex ? 'current' : 'todo'}`, title: s.label },
        h('span', { className: 'wg-step-label' }, s.label))))
    const next = c.next
      ? h('button', { type: 'button', className: 'wg-next', 'data-waguri-next': c.next.stage }, c.next.label, icon('arrowRight', { size: 14 }))
      : null
    next?.addEventListener('click', () => goTo(c.next))
    return h('article', { className: 'wg-card', 'data-waguri-card': String(c.id) },
      h('div', { className: 'wg-card-top' },
        h('strong', { className: 'wg-card-name' }, c.customer),
        h('span', { className: 'wg-card-id' }, `#${c.id}`)),
      h('p', { className: 'wg-card-meta' }, [c.service, c.location].filter(Boolean).join(' · ')),
      steps,
      h('p', { className: 'wg-card-pos' },
        h('span', { className: `wg-tone wg-tone-${c.tone}` }, c.done ? 'Selesai' : c.stage),
        h('span', { className: 'wg-card-status' }, c.status)),
      next)
  }

  function copyButton(text) {
    const b = h('button', { type: 'button', className: 'wg-copy' }, icon('copy', { size: 14 }), 'Salin pesan')
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.lastChild.textContent = 'Tersalin' } catch { b.lastChild.textContent = 'Gagal menyalin' }
      setTimeout(() => { if (b.isConnected) b.lastChild.textContent = 'Salin pesan' }, 1800)
    })
    return b
  }

  function messageEl(m) {
    if (m.role === 'user') return h('div', { className: 'wg-msg is-user' }, h('p', { className: 'wg-bubble' }, m.text))
    const bubble = h('div', { className: 'wg-bubble' }, h('p', { className: 'wg-text' }, m.text))
    if (m.cards?.length) bubble.append(h('div', { className: 'wg-cards' }, m.cards.map(jobCard)))
    if (m.copy) bubble.append(copyButton(m.copy))
    if (m.note) bubble.append(h('p', { className: 'wg-msg-note' }, m.note))
    const acts = actionButtons(m.actions)
    if (acts) bubble.append(acts)
    if (m.suggestions?.length) bubble.append(h('div', { className: 'wg-sug-list' }, chips(m.suggestions)))
    return h('div', { className: 'wg-msg is-bot', 'data-skill': m.skill || '' },
      h('span', { className: 'wg-msg-ava', 'aria-hidden': 'true' }, waguriImage('avatar', { className: 'wg-ava-img' })), bubble)
  }

  function drawLog() {
    log.replaceChildren(messageEl({ role: 'assistant', text: greeting(mode, firstName) }), ...history.map(messageEl))
    drawSuggest()
    scrollDown()
  }
  const scrollDown = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight })

  async function ask(raw) {
    const question = String(raw || '').trim().slice(0, 800)
    if (!question || busy) return
    busy = true
    send.disabled = true
    input.value = ''
    autosize()
    const asked = skill
    const userMsg = { role: 'user', text: question, skill: asked.id }
    history.push(userMsg)
    log.append(messageEl(userMsg))
    suggest.hidden = true
    const typing = h('div', { className: 'wg-msg is-bot is-typing', 'aria-label': 'Waguri sedang mengetik' },
      h('span', { className: 'wg-msg-ava', 'aria-hidden': 'true' }, waguriImage('avatar', { className: 'wg-ava-img' })),
      h('div', { className: 'wg-bubble' }, h('span', { className: 'wg-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))))
    log.append(typing)
    scrollDown()
    ctl = new AbortController()
    const prior = history.slice(0, -1)

    let reply
    try {
      const result = await answerFor(asked, question, { mode, loaders, sender: '' })
      reply = { role: 'assistant', skill: asked.id, text: result.text, cards: result.cards, actions: result.actions, suggestions: result.suggestions, copy: result.copy }
      if (wantsAi(asked, result)) {
        const live = messageEl({ ...reply, text: '' })
        const liveText = live.querySelector('.wg-text')
        live.querySelector('.wg-bubble').setAttribute('aria-busy', 'true')
        let started = false
        try {
          const call = app ? askApp : askPublic
          const text = await call({
            skill: asked, question, context: result.ai.context, history: prior, signal: ctl.signal,
            onChunk: (_d, full) => {
              if (!started) { started = true; typing.replaceWith(live) }
              liveText.textContent = full
              scrollDown()
            },
          })
          if (text) {
            reply.text = text
            if (result.copy) reply.copy = text
          }
        } catch (err) {
          if (err?.name === 'AbortError') { live.remove(); typing.remove(); return }
          const note = aiErrorNote(err)
          if (note) reply.note = note
        }
        live.remove()
      }
    } catch (err) {
      reply = { role: 'assistant', skill: asked.id, text: `Maaf, data belum bisa dimuat: ${err?.message || 'coba lagi sebentar lagi.'}` }
    } finally {
      busy = false
      send.disabled = false
      ctl = null
    }
    typing.remove()
    history.push(reply)
    saveHistory()
    log.append(messageEl(reply))
    scrollDown()
  }

  function autosize() {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }
  input.addEventListener('input', autosize)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value) }
  })
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value) })

  /* ---------------------------------------------------- Full-body view */

  function fullScreen() {
    const back = h('button', { type: 'button', className: 'wg-primary wg-full-back' }, icon('arrowLeft', { size: 16 }), 'Kembali ke chat')
    const x = h('button', { type: 'button', className: 'wg-icon wg-full-x', 'aria-label': 'Tutup tampilan penuh' }, icon('x', { size: 18 }))
    back.addEventListener('click', () => leaveFull())
    x.addEventListener('click', () => leaveFull())
    return h('div', { className: 'wg-full', role: 'group', 'aria-label': 'Waguri, tampilan seluruh badan', 'data-waguri-full': '' },
      waguriImage('full', { className: 'wg-full-img', alt: 'Ilustrasi Waguri, asisten kantor Satu Alur, berdiri tersenyum' }),
      x,
      h('div', { className: 'wg-full-cap' },
        h('p', { className: 'wg-full-name' }, 'Waguri'),
        h('p', { className: 'wg-full-sub' }, 'Asisten AI Satu Alur'),
        back))
  }
  let full = null
  function showFull() {
    if (full) return
    full = fullScreen()
    body.append(full)
    panel.classList.add('is-full')
    full.querySelector('.wg-full-back').focus()
  }
  function leaveFull({ focus = true } = {}) {
    if (!full) return
    full.remove()
    full = null
    panel.classList.remove('is-full')
    if (focus) headAva.focus()
  }
  headAva.addEventListener('click', () => (full ? leaveFull() : showFull()))

  /* ---------------------------------------------------- Confirm clear */

  let sheet = null
  function openSheet() {
    if (sheet) return
    leaveFull({ focus: false })
    const cancel = h('button', { type: 'button', className: 'wg-ghost' }, 'Batal')
    const end = h('button', { type: 'button', className: 'wg-danger', 'data-waguri-end': '' }, 'Akhiri')
    cancel.addEventListener('click', () => closeSheet())
    end.addEventListener('click', () => {
      ctl?.abort()
      history = []
      store.del(chatKey)
      closeSheet({ focus: false })
      if (store.get(CONSENT_KEY) === '1') showChat({ focus: true })
    })
    sheet = h('div', { className: 'wg-sheet-layer' },
      h('div', { className: 'wg-sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-end-title`, 'aria-describedby': `${id}-end-desc` },
        h('h3', { id: `${id}-end-title`, className: 'wg-sheet-title' }, 'Akhiri obrolan ini?'),
        h('p', { id: `${id}-end-desc`, className: 'wg-sheet-text' }, 'Seluruh riwayat obrolan dengan Waguri di perangkat ini akan dihapus.'),
        h('div', { className: 'wg-sheet-actions' }, cancel, end)))
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet() })
    panel.append(sheet)
    cancel.focus()
  }
  function closeSheet({ focus = true } = {}) {
    if (!sheet) return
    sheet.remove()
    sheet = null
    if (focus) trashBtn.focus()
  }
  trashBtn.addEventListener('click', openSheet)

  /* --------------------------------------------------------- Screens */

  function showChat({ focus = false } = {}) {
    drawSkills()
    drawLog()
    body.replaceChildren(chat)
    trashBtn.disabled = false
    if (focus) input.focus()
  }
  function showConsent() {
    body.replaceChildren(consentScreen())
    trashBtn.disabled = true
  }

  function openPanel() {
    if (open) return
    open = true
    returnFocus = document.activeElement
    if (store.get(CONSENT_KEY) === '1') showChat()
    else showConsent()
    panel.hidden = false
    root.classList.add('is-open')
    fab.setAttribute('aria-expanded', 'true')
    fab.setAttribute('aria-label', 'Tutup Tanya Waguri')
    requestAnimationFrame(() => {
      panel.classList.add('is-in')
      const target = body.querySelector('[data-waguri-consent]') || input
      target.focus({ preventScroll: true })
    })
  }
  function close({ restore = true } = {}) {
    if (!open) return
    open = false
    closeSheet({ focus: false })
    leaveFull({ focus: false })
    panel.classList.remove('is-in')
    panel.hidden = true
    root.classList.remove('is-open')
    fab.setAttribute('aria-expanded', 'false')
    fab.removeAttribute('aria-label')
    if (restore) (fab.isConnected ? fab : returnFocus)?.focus?.({ preventScroll: true })
  }

  fab.addEventListener('click', () => (open ? close() : openPanel()))
  closeBtn.addEventListener('click', () => close())
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (sheet) closeSheet()
    else if (full) leaveFull()
    else close()
  })
  // Tab stays inside the confirm sheet while it is open.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !sheet) return
    const items = [...sheet.querySelectorAll('button')]
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })

  return () => {
    ctl?.abort()
    disposers.forEach((d) => d())
    root.remove()
    if (!document.querySelector('[data-waguri]')) document.body.classList.remove('has-waguri')
  }
}

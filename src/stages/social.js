/**
 * Pertumbuhan — Media sosial.
 *
 * Selective port of PR #3 "Social Media" workspace (src/stages/social-media.js)
 * onto the v2 stage architecture: AI content per platform, posting schedule,
 * idea brainstorm, Meta ads helper, collaboration ideas, hashtags and a saved
 * content library. Persistence lives in D1 (social_contents,
 * social_schedules) instead of localStorage. Nothing on this page shows
 * invented performance numbers.
 */
import '../styles/social.css'
import { getCloud } from '../cloud.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { resolveModel, abortable } from './offer.js'
import * as AI from '../ai/social-agent.js'

const { el, icon } = C

const TABS = [
  { key: 'content', label: 'Konten', icon: 'pencil' },
  { key: 'schedule', label: 'Jadwal', icon: 'calendar' },
  { key: 'ideas', label: 'Ide', icon: 'lightbulb' },
  { key: 'ads', label: 'Iklan Meta', icon: 'target' },
  { key: 'partner', label: 'Kolaborasi', icon: 'handshake' },
  { key: 'library', label: 'Pustaka', icon: 'bookmark' },
]

const KINDS = [
  { value: 'content', label: 'Konten' },
  { value: 'brainstorm', label: 'Ide' },
  { value: 'ads', label: 'Iklan Meta' },
  { value: 'partnership', label: 'Kolaborasi' },
]
const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label || k || '—'

const TAB_STORE = 'satualur_social_tab'
const store = {
  get(k) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k, v) { try { sessionStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

/* ------------------------------------------------------------- Helpers */

const pad = (n) => String(n).padStart(2, '0')
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeOf = (d) => `${pad(d.getHours())}.${pad(d.getMinutes())}`

function nextSlot(now = new Date()) {
  const d = new Date(now)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

function dayLabel(d, now = new Date()) {
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000)
  const date = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
  if (diff === 0) return { main: 'Hari ini', sub: date }
  if (diff === 1) return { main: 'Besok', sub: date }
  if (diff === -1) return { main: 'Kemarin', sub: date }
  return { main: d.toLocaleDateString('id-ID', { weekday: 'long' }), sub: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) }
}

function parseMeta(v) {
  if (v && typeof v === 'object') return v
  if (typeof v !== 'string' || !v) return {}
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {} } catch { return {} }
}

async function copyText(text, what = 'Teks') {
  const value = String(text || '')
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const ta = el('textarea', { className: 'sr-only', 'aria-hidden': 'true' })
    ta.value = value
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    if (!ok) { showToast('Gagal menyalin. Salin teks secara manual.', 'error'); return }
  }
  showToast(`${what} disalin ke papan klip.`, 'success')
}

/** Two-step destructive button: first click arms, second click acts. */
function confirmAction(btn, armedLabel, action) {
  const labelEl = btn.querySelector('.btn-label')
  const base = labelEl?.textContent || ''
  let timer = null
  const reset = () => {
    clearTimeout(timer)
    btn.classList.remove('is-armed')
    if (labelEl) labelEl.textContent = base
  }
  btn.addEventListener('click', async () => {
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed')
      if (labelEl) labelEl.textContent = armedLabel
      timer = setTimeout(reset, 4000)
      return
    }
    reset()
    await action()
  })
  btn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== btn) reset() }, 150))
}

const toneOfStatus = (s, overdue) => (s === 'posted' ? ['Terposting', 'ok'] : s === 'cancelled' ? ['Dibatalkan', 'neutral'] : overdue ? ['Terlewat', 'warn'] : ['Terjadwal', 'brand'])

/* ---------------------------------------------------------- Data layer */

function createData() {
  const db = () => getCloud().database
  const subs = { library: new Set(), schedules: new Set() }
  const emit = (name) => subs[name].forEach((fn) => fn())
  const unwrap = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
  }
  const api = {
    library: null,
    schedules: null,
    libraryError: null,
    schedulesError: null,
    on(name, fn) { subs[name].add(fn); return () => subs[name].delete(fn) },
    async loadLibrary() {
      try {
        const rows = unwrap(await db().from('social_contents').select('*').order('created_at', { ascending: false }), 'Gagal memuat pustaka')
        api.library = (rows || []).map((r) => ({ ...r, meta: parseMeta(r.meta_json) }))
        api.libraryError = null
      } catch (err) {
        api.libraryError = err.message
      }
      emit('library')
    },
    async saveContent(row) {
      unwrap(await db().from('social_contents').insert(row), 'Gagal menyimpan')
      await api.loadLibrary()
    },
    async deleteContent(id) {
      unwrap(await db().from('social_contents').delete().eq('id', id), 'Gagal menghapus')
      await api.loadLibrary()
    },
    async loadSchedules() {
      try {
        const rows = unwrap(await db().from('social_schedules').select('*').order('scheduled_at', { ascending: true }), 'Gagal memuat jadwal')
        api.schedules = rows || []
        api.schedulesError = null
      } catch (err) {
        api.schedulesError = err.message
      }
      emit('schedules')
    },
    async addSchedule(row) {
      unwrap(await db().from('social_schedules').insert({ ...row, status: 'scheduled' }), 'Gagal menyimpan jadwal')
      await api.loadSchedules()
    },
    async setScheduleStatus(id, status) {
      unwrap(await db().from('social_schedules').update({ status }).eq('id', id), 'Gagal memperbarui jadwal')
      await api.loadSchedules()
    },
    async deleteSchedule(id) {
      unwrap(await db().from('social_schedules').delete().eq('id', id), 'Gagal menghapus jadwal')
      await api.loadSchedules()
    },
  }
  return api
}

/** Aggregates the user's real requests into topic suggestions (no names). */
async function loadBusiness() {
  const empty = { services: [], areas: [], requests: 0 }
  try {
    const { data, error } = await getCloud().database.from('requests').select('*').order('created_at', { ascending: false }).limit(100)
    if (error || !Array.isArray(data)) return empty
    const svc = new Map()
    const area = new Map()
    for (const r of data) {
      const name = String(r.service_type || '').trim()
      const loc = String(r.location || '').trim()
      if (name) {
        const k = name.toLowerCase()
        const cur = svc.get(k) || { name, count: 0, locs: new Map() }
        cur.count += 1
        if (loc) cur.locs.set(loc, (cur.locs.get(loc) || 0) + 1)
        svc.set(k, cur)
      }
      if (loc) {
        const k = loc.toLowerCase()
        const cur = area.get(k) || { name: loc, count: 0 }
        cur.count += 1
        area.set(k, cur)
      }
    }
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    return {
      requests: data.length,
      services: [...svc.values()].sort((a, b) => b.count - a.count).slice(0, 6).map((s) => ({ name: s.name, count: s.count, location: top(s.locs) })),
      areas: [...area.values()].sort((a, b) => b.count - a.count).slice(0, 4),
    }
  } catch {
    return empty
  }
}

/* -------------------------------------------------------------- Render */

export async function render(container, ctx = {}) {
  const params = ctx.params || {}
  const data = createData()
  const active = new Set() // AbortControllers of running generations
  ctx.signal?.addEventListener('abort', () => active.forEach((ac) => ac.abort()))

  let model = null
  const modelNotes = new Set()
  const modelNote = () => {
    const n = el('span', { className: 'model-note' }, model ? `Model: ${model.id}` : 'Model: memuat…')
    modelNotes.add(n)
    return n
  }
  resolveModel()
    .then((m) => { model = m; modelNotes.forEach((n) => { n.textContent = m ? `Model: ${m.id}` : 'Model: tidak tersedia' }) })
    .catch((err) => modelNotes.forEach((n) => { n.textContent = `Model: ${err.message}` }))

  let business = { services: [], areas: [], requests: 0 }
  const businessReady = loadBusiness().then((b) => { business = b; return b })

  /* ------------------------------------------------------------ Header */
  const header = el('header', { className: 'page-head' },
    el('div', { className: 'page-head-text' },
      el('span', { className: 'step-pill sm-pill' },
        el('span', { className: 'sm-pill-ico', 'aria-hidden': 'true' }, icon('megaphone', { size: 14 })),
        el('span', { className: 'step-text' }, 'Pertumbuhan', el('span', { 'aria-hidden': 'true' }, '·'), el('b', {}, 'Media sosial')),
      ),
      el('h1', { className: 'page-title display', tabindex: '-1' }, 'Media ', el('em', {}, 'sosial')),
      el('p', { className: 'page-desc' }, 'Tulis konten per platform, atur jadwal unggah, kumpulkan ide, dan susun rencana iklan Meta serta kolaborasi. Semua hasil AI bisa diedit sebelum disimpan ke pustaka.'),
    ),
  )

  /* -------------------------------------------------------------- Tabs */
  const tablist = el('div', { className: 'sm-tabs', role: 'tablist', 'aria-label': 'Alat media sosial' })
  const panelsWrap = el('div', { className: 'sm-panels' })
  const tabBtns = new Map()
  const tabPanels = new Map()
  const built = new Map()

  for (const t of TABS) {
    const b = el('button', {
      type: 'button', role: 'tab', className: 'sm-tab', id: `sm-tab-${t.key}`,
      'aria-controls': `sm-panel-${t.key}`, 'aria-selected': 'false', tabindex: '-1', dataset: { tab: t.key },
    }, icon(t.icon, { size: 16 }), el('span', {}, t.label))
    b.addEventListener('click', () => activate(t.key))
    tabBtns.set(t.key, b)
    tablist.appendChild(b)
    const p = el('div', { className: 'sm-panel', role: 'tabpanel', id: `sm-panel-${t.key}`, 'aria-labelledby': `sm-tab-${t.key}`, tabindex: '0', hidden: true })
    tabPanels.set(t.key, p)
    panelsWrap.appendChild(p)
  }
  tablist.addEventListener('keydown', (e) => {
    const keys = TABS.map((t) => t.key)
    const i = keys.indexOf(document.activeElement?.dataset?.tab)
    if (i < 0) return
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = keys[(i + 1) % keys.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = keys[(i - 1 + keys.length) % keys.length]
    else if (e.key === 'Home') next = keys[0]
    else if (e.key === 'End') next = keys[keys.length - 1]
    if (!next) return
    e.preventDefault()
    activate(next)
    tabBtns.get(next).focus()
  })

  const builders = {
    content: buildContent,
    schedule: buildSchedule,
    ideas: buildIdeas,
    ads: buildAds,
    partner: buildPartner,
    library: buildLibrary,
  }
  function ensure(key) {
    if (!built.has(key)) {
      const api = builders[key]()
      built.set(key, api)
      tabPanels.get(key).replaceChildren(api.root)
    }
    return built.get(key)
  }
  function activate(key) {
    if (!builders[key]) key = 'content'
    for (const [k, b] of tabBtns) {
      const on = k === key
      b.setAttribute('aria-selected', on ? 'true' : 'false')
      b.tabIndex = on ? 0 : -1
      tabPanels.get(k).hidden = !on
    }
    store.set(TAB_STORE, key)
    const api = ensure(key)
    api.onShow?.()
    return api
  }
  function go(key, payload) {
    const api = activate(key)
    api.prefill?.(payload)
    tabBtns.get(key).scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    tablist.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  container.replaceChildren(header, el('div', { className: 'sm-wrap' }, tablist, panelsWrap))

  /* --------------------------------------------------- Shared AI runner */

  async function runAI({ out, msg, btn, busyLabel, run, onDone }) {
    msg.hide()
    if (!model) {
      msg.show('danger', 'Model AI belum tersedia. Periksa koneksi lalu muat ulang halaman.')
      return
    }
    const ac = new AbortController()
    active.add(ac)
    const restore = C.setBusy(btn, busyLabel)
    const ui = C.aiConsole({ model: model.id })
    ui.onStop(() => ac.abort())
    ui.setStatus('Menulis…', true)
    ui.write('')
    out.replaceChildren(ui.root)
    revealOutput(out)
    try {
      await businessReady
      const res = await abortable(run({
        modelId: model.id,
        signal: ac.signal,
        business,
        onChunk: (_d, full) => { if (!ac.signal.aborted) ui.write(full) },
      }), ac.signal)
      ui.done()
      ui.setStatus('Selesai', false)
      ui.root.classList.add('is-folded')
      out.appendChild(onDone(res))
    } catch (err) {
      ui.done()
      if (err.name === 'AbortError') {
        ui.setStatus('Dihentikan', false)
        msg.show('info', 'Pembuatan dihentikan. Tidak ada yang disimpan.')
      } else {
        ui.setStatus('Gagal', false)
        msg.show('danger', err.message)
      }
    } finally {
      active.delete(ac)
      restore()
    }
  }

  /** On stacked layouts the output sits below the form: bring it into view. */
  function revealOutput(node) {
    const r = node.getBoundingClientRect()
    if (r.top >= 0 && r.top < window.innerHeight - 120) return
    node.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  /** Save button that flips to a disabled "Tersimpan" state on success. */
  function saveButton(getRow, { label = 'Simpan ke pustaka', size = '', variant = 'primary', onSaved } = {}) {
    const b = C.button({ label, icon: 'bookmark', variant, size })
    b.addEventListener('click', async () => {
      const row = getRow()
      if (!row) return
      const restore = C.setBusy(b, 'Menyimpan…')
      try {
        await data.saveContent(row)
        restore()
        b.disabled = true
        b.classList.add('is-saved')
        b.querySelector('.btn-label').textContent = 'Tersimpan'
        b.replaceChild(icon('check'), b.querySelector('svg'))
        showToast('Disimpan ke pustaka.', 'success')
        onSaved?.()
      } catch (err) {
        restore()
        showToast(err.message, 'error')
      }
    })
    return b
  }

  /** "Dari permintaan Anda" chips, filled once business data arrives. */
  function suggestions(onPick, { withLocation = false, hintEl } = {}) {
    const box = el('div', { className: 'sm-suggest', hidden: true })
    businessReady.then((b) => {
      if (!b.services.length) {
        if (hintEl) hintEl.textContent = 'Belum ada permintaan tercatat, jadi belum ada saran topik. Tulis topik sendiri.'
        return
      }
      box.replaceChildren(
        el('span', { className: 'sm-suggest-label' }, icon('inbox', { size: 14 }), 'Dari permintaan Anda'),
        el('div', { className: 'sm-chips' }, b.services.slice(0, 4).map((s) => {
          const text = withLocation && s.location ? `${s.name} di ${s.location}` : s.name
          return el('button', {
            type: 'button', className: 'sm-chip',
            title: `${s.count} permintaan${s.location ? ` · terbanyak di ${s.location}` : ''}`,
            onClick: () => onPick(s, text),
          }, s.name, s.count > 1 ? el('span', { className: 'sm-chip-count tnum' }, `${s.count}×`) : null)
        })),
      )
      box.hidden = false
    })
    return box
  }

  function emptyResult(title, body, iconName = 'sparkles') {
    return C.emptyState({ kicker: 'Belum ada hasil', title, body, iconName })
  }

  function rawFallback(raw, onSaveRow) {
    const ta = C.textarea({ label: 'Teks dari AI', rows: 10, value: raw })
    return el('div', { className: 'sm-result' },
      el('div', { className: 'note note-warn' }, icon('alert'), el('div', { className: 'note-body' },
        el('p', {}, 'AI tidak mengembalikan format terstruktur. Teks aslinya ditampilkan di bawah dan tetap bisa diedit, disalin, atau disimpan.'))),
      ta.wrap,
      el('div', { className: 'form-actions' },
        saveButton(() => onSaveRow(ta.input.value.trim())),
        copyBtn(() => ta.input.value, 'Teks'),
      ),
    )
  }

  function copyBtn(getText, what = 'Teks', { size = '', label = 'Salin', variant = 'soft' } = {}) {
    const b = C.button({ label, icon: 'copy', variant, size })
    b.addEventListener('click', () => copyText(getText(), what))
    return b
  }

  function hashtagChips(tags, { toggle = false, onChange } = {}) {
    const wrap = el('div', { className: 'sm-tags', role: toggle ? 'group' : undefined, 'aria-label': toggle ? 'Hashtag yang disertakan' : 'Hashtag, klik untuk menyalin' })
    const selected = new Set(tags)
    tags.forEach((t) => {
      const b = el('button', { type: 'button', className: 'sm-hashtag' }, t)
      if (toggle) {
        b.setAttribute('aria-pressed', 'true')
        b.title = 'Klik untuk menyertakan atau melepas'
        b.addEventListener('click', () => {
          if (selected.has(t)) selected.delete(t)
          else selected.add(t)
          b.setAttribute('aria-pressed', selected.has(t) ? 'true' : 'false')
          onChange?.([...tags].filter((x) => selected.has(x)))
        })
      } else {
        b.title = 'Klik untuk menyalin'
        b.addEventListener('click', () => copyText(t, 'Hashtag'))
      }
      wrap.appendChild(b)
    })
    wrap.selected = () => tags.filter((x) => selected.has(x))
    return wrap
  }

  const sectionLabel = (text, iconName) => el('h3', { className: 'sm-sub' }, iconName ? icon(iconName, { size: 15 }) : null, text)

  /* =========================================================== Konten */
  function buildContent() {
    const platform = C.select({ label: 'Platform', name: 'platform', options: AI.PLATFORMS, value: 'instagram' })
    const type = C.select({ label: 'Jenis konten', name: 'type', options: AI.CONTENT_TYPES, value: 'caption' })
    const topic = C.field({ label: 'Topik, produk, atau layanan', name: 'topic', required: true, placeholder: 'Contoh: Pembersihan AC rumah di Jakarta Selatan' })
    const tone = C.select({ label: 'Nada', name: 'tone', options: AI.TONES, value: 'casual' })
    const cta = C.field({ label: 'Ajakan bertindak', name: 'cta', placeholder: 'Contoh: Chat WhatsApp 0812-xxxx-xxxx', hint: 'Opsional. Jika kosong, AI memilih ajakan yang cocok.' })
    const hint = el('span', { className: 'field-hint' })
    const genBtn = C.button({ label: 'Buat konten', icon: 'sparkles', variant: 'primary', type: 'submit' })
    const msg = C.message()
    const sugg = suggestions((_s, text) => { topic.input.value = text; topic.input.focus() }, { withLocation: true, hintEl: hint })
    topic.wrap.append(hint, sugg)

    const form = el('form', { className: 'form', novalidate: true },
      el('div', { className: 'form-row keep-row' }, platform.wrap, type.wrap),
      topic.wrap,
      tone.wrap,
      cta.wrap,
      el('div', { className: 'form-actions' }, genBtn, modelNote()),
      msg,
    )
    const formPanel = C.panel({ title: 'Tulis konten', meta: 'Dibantu AI · per platform', raised: true, className: 'form-panel' }, form)

    // Hashtag generator (ported from the PR's mini tool, now AI-backed)
    const htTopic = C.field({ label: 'Topik hashtag', name: 'ht_topic', placeholder: 'Contoh: cuci sofa Bandung' })
    const htBtn = C.button({ label: 'Buat hashtag', icon: 'hash', variant: 'soft', type: 'submit' })
    const htMsg = C.message()
    const htOut = el('div', { className: 'sm-out' })
    const htForm = el('form', { className: 'form', novalidate: true },
      htTopic.wrap,
      el('div', { className: 'form-actions' }, htBtn),
      htMsg,
    )
    const htPanel = C.panel({ title: 'Generator hashtag', meta: 'Mengikuti platform di atas', className: 'form-panel' }, htForm, htOut)
    htForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const t = htTopic.input.value.trim() || topic.input.value.trim()
      if (!t) { htMsg.show('danger', 'Isi topik hashtag terlebih dahulu.'); htTopic.input.focus(); return }
      runAI({
        out: htOut, msg: htMsg, btn: htBtn, busyLabel: 'Menyusun…',
        run: (r) => AI.generateHashtags({ topic: t, platform: platform.input.value, count: 15, ...r }),
        onDone: ({ data: d, raw }) => {
          const tags = d?.hashtags || AI.normalizeHashtags(raw.match(/#[\p{L}\p{N}_]+/gu) || [])
          if (!tags.length) return el('p', { className: 'muted small' }, 'Tidak ada hashtag yang bisa dibaca dari jawaban AI. Coba lagi.')
          return el('div', { className: 'sm-ht-result' },
            hashtagChips(tags),
            el('div', { className: 'form-actions' }, copyBtn(() => tags.join(' '), 'Hashtag', { size: 'sm', label: 'Salin semua' })),
          )
        },
      })
    })

    const out = el('div', { className: 'sm-out' }, emptyResult('Draf konten muncul di sini.', 'Pilih platform dan topik, lalu tekan Buat konten. Hasilnya bisa diedit, disimpan, atau langsung dijadwalkan.'))
    const resultPanel = C.panel({ title: 'Hasil', meta: 'Edit sebelum dipakai', className: 'sm-result-panel' }, out)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const t = topic.input.value.trim()
      if (!t) {
        msg.show('danger', 'Isi topik konten terlebih dahulu.')
        topic.input.setAttribute('aria-invalid', 'true')
        topic.input.focus()
        return
      }
      topic.input.removeAttribute('aria-invalid')
      const input = { platform: platform.input.value, type: type.input.value, topic: t, tone: tone.input.value, cta: cta.input.value.trim() }
      runAI({
        out, msg, btn: genBtn, busyLabel: 'Menulis…',
        run: (r) => AI.generateContent({ ...input, ...r }),
        onDone: (res) => contentResult(res, input),
      })
    })

    function contentResult({ data: d, raw }, input) {
      const p = AI.PLATFORMS.find((x) => x.value === input.platform) || AI.PLATFORMS[0]
      if (!d) {
        return rawFallback(raw, (body) => body && ({ kind: 'content', platform: input.platform, title: input.topic.slice(0, 80), body, meta_json: { ...input, hashtags: [], model: model?.id } }))
      }
      const lines = d.body.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 72)), 0)
      const body = C.textarea({ label: 'Teks konten', rows: Math.min(16, Math.max(5, lines + 1)), value: d.body, hint: 'Boleh diedit. Hashtag ditambahkan di akhir saat disalin atau dijadwalkan.' })
      const counter = el('span', { className: 'sm-count tnum', 'aria-live': 'polite' })
      let tags = d.hashtags
      const chips = d.hashtags.length ? hashtagChips(d.hashtags, { toggle: true, onChange: (sel) => { tags = sel; count() } }) : null
      const fullText = () => AI.contentText(body.input.value, tags)
      const count = () => {
        const n = fullText().length
        counter.textContent = `${n.toLocaleString('id-ID')} / ${p.limit.toLocaleString('id-ID')} karakter`
        counter.classList.toggle('is-over', n > p.limit)
      }
      body.input.addEventListener('input', count)
      const hintEl = body.wrap.querySelector('.field-hint')
      body.wrap.appendChild(el('div', { className: 'sm-field-foot' }, hintEl, counter))
      count()

      const schedBtn = C.button({ label: 'Jadwalkan', icon: 'calendar', iconRight: 'arrowRight', variant: 'soft' })
      schedBtn.addEventListener('click', () => go('schedule', {
        platform: input.platform,
        content: fullText(),
        postType: input.type === 'ad_copy' ? 'ads' : input.type === 'story' ? 'story' : 'organic',
      }))

      return el('div', { className: 'sm-result' },
        el('div', { className: 'sm-result-head' },
          el('div', { className: 'sm-result-tags' },
            el('span', { className: 'tag tag-accent' }, icon('sparkles', { size: 14 }), 'Draf AI'),
            C.tag(p.label, 'brand'),
            el('span', { className: 'muted small' }, AI.labelOf(AI.CONTENT_TYPES, input.type)),
          ),
          el('p', { className: 'sm-result-title display' }, d.title || input.topic),
        ),
        body.wrap,
        chips ? el('div', { className: 'sm-block' }, sectionLabel('Hashtag', 'hash'), chips) : null,
        d.notes ? el('p', { className: 'sm-tip' }, icon('info', { size: 15 }), el('span', {}, d.notes)) : null,
        el('div', { className: 'form-actions' },
          saveButton(() => ({
            kind: 'content',
            platform: input.platform,
            title: (d.title || input.topic).slice(0, 120),
            body: body.input.value.trim(),
            meta_json: { type: input.type, tone: input.tone, topic: input.topic, cta: input.cta, hashtags: tags, notes: d.notes, model: model?.id },
          })),
          copyBtn(fullText, 'Konten'),
          schedBtn,
        ),
      )
    }

    return {
      root: el('div', { className: 'stage-grid sm-grid' }, el('div', { className: 'sm-col' }, formPanel, htPanel), resultPanel),
      prefill({ topic: t, platform: pl, type: ty } = {}) {
        if (t) topic.input.value = t
        if (pl && AI.PLATFORMS.some((x) => x.value === pl)) platform.input.value = pl
        if (ty) type.input.value = ty
        msg.show('info', 'Topik dari ide sudah diisi. Periksa lalu tekan Buat konten.')
        topic.input.focus({ preventScroll: true })
      },
    }
  }

  /* ============================================================ Jadwal */
  function buildSchedule() {
    const platform = C.select({ label: 'Platform', name: 'platform', options: AI.PLATFORMS, value: 'instagram' })
    const postType = C.select({ label: 'Tipe', name: 'post_type', options: AI.POST_TYPES, value: 'organic' })
    const content = C.textarea({ label: 'Konten atau caption', name: 'content', required: true, rows: 6, placeholder: 'Tulis atau tempel konten yang akan diunggah…' })
    const when = C.field({ label: 'Tanggal dan jam', name: 'scheduled_at', type: 'datetime-local', required: true, value: toLocalInput(nextSlot()) })
    const addBtn = C.button({ label: 'Tambah ke jadwal', icon: 'plus', variant: 'primary', type: 'submit' })
    const msg = C.message()
    const form = el('form', { className: 'form', novalidate: true },
      el('div', { className: 'form-row keep-row' }, platform.wrap, postType.wrap),
      content.wrap,
      when.wrap,
      el('div', { className: 'form-actions' }, addBtn),
      msg,
      el('p', { className: 'sm-fine' }, icon('info', { size: 14 }), el('span', {}, 'Satu Alur tidak mengunggah otomatis. Jadwal ini menjadi daftar kerja: tandai terposting setelah Anda mengunggah.')),
    )
    const formPanel = C.panel({ title: 'Tambah jadwal', meta: 'Rencana unggahan', raised: true, className: 'form-panel' }, form)

    let filter = 'upcoming'
    const seg = C.segmented({
      label: 'Tampilkan jadwal',
      value: filter,
      options: [{ value: 'upcoming', label: 'Mendatang' }, { value: 'history', label: 'Riwayat' }, { value: 'all', label: 'Semua' }],
      onChange: (v) => { filter = v; draw() },
    })
    const listBody = el('div', { className: 'sm-sched-body' }, C.skeletonRows(4))
    const listPanel = C.panel({ title: 'Jadwal posting', meta: 'memuat…', actions: seg, className: 'sm-sched-panel' }, listBody)

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      msg.hide()
      const text = content.input.value.trim()
      const d = C.toDate(when.input.value)
      const errs = []
      if (!text) errs.push('Isi konten yang akan diunggah.')
      if (!d) errs.push('Pilih tanggal dan jam.')
      content.input.setAttribute('aria-invalid', String(!text))
      when.input.setAttribute('aria-invalid', String(!d))
      if (errs.length) { msg.show('danger', 'Jadwal belum lengkap.', errs); (!text ? content.input : when.input).focus(); return }
      const restore = C.setBusy(addBtn, 'Menyimpan…')
      try {
        await data.addSchedule({ platform: platform.input.value, post_type: postType.input.value, content: text, scheduled_at: d.toISOString() })
        restore()
        content.input.value = ''
        when.input.value = toLocalInput(nextSlot(d))
        const past = d.getTime() < Date.now()
        msg.show(past ? 'warn' : 'ok', past ? `Disimpan untuk ${C.formatDateTime(d)} — waktu ini sudah lewat, jadi ditandai terlewat.` : `Dijadwalkan ${AI.platformLabel(platform.input.value)} pada ${C.formatDateTime(d)}.`)
        showToast('Jadwal ditambahkan.', 'success')
        if (filter === 'history') seg.querySelector('[data-value="upcoming"]')?.click()
      } catch (err) {
        restore()
        msg.show('danger', err.message)
      }
    })

    function itemActions(s) {
      const box = el('div', { className: 'sm-sched-actions' })
      if (s.status === 'scheduled') {
        const done = C.button({ label: 'Tandai terposting', icon: 'check', size: 'sm', variant: 'soft' })
        done.addEventListener('click', async () => {
          const r = C.setBusy(done, 'Menyimpan…')
          try { await data.setScheduleStatus(s.id, 'posted'); showToast('Ditandai terposting.', 'success') } catch (err) { r(); showToast(err.message, 'error') }
        })
        const cancel = C.button({ label: 'Batalkan', icon: 'x', size: 'sm', variant: 'ghost' })
        cancel.addEventListener('click', async () => {
          const r = C.setBusy(cancel, 'Membatalkan…')
          try { await data.setScheduleStatus(s.id, 'cancelled'); showToast('Jadwal dibatalkan.', 'info') } catch (err) { r(); showToast(err.message, 'error') }
        })
        box.append(done, cancel)
      } else {
        const back = C.button({ label: 'Jadwalkan lagi', icon: 'refresh', size: 'sm', variant: 'ghost' })
        back.addEventListener('click', async () => {
          const r = C.setBusy(back, 'Menyimpan…')
          try { await data.setScheduleStatus(s.id, 'scheduled'); showToast('Dikembalikan ke jadwal.', 'info') } catch (err) { r(); showToast(err.message, 'error') }
        })
        box.append(back)
      }
      const del = C.button({ label: 'Hapus', icon: 'trash', size: 'sm', variant: 'ghost', className: 'sm-del' })
      confirmAction(del, 'Yakin hapus?', async () => {
        try { await data.deleteSchedule(s.id); showToast('Jadwal dihapus.', 'info') } catch (err) { showToast(err.message, 'error') }
      })
      box.append(copyIcon(() => s.content), del)
      return box
    }

    function copyIcon(getText) {
      const b = C.iconButton({ iconName: 'copy', label: 'Salin konten', className: 'sm-icon-btn' })
      b.addEventListener('click', () => copyText(getText(), 'Konten'))
      return b
    }

    function draw() {
      if (data.schedulesError) { listBody.replaceChildren(C.errorState(data.schedulesError)); return }
      const rows = data.schedules
      if (!rows) return
      const now = Date.now()
      const startToday = new Date().setHours(0, 0, 0, 0)
      const items = rows.map((s) => ({ ...s, at: C.toDate(s.scheduled_at) })).filter((s) => s.at)
      const scheduled = items.filter((s) => s.status === 'scheduled')
      const overdue = scheduled.filter((s) => s.at.getTime() < now)
      const weekEnd = startToday + 7 * 86400000
      const thisWeek = scheduled.filter((s) => s.at.getTime() >= now && s.at.getTime() < weekEnd).length
      const posted = items.filter((s) => s.status === 'posted').length
      listPanel.querySelector('.panel-meta').textContent = items.length
        ? `${scheduled.length - overdue.length} mendatang · ${thisWeek} dalam 7 hari · ${posted} terposting${overdue.length ? ` · ${overdue.length} terlewat` : ''}`
        : 'Belum ada jadwal'

      let shown
      if (filter === 'upcoming') shown = scheduled
      else if (filter === 'history') shown = items.filter((s) => s.status !== 'scheduled').sort((a, b) => b.at - a.at)
      else shown = items

      if (!shown.length) {
        const empty = filter === 'history'
          ? C.emptyState({ kicker: 'Riwayat kosong', title: 'Belum ada unggahan yang ditandai.', body: 'Jadwal yang ditandai terposting atau dibatalkan muncul di sini.', iconName: 'clock' })
          : C.emptyState({ kicker: items.length ? 'Tidak ada yang mendatang' : 'Belum ada jadwal', title: items.length ? 'Semua jadwal sudah selesai.' : 'Rencanakan unggahan pertama.', body: 'Isi formulir di samping, atau buat konten dengan AI lalu pilih Jadwalkan.', iconName: 'calendar' })
        if (!items.length) {
          const b = C.button({ label: 'Buat konten dengan AI', icon: 'sparkles', size: 'sm', variant: 'soft' })
          b.addEventListener('click', () => go('content'))
          empty.appendChild(b)
        }
        listBody.replaceChildren(empty)
        return
      }

      const groups = new Map()
      for (const s of shown) {
        const k = dayKey(s.at)
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k).push(s)
      }
      listBody.replaceChildren(el('div', { className: 'sm-days' }, [...groups.values()].map((list) => {
        const lbl = dayLabel(list[0].at)
        const isToday = dayKey(list[0].at) === dayKey(new Date())
        return el('section', { className: `sm-day ${isToday ? 'is-today' : ''}`.trim(), 'aria-label': `${lbl.main}, ${lbl.sub}` },
          el('h3', { className: 'sm-day-head' }, el('span', { className: 'sm-day-main' }, lbl.main), el('span', { className: 'sm-day-sub' }, lbl.sub), el('span', { className: 'sm-day-count tnum' }, `${list.length} unggahan`)),
          el('ol', { className: 'sm-sched-list' }, list.map((s) => {
            const isOver = s.status === 'scheduled' && s.at.getTime() < now
            const [st, tone] = toneOfStatus(s.status, isOver)
            return el('li', { className: `sm-sched-item is-${s.status} ${isOver ? 'is-overdue' : ''}`.trim(), dataset: { id: String(s.id) } },
              el('time', { className: 'sm-sched-time tnum', datetime: s.at.toISOString(), title: C.formatDateTime(s.at) }, timeOf(s.at)),
              el('div', { className: 'sm-sched-main' },
                el('div', { className: 'sm-sched-meta' },
                  el('span', { className: 'sm-plat' }, AI.platformLabel(s.platform)),
                  s.post_type ? el('span', { className: 'muted small' }, AI.labelOf(AI.POST_TYPES, s.post_type)) : null,
                  C.tag(st, tone),
                ),
                el('p', { className: 'sm-sched-text' }, s.content),
                itemActions(s),
              ),
            )
          })),
        )
      })))
    }

    data.on('schedules', draw)
    data.loadSchedules()

    return {
      root: el('div', { className: 'stage-grid sm-grid' }, formPanel, listPanel),
      prefill({ platform: pl, content: text, postType: pt } = {}) {
        if (pl && AI.PLATFORMS.some((x) => x.value === pl)) platform.input.value = pl
        if (pt) postType.input.value = pt
        if (text) content.input.value = text
        msg.show('info', 'Konten sudah diisi. Pilih tanggal dan jam, lalu tambahkan ke jadwal.')
        when.input.focus({ preventScroll: true })
      },
    }
  }

  /* =============================================================== Ide */
  function buildIdeas() {
    const topic = C.field({ label: 'Tema atau topik utama', name: 'topic', required: true, placeholder: 'Contoh: Tips perawatan AC di musim hujan' })
    const platform = C.select({ label: 'Platform target', name: 'platform', options: [{ value: 'all', label: 'Semua platform' }, ...AI.PLATFORMS], value: 'all' })
    const count = C.select({ label: 'Jumlah ide', name: 'count', options: [{ value: '5', label: '5 ide' }, { value: '10', label: '10 ide' }, { value: '20', label: '20 ide' }], value: '10' })
    const hint = el('span', { className: 'field-hint' })
    topic.wrap.append(hint, suggestions((_s, text) => { topic.input.value = text; topic.input.focus() }, { hintEl: hint }))
    const genBtn = C.button({ label: 'Mulai brainstorm', icon: 'lightbulb', variant: 'primary', type: 'submit' })
    const msg = C.message()
    const form = el('form', { className: 'form', novalidate: true },
      topic.wrap,
      el('div', { className: 'form-row' }, platform.wrap, count.wrap),
      el('div', { className: 'form-actions' }, genBtn, modelNote()),
      msg,
    )
    const formPanel = C.panel({ title: 'Brainstorm ide', meta: 'Bersama AI', raised: true, className: 'form-panel' }, form)
    const out = el('div', { className: 'sm-out' }, emptyResult('Ide konten muncul di sini.', 'Simpan ide yang Anda suka ke pustaka, atau jadikan konten untuk ditulis lengkap.', 'lightbulb'))
    const resultPanel = C.panel({ title: 'Ide konten', meta: 'Tanpa estimasi engagement', className: 'sm-result-panel' }, out)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const t = topic.input.value.trim()
      if (!t) { msg.show('danger', 'Isi tema brainstorm terlebih dahulu.'); topic.input.focus(); return }
      const input = { topic: t, platform: platform.input.value, count: Number(count.input.value) }
      runAI({
        out, msg, btn: genBtn, busyLabel: 'Berpikir…',
        run: (r) => AI.brainstormIdeas({ ...input, ...r }),
        onDone: ({ data: d, raw }) => {
          const plat = input.platform === 'all' ? null : input.platform
          if (!d) return rawFallback(raw, (body) => body && ({ kind: 'brainstorm', platform: plat, title: `Ide: ${t}`.slice(0, 120), body, meta_json: { topic: t } }))
          const rowOf = (i) => ({ kind: 'brainstorm', platform: plat, title: i.title.slice(0, 120) || t, body: AI.ideaText(i), meta_json: { topic: t, ...i } })
          const allBtn = C.button({ label: 'Simpan semua', icon: 'bookmark', size: 'sm', variant: 'soft' })
          allBtn.addEventListener('click', async () => {
            const restore = C.setBusy(allBtn, 'Menyimpan…')
            try {
              const rows = d.ideas.map(rowOf)
              const { error } = await getCloud().database.from('social_contents').insert(rows)
              if (error) throw new Error(error.message)
              await data.loadLibrary()
              restore()
              allBtn.disabled = true
              allBtn.querySelector('.btn-label').textContent = 'Semua tersimpan'
              out.querySelectorAll('.sm-idea .is-save').forEach((b) => { b.disabled = true; b.querySelector('.btn-label').textContent = 'Tersimpan' })
              showToast(`${rows.length} ide disimpan ke pustaka.`, 'success')
            } catch (err) { restore(); showToast(`Gagal menyimpan: ${err.message}`, 'error') }
          })
          return el('div', { className: 'sm-result' },
            el('div', { className: 'sm-result-bar' },
              el('span', { className: 'muted small' }, `${d.ideas.length} ide untuk “${t}”`),
              allBtn,
            ),
            el('ol', { className: 'sm-ideas' }, d.ideas.map((i, n) => {
              const save = saveButton(() => rowOf(i), { label: 'Simpan', size: 'sm', variant: 'ghost' })
              save.classList.add('is-save')
              const use = C.button({ label: 'Jadikan konten', iconRight: 'arrowRight', size: 'sm', variant: 'soft' })
              use.addEventListener('click', () => go('content', {
                topic: [i.title, i.hook].filter(Boolean).join('. '),
                platform: plat,
                type: /video|reel|tiktok/i.test(i.format) ? 'script' : /story/i.test(i.format) ? 'story' : 'caption',
              }))
              return el('li', { className: 'sm-idea' },
                el('div', { className: 'sm-idea-top' },
                  el('span', { className: 'sm-idea-num tnum', 'aria-hidden': 'true' }, pad(n + 1)),
                  i.format ? el('span', { className: 'tag' }, i.format) : null,
                ),
                el('h4', { className: 'sm-idea-title' }, i.title),
                i.hook ? el('p', { className: 'sm-hook' }, i.hook) : null,
                i.concept ? el('p', { className: 'sm-idea-body' }, i.concept) : null,
                el('div', { className: 'sm-idea-actions' }, use, save),
              )
            })),
          )
        },
      })
    })

    return {
      root: el('div', { className: 'stage-grid sm-grid' }, formPanel, resultPanel),
    }
  }

  /* ======================================================== Iklan Meta */
  function buildAds() {
    const service = C.field({ label: 'Jenis layanan', name: 'service', required: true, placeholder: 'Contoh: Jasa pembersihan AC rumah' })
    const location = C.field({ label: 'Lokasi target', name: 'location', placeholder: 'Contoh: Jakarta Selatan, radius 10 km' })
    const budget = C.field({ label: 'Anggaran harian (Rp)', name: 'budget', type: 'number', placeholder: '100000', hint: 'Opsional. Dipakai untuk membagi anggaran, bukan untuk memperkirakan hasil.', attrs: { min: '0', step: '10000', inputmode: 'numeric' } })
    const objective = C.select({ label: 'Tujuan kampanye', name: 'objective', options: AI.AD_OBJECTIVES, value: 'messages' })
    const hint = el('span', { className: 'field-hint' })
    service.wrap.append(hint, suggestions((s) => {
      service.input.value = s.name
      if (s.location && !location.input.value) location.input.value = s.location
      service.input.focus()
    }, { hintEl: hint }))
    businessReady.then((b) => { if (b.areas.length && !location.input.value) location.input.placeholder = `Contoh: ${b.areas.map((a) => a.name).slice(0, 2).join(', ')}` })
    const genBtn = C.button({ label: 'Susun rencana iklan', icon: 'target', variant: 'primary', type: 'submit' })
    const msg = C.message()
    const form = el('form', { className: 'form', novalidate: true },
      service.wrap,
      location.wrap,
      objective.wrap,
      budget.wrap,
      el('div', { className: 'form-actions' }, genBtn, modelNote()),
      msg,
    )
    const formPanel = C.panel({ title: 'Optimasi iklan Meta', meta: 'Facebook & Instagram', raised: true, className: 'form-panel' }, form)
    const out = el('div', { className: 'sm-out' }, emptyResult('Rencana iklan muncul di sini.', 'AI menyarankan audiens, penempatan, pembagian anggaran, dan tiga variasi materi iklan untuk diuji.', 'target'))
    const resultPanel = C.panel({ title: 'Rencana awal', meta: 'Hipotesis untuk diuji', className: 'sm-result-panel' }, out)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const s = service.input.value.trim()
      if (!s) { msg.show('danger', 'Isi jenis layanan terlebih dahulu.'); service.input.focus(); return }
      const input = { service: s, location: location.input.value.trim(), budget: Number(budget.input.value) || 0, objective: objective.input.value }
      runAI({
        out, msg, btn: genBtn, busyLabel: 'Menyusun…',
        run: (r) => AI.planMetaAds({ ...input, ...r }),
        onDone: ({ data: d, raw }) => {
          const title = `Iklan Meta: ${s}`.slice(0, 120)
          if (!d) return rawFallback(raw, (body) => body && ({ kind: 'ads', platform: 'meta', title, body, meta_json: input }))
          const a = d.audience
          const tagList = (xs) => (xs.length ? el('div', { className: 'sm-taglist' }, xs.map((x) => el('span', { className: 'tag' }, x))) : el('span', { className: 'muted' }, '—'))
          return el('div', { className: 'sm-result' },
            el('div', { className: 'note note-info' }, icon('info'), el('div', { className: 'note-body' },
              el('p', {}, 'Ini titik awal untuk diuji, bukan prediksi. Satu Alur tidak terhubung ke akun iklan Anda, jadi tidak ada perkiraan jangkauan atau biaya. Ukur hasilnya di Meta Ads Manager.'))),
            el('div', { className: 'sm-block' }, sectionLabel('Audiens', 'users'),
              C.defList([
                ['Usia', a.age_range || '—'],
                ['Gender', a.gender || '—'],
                ['Lokasi', a.locations.length ? a.locations.join('; ') : (input.location || '—')],
                ['Minat', tagList(a.interests)],
                ['Perilaku', tagList(a.behaviors)],
              ])),
            el('div', { className: 'sm-block' }, sectionLabel('Penayangan', 'clock'),
              C.defList([
                ['Penempatan', tagList(d.placements)],
                ['Jam tayang', d.schedule || '—'],
                ['Anggaran', d.budget_plan || '—'],
              ])),
            d.ad_copies.length ? el('div', { className: 'sm-block' }, sectionLabel('Materi iklan', 'megaphone'),
              el('ol', { className: 'sm-copies' }, d.ad_copies.map((c, n) => el('li', { className: 'sm-copy' },
                el('div', { className: 'sm-copy-top' },
                  el('span', { className: 'sm-copy-num tnum' }, `Variasi ${n + 1}`),
                  copyBtn(() => [c.headline, c.primary_text, c.cta && `Tombol: ${c.cta}`].filter(Boolean).join('\n'), 'Materi iklan', { size: 'sm', variant: 'ghost' }),
                ),
                el('p', { className: 'sm-copy-head' }, c.headline),
                el('p', { className: 'sm-copy-text' }, c.primary_text),
                c.cta ? el('span', { className: 'tag tag-accent' }, c.cta) : null,
              )))) : null,
            d.hashtags.length ? el('div', { className: 'sm-block' }, sectionLabel('Hashtag versi organik', 'hash'), hashtagChips(d.hashtags)) : null,
            d.tips.length ? el('div', { className: 'sm-block' }, sectionLabel('Langkah optimasi', 'activity'), el('ol', { className: 'sm-steps' }, d.tips.map((t) => el('li', {}, t)))) : null,
            el('div', { className: 'form-actions' },
              saveButton(() => ({ kind: 'ads', platform: 'meta', title, body: AI.adsText(d), meta_json: { ...input, plan: d, model: model?.id } })),
              copyBtn(() => AI.adsText(d), 'Rencana iklan', { label: 'Salin semua' }),
            ),
          )
        },
      })
    })

    return { root: el('div', { className: 'stage-grid sm-grid' }, formPanel, resultPanel) }
  }

  /* ======================================================== Kolaborasi */
  function buildPartner() {
    const service = C.field({ label: 'Layanan Anda', name: 'service', required: true, placeholder: 'Contoh: Cuci sofa dan karpet' })
    const location = C.field({ label: 'Area', name: 'location', placeholder: 'Contoh: Bandung' })
    const goal = C.select({ label: 'Tujuan kolaborasi', name: 'goal', options: AI.PARTNER_GOALS, value: 'reach' })
    const offer = C.textarea({ label: 'Yang bisa Anda tawarkan ke mitra', name: 'offer', rows: 3, placeholder: 'Contoh: diskon 10% untuk pelanggan mitra, komisi rujukan, konten bersama', hint: 'Opsional.' })
    const hint = el('span', { className: 'field-hint' })
    service.wrap.append(hint, suggestions((s) => {
      service.input.value = s.name
      if (s.location && !location.input.value) location.input.value = s.location
      service.input.focus()
    }, { hintEl: hint }))
    const genBtn = C.button({ label: 'Cari ide kolaborasi', icon: 'handshake', variant: 'primary', type: 'submit' })
    const msg = C.message()
    const form = el('form', { className: 'form', novalidate: true },
      service.wrap,
      location.wrap,
      goal.wrap,
      offer.wrap,
      el('div', { className: 'form-actions' }, genBtn, modelNote()),
      msg,
    )
    const formPanel = C.panel({ title: 'Ide kolaborasi', meta: 'Mitra lokal, komunitas, kreator', raised: true, className: 'form-panel' }, form)
    const out = el('div', { className: 'sm-out' }, emptyResult('Ide kolaborasi muncul di sini.', 'Setiap ide berisi jenis mitra, alasan cocok, apa yang ditukar, pesan ajakan siap kirim, dan langkah pertama.', 'handshake'))
    const resultPanel = C.panel({ title: 'Usulan mitra', meta: 'Pesan ajakan bisa langsung disalin', className: 'sm-result-panel' }, out)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const s = service.input.value.trim()
      if (!s) { msg.show('danger', 'Isi layanan Anda terlebih dahulu.'); service.input.focus(); return }
      const input = { service: s, location: location.input.value.trim(), goal: goal.input.value, offer: offer.input.value.trim() }
      runAI({
        out, msg, btn: genBtn, busyLabel: 'Mencari…',
        run: (r) => AI.partnershipIdeas({ ...input, ...r }),
        onDone: ({ data: d, raw }) => {
          if (!d) return rawFallback(raw, (body) => body && ({ kind: 'partnership', platform: null, title: `Kolaborasi: ${s}`.slice(0, 120), body, meta_json: input }))
          return el('div', { className: 'sm-result' },
            el('ol', { className: 'sm-partners' }, d.ideas.map((i) => el('li', { className: 'sm-partner' },
              el('h4', { className: 'sm-idea-title' }, i.partner),
              C.defList([
                ['Alasan', i.why || '—'],
                ['Pertukaran', i.offer || '—'],
                ['Langkah pertama', i.first_step || '—'],
              ]),
              i.pitch ? el('div', { className: 'sm-pitch' },
                el('span', { className: 'sm-pitch-label' }, icon('message', { size: 14 }), 'Pesan ajakan'),
                el('p', {}, i.pitch),
              ) : null,
              el('div', { className: 'sm-idea-actions' },
                i.pitch ? copyBtn(() => i.pitch, 'Pesan ajakan', { size: 'sm', label: 'Salin pesan' }) : null,
                saveButton(() => ({ kind: 'partnership', platform: null, title: i.partner.slice(0, 120) || s, body: AI.partnershipText(i), meta_json: { ...input, ...i } }), { label: 'Simpan', size: 'sm', variant: 'ghost' }),
              ),
            ))),
          )
        },
      })
    })

    return { root: el('div', { className: 'stage-grid sm-grid' }, formPanel, resultPanel) }
  }

  /* =========================================================== Pustaka */
  function buildLibrary() {
    let kind = 'all'
    let q = ''
    const seg = C.segmented({ label: 'Jenis', value: kind, options: [{ value: 'all', label: 'Semua' }, ...KINDS], onChange: (v) => { kind = v; draw() } })
    const plat = C.select({ label: 'Platform', name: 'lib_platform', options: [{ value: '', label: 'Semua platform' }, ...AI.PLATFORMS, AI.META_PLATFORM], value: '' })
    plat.input.addEventListener('change', draw)
    const search = el('input', { type: 'search', className: 'input input-sm', placeholder: 'Cari judul atau isi…', 'aria-label': 'Cari di pustaka' })
    search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw() })
    const body = el('div', { className: 'sm-lib-body' }, C.skeletonRows(4))
    const tools = el('div', { className: 'sm-lib-tools' },
      seg,
      el('div', { className: 'sm-lib-filters' },
        el('div', { className: 'sm-lib-plat' }, plat.wrap),
        el('label', { className: 'search-box' }, icon('search', { size: 16 }), search),
      ),
    )
    const panel = C.panel({ title: 'Pustaka konten', meta: 'memuat…', className: 'sm-lib-panel' }, tools, body)

    function card(r) {
      const tags = Array.isArray(r.meta?.hashtags) ? r.meta.hashtags : []
      const full = r.kind === 'content' ? AI.contentText(r.body, tags) : String(r.body || '')
      const text = el('p', { className: 'sm-lib-text' }, r.body || '')
      const long = String(r.body || '').length > 260 || String(r.body || '').split('\n').length > 6
      const more = long ? el('button', { type: 'button', className: 'link-btn sm-more', 'aria-expanded': 'false' }, 'Selengkapnya') : null
      more?.addEventListener('click', () => {
        const open = text.classList.toggle('is-open')
        more.setAttribute('aria-expanded', open ? 'true' : 'false')
        more.textContent = open ? 'Ringkas' : 'Selengkapnya'
      })
      const actions = el('div', { className: 'sm-lib-actions' }, copyBtn(() => full, kindLabel(r.kind), { size: 'sm' }))
      if (r.kind === 'content') {
        const sch = C.button({ label: 'Jadwalkan', icon: 'calendar', size: 'sm', variant: 'ghost' })
        sch.addEventListener('click', () => go('schedule', { platform: r.platform, content: full, postType: r.meta?.type === 'ad_copy' ? 'ads' : r.meta?.type === 'story' ? 'story' : 'organic' }))
        actions.appendChild(sch)
      }
      const del = C.button({ label: 'Hapus', icon: 'trash', size: 'sm', variant: 'ghost', className: 'sm-del' })
      confirmAction(del, 'Yakin hapus?', async () => {
        try { await data.deleteContent(r.id); showToast('Dihapus dari pustaka.', 'info') } catch (err) { showToast(err.message, 'error') }
      })
      actions.appendChild(del)
      return el('li', { className: `sm-lib-item kind-${r.kind}`, dataset: { id: String(r.id) } },
        el('div', { className: 'sm-lib-top' },
          C.tag(kindLabel(r.kind), r.kind === 'content' ? 'brand' : r.kind === 'ads' ? 'live' : 'neutral'),
          r.platform ? el('span', { className: 'sm-plat' }, AI.platformLabel(r.platform)) : null,
          el('time', { className: 'sm-lib-date tnum', datetime: r.created_at, title: C.formatDateTime(r.created_at) }, C.relativeTime(r.created_at)),
        ),
        el('h3', { className: 'sm-lib-title' }, r.title || kindLabel(r.kind)),
        text,
        more,
        tags.length ? el('p', { className: 'sm-lib-tags' }, tags.join(' ')) : null,
        actions,
      )
    }

    function draw() {
      if (data.libraryError) { body.replaceChildren(C.errorState(data.libraryError)); return }
      const rows = data.library
      if (!rows) return
      const counts = KINDS.map((k) => [k.label, rows.filter((r) => r.kind === k.value).length]).filter(([, n]) => n)
      panel.querySelector('.panel-meta').textContent = rows.length ? `${rows.length} tersimpan · ${counts.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(' · ')}` : 'Kosong'
      tools.hidden = !rows.length
      const p = plat.input.value
      const shown = rows.filter((r) => (kind === 'all' || r.kind === kind)
        && (!p || r.platform === p)
        && (!q || `${r.title || ''}\n${r.body || ''}`.toLowerCase().includes(q)))
      if (!rows.length) {
        const b = C.button({ label: 'Buat konten pertama', icon: 'sparkles', size: 'sm', variant: 'soft' })
        b.addEventListener('click', () => go('content'))
        body.replaceChildren(C.emptyState({ kicker: 'Pustaka kosong', title: 'Belum ada yang disimpan.', body: 'Hasil AI dari tab Konten, Ide, Iklan Meta, dan Kolaborasi yang Anda simpan akan terkumpul di sini.', iconName: 'bookmark', action: b }))
        return
      }
      if (!shown.length) {
        body.replaceChildren(C.emptyState({ kicker: 'Tidak cocok', title: 'Tidak ada yang sesuai filter.', body: 'Ubah jenis, platform, atau kata kunci pencarian.', iconName: 'search' }))
        return
      }
      body.replaceChildren(el('ul', { className: 'sm-lib-list' }, shown.map(card)))
    }

    data.on('library', draw)
    if (!data.library) data.loadLibrary()

    return { root: panel, onShow: draw }
  }

  /* -------------------------------------------------------------- Start */
  const want = params.tab || store.get(TAB_STORE) || 'content'
  activate(TABS.some((t) => t.key === want) ? want : 'content')
  await businessReady
}

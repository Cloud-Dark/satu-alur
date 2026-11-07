import '../../styles/landing.css'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { loadSite, saveSite } from '../../site/api.js'
import { validateSiteContent } from '../../site/content-rules.js'
import { renderHero } from '../../site/hero.js'
import { HERO, HERO_POINTS, FAQS } from '../../landing/content.js'
import { t } from '../../i18n/index.js'

const { el } = C
const MAX_POINTS = 4
const MAX_FAQS = 20
let seq = 0

export const stampLine = (row) => (row?.updated_at
  ? t('office.common.stamp', { when: C.formatDateTime(row.updated_at), who: row.updated_by || t('office.common.staff') })
  : t('office.common.neverSaved'))

const defaults = () => ({ ...HERO, points: [...HERO_POINTS], faqs: FAQS.map((f) => ({ ...f })) })

// Blank stored fields fall back to the defaults, like the public landing does.
function fromRow(row) {
  const d = defaults()
  const v = row?.value
  if (!v) return d
  const h = v.hero && typeof v.hero === 'object' ? v.hero : {}
  const pick = (x, fb) => (typeof x === 'string' && x.trim() ? x : fb)
  const points = (Array.isArray(h.points) ? h.points : []).filter((p) => typeof p === 'string' && p.trim())
  const faqs = (Array.isArray(v.faqs) ? v.faqs : []).filter((f) => f && typeof f.q === 'string' && typeof f.a === 'string' && f.q.trim() && f.a.trim())
  return {
    badge: pick(h.badge, d.badge), title: pick(h.title, d.title), subtitle: pick(h.subtitle, d.subtitle),
    points: points.length ? points : d.points, faqs: faqs.length ? faqs.map((f) => ({ q: f.q, a: f.a })) : d.faqs,
  }
}

const toValue = (s) => ({ hero: { badge: s.badge, title: s.title, subtitle: s.subtitle, points: s.points }, faqs: s.faqs })

/** Loads a row for an editor; on failure shows the error + "Coba lagi" (no form, so nothing can be saved). Returns the row or null. */
export async function loadOrRetry(host, ctx, key, retry) {
  host.replaceChildren(C.skeletonRows(4))
  try {
    const row = await loadSite(key)
    return ctx.signal.aborted ? null : row
  } catch (ex) {
    if (ctx.signal.aborted) return null
    const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
    again.addEventListener('click', retry)
    host.replaceChildren(C.errorState(ex.message), again)
    return null
  }
}

export async function draw(host, ctx, setDirty) {
  const row0 = await loadOrRetry(host, ctx, 'landing', () => draw(host, ctx, setDirty))
  if (!row0) return
  let row = row0
  let state = fromRow(row)
  const snap = () => JSON.stringify(state)
  let saved = snap()
  const touch = () => setDirty(snap() !== saved)

  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(row))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const previewCopy = el('div', { className: 'lp-hero-copy' })
  const preview = el('div', { className: 'lp of-preview' }, previewCopy)
  const redraw = () => { previewCopy.replaceChildren(); renderHero(previewCopy, state) }

  function build() {
    const id = ++seq
    const bind = (label, key, extra = {}) => {
      const f = C.field({ label, id: `of-ld-${key}-${id}`, value: state[key], ...extra })
      f.input.addEventListener('input', () => { state[key] = f.input.value; redraw(); touch() })
      return f
    }
    const badge = bind(t('office.landing.badge'), 'badge', { attrs: { maxlength: '80' } })
    const title = bind(t('office.doc.title'), 'title', { hint: t('office.landing.titleHint'), attrs: { maxlength: '120' } })
    const sub = C.textarea({ label: t('office.landing.subtitle'), id: `of-ld-sub-${id}`, value: state.subtitle, rows: 3, attrs: { maxlength: '300' } })
    sub.input.addEventListener('input', () => { state.subtitle = sub.input.value; redraw(); touch() })

    const points = state.points.map((p, i) => {
      const f = C.field({ label: t('office.landing.point', { n: i + 1 }), id: `of-ld-pt${i}-${id}`, value: p, attrs: { maxlength: '60' } })
      f.input.addEventListener('input', () => { state.points[i] = f.input.value; redraw(); touch() })
      const rm = C.button({ label: t('office.common.delete'), variant: 'ghost', size: 'sm', 'aria-label': t('office.landing.removePoint', { n: i + 1 }), disabled: state.points.length <= 1, title: state.points.length <= 1 ? t('office.landing.minPoint') : undefined })
      rm.addEventListener('click', () => { state.points.splice(i, 1); rebuild(state.points.length ? `[id^=of-ld-pt${Math.min(i, state.points.length - 1)}-]` : '.of-add-point') })
      return el('div', { className: 'of-row' }, f.wrap, rm)
    })
    const addPoint = C.button({ label: t('office.landing.addPoint'), icon: 'plus', variant: 'soft', size: 'sm', className: 'of-add-point', disabled: state.points.length >= MAX_POINTS })
    addPoint.addEventListener('click', () => { state.points.push(''); rebuild(`[id^=of-ld-pt${state.points.length - 1}-]`) })

    const faqs = state.faqs.map((fq, i) => {
      const q = C.field({ label: t('office.templates.question'), id: `of-ld-q${i}-${id}`, value: fq.q, attrs: { maxlength: '160' } })
      const a = C.textarea({ label: t('office.landing.answer'), id: `of-ld-a${i}-${id}`, value: fq.a, rows: 3, attrs: { maxlength: '1200' } })
      q.input.addEventListener('input', () => { fq.q = q.input.value; touch() })
      a.input.addEventListener('input', () => { fq.a = a.input.value; touch() })
      const act = (label, disabled, fn) => {
        const b = C.button({ label, variant: 'ghost', size: 'sm', disabled, 'aria-label': `${label} FAQ ${i + 1}`, title: disabled && label === t('office.common.delete') ? t('office.landing.minFaq') : undefined })
        b.addEventListener('click', fn)
        return b
      }
      const swap = (j) => () => { [state.faqs[i], state.faqs[j]] = [state.faqs[j], state.faqs[i]]; rebuild(`[id^=of-ld-q${j}-]`) }
      return el('article', { className: 'of-faq' }, q.wrap, a.wrap, el('div', { className: 'of-row-actions' },
        act(t('office.common.up'), i === 0, swap(i - 1)), act(t('office.common.down'), i === state.faqs.length - 1, swap(i + 1)),
        act(t('office.common.delete'), state.faqs.length <= 1, () => { state.faqs.splice(i, 1); rebuild('[id^=of-ld-q' + Math.max(0, Math.min(i, state.faqs.length - 1)) + '-]') })))
    })
    const addFaq = C.button({ label: t('office.landing.addFaq'), icon: 'plus', variant: 'soft', size: 'sm', disabled: state.faqs.length >= MAX_FAQS })
    addFaq.addEventListener('click', () => { state.faqs.push({ q: '', a: '' }); rebuild(`[id^=of-ld-q${state.faqs.length - 1}-]`) })

    const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary' })
    save.addEventListener('click', async () => {
      err.textContent = ''
      let clean
      try { clean = validateSiteContent('landing', toValue(state)) } catch (ex) { err.textContent = ex.message; return }
      const restore = C.setBusy(save, t('office.common.saving'))
      try {
        row = await saveSite('landing', clean)
        saved = snap()
        touch()
        stamp.textContent = stampLine(row)
        showToast(t('office.landing.saved'), 'success')
      } catch (ex) { err.textContent = ex.message } finally { restore() }
    })
    const reset = C.button({ label: t('office.landing.reset'), variant: 'ghost' })
    reset.addEventListener('click', () => {
      if (!confirm(t('office.landing.confirmReset'))) return
      state = defaults()
      rebuild()
      touch()
    })

    host.replaceChildren(
      C.panel({ title: 'Hero', meta: t('office.landing.heroMeta') }, badge.wrap, title.wrap, sub.wrap,
        el('div', { className: 'of-list' }, ...points), addPoint),
      C.panel({ title: t('office.landing.heroPreview') }, preview),
      C.panel({ title: 'FAQ', meta: t('office.templates.questions', { count: state.faqs.length }) }, el('div', { className: 'of-list' }, ...faqs), addFaq),
      err, el('div', { className: 'of-actions' }, save, reset), stamp)
    redraw()
  }
  // Rebuilding drops focus; put it back on the control that triggered the change.
  const rebuild = (focus) => {
    build()
    touch()
    if (focus) host.querySelector(focus)?.focus()
  }
  build()
}

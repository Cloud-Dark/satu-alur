import '../../styles/landing.css'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { getSite, saveSite } from '../../site/api.js'
import { validateSiteContent, parseDoc } from '../../site/content-rules.js'
import { DOC_TITLES, blockNode } from '../../site/doc-page.js'
import { stampLine } from './site-landing.js'

const { el } = C
const ROUTE = { about: '#/tentang', privacy: '#/privasi', terms: '#/syarat', cookies: '#/cookie' }
const LEGAL = [{ value: 'privacy', label: 'Kebijakan privasi' }, { value: 'terms', label: 'Syarat & ketentuan' }, { value: 'cookies', label: 'Kebijakan cookie' }]
export const LEAVE_MSG = 'Perubahan belum disimpan. Tinggalkan halaman ini?'
let seq = 0

async function drawDoc(host, ctx, setDirty, key) {
  const mine = host.dataset.doc = key
  host.replaceChildren(C.skeletonRows(4))
  let row = await getSite(key)
  if (ctx.signal.aborted || host.dataset.doc !== mine) return
  const state = { title: row?.value?.title ?? DOC_TITLES[key], body: row?.value?.body ?? '' }
  const snap = () => JSON.stringify(state)
  let saved = snap()
  const touch = () => setDirty(snap() !== saved)
  setDirty(false)
  const id = ++seq

  const title = C.field({ label: 'Judul', id: `of-doc-title-${id}`, value: state.title, attrs: { maxlength: '120' } })
  const body = C.textarea({ label: 'Isi', id: `of-doc-body-${id}`, value: state.body, rows: 16, attrs: { maxlength: '50000' },
    hint: 'Awali baris dengan ## untuk judul bagian dan - untuk poin daftar. Pisahkan paragraf dengan baris kosong.' })
  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(row))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const pTitle = el('h1', { className: 'display doc-title' })
  const pBody = el('div', { className: 'doc-body' })
  const redraw = () => { pTitle.textContent = state.title; pBody.replaceChildren(...parseDoc(state.body).map(blockNode)) }
  title.input.addEventListener('input', () => { state.title = title.input.value; redraw(); touch() })
  body.input.addEventListener('input', () => { state.body = body.input.value; redraw(); touch() })

  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary' })
  save.addEventListener('click', async () => {
    err.textContent = ''
    let clean
    try { clean = validateSiteContent(key, state) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      row = await saveSite(key, clean)
      saved = snap()
      touch()
      stamp.textContent = stampLine(row)
      showToast('Halaman tersimpan.', 'success')
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  const view = el('a', { className: 'btn btn-ghost', href: ROUTE[key], target: '_blank', rel: 'noopener' }, 'Lihat halaman ↗')

  host.replaceChildren(
    C.panel({ title: DOC_TITLES[key] }, title.wrap, body.wrap),
    C.panel({ title: 'Pratinjau' }, el('div', { className: 'lp doc-page of-preview' }, el('article', { className: 'doc-col' }, pTitle, pBody))),
    err, el('div', { className: 'of-actions' }, save, view), stamp)
  redraw()
}

export function drawAbout(host, ctx, setDirty) { return drawDoc(host, ctx, setDirty, 'about') }

export function drawLegal(host, ctx, setDirty) {
  let dirty = false
  const set = (d) => { dirty = d; setDirty(d) }
  const sub = el('div')
  const id = `of-legal-${++seq}`
  const select = el('select', { id, className: 'input' }, ...LEGAL.map((o) => el('option', { value: o.value }, o.label)))
  let current = LEGAL[0].value
  select.addEventListener('change', () => {
    if (dirty && !confirm(LEAVE_MSG)) { select.value = current; return }
    current = select.value
    drawDoc(sub, ctx, set, current)
  })
  host.replaceChildren(el('div', { className: 'field of-legal-pick' }, el('label', { className: 'field-label', htmlFor: id }, 'Dokumen'), select), sub)
  drawDoc(sub, ctx, set, current)
}

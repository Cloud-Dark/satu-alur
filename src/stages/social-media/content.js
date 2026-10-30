import * as AI from '../../ai/superpowers.js'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { igEligibility, threadsEligibility } from '../../social/rules.js'
import { toJpeg } from '../../social/image.js'
import { PLATFORMS as AI_PLATFORMS } from '../../ai/social-agent.js'
import { PLATFORM_LABEL, connectedPlatforms, platformReason, canShare } from './platforms.js'

const { el } = C
const PLATFORMS = [{ value: 'instagram', label: 'Instagram' }, { value: 'facebook', label: 'Facebook' }, { value: 'threads', label: 'Threads' }]
const THREADS_STYLE = AI_PLATFORMS.find((p) => p.value === 'threads')
// Threads gets the fork's style rule; Instagram and Facebook keep the plain prompt.
const styleOf = (platform) => (platform === 'threads'
  ? ` Gaya platform: ${THREADS_STYLE.style}. Batas teks ${THREADS_STYLE.limit} karakter.`
  : ' Sertakan hashtag relevan.')
let seq = 0

// Editable content with image, platform checkboxes, Simpan and Bagikan sekarang.
// `item` is a saved social_contents row or null; `onCreated(row)` fires once when a new row is saved.
function composer(ctx, item, initialBody, onCreated) {
  const id = ++seq
  const state = { id: item?.id ?? null, imageKey: item?.image_key ?? null, w: item?.meta_json?.width ?? 1, h: item?.meta_json?.height ?? 1 }
  const body = C.textarea({ label: 'Isi konten', id: `sm-body-${id}`, value: item?.body ?? initialBody, rows: 6, attrs: { maxlength: '8000' } })
  const preview = el('div', { className: 'sm-image' })
  const fileId = `sm-file-${id}`
  const file = el('input', { id: fileId, type: 'file', accept: 'image/*', className: 'input' })
  const removeImg = C.button({ label: 'Hapus gambar', icon: 'trash', variant: 'ghost', size: 'sm' })
  const share = el('div', { className: 'sm-share' })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'soft' })
  const now = C.button({ label: 'Bagikan sekarang', icon: 'send', variant: 'primary' })
  const checks = {}

  function eligibility() {
    const caption = body.input.value
    const hasImage = Boolean(state.imageKey)
    return { instagram: igEligibility({ hasImage, width: state.w, height: state.h, caption }), threads: threadsEligibility({ hasImage, caption }) }
  }
  function syncElig() {
    const elig = eligibility()
    for (const [p, c] of Object.entries(checks)) {
      const reason = platformReason(ctx.account, p, elig)
      c.input.disabled = Boolean(reason)
      if (reason) c.input.checked = false
      c.hint.textContent = reason
    }
  }
  function drawImage() {
    const url = state.imageKey ? Social.mediaUrl(state.imageKey) : ''
    preview.replaceChildren(...(state.imageKey ? [
      url ? el('img', { src: url, alt: 'Pratinjau gambar konten', className: 'sm-image-preview', style: 'max-width:160px;max-height:160px;border-radius:8px' })
        : el('p', { className: 'muted small' }, 'Gambar terlampir.'),
      removeImg] : []))
    syncElig()
  }
  function drawShare() {
    const platforms = connectedPlatforms(ctx)
    if (!platforms.length) {
      const go = C.button({ label: 'Hubungkan akun di tab Akun untuk membagikan.', variant: 'ghost', size: 'sm' })
      go.addEventListener('click', () => ctx.goto('account'))
      share.replaceChildren(go)
      now.disabled = true
      return
    }
    share.replaceChildren(el('fieldset', { className: 'sm-platforms' }, el('legend', { className: 'field-label' }, 'Bagikan ke'),
      ...platforms.map((p) => {
        const input = el('input', { type: 'checkbox', id: `sm-${p}-${id}`, value: p })
        const hint = el('span', { className: 'field-hint', id: `sm-${p}-${id}-hint` })
        input.setAttribute('aria-describedby', hint.id)
        checks[p] = { input, hint }
        return el('div', {}, el('label', { className: 'check-row', htmlFor: input.id }, input, PLATFORM_LABEL[p]), ' ', hint)
      })))
    syncElig()
    if (!canShare(ctx)) now.disabled = true
  }

  // Returns the content id, saving first when needed.
  async function persist() {
    const payload = { body: body.input.value.trim(), image_key: state.imageKey, meta_json: state.imageKey ? { width: state.w, height: state.h } : null }
    if (!payload.body) throw new Error('Isi konten tidak boleh kosong.')
    if (state.id) { await Social.updateContent(state.id, payload); return state.id }
    const [row] = await Social.saveContent({ kind: 'content', ...payload })
    state.id = row.id
    onCreated?.(row)
    return state.id
  }
  async function guarded(button, busy, fn) {
    const restore = C.setBusy(button, busy)
    ctx.status.hide()
    try { await fn() } catch (err) { ctx.status.show('danger', err.message) } finally { restore(); if (!canShare(ctx)) now.disabled = true }
  }

  body.input.addEventListener('input', syncElig)
  file.addEventListener('change', () => {
    const f = file.files[0]
    if (!f) return
    guarded(save, 'Memproses gambar…', async () => {
      const img = await toJpeg(f, 2048)
      state.imageKey = await Social.uploadImage(img.blob)
      state.w = img.width
      state.h = img.height
      drawImage()
    })
  })
  removeImg.addEventListener('click', () => {
    state.imageKey = null
    file.value = ''
    drawImage()
    file.focus()
  })
  save.addEventListener('click', () => guarded(save, 'Menyimpan…', async () => {
    await persist()
    showToast('Konten tersimpan.', 'success')
  }))
  now.addEventListener('click', () => {
    const chosen = Object.keys(checks).filter((p) => checks[p].input.checked)
    if (!chosen.length) { ctx.status.show('danger', 'Pilih minimal satu platform.'); return }
    guarded(now, 'Memposting…', async () => {
      const rows = await Social.publishNow(await persist(), chosen)
      for (const r of rows) {
        if (r.status === 'posted') showToast(`Tayang di ${PLATFORM_LABEL[r.platform]}`, 'success')
        else if (r.status !== 'failed') showToast(`${PLATFORM_LABEL[r.platform]}: Status belum pasti — periksa Laporan tayang sebelum mencoba lagi.`, 'warning', 6000)
        else showToast(r.error || `Gagal tayang di ${PLATFORM_LABEL[r.platform]}`, 'danger')
      }
    })
  })

  drawImage()
  drawShare()
  return el('div', { className: 'sm-composer form' }, body.wrap,
    el('div', { className: 'field' }, el('label', { className: 'field-label', htmlFor: fileId }, 'Gambar (opsional)'), file, preview),
    share, el('div', { className: 'form-actions' }, save, now))
}

export async function render(host, ctx, brainstorm = false) {
  const kind = brainstorm ? 'brainstorm' : 'content'
  let controller = null
  const topic = C.field({ label: brainstorm ? 'Tema brainstorming' : 'Topik atau layanan', id: 'sm-topic', required: true,
    placeholder: 'Perawatan AC rumah di musim hujan', attrs: { maxlength: '500' } })
  const platform = C.select({ label: 'Platform', id: 'sm-platform', options: PLATFORMS })
  const type = C.select({ label: brainstorm ? 'Jumlah ide' : 'Jenis konten', id: 'sm-type', options: brainstorm
    ? ['5', '10', '20'].map((n) => ({ value: n, label: `${n} ide` }))
    : [{ value: 'caption', label: 'Caption posting' }, { value: 'naskah video', label: 'Naskah video' }, { value: 'seri story', label: 'Story series' },
      { value: 'copy iklan', label: 'Copy iklan' }, { value: 'prompt gambar AI', label: 'Prompt gambar AI' }] })
  const tone = C.select({ label: 'Gaya bahasa', id: 'sm-tone', options: ['Santai', 'Profesional', 'Inspiratif', 'Edukatif', 'Promosi'].map((label) => ({ value: label, label })) })
  const cta = C.field({ label: 'Ajakan bertindak', id: 'sm-cta', placeholder: 'Hubungi kami untuk konsultasi', attrs: { maxlength: '300' } })
  const submit = C.button({ label: brainstorm ? 'Mulai brainstorm' : 'Buat konten', icon: 'sparkles', variant: 'primary', type: 'submit' })
  const output = el('div', { className: 'workspace-output' })
  const library = el('div', { className: 'workspace-library' })
  const form = el('form', { className: 'form' }, topic.wrap, el('div', { className: 'form-row' }, platform.wrap, type.wrap),
    brainstorm ? null : tone.wrap, brainstorm ? null : cta.wrap, el('div', { className: 'form-actions' }, submit))
  ctx.signal.addEventListener('abort', () => controller?.abort(), { once: true })

  async function drawLibrary() {
    let items
    try { items = await Social.listContents(kind) } catch (err) { library.replaceChildren(C.errorState(err.message)); return }
    if (ctx.signal.aborted) return
    library.replaceChildren()
    if (!items.length) library.appendChild(C.emptyState({ title: 'Belum ada konten tersimpan', iconName: 'file',
      body: brainstorm ? 'Hasil brainstorming akan disimpan otomatis di sini.' : 'Buat konten, lalu pilih Simpan.' }))
    items.slice(0, 10).forEach((s) => {
      const del = C.button({ label: 'Hapus', icon: 'trash', variant: 'ghost', size: 'sm' })
      del.addEventListener('click', async () => {
        if (!confirm('Hapus konten ini?')) return
        try { await Social.deleteContent(s.id); await drawLibrary() } catch (err) { ctx.status.show('danger', err.message) }
      })
      const copy = C.button({ label: 'Salin', icon: 'copy', variant: 'soft', size: 'sm' })
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(s.body); showToast('Konten disalin.', 'success') } catch { ctx.status.show('danger', 'Tidak dapat menyalin. Periksa izin clipboard browser.') }
      })
      library.appendChild(el('article', { className: 'workspace-entry' },
        el('div', { className: 'workspace-entry-head' }, C.tag(kind), el('span', { className: 'muted small' }, C.formatDateTime(s.created_at))),
        brainstorm ? el('p', { className: 'workspace-preview' }, s.body) : composer(ctx, s),
        el('div', { className: 'form-actions' }, brainstorm ? copy : null, del)))
    })
  }

  async function generate(prompt) {
    const modelId = ctx.getModelId()
    if (!modelId) { ctx.status.show('danger', 'Model AI belum tersedia. Muat ulang halaman atau periksa pengaturan.'); return }
    const run = new AbortController()
    controller?.abort()
    controller = run
    const restore = C.setBusy(submit, 'Menyiapkan konten…')
    const console = C.aiConsole({ model: modelId })
    output.replaceChildren(console.root)
    console.onStop(() => run.abort())
    console.setStatus('Menulis', true)
    ctx.status.hide()
    let full = ''
    try {
      for await (const event of AI.chatWithAgent({ agentKey: 'social', message: prompt, modelId, signal: run.signal, useMemory: false })) {
        if (run.signal.aborted || ctx.signal.aborted) return
        if (event.type === 'error') throw new Error(event.message)
        if (event.type === 'text') {
          full = event.full
          console.writeHTML(C.sanitizeHTML(full.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')))
        }
      }
      if (!full.trim()) throw new Error('AI tidak mengembalikan konten. Silakan coba lagi.')
      console.setStatus('Selesai')
      if (brainstorm) {
        await Social.saveContent({ kind, body: full, platform: platform.input.value })
        showToast('Ide tersimpan.', 'success')
        await drawLibrary()
      } else output.appendChild(composer(ctx, null, full, drawLibrary))
    } catch (err) {
      console.setStatus(err.name === 'AbortError' ? 'Dihentikan' : 'Gagal')
      if (err.name !== 'AbortError') ctx.status.show('danger', err.message)
    } finally {
      console.done()
      if (run.signal.aborted) console.setStatus('Dihentikan')
      restore()
      if (controller === run) controller = null
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!topic.input.value.trim()) { topic.input.focus(); return }
    await generate(brainstorm
      ? `Lakukan brainstorm ${type.input.value} ide konten tentang ${topic.input.value.trim()} untuk ${platform.input.value}. Sertakan judul, hook, format, konsep dan estimasi engagement. Gunakan bahasa Indonesia.`
      : `Buat ${type.input.value} untuk ${platform.input.value} tentang ${topic.input.value.trim()}. Gaya: ${tone.input.value}. Ajakan bertindak: ${cta.input.value.trim()}. Gunakan bahasa Indonesia.${styleOf(platform.input.value)}`)
  })
  host.replaceChildren(el('div', { className: 'workspace-stack' },
    el('div', { className: 'stage-grid workspace-grid' },
      C.panel({ title: brainstorm ? 'Brainstorm lab' : 'Studio konten', meta: 'Dari ide menjadi draf', raised: true }, form),
      C.panel({ title: 'Hasil AI', meta: 'Periksa kembali sebelum digunakan' }, output)),
    C.panel({ title: brainstorm ? 'Ide tersimpan' : 'Pustaka konten', meta: 'Tersimpan di akun Anda' }, library)))
  output.appendChild(C.emptyState({ title: 'Mulai dari sebuah topik', iconName: 'sparkles', body: 'Isi kebutuhan Anda di formulir untuk membuat draf pertama.' }))
  await drawLibrary()
}

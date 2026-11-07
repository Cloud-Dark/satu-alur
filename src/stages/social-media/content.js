import * as AI from '../../ai/superpowers.js'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { igEligibility, threadsEligibility } from '../../social/rules.js'
import { toJpeg } from '../../social/image.js'
import { PLATFORMS as AI_PLATFORMS } from '../../ai/social-agent.js'
import { PLATFORM_LABEL, connectedPlatforms, platformReason, canShare } from './platforms.js'
import { openPostDialog, replizReady } from './repliz.js'
import { t } from '../../i18n/index.js'

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
  const body = C.textarea({ label: t('social.content.body'), id: `sm-body-${id}`, value: item?.body ?? initialBody, rows: 6, attrs: { maxlength: '8000' } })
  const preview = el('div', { className: 'sm-image' })
  const fileId = `sm-file-${id}`
  const file = el('input', { id: fileId, type: 'file', accept: 'image/*', className: 'input' })
  const removeImg = C.button({ label: t('social.content.removeImage'), icon: 'trash', variant: 'ghost', size: 'sm' })
  const share = el('div', { className: 'sm-share' })
  const save = C.button({ label: t('social.content.save'), icon: 'save', variant: 'soft' })
  const now = C.button({ label: t('social.content.shareNow'), icon: 'send', variant: 'primary' })
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
      url ? el('img', { src: url, alt: t('social.content.imagePreview'), className: 'sm-image-preview', style: 'max-width:160px;max-height:160px;border-radius:8px' })
        : el('p', { className: 'muted small' }, t('social.content.imageAttached')),
      removeImg] : []))
    syncElig()
  }
  function drawShare() {
    const platforms = connectedPlatforms(ctx)
    if (!platforms.length) {
      const go = C.button({ label: t('social.content.connectToShare'), variant: 'ghost', size: 'sm' })
      go.addEventListener('click', () => ctx.goto('account'))
      share.replaceChildren(go)
      now.disabled = true
      return
    }
    share.replaceChildren(el('fieldset', { className: 'sm-platforms' }, el('legend', { className: 'field-label' }, t('social.content.shareTo')),
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
    if (!payload.body) throw new Error(t('social.platforms.reasons.empty'))
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
    guarded(save, t('social.content.processingImage'), async () => {
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
  save.addEventListener('click', () => guarded(save, t('social.saving'), async () => {
    await persist()
    showToast(t('social.content.saved'), 'success')
  }))
  now.addEventListener('click', () => {
    const chosen = Object.keys(checks).filter((p) => checks[p].input.checked)
    if (!chosen.length) { ctx.status.show('danger', t('social.pickPlatform')); return }
    guarded(now, t('social.content.posting'), async () => {
      const rows = await Social.publishNow(await persist(), chosen)
      for (const r of rows) {
        if (r.status === 'posted') showToast(t('social.content.postedOn', { platform: PLATFORM_LABEL[r.platform] }), 'success')
        else if (r.status !== 'failed') showToast(t('social.content.uncertain', { platform: PLATFORM_LABEL[r.platform] }), 'warning', 6000)
        else showToast(r.error || t('social.content.postFailed', { platform: PLATFORM_LABEL[r.platform] }), 'danger')
      }
    })
  })

  // Posting through the connected accounts (Repliz) takes the text as it is now; media are added in the dialog.
  const viaRepliz = replizReady(ctx) ? C.button({ label: t('social.uploadConnected'), icon: 'send', variant: 'soft' }) : null
  viaRepliz?.addEventListener('click', () => {
    if (!body.input.value.trim()) { ctx.status.show('danger', t('social.platforms.reasons.empty')); return }
    openPostDialog(ctx, { body: body.input.value.trim() }, viaRepliz)
  })

  drawImage()
  drawShare()
  return el('div', { className: 'sm-composer form' }, body.wrap,
    el('div', { className: 'field' }, el('label', { className: 'field-label', htmlFor: fileId }, t('social.content.imageOptional')), file, preview),
    share, el('div', { className: 'form-actions' }, save, now, viaRepliz))
}

export async function render(host, ctx, brainstorm = false) {
  const kind = brainstorm ? 'brainstorm' : 'content'
  let controller = null
  const topic = C.field({ label: brainstorm ? t('social.content.brainstormTheme') : t('social.content.topic'), id: 'sm-topic', required: true,
    placeholder: t('social.content.topicPlaceholder'), attrs: { maxlength: '500' } })
  const platform = C.select({ label: t('social.platform'), id: 'sm-platform', options: PLATFORMS })
  const type = C.select({ label: brainstorm ? t('social.content.ideaCount') : t('social.content.type'), id: 'sm-type', options: brainstorm
    ? ['5', '10', '20'].map((n) => ({ value: n, label: t('social.content.ideas', { n }) }))
    : [{ value: 'caption', label: t('social.content.types.caption') }, { value: 'naskah video', label: t('social.content.types.script') }, { value: 'seri story', label: t('social.content.types.story') },
      { value: 'copy iklan', label: t('social.content.types.adCopy') }, { value: 'prompt gambar AI', label: t('social.content.types.imagePrompt') }] })
  // The value goes into the (Indonesian) prompt; only the label is translated.
  const TONE_KEYS = { Santai: 'casual', Profesional: 'professional', Inspiratif: 'inspirational', Edukatif: 'educational', Promosi: 'promotional' }
  const tone = C.select({ label: t('social.content.tone'), id: 'sm-tone', options: Object.entries(TONE_KEYS).map(([value, k]) => ({ value, label: t(`social.content.tones.${k}`) })) })
  const cta = C.field({ label: t('social.content.cta'), id: 'sm-cta', placeholder: t('social.content.ctaPlaceholder'), attrs: { maxlength: '300' } })
  const submit = C.button({ label: brainstorm ? t('social.content.startBrainstorm') : t('social.content.generate'), icon: 'sparkles', variant: 'primary', type: 'submit' })
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
    if (!items.length) library.appendChild(C.emptyState({ title: t('social.content.libraryEmpty'), iconName: 'file',
      body: brainstorm ? t('social.content.libraryEmptyBrainstorm') : t('social.content.libraryEmptyContent') }))
    items.slice(0, 10).forEach((s) => {
      const del = C.button({ label: t('social.content.delete'), icon: 'trash', variant: 'ghost', size: 'sm' })
      del.addEventListener('click', async () => {
        if (!confirm(t('social.content.deleteConfirm'))) return
        try { await Social.deleteContent(s.id); await drawLibrary() } catch (err) { ctx.status.show('danger', err.message) }
      })
      const copy = C.button({ label: t('social.content.copy'), icon: 'copy', variant: 'soft', size: 'sm' })
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(s.body); showToast(t('social.content.copied'), 'success') } catch { ctx.status.show('danger', t('social.content.copyFail')) }
      })
      library.appendChild(el('article', { className: 'workspace-entry' },
        el('div', { className: 'workspace-entry-head' }, C.tag(t(`social.content.kind.${kind}`)), el('span', { className: 'muted small' }, C.formatDateTime(s.created_at))),
        brainstorm ? el('p', { className: 'workspace-preview' }, s.body) : composer(ctx, s),
        el('div', { className: 'form-actions' }, brainstorm ? copy : null, del)))
    })
  }

  async function generate(prompt) {
    const modelId = ctx.getModelId()
    if (!modelId) { ctx.status.show('danger', t('social.content.noModel')); return }
    const run = new AbortController()
    controller?.abort()
    controller = run
    const restore = C.setBusy(submit, t('social.content.preparing'))
    const console = C.aiConsole({ model: modelId })
    output.replaceChildren(console.root)
    console.onStop(() => run.abort())
    console.setStatus(t('social.content.writing'), true)
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
      if (!full.trim()) throw new Error(t('social.content.noContent'))
      console.setStatus(t('social.content.done'))
      if (brainstorm) {
        await Social.saveContent({ kind, body: full, platform: platform.input.value })
        showToast(t('social.content.ideaSaved'), 'success')
        await drawLibrary()
      } else output.appendChild(composer(ctx, null, full, drawLibrary))
    } catch (err) {
      console.setStatus(err.name === 'AbortError' ? t('social.content.stopped') : t('social.content.failed'))
      if (err.name !== 'AbortError') ctx.status.show('danger', err.message)
    } finally {
      console.done()
      if (run.signal.aborted) console.setStatus(t('social.content.stopped'))
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
      C.panel({ title: brainstorm ? t('social.content.brainstormLab') : t('social.content.studio'), meta: t('social.content.studioMeta'), raised: true }, form),
      C.panel({ title: t('social.content.result'), meta: t('social.content.resultMeta') }, output)),
    C.panel({ title: brainstorm ? t('social.content.savedIdeas') : t('social.content.library'), meta: t('social.content.libraryMeta') }, library)))
  output.appendChild(C.emptyState({ title: t('social.content.startTitle'), iconName: 'sparkles', body: t('social.content.startBody') }))
  await drawLibrary()
}

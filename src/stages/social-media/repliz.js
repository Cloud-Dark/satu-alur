// Social accounts connected through Repliz: account cards (Akun), the post dialog (Konten, Jadwal)
// and the posts list (Jadwal › Laporan tayang). ctx.repliz = { status, accounts, error } from social-media.js.
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Repliz from '../../repliz/api.js'
import * as Integrations from '../../integrations/connectors.js'
import { integrationCard } from '../../ui/integration-card.js'
import { REPLIZ_PLATFORMS, POST_TYPES, SCHEDULE_STATUS, CAPTION_MAX } from '../../repliz/rules.js'
import { toUtcIso } from '../../social/rules.js'
import '../../styles/repliz.css'
import { t, has } from '../../i18n/index.js'

const { el } = C
const BADGE = { instagram: 'IG', facebook: 'FB', threads: '@', tiktok: 'TT', youtube: 'YT', linkedin: 'in', twitter: 'X', pinterest: 'P' }
const TONE = { pending: 'brand', process: 'warn', success: 'ok', error: 'danger' }
let seq = 0
const typeLabel = (k) => (has(`social.status.postType.${k}`) ? t(`social.status.postType.${k}`) : POST_TYPES[k]?.label || k)
const statusLabel = (k) => (has(`social.status.repliz.${k}`) ? t(`social.status.repliz.${k}`) : SCHEDULE_STATUS[k] || k)

export const replizReady = (ctx) => Boolean(ctx.repliz?.status?.configured)

// Before the business has connected its own Repliz account: the keys form (same card as Pengaturan › Konektor).
export function credentialsPanel(ctx) {
  const host = el('div', {}, C.skeletonRows(2))
  Integrations.list().then((list) => {
    if (ctx.signal.aborted) return
    const item = list.items.find((i) => i.provider === 'repliz')
    host.replaceChildren(integrationCard(item, { demo: list.demo, enabled: list.enabled, onChange: () => ctx.refresh() }))
  }).catch((err) => { if (!ctx.signal.aborted) host.replaceChildren(C.errorState(err.message)) })
  return C.panel({ title: t('social.repliz.credTitle'), raised: true },
    el('p', {}, t('social.repliz.credBody')),
    host)
}
export const usableAccounts = (ctx) => (ctx.repliz?.accounts || []).filter((a) => !a.needs_reconnect)
const handle = (a) => (a.username ? (a.platform === 'youtube' || a.username.startsWith('@') ? a.username : `@${a.username}`) : a.name)

function badge(platform) {
  return el('span', { className: `rz-badge rz-${platform}`, 'aria-hidden': 'true' }, BADGE[platform] || '•')
}

/* ------------------------------------------------------------------ Akun */

export function pickPanel(ctx) {
  const list = el('div', {}, C.skeletonRows(2))
  const panel = C.panel({ title: t('social.repliz.pickTitle'), meta: t('social.repliz.pickMeta'), raised: true }, list)
  Repliz.getPick(ctx.replizPick).then((pick) => {
    if (ctx.signal.aborted) return
    panel.querySelector('.panel-title').textContent = t('social.account.pick.chooseName', { name: pick.label })
    list.replaceChildren(...pick.entities.map((e) => {
      const btn = C.button({ label: t('social.account.pick.choose'), variant: 'soft', size: 'sm' })
      btn.setAttribute('aria-label', t('social.account.pick.chooseName', { name: e.name }))
      btn.addEventListener('click', async () => {
        const restore = C.setBusy(btn, t('social.account.connecting'))
        try {
          await Repliz.choosePick(ctx.replizPick, e.id)
          ctx.clearReplizPick()
          showToast(t('social.callback.connected'), 'success')
          await ctx.refresh()
        } catch (err) { ctx.status.show('danger', err.message); restore() }
      })
      return el('article', { className: 'workspace-entry rz-entity' },
        el('div', { className: 'workspace-entry-head' },
          el('div', { className: 'rz-who' }, e.picture ? el('img', { src: e.picture, alt: '', className: 'rz-avatar', referrerpolicy: 'no-referrer' }) : badge(pick.platform),
            el('div', {}, el('strong', {}, e.name), e.username ? el('p', { className: 'muted small' }, e.username) : null)),
          btn))
    }))
  }).catch((err) => { if (!ctx.signal.aborted) list.replaceChildren(C.errorState(err.message)) })
  return panel
}

function accountRow(ctx, a) {
  const off = C.button({ label: t('social.account.disconnect'), icon: 'x', variant: 'ghost', size: 'sm' })
  off.setAttribute('aria-label', t('social.repliz.disconnectAria', { platform: REPLIZ_PLATFORMS[a.platform]?.label || a.platform, handle: handle(a) }))
  off.addEventListener('click', async () => {
    if (!confirm(t('social.repliz.disconnectConfirm', { handle: handle(a) }))) return
    const restore = C.setBusy(off, t('social.account.disconnecting'))
    ctx.status.hide()
    try {
      await Repliz.disconnect(a.id)
      showToast(t('social.account.disconnected'), 'success')
      await ctx.refresh()
    } catch (err) { ctx.status.show('danger', err.message); restore() }
  })
  const again = a.needs_reconnect ? connectButton(ctx, a.platform, t('social.repliz.reconnect'), a.id) : null
  return el('li', { className: 'rz-account' },
    a.picture ? el('img', { src: a.picture, alt: '', className: 'rz-avatar', referrerpolicy: 'no-referrer' }) : null,
    el('div', { className: 'rz-account-text' }, el('strong', {}, handle(a) || t('social.repliz.account')), a.name && a.name !== handle(a) ? el('span', { className: 'muted small' }, a.name) : null),
    a.needs_reconnect ? C.tag(t('social.repliz.needsReconnect'), 'warn') : C.tag(t('social.account.connected'), 'ok'),
    el('div', { className: 'rz-account-actions' }, again, off))
}

function connectButton(ctx, platform, label, reconnect = null) {
  const name = REPLIZ_PLATFORMS[platform].label
  const btn = C.button({ label, icon: 'plug', variant: reconnect ? 'soft' : 'primary', size: 'sm' })
  btn.setAttribute('aria-label', t('social.repliz.connectAria', { label, name }))
  if (ctx.repliz?.status?.demo) btn.disabled = true
  btn.addEventListener('click', async () => {
    const restore = C.setBusy(btn, t('social.repliz.opening'))
    ctx.status.hide()
    try {
      const res = await Repliz.connect(platform, reconnect)
      if (res?.connected) { showToast(t('social.repliz.connected', { name }), 'success'); await ctx.refresh() }
    } catch (err) { ctx.status.show('danger', err.message); restore() }
  })
  return btn
}

export function accountsSection(ctx) {
  const { status, accounts = [], error } = ctx.repliz || {}
  if (error) return C.panel({ title: t('social.repliz.accountsTitle'), raised: true }, C.errorState(t('social.repliz.loadError', { message: error })))
  const intro = el('p', {}, t('social.repliz.intro'))
  if (status?.error) return C.panel({ title: t('social.repliz.accountsTitle'), raised: true }, C.errorState(status.error))
  const notes = []
  if (status?.demo) notes.push(el('div', { className: 'note note-info' }, C.icon('info'), el('div', { className: 'note-body' }, el('p', {}, t('social.repliz.demoNote')))))
  if (status?.capacity?.limit && status.capacity.used >= status.capacity.limit) {
    notes.push(el('div', { className: 'note note-warn' }, C.icon('alert'), el('div', { className: 'note-body' }, el('p', {}, t('social.repliz.full', { limit: status.capacity.limit })))))
  }
  const cards = el('ul', { className: 'rz-grid', role: 'list' }, ...(status?.platforms || []).map((p) => {
    const mine = accounts.filter((a) => a.platform === p.key)
    return el('li', { className: 'rz-card' },
      el('div', { className: 'rz-card-head' }, badge(p.key),
        el('div', {}, el('strong', {}, p.label), el('p', { className: 'muted small' }, mine.length ? t('social.repliz.nConnected', { count: mine.length }) : t('social.account.notConnected')))),
      mine.length ? el('ul', { className: 'rz-accounts', role: 'list' }, ...mine.map((a) => accountRow(ctx, a))) : null,
      el('div', { className: 'form-actions' }, connectButton(ctx, p.key, mine.length ? t('social.repliz.addAccount') : t('social.repliz.connect'))))
  }))
  return C.panel({ title: t('social.repliz.accountsTitle'), meta: t('social.repliz.metaConnected', { n: accounts.length }), raised: true },
    intro, ...notes, cards, el('p', { className: 'muted small rz-powered' }, t('social.repliz.powered')))
}

/* ------------------------------------------------------------------ post dialog */

function localMin() {
  const d = new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}

// Opens the dialog to post `draft.body` to one connected account, now or at a chosen time.
export function openPostDialog(ctx, draft, opener) {
  const accounts = usableAccounts(ctx)
  const id = ++seq
  if (!accounts.length) {
    const go = C.button({ label: t('social.repliz.openAccounts'), iconRight: 'arrowRight', variant: 'primary', type: 'button' })
    const { close } = C.modal({ title: t('social.repliz.noAccountsTitle'), children: [el('p', {}, t('social.repliz.noAccountsBody'))],
      actions: [C.button({ label: t('social.close'), variant: 'ghost', dismiss: true }), go], opener })
    go.addEventListener('click', () => { close(); ctx.goto('account') })
    return
  }
  const accountSel = C.select({ label: t('social.repliz.account'), id: `rz-acc-${id}`, required: true,
    options: accounts.map((a) => ({ value: a.id, label: `${REPLIZ_PLATFORMS[a.platform]?.label || a.platform} · ${handle(a)}` })) })
  const typeSel = C.select({ label: t('social.repliz.postType'), id: `rz-type-${id}`, required: true, options: [] })
  const title = C.field({ label: t('social.repliz.title'), id: `rz-title-${id}`, attrs: { maxlength: '100' }, hint: t('social.repliz.titleHint') })
  const caption = C.textarea({ label: t('social.repliz.text'), id: `rz-text-${id}`, value: draft?.body || '', rows: 6, attrs: { maxlength: String(CAPTION_MAX) } })
  const media = C.textarea({ label: t('social.repliz.media'), id: `rz-media-${id}`, rows: 2, placeholder: 'https://…', hint: t('social.repliz.mediaHint') })
  const fileId = `rz-file-${id}`
  const file = el('input', { id: fileId, type: 'file', accept: 'image/jpeg,image/png,video/mp4', className: 'input' })
  const fileWrap = el('div', { className: 'field' }, el('label', { className: 'field-label', htmlFor: fileId }, t('social.repliz.orUpload')), file,
    el('span', { className: 'field-hint' }, t('social.repliz.fileHint')))
  const boardSel = C.select({ label: t('social.repliz.board'), id: `rz-board-${id}`, options: [{ value: '', label: t('social.repliz.boardLoading') }] })
  const privacySel = C.select({ label: t('social.repliz.privacy'), id: `rz-priv-${id}`, value: 'public',
    options: [{ value: 'public', label: t('social.repliz.public') }, { value: 'unlisted', label: t('social.repliz.unlisted') }, { value: 'private', label: t('social.repliz.private') }] })
  const when = C.choiceGroup({ legend: t('social.repliz.when'), type: 'radio', name: `rz-when-${id}`,
    options: [{ value: 'now', label: t('social.repliz.now'), checked: true }, { value: 'later', label: t('social.repliz.later') }] })
  const at = C.field({ label: t('social.dateTime'), id: `rz-at-${id}`, type: 'datetime-local', attrs: { min: localMin() } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const submit = C.button({ label: t('social.repliz.upload'), icon: 'send', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('social.cancel'), variant: 'ghost', dismiss: true })
  let boards = []

  const current = () => accounts.find((a) => a.id === accountSel.input.value) || accounts[0]
  function sync() {
    const a = current()
    const p = REPLIZ_PLATFORMS[a.platform]
    const keep = typeSel.input.value
    C.setOptions(typeSel.input, p.types.map((k) => ({ value: k, label: typeLabel(k) })), p.types.includes(keep) ? keep : p.types[0])
    const type = typeSel.input.value
    title.wrap.hidden = !['youtube', 'pinterest', 'tiktok', 'facebook'].includes(a.platform)
    media.wrap.hidden = type === 'text'
    fileWrap.hidden = type === 'text'
    privacySel.wrap.hidden = a.platform !== 'youtube'
    boardSel.wrap.hidden = !p.needsBoard
    if (p.needsBoard) {
      Repliz.listBoards(a.id).then((list) => {
        boards = list
        C.setOptions(boardSel.input, list.length ? list.map((b) => ({ value: b.id, label: b.name })) : [{ value: '', label: t('social.repliz.noBoards') }])
      }).catch((e) => { C.setOptions(boardSel.input, [{ value: '', label: e.message }]) })
    }
  }
  function syncWhen() { at.wrap.hidden = !when.inputs.later.checked }
  accountSel.input.addEventListener('change', sync)
  typeSel.input.addEventListener('change', sync)
  when.inputs.now.addEventListener('change', syncWhen)
  when.inputs.later.addEventListener('change', syncWhen)
  file.addEventListener('change', async () => {
    const f = file.files[0]
    if (!f) return
    err.textContent = ''
    const restore = C.setBusy(submit, t('social.repliz.uploadingFile'))
    try {
      const up = await Repliz.uploadMedia(f)
      media.input.value = [media.input.value.trim(), up.url].filter(Boolean).join('\n')
      if (up.type === 'video' && typeSel.input.querySelector('option[value="video"]')) typeSel.input.value = 'video'
      file.value = ''
    } catch (e) { err.textContent = e.message } finally { restore() }
  })

  const { form, close } = C.modal({
    title: t('social.repliz.dialogTitle'), wide: true,
    children: [accountSel.wrap, typeSel.wrap, title.wrap, caption.wrap, media.wrap, fileWrap, boardSel.wrap, privacySel.wrap, when.wrap, at.wrap, err],
    actions: [cancel, submit], opener,
  })
  sync()
  syncWhen()
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const later = when.inputs.later.checked
    if (later && (!at.input.value || Number.isNaN(Date.parse(at.input.value)))) { err.textContent = t('social.repliz.pickDate'); return }
    const a = current()
    const input = {
      account_id: a.id,
      type: typeSel.input.value,
      title: title.input.value,
      description: caption.input.value,
      medias: media.input.value.split('\n').map((u) => u.trim()).filter(Boolean).map((url) => ({ url })),
      scheduleAt: later ? toUtcIso(at.input.value) : undefined,
      privacy: privacySel.input.value,
      board: REPLIZ_PLATFORMS[a.platform].needsBoard ? boards.find((b) => b.id === boardSel.input.value) : undefined,
    }
    const restore = C.setBusy(submit, later ? t('social.repliz.scheduling') : t('social.repliz.uploading'))
    try {
      await Repliz.schedule(input)
      close()
      showToast(later ? t('social.repliz.scheduled') : t('social.repliz.sent'), 'success', 5000)
      ctx.onPosted?.()
    } catch (e2) { err.textContent = e2.message } finally { restore() }
  })
}

/* ------------------------------------------------------------------ posts list */

export function postsSection(ctx, redraw) {
  const list = el('div', {}, C.skeletonRows(2))
  const panel = C.panel({ title: t('social.repliz.postsTitle'), meta: t('social.repliz.loading') }, list)
  Repliz.listPosts().then((rows) => {
    if (ctx.signal.aborted) return
    panel.querySelector('.panel-meta').textContent = t('social.repliz.nPosts', { count: rows.length })
    if (!rows.length) { list.replaceChildren(C.emptyState({ title: t('social.repliz.postsEmpty'), iconName: 'send', body: t('social.repliz.postsEmptyBody') })); return }
    const renderRow = (r) => {
      let action = null
      if (r.status === 'success' && r.link) action = el('a', { href: r.link, target: '_blank', rel: 'noopener' }, t('social.repliz.viewPost'))
      else if (r.status === 'pending') {
        action = C.button({ label: t('social.schedule.cancelPost'), variant: 'ghost', size: 'sm' })
        action.addEventListener('click', async () => {
          const restore = C.setBusy(action, t('social.schedule.cancelling'))
          ctx.status.hide()
          try { await Repliz.cancelPost(r.id); showToast(t('social.repliz.cancelled'), 'success') } catch (err) { ctx.status.show('danger', err.message) }
          restore()
          if (!ctx.signal.aborted) redraw()
        })
      }
      return el('article', { className: 'workspace-entry rz-post' },
        el('div', { className: 'workspace-entry-head' },
          el('div', { className: 'rz-who' }, badge(r.platform), el('strong', {}, `${REPLIZ_PLATFORMS[r.platform]?.label || r.platform}${r.account_label ? ` · ${r.account_label}` : ''}`)),
          C.tag(statusLabel(r.status), TONE[r.status] || 'neutral'),
          el('span', { className: 'muted small' }, C.formatDateTime(r.scheduled_at))),
        r.preview ? el('p', { className: 'workspace-preview' }, r.preview.slice(0, 160)) : null,
        r.status === 'error' && r.error ? el('p', { className: 'field-error' }, r.error) : null,
        action)
    }
    list.replaceChildren(C.paginate({ key: 'rz-posts', label: t('social.repliz.postsPaging'), pageSize: 10, items: rows, render: (page) => page.map(renderRow) }).root)
  }).catch((err) => { if (!ctx.signal.aborted) list.replaceChildren(C.errorState(err.message)) })
  return panel
}

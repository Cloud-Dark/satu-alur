import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { t } from '../../i18n/index.js'
import { accountsSection, credentialsPanel, pickPanel as replizPickPanel, replizReady } from './repliz.js'

const { el } = C
const OLD_CONTENT = 'satualur_saved_content'
const OLD_SCHEDULES = 'satualur_schedules'
const MIGRATED = 'satualur_social_migrated'

function readOld(key) {
  try {
    const items = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(items) ? items : []
  } catch { return [] }
}

// Old localStorage items that still need moving to the account, or null when there is nothing (or it was done).
function legacyRows() {
  try { if (localStorage.getItem(MIGRATED)) return null } catch { return null }
  const rows = [
    ...readOld(OLD_CONTENT).map((i) => ({ kind: i?.type === 'brainstorm' ? 'brainstorm' : 'content', body: i?.content })),
    ...readOld(OLD_SCHEDULES).map((i) => ({ kind: 'content', body: i?.content })),
  ].filter((r) => typeof r.body === 'string' && r.body.trim())
  return rows.length ? rows : null
}

// Connect / disconnect helpers shared by the Facebook & Instagram card and the Threads card.
function cardKit(ctx, startConnect, disconnect) {
  const button = (label, extra = {}) => C.button({ label, icon: 'plug', variant: 'primary', ...extra })
  const run = async (btn, busy, fn) => {
    const restore = C.setBusy(btn, busy)
    ctx.status.hide()
    try { await fn() } catch (err) { ctx.status.show('danger', err.message) } finally { restore() }
  }
  const connect = (label) => {
    const btn = button(label)
    btn.addEventListener('click', () => run(btn, t('social.account.connecting'), async () => {
      await startConnect()
      await ctx.refresh() // demo mode connects in place; the real flow navigates away
    }))
    return btn
  }
  const off = (name) => {
    const btn = C.button({ label: t('social.account.disconnect'), icon: 'x', variant: 'ghost' })
    btn.addEventListener('click', () => {
      if (!confirm(t('social.account.disconnectConfirm', { name }))) return
      run(btn, t('social.account.disconnecting'), async () => {
        await disconnect()
        await ctx.refresh()
        showToast(t('social.account.disconnected'), 'success')
      })
    })
    return btn
  }
  return { button, connect, off }
}

const reconnectNote = (name) => el('div', { className: 'note note-warn', role: 'status' }, C.icon('alert'),
  el('div', { className: 'note-body' }, el('p', {}, t('social.account.reconnectNote', { name }))))

function connectPanel(ctx) {
  const { configured } = ctx
  const account = ctx.account?.fb_connected ? ctx.account : null
  const { button, connect, off: offButton } = cardKit(ctx, Social.startConnect, Social.disconnect)
  if (!configured) {
    return C.panel({ title: t('social.account.meta.title'), raised: true },
      el('p', {}, t('social.account.meta.notConfigured')),
      el('div', { className: 'form-actions' }, button(t('social.account.meta.connect'), { disabled: true })))
  }
  if (!account) {
    return C.panel({ title: t('social.account.meta.title'), meta: t('social.account.notConnected'), raised: true },
      el('p', {}, t('social.account.meta.intro')),
      el('div', { className: 'form-actions' }, connect(t('social.account.meta.connect'))))
  }
  const off = offButton(account.page_name || t('social.account.meta.page'))
  return C.panel({ title: t('social.account.meta.title'), meta: t('social.account.connected'), raised: true },
    C.defList([
      [t('social.account.meta.page'), account.page_name],
      ['Instagram', account.ig_username ? `@${account.ig_username}` : t('social.account.meta.linkIg')],
    ]),
    account.needs_reconnect ? reconnectNote('Meta') : null,
    el('div', { className: 'form-actions' }, account.needs_reconnect ? connect(t('social.account.reconnect')) : null, off))
}

function threadsPanel(ctx) {
  const account = ctx.account?.threads_connected ? ctx.account : null
  const { button, connect, off } = cardKit(ctx, Social.startThreadsConnect, Social.disconnectThreads)
  if (!ctx.threadsConfigured) {
    return C.panel({ title: t('social.account.threads.title'), raised: true },
      el('p', {}, t('social.account.threads.notConfigured')),
      el('div', { className: 'form-actions' }, button(t('social.account.threads.connect'), { disabled: true })))
  }
  if (!account) {
    return C.panel({ title: t('social.account.threads.title'), meta: t('social.account.notConnected'), raised: true },
      el('p', {}, t('social.account.threads.intro')),
      el('div', { className: 'form-actions' }, connect(t('social.account.threads.connect'))))
  }
  const name = `@${account.threads_username || 'threads'}`
  return C.panel({ title: t('social.account.threads.title'), meta: t('social.account.connected'), raised: true },
    C.defList([['Threads', name]]),
    account.threads_needs_reconnect ? reconnectNote('Threads') : null,
    el('div', { className: 'form-actions' }, account.threads_needs_reconnect ? connect(t('social.account.threads.reconnect')) : null, off(name)))
}

function pickPanel(ctx) {
  const list = el('div', {}, C.skeletonRows(2))
  Social.listPagesToPick(ctx.pick).then((pages) => {
    if (ctx.signal.aborted) return
    list.replaceChildren(...(pages.length ? pages : []).map((pg) => {
      const btn = C.button({ label: t('social.account.pick.choose'), variant: 'soft', size: 'sm', 'aria-label': t('social.account.pick.chooseName', { name: pg.name }) })
      btn.addEventListener('click', async () => {
        const restore = C.setBusy(btn, t('social.account.pick.choosing'))
        try {
          await Social.pickPage(ctx.pick, pg.id)
          ctx.clearPick()
          await ctx.refresh()
        } catch (err) { ctx.status.show('danger', err.message); restore() }
      })
      return el('article', { className: 'workspace-entry' }, el('strong', {}, pg.name),
        el('p', { className: 'muted small' }, pg.ig_username ? `Instagram @${pg.ig_username}` : t('social.account.pick.noIg')), btn)
    }))
    if (!pages.length) list.replaceChildren(C.emptyState({ title: t('social.account.pick.emptyTitle'), body: t('social.account.pick.emptyBody') }))
  }).catch((err) => { if (!ctx.signal.aborted) list.replaceChildren(C.errorState(err.message)) })
  return C.panel({ title: t('social.account.pick.title'), meta: t('social.account.pick.meta') }, list)
}

function importPanel(ctx, rows) {
  const btn = C.button({ label: t('social.account.import.move'), icon: 'save', variant: 'soft' })
  btn.addEventListener('click', async () => {
    const restore = C.setBusy(btn, t('social.account.import.moving'))
    ctx.status.hide()
    try {
      for (const r of rows) await Social.saveContent(r)
      try { localStorage.setItem(MIGRATED, '1') } catch { /* storage unavailable */ }
      showToast(t('social.account.import.moved', { count: rows.length }), 'success')
      await ctx.refresh()
    } catch (err) {
      ctx.status.show('danger', err.message)
      restore()
    }
  })
  return C.panel({ title: t('social.account.import.title'), meta: t('social.account.import.meta', { count: rows.length }) },
    el('p', {}, t('social.account.import.body')),
    el('div', { className: 'form-actions' }, btn))
}

export function render(host, ctx) {
  if (ctx.loadError) {
    const retry = C.button({ label: t('social.retry'), icon: 'refresh', variant: 'soft' })
    retry.addEventListener('click', () => ctx.refresh())
    host.replaceChildren(C.errorState(t('social.account.loadError', { message: ctx.loadError })), retry)
    return
  }
  const legacy = legacyRows()
  // Accounts connected through Repliz come first; the direct Meta/Threads connection stays as a secondary option.
  const repliz = replizReady(ctx)
  const replizOn = Boolean(ctx.repliz?.status?.enabled)
  const direct = !repliz || ctx.configured || ctx.threadsConfigured
  host.replaceChildren(el('div', { className: 'workspace-stack' },
    ctx.replizPick ? replizPickPanel(ctx) : null,
    repliz ? accountsSection(ctx) : replizOn ? credentialsPanel(ctx) : null,
    ctx.pick ? pickPanel(ctx) : null,
    repliz && direct ? el('h3', { className: 'sm-subhead' }, t('social.account.directHeading')) : null,
    direct ? connectPanel(ctx) : null,
    direct ? threadsPanel(ctx) : null,
    legacy ? importPanel(ctx, legacy) : null))
}

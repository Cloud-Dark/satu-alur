import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminListUsers, adminSuspendUser, adminRestoreUser, adminRevokeUserSessions, PAGE_SIZE } from '../../customers/api.js'
import { validateSuspendReason } from '../../customers/rules.js'
import { LEAVE_MSG } from './site-doc.js'
import { getUserDetail, setUserTier } from '../../admin/api.js'
import { PLANS, PLAN_LABELS } from '../../business/plan-access.js'
import { t } from '../../i18n/index.js'
import { featureLabel } from '../../quota/labels.js'

const { el } = C
// PLAN_LABELS lives in business/plan-access.js (shared with the Worker): translate by key.
const tierLabel = (p) => (PLAN_LABELS[p] ? t(`office.users.tier.${p}`) : p)
let seq = 0

// Sample sign-ups from seeds/office.sql: fictional admin-panel rows, never a real business.
const isSampleEmail = (email) => String(email || '').toLowerCase().endsWith('@contoh.satualur.id')

function suspendDialog(ctx, u, opener, onDone, setDirty) {
  const reason = C.textarea({ label: t('office.customers.reasonLabel'), id: `of-us-reason-${++seq}`, rows: 3, hint: t('office.users.reasonHint'), attrs: { maxlength: '300' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.users.suspend'), variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: t('office.common.cancel'), variant: 'ghost', type: 'button' })
  const { dialog, form, close } = C.modal({
    title: t('office.users.suspendTitle'), description: u.email, opener, actions: [cancel, save], children: [reason.wrap, err],
  })
  const dirty = () => reason.input.value.trim() !== ''
  form.addEventListener('input', () => setDirty(dirty()))
  dialog.addEventListener('cancel', (e) => { if (dirty() && !confirm(LEAVE_MSG)) e.preventDefault() })
  dialog.addEventListener('close', () => setDirty(false))
  cancel.addEventListener('click', () => { if (!dirty() || confirm(LEAVE_MSG)) close() })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validateSuspendReason({ reason: reason.input.value }) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, t('office.users.suspending'))
    try {
      await adminSuspendUser(u.id, clean)
      close()
      showToast(t('office.users.suspended'), 'success')
      if (!ctx.signal.aborted) onDone()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

const FEATURE_LABEL = (f) => (f.startsWith('byo_') ? t('office.sys.ownProvider', { feature: featureLabel(f.slice(4)) }) : featureLabel(f))

// Detail: tier (skala akun), subscription, AI usage this month, credit, integrations, recent emails.
async function detailDialog(ctx, u, opener, onDone) {
  let d
  try { d = await getUserDetail(u.id) } catch (ex) { showToast(ex.message, 'error'); return }
  if (ctx.signal.aborted) return
  const tier = C.select({ label: t('office.users.scale'), id: `of-us-tier-${++seq}`, options: PLANS.map((p) => ({ value: p, label: tierLabel(p) })), value: d.tier,
    hint: d.demo ? t('office.users.demoScaleHint') : t('office.users.scaleHint') })
  if (d.demo) tier.input.disabled = true
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.users.saveScale'), variant: 'primary', type: 'submit' })
  const close = C.button({ label: t('office.common.close'), variant: 'ghost', dismiss: true })
  const usage = d.usage.length
    ? el('ul', { className: 'of-us-usage' }, d.usage.map((r) => el('li', {}, `${FEATURE_LABEL(r.feature)}: ${C.number(r.count)}`)))
    : el('span', { className: 'muted' }, t('office.users.none'))
  const { form, close: done } = C.modal({
    title: t('office.users.detail'), description: d.user.email, opener, wide: true, actions: [close, d.demo ? null : save].filter(Boolean),
    children: [
      C.defList([
        [t('office.influencers.name'), d.user.name || '—'],
        [t('office.users.registered'), C.formatDate(d.user.created_at)],
        [t('office.users.lastLoginLabel'), d.user.last_login_at ? C.formatDateTime(d.user.last_login_at) : (d.sessions.last ? C.formatDateTime(d.sessions.last) : '—')],
        [t('office.customers.plan'), d.subscription?.plan_name ? `${d.subscription.plan_name} (${d.subscription.status})` : 'Free'],
        [t('office.users.creditLabel'), C.rupiah(d.credit_idr)],
        [t('office.users.usage'), usage],
        ['Email', d.integrations.email_mode === 'smtp' ? t('office.users.ownSmtp', { host: d.integrations.smtp_host }) : t('office.users.platformEmail')],
        [t('office.menu.sysAi'), d.integrations.ai_mode === 'builtin' ? t('office.users.builtin') : `${d.integrations.ai_mode} · ${d.integrations.ai_model || ''}`],
        [t('office.common.status'), d.suspended ? t('office.users.suspendedReason', { reason: d.reason || '—' }) : t('office.common.active')],
      ]),
      tier.wrap, err,
    ],
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      await setUserTier(u.id, tier.input.value)
      showToast(t('office.users.scaleSaved'), 'success')
      done()
      if (!ctx.signal.aborted) onDone()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
}

export function draw(host, ctx, setDirty) {
  let run = 0
  let query = ''
  let timer
  const pg = C.pager({ label: t('office.users.pagerLabel'), pageSize: PAGE_SIZE, sizes: [PAGE_SIZE], hideSize: true, onChange: () => load(pg.page) })
  const search = C.field({ label: t('office.users.search'), id: 'of-us-search', type: 'search', hint: t('office.users.searchHint'), attrs: { maxlength: '100', autocomplete: 'off' } })
  const body = el('div', { 'aria-live': 'polite' })
  const panel = C.panel({ title: t('office.menu.users') }, search.wrap, body, pg.root)
  ctx.signal.addEventListener('abort', () => clearTimeout(timer))
  search.input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (search.input.value.trim() === query) return
      query = search.input.value.trim()
      pg.reset()
      load(1)
    }, 300)
  })
  host.replaceChildren(panel)

  // Pulihkan / Akhiri sesi: one request, a toast, then a fresh list.
  async function act(btn, busyLabel, fn, done) {
    const restore = C.setBusy(btn, busyLabel)
    try {
      await fn()
      showToast(done, 'success')
      if (!ctx.signal.aborted) load(pg.page)
    } catch (ex) { showToast(ex.message, 'error') } finally { restore() }
  }

  function row(u) {
    const actions = el('span', { className: 'of-cust-meta' })
    if (u.suspended) {
      const b = C.button({ label: t('office.users.restore'), variant: 'soft', size: 'sm' })
      b.addEventListener('click', () => act(b, t('office.users.restoring'), () => adminRestoreUser(u.id), t('office.users.restored')))
      actions.append(b)
    } else if (!u.demo) { // shared demo accounts can't be suspended (Worker answers 400)
      const b = C.button({ label: t('office.users.suspend'), variant: 'soft', size: 'sm' })
      b.addEventListener('click', () => suspendDialog(ctx, u, b, () => load(pg.page), setDirty))
      actions.append(b)
    }
    const det = C.button({ label: t('office.users.detailBtn'), variant: 'ghost', size: 'sm' })
    det.addEventListener('click', () => detailDialog(ctx, u, det, () => load(pg.page)))
    actions.prepend(det)
    const end = C.button({ label: t('office.users.endSessions'), variant: 'ghost', size: 'sm' })
    end.addEventListener('click', () => {
      if (!confirm(t('office.users.confirmEnd', { email: u.email }))) return
      act(end, t('office.users.ending'), () => adminRevokeUserSessions(u.id), t('office.users.ended'))
    })
    actions.append(end)
    return el('div', { className: 'of-user' },
      el('span', { className: 'of-cust-main' },
        el('strong', {}, u.email),
        el('span', { className: 'muted small' }, u.name || '—'),
        u.suspended ? el('span', { className: 'small of-user-reason' }, t('office.users.reasonLine', { reason: u.reason || '—' })) : null),
      el('span', { className: 'of-cust-meta' },
        u.demo ? C.tag(t('office.common.demo'), 'neutral') : null,
        isSampleEmail(u.email) ? C.tag(t('office.users.sample'), 'neutral') : null,
        u.suspended ? C.tag(t('office.users.suspendedTag'), 'danger') : null,
        u.tier ? C.tag(tierLabel(u.tier), 'brand') : null,
        u.plan_name ? el('span', { className: 'small' }, t('office.users.planLine', { plan: u.plan_name })) : null,
        u.ai_calls_month ? el('span', { className: 'small' }, t('office.users.aiMonth', { n: C.number(u.ai_calls_month) })) : null,
        u.credit_idr ? el('span', { className: 'small' }, t('office.users.credit', { amount: C.rupiah(u.credit_idr) })) : null,
        el('span', { className: 'small' }, t('office.users.sessions', { n: u.active_sessions })),
        el('span', { className: 'muted small' }, u.last_session_at ? t('office.users.lastLogin', { date: C.formatDate(u.last_session_at) }) : '')),
      actions)
  }

  async function load(page) {
    const mine = ++run
    body.replaceChildren(C.skeletonRows(4))
    let data
    try { data = await adminListUsers({ q: query, page }) } catch (e) {
      if (ctx.signal.aborted || mine !== run) return
      const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => load(page))
      body.replaceChildren(C.errorState(e.message), again)
      pg.root.hidden = true
      return
    }
    if (ctx.signal.aborted || mine !== run) return
    pg.slice(new Array(data.total))
    // The list shrank under us (page now past the end): show the last page that exists.
    if (!data.items.length && data.total && pg.page !== page) return load(pg.page)
    if (!data.items.length) {
      body.replaceChildren(C.emptyState({ title: query ? t('office.common.noMatch') : t('office.users.empty'), body: query ? t('office.common.tryOther') : t('office.common.signupsAppear'), iconName: 'sprout' }))
      return
    }
    body.replaceChildren(el('div', { className: 'of-cust-list' }, ...data.items.map(row)))
  }
  load(1)
}

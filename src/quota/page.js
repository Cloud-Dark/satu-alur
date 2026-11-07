/**
 * Paket & kuota: the business's current plan, this month's AI usage per feature, AI credit,
 * redeeming a voucher, and the plans on offer. Deep link: ctx.params.focus === 'voucher' focuses the code box.
 */
import '../styles/landing.css'
import '../styles/quota.css'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { getMyPlan, redeemVoucher } from './api.js'
import { getPlans } from '../business/api.js'
import { renderPlanCard } from '../business/plan-card.js'
import { rupiah, FEATURES } from './rules.js'
import { planLabel, canUse } from '../business/plan-access.js'
import { t } from '../i18n/index.js'
import { featureLabel, featureUnit } from './labels.js'

const { el } = C

function usageBar(row) {
  const unlimited = row.limit === null
  const pct = unlimited ? 0 : row.limit === 0 ? 100 : Math.min(100, Math.round((row.used / row.limit) * 100))
  const tone = unlimited ? 'is-free' : pct >= 100 ? 'is-out' : pct >= 80 ? 'is-low' : ''
  const unit = featureUnit(row.key, row.unit)
  const label = featureLabel(row.key, row.label)
  const value = unlimited ? t('plan.usage.unlimited', { used: row.used, unit }) : `${row.used} / ${row.limit} ${unit}`
  return el('li', { className: `qt-row ${tone}`.trim() },
    el('div', { className: 'qt-row-head' }, el('span', { className: 'qt-row-label' }, label), el('span', { className: 'qt-row-value tnum' }, value)),
    el('div', {
      className: 'qt-bar', role: 'progressbar', 'aria-label': label,
      'aria-valuemin': '0', 'aria-valuemax': unlimited ? '0' : String(row.limit), 'aria-valuenow': String(row.used),
    }, el('span', { className: 'qt-bar-fill', style: `width:${unlimited ? 100 : pct}%` })),
    !unlimited && row.left === 0
      ? el('p', { className: 'qt-row-note' }, t('plan.usage.out', { price: rupiah(FEATURES.find((f) => f.key === row.key).price_idr), unit }))
      : null)
}

export async function render(container, ctx) {
  const summaryHost = el('div', { 'aria-live': 'polite' }, C.skeletonRows(3))
  const code = C.field({ label: t('plan.voucher.code'), id: 'qt-voucher-code', placeholder: 'SATU-XXXX-XXXX', attrs: { maxlength: '32', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const redeem = C.button({ label: t('plan.voucher.redeem'), icon: 'check', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'form qt-voucher-form', noValidate: true }, code.wrap, err, el('div', { className: 'form-actions' }, redeem))
  const contact = el('a', { className: 'btn btn-soft btn-sm', href: '#/kontak' }, t('plan.common.contact'))
  const tiers = el('div', { className: 'lp-tiers qt-tiers' })
  const plansPanel = C.panel({ title: t('plan.page.choose'), meta: t('plan.page.noCredit') }, tiers)

  container.replaceChildren(
    C.pageHeader({ title: t('plan.page.title') }),
    el('div', { className: 'qt-grid' },
      C.panel({ title: t('plan.page.yourPlan'), className: 'qt-summary' }, summaryHost),
      C.panel({ title: t('plan.voucher.redeem'), meta: t('plan.voucher.oneCode') },
        el('p', { className: 'muted small' }, t('plan.voucher.desc')),
        form,
        el('p', { className: 'muted small qt-contact' }, t('plan.page.needMore'), contact))),
    el('div', { className: 'lp qt-plans' }, plansPanel))

  function drawSummary(s) {
    const until = s.period_end ? t('plan.summary.until', { date: C.formatDate(s.period_end) }) : s.plan.slug === 'free' ? t('plan.summary.noExpiry') : ''
    summaryHost.replaceChildren(
      el('div', { className: 'qt-plan' },
        el('div', {},
          el('p', { className: 'qt-plan-name' }, s.plan.name || 'Free', s.demo ? C.tag(t('plan.page.demoTag'), 'accent') : ''),
          el('p', { className: 'muted small' }, [until, t('plan.summary.resets', { date: C.formatDate(s.resets_on) })].filter(Boolean).join(' · '))),
        el('div', { className: 'qt-credit' }, el('span', { className: 'muted small' }, t('plan.page.credit')), el('strong', { className: 'tnum' }, rupiah(s.credit_idr)))),
      // Business scale (sole/ukm/enterprise) gates features; it is not the Free/Lite/Pro paket above.
      ctx.user?.plan ? el('p', { className: 'muted small qt-tier' }, t('plan.summary.scale', { plan: planLabel(ctx.user.plan) }),
        canUse(ctx.user.plan, 'erpIntegration') ? t('plan.summary.erpOpen') : t('plan.summary.erpEnterprise'),
        t('plan.summary.scaleNoQuota')) : '',
      s.lapsed ? el('div', { className: 'note note-warn' }, C.icon('alert'), el('div', { className: 'note-body' }, el('p', {}, t('plan.summary.lapsed')))) : '',
      s.demo ? el('p', { className: 'muted small' }, t('plan.summary.demo')) : '',
      el('ul', { className: 'qt-rows' }, ...s.usage.map(usageBar)))
  }

  async function loadSummary() {
    try {
      const s = await getMyPlan()
      if (!ctx.signal.aborted) drawSummary(s)
    } catch (e) {
      if (ctx.signal.aborted) return
      const again = C.button({ label: t('plan.common.retry'), variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => { summaryHost.replaceChildren(C.skeletonRows(3)); loadSummary() })
      summaryHost.replaceChildren(C.errorState(e.message), again)
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    if (!code.input.value.trim()) { err.textContent = t('plan.voucher.enter'); code.input.focus(); return }
    const restore = C.setBusy(redeem, t('plan.voucher.redeeming'))
    try {
      const s = await redeemVoucher(code.input.value)
      code.input.value = ''
      if (!ctx.signal.aborted) drawSummary(s)
      const r = s.redeemed
      const got = [r.type !== 'credit' ? t('plan.voucher.gotPlan', { plan: s.plan.name, days: r.plan_days }) : '', r.type !== 'plan' ? t('plan.voucher.gotCredit', { amount: rupiah(r.credit_idr) }) : ''].filter(Boolean).join(t('plan.voucher.and'))
      showToast(t('plan.voucher.redeemed', { got }), 'success', 5000)
    } catch (ex) {
      err.textContent = ex.message
      code.input.focus()
    } finally { restore() }
  })

  getPlans().then((plans) => {
    if (ctx.signal.aborted) return
    if (!plans?.length) { plansPanel.hidden = true; return }
    tiers.replaceChildren(...plans.map((p) => {
      const card = renderPlanCard(p)
      // Inside the app the sign-up button means "talk to us about upgrading".
      const cta = card.querySelector('.lp-tier-cta')
      if (cta && cta.getAttribute('href') === '#/masuk') cta.setAttribute('href', '#/kontak')
      return card
    }))
  })

  await loadSummary()
  // After the shell has focused the page heading (it does so once render resolves).
  if (ctx.params?.focus === 'voucher') setTimeout(() => { if (!ctx.signal.aborted) { code.input.focus(); code.input.scrollIntoView({ block: 'center' }) } }, 0)
}

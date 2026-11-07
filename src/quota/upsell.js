/**
 * The "quota used up" dialog. Any AI call that gets a 402 announces it (src/quota/errors.js);
 * the shell mounts this once for business users. Three ways forward: plans, a voucher, or the team.
 */
import * as C from '../ui/components.js'
import { QUOTA_EVENT } from './errors.js'
import { t } from '../i18n/index.js'

const { el } = C

/** Returns a cleanup function. navigate(stageKey, params) comes from the shell. */
export function mountUpsell(navigate) {
  let open = null
  const onQuota = (e) => {
    if (open) return
    const opener = document.activeElement
    const go = (params) => { open?.close(); navigate('plan', params) }
    const plans = C.button({ label: t('plan.upsell.plans'), icon: 'ledger', variant: 'primary', size: 'sm' })
    plans.addEventListener('click', (ev) => { ev.preventDefault(); go({}) })
    const voucher = C.button({ label: t('plan.voucher.redeem'), icon: 'check', variant: 'soft', size: 'sm' })
    voucher.addEventListener('click', (ev) => { ev.preventDefault(); go({ focus: 'voucher' }) })
    const contact = el('a', { className: 'btn btn-ghost btn-sm', href: '#/kontak' }, t('plan.common.contact'))
    contact.addEventListener('click', () => open?.close())
    const later = C.button({ label: t('plan.upsell.later'), variant: 'ghost', size: 'sm', type: 'submit' })
    open = C.modal({
      title: t('plan.upsell.title'),
      description: e.detail?.message || t('plan.upsell.desc'),
      children: [el('p', { className: 'muted small' }, t('plan.upsell.note'))],
      actions: [later, contact, voucher, plans],
      opener,
    })
    open.dialog.classList.add('qt-upsell')
    open.dialog.addEventListener('close', () => { open = null })
  }
  window.addEventListener(QUOTA_EVENT, onQuota)
  return () => { window.removeEventListener(QUOTA_EVENT, onQuota); open?.close() }
}

/**
 * The "quota used up" dialog. Any AI call that gets a 402 announces it (src/quota/errors.js);
 * the shell mounts this once for business users. Three ways forward: plans, a voucher, or the team.
 */
import * as C from '../ui/components.js'
import { QUOTA_EVENT } from './errors.js'

const { el } = C

/** Returns a cleanup function. navigate(stageKey, params) comes from the shell. */
export function mountUpsell(navigate) {
  let open = null
  const onQuota = (e) => {
    if (open) return
    const opener = document.activeElement
    const go = (params) => { open?.close(); navigate('plan', params) }
    const plans = C.button({ label: 'Lihat paket', icon: 'ledger', variant: 'primary', size: 'sm' })
    plans.addEventListener('click', (ev) => { ev.preventDefault(); go({}) })
    const voucher = C.button({ label: 'Tukar voucher', icon: 'check', variant: 'soft', size: 'sm' })
    voucher.addEventListener('click', (ev) => { ev.preventDefault(); go({ focus: 'voucher' }) })
    const contact = el('a', { className: 'btn btn-ghost btn-sm', href: '#/kontak' }, 'Hubungi kami')
    contact.addEventListener('click', () => open?.close())
    const later = C.button({ label: 'Nanti saja', variant: 'ghost', size: 'sm', type: 'submit' })
    open = C.modal({
      title: 'Kuota AI bulan ini sudah habis',
      description: e.detail?.message || 'Kuota fitur ini sudah habis dan saldo AI tidak cukup.',
      children: [el('p', { className: 'muted small' }, 'Data Anda tetap aman. Fitur lain yang masih punya kuota tetap bisa dipakai, dan kuota diperbarui setiap tanggal 1.')],
      actions: [later, contact, voucher, plans],
      opener,
    })
    open.dialog.classList.add('qt-upsell')
    open.dialog.addEventListener('close', () => { open = null })
  }
  window.addEventListener(QUOTA_EVENT, onQuota)
  return () => { window.removeEventListener(QUOTA_EVENT, onQuota); open?.close() }
}

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

const { el } = C

function usageBar(row) {
  const unlimited = row.limit === null
  const pct = unlimited ? 0 : row.limit === 0 ? 100 : Math.min(100, Math.round((row.used / row.limit) * 100))
  const tone = unlimited ? 'is-free' : pct >= 100 ? 'is-out' : pct >= 80 ? 'is-low' : ''
  const value = unlimited ? `${row.used} ${row.unit} · tanpa batas` : `${row.used} / ${row.limit} ${row.unit}`
  return el('li', { className: `qt-row ${tone}`.trim() },
    el('div', { className: 'qt-row-head' }, el('span', { className: 'qt-row-label' }, row.label), el('span', { className: 'qt-row-value tnum' }, value)),
    el('div', {
      className: 'qt-bar', role: 'progressbar', 'aria-label': row.label,
      'aria-valuemin': '0', 'aria-valuemax': unlimited ? '0' : String(row.limit), 'aria-valuenow': String(row.used),
    }, el('span', { className: 'qt-bar-fill', style: `width:${unlimited ? 100 : pct}%` })),
    !unlimited && row.left === 0
      ? el('p', { className: 'qt-row-note' }, `Kuota habis. Berikutnya memakai saldo AI (${rupiah(FEATURES.find((f) => f.key === row.key).price_idr)} per ${row.unit}).`)
      : null)
}

export async function render(container, ctx) {
  const summaryHost = el('div', { 'aria-live': 'polite' }, C.skeletonRows(3))
  const code = C.field({ label: 'Kode voucher', id: 'qt-voucher-code', placeholder: 'SATU-XXXX-XXXX', attrs: { maxlength: '32', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const redeem = C.button({ label: 'Tukar voucher', icon: 'check', variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'form qt-voucher-form', noValidate: true }, code.wrap, err, el('div', { className: 'form-actions' }, redeem))
  const contact = el('a', { className: 'btn btn-soft btn-sm', href: '#/kontak' }, 'Hubungi kami')
  const tiers = el('div', { className: 'lp-tiers qt-tiers' })
  const plansPanel = C.panel({ title: 'Pilih paket', meta: 'Paket tidak termasuk saldo AI' }, tiers)

  container.replaceChildren(
    C.pageHeader({ title: 'Paket & kuota' }),
    el('div', { className: 'qt-grid' },
      C.panel({ title: 'Paket Anda', className: 'qt-summary' }, summaryHost),
      C.panel({ title: 'Tukar voucher', meta: 'Satu kode untuk satu akun' },
        el('p', { className: 'muted small' }, 'Voucher bisa berisi paket, saldo AI, atau keduanya.'),
        form,
        el('p', { className: 'muted small qt-contact' }, 'Butuh kuota lebih besar atau voucher untuk tim? ', contact))),
    el('div', { className: 'lp qt-plans' }, plansPanel))

  function drawSummary(s) {
    const until = s.period_end ? `sampai ${C.formatDate(s.period_end)}` : s.plan.slug === 'free' ? 'tanpa batas waktu' : ''
    summaryHost.replaceChildren(
      el('div', { className: 'qt-plan' },
        el('div', {},
          el('p', { className: 'qt-plan-name' }, s.plan.name || 'Free', s.demo ? C.tag('Akun demo', 'accent') : ''),
          el('p', { className: 'muted small' }, [until, `kuota diperbarui ${C.formatDate(s.resets_on)}`].filter(Boolean).join(' · '))),
        el('div', { className: 'qt-credit' }, el('span', { className: 'muted small' }, 'Saldo AI'), el('strong', { className: 'tnum' }, rupiah(s.credit_idr)))),
      s.lapsed ? el('div', { className: 'note note-warn' }, C.icon('alert'), el('div', { className: 'note-body' }, el('p', {}, 'Masa paket Anda sudah berakhir, jadi kuota kembali ke paket Free.'))) : '',
      s.demo ? el('p', { className: 'muted small' }, 'Akun demo memakai AI tanpa batas untuk presentasi; pemakaian tetap tercatat.') : '',
      el('ul', { className: 'qt-rows' }, ...s.usage.map(usageBar)))
  }

  async function loadSummary() {
    try {
      const s = await getMyPlan()
      if (!ctx.signal.aborted) drawSummary(s)
    } catch (e) {
      if (ctx.signal.aborted) return
      const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
      again.addEventListener('click', () => { summaryHost.replaceChildren(C.skeletonRows(3)); loadSummary() })
      summaryHost.replaceChildren(C.errorState(e.message), again)
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    if (!code.input.value.trim()) { err.textContent = 'Masukkan kode voucher.'; code.input.focus(); return }
    const restore = C.setBusy(redeem, 'Menukar…')
    try {
      const s = await redeemVoucher(code.input.value)
      code.input.value = ''
      if (!ctx.signal.aborted) drawSummary(s)
      const r = s.redeemed
      const got = [r.type !== 'credit' ? `paket ${s.plan.name} ${r.plan_days} hari` : '', r.type !== 'plan' ? `saldo AI ${rupiah(r.credit_idr)}` : ''].filter(Boolean).join(' dan ')
      showToast(`Voucher berhasil ditukar: ${got}.`, 'success', 5000)
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

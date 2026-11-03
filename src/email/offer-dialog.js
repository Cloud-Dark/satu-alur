/**
 * "Kirim email" for an approved offer: a confirm dialog with recipient, subject and body
 * (pre-filled, editable). Requests have no email column, so the address is typed here;
 * the Worker caps offer emails per business per day and logs every send.
 */
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { sendBusinessEmail } from '../integrations/api.js'
import { offerEmailDraft } from './templates.js'
import { isEmail } from '../admin/constants.js'

const { el } = C
let seq = 0

export function openOfferEmail({ offer, request, businessName, opener, draft: override = null }) {
  const id = ++seq
  const proposal = offer?.ai_proposal_json && typeof offer.ai_proposal_json === 'object' ? offer.ai_proposal_json : {}
  // The offer wizard passes its own (possibly edited) draft; otherwise build one from the offer.
  const draft = override?.subject ? override : offerEmailDraft({
    customer: request?.customer_name, service: request?.service_type, price: offer?.validated_price,
    scope: offer?.validated_scope || proposal.scope, terms: proposal.terms, businessName,
  })
  const to = C.field({ label: 'Email pelanggan', id: `of-mail-to-${id}`, type: 'email', required: true, attrs: { maxlength: '254', autocomplete: 'off' } })
  const subject = C.field({ label: 'Subjek', id: `of-mail-subj-${id}`, value: draft.subject, required: true, attrs: { maxlength: '150' } })
  const body = C.textarea({ label: 'Isi email', id: `of-mail-body-${id}`, value: draft.body, rows: 12, required: true, attrs: { maxlength: '10000' } })
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim email', icon: 'mail', variant: 'primary', type: 'submit' })
  const cancel = C.button({ label: 'Batal', variant: 'ghost', dismiss: true })
  const { form, close } = C.modal({
    title: 'Kirim penawaran lewat email', description: 'Periksa penerima dan isinya. Email baru terkirim setelah Anda menekan Kirim.',
    opener, wide: true, actions: [cancel, send], children: [to.wrap, subject.wrap, body.wrap, err],
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const addr = to.input.value.trim()
    if (!isEmail(addr)) { err.textContent = 'Isi email pelanggan yang valid.'; to.input.focus(); return }
    const restore = C.setBusy(send, 'Mengirim…')
    try {
      const r = await sendBusinessEmail({ kind: 'offer', to: addr, subject: subject.input.value, body: body.input.value })
      showToast(r.simulated ? 'Simulasi: email tidak dikirim dari akun demo.' : `Penawaran terkirim ke ${r.to}.`, 'success')
      close()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })
  requestAnimationFrame(() => to.input.focus())
}

export function offerEmailButton({ offer, request, businessName }) {
  const b = C.button({ label: 'Email', icon: 'mail', size: 'sm', variant: 'ghost', title: 'Kirim penawaran lewat email' })
  b.addEventListener('click', () => openOfferEmail({ offer, request, businessName, opener: b }))
  return b
}

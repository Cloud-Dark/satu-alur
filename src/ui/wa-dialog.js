// "Kirim via WhatsApp": shows the recipient and the exact text (both editable) before anything is sent.
import * as C from './components.js'
import { showToast } from './animations.js'
import * as WA from '../wa/api.js'
import { WA_LIMITS } from '../wa/rules.js'
import '../styles/repliz.css'
import { t } from '../i18n/index.js'

const { el } = C
let seq = 0

/** opts: { requestId?, customer, phone, text, kind: 'offer' | 'invoice' | 'followup' | 'custom', opener, openSettings?, onSent? } */
export function openWaDialog({ requestId = null, customer, phone, text, kind = 'custom', opener, openSettings, onSent }) {
  const id = ++seq
  const to = C.field({ label: t('ui.wa.to'), id: `wa-to-${id}`, type: 'tel', required: true, value: phone || '', placeholder: t('ui.wa.toPlaceholder'),
    attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: '20' } })
  const msg = C.textarea({ label: t('ui.wa.message'), id: `wa-text-${id}`, value: text, rows: 9, attrs: { maxlength: String(WA_LIMITS.textMax) } })
  const note = el('div', { className: 'note note-info', role: 'status' }, C.icon('info'), el('div', { className: 'note-body' }, el('p', {}, t('ui.wa.checking'))))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: t('ui.wa.send'), icon: 'send', variant: 'primary', type: 'submit' })
  send.disabled = true
  const { form, close } = C.modal({
    title: t('ui.wa.title'),
    children: [C.defList([[t('ui.wa.recipient'), customer || t('ui.wa.customer')]]), to.wrap, msg.wrap, note, err],
    actions: [C.button({ label: t('ui.wa.cancel'), variant: 'ghost', dismiss: true }), send],
    opener,
  })
  const setNote = (tone, text2, action) => {
    note.className = `note note-${tone}`
    note.querySelector('.note-body').replaceChildren(el('p', {}, text2), action || '')
  }
  WA.status().then((s) => {
    if (s.demo) { setNote('info', t('ui.wa.demo')); send.disabled = false; return }
    if (!s.configured) {
      const go = openSettings ? C.button({ label: t('ui.wa.openSettings'), iconRight: 'arrowRight', size: 'sm', variant: 'soft' }) : null
      go?.addEventListener('click', () => { close(); openSettings() })
      setNote('warn', t('ui.wa.notConfigured'), go)
      return
    }
    const left = Math.max(0, (s.limits?.per_day ?? WA_LIMITS.perUserDay) - (s.used_today || 0))
    const via = (s.providers || []).find((p) => p.key === s.provider)?.label || 'WhatsApp'
    if (!s.connected && !s.note) setNote('warn', s.error || t('ui.wa.offline'))
    else setNote('info', `${s.note ? `${s.note} ` : ''}${t('ui.wa.via', { via, left })}`)
    send.disabled = false
  }).catch((e) => setNote('danger', e.message))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(send, t('ui.wa.sending'))
    try {
      const out = await WA.send({ requestId, phone: to.input.value, text: msg.input.value, kind })
      close()
      onSent?.(out)
      showToast(out.status === 'simulated' ? t('ui.wa.simulated', { to: out.to }) : t('ui.wa.sent', { to: out.to }), 'success', 5000)
    } catch (e2) { err.textContent = e2.message; restore() }
  })
}

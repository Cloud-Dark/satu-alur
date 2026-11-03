// "Kirim via WhatsApp": shows the recipient and the exact text (both editable) before anything is sent.
import * as C from './components.js'
import { showToast } from './animations.js'
import * as WA from '../wa/api.js'
import { WA_LIMITS } from '../wa/rules.js'
import '../styles/repliz.css'

const { el } = C
let seq = 0

/** opts: { requestId?, customer, phone, text, kind: 'offer' | 'invoice' | 'followup' | 'custom', opener, openSettings?, onSent? } */
export function openWaDialog({ requestId = null, customer, phone, text, kind = 'custom', opener, openSettings, onSent }) {
  const id = ++seq
  const to = C.field({ label: 'Nomor WhatsApp tujuan', id: `wa-to-${id}`, type: 'tel', required: true, value: phone || '', placeholder: '0812 3456 7890',
    attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: '20' } })
  const msg = C.textarea({ label: 'Pesan', id: `wa-text-${id}`, value: text, rows: 9, attrs: { maxlength: String(WA_LIMITS.textMax) } })
  const note = el('div', { className: 'note note-info', role: 'status' }, C.icon('info'), el('div', { className: 'note-body' }, el('p', {}, 'Memeriksa WhatsApp…')))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const send = C.button({ label: 'Kirim WhatsApp', icon: 'send', variant: 'primary', type: 'submit' })
  send.disabled = true
  const { form, close } = C.modal({
    title: 'Kirim via WhatsApp',
    children: [C.defList([['Kepada', customer || 'Pelanggan']]), to.wrap, msg.wrap, note, err],
    actions: [C.button({ label: 'Batal', variant: 'ghost', dismiss: true }), send],
    opener,
  })
  const setNote = (tone, text2, action) => {
    note.className = `note note-${tone}`
    note.querySelector('.note-body').replaceChildren(el('p', {}, text2), action || '')
  }
  WA.status().then((s) => {
    if (s.demo) { setNote('info', 'Akun demo: pesan hanya disimulasikan, tidak benar-benar terkirim.'); send.disabled = false; return }
    if (!s.configured) {
      const go = openSettings ? C.button({ label: 'Buka Pengaturan', iconRight: 'arrowRight', size: 'sm', variant: 'soft' }) : null
      go?.addEventListener('click', () => { close(); openSettings() })
      setNote('warn', 'Hubungkan akun WAPilot atau WAConsole Anda dulu di Pengaturan › Konektor.', go)
      return
    }
    const left = Math.max(0, (s.limits?.per_day ?? WA_LIMITS.perUserDay) - (s.used_today || 0))
    const via = (s.providers || []).find((p) => p.key === s.provider)?.label || 'WhatsApp'
    if (!s.connected && !s.note) setNote('warn', s.error || 'Perangkat WhatsApp Anda sedang offline. Pesan bisa gagal terkirim.')
    else setNote('info', `${s.note ? `${s.note} ` : ''}Dikirim lewat ${via}. Sisa hari ini: ${left} pesan.`)
    send.disabled = false
  }).catch((e) => setNote('danger', e.message))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const restore = C.setBusy(send, 'Mengirim…')
    try {
      const out = await WA.send({ requestId, phone: to.input.value, text: msg.input.value, kind })
      close()
      onSent?.(out)
      showToast(out.status === 'simulated' ? `Pesan disimulasikan ke ${out.to}.` : `Pesan WhatsApp terkirim ke ${out.to}.`, 'success', 5000)
    } catch (e2) { err.textContent = e2.message; restore() }
  })
}

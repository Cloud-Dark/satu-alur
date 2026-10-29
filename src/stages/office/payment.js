import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminGetPayment, adminSavePayment, adminTestPayment } from '../../business/api.js'
import { validatePaymentSettings } from '../../business/payment.js'
import { stampLine } from './site-landing.js'

const { el } = C
const PROVIDERS = [{ value: 'none', label: 'Tidak ada' }, { value: 'midtrans', label: 'Midtrans' }, { value: 'xendit', label: 'Xendit' }]
const MODES = [{ value: 'sandbox', label: 'Sandbox' }, { value: 'production', label: 'Produksi' }]
const KEEP = 'Kosongkan untuk tetap memakai yang lama.'
let seq = 0

export async function draw(host, ctx, setDirty) {
  host.replaceChildren(C.skeletonRows(4))
  let row
  try { row = await adminGetPayment() } catch (ex) {
    if (ctx.signal.aborted) return
    const again = C.button({ label: 'Coba lagi', variant: 'soft', size: 'sm' })
    again.addEventListener('click', () => draw(host, ctx, setDirty))
    host.replaceChildren(C.errorState(ex.message), again)
    return
  }
  if (!ctx.signal.aborted) render(host, ctx, setDirty, row)
}

// Rebuilt from the saved row after every Simpan, so secret inputs always come back empty.
function render(host, ctx, setDirty, row) {
  const id = ++seq
  const radios = (legend, key, options) => C.choiceGroup({ legend, type: 'radio', name: `of-pay-${key}-${id}`, options: options.map((o) => ({ ...o, checked: o.value === row[key] })) })
  const provider = radios('Penyedia', 'provider', PROVIDERS)
  const mode = radios('Mode', 'mode', MODES)
  const warn = C.message()
  const off = { autocomplete: 'off', maxlength: '200', spellcheck: 'false' }
  const client = C.field({ label: 'Client key', id: `of-pay-client-${id}`, value: row.client_key, hint: 'Kunci publik dari dashboard penyedia.', attrs: off })
  const server = C.field({ label: 'Server key', id: `of-pay-server-${id}`, type: 'password', attrs: off,
    placeholder: row.server_key_set ? `Tersimpan (…${row.server_key_last4}). ${KEEP}` : undefined, hint: 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.' })
  const clear = row.server_key_set ? C.choiceGroup({ legend: 'Server key tersimpan', name: `of-pay-clear-${id}`, options: [{ value: 'on', label: 'Hapus server key' }] }) : null
  const hook = C.field({ label: 'Webhook token', id: `of-pay-hook-${id}`, type: 'password', attrs: off,
    placeholder: row.webhook_token_set ? `Tersimpan. ${KEEP}` : undefined, hint: 'Dipakai Xendit untuk memverifikasi callback.' })

  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(row))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: 'Simpan', icon: 'save', variant: 'primary', type: 'submit' })
  const hintId = `of-pay-tes-hint-${id}`
  const tes = C.button({ label: 'Tes koneksi', variant: 'soft', 'aria-describedby': hintId })
  const tesHint = el('p', { className: 'muted small', id: hintId, hidden: true }, 'Simpan dulu untuk menguji pengaturan ini.')
  const result = C.message()

  const pick = (g) => Object.values(g.inputs).find((i) => i.checked)?.value
  const gather = () => ({
    provider: pick(provider), mode: pick(mode), client_key: client.input.value,
    server_key: server.input.value, webhook_token: hook.input.value, clear_server_key: Boolean(clear?.inputs.on.checked),
  })
  const saved = JSON.stringify(gather())
  let busy = false
  function sync() {
    const dirty = JSON.stringify(gather()) !== saved
    setDirty(dirty)
    tes.disabled = dirty || busy
    tesHint.hidden = !dirty
    if (pick(mode) === 'production') warn.show('warn', 'Mode produksi memproses pembayaran sungguhan.')
    else warn.hide()
  }

  const form = el('form', { className: 'of-list' },
    provider.wrap, mode.wrap, warn, client.wrap, server.wrap, clear?.wrap, hook.wrap, err,
    el('div', { className: 'of-row-actions' }, save, tes), tesHint, result, stamp)
  form.addEventListener('input', sync)
  form.addEventListener('change', sync)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let clean
    try { clean = validatePaymentSettings(gather()) } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(save, 'Menyimpan…')
    try {
      const next = await adminSavePayment(clean)
      if (ctx.signal.aborted) return
      render(host, ctx, setDirty, next)
      host.querySelector('button[type=submit]')?.focus()
      showToast('Pengaturan pembayaran tersimpan.', 'success')
    } catch (ex) { err.textContent = ex.message; restore() }
  })
  tes.addEventListener('click', async () => {
    result.hide()
    busy = true
    const restore = C.setBusy(tes, 'Menguji…')
    try {
      const r = await adminTestPayment()
      result.show(r.ok ? 'ok' : 'danger', r.message)
    } catch (ex) { result.show('danger', ex.message) } finally { busy = false; restore(); sync() }
  })

  host.replaceChildren(C.panel({ title: 'Payment gateway', meta: 'Midtrans atau Xendit' }, form))
  sync()
}

import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import { adminGetPayment, adminSavePayment, adminTestPayment } from '../../business/api.js'
import { validatePaymentSettings } from '../../business/payment.js'
import { stampLine } from './site-landing.js'
import { t } from '../../i18n/index.js'

const { el } = C
const PROVIDERS = () => [{ value: 'none', label: t('office.payment.none') }, { value: 'midtrans', label: 'Midtrans' }, { value: 'xendit', label: 'Xendit' }]
const MODES = () => [{ value: 'sandbox', label: 'Sandbox' }, { value: 'production', label: t('office.payment.production') }]
let seq = 0

export async function draw(host, ctx, setDirty) {
  host.replaceChildren(C.skeletonRows(4))
  let row
  try { row = await adminGetPayment() } catch (ex) {
    if (ctx.signal.aborted) return
    const again = C.button({ label: t('office.common.retry'), variant: 'soft', size: 'sm' })
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
  const provider = radios(t('office.payment.provider'), 'provider', PROVIDERS())
  const mode = radios(t('office.payment.mode'), 'mode', MODES())
  const warn = C.message()
  const off = { autocomplete: 'off', maxlength: '200', spellcheck: 'false' }
  const secret = { ...off, autocomplete: 'new-password', 'data-1p-ignore': '', 'data-lpignore': 'true' }
  const client = C.field({ label: 'Client key', id: `of-pay-client-${id}`, value: row.client_key, hint: t('office.payment.clientHint'), attrs: off })
  const server = C.field({ label: 'Server key', id: `of-pay-server-${id}`, type: 'password', attrs: secret,
    placeholder: row.server_key_set ? t('office.payment.savedLast4', { last4: row.server_key_last4 }) : undefined, hint: t('office.common.secretHint') })
  const clear = row.server_key_set ? C.choiceGroup({ legend: t('office.payment.serverKeySaved'), name: `of-pay-clear-${id}`, options: [{ value: 'on', label: t('office.payment.clearServerKey') }] }) : null
  const hook = C.field({ label: 'Webhook token', id: `of-pay-hook-${id}`, type: 'password', attrs: secret,
    placeholder: row.webhook_token_set ? t('office.payment.savedKeep') : undefined, hint: t('office.payment.hookHint') })

  const stamp = el('p', { className: 'muted small', role: 'status' }, stampLine(row))
  const err = el('p', { className: 'field-error', role: 'alert' })
  const save = C.button({ label: t('office.common.save'), icon: 'save', variant: 'primary', type: 'submit' })
  const hintId = `of-pay-tes-hint-${id}`
  const tes = C.button({ label: t('office.payment.test'), variant: 'soft', 'aria-describedby': hintId })
  const tesHint = el('p', { className: 'muted small', id: hintId, hidden: true }, t('office.payment.saveFirst'))
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
    if (pick(mode) === 'production') warn.show('warn', t('office.payment.prodWarn'))
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
    const restore = C.setBusy(save, t('office.common.saving'))
    try {
      const next = await adminSavePayment(clean)
      if (ctx.signal.aborted) return
      render(host, ctx, setDirty, next)
      host.querySelector('button[type=submit]')?.focus()
      showToast(t('office.payment.saved'), 'success')
    } catch (ex) { err.textContent = ex.message; restore() }
  })
  tes.addEventListener('click', async () => {
    result.hide()
    busy = true
    const restore = C.setBusy(tes, t('office.common.testing'))
    try {
      const r = await adminTestPayment()
      result.show(r.ok ? 'ok' : 'danger', r.message)
    } catch (ex) { result.show('danger', ex.message) } finally { busy = false; restore(); sync() }
  })

  host.replaceChildren(C.panel({ title: t('office.menu.gateway'), meta: t('office.payment.meta') }, form))
  sync()
}

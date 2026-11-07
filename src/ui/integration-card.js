// Connect / replace / remove one of the business's own integration accounts (WAPilot, WAConsole, Repliz).
// Keys are typed once and never shown again: a connected card only shows "Terhubung • …abcd".
import * as C from './components.js'
import { showToast } from './animations.js'
import * as Integrations from '../integrations/connectors.js'
import '../styles/repliz.css'
import { t } from '../i18n/index.js'

const { el } = C

/** item: one entry from Integrations.list().items; opts: { demo, enabled, onChange() } */
export function integrationCard(item, { demo = false, enabled = true, onChange } = {}) {
  const host = el('div', { className: 'ig-card', dataset: { provider: item.provider } })
  const msg = el('p', { className: 'muted small', role: 'status' })

  function drawConnected() {
    const replace = C.button({ label: t('ui.integration.replace'), icon: 'refresh', variant: 'soft', size: 'sm' })
    const remove = C.button({ label: t('ui.integration.remove'), icon: 'trash', variant: 'ghost', size: 'sm' })
    replace.setAttribute('aria-label', t('ui.integration.replaceLabel', { name: item.label }))
    remove.setAttribute('aria-label', t('ui.integration.removeLabel', { name: item.label }))
    replace.addEventListener('click', () => drawForm(true))
    remove.addEventListener('click', async () => {
      if (!confirm(t('ui.integration.confirmRemove', { name: item.label }))) return
      const restore = C.setBusy(remove, t('ui.integration.removing'))
      try {
        await Integrations.remove(item.provider)
        showToast(t('ui.integration.removed', { name: item.label }), 'success')
        await onChange?.()
      } catch (e) { msg.textContent = e.message; restore() }
    })
    const meta = Object.entries(item.meta || {}).filter(([, v]) => v).map(([k, v]) => [item.fields.find((f) => f.key === k)?.label || k, v])
    host.replaceChildren(...[
      el('div', { className: 'ig-head' }, el('strong', {}, item.label), C.tag(t('ui.integration.connected', { hint: item.hint || '••••' }), 'ok')),
      meta.length ? C.defList(meta) : null,
      item.verified_at ? null : el('p', { className: 'muted small' }, t('ui.integration.unverified')),
      el('div', { className: 'form-actions' }, replace, remove), msg].filter(Boolean))
  }

  function drawForm(replacing = false) {
    const inputs = {}
    const fields = item.fields.map((f) => {
      const fld = C.field({ label: f.label, id: `ig-${item.provider}-${f.key}`, type: f.secret ? 'password' : 'text', required: f.required,
        placeholder: f.placeholder || '', value: f.secret ? '' : (item.meta?.[f.key] || ''), attrs: { autocomplete: 'off', spellcheck: 'false' } })
      inputs[f.key] = fld.input
      return fld.wrap
    })
    const save = C.button({ label: replacing ? t('ui.integration.saveNew') : t('ui.integration.connect', { name: item.label }), icon: 'plug', variant: 'primary', type: 'submit' })
    const cancel = replacing ? C.button({ label: t('ui.integration.cancel'), variant: 'ghost' }) : null
    cancel?.addEventListener('click', () => drawConnected())
    const form = el('form', { className: 'form ig-form', noValidate: true },
      el('div', { className: 'ig-head' }, el('strong', {}, item.label), replacing ? null : C.tag(t('ui.integration.notConnected'), 'neutral')),
      el('p', { className: 'muted small' }, item.help, ' ', el('a', { href: item.url, target: '_blank', rel: 'noopener' }, t('ui.integration.openSite'))),
      ...fields, el('div', { className: 'form-actions' }, save, cancel), msg)
    if (demo || !enabled) {
      save.disabled = true
      Object.values(inputs).forEach((i) => { i.disabled = true })
      msg.textContent = demo ? t('ui.integration.demo') : t('ui.integration.disabled')
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      msg.textContent = ''
      const restore = C.setBusy(save, t('ui.integration.checking'))
      try {
        const out = await Integrations.save(item.provider, Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])))
        showToast(t('ui.integration.connectedToast', { name: item.label }), 'success')
        if (out?.note) showToast(out.note, 'info', 6000)
        await onChange?.()
      } catch (err) { msg.textContent = err.message; restore() }
    })
    host.replaceChildren(form)
  }

  if (item.connected) drawConnected()
  else drawForm(false)
  return host
}

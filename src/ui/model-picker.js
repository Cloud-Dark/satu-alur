/**
 * Model field with "Ambil daftar model": the typed input stays the source of truth; a fetched
 * list adds a searchable dropdown (combobox) that writes into it. Providers without a list
 * endpoint keep manual entry. fetchModels() resolves { supported, models: [{ id, name }] }.
 */
import { el, field, select, setOptions, button, message } from './components.js'
import { t } from '../i18n/index.js'

export function modelPicker({ id, value = '', placeholder = '', fetchModels }) {
  const input = field({ label: t('ui.model.label'), id, value, placeholder, hint: t('ui.model.hint'), attrs: { autocomplete: 'off', spellcheck: 'false', maxlength: '120' } })
  const list = select({ label: t('ui.model.listLabel'), id: `${id}-list`, options: [{ value: '', label: t('ui.model.notFetched') }] })
  list.wrap.hidden = true
  const note = message()
  const fetchBtn = button({ label: t('ui.model.fetch'), icon: 'refresh', variant: 'soft', size: 'sm' })
  list.input.addEventListener('change', () => {
    if (!list.input.value) return
    input.input.value = list.input.value
    input.input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  fetchBtn.addEventListener('click', async () => {
    note.hide()
    fetchBtn.disabled = true
    const label = fetchBtn.querySelector('.btn-label')
    const prev = label?.textContent
    if (label) label.textContent = t('ui.model.fetching')
    try {
      const r = await fetchModels()
      if (!r?.supported) {
        list.wrap.hidden = true
        note.show('info', t('ui.model.unsupported'))
        return
      }
      if (!r.models.length) { note.show('warn', t('ui.model.emptyList')); return }
      setOptions(list.input, [{ value: '', label: t('ui.model.pick', { n: r.models.length }) }, ...r.models.map((m) => ({ value: m.id, label: m.name || m.id }))],
        r.models.some((m) => m.id === input.input.value) ? input.input.value : '')
      list.wrap.hidden = false
      note.show('ok', t(r.simulated ? 'ui.model.foundSimulated' : 'ui.model.found', { n: r.models.length }))
    } catch (ex) {
      note.show('danger', ex.message)
    } finally {
      fetchBtn.disabled = false
      if (label) label.textContent = prev
    }
  })
  const wrap = el('div', { className: 'model-picker' }, input.wrap, el('div', { className: 'form-actions model-picker-actions' }, fetchBtn), list.wrap, note)
  return { wrap, input: input.input, reset() { list.wrap.hidden = true; note.hide() } }
}

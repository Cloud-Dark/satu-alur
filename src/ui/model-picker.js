/**
 * Model field with "Ambil daftar model": the typed input stays the source of truth; a fetched
 * list adds a searchable dropdown (combobox) that writes into it. Providers without a list
 * endpoint keep manual entry. fetchModels() resolves { supported, models: [{ id, name }] }.
 */
import { el, field, select, setOptions, button, message } from './components.js'

export function modelPicker({ id, value = '', placeholder = '', fetchModels }) {
  const input = field({ label: 'Model', id, value, placeholder, hint: 'Ketik nama model, atau ambil daftar dari penyedia.', attrs: { autocomplete: 'off', spellcheck: 'false', maxlength: '120' } })
  const list = select({ label: 'Pilih dari daftar model', id: `${id}-list`, options: [{ value: '', label: 'Belum diambil' }] })
  list.wrap.hidden = true
  const note = message()
  const fetchBtn = button({ label: 'Ambil daftar model', icon: 'refresh', variant: 'soft', size: 'sm' })
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
    if (label) label.textContent = 'Mengambil…'
    try {
      const r = await fetchModels()
      if (!r?.supported) {
        list.wrap.hidden = true
        note.show('info', 'Penyedia ini tidak menyediakan daftar model. Ketik nama model secara manual.')
        return
      }
      if (!r.models.length) { note.show('warn', 'Daftar model kosong. Ketik nama model secara manual.'); return }
      setOptions(list.input, [{ value: '', label: `Pilih model (${r.models.length})` }, ...r.models.map((m) => ({ value: m.id, label: m.name || m.id }))],
        r.models.some((m) => m.id === input.input.value) ? input.input.value : '')
      list.wrap.hidden = false
      note.show('ok', `${r.models.length} model ditemukan${r.simulated ? ' (simulasi)' : ''}.`)
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

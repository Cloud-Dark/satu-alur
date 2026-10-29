import * as AI from '../../ai/superpowers.js'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { validateServiceRequest } from '../../office/rules.js'
import { requestsPanel, SENT, GOALS } from './requests.js'

const { el } = C

export async function render(host, ctx) {
  const { status } = ctx
  const service = C.field({ label: 'Layanan atau produk', id: 'ads-service', required: true, placeholder: 'Pembersihan AC rumah' })
  const location = C.field({ label: 'Lokasi target', id: 'ads-location', placeholder: 'Jakarta Selatan' })
  const budget = C.field({ label: 'Anggaran harian (Rp)', id: 'ads-budget', type: 'number', value: '50000', required: true, attrs: { min: '1', max: '1000000000' } })
  const submit = C.button({ label: 'Lihat rekomendasi', icon: 'chart', variant: 'primary', type: 'submit' })
  const output = el('div', {}, C.emptyState({ title: 'Kenali calon pelanggan Anda', iconName: 'users', body: 'Isi layanan, lokasi, dan anggaran untuk melihat saran awal.' }))
  const form = el('form', { className: 'form' }, service.wrap, location.wrap, budget.wrap,
    el('p', { className: 'field-hint' }, 'Estimasi berbasis aturan umum, bukan data langsung dari Meta. Tidak membuat atau membelanjakan iklan.'), submit)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!service.input.value.trim()) { service.input.focus(); return }
    const restore = C.setBusy(submit, 'Menganalisis…')
    status.hide()
    try {
      const data = await AI.TOOLS.suggest_demographics.handler({ service_type: service.input.value.trim(), location: location.input.value.trim() || 'Indonesia', budget: Number(budget.input.value) })
      output.replaceChildren(C.tag('Estimasi awal', 'brand'), C.defList([
        ['Layanan', data.service_type], ['Lokasi', data.location], ['Usia', `${data.demographics.age_min}–${data.demographics.age_max} tahun`],
        ['Minat', data.demographics.interests.join(', ')], ['Perilaku', data.demographics.behaviors.join(', ')],
        ['Penempatan', data.placements.join(', ')], ['Anggaran / hari', C.rupiah(data.budget)],
        ['Jangkauan / hari', `${C.number(data.estimated_reach_per_day)} orang`], ['CPM', data.estimated_cpm], ['Waktu posting', data.best_posting_times.join(' · ')],
      ]))
    } catch (err) { status.show('danger', err.message) } finally { restore() }
  })
  const topic = C.field({ label: 'Topik hashtag', id: 'ht-topic', required: true, placeholder: 'Cuci sofa Jakarta' })
  const tags = el('div', { className: 'workspace-tags' })
  const tagForm = el('form', { className: 'form' }, topic.wrap, C.button({ label: 'Buat hashtag', icon: 'sparkles', variant: 'soft', type: 'submit' }), tags)
  tagForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!topic.input.value.trim()) return
    try {
      const result = await AI.TOOLS.generate_hashtags.handler({ topic: topic.input.value.trim(), count: 15 })
      tags.replaceChildren(...[...result.hashtags, ...result.suggested].map((tag) => C.button({ label: tag, variant: 'soft', size: 'sm', onClick: async () => {
        try { await navigator.clipboard.writeText(tag); showToast('Hashtag disalin.', 'success') }
        catch { status.show('danger', 'Tidak dapat menyalin hashtag. Periksa izin clipboard.') }
      } })))
    } catch (err) { status.show('danger', err.message) }
  })

  // Request to the Satu Alur team; Layanan, Lokasi and Anggaran start from the estimate form.
  const rService = C.field({ label: 'Layanan atau produk', id: 'ads-req-service', required: true })
  const rLocation = C.field({ label: 'Lokasi target', id: 'ads-req-location' })
  const rBudget = C.field({ label: 'Anggaran harian (Rp)', id: 'ads-req-budget', type: 'number', attrs: { min: '10000', max: '1000000000' } })
  const rDays = C.field({ label: 'Durasi (hari)', id: 'ads-req-days', type: 'number', attrs: { min: '1', max: '90' } })
  const rGoal = C.select({ label: 'Tujuan iklan', id: 'ads-req-goal', options: [{ value: '', label: 'Pilih tujuan' }, ...GOALS] })
  const rNotes = C.textarea({ label: 'Catatan', id: 'ads-req-notes', rows: 3 })
  const err = el('p', { className: 'field-error', id: 'ads-req-err', role: 'alert' })
  const send = C.button({ label: 'Ajukan iklan', icon: 'message', variant: 'primary', type: 'submit' })
  const list = requestsPanel('ads', ctx.signal)
  const reqForm = el('form', { className: 'form', noValidate: true }, rService.wrap, rLocation.wrap, rBudget.wrap, rDays.wrap, rGoal.wrap, rNotes.wrap, err, send)
  const prefill = () => { rService.input.value = service.input.value; rLocation.input.value = location.input.value; rBudget.input.value = budget.input.value }
  prefill()
  for (const f of [service, location, budget]) f.input.addEventListener('change', prefill)
  reqForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    let body
    try {
      body = validateServiceRequest({ kind: 'ads', payload: { service: rService.input.value, location: rLocation.input.value, daily_budget: rBudget.input.value,
        duration_days: rDays.input.value, goal: rGoal.input.value, notes: rNotes.input.value } })
    } catch (ex) { err.textContent = ex.message; return }
    const restore = C.setBusy(send, 'Mengirim…')
    try {
      await Social.sendRequest(body)
      showToast(SENT, 'success')
      if (!ctx.signal.aborted) list.load()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })

  host.replaceChildren(el('div', { className: 'workspace-stack' },
    el('div', { className: 'stage-grid workspace-grid' }, C.panel({ title: 'Rencana Meta Ads', raised: true }, form), C.panel({ title: 'Rekomendasi audience' }, output)),
    C.panel({ title: 'Hashtag', meta: 'Pilih hashtag untuk menyalin' }, tagForm),
    C.panel({ title: 'Ajukan iklan ke tim Satu Alur' }, reqForm), list))
  list.load()
}

import * as AI from '../../ai/superpowers.js'
import * as C from '../../ui/components.js'
import { showToast } from '../../ui/animations.js'
import * as Social from '../../social/api.js'
import { validateServiceRequest } from '../../office/rules.js'
import { t } from '../../i18n/index.js'
import { requestsPanel, SENT, GOALS } from './requests.js'

const { el } = C

export async function render(host, ctx) {
  const { status } = ctx
  const service = C.field({ label: t('social.ads.service'), id: 'ads-service', required: true, placeholder: t('social.ads.servicePlaceholder') })
  const location = C.field({ label: t('social.ads.location'), id: 'ads-location', placeholder: 'Jakarta Selatan' })
  const budget = C.field({ label: t('social.ads.budget'), id: 'ads-budget', type: 'number', value: '50000', required: true, attrs: { min: '1', max: '1000000000' } })
  const submit = C.button({ label: t('social.ads.submit'), icon: 'chart', variant: 'primary', type: 'submit' })
  const output = el('div', {}, C.emptyState({ title: t('social.ads.emptyTitle'), iconName: 'users', body: t('social.ads.emptyBody') }))
  const form = el('form', { className: 'form' }, service.wrap, location.wrap, budget.wrap,
    el('p', { className: 'field-hint' }, t('social.ads.disclaimer')), submit)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!service.input.value.trim()) { service.input.focus(); return }
    const restore = C.setBusy(submit, t('social.ads.analyzing'))
    status.hide()
    try {
      const data = await AI.TOOLS.suggest_demographics.handler({ service_type: service.input.value.trim(), location: location.input.value.trim() || 'Indonesia', budget: Number(budget.input.value) })
      output.replaceChildren(C.tag(t('social.ads.estimate'), 'brand'), C.defList([
        [t('social.ads.out.service'), data.service_type], [t('social.ads.out.location'), data.location], [t('social.ads.out.age'), t('social.ads.out.ageRange', { min: data.demographics.age_min, max: data.demographics.age_max })],
        [t('social.ads.out.interests'), data.demographics.interests.join(', ')], [t('social.ads.out.behaviors'), data.demographics.behaviors.join(', ')],
        [t('social.ads.out.placements'), data.placements.join(', ')], [t('social.ads.out.budget'), C.rupiah(data.budget)],
        [t('social.ads.out.reach'), t('social.ads.out.people', { n: C.number(data.estimated_reach_per_day) })], ['CPM', data.estimated_cpm], [t('social.ads.out.times'), data.best_posting_times.join(' · ')],
      ]))
    } catch (err) { status.show('danger', err.message) } finally { restore() }
  })
  const topic = C.field({ label: t('social.ads.hashtagTopic'), id: 'ht-topic', required: true, placeholder: t('social.ads.hashtagPlaceholder') })
  const tags = el('div', { className: 'workspace-tags' })
  const tagForm = el('form', { className: 'form' }, topic.wrap, C.button({ label: t('social.ads.hashtagMake'), icon: 'sparkles', variant: 'soft', type: 'submit' }), tags)
  tagForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!topic.input.value.trim()) return
    try {
      const result = await AI.TOOLS.generate_hashtags.handler({ topic: topic.input.value.trim(), count: 15 })
      tags.replaceChildren(...[...result.hashtags, ...result.suggested].map((tag) => C.button({ label: tag, variant: 'soft', size: 'sm', onClick: async () => {
        try { await navigator.clipboard.writeText(tag); showToast(t('social.ads.hashtagCopied'), 'success') }
        catch { status.show('danger', t('social.ads.hashtagCopyFail')) }
      } })))
    } catch (err) { status.show('danger', err.message) }
  })

  // Request to the Satu Alur team; Layanan, Lokasi and Anggaran start from the estimate form.
  const rService = C.field({ label: t('social.ads.service'), id: 'ads-req-service', required: true })
  const rLocation = C.field({ label: t('social.ads.location'), id: 'ads-req-location' })
  const rBudget = C.field({ label: t('social.ads.budget'), id: 'ads-req-budget', type: 'number', attrs: { min: '10000', max: '1000000000' } })
  const rDays = C.field({ label: t('social.ads.days'), id: 'ads-req-days', type: 'number', attrs: { min: '1', max: '90' } })
  const rGoal = C.select({ label: t('social.ads.goal'), id: 'ads-req-goal', options: [{ value: '', label: t('social.ads.goalPick') }, ...GOALS] })
  const rNotes = C.textarea({ label: t('social.ads.notes'), id: 'ads-req-notes', rows: 3 })
  const err = el('p', { className: 'field-error', id: 'ads-req-err', role: 'alert' })
  const send = C.button({ label: t('social.ads.requestSend'), icon: 'message', variant: 'primary', type: 'submit' })
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
    const restore = C.setBusy(send, t('social.sending'))
    try {
      await Social.sendRequest(body)
      showToast(SENT, 'success')
      if (!ctx.signal.aborted) list.load()
    } catch (ex) { err.textContent = ex.message } finally { restore() }
  })

  host.replaceChildren(el('div', { className: 'workspace-stack' },
    el('div', { className: 'stage-grid workspace-grid' }, C.panel({ title: t('social.ads.planTitle'), raised: true }, form), C.panel({ title: t('social.ads.audienceTitle') }, output)),
    C.panel({ title: t('social.ads.hashtagTitle'), meta: t('social.ads.hashtagMeta') }, tagForm),
    C.panel({ title: t('social.ads.requestTitle') }, reqForm), list))
  list.load()
}

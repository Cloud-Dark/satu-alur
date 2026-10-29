import * as AI from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'
import { getAccount } from '../social/api.js'
import * as Account from './social-media/account.js'
import * as Content from './social-media/content.js'

const { el } = C
const PLATFORMS = ['Instagram', 'Facebook'].map((label) => ({ value: label.toLowerCase(), label }))
const TABS = [
  { value: 'account', label: 'Akun' }, { value: 'content', label: 'Konten' }, { value: 'schedule', label: 'Jadwal' },
  { value: 'brainstorm', label: 'Brainstorm' }, { value: 'ads', label: 'Iklan' }, { value: 'collab', label: 'Kolaborasi' },
]
let currentTab = 'account'

export async function render(container, ctx = {}) {
  let controller = null
  let modelId = null
  let acct = { configured: true, account: null }
  let pick = null
  // Return from the Meta OAuth callback (see ui/app.js): open Akun, show the outcome, drop the query.
  const query = new URLSearchParams(location.hash.split('?')[1] || '')
  const back = { connected: query.get('social') === 'connected', error: query.get('social_error'), pick: query.get('social_pick') }
  if (back.connected || back.error || back.pick) {
    currentTab = 'account'
    pick = back.pick
    history.replaceState(null, '', '#/app')
  }
  const status = C.message()
  const host = el('div')
  const tabs = C.segmented({ options: TABS, value: currentTab, label: 'Social media', onChange: (value) => {
    controller?.abort()
    currentTab = value
    status.hide()
    draw()
  } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: 'Ruang untuk bertumbuh', em: 'bertumbuh', description: 'Siapkan konten, susun jadwal, dan temukan ide pemasaran untuk bisnis jasa Anda.' }),
    tabs, status, host)
  ctx.signal?.addEventListener('abort', () => controller?.abort(), { once: true })

  function read(key) {
    try {
      const items = JSON.parse(localStorage.getItem(key) || '[]')
      if (!Array.isArray(items)) throw new Error('Format data tidak valid.')
      return items
    } catch {
      status.show('danger', 'Data lokal tidak dapat dibaca. Data lama tidak akan ditimpa.')
      return null
    }
  }
  function write(key, items) {
    try { localStorage.setItem(key, JSON.stringify(items)); return true }
    catch { status.show('danger', 'Tidak dapat menyimpan. Periksa izin atau kapasitas penyimpanan browser.'); return false }
  }
  function scheduleTab() {
    const platform = C.select({ label: 'Platform', id: 'sched-platform', options: PLATFORMS })
    const content = C.textarea({ label: 'Konten atau caption', id: 'sched-content', required: true, attrs: { maxlength: '8000' } })
    const date = C.field({ label: 'Tanggal dan waktu', id: 'sched-date', type: 'datetime-local', required: true })
    const type = C.select({ label: 'Jenis', id: 'sched-type', options: [{ value: 'organic', label: 'Posting organik' }, { value: 'ads', label: 'Iklan' }, { value: 'story', label: 'Story / Reels' }] })
    const list = el('div')
    const submit = C.button({ label: 'Tambahkan jadwal', icon: 'calendar', variant: 'primary', type: 'submit' })
    const form = el('form', { className: 'form' }, platform.wrap, content.wrap, date.wrap, type.wrap,
      el('p', { className: 'field-hint' }, 'Jadwal adalah catatan lokal. Posting dan pengingat otomatis belum terhubung.'), submit)
    function drawList() {
      const items = read('satualur_schedules')
      if (!items) { list.replaceChildren(C.errorState('Jadwal belum dapat dibaca.')); return }
      list.replaceChildren()
      if (!items.length) list.appendChild(C.emptyState({ title: 'Belum ada jadwal', iconName: 'calendar', body: 'Tambahkan konten dan waktu untuk merencanakan posting berikutnya.' }))
      items.sort((a, b) => new Date(a.datetime) - new Date(b.datetime)).forEach((s) => list.appendChild(
        el('article', { className: 'workspace-entry' },
          el('div', { className: 'workspace-entry-head' }, el('strong', {}, s.platform), C.tag(new Date(s.datetime) < new Date() ? 'Lewat' : 'Terjadwal', 'brand')),
          el('p', { className: 'muted small' }, `${C.formatDateTime(s.datetime)} · ${s.type}`),
          el('p', { className: 'workspace-preview' }, s.content),
          C.button({ label: 'Hapus jadwal', icon: 'x', variant: 'ghost', size: 'sm', onClick: () => {
            const all = read('satualur_schedules')
            if (all && write('satualur_schedules', all.filter((x) => x.id !== s.id))) drawList()
          } }))))
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      status.hide()
      if (!content.input.value.trim()) { content.input.focus(); return }
      const items = read('satualur_schedules')
      if (!items) return
      if (!write('satualur_schedules', [...items, { id: Date.now(), platform: platform.input.value, content: content.input.value.trim(), datetime: date.input.value,
        type: type.input.value, created_at: new Date().toISOString() }])) return
      content.input.value = ''
      date.input.value = ''
      drawList()
      showToast('Jadwal tersimpan.', 'success')
    })
    host.replaceChildren(el('div', { className: 'stage-grid workspace-grid' }, C.panel({ title: 'Rencanakan posting', raised: true }, form), C.panel({ title: 'Jadwal konten', meta: 'Waktu lokal perangkat' }, list)))
    drawList()
  }
  function adsTab() {
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
    host.replaceChildren(el('div', { className: 'workspace-stack' },
      el('div', { className: 'stage-grid workspace-grid' }, C.panel({ title: 'Rencana Meta Ads', raised: true }, form), C.panel({ title: 'Rekomendasi audience' }, output)),
      C.panel({ title: 'Hashtag', meta: 'Pilih hashtag untuk menyalin' }, tagForm)))
  }
  function partnershipTab() {
    const services = [
      ['sprout', 'Organic Growth', 'Optimasi profil Google Business, ulasan pelanggan, SEO lokal, dan perencanaan konten organik.', 'Mulai Rp499rb / bulan'],
      ['users', 'Influencer Network', 'Kurasi kreator sesuai niche, koordinasi kolaborasi, persetujuan konten, dan laporan kampanye.', 'Mulai Rp1,5jt / kampanye'],
      ['bot', 'AI Agent Marketing', 'Diskusikan kebutuhan konten, analisis tren, dan otomasi pemasaran bersama tim kami.', 'Mulai Rp999rb / bulan'],
    ]
    host.replaceChildren(el('div', { className: 'workspace-stack' },
      C.panel({ title: 'Bertumbuh bersama', meta: 'Layanan partnership' },
        el('p', { className: 'panel-lead' }, 'Pilih bentuk kolaborasi sesuai kebutuhan bisnis. Aktivasi dan ruang lingkup layanan dikonfirmasi bersama tim.'),
        services.map(([name, title, description, price]) => el('article', { className: 'workspace-entry' },
          el('h3', { className: 'workspace-entry-title' }, C.icon(name), title), el('p', {}, description), el('p', { className: 'muted small' }, price))),
        el('a', { className: 'btn btn-primary', href: 'mailto:hello@satu-alur.id' }, C.icon('message'), 'Hubungi tim marketing'))))
  }
  function tabCtx() {
    return { status, signal: controller.signal, getModelId: () => modelId, account: acct.account, configured: acct.configured, loadError: acct.error, pick,
      refresh, clearPick: () => { pick = null }, goto: (value) => tabs.querySelector(`[data-value="${value}"]`).click() }
  }
  function draw() {
    controller?.abort() // stop AI streams and fetches of the tab being replaced
    controller = new AbortController()
    if (currentTab === 'account') Account.render(host, tabCtx())
    else if (currentTab === 'content' || currentTab === 'brainstorm') Content.render(host, tabCtx(), currentTab === 'brainstorm')
    else if (currentTab === 'schedule') scheduleTab()
    else if (currentTab === 'ads') adsTab()
    else partnershipTab()
  }
  async function loadAccount() {
    try { acct = await getAccount() } catch (err) { acct = { configured: true, account: null, error: err.message } }
  }
  async function refresh() {
    await loadAccount()
    if (ctx.signal?.aborted) return
    draw()
    host.setAttribute('tabindex', '-1')
    host.focus({ preventScroll: true })
  }
  host.replaceChildren(C.skeletonRows(3))
  await loadAccount()
  if (ctx.signal?.aborted) return
  draw()
  if (back.connected) status.show('ok', 'Akun berhasil terhubung.')
  else if (back.error) status.show('danger', back.error)
  try {
    await loadModels()
    if (!ctx.signal?.aborted) modelId = pickDefaultModel()?.id
  } catch (err) { status.show('warn', `Fitur AI belum tersedia: ${err.message}. Jadwal dan rekomendasi lokal tetap dapat digunakan.`) }
}

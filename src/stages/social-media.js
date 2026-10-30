import * as AI from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'

const { el } = C
const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'LinkedIn', 'X'].map((label) => ({ value: label.toLowerCase(), label }))
const TABS = [
  { value: 'content', label: 'Konten AI' }, { value: 'schedule', label: 'Jadwal' },
  { value: 'brainstorm', label: 'Brainstorm' }, { value: 'ads', label: 'Meta Ads' }, { value: 'partnership', label: 'Partnership' },
]
let currentTab = 'content'

export async function render(container, ctx = {}) {
  let controller = null
  let modelId = null
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
  function saveContent(content, type) {
    const items = read('satualur_saved_content')
    if (!items) return false
    const saved = write('satualur_saved_content', [...items, { id: Date.now(), content, type, created_at: new Date().toISOString() }])
    if (saved) showToast('Konten tersimpan di browser ini.', 'success')
    return saved
  }
  function savedList(target, type) {
    const items = read('satualur_saved_content')
    if (!items) { target.replaceChildren(C.errorState('Konten tersimpan belum dapat dibaca.')); return }
    const filtered = items.filter((s) => type === 'brainstorm' ? s.type === 'brainstorm' : s.type !== 'brainstorm').slice().reverse()
    target.replaceChildren()
    if (!filtered.length) target.appendChild(C.emptyState({ title: 'Belum ada konten tersimpan', iconName: 'file',
      body: type === 'brainstorm' ? 'Hasil brainstorming akan disimpan otomatis di sini.' : 'Buat konten, lalu pilih Simpan konten.' }))
    filtered.slice(0, 10).forEach((s) => target.appendChild(el('article', { className: 'workspace-entry' },
      el('div', { className: 'workspace-entry-head' }, C.tag(s.type), el('span', { className: 'muted small' }, C.formatDateTime(s.created_at))),
      el('p', { className: 'workspace-preview' }, s.content),
      el('div', { className: 'form-actions' },
        C.button({ label: 'Salin', icon: 'file', variant: 'soft', size: 'sm', onClick: async () => {
          try { await navigator.clipboard.writeText(s.content); showToast('Konten disalin.', 'success') }
          catch { status.show('danger', 'Tidak dapat menyalin. Periksa izin clipboard browser.') }
        } }),
        C.button({ label: 'Hapus', icon: 'x', variant: 'ghost', size: 'sm', onClick: () => {
          const all = read('satualur_saved_content')
          if (all && write('satualur_saved_content', all.filter((x) => x.id !== s.id))) savedList(target, type)
        } })),
    )))
  }
  async function generate(prompt, button, output, type, library) {
    if (!modelId) { status.show('danger', 'Model AI belum tersedia. Muat ulang halaman atau periksa pengaturan.'); return }
    const run = new AbortController()
    controller?.abort()
    controller = run
    const restore = C.setBusy(button, 'Menyiapkan konten…')
    const console = C.aiConsole({ model: modelId })
    output.replaceChildren(console.root)
    console.onStop(() => run.abort())
    console.setStatus('Menulis', true)
    status.hide()
    let full = ''
    try {
      for await (const event of AI.chatWithAgent({ agentKey: 'social', message: prompt, modelId, signal: run.signal, useMemory: false })) {
        if (run.signal.aborted || ctx.signal?.aborted) return
        if (event.type === 'error') throw new Error(event.message)
        if (event.type === 'text') {
          full = event.full
          console.writeHTML(C.sanitizeHTML(full.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')))
        }
      }
      if (!full.trim()) throw new Error('AI tidak mengembalikan konten. Silakan coba lagi.')
      console.setStatus('Selesai')
      if (type === 'brainstorm') {
        if (saveContent(full, type)) savedList(library, type)
      } else output.appendChild(C.button({ label: 'Simpan konten', icon: 'save', variant: 'soft', onClick: () => {
        if (saveContent(full, type)) savedList(library, type)
      } }))
    } catch (err) {
      console.setStatus(err.name === 'AbortError' ? 'Dihentikan' : 'Gagal')
      if (err.name !== 'AbortError') status.show('danger', err.message)
    } finally {
      console.done()
      if (run.signal.aborted) console.setStatus('Dihentikan')
      restore()
      if (controller === run) controller = null
    }
  }
  function contentTab(brainstorm = false) {
    const topic = C.field({ label: brainstorm ? 'Tema brainstorming' : 'Topik atau layanan', id: 'sm-topic', required: true,
      placeholder: 'Perawatan AC rumah di musim hujan', attrs: { maxlength: '500' } })
    const platform = C.select({ label: 'Platform', id: 'sm-platform', options: PLATFORMS })
    const type = C.select({ label: brainstorm ? 'Jumlah ide' : 'Jenis konten', id: 'sm-type', options: brainstorm
      ? ['5', '10', '20'].map((n) => ({ value: n, label: `${n} ide` }))
      : [{ value: 'caption', label: 'Caption posting' }, { value: 'naskah video', label: 'Naskah video' }, { value: 'seri story', label: 'Story series' },
        { value: 'copy iklan', label: 'Copy iklan' }, { value: 'prompt gambar AI', label: 'Prompt gambar AI' }] })
    const tone = C.select({ label: 'Gaya bahasa', id: 'sm-tone', options: ['Santai', 'Profesional', 'Inspiratif', 'Edukatif', 'Promosi'].map((label) => ({ value: label, label })) })
    const cta = C.field({ label: 'Ajakan bertindak', id: 'sm-cta', placeholder: 'Hubungi kami untuk konsultasi', attrs: { maxlength: '300' } })
    const submit = C.button({ label: brainstorm ? 'Mulai brainstorm' : 'Buat konten', icon: 'sparkles', variant: 'primary', type: 'submit' })
    const output = el('div', { className: 'workspace-output' })
    const library = el('div')
    const kind = brainstorm ? 'brainstorm' : 'content'
    const form = el('form', { className: 'form' }, topic.wrap, el('div', { className: 'form-row' }, platform.wrap, type.wrap),
      brainstorm ? null : tone.wrap, brainstorm ? null : cta.wrap, el('div', { className: 'form-actions' }, submit))
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!topic.input.value.trim()) { topic.input.focus(); return }
      const prompt = brainstorm
        ? `Lakukan brainstorm ${type.input.value} ide konten tentang ${topic.input.value.trim()} untuk ${platform.input.value}. Sertakan judul, hook, format, konsep dan estimasi engagement. Gunakan bahasa Indonesia.`
        : `Buat ${type.input.value} untuk ${platform.input.value} tentang ${topic.input.value.trim()}. Gaya: ${tone.input.value}. Ajakan bertindak: ${cta.input.value.trim()}. Gunakan bahasa Indonesia dan sertakan hashtag relevan.`
      await generate(prompt, submit, output, kind, library)
    })
    host.replaceChildren(el('div', { className: 'workspace-stack' },
      el('div', { className: 'stage-grid workspace-grid' },
        C.panel({ title: brainstorm ? 'Brainstorm lab' : 'Studio konten', meta: 'Dari ide menjadi draf', raised: true }, form),
        C.panel({ title: 'Hasil AI', meta: 'Periksa kembali sebelum digunakan' }, output)),
      C.panel({ title: brainstorm ? 'Ide tersimpan' : 'Pustaka konten', meta: 'Disimpan di browser ini' }, library)))
    output.appendChild(C.emptyState({ title: 'Mulai dari sebuah topik', iconName: 'sparkles', body: 'Isi kebutuhan Anda di formulir untuk membuat draf pertama.' }))
    savedList(library, kind)
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
  function draw() {
    if (currentTab === 'schedule') scheduleTab()
    else if (currentTab === 'ads') adsTab()
    else if (currentTab === 'partnership') partnershipTab()
    else contentTab(currentTab === 'brainstorm')
  }
  draw()
  try {
    await loadModels()
    if (!ctx.signal?.aborted) modelId = pickDefaultModel()?.id
  } catch (err) { status.show('warn', `Fitur AI belum tersedia: ${err.message}. Jadwal dan rekomendasi lokal tetap dapat digunakan.`) }
}

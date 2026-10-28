import * as Superpowers from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as Components from '../ui/components.js'
import { showToast, animateEntrance } from '../ui/animations.js'

let selectedModel = null
let currentTab = 'content'
let abortController = null

const TAB_DEFS = [
  { key: 'content', label: '📝 Konten AI', icon: '📝' },
  { key: 'schedule', label: '📅 Jadwal', icon: '📅' },
  { key: 'brainstorm', label: '💡 Brainstorm', icon: '💡' },
  { key: 'ads', label: '🎯 Meta Ads', icon: '🎯' },
  { key: 'partnership', label: '🤝 Partnership', icon: '🤝' },
]

export async function render(container) {
  container.innerHTML = ''

  try {
    await loadModels()
    selectedModel = pickDefaultModel()
  } catch (e) {
    console.warn('Model load error:', e.message)
  }

  const header = Components.el('div', { className: 'form-card card-accent-orange' },
    Components.el('h3', { className: 'form-title' }, '📱 Social Media & Meta Ads'),
    Components.el('p', { className: 'form-subtitle' }, 'Kelola konten media sosial, jadwal posting, brainstorming ide, optimasi iklan Meta, dan partnership marketing dalam satu platform.')
  )

  // Tabs
  const tabs = Components.el('div', { className: 'tab-group', style: 'margin-bottom:20px;' })
  TAB_DEFS.forEach(t => {
    const btn = Components.el('button', {
      className: t.key === currentTab ? 'active' : '',
      onClick: () => { currentTab = t.key; render(container) },
    }, `${t.icon} ${t.label}`)
    tabs.appendChild(btn)
  })

  const content = Components.el('div', {})

  if (currentTab === 'content') renderContentTab(content)
  else if (currentTab === 'schedule') renderScheduleTab(content)
  else if (currentTab === 'brainstorm') renderBrainstormTab(content)
  else if (currentTab === 'ads') renderAdsTab(content)
  else if (currentTab === 'partnership') renderPartnershipTab(content)

  container.appendChild(header)
  container.appendChild(tabs)
  container.appendChild(content)

  animateEntrance(header, 0)
  animateEntrance(content, 100)
}

/* =========================================================
   TAB 1: AI Content Manager
   ========================================================= */
function renderContentTab(container) {
  const formCard = Components.el('div', { className: 'form-card card-accent-sand' },
    Components.el('h3', { className: 'form-title' }, '📝 Generator Konten AI'),
    Components.el('p', { className: 'form-subtitle' }, 'Buat copywriting, caption, naskah, dan prompt gambar untuk media sosial Anda.')
  )

  const platformSelect = Components.selectField({
    label: 'Platform',
    id: 'sm-platform',
    options: [
      { value: 'instagram', label: '📷 Instagram' },
      { value: 'tiktok', label: '🎵 TikTok' },
      { value: 'facebook', label: '👥 Facebook' },
      { value: 'linkedin', label: '💼 LinkedIn' },
      { value: 'twitter', label: '🐦 X (Twitter)' },
    ],
  })

  const typeSelect = Components.selectField({
    label: 'Jenis Konten',
    id: 'sm-type',
    options: [
      { value: 'caption', label: '📝 Caption Posting' },
      { value: 'script', label: '🎬 Naskah Video' },
      { value: 'story', label: '📖 Story Series' },
      { value: 'ad_copy', label: '📢 Copy Iklan' },
      { value: 'image_prompt', label: '🎨 Prompt Gambar AI' },
    ],
  })

  const topicInput = Components.inputField({
    label: 'Topik / Produk / Layanan',
    id: 'sm-topic',
    placeholder: 'Contoh: Pembersihan AC rumah di Jakarta Selatan',
    required: true,
  })

  const toneSelect = Components.selectField({
    label: 'Tone & Style',
    id: 'sm-tone',
    options: [
      { value: 'casual', label: '😎 Casual & Fun' },
      { value: 'professional', label: '👔 Profesional' },
      { value: 'inspirational', label: '✨ Inspirasional' },
      { value: 'educational', label: '📚 Edukatif' },
      { value: 'promotional', label: '🛍 Promosi & Diskon' },
    ],
  })

  const ctaInput = Components.inputField({
    label: 'Call-to-Action (opsional)',
    id: 'sm-cta',
    placeholder: 'Contoh: Hubungi kami di WA 0812-3456-7890',
  })

  const resultArea = Components.el('div', { id: 'sm-content-result', style: 'margin-top:16px;' })
  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const generateBtn = Components.el('button', { type: 'button' }, '🤖 Generate Konten AI')
  generateBtn.addEventListener('click', async () => {
    const platform = formCard.querySelector('#sm-platform')?.value || 'instagram'
    const type = formCard.querySelector('#sm-type')?.value || 'caption'
    const topic = formCard.querySelector('#sm-topic')?.value?.trim()
    const tone = formCard.querySelector('#sm-tone')?.value || 'casual'
    const cta = formCard.querySelector('#sm-cta')?.value?.trim()

    if (!topic) { msg.className = 'form-message error'; msg.textContent = 'Isi topik konten.'; msg.style.display = 'block'; return }

    msg.style.display = 'none'
    resultArea.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:12px 0;"><div class="spinner"></div> AI sedang membuat konten...</div>'
    generateBtn.disabled = true

    const prompt = `Buatkan ${type === 'caption' ? 'caption Instagram' : type === 'script' ? 'naskah video pendek' : type === 'story' ? 'seri story Instagram' : type === 'ad_copy' ? 'copy iklan' : 'prompt untuk AI image generation'} untuk bisnis jasa dengan topik: "${topic}".
Platform: ${platform}
Tone: ${tone}
${cta ? 'Call-to-action: ' + cta : ''}
Jangan lupa sertakan hashtag yang relevan.`

    await streamAIResponse(prompt, resultArea, generateBtn)
  })

  const actions = Components.el('div', { className: 'form-actions' }, generateBtn)

  formCard.appendChild(platformSelect)
  formCard.appendChild(typeSelect)
  formCard.appendChild(topicInput)
  formCard.appendChild(toneSelect)
  formCard.appendChild(ctaInput)
  formCard.appendChild(actions)
  formCard.appendChild(msg)
  formCard.appendChild(resultArea)

  // Saved content library
  const libraryCard = Components.section('📚 Konten Tersimpan',
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.9rem;' }, 'Konten yang sudah Anda generate akan muncul di sini.')
  )
  libraryCard.classList.add('card-accent-brown')
  libraryCard.id = 'content-library'
  loadSavedContent(libraryCard)

  container.appendChild(formCard)
  container.appendChild(libraryCard)
}

/* =========================================================
   TAB 2: Scheduling
   ========================================================= */
function renderScheduleTab(container) {
  const formCard = Components.el('div', { className: 'form-card card-accent-olive' },
    Components.el('h3', { className: 'form-title' }, '📅 Jadwal Posting & Iklan'),
    Components.el('p', { className: 'form-subtitle' }, 'Atur jadwal posting konten dan iklan Anda. Dapatkan reminder otomatis.')
  )

  const platformSelect = Components.selectField({
    label: 'Platform',
    id: 'sched-platform',
    options: [
      { value: 'instagram', label: '📷 Instagram' },
      { value: 'tiktok', label: '🎵 TikTok' },
      { value: 'facebook', label: '👥 Facebook' },
      { value: 'linkedin', label: '💼 LinkedIn' },
    ],
  })

  const contentInput = Components.textareaField({
    label: 'Konten / Caption',
    id: 'sched-content',
    placeholder: 'Tulis konten yang akan diposting...',
    rows: 3,
    required: true,
  })

  const dateInput = Components.inputField({
    label: 'Tanggal & Waktu',
    type: 'datetime-local',
    id: 'sched-datetime',
    required: true,
  })

  const typeSelect = Components.selectField({
    label: 'Tipe',
    id: 'sched-type',
    options: [
      { value: 'organic', label: '🌱 Posting Organik' },
      { value: 'ads', label: '💰 Iklan Berbayar' },
      { value: 'story', label: '📖 Story/Reels' },
    ],
  })

  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const addBtn = Components.el('button', { type: 'button' }, '➕ Tambah ke Jadwal')
  addBtn.addEventListener('click', () => {
    const platform = formCard.querySelector('#sched-platform')?.value
    const content = formCard.querySelector('#sched-content')?.value?.trim()
    const datetime = formCard.querySelector('#sched-datetime')?.value
    const type = formCard.querySelector('#sched-type')?.value

    if (!content || !datetime) {
      msg.className = 'form-message error'; msg.textContent = 'Isi konten dan tanggal waktu.'; msg.style.display = 'block'; return
    }

    const schedules = JSON.parse(localStorage.getItem('satualur_schedules') || '[]')
    schedules.push({ id: Date.now(), platform, content, datetime, type, created_at: new Date().toISOString() })
    localStorage.setItem('satualur_schedules', JSON.stringify(schedules))

    msg.className = 'form-message success'; msg.textContent = '✅ Jadwal berhasil ditambahkan.'; msg.style.display = 'block'
    formCard.querySelector('#sched-content').value = ''
    formCard.querySelector('#sched-datetime').value = ''
    loadScheduleList()
    showToast('Jadwal ditambahkan!', 'success')
  })

  const actions = Components.el('div', { className: 'form-actions' }, addBtn)

  formCard.appendChild(platformSelect)
  formCard.appendChild(contentInput)
  formCard.appendChild(dateInput)
  formCard.appendChild(typeSelect)
  formCard.appendChild(actions)
  formCard.appendChild(msg)

  // Schedule list
  const listCard = Components.el('div', { className: 'card card-accent-brown' },
    Components.el('h3', {}, '📋 Daftar Jadwal')
  )
  listCard.id = 'schedule-list-card'

  container.appendChild(formCard)
  container.appendChild(listCard)
  loadScheduleList()
}

function loadScheduleList() {
  const card = document.querySelector('#schedule-list-card')
  if (!card) return
  const schedules = JSON.parse(localStorage.getItem('satualur_schedules') || '[]')
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))

  const list = card.querySelector('.schedule-items') || Components.el('div', { className: 'schedule-items' })
  list.innerHTML = ''

  if (schedules.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:10px 0;">Belum ada jadwal.</p>'
  } else {
    schedules.forEach((s, i) => {
      const date = new Date(s.datetime)
      const isPast = date < new Date()
      const item = Components.el('div', {
        style: `padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:10px;background:${isPast ? 'var(--bg-hover)' : 'var(--bg-card)'};opacity:${isPast ? 0.7 : 1};`
      },
        Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;' },
          Components.el('div', {},
            Components.el('strong', { style: 'font-size:0.95rem;' }, s.platform.toUpperCase()),
            Components.el('span', { style: 'color:var(--text-muted);font-size:0.8rem;display:block;margin-top:2px;' },
              `${s.type === 'organic' ? '🌱' : s.type === 'ads' ? '💰' : '📖'} ${s.type} • ${date.toLocaleString('id-ID')}`
            ),
            Components.el('p', { style: 'margin:8px 0 0;font-size:0.85rem;color:var(--text);' }, s.content.substring(0, 120) + (s.content.length > 120 ? '...' : ''))
          ),
          Components.el('button', {
            type: 'button',
            style: 'padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--danger);font-size:0.75rem;cursor:pointer;',
            onClick: () => {
              const all = JSON.parse(localStorage.getItem('satualur_schedules') || '[]')
              localStorage.setItem('satualur_schedules', JSON.stringify(all.filter(x => x.id !== s.id)))
              loadScheduleList()
              showToast('Jadwal dihapus', 'info')
            },
          }, '🗑 Hapus')
        )
      )
      animateEntrance(item, i * 50)
      list.appendChild(item)
    })
  }

  if (!card.querySelector('.schedule-items')) card.appendChild(list)
}

/* =========================================================
   TAB 3: Brainstorm
   ========================================================= */
function renderBrainstormTab(container) {
  const card = Components.el('div', { className: 'form-card card-accent-secondary' },
    Components.el('h3', { className: 'form-title' }, '💡 Brainstorm Lab'),
    Components.el('p', { className: 'form-subtitle' }, 'Berkolaborasi dengan AI untuk menghasilkan ide-ide konten kreatif.')
  )

  const topicInput = Components.inputField({
    label: 'Tema / Topik Utama',
    id: 'brain-topic',
    placeholder: 'Contoh: Tips perawatan AC di musim hujan',
    required: true,
  })

  const platformSelect = Components.selectField({
    label: 'Platform Target',
    id: 'brain-platform',
    options: [
      { value: 'instagram', label: '📷 Instagram' },
      { value: 'tiktok', label: '🎵 TikTok' },
      { value: 'facebook', label: '👥 Facebook' },
      { value: 'linkedin', label: '💼 LinkedIn' },
      { value: 'all', label: '🌐 Semua Platform' },
    ],
  })

  const countSelect = Components.selectField({
    label: 'Jumlah Ide',
    id: 'brain-count',
    options: [
      { value: '5', label: '5 Ide' },
      { value: '10', label: '10 Ide' },
      { value: '20', label: '20 Ide' },
    ],
  })

  const resultArea = Components.el('div', { id: 'brain-result', style: 'margin-top:16px;' })
  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const brainstormBtn = Components.el('button', { type: 'button' }, '💡 Mulai Brainstorm')
  brainstormBtn.addEventListener('click', async () => {
    const topic = card.querySelector('#brain-topic')?.value?.trim()
    const platform = card.querySelector('#brain-platform')?.value || 'all'
    const count = card.querySelector('#brain-count')?.value || '10'

    if (!topic) { msg.className = 'form-message error'; msg.textContent = 'Isi tema brainstorming.'; msg.style.display = 'block'; return }

    msg.style.display = 'none'
    resultArea.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:12px 0;"><div class="spinner"></div> AI sedang brainstorming...</div>'
    brainstormBtn.disabled = true

    const prompt = `Lakukan brainstorming ide konten media sosial untuk bisnis jasa dengan tema: "${topic}".
Target platform: ${platform}
Jumlah ide yang diminta: ${count} ide.
Untuk setiap ide, berikan:
1. Judul ide
2. Format konten (video, carousel, single post, story, reel)
3. Hook/pembuka yang menarik
4. Deskripsi singkat konsep
5. Estimasi engagement (rendah/sedang/tinggi)
Format dalam bahasa Indonesia yang kreatif dan engaging.`

    await streamAIResponse(prompt, resultArea, brainstormBtn)
  })

  const actions = Components.el('div', { className: 'form-actions' }, brainstormBtn)

  card.appendChild(topicInput)
  card.appendChild(platformSelect)
  card.appendChild(countSelect)
  card.appendChild(actions)
  card.appendChild(msg)
  card.appendChild(resultArea)

  // Saved ideas
  const ideasCard = Components.el('div', { className: 'card card-accent-sand' },
    Components.el('h3', {}, '💡 Ide Tersimpan')
  )
  ideasCard.id = 'brainstorm-ideas-card'
  loadSavedIdeas(ideasCard)

  container.appendChild(card)
  container.appendChild(ideasCard)
}

/* =========================================================
   TAB 4: Meta Ads Optimizer
   ========================================================= */
function renderAdsTab(container) {
  const formCard = Components.el('div', { className: 'form-card card-accent-terracotta' },
    Components.el('h3', { className: 'form-title' }, '🎯 Meta Ads Optimizer'),
    Components.el('p', { className: 'form-subtitle' }, 'Dapatkan rekomendasi targeting demografi, audience, hashtag, dan waktu posting optimal untuk iklan Meta Anda.')
  )

  const serviceInput = Components.inputField({
    label: 'Jenis Layanan / Produk',
    id: 'ads-service',
    placeholder: 'Contoh: Jasa pembersihan AC rumah',
    required: true,
  })

  const locationInput = Components.inputField({
    label: 'Lokasi Target',
    id: 'ads-location',
    placeholder: 'Contoh: Jakarta, Bandung, Surabaya',
  })

  const budgetInput = Components.inputField({
    label: 'Budget Harian (Rp)',
    type: 'number',
    id: 'ads-budget',
    placeholder: 'Contoh: 100000',
  })

  const resultArea = Components.el('div', { id: 'ads-result', style: 'margin-top:16px;' })
  const msg = Components.el('div', { className: 'form-message', style: 'display:none;' })

  const analyzeBtn = Components.el('button', { type: 'button' }, '🎯 Analisis & Rekomendasi')
  analyzeBtn.addEventListener('click', async () => {
    const service = formCard.querySelector('#ads-service')?.value?.trim()
    const location = formCard.querySelector('#ads-location')?.value?.trim() || 'Indonesia'
    const budget = Number(formCard.querySelector('#ads-budget')?.value) || 50000

    if (!service) { msg.className = 'form-message error'; msg.textContent = 'Isi jenis layanan.'; msg.style.display = 'block'; return }

    msg.style.display = 'none'
    resultArea.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);padding:12px 0;"><div class="spinner"></div> Menganalisis target audience...</div>'
    analyzeBtn.disabled = true

    // Use the suggest_demographics tool directly
    try {
      const toolResult = await Superpowers.TOOLS?.suggest_demographics?.handler?.({ service_type: service, location, budget })
      if (toolResult) {
        resultArea.innerHTML = ''
        const resultCard = buildAdsRecommendationCard(toolResult)
        resultArea.appendChild(resultCard)
        animateEntrance(resultCard)
      }
    } catch (e) {
      // Fallback: use AI streaming
      const prompt = `Beri rekomendasi lengkap untuk iklan Meta (Facebook/Instagram) untuk bisnis jasa: "${service}".
Lokasi target: ${location}
Budget harian: Rp${budget.toLocaleString('id-ID')}
Sertakan:
1. Demografi target (usia, gender, minat, perilaku)
2. Placements yang direkomendasikan
3. Estimasi reach dan CPM
4. Waktu posting terbaik
5. 10 hashtag yang relevan
6. 3 contoh copy iklan`
      await streamAIResponse(prompt, resultArea, analyzeBtn)
    }
  })

  const actions = Components.el('div', { className: 'form-actions' }, analyzeBtn)

  formCard.appendChild(serviceInput)
  formCard.appendChild(locationInput)
  formCard.appendChild(budgetInput)
  formCard.appendChild(actions)
  formCard.appendChild(msg)
  formCard.appendChild(resultArea)

  // Hashtag generator mini
  const hashtagCard = Components.el('div', { className: 'form-card card-accent-sand' },
    Components.el('h3', { className: 'form-title' }, '#️⃣ Generator Hashtag'),
    Components.el('p', { className: 'form-subtitle' }, 'Hashtag yang relevan untuk meningkatkan reach organik.')
  )

  const htTopic = Components.inputField({
    label: 'Topik',
    id: 'ht-topic',
    placeholder: 'Contoh: cuci sofa jakarta',
  })

  const htResult = Components.el('div', { id: 'ht-result', style: 'margin-top:12px;' })
  const htBtn = Components.el('button', { type: 'button', className: 'btn-secondary' }, '#️⃣ Generate Hashtag')
  htBtn.addEventListener('click', async () => {
    const topic = hashtagCard.querySelector('#ht-topic')?.value?.trim()
    if (!topic) return
    htResult.innerHTML = '<div class="spinner"></div>'
    try {
      const result = await Superpowers.TOOLS?.generate_hashtags?.handler?.({ topic, platform: 'instagram', count: 15 })
      if (result) {
        htResult.innerHTML = ''
        const tags = [...result.hashtags, ...result.suggested]
        const tagContainer = Components.el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 0;' })
        tags.forEach(tag => {
          const badge = Components.el('span', {
            style: 'padding:4px 10px;background:var(--primary-soft);color:var(--primary);border-radius:999px;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.2s;',
            onClick: (e) => {
              navigator.clipboard?.writeText(tag)
              e.target.style.background = 'var(--success)'
              e.target.style.color = '#fff'
              setTimeout(() => {
                e.target.style.background = 'var(--primary-soft)'
                e.target.style.color = 'var(--primary)'
              }, 800)
            },
          }, tag)
          tagContainer.appendChild(badge)
        })
        htResult.appendChild(tagContainer)
        showToast('Klik hashtag untuk copy!', 'success')
      }
    } catch {
      htResult.innerHTML = '<p style="color:var(--text-muted)">Gagal generate hashtag.</p>'
    }
  })

  hashtagCard.appendChild(htTopic)
  hashtagCard.appendChild(htBtn)
  hashtagCard.appendChild(htResult)

  container.appendChild(formCard)
  container.appendChild(hashtagCard)
}

function buildAdsRecommendationCard(data) {
  return Components.el('div', { className: 'card', style: 'margin-top:12px;' },
    Components.el('h3', { style: 'margin-bottom:14px;color:var(--primary);' }, '🎯 Rekomendasi Meta Ads'),
    Components.el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;' },
      Components.el('div', { className: 'about-stat' },
        Components.el('span', { className: 'num' }, data.demographics?.age_min + '-' + data.demographics?.age_max),
        Components.el('span', { className: 'lbl' }, 'Rentang Usia')
      ),
      Components.el('div', { className: 'about-stat' },
        Components.el('span', { className: 'num' }, data.estimated_reach_per_day?.toLocaleString('id-ID')),
        Components.el('span', { className: 'lbl' }, 'Est. Reach/Hari')
      ),
      Components.el('div', { className: 'about-stat' },
        Components.el('span', { className: 'num', style: 'font-size:1.2rem;' }, data.estimated_cpm),
        Components.el('span', { className: 'lbl' }, 'Est. CPM')
      )
    ),
    Components.el('div', { style: 'margin-top:16px;' },
      Components.el('strong', { style: 'font-size:0.9rem;' }, '🎯 Targeting:'), Components.el('br'),
      Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;' },
        `Minat: ${data.demographics?.interests?.join(', ')}\nPerilaku: ${data.demographics?.behaviors?.join(', ')}`
      )
    ),
    Components.el('div', { style: 'margin-top:12px;' },
      Components.el('strong', { style: 'font-size:0.9rem;' }, '📍 Placements:'), Components.el('br'),
      Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;' }, data.placements?.join(', '))
    ),
    Components.el('div', { style: 'margin-top:12px;' },
      Components.el('strong', { style: 'font-size:0.9rem;' }, '🕐 Waktu Posting Terbaik:'), Components.el('br'),
      Components.el('span', { style: 'color:var(--text-muted);font-size:0.85rem;' }, data.best_posting_times?.join(', '))
    )
  )
}

/* =========================================================
   TAB 5: Partnership Hub
   ========================================================= */
function renderPartnershipTab(container) {
  const intro = Components.el('div', { className: 'form-card card-accent-orange' },
    Components.el('h3', { className: 'form-title' }, '🤝 Partnership Marketing'),
    Components.el('p', { className: 'form-subtitle' }, 'Tingkatkan exposure bisnis Anda dengan 3 jalur kerjasama dari tim Satu Alur.')
  )

  const grid = Components.el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;' })

  // Organic
  grid.appendChild(Components.el('div', { className: 'card', style: 'border-left:3px solid var(--success);' },
    Components.el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:12px;' },
      Components.el('span', { style: 'font-size:2rem;' }, '🌱'),
      Components.el('h3', { style: 'margin:0;' }, 'Organic Growth')
    ),
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.9rem;margin-bottom:14px;line-height:1.7;' },
      'Tim Satu Alur membantu mengoptimalkan profil bisnis Anda di Google Business, Maps, dan direktori lokal. Termasuk SEO lokal, manajemen review, dan strategi konten organik.'
    ),
    Components.el('ul', { style: 'list-style:none;padding:0;margin:0 0 16px;' },
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Google Business optimization'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Manajemen review & rating'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ SEO lokal & direktori'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Content calendar organik')
    ),
    Components.el('div', { style: 'font-size:0.85rem;color:var(--text-muted);padding:10px;background:var(--bg-warm);border-radius:var(--radius-sm);' },
      '💰 Mulai dari Rp499rb/bulan'
    )
  ))

  // Influencer
  grid.appendChild(Components.el('div', { className: 'card', style: 'border-left:3px solid var(--primary);' },
    Components.el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:12px;' },
      Components.el('span', { style: 'font-size:2rem;' }, '⭐'),
      Components.el('h3', { style: 'margin:0;' }, 'Influencer Network')
    ),
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.9rem;margin-bottom:14px;line-height:1.7;' },
      'Akses ke jaringan influencer & content creator yang telah dikurasi tim Satu Alur. Dari micro-influencer hingga macro, sesuai budget dan target pasar Anda.'
    ),
    Components.el('ul', { style: 'list-style:none;padding:0;margin:0 0 16px;' },
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Kurasi influencer sesuai niche'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Negosiasi & manajemen kolaborasi'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Briefing & content approval'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Laporan performance campaign')
    ),
    Components.el('div', { style: 'font-size:0.85rem;color:var(--text-muted);padding:10px;background:var(--bg-warm);border-radius:var(--radius-sm);' },
      '💰 Mulai dari Rp1,5jt/campaign'
    )
  ))

  // AI Agent
  grid.appendChild(Components.el('div', { className: 'card', style: 'border-left:3px solid var(--accent-terracotta);' },
    Components.el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:12px;' },
      Components.el('span', { style: 'font-size:2rem;' }, '🤖'),
      Components.el('h3', { style: 'margin:0;' }, 'AI Agent Marketing')
    ),
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.9rem;margin-bottom:14px;line-height:1.7;' },
      'Gunakan AI Agent otomatis dari Satu Alur yang bekerja 24/7: membuat konten, menjawab DM, menganalisis trend, dan mengoptimalkan iklan secara real-time.'
    ),
    Components.el('ul', { style: 'list-style:none;padding:0;margin:0 0 16px;' },
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Auto-generate konten harian'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Auto-reply DM & komentar'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Trend analysis & alert'),
      Components.el('li', { style: 'padding:4px 0;font-size:0.85rem;color:var(--text-muted);' }, '✓ Auto-optimize ads budget')
    ),
    Components.el('div', { style: 'font-size:0.85rem;color:var(--text-muted);padding:10px;background:var(--bg-warm);border-radius:var(--radius-sm);' },
      '💰 Mulai dari Rp999rb/bulan'
    )
  ))

  // Contact CTA
  const ctaCard = Components.el('div', { className: 'card', style: 'text-align:center;padding:32px;' },
    Components.el('h3', { style: 'margin-bottom:10px;' }, 'Tertarik dengan Partnership?'),
    Components.el('p', { style: 'color:var(--text-muted);margin-bottom:20px;' }, 'Hubungi tim marketing kami untuk diskusi lebih lanjut dan proposal khusus untuk bisnis Anda.'),
    Components.el('a', {
      href: '/landing.html#kontak',
      className: 'btn-primary',
      style: 'display:inline-block;text-decoration:none;',
    }, '📞 Hubungi Tim Marketing')
  )

  container.appendChild(intro)
  container.appendChild(grid)
  container.appendChild(ctaCard)
}

/* =========================================================
   Helpers
   ========================================================= */
async function streamAIResponse(prompt, resultArea, button) {
  if (!selectedModel) {
    resultArea.innerHTML = '<p style="color:var(--danger)">Model AI tidak tersedia.</p>'
    button.disabled = false
    return
  }

  abortController = new AbortController()
  let fullText = ''

  try {
    const generator = Superpowers.chatWithAgent({
      agentKey: 'social',
      message: prompt,
      modelId: selectedModel.id,
      signal: abortController.signal,
      useMemory: false,
    })

    resultArea.innerHTML = ''
    const preview = Components.el('div', {
      style: 'background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:0.9rem;line-height:1.7;color:var(--text);min-height:50px;white-space:pre-wrap;'
    })
    resultArea.appendChild(preview)

    for await (const event of generator) {
      if (event.type === 'text') {
        fullText = event.full
        preview.innerHTML = fullText
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/#{1,6}\s+(.*)/g, '<h4 style="margin:10px 0 6px;color:var(--primary);">$1</h4>')
          .replace(/\n/g, '<br>')
      }
      if (event.type === 'error') {
        preview.innerHTML = '<p style="color:var(--danger)">' + event.message + '</p>'
      }
    }

    // Save button
    const saveBtn = Components.el('button', {
      type: 'button',
      style: 'margin-top:12px;padding:8px 16px;background:var(--success);color:#fff;border:none;border-radius:var(--radius-sm);font-weight:700;font-size:0.85rem;cursor:pointer;',
      onClick: () => {
        const saved = JSON.parse(localStorage.getItem('satualur_saved_content') || '[]')
        saved.push({ id: Date.now(), content: fullText, type: currentTab, created_at: new Date().toISOString() })
        localStorage.setItem('satualur_saved_content', JSON.stringify(saved))
        showToast('Konten disimpan!', 'success')
        loadSavedContent(document.querySelector('#content-library'))
      },
    }, '💾 Simpan Konten')
    resultArea.appendChild(saveBtn)

  } catch (err) {
    if (err.name === 'AbortError') {
      resultArea.innerHTML = '<p style="color:var(--text-muted)">Dibatalkan.</p>'
    } else {
      resultArea.innerHTML = '<p style="color:var(--danger)">Error: ' + err.message + '</p>'
    }
  } finally {
    button.disabled = false
    abortController = null
  }
}

function loadSavedContent(card) {
  if (!card) return
  const saved = JSON.parse(localStorage.getItem('satualur_saved_content') || '[]')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  let list = card.querySelector('.saved-content-list')
  if (!list) {
    list = Components.el('div', { className: 'saved-content-list' })
    card.appendChild(list)
  }
  list.innerHTML = ''

  if (saved.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:10px 0;">Belum ada konten tersimpan.</p>'
    return
  }

  saved.slice(0, 5).forEach((s, i) => {
    const item = Components.el('div', {
      style: 'padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--bg-card);cursor:pointer;transition:all 0.2s;',
      onClick: () => {
        navigator.clipboard?.writeText(s.content)
        showToast('Konten dicopy!', 'success')
      },
    },
      Components.el('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
        Components.el('span', { style: 'font-size:0.8rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;' }, s.type),
        Components.el('button', {
          style: 'padding:2px 8px;border:none;background:transparent;color:var(--danger);font-size:0.75rem;cursor:pointer;',
          onClick: (e) => {
            e.stopPropagation()
            const all = JSON.parse(localStorage.getItem('satualur_saved_content') || '[]')
            localStorage.setItem('satualur_saved_content', JSON.stringify(all.filter(x => x.id !== s.id)))
            loadSavedContent(card)
          },
        }, '✕')
      ),
      Components.el('p', { style: 'margin:6px 0 0;font-size:0.85rem;color:var(--text);line-height:1.5;' },
        s.content.substring(0, 150) + (s.content.length > 150 ? '...' : '')
      ),
      Components.el('span', { style: 'font-size:0.7rem;color:var(--text-dim);' }, new Date(s.created_at).toLocaleString('id-ID'))
    )
    animateEntrance(item, i * 40)
    list.appendChild(item)
  })
}

function loadSavedIdeas(card) {
  if (!card) return
  const list = card.querySelector('.saved-ideas-list') || Components.el('div', { className: 'saved-ideas-list' })
  list.innerHTML = '<p style="color:var(--text-muted);padding:10px 0;">Ide brainstorming akan tersimpan otomatis di sini.</p>'
  if (!card.querySelector('.saved-ideas-list')) card.appendChild(list)
}

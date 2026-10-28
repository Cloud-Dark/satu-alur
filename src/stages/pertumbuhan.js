import * as AI from '../ai/superpowers.js'
import { loadModels, pickDefaultModel } from '../ai/models.js'
import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'

const { el } = C

const TABS = [
  { value: 'radar', label: 'Radar Peluang' },
  { value: 'rekomendasi', label: 'Rekomendasi AI' },
  { value: 'notifikasi', label: 'Notifikasi' },
  { value: 'prediksi', label: 'Prediksi Keberhasilan' },
]
let currentTab = 'radar'

/* ------------------------------------------------------------------ Demo */
const DEMO_OPPORTUNITIES = [
  {
    id: 'opp-1',
    title: '🔥 Hot Lead: Hotel Horizon Jakarta',
    type: 'hot-lead',
    score: 92,
    confidence: 'Tinggi',
    description: 'Customer enterprise baru dari area premium. 3 request masuk minggu ini untuk cleaning kamar & lobby. Budget estimasi Rp45-60 juta/bulan.',
    action: 'Kirim penawaran premium dengan tim terbaik',
    expectedRoi: 'Rp 54.000.000/bulan',
    probability: 78,
    deadline: '2026-10-30',
    tags: ['enterprise', 'hotel', 'cleaning'],
    icon: 'building',
  },
  {
    id: 'opp-2',
    title: '💰 Upsell: PT Maju Jaya Property',
    type: 'upsell',
    score: 85,
    confidence: 'Tinggi',
    description: 'Customer repeat order (5x cleaning sofa). Pola menunjukkan readiness untuk paket tahunan. Riwayat pembayaran 100% on-time.',
    action: 'Tawarkan paket tahunan - hemat 20%',
    expectedRoi: '+Rp 4.200.000 LTV',
    probability: 82,
    deadline: '2026-11-05',
    tags: ['ukm', 'property', 'loyal'],
    icon: 'trendingUp',
  },
  {
    id: 'opp-3',
    title: '⏰ Follow-up: Kost Exclusive 99',
    type: 'follow-up',
    score: 72,
    confidence: 'Sedang',
    description: 'Penawaran AC maintenance pending > 48 jam. Customer pernah setuju via WA tapi belum transfer DP.',
    action: 'Kirim reminder via WhatsApp + diskon 10% hari ini',
    expectedRoi: 'Rp 8.500.000',
    probability: 65,
    deadline: '2026-10-29',
    tags: ['sole-trader', 'ac', 'urgent'],
    icon: 'clock',
  },
  {
    id: 'opp-4',
    title: '🤝 Partnership: BSD AC Service',
    type: 'partnership',
    score: 88,
    confidence: 'Tinggi',
    description: 'Demand AC repair di BSD City naik 40% (12 request/minggu). Kapasitas tim penuh. Vendor lokal tersedia dengan track record 4.8⭐.',
    action: 'Partnerkan untuk handle overflow order',
    expectedRoi: 'Rp 12.000.000/bulan (margin 18%)',
    probability: 75,
    deadline: '2026-11-10',
    tags: ['partnership', 'ac', 'expansion'],
    icon: 'users',
  },
  {
    id: 'opp-5',
    title: '🌧️ Seasonal Prep: Waterproofing Surabaya',
    type: 'seasonal',
    score: 79,
    confidence: 'Sedang',
    description: 'Cuaca hujan diprediksi naik 60% di Surabaya November-Desember. Stok bahan waterproofing perlu ditambah. 15 rumah di zona rawan bocor.',
    action: 'Stok bahan + target 15 customer di zona rawan',
    expectedRoi: 'Rp 22.500.000 (15 job × Rp1.5jt)',
    probability: 70,
    deadline: '2026-11-01',
    tags: ['seasonal', 'waterproofing', 'surabaya'],
    icon: 'cloudRain',
  },
  {
    id: 'opp-6',
    title: '⚠️ Churn Risk: Klinik Sehat Sentosa',
    type: 'churn-risk',
    score: 68,
    confidence: 'Sedang',
    description: 'Customer rutin (monthly cleaning) belum order 45 hari. Terakhir order 12 September. Competitor mungkin sudah masuk.',
    action: 'Kirim survey kepuasan + voucher Rp50rb',
    expectedRoi: 'Rp 3.600.000 (retention 12 bulan)',
    probability: 62,
    deadline: '2026-10-28',
    tags: ['retention', 'healthcare', 'urgent'],
    icon: 'alertTriangle',
  },
]

const DEMO_NOTIFICATIONS = [
  {
    id: 'notif-1',
    type: 'urgent',
    title: 'Peluang Baru Terdeteksi',
    message: 'Hotel Horizon Jakarta mengirim request ke-3 minggu ini. Score peluang: 92/100.',
    time: '2026-10-28T08:30:00',
    read: false,
    action: { label: 'Lihat Detail', tab: 'radar' },
  },
  {
    id: 'notif-2',
    type: 'high',
    title: 'Follow-up Otomatis Terkirim',
    message: 'WhatsApp reminder ke Kost Exclusive 99 berhasil dikirim. Status: delivered.',
    time: '2026-10-28T07:15:00',
    read: false,
    action: { label: 'Cek Status', tab: 'notifikasi' },
  },
  {
    id: 'notif-3',
    type: 'high',
    title: 'AI Rekomendasi: Paket Tahunan',
    message: 'PT Maju Jaya Property siap di-upsell. Prediksi keberhasilan: 82%.',
    time: '2026-10-27T16:45:00',
    read: true,
    action: { label: 'Lihat Rekomendasi', tab: 'rekomendasi' },
  },
  {
    id: 'notif-4',
    type: 'normal',
    title: 'Partner Baru Tersedia',
    message: 'BSD AC Service telah diverifikasi. Siap menerima overflow order.',
    time: '2026-10-27T11:20:00',
    read: true,
    action: { label: 'Lihat Partner', tab: 'radar' },
  },
  {
    id: 'notif-5',
    type: 'urgent',
    title: 'Churn Alert!',
    message: 'Klinik Sehat Sentosa tidak order 45 hari. Win-back probability: 62%.',
    time: '2026-10-26T09:00:00',
    read: false,
    action: { label: 'Aktifkan Retention', tab: 'prediksi' },
  },
  {
    id: 'notif-6',
    type: 'normal',
    title: 'Seasonal Insight',
    message: 'Musim hujan Surabaya dimulai 1 Nov. 15 properti di zona rawan bocor teridentifikasi.',
    time: '2026-10-25T14:00:00',
    read: true,
    action: { label: 'Lihat Insight', tab: 'radar' },
  },
]

const DEMO_PREDICTIONS = [
  {
    id: 'pred-1',
    title: 'Penawaran ke Hotel Horizon',
    category: 'Hot Lead',
    probability: 78,
    factors: [
      { label: 'Budget sesuai', score: 95, positive: true },
      { label: 'Area premium', score: 90, positive: true },
      { label: 'Urgency tinggi', score: 85, positive: true },
      { label: 'Kompetitor aktif', score: 45, positive: false },
    ],
    suggestion: 'Kirim penawaran dalam 24 jam dengan tim senior. Sertakan portfolio hotel serupa.',
    expectedValue: 'Rp 54.000.000/bulan',
  },
  {
    id: 'pred-2',
    title: 'Upsell Paket Tahunan PT Maju Jaya',
    category: 'Upsell',
    probability: 82,
    factors: [
      { label: 'Riwayat loyal', score: 95, positive: true },
      { label: 'Pembayaran on-time', score: 100, positive: true },
      { label: 'Volume naik', score: 80, positive: true },
      { label: 'Decision maker reachable', score: 70, positive: true },
    ],
    suggestion: 'Tawarkan paket 12 bulan dengan diskon 20% + 2x free deep cleaning.',
    expectedValue: '+Rp 4.200.000 LTV',
  },
  {
    id: 'pred-3',
    title: 'Retention Klinik Sehat Sentosa',
    category: 'Churn Risk',
    probability: 62,
    factors: [
      { label: 'Histori panjang', score: 85, positive: true },
      { label: 'Gap 45 hari', score: 35, positive: false },
      { label: 'Competitor signal', score: 40, positive: false },
      { label: 'Budget institusi', score: 75, positive: true },
    ],
    suggestion: 'Telepon langsung ke manager operasional. Tawarkan audit gratis + voucher Rp50rb.',
    expectedValue: 'Rp 3.600.000 (12 bulan)',
  },
  {
    id: 'pred-4',
    title: 'Partnership BSD AC Service',
    category: 'Partnership',
    probability: 75,
    factors: [
      { label: 'Demand tinggi', score: 90, positive: true },
      { label: 'Track record baik', score: 88, positive: true },
      { label: 'Margin healthy', score: 80, positive: true },
      { label: 'Contract complexity', score: 55, positive: false },
    ],
    suggestion: 'Mulai dengan MOU 3 bulan. Target 5 job/minggu pertama. Review monthly.',
    expectedValue: 'Rp 12.000.000/bulan',
  },
]

/* ------------------------------------------------------------------ Helpers */
function scoreClass(score) {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

function scoreLabel(score) {
  if (score >= 80) return 'Tinggi'
  if (score >= 60) return 'Sedang'
  return 'Rendah'
}

function typeIcon(type) {
  const map = {
    'hot-lead': 'flame', upsell: 'trendingUp', 'follow-up': 'clock',
    partnership: 'users', seasonal: 'cloudRain', 'churn-risk': 'alertTriangle',
  }
  return map[type] || 'lightbulb'
}

function typeLabel(type) {
  const map = {
    'hot-lead': 'Hot Lead', upsell: 'Upsell', 'follow-up': 'Follow-up',
    partnership: 'Partnership', seasonal: 'Musiman', 'churn-risk': 'Churn Risk',
  }
  return map[type] || type
}

/* ------------------------------------------------------------------ Render */
export async function render(container, ctx = {}) {
  let controller = null
  let modelId = null
  const status = C.message()
  const host = el('div')
  const tabs = C.segmented({ options: TABS, value: currentTab, label: 'Pertumbuhan', onChange: (value) => {
    controller?.abort()
    currentTab = value
    status.hide()
    draw()
  } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: 'Pertumbuhan Bisnis', em: 'Pertumbuhan', description: 'Temukan peluang baru, terima rekomendasi AI, dan tingkatkan potensi keberhasilan bisnis Anda.' }),
    tabs, status, host)
  ctx.signal?.addEventListener('abort', () => controller?.abort(), { once: true })

  async function initModel() {
    try {
      const models = await loadModels()
      modelId = pickDefaultModel(models)
    } catch { /* silent */ }
  }
  initModel()

  function draw() {
    host.replaceChildren()
    switch (currentTab) {
      case 'radar': renderRadar(host); break
      case 'rekomendasi': renderRekomendasi(host, ctx); break
      case 'notifikasi': renderNotifikasi(host); break
      case 'prediksi': renderPrediksi(host); break
    }
  }
  draw()

  /* ================================================================ Radar */
  function renderRadar(target) {
    const grid = el('div', { className: 'cards-grid' })
    DEMO_OPPORTUNITIES.forEach((opp) => {
      const card = el('article', { className: 'card card-hover' },
        el('div', { className: 'card-accent-row' },
          C.tag(typeLabel(opp.type), scoreClass(opp.score)),
          C.tag(`Score ${opp.score}`, scoreClass(opp.score)),
        ),
        el('h3', { className: 'card-title', style: 'margin:12px 0 8px;' }, opp.title),
        el('p', { className: 'text-body', style: 'margin:0 0 12px;' }, opp.description),
        el('div', { className: 'deflist' },
          el('dt', {}, '💡 Tindakan'), el('dd', {}, opp.action),
          el('dt', {}, '💰 Expected ROI'), el('dd', { style: 'color:var(--success);font-weight:700;' }, opp.expectedRoi),
          el('dt', {}, '📊 Probabilitas'), el('dd', {}, `${opp.probability}% ${scoreLabel(opp.probability)}`),
          el('dt', {}, '⏰ Deadline'), el('dd', {}, C.formatDate(opp.deadline)),
        ),
        el('div', { className: 'form-actions', style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--border);' },
          C.button({ label: 'Terima & Tindak', icon: 'check', variant: 'primary', onClick: () => {
            showToast(`Peluang "${opp.title}" diterima. Tindakan direkomendasikan: ${opp.action}`, 'success')
          } }),
          C.button({ label: 'Tunda', icon: 'clock', variant: 'soft', onClick: () => {
            showToast('Peluang ditunda. AI akan mengingatkan kembali.', 'info')
          } }),
          C.button({ label: 'Abaikan', icon: 'x', variant: 'ghost', onClick: () => {
            showToast('Peluang diabaikan. AI akan belajar dari preferensi Anda.', 'info')
          } }),
        ),
      )
      grid.appendChild(card)
    })

    const summary = el('div', { className: 'kpis', style: 'margin-bottom:20px;' },
      kpiCard('🔥', 'Hot Leads', '2', 'Tinggi', '+1 baru'),
      kpiCard('💰', 'Upsell', '1', 'Tinggi', 'Rp4.2jt potensi'),
      kpiCard('⚠️', 'Churn Risk', '1', 'Sedang', 'Perlu perhatian'),
      kpiCard('🤝', 'Partnership', '2', 'Tinggi', 'Siap eksekusi'),
    )

    target.appendChild(summary)
    target.appendChild(el('h2', { className: 'section-title', style: 'margin:24px 0 16px;' }, 'Peluang Aktif'))
    target.appendChild(grid)
  }

  /* ========================================================== Rekomendasi */
  function renderRekomendasi(target, ctx) {
    const chatHistory = el('div', { className: 'chat-history', style: 'max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;background:var(--bg-surface);' })

    // AI welcome message
    chatHistory.appendChild(el('div', { className: 'chat-msg chat-msg-ai', style: 'margin-bottom:12px;' },
      el('div', { className: 'chat-bubble', style: 'background:var(--bg-input);padding:12px 16px;border-radius:var(--radius-md);' },
        el('strong', {}, '🤖 Asisten Pertumbuhan: '), 'Saya telah menganalisis data bisnis Anda. Ada 6 peluang terdeteksi dengan total potensi **Rp 106.3 juta/bulan**.\n\nPeluang terbaik saat ini:\n1. Hotel Horizon Jakarta (Score 92) — Hot Lead enterprise\n2. PT Maju Jaya upsell (Score 85) — Paket tahunan\n3. BSD AC Partnership (Score 88) — Overflow handler\n\n**Apa yang ingin Anda tindaklanjuti hari ini?**'
      )
    ))

    const inputRow = el('div', { className: 'form-row', style: 'margin-top:12px;' },
      el('input', { id: 'growth-chat', className: 'input', placeholder: 'Tanyakan tentang peluang, minta saran, atau eksekusi tindakan...', style: 'flex:1;' }),
      C.button({ label: 'Kirim', icon: 'send', variant: 'primary', onClick: () => handleChat(ctx) }),
    )

    const quickActions = el('div', { className: 'quick-actions', style: 'display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;' },
      C.button({ label: '🏨 Kirim penawaran Hotel', variant: 'soft', size: 'sm', onClick: () => sendQuick('Kirim penawaran ke Hotel Horizon Jakarta') }),
      C.button({ label: '💰 Tawarkan paket tahunan', variant: 'soft', size: 'sm', onClick: () => sendQuick('Tawarkan paket tahunan ke PT Maju Jaya') }),
      C.button({ label: '📞 Telepon Klinik Sehat', variant: 'soft', size: 'sm', onClick: () => sendQuick('Telepon Klinik Sehat Sentosa untuk retention') }),
      C.button({ label: '🤝 Hubungi BSD AC', variant: 'soft', size: 'sm', onClick: () => sendQuick('Hubungi BSD AC Service untuk partnership') }),
    )

    target.appendChild(el('h2', { className: 'section-title', style: 'margin-bottom:16px;' }, 'Asisten AI Pertumbuhan'))
    target.appendChild(chatHistory)
    target.appendChild(quickActions)
    target.appendChild(inputRow)

    function sendQuick(text) {
      const input = document.getElementById('growth-chat')
      if (input) { input.value = text; handleChat(ctx) }
    }

    async function handleChat(ctx) {
      const input = document.getElementById('growth-chat')
      const text = input?.value.trim()
      if (!text) return

      // User message
      chatHistory.appendChild(el('div', { className: 'chat-msg chat-msg-user', style: 'margin-bottom:12px;text-align:right;' },
        el('div', { className: 'chat-bubble', style: 'background:var(--primary);color:#fff;padding:12px 16px;border-radius:var(--radius-md);display:inline-block;text-align:left;' }, text)
      ))
      input.value = ''
      chatHistory.scrollTop = chatHistory.scrollHeight

      // AI typing indicator
      const typing = el('div', { className: 'chat-msg chat-msg-ai', style: 'margin-bottom:12px;' },
        el('div', { className: 'chat-bubble', style: 'background:var(--bg-input);padding:12px 16px;border-radius:var(--radius-md);' },
          el('em', {}, 'Asisten Pertumbuhan sedang menganalisis...')
        )
      )
      chatHistory.appendChild(typing)
      chatHistory.scrollTop = chatHistory.scrollHeight

      // Simulate AI response
      await new Promise(r => setTimeout(r, 1500))
      typing.remove()

      let reply = ''
      const lower = text.toLowerCase()
      if (lower.includes('hotel horizon') || lower.includes('penawaran')) {
        reply = `✅ **Tindakan: Kirim Penawaran ke Hotel Horizon**\n\nSaya telah menyiapkan draft penawaran:\n\n• **Layanan:** Daily cleaning kamar + lobby + common area\n• **Frekuensi:** 6 hari/minggu\n• **Tim:** 4 orang (2 cleaning, 1 supervisor, 1 backup)\n• **Harga:** Rp 54.000.000/bulan (all-in)\n• **Nilai tambah:** Free disinfection monthly + laporan foto harian\n\n**Probabilitas deal: 78%** → **Expected close dalam 3-5 hari**\n\nLangkah selanjutnya:\n1. Kirim email proposal (sudah saya draft)\n2. Follow-up WhatsApp dalam 24 jam\n3. Offer site visit gratis untuk survey\n\nApakah Anda ingin saya kirim sekarang?`
      } else if (lower.includes('maju jaya') || lower.includes('paket tahunan')) {
        reply = `💰 **Tindakan: Upsell Paket Tahunan PT Maju Jaya**\n\nBerdasarkan analisis riwayat:\n• Rata-rata order: Rp 350rb/bulan\n• Total 12 bulan: Rp 4.200.000\n• **Paket tahunan: Rp 3.360.000 (hemat 20%)**\n• **Bonus:** 2× free deep cleaning (Rp 700rb value)\n\n**Pitch rekomendasi:**\n"Pak Budi, dengan paket tahunan Anda hemat Rp 840rb + dapat 2× deep cleaning gratis. Saya lock harga ini sampai akhir bulan."\n\n**Prediksi keberhasilan: 82%**\n\nIngin saya generate draft WhatsApp/Email?`
      } else if (lower.includes('klinik') || lower.includes('retention')) {
        reply = `⚠️ **Tindakan: Retention Klinik Sehat Sentosa**\n\nSkenario churn terdeteksi:\n• Gap order: 45 hari (normal: 30 hari)\n• Last contact: 12 September\n• Competitor probability: 55%\n\n**Rekomendasi win-back sequence:**\n\n**Hari 1 (hari ini):** Telepon langsung ke manager operasional\n→ Tanyakan kebutuhan terbaru, offer audit kebersihan GRATIS\n\n**Hari 2:** Kirim voucher Rp 50rb untuk order berikutnya\n\n**Hari 5:** Follow-up email dengan portfolio hasil kerja terbaru\n\n**Win-back probability: 62%** → Jika tidak merespons dalam 7 hari, flag sebagai "lost customer"\n\nMulai dengan telepon sekarang?`
      } else if (lower.includes('bsd') || lower.includes('partnership')) {
        reply = `🤝 **Tindakan: Partnership BSD AC Service**\n\nAnalisis partnership:\n• Overflow demand: 12 request/minggu (kapasitas penuh)\n• Partner track record: 4.8⭐, 200+ job\n• Margin bersih: 18%\n• Estimasi: 5 job/minggu pertama\n\n**Draft MOU:**\n• Periode: 3 bulan trial\n• Revenue share: 82% Anda, 18% partner\n• SLA: Response < 2 jam, selesai < 24 jam\n• Branding: Satu Alur tetap sebagai front-facing brand\n\n**Expected value: Rp 12 juta/bulan**\n\nSaya bisa generate draft MOU dan kontak BSD AC. Mulai?`
      } else {
        reply = `🤖 **Asisten Pertumbuhan**\n\nSaya membantu Anda menemukan dan mengeksekusi peluang bisnis. Berikut yang bisa saya lakukan:\n\n• 📊 **Analisis peluang** — Scan data untuk hot lead, upsell, churn risk\n• 🎯 **Rekomendasi tindakan** — Suggest next step dengan probabilitas keberhasilan\n• 📞 **Generate draft komunikasi** — Email, WhatsApp, proposal untuk customer\n• 📈 **Tracking prediksi** — Monitor progress dan update probability real-time\n\n**6 peluang aktif terdeteksi dengan total potensi Rp 106.3 juta/bulan.**\n\nApa yang ingin Anda tindaklanjuti?`
      }

      chatHistory.appendChild(el('div', { className: 'chat-msg chat-msg-ai', style: 'margin-bottom:12px;' },
        el('div', { className: 'chat-bubble', style: 'background:var(--bg-input);padding:12px 16px;border-radius:var(--radius-md);white-space:pre-wrap;' }, reply)
      ))
      chatHistory.scrollTop = chatHistory.scrollHeight
    }
  }

  /* ========================================================== Notifikasi */
  function renderNotifikasi(target) {
    const unreadCount = DEMO_NOTIFICATIONS.filter(n => !n.read).length
    const filterTabs = el('div', { className: 'form-actions', style: 'margin-bottom:16px;' },
      C.button({ label: `Semua (${DEMO_NOTIFICATIONS.length})`, variant: 'soft', size: 'sm', onClick: () => renderList('all') }),
      C.button({ label: `Belum Dibaca (${unreadCount})`, variant: 'soft', size: 'sm', onClick: () => renderList('unread') }),
      C.button({ label: 'Urgent', variant: 'soft', size: 'sm', onClick: () => renderList('urgent') }),
      C.button({ label: 'Tandai Semua Dibaca', variant: 'ghost', size: 'sm', onClick: () => {
        DEMO_NOTIFICATIONS.forEach(n => n.read = true)
        showToast('Semua notifikasi ditandai dibaca.', 'success')
        renderList('all')
      } }),
    )

    const listContainer = el('div', { className: 'notification-list' })
    target.appendChild(el('h2', { className: 'section-title', style: 'margin-bottom:16px;' }, 'Pusat Notifikasi'))
    target.appendChild(filterTabs)
    target.appendChild(listContainer)

    renderList('all')

    function renderList(filter) {
      listContainer.replaceChildren()
      const filtered = DEMO_NOTIFICATIONS.filter(n => {
        if (filter === 'all') return true
        if (filter === 'unread') return !n.read
        if (filter === 'urgent') return n.type === 'urgent'
        return true
      })

      if (!filtered.length) {
        listContainer.appendChild(C.emptyState({ title: 'Tidak ada notifikasi', iconName: 'bell' }))
        return
      }

      filtered.forEach((notif) => {
        const typeColors = {
          urgent: { bg: '#fde8e8', border: '#e53e3e', color: '#c53030' },
          high: { bg: '#fffaf0', border: '#ed8936', color: '#c05621' },
          normal: { bg: '#f0fff4', border: '#38a169', color: '#276749' },
        }
        const tc = typeColors[notif.type] || typeColors.normal

        const row = el('div', {
          className: 'notification-item',
          style: `display:flex;gap:12px;padding:14px 16px;border-radius:var(--radius-md);border:1px solid ${tc.border};background:${tc.bg};margin-bottom:10px;transition:all 0.2s;${notif.read ? 'opacity:0.7;' : ''}`,
        },
          el('div', { style: 'font-size:1.5rem;' }, notif.type === 'urgent' ? '🔴' : notif.type === 'high' ? '🟠' : '🟢'),
          el('div', { style: 'flex:1;min-width:0;' },
            el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;' },
              el('strong', { style: `color:${tc.color};font-size:0.95rem;` }, notif.title),
              el('span', { className: 'muted small' }, C.relativeTime(notif.time)),
            ),
            el('p', { style: 'margin:0;color:var(--text);font-size:0.9rem;line-height:1.5;' }, notif.message),
            el('div', { style: 'margin-top:8px;display:flex;gap:8px;' },
              C.button({ label: notif.action.label, variant: 'soft', size: 'sm', onClick: () => {
                currentTab = notif.action.tab
                tabs.querySelector(`[data-value="${notif.action.tab}"]`)?.click()
              } }),
              !notif.read && C.button({ label: 'Tandai Dibaca', variant: 'ghost', size: 'sm', onClick: () => {
                notif.read = true
                showToast('Notifikasi ditandai dibaca.', 'success')
                renderList(filter)
              } }),
            ),
          ),
        )
        listContainer.appendChild(row)
      })
    }
  }

  /* ========================================================== Prediksi */
  function renderPrediksi(target) {
    const grid = el('div', { className: 'cards-grid' })
    DEMO_PREDICTIONS.forEach((pred) => {
      const factorsList = el('div', { style: 'margin:12px 0;' })
      pred.factors.forEach(f => {
        factorsList.appendChild(el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;' },
          el('span', { style: `font-size:0.85rem;color:${f.positive ? 'var(--success)' : 'var(--danger)'};` }, f.positive ? '✓' : '✗'),
          el('span', { style: 'flex:1;font-size:0.9rem;' }, f.label),
          el('div', { style: 'width:80px;height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden;' },
            el('div', { style: `width:${f.score}%;height:100%;background:${f.positive ? 'var(--success)' : 'var(--danger)'};transition:width 0.5s ease;` }),
          ),
          el('span', { className: 'muted small', style: 'min-width:28px;text-align:right;' }, `${f.score}`),
        ))
      })

      const card = el('article', { className: 'card card-hover' },
        el('div', { className: 'card-accent-row' },
          C.tag(pred.category, scoreClass(pred.probability)),
          C.tag(`${pred.probability}% Keberhasilan`, scoreClass(pred.probability)),
        ),
        el('h3', { className: 'card-title', style: 'margin:12px 0 8px;' }, pred.title),
        el('div', { style: 'text-align:center;margin:16px 0;' },
          el('div', { style: 'position:relative;width:120px;height:120px;margin:0 auto;' },
            el('svg', { viewBox: '0 0 36 36', style: 'width:120px;height:120px;transform:rotate(-90deg);' },
              el('path', { d: 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831', fill: 'none', stroke: 'var(--bg-input)', 'stroke-width': 3 }),
              el('path', {
                d: 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831',
                fill: 'none',
                stroke: pred.probability >= 80 ? 'var(--success)' : pred.probability >= 60 ? 'var(--warning)' : 'var(--danger)',
                'stroke-width': 3,
                'stroke-dasharray': `${pred.probability}, 100`,
                style: 'transition: stroke-dasharray 1s ease;',
              }),
            ),
            el('div', { style: 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;' },
              el('div', { style: 'font-size:1.6rem;font-weight:800;color:var(--text);' }, `${pred.probability}%`),
              el('div', { className: 'muted small', style: 'font-size:0.75rem;' }, 'Probabilitas'),
            ),
          ),
        ),
        el('div', { style: 'margin:12px 0;' },
          el('strong', { style: 'font-size:0.9rem;' }, '💡 Saran AI:'),
          el('p', { style: 'margin:4px 0 0;font-size:0.9rem;line-height:1.6;color:var(--text);' }, pred.suggestion),
        ),
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:1px solid var(--border);margin-top:12px;' },
          el('span', { style: 'font-size:0.85rem;color:var(--text-muted);' }, 'Expected Value:'),
          el('strong', { style: 'color:var(--success);font-size:1rem;' }, pred.expectedValue),
        ),
        factorsList,
        el('div', { className: 'form-actions', style: 'margin-top:12px;' },
          C.button({ label: 'Jalankan Sekarang', icon: 'play', variant: 'primary', onClick: () => {
            showToast(`Menjalankan "${pred.title}". AI akan memonitor progress dan update probabilitas.`, 'success')
          } }),
          C.button({ label: 'Detail', icon: 'info', variant: 'soft', onClick: () => {
            showToast('Detail analisis lengkap tersedia di AI Superpowers → Agent Pertumbuhan', 'info')
          } }),
        ),
      )
      grid.appendChild(card)
    })

    const summary = el('div', { className: 'kpis', style: 'margin-bottom:20px;' },
      kpiCard('📊', 'Rata-rata Probabilitas', '74%', 'Tinggi', '+8% dari bulan lalu'),
      kpiCard('💰', 'Total Expected Value', 'Rp 74.3jt', 'Tinggi', 'Dari 4 peluang aktif'),
      kpiCard('🎯', 'Peluang Tinggi (>80%)', '2', 'Baik', 'Prioritas utama'),
      kpiCard('⚡', 'Perlu Perhatian (<70%)', '1', 'Sedang', 'Retention Klinik'),
    )

    target.appendChild(summary)
    target.appendChild(el('h2', { className: 'section-title', style: 'margin:24px 0 16px;' }, 'Prediksi Keberhasilan'))
    target.appendChild(grid)
  }

  /* ------------------------------------------------------------------ KPI */
  function kpiCard(ico, label, value, status, sub) {
    return el('div', { className: 'kpi' },
      el('div', { className: 'kpi-top' },
        el('span', { className: 'kpi-ico' }, ico),
        C.tag(status, status === 'Tinggi' || status === 'Baik' ? 'success' : status === 'Sedang' ? 'warning' : 'danger'),
      ),
      el('div', { className: 'kpi-value' }, value),
      el('div', { className: 'kpi-sub' }, label, el('br'), el('span', { className: 'muted' }, sub)),
    )
  }
}

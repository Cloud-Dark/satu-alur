import * as C from '../ui/components.js'
import { showToast } from '../ui/animations.js'

const { el } = C

const INDUSTRIES = [
  {
    tier: 'sole-trader',
    tierLabel: 'Sole Trader',
    description: 'Pe bisnis perorangan yang baru memulai atau menjalankan operasional sendiri.',
    cases: [
      {
        name: 'Budi — Tukang AC Mandiri',
        location: 'Jakarta Selatan',
        service: 'Service & Cuci AC',
        story: 'Budi mulai dengan catatan manual di buku dan order via WhatsApp. Setelah pakai Satu Alur, semua permintaan pelanggan tercatat rapi, penawaran AI membantu dia menentukan harga yang kompetitif, dan pembukuan otomatis memudahkan lapor pajak.',
        before: '5 order/bulan, harga nebak-nebak, pembukuan berantakan',
        after: '18 order/bulan, harga konsisten +20% profit, laporan keuangan otomatis',
        metrics: { revenue: 'Rp8.5jt/bulan', growth: '+112%', clients: '24 aktif' },
      },
      {
        name: 'Mba Yanti — Cuci Sofa & Karpet',
        location: 'Bandung',
        service: 'Home Deep Cleaning',
        story: 'Dari promosi di grup Facebook saja, Mba Yanti kesulitan tracking siapa yang sudah bayar. Dengan Satu Alur, status pembayaran otomatis terlacak dan pengingat follow-up membantunya tidak kehilangan pelanggan.',
        before: 'Tracking manual, sering lupa follow-up, tidak tahu profit bersih',
        after: '0 pelanggan terlewat, profit bersih tercatat jelas, bisa fokus ke pelayanan',
        metrics: { revenue: 'Rp5.2jt/bulan', growth: '+85%', clients: '15 aktif' },
      },
      {
        name: 'Pak Rudi — Tukang Kebocoran',
        location: 'Surabaya',
        service: 'Perbaikan Kebocoran & Waterproofing',
        story: 'Pak Rudi sering undercharge karena lupa bahan yang dipakai. Fitur jurnal otomatis Satu Alur mencatat setiap biaya material dan tenaga, jadi dia tahu pasti laba setiap proyek.',
        before: 'Undercharge 30% proyek, tidak tahu biaya aktual',
        after: 'Pricing akurat 100%, laba per proyek tercatat real-time',
        metrics: { revenue: 'Rp12jt/bulan', growth: '+65%', clients: '8 aktif' },
      },
    ],
  },
  {
    tier: 'ukm',
    tierLabel: 'UKM',
    description: 'Usaha kecil menengah dengan tim 3-15 orang yang mulai butuh sistem operasional.',
    cases: [
      {
        name: 'PT Bersih Sejahtera',
        location: 'Jakarta & Tangerang',
        service: 'Cleaning Service Komersial',
        story: 'Dengan 12 karyawan dan 8 klien aktif, koordinasi manual via WhatsApp group sangat tidak efisien. Satu Alur mengubah cara kerja mereka — penugasan otomatis, tracking pekerjaan real-time, dan pembukuan terintegrasi membuat manajemen jauh lebih mudah.',
        before: 'Koordinasi via 3 WA group, sering miss komunikasi, pembukuan 2 minggu terlambat',
        after: 'Satu dashboard untuk semua tim, real-time tracking, pembukuan D+1',
        metrics: { revenue: 'Rp185jt/bulan', growth: '+140%', clients: '22 aktif' },
      },
      {
        name: 'Klinik Mobil Premium',
        location: 'Depok & Bogor',
        service: 'Car Detailing & Coating',
        story: 'Bengkel detailing dengan 6 teknisi yang butuh jadwal booking terstruktur. Satu Alur membantu mereka mengatur antrian pelanggan, tracking progress per mobil, dan memberikan penawaran coating otomatis dengan AI.',
        before: 'Booking via telepon saja, jadwal bentrok sering terjadi, penawaran manual 2 jam',
        after: 'Booking online terstruktur, jadwal tidak pernah bentrok, penawaran AI 30 detik',
        metrics: { revenue: 'Rp95jt/bulan', growth: '+95%', clients: '45 aktif' },
      },
      {
        name: 'Nusantara Pest Control',
        location: 'Semarang & Yogyakarta',
        service: 'Pengendalian Hama Komersial',
        story: 'Kontrak bulanan dengan restoran dan hotel memerlukan tracking jadwal treatment yang ketat. Satu Alur mengotomasi reminder jadwal, membuat laporan treatment per lokasi, dan menghitung profitabilitas per kontrak.',
        before: 'Jadwal treatment di spreadsheet, reminder manual, tidak tahu kontrak mana yang profit',
        after: 'Auto-reminder jadwal, laporan per lokasi, profit per kontrak tercatat otomatis',
        metrics: { revenue: 'Rp78jt/bulan', growth: '+72%', clients: '18 aktif' },
      },
    ],
  },
  {
    tier: 'enterprise',
    tierLabel: 'Enterprise',
    description: 'Perusahaan besar dengan multi-cabang, ratusan karyawan, dan kompleksitas operasional tinggi.',
    cases: [
      {
        name: 'Green Property Management',
        location: 'Jakarta, Bandung, Surabaya, Bali',
        service: 'Facility Management 50+ Gedung',
        story: 'Mengelola 50+ gedung apartemen dan office dengan ratusan vendor jasa. Satu Alur menjadi sistem operasional pusat — semua vendor terhubung dalam satu platform, approval penawaran digital, dan dashboard eksekutif memberikan visibility penuh ke direksi.',
        before: 'Vendor terpisah 15 sistem, approval via email 3-5 hari, tidak ada visibility grup',
        after: 'Satu platform untuk 50+ gedung, approval digital < 4 jam, dashboard real-time direksi',
        metrics: { revenue: 'Rp4.2M/bulan', growth: '+38%', clients: '52 gedung aktif' },
      },
      {
        name: 'Horison Hotel Group',
        location: '10 Kota Besar Indonesia',
        service: 'Housekeeping & Maintenance 25 Hotel',
        story: 'Rantai hotel dengan 25 properti yang memerlukan standar housekeeping seragam. Satu Alur menyediakan SOP digital, tracking quality control per kamar, dan integrasi dengan sistem procurement untuk reorder supplies otomatis.',
        before: 'SOP beda per hotel, QC manual paper-based, reorder supplies sering telat',
        after: 'SOP digital seragam, QC real-time per kamar, auto-reorder saat stok minimum',
        metrics: { revenue: 'Rp8.5M/bulan', growth: '+22%', clients: '25 hotel aktif' },
      },
      {
        name: 'Mega Mall Indonesia',
        location: 'Jabodetabek & Jawa Barat',
        service: 'Cleaning & Maintenance 8 Mall',
        story: '8 mall dengan total 450.000m2 area yang harus dijaga kebersihannya. Satu Alur mengintegrasikan jadwal cleaning harian, tracking peralatan maintenance, dan reporting kebersihan ke manajemen pusat secara real-time.',
        before: 'Jadwal cleaning di papan tulis, tidak ada proof-of-work, laporan mingguan manual',
        after: 'Jadwal digital per shift, foto proof-of-work per area, laporan real-time ke pusat',
        metrics: { revenue: 'Rp12M/bulan', growth: '+18%', clients: '8 mall aktif' },
      },
    ],
  },
]


const SIMULATIONS = ['Home Cleaning', 'Commercial Cleaning', 'Car Detailing', 'Pest Control', 'Hospitality',
  'Facility Management', 'Pool Maintenance', 'Upholstery Cleaning'].map((label) => ({ value: label.toLowerCase().replace(/ /g, '-'), label }))
const SIM_KEY = 'satualur_demo_industry'

const TIPS = [
  ['users', 'Diversifikasi klien', 'Jangan bergantung pada 1-2 klien besar. Targetkan minimal 5 klien aktif agar arus kas stabil.'],
  ['ledger', 'Lacak profit per proyek', 'Gunakan pembukuan Satu Alur untuk melihat proyek mana yang untung dan mana yang perlu ditinjau harganya.'],
  ['refresh', 'Retensi sebelum akuisisi', 'Pelanggan lama jauh lebih murah dipertahankan daripada mencari pelanggan baru. Jaga hubungan dengan tindak lanjut rutin.'],
  ['chart', 'Keputusan berbasis data', 'Baca laporan AI secara rutin. Tren dari data membantu Anda mengambil keputusan bisnis yang lebih baik.'],
]

let currentTier = 'ukm'

export async function render(container) {
  const host = el('div')
  const tabs = C.segmented({ label: 'Skala bisnis', value: currentTier,
    options: INDUSTRIES.map((i) => ({ value: i.tier, label: i.tierLabel })),
    onChange: (value) => { currentTier = value; draw() } })
  tabs.classList.add('workspace-tabs')
  container.replaceChildren(
    C.pageHeader({ title: 'Industri & portofolio', em: 'portofolio', description: 'Lihat bagaimana bisnis jasa di berbagai skala memakai Satu Alur untuk tumbuh dan membangun portofolio yang sehat.' }),
    tabs, host)

  function draw() {
    const ind = INDUSTRIES.find((i) => i.tier === currentTier)
    host.replaceChildren(el('div', { className: 'workspace-stack' },
      el('div', { className: 'kpis' },
        C.kpi({ label: 'Paket', value: ind.tierLabel, sub: ind.description, hero: true }),
        C.kpi({ label: 'Rata-rata pendapatan', value: getAvgRevenue(ind), iconName: 'wallet' }),
        C.kpi({ label: 'Rata-rata pertumbuhan', value: getAvgGrowth(ind), iconName: 'trendingUp' }),
        C.kpi({ label: 'Total klien', value: getTotalClients(ind), iconName: 'users' })),
      C.panel({ title: 'Studi kasus', meta: `${ind.cases.length} bisnis · ${ind.tierLabel}` },
        ind.cases.map((c) => el('article', { className: 'workspace-entry' },
          el('div', { className: 'workspace-entry-head' },
            el('h3', { className: 'workspace-entry-title' }, C.icon('building'), c.name),
            C.tag(c.metrics.growth, 'ok')),
          el('p', { className: 'muted small' }, `${c.location} · ${c.service}`),
          el('p', {}, c.story),
          C.defList([
            ['Sebelum', c.before],
            ['Sesudah', c.after],
            ['Pendapatan', c.metrics.revenue],
            ['Klien', c.metrics.clients],
          ])))),
      C.panel({ title: 'Tips portofolio sehat' },
        TIPS.map(([name, title, body]) => el('article', { className: 'workspace-entry' },
          el('h3', { className: 'workspace-entry-title' }, C.icon(name), title), el('p', {}, body)))),
      simulationPanel()))
  }
  draw()
}

function simulationPanel() {
  let saved = SIMULATIONS[0].value
  try { saved = localStorage.getItem(SIM_KEY) || saved } catch { /* storage unavailable */ }
  const seg = C.segmented({ label: 'Industri demo', value: saved, options: SIMULATIONS, onChange: (value) => {
    try { localStorage.setItem(SIM_KEY, value) } catch { /* storage unavailable */ }
    showToast(`Industri demo: ${SIMULATIONS.find((s) => s.value === value).label}`, 'success')
  } })
  seg.classList.add('workspace-tabs')
  return C.panel({ title: 'Simulasi industri', meta: 'Pilihan disimpan di browser ini' },
    el('p', { className: 'panel-lead' }, 'Pilih industri yang paling dekat dengan bisnis Anda untuk konteks demo.'), seg)
}

function getAvgRevenue(industry) {
  const revs = industry.cases.map(c => {
    const num = parseFloat(c.metrics.revenue.replace(/[^0-9.]/g, ''))
    const mult = c.metrics.revenue.includes('M') ? 1000 : c.metrics.revenue.includes('jt') ? 1 : 0.001
    return num * mult
  })
  const avg = revs.reduce((a, b) => a + b, 0) / revs.length
  return avg >= 1000 ? `Rp${(avg / 1000).toFixed(1)}M` : `Rp${avg.toFixed(0)}jt`
}

function getAvgGrowth(industry) {
  const growths = industry.cases.map(c => parseInt(c.metrics.growth))
  const avg = Math.round(growths.reduce((a, b) => a + b, 0) / growths.length)
  return `+${avg}%`
}

function getTotalClients(industry) {
  const total = industry.cases.reduce((sum, c) => {
    const num = parseInt(c.metrics.clients)
    return sum + (isNaN(num) ? 0 : num)
  }, 0)
  return `${total}+`
}

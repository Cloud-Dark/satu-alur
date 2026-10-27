import { getCloud } from '../cloud.js'
import * as Components from '../ui/components.js'
import { animateEntrance, showToast } from '../ui/animations.js'

export async function render(container) {
  container.innerHTML = ''

  const cloud = getCloud()

  // Fetch all data for summary
  const { data: requests } = await cloud.database.from('requests').select('*').order('created_at', { ascending: false })
  const { data: offers } = await cloud.database.from('offers').select('*').order('created_at', { ascending: false })
  const { data: assignments } = await cloud.database.from('assignments').select('*').order('created_at', { ascending: false })
  const { data: completions } = await cloud.database.from('completions').select('*').order('created_at', { ascending: false })
  const { data: ledger } = await cloud.database.from('ledger_entries').select('*').order('created_at', { ascending: false })

  const R = requests || []
  const O = offers || []
  const A = assignments || []
  const C = completions || []
  const L = ledger || []

  // Calculations
  const totalRevenue = L.filter(l => l.category === 'pendapatan').reduce((s, l) => s + Number(l.amount), 0)
  const totalCost = L.filter(l => l.category !== 'pendapatan').reduce((s, l) => s + Number(l.amount), 0)
  const profit = totalRevenue - totalCost
  const approvedOffers = O.filter(o => o.status === 'approved').length
  const draftOffers = O.filter(o => o.status === 'draft').length
  const activeAssignments = A.filter(a => a.status === 'assigned').length
  const doneAssignments = A.filter(a => a.status === 'done').length
  const completionRate = A.length > 0 ? Math.round((doneAssignments / A.length) * 100) : 0

  // Welcome header
  const welcome = Components.el('div', { style: 'margin-bottom:24px;' },
    Components.el('h2', { style: 'margin:0 0 6px;font-size:1.4rem;font-weight:800;color:var(--text);' }, 'Dashboard Eksekutif'),
    Components.el('p', { style: 'margin:0;color:var(--text-muted);font-size:0.9rem;' }, 'Ringkasan operasional bisnis jasa Anda — real-time.')
  )
  container.appendChild(welcome)
  animateEntrance(welcome)

  // Top KPI row
  const kpiRow = Components.el('div', { className: 'stats-grid' },
    Components.statCard({ label: 'Total Pendapatan', value: `Rp${totalRevenue.toLocaleString('id-ID')}`, variant: 'orange', delta: '↑ 12% dari minggu lalu', deltaType: 'positive' }),
    Components.statCard({ label: 'Total Biaya', value: `Rp${totalCost.toLocaleString('id-ID')}`, variant: 'terracotta', delta: '↓ 5% efisiensi', deltaType: 'positive' }),
    Components.statCard({ label: 'Laba Bersih', value: `Rp${profit.toLocaleString('id-ID')}`, variant: 'olive', delta: profit >= 0 ? '↑ Margin 32%' : '↓ Perlu perhatian', deltaType: profit >= 0 ? 'positive' : 'negative' }),
    Components.statCard({ label: 'Tingkat Penyelesaian', value: `${completionRate}%`, variant: 'brown', delta: `${doneAssignments} dari ${A.length} pekerjaan`, deltaType: 'positive' })
  )
  container.appendChild(kpiRow)
  animateEntrance(kpiRow, 50)

  // Stage summary cards grid
  const summaryGrid = Components.el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px;' })

  // 1. Request summary
  summaryGrid.appendChild(createSummaryCard({
    icon: '📋',
    title: 'Permintaan',
    accent: 'orange',
    primary: `${R.length} Total`,
    secondary: `${R.filter(r => new Date(r.created_at) > new Date(Date.now() - 7*86400000)).length} baru minggu ini`,
    items: R.slice(0, 3).map(r => `${r.customer_name} — ${r.service_type}`),
  }))

  // 2. Offer summary
  summaryGrid.appendChild(createSummaryCard({
    icon: '💡',
    title: 'Penawaran',
    accent: 'sand',
    primary: `${approvedOffers} Disetujui`,
    secondary: `${draftOffers} Menunggu persetujuan`,
    items: O.filter(o => o.status === 'draft').slice(0, 2).map(o => `Rp${Number(o.validated_price).toLocaleString('id-ID')} — ${o.validated_scope?.slice(0, 40)}...`),
  }))

  // 3. Assignment summary
  summaryGrid.appendChild(createSummaryCard({
    icon: '👷',
    title: 'Penugasan',
    accent: 'brown',
    primary: `${activeAssignments} Aktif`,
    secondary: `${doneAssignments} Selesai`,
    items: A.filter(a => a.status === 'assigned').slice(0, 3).map(a => `${a.worker_name} — ${new Date(a.scheduled_at).toLocaleDateString('id-ID')}`),
  }))

  // 4. Completion summary
  summaryGrid.appendChild(createSummaryCard({
    icon: '✅',
    title: 'Penyelesaian',
    accent: 'olive',
    primary: `${C.length} Selesai`,
    secondary: `${completionRate}% tingkat penyelesaian`,
    items: C.slice(0, 2).map(c => c.notes?.slice(0, 50) + '...'),
  }))

  // 5. Bookkeeping / Audit summary
  const topCategories = {}
  L.forEach(l => { topCategories[l.category] = (topCategories[l.category] || 0) + Number(l.amount) })
  summaryGrid.appendChild(createSummaryCard({
    icon: '📊',
    title: 'Pembukuan & Audit',
    accent: 'secondary',
    primary: `${L.length} Jurnal`,
    secondary: `Pendapatan Rp${totalRevenue.toLocaleString('id-ID')}`,
    items: Object.entries(topCategories).slice(0, 3).map(([cat, amt]) => `${cat}: Rp${Number(amt).toLocaleString('id-ID')}`),
  }))

  // 6. Report summary
  summaryGrid.appendChild(createSummaryCard({
    icon: '📈',
    title: 'Laporan',
    accent: 'orange',
    primary: 'Periode Oktober 2026',
    secondary: profit >= 0 ? 'Profit' : 'Loss',
    items: [
      `Pendapatan: Rp${totalRevenue.toLocaleString('id-ID')}`,
      `Biaya: Rp${totalCost.toLocaleString('id-ID')}`,
      `Laba: Rp${profit.toLocaleString('id-ID')}`,
    ],
  }))

  container.appendChild(summaryGrid)
  Array.from(summaryGrid.children).forEach((child, i) => animateEntrance(child, 100 + i * 80))

  // Recent activity table
  const activitySection = Components.section('Aktivitas Terbaru',
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.85rem;' }, 'Ringkasan aktivitas bisnis 7 hari terakhir.')
  )
  activitySection.classList.add('card-accent-orange')

  const table = Components.el('table', { className: 'data-table' },
    Components.el('thead', {},
      Components.el('tr', {},
        Components.el('th', {}, 'Tanggal'),
        Components.el('th', {}, 'Jenis'),
        Components.el('th', {}, 'Keterangan'),
        Components.el('th', {}, 'Status')
      )
    ),
    Components.el('tbody', {})
  )

  const recentActivities = [
    ...R.slice(0, 3).map(r => ({ date: r.created_at, type: 'Permintaan', desc: `${r.customer_name} — ${r.service_type}`, status: 'BARU' })),
    ...O.filter(o => o.status === 'approved').slice(0, 2).map(o => ({ date: o.created_at, type: 'Penawaran', desc: `Rp${Number(o.validated_price).toLocaleString('id-ID')}`, status: 'DISETUJUI' })),
    ...C.slice(0, 2).map(c => ({ date: c.completed_at, type: 'Selesai', desc: c.notes?.slice(0, 40) + '...', status: 'SELESAI' })),
    ...L.filter(l => l.category === 'pendapatan').slice(0, 2).map(l => ({ date: l.posted_at, type: 'Pendapatan', desc: `Rp${Number(l.amount).toLocaleString('id-ID')}`, status: 'TERPOSTING' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8)

  const tbody = table.querySelector('tbody')
  recentActivities.forEach(act => {
    const statusBadge = Components.badge(act.status, act.status === 'DISETUJUI' ? 'approved' : act.status === 'SELESAI' ? 'completed' : act.status === 'TERPOSTING' ? 'approved' : 'draft')
    tbody.appendChild(Components.el('tr', {},
      Components.el('td', {}, new Date(act.date).toLocaleDateString('id-ID')),
      Components.el('td', {}, act.type),
      Components.el('td', {}, act.desc),
      Components.el('td', {}, statusBadge)
    ))
  })

  activitySection.appendChild(table)
  container.appendChild(activitySection)
  animateEntrance(activitySection, 400)

  // Quick actions
  const actionsSection = Components.section('Tindakan Cepat',
    Components.el('p', { style: 'color:var(--text-muted);font-size:0.85rem;' }, 'Akses langsung ke fitur yang sering digunakan.')
  )
  actionsSection.classList.add('card-accent-brown')

  const actionsRow = Components.el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;' },
    Components.el('button', { className: 'btn-success', onClick: () => showToast('Buka tahap Permintaan untuk menambah data', 'info') }, '➕ Permintaan Baru'),
    Components.el('button', { className: 'btn-success', onClick: () => showToast('Buka tahap Penawaran untuk generate AI', 'info') }, '🤖 Generate Penawaran'),
    Components.el('button', { className: 'btn-info', onClick: () => showToast('Buka tahap Pembukuan untuk posting jurnal', 'info') }, '📌 Posting Jurnal'),
    Components.el('button', { className: 'btn-secondary', onClick: () => showToast('Buka tahap Laporan untuk penjelasan AI', 'info') }, '📈 Lihat Laporan')
  )
  actionsSection.appendChild(actionsRow)
  container.appendChild(actionsSection)
  animateEntrance(actionsSection, 500)
}

function createSummaryCard({ icon, title, accent, primary, secondary, items }) {
  const card = Components.el('div', { className: `card card-accent-${accent}` })
  card.appendChild(Components.el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px;' },
    Components.el('span', { style: 'font-size:1.3rem;' }, icon),
    Components.el('h3', { style: 'margin:0;font-size:1rem;font-weight:700;color:var(--text);' }, title)
  ))
  card.appendChild(Components.el('div', { style: 'margin-bottom:10px;' },
    Components.el('div', { style: 'font-size:1.3rem;font-weight:800;color:var(--primary);' }, primary),
    Components.el('div', { style: 'font-size:0.8rem;color:var(--text-muted);margin-top:2px;' }, secondary)
  ))
  if (items && items.length > 0) {
    const list = Components.el('ul', { style: 'margin:0;padding:0;list-style:none;' })
    items.forEach(item => {
      list.appendChild(Components.el('li', { style: 'font-size:0.8rem;color:var(--text-muted);padding:3px 0;border-top:1px solid var(--border-light);' }, item))
    })
    card.appendChild(list)
  }
  return card
}

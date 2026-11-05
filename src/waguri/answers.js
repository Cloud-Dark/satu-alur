/**
 * Waguri's deterministic answers (pure; no I/O, no AI). Each builder takes the
 * question plus the data it needs and returns
 *   { text, cards?, actions?, ai? }
 * text     the answer shown as is when no model is reachable
 * cards    job cards for "Cek progres proyek" (customer, position, next step)
 * actions  buttons: { label, stage, params } in the app, { label, href } on public pages
 * ai       optional { context } — facts the model may rephrase (never invent beyond them)
 */
import { normalize, tokens, searchKnowledge, knowledgeText, pricingRows } from './knowledge.js'
import { STEPS } from '../domain/workflow.js'

const idrFmt = new Intl.NumberFormat('id-ID')
export const idr = (n) => `Rp${idrFmt.format(Math.round(Number(n) || 0))}`

/* ------------------------------------------------------- Customer lookup */

// Legal forms never identify a customer; generic place words only half count.
const LEGAL = new Set(['pt', 'cv', 'tbk', 'ud', 'pd', 'persero', 'fa'])
const GENERIC = new Set(['toko', 'rumah', 'bapak', 'pak', 'ibu', 'bu', 'hotel', 'resto', 'restoran', 'restaurant', 'kost', 'kos',
  'apartemen', 'apartment', 'villa', 'vila', 'kantor', 'gedung', 'perumahan', 'klinik', 'sekolah', 'cafe', 'kafe', 'warung',
  'grand', 'exclusive', 'group', 'grup', 'indonesia', 'jaya', 'abadi', 'sejahtera', 'makmur', 'mandiri'])
// Words of the question that are about the skill, not the customer.
const QUESTION_WORDS = new Set(['progres', 'progress', 'proyek', 'project', 'projek', 'pekerjaan', 'kerjaan', 'job', 'status', 'posisi',
  'sampai', 'mana', 'sudah', 'cek', 'lihat', 'dengan', 'untuk', 'pelanggan', 'customer', 'klien', 'client', 'gimana', 'bagaimana',
  'tahap', 'yang', 'apa', 'kabar', 'punya', 'milik', 'buat', 'tolong', 'dong', 'ya', 'kak', 'saya', 'aku', 'kami', 'sekarang', 'masih',
  'di', 'ke', 'dari', 'ini', 'itu', 'nya', 'ada', 'berapa', 'semua', 'tulis', 'pesan', 'kirim', 'follow', 'up', 'followup', 'wa',
  'whatsapp', 'email', 'draf', 'draft', 'bantu', 'ingatkan', 'pengingat', 'terima', 'kasih', 'konfirmasi', 'jadwal', 'tagihan', 'invoice',
  'penawaran', 'singkat', 'sopan', 'ramah', 'mengenai', 'tentang', 'soal', 'kepada', 'pada', 'agar', 'supaya', 'dan', 'atau', 'the',
  'paling', 'lama', 'menunggu', 'perlu', 'ditindaklanjuti', 'tindak', 'lanjut', 'terbaru', 'belum', 'selesai', 'mana', 'saja', 'daftar',
  'tertunda', 'macet', 'terlambat', 'hari', 'minggu', 'bulan', 'tahun', 'ringkas', 'ringkasan'])

/** Levenshtein distance, capped (we only care about 0, 1, 2). */
function dist(a, b, cap = 2) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > cap) return cap + 1
    prev = cur
  }
  return prev[b.length]
}
const sameWord = (q, c) => q === c || (c.length >= 4 && q.length >= 3 && dist(q, c) <= (c.length >= 7 ? 2 : 1))
  || (c.length >= 5 && q.length >= 4 && c.startsWith(q))

/** The words of a question that could name a customer. */
export const customerWords = (question) => normalize(question).split(' ').filter((t) => t.length > 1 && !QUESTION_WORDS.has(t))

/**
 * How well a customer name matches the question, 0..1. At least one distinctive
 * word (not a legal form or generic word) must match, unless the name has none.
 */
export function customerScore(name, question) {
  const n = normalize(name)
  const q = ` ${normalize(question)} `
  if (!n) return 0
  if (q.includes(` ${n} `)) return 1
  const words = customerWords(question)
  const parts = n.split(' ').filter((t) => t.length > 1 && !LEGAL.has(t))
  if (!parts.length || !words.length) return 0
  const allGeneric = parts.every((p) => GENERIC.has(p))
  let total = 0
  let got = 0
  let distinct = false
  for (const p of parts) {
    const w = GENERIC.has(p) ? 0.3 : 1
    total += w
    if (words.some((t) => sameWord(t, p))) {
      got += w
      if (w === 1) distinct = true
    }
  }
  if (!distinct && !(allGeneric && got === total)) return 0
  return got / total
}

/**
 * Customers (grouped by name, case-insensitive) that match the question, best first:
 * [{ name, key, score, rows }]. Only scores >= 0.4 count (one of two distinctive words).
 */
export function findCustomers(rows, question) {
  const groups = new Map()
  for (const r of rows || []) {
    const name = r.customer || r.request?.customer_name || ''
    const key = normalize(name)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, { name, key, rows: [] })
    groups.get(key).rows.push(r)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, score: customerScore(g.name, question) }))
    .filter((g) => g.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

/* ---------------------------------------------------- Cek progres proyek */

// Index in STEPS of the step a job waits on (same as the Alur kerja page).
const NEXT_STEP = { new: 1, draft: 1, rejected: 1, approved: 2, working: 3, completed: 4, booked: 5 }
/** Stage name the job is at: the step it waits on, or Pembukuan when everything is done. */
export const stageOf = (row) => (row.done ? STEPS[STEPS.length - 1].label : STEPS[Math.min(NEXT_STEP[row.key] ?? row.step, STEPS.length - 1)].label)

/** One job as a card: what the widget draws and the facts the AI may rephrase. */
export function jobCard(row) {
  const nextIdx = NEXT_STEP[row.key] ?? row.step
  return {
    id: row.id,
    customer: row.customer,
    service: row.service || 'Layanan',
    location: row.location || '',
    worker: row.worker || '',
    price: row.price ?? null,
    stage: stageOf(row),
    stepIndex: Math.min(nextIdx, STEPS.length),
    status: row.status?.label || '',
    tone: row.status?.tone || 'neutral',
    done: Boolean(row.done),
    next: row.next ? { label: row.next.label, stage: row.next.stage, params: row.next.params || {}, optional: Boolean(row.next.optional) } : null,
    invoice: row.invoice ? { number: row.invoice.number || '', status: row.invoice.status || '' } : null,
  }
}

const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)

function jobLine(c) {
  const where = [c.service, c.location].filter(Boolean).join(', ')
  const head = `#${c.id} ${where}`
  const pos = c.done ? 'sudah selesai dan dibukukan' : `sedang di tahap ${c.stage} (${lower1(c.status)})`
  const who = c.worker && !c.done ? ` Petugas: ${c.worker}.` : ''
  const inv = c.invoice ? ` Invoice ${c.invoice.number || ''} berstatus ${c.invoice.status}.`.replace('  ', ' ') : ''
  const next = c.next ? ` Langkah berikutnya: ${lower1(c.next.label)}${c.next.optional ? ' (opsional)' : ''}.` : ''
  return `${head} — ${pos}.${who}${inv}${next}`
}

/** Short overview of every job (when no customer was named or found). */
function overview(rows) {
  const open = rows.filter((r) => !r.done)
  const by = (k) => rows.filter((r) => r.key === k).length
  const parts = [
    ['belum ada penawaran', by('new')],
    ['penawaran draf', by('draft')],
    ['menunggu penugasan', by('approved')],
    ['sedang dikerjakan', by('working')],
    ['perlu dibukukan', by('completed')],
    ['selesai', by('booked')],
  ].filter(([, n]) => n > 0).map(([l, n]) => `${n} ${l}`)
  const waiting = open.slice().sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))).slice(0, 3)
  return { parts, waiting, open }
}

/**
 * "proyek dengan PT X sudah sampai mana?" against workflowRows(). Deterministic.
 * kind: 'match' | 'multi' (several customers fit) | 'none' (no name found) | 'empty' (no jobs yet)
 */
export function progressAnswer(rows, question) {
  rows = rows || []
  if (!rows.length) {
    return {
      kind: 'empty',
      text: 'Belum ada pekerjaan yang tercatat. Mulai dari Alur kerja › Permintaan baru, nanti saya bisa menunjukkan posisinya.',
      actions: [{ label: 'Catat permintaan', stage: 'request' }],
    }
  }
  const found = findCustomers(rows, question)
  const top = found[0]
  if (top) {
    const tied = found.filter((g) => g.score === top.score)
    if (tied.length > 1) {
      return {
        kind: 'multi',
        text: `Ada ${tied.length} pelanggan yang cocok: ${tied.map((g) => g.name).join(', ')}. Yang mana yang Anda maksud?`,
        suggestions: tied.slice(0, 4).map((g) => `Progres ${g.name}`),
      }
    }
    const jobs = top.rows.slice().sort((a, b) => Number(a.done) - Number(b.done) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    const cards = jobs.slice(0, 5).map(jobCard)
    const intro = jobs.length === 1
      ? `Pekerjaan untuk ${top.name}:`
      : `${top.name} punya ${jobs.length} pekerjaan${jobs.length > 5 ? ' (5 terbaru ditampilkan)' : ''}:`
    const text = [intro, ...cards.map((c) => `• ${jobLine(c)}`)].join('\n')
    return {
      kind: 'match',
      customer: top.name,
      text,
      cards,
      actions: [{ label: 'Buka di Alur kerja', stage: 'workflow', params: { q: top.name } }],
      ai: { context: text },
    }
  }
  const words = customerWords(question).filter((w) => !GENERIC.has(w) && !LEGAL.has(w))
  const { parts, waiting, open } = overview(rows)
  const lead = words.length
    ? `Saya belum menemukan pelanggan bernama "${words.join(' ')}". `
    : ''
  const lines = [
    `${lead}Saat ini ada ${rows.length} pekerjaan: ${parts.join(', ')}.`,
    ...(waiting.length ? ['Yang paling lama menunggu:', ...waiting.map((r) => `• ${r.customer} — ${stageOf(r)}: ${lower1(r.status.label)}${r.next ? ` → ${lower1(r.next.label)}` : ''}`)] : []),
    words.length ? 'Coba tulis nama pelanggannya, misalnya "progres PT Maju Jaya".' : 'Sebut nama pelanggan untuk melihat rinciannya.',
  ]
  return {
    kind: 'none',
    text: lines.join('\n'),
    cards: [],
    actions: [{ label: 'Buka Alur kerja', stage: 'workflow' }],
    suggestions: open.slice(0, 3).map((r) => `Progres ${r.customer}`),
  }
}

/* ------------------------------------------------------ Ringkas keuangan */

const monthKey = (d) => {
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '' : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}
function sums(entries) {
  let revenue = 0
  let cost = 0
  for (const l of entries) {
    const a = Number(l.amount) || 0
    if (l.category === 'pendapatan') revenue += a
    else cost += a
  }
  return { revenue, cost, profit: revenue - cost }
}
const margin = (t) => (t.revenue > 0 ? `${Math.round((t.profit / t.revenue) * 100)}%` : '—')

/**
 * Revenue, cost and profit from the ledger: all time and this month, plus what is
 * still open (completed but not booked, invoices sent but unpaid).
 */
export function financeAnswer({ ledger = [], pendingBookkeeping = 0, invoices = [], now = new Date() } = {}) {
  if (!ledger.length) {
    return {
      kind: 'empty',
      text: 'Buku besar masih kosong. Setelah pekerjaan selesai, catat pendapatan dan biayanya di Pembukuan, lalu saya bisa meringkasnya.',
      actions: [{ label: 'Buka Pembukuan', stage: 'bookkeeping' }],
    }
  }
  const all = sums(ledger)
  const thisMonth = monthKey(now)
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const month = sums(ledger.filter((l) => monthKey(l.posted_at || l.created_at) === thisMonth))
  const last = sums(ledger.filter((l) => monthKey(l.posted_at || l.created_at) === monthKey(prev)))
  const unpaid = (invoices || []).filter((i) => i && i.status === 'terkirim')
  const unpaidSum = unpaid.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const lines = [
    `Total dari buku besar: pendapatan ${idr(all.revenue)}, biaya ${idr(all.cost)}, laba ${idr(all.profit)} (margin ${margin(all)}).`,
    `Bulan ini: pendapatan ${idr(month.revenue)}, biaya ${idr(month.cost)}, laba ${idr(month.profit)}.`,
    last.revenue || last.cost ? `Bulan lalu: pendapatan ${idr(last.revenue)}, laba ${idr(last.profit)}.` : null,
    pendingBookkeeping ? `${pendingBookkeeping} pekerjaan selesai belum dibukukan, jadi angkanya belum termasuk di sini.` : null,
    unpaid.length ? `${unpaid.length} invoice terkirim belum lunas, total ${idr(unpaidSum)}.` : null,
  ].filter(Boolean)
  const text = lines.join('\n')
  return {
    kind: 'summary',
    text,
    totals: { all, month, last, unpaid: unpaidSum },
    actions: [{ label: 'Buka Laporan', stage: 'report' }, ...(pendingBookkeeping ? [{ label: 'Bukukan sekarang', stage: 'bookkeeping' }] : [])],
    ai: { context: text },
  }
}

/* ------------------------------------------------------ Bantu tulis pesan */

/** A ready-to-send follow-up for one job, by where it stands. channel: 'wa' | 'email'. */
export function messageDraft(row, { channel = 'wa', sender = '' } = {}) {
  const name = row.customer || 'Bapak/Ibu'
  const svc = (row.service || 'layanan kami').toLowerCase()
  const from = sender ? ` dari ${sender}` : ''
  const body = {
    new: `kami sudah menerima permintaan ${svc} Anda. Boleh kami minta detail tambahan (lokasi, jumlah unit/luas, dan waktu yang diinginkan) agar penawaran bisa segera kami kirim?`,
    draft: `penawaran untuk ${svc} sedang kami finalkan. Apakah ada hal yang ingin disesuaikan sebelum kami kirim?`,
    rejected: `terima kasih atas tanggapan Anda atas penawaran ${svc}. Bila berkenan, kami bisa menyusun penawaran baru yang lebih sesuai. Bagian mana yang perlu kami ubah?`,
    approved: `terima kasih sudah menyetujui penawaran ${svc}. Kami ingin mengonfirmasi jadwal pengerjaan. Kapan waktu yang paling pas untuk tim kami datang?`,
    working: `kami ingin mengabarkan bahwa pekerjaan ${svc} sudah dijadwalkan${row.worker ? ` dengan petugas ${row.worker}` : ''}. Kami akan mengabari lagi bila ada perubahan.`,
    completed: `pekerjaan ${svc} sudah selesai. Terima kasih atas kepercayaannya. Bila ada yang kurang, kabari kami ya.`,
    booked: `terima kasih sudah memakai jasa ${svc} kami. ${row.invoice?.status === 'terkirim' ? `Sekadar mengingatkan, invoice ${row.invoice.number || ''} masih menunggu pembayaran.` : 'Kami siap membantu lagi untuk perawatan berikutnya.'}`,
  }[row.key] || `kami ingin menindaklanjuti ${svc} Anda.`
  const text = `Halo ${name}, kami${from}: ${body}\n\nSalam,\n${sender || 'Tim kami'}`
  if (channel === 'email') return `Subjek: Tindak lanjut ${row.service || 'layanan'} — ${name}\n\n${text}`
  return text
}

/** "Bantu tulis pesan" — finds the customer, drafts the message, offers AI polish. */
export function messageAnswer(rows, question, { sender = '' } = {}) {
  const channel = /\bemail|surel\b/i.test(question) ? 'email' : 'wa'
  const found = findCustomers(rows || [], question)
  if (!found.length) {
    return {
      kind: 'none',
      text: 'Untuk pelanggan siapa pesannya? Tulis namanya, misalnya "tulis WA follow-up untuk PT Maju Jaya". Saya akan menyesuaikan isinya dengan posisi pekerjaannya.',
      suggestions: (rows || []).filter((r) => !r.done).slice(0, 3).map((r) => `Tulis WA untuk ${r.customer}`),
    }
  }
  const g = found[0]
  const row = g.rows.slice().sort((a, b) => Number(a.done) - Number(b.done) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
  const draft = messageDraft(row, { channel, sender })
  const card = jobCard(row)
  return {
    kind: 'draft',
    customer: g.name,
    channel,
    draft,
    text: `Draf ${channel === 'email' ? 'email' : 'WhatsApp'} untuk ${g.name} (${stageOf(row)}: ${lower1(card.status)}):\n\n${draft}`,
    copy: draft,
    actions: [{ label: 'Buka di Alur kerja', stage: 'workflow', params: { q: g.name } }],
    ai: { context: `Pelanggan: ${g.name}\nLayanan: ${card.service}\nPosisi: ${stageOf(row)} — ${card.status}\nSaluran: ${channel === 'email' ? 'email' : 'WhatsApp'}\nDraf dasar:\n${draft}` },
  }
}

/* --------------------------------------------- Knowledge (guide, public) */

/**
 * Answers from the knowledge base. A strong hit (score >= 3) is answered as is;
 * a weak or missing one gets the whole (scoped) knowledge as AI context.
 */
export function knowledgeAnswer(question, { mode = 'public', plans, only } = {}) {
  const ranked = searchKnowledge(question, { mode, plans, only })
  const best = ranked[0]
  const link = (e) => (mode === 'app'
    ? (e.stage ? [{ label: `Buka ${e.title}`, stage: e.stage }] : [])
    : (e.href ? [{ label: e.href === '#harga' ? 'Lihat harga' : e.href === '#/masuk' ? 'Masuk / daftar' : `Buka ${e.title}`, href: e.href }] : []))
  if (best && best.score >= 3) {
    if (best.entry.id === 'harga') {
      const { live, rows } = pricingRows(plans)
      return {
        kind: 'kb', strong: true, entry: 'harga',
        text: `Ada ${rows.length} paket${live ? '' : ' (harga sementara)'}. Pindah paket kapan saja:`,
        plans: rows, actions: link(best.entry), ai: { context: best.entry.text },
      }
    }
    return { kind: 'kb', strong: true, entry: best.entry.id, text: best.entry.text, actions: link(best.entry), ai: { context: best.entry.text } }
  }
  const context = knowledgeText(mode, { plans, only })
  if (best) return { kind: 'kb', strong: false, entry: best.entry.id, text: best.entry.text, actions: link(best.entry), ai: { context } }
  return {
    kind: 'kb',
    strong: false,
    entry: null,
    text: mode === 'app'
      ? 'Saya belum menemukan jawabannya di panduan. Coba sebut nama menunya (misalnya Invoice atau Alur kerja), atau kirim tiket lewat menu Bantuan.'
      : 'Saya belum menemukan jawabannya. Coba tanyakan tentang fitur, harga, atau cara mulai, atau hubungi tim lewat halaman Kontak.',
    actions: mode === 'app' ? [{ label: 'Buka Bantuan', stage: 'support' }] : [{ label: 'Hubungi kami', href: '#/kontak' }],
    ai: { context },
  }
}

export { tokens }

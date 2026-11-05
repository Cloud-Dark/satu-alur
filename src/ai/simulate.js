/**
 * Simulated AI answers (no model): used by the mock cloud in dev/e2e and by the Worker for the
 * shared demo accounts, so a demo never calls Workers AI or a provider. Every answer is an async
 * generator of OpenAI-style chunks ({ choices: [{ delta: { content }, finish_reason }] }) with a
 * typing pace, matched on the prompt (system/user text, `[agent:<key>]` tags, json_schema mode).
 * Pure: no storage, no network.
 */

// Simulasi AI streaming dengan chunk
async function* mockStreamOffer(request, context = '') {
  const scope = request.service_type || 'Pembersihan umum'
  // A chosen offer template steers the sample: its price range, default terms and answers.
  const num = (t) => Number(String(t || '').replace(/[^\d]/g, '')) || 0
  const range = /Kisaran harga wajar:\s*(?:mulai\s*)?(Rp[\d.]+)?(?:\s*[–-]\s*|\s*hingga\s*)?(Rp[\d.]+)?/.exec(context)
  const lo = range ? num(range[1]) : 0
  const hi = range ? num(range[2]) : 0
  const price = lo || hi
    ? Math.round(((lo || hi * 0.3) + Math.random() * ((hi || lo * 3) - (lo || hi * 0.3)) * 0.4) / 1000) * 1000
    : Math.floor(Math.random() * 900000) + 100000
  const tmpl = /Template penawaran:\s*([^(\n]+)/.exec(context)?.[1]?.trim()
  const details = [...context.matchAll(/^- ([^:\n]+):\s*(.+)$/gm)].map((m) => `${m[1].toLowerCase()} ${m[2]}`)
  const terms = /Ketentuan bawaan[^:]*:\s*(.+)/.exec(context)?.[1]?.trim()
  const json = JSON.stringify({
    scope: `${tmpl ? `${tmpl}: ` : ''}${scope} untuk ${request.customer_name || 'pelanggan'} di ${request.location || 'Jakarta'}${details.length ? ` (${details.join('; ')})` : ''} — mencakup persiapan, pelaksanaan, pemeriksaan hasil, dan serah terima.`,
    price,
    terms: terms || 'Pembayaran 50% di muka, sisa setelah pekerjaan selesai dan diterima. Garansi 7 hari.',
    notes: 'Harga estimasi berdasarkan deskripsi singkat. Survei lapangan mungkin diperlukan.',
  }, null, 2)
  // Stream token demi token
  for (let i = 0; i < json.length; i += 4) {
    await new Promise(r => setTimeout(r, 15))
    yield {
      choices: [{
        delta: { content: json.slice(i, i + 4) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: json.length / 4, total_tokens: 50 + json.length / 4 },
  }
}

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const rp = (n) => idr.format(Number(n) || 0)
const pctFmt = (n) => `${Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Compares cur with prev honestly: no percentage when prev is zero. */
function compareLine(label, cur, prev, prevLabel, { lowerIsBetter = false } = {}) {
  if (!(prev > 0)) return `${label} ${rp(cur)}; ${esc(prevLabel)} tidak punya ${label.toLowerCase()} sebagai pembanding.`
  const pct = ((cur - prev) / prev) * 100
  if (pct === 0) return `${label} sama dengan ${esc(prevLabel)} (${rp(prev)}).`
  const dir = pct > 0 ? 'naik' : 'turun'
  const good = lowerIsBetter ? pct < 0 : pct > 0
  return `${label} ${dir} ${pctFmt(pct)} dibanding ${esc(prevLabel)} (${rp(prev)} → ${rp(cur)})${good ? '' : ' — perlu diperhatikan'}.`
}

/** Builds the mock explanation strictly from the report payload. */
function explainHTML(report = {}) {
  const rev = Number(report.total_revenue) || 0
  const cost = Number(report.total_cost) || 0
  const profit = Number(report.net_profit ?? rev - cost) || 0
  const margin = report.margin_pct ?? (rev > 0 ? Math.round((profit / rev) * 1000) / 10 : null)
  const entries = Array.isArray(report.entries) ? report.entries.length : 0
  const cats = Array.isArray(report.by_category) ? report.by_category : []
  const costCats = cats.filter((c) => c.category !== 'pendapatan').sort((a, b) => (b.amount || 0) - (a.amount || 0))
  const custs = Array.isArray(report.top_customers) ? report.top_customers : []
  const prev = report.previous_period

  const out = []
  out.push(`<h3>Ringkasan ${esc(report.period || 'periode terpilih')}</h3>`)
  if (!entries && !rev && !cost) {
    out.push('<p>Belum ada jurnal di periode ini, jadi belum ada angka yang bisa dijelaskan.</p>')
    return out.join('\n')
  }
  out.push(`<p>Dari <strong>${entries} jurnal</strong>, pendapatan tercatat <strong>${rp(rev)}</strong> dan biaya <strong>${rp(cost)}</strong>, sehingga ${profit >= 0 ? 'laba' : 'rugi'} bersih <strong>${rp(Math.abs(profit))}</strong>${margin != null ? ` dengan margin <strong>${String(margin).replace('.', ',')}%</strong>` : ''}.</p>`)

  if (prev) {
    out.push('<h3>Dibanding periode sebelumnya</h3><ul>')
    out.push(`<li>${compareLine('Pendapatan', rev, prev.total_revenue, prev.label)}</li>`)
    out.push(`<li>${compareLine('Biaya', cost, prev.total_cost, prev.label, { lowerIsBetter: true })}</li>`)
    out.push(`<li>Laba sebelum pajak ${esc(prev.label)}: ${rp(prev.net_profit)}; periode ini: ${rp(profit)}.</li>`)
    out.push('</ul>')
  } else {
    out.push('<p>Periode ini tidak memiliki periode pembanding, jadi tidak ada tren yang disimpulkan.</p>')
  }

  if (costCats.length || custs.length) {
    out.push('<h3>Rincian</h3><ul>')
    if (costCats.length) {
      const top = costCats[0]
      const share = rev > 0 ? ` (${pctFmt(((top.amount || 0) / rev) * 100)} dari pendapatan)` : ''
      out.push(`<li>Komponen biaya terbesar: <strong>${esc(top.label || top.category)}</strong> ${rp(top.amount)}${share}.</li>`)
    }
    if (custs.length) {
      const c = custs[0]
      const share = rev > 0 ? ` — ${pctFmt(((c.revenue || 0) / rev) * 100)} dari pendapatan` : ''
      out.push(`<li>Pelanggan dengan pendapatan terbesar: <strong>${esc(c.name)}</strong>${c.service ? ` (${esc(c.service)})` : ''}, ${rp(c.revenue)}${share}.</li>`)
    }
    out.push('</ul>')
  }

  const recs = []
  if (rev === 0 && cost > 0) recs.push('Ada biaya tanpa pendapatan di periode ini. Pastikan pendapatan dari pekerjaan selesai sudah diposting.')
  if (margin != null && margin < 30) recs.push(`Margin ${String(margin).replace('.', ',')}% tergolong tipis. Tinjau harga penawaran atau tekan ${costCats[0] ? esc((costCats[0].label || '').toLowerCase()) : 'biaya'}.`)
  if (margin != null && margin >= 30) recs.push('Margin sehat. Pertahankan struktur harga dan pantau biaya per pekerjaan.')
  if (custs.length === 1 && rev > 0) recs.push('Seluruh pendapatan berasal dari satu pelanggan. Tambah pelanggan untuk mengurangi risiko konsentrasi.')
  if (recs.length) out.push(`<h3>Rekomendasi</h3><ul>${recs.map((r) => `<li>${r}</li>`).join('')}</ul>`)
  out.push('<p><small>Simulasi lokal: dihitung langsung dari data laporan di atas, bukan dari model AI.</small></p>')
  return out.join('\n')
}

async function* mockStreamExplain(report) {
  const html = explainHTML(report)
  for (let i = 0; i < html.length; i += 8) {
    await new Promise(r => setTimeout(r, 20))
    yield {
      choices: [{
        delta: { content: html.slice(i, i + 8) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: html.length / 8, total_tokens: 30 + html.length / 8 },
  }
}

async function* mockStreamGeneral(userMsg) {
  const responses = [
    'Tentu! Satu Alur memiliki 6 tahap alur kerja yang terintegrasi: Permintaan → Penawaran AI → Penugasan → Penyelesaian → Pembukuan → Laporan. Setiap tahap terhubung secara otomatis.',
    'Anda bisa melihat dashboard eksekutif di halaman awal setelah login. Dashboard menampilkan ringkasan KPI, aktivitas terbaru, dan status setiap tahap.',
    'Fitur AI Penawaran akan secara otomatis menghasilkan proposal dengan estimasi harga berdasarkan deskripsi permintaan pelanggan. Harga dihitung realistis untuk pasar Indonesia.',
    'Data Anda tersimpan dengan aman. Dalam mode produksi, kami menggunakan enkripsi end-to-end dan backup otomatis.',
  ]
  const text = responses[Math.floor(Math.random() * responses.length)]
  for (let i = 0; i < text.length; i += 3) {
    await new Promise(r => setTimeout(r, 25))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 3) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: text.length / 3, total_tokens: 20 + text.length / 3 },
  }
}

async function* mockStreamAnalyst(userMsg) {
  const state = loadState()
  const counts = {
    requests: (state.requests || []).length,
    offers: (state.offers || []).length,
    assignments: (state.assignments || []).length,
    completions: (state.completions || []).length,
    ledger: (state.ledger_entries || []).length,
  }
  const text = `Berdasarkan data saat ini:\n\n• Total permintaan: ${counts.requests}\n• Total penawaran: ${counts.offers}\n• Total penugasan: ${counts.assignments}\n• Total penyelesaian: ${counts.completions}\n• Total jurnal: ${counts.ledger}\n\nTingkat konversi permintaan ke penawaran: ${counts.requests > 0 ? Math.round(counts.offers / counts.requests * 100) : 0}%.\nTingkat penyelesaian: ${counts.assignments > 0 ? Math.round(counts.completions / counts.assignments * 100) : 0}%.`
  for (let i = 0; i < text.length; i += 3) {
    await new Promise(r => setTimeout(r, 20))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 3) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 25, completion_tokens: text.length / 3, total_tokens: 25 + text.length / 3 },
  }
}

async function* mockStreamSocial(userMsg) {
  const isBrainstorm = userMsg.includes('brainstorm') || userMsg.includes('ide konten')
  const isCaption = userMsg.includes('caption') || userMsg.includes('naskah')
  const isImagePrompt = userMsg.includes('prompt gambar') || userMsg.includes('image generation')
  const isAds = userMsg.includes('iklan') || userMsg.includes('Meta Ads')

  let text = ''

  if (isBrainstorm) {
    text = `💡 **Brainstorm Ide Konten**

**1. "Before vs After" Transformation**
Format: Reels / TikTok
Hook: "Lihat perbedaan AC ini sebelum dan sesudah dibersihkan!"
Konsep: Video time-lapse proses pembersihan dengan musik upbeat.
Estimasi engagement: 🔥 Tinggi

**2. Tips & Educational Carousel**
Format: Carousel Instagram
Hook: "5 Tanda AC Anda Butuh Service Segera"
Konsep: Infografis swipeable dengan icon dan bullet points.
Estimasi engagement: 📈 Sedang-Tinggi

**3. Behind the Scenes**
Format: Story Series
Hook: "Hari ini kita service AC di gedung 20 lantai!"
Konsep: Dokumentasi tim bekerja dengan gondola/equipment.
Estimasi engagement: 📊 Sedang

**4. Customer Testimonial Video**
Format: Short Video
Hook: "Pak Surya bilang apa setelah sofa-nya bersih kembali?"
Konsep: Interview singkat pelanggan puas.
Estimasi engagement: 🔥 Tinggi

**5. Myth Buster Series**
Format: TikTok / Reels
Hook: "Fakta atau Mitos: AC sering mati-sendiri karena hantu?"
Konsep: Format Q&A dengan presenter enerjik.
Estimasi engagement: 🔥 Tinggi

Hashtag: #jasabersih #serviceac #cleaningservice #tipsrumah #jakarta`
  } else if (isImagePrompt) {
    text = `🎨 **AI Image Prompt**

Prompt 1 (Hero Image):
"Professional cleaning service team in orange uniform, modern minimalist living room, bright natural lighting, before-and-after split composition, photorealistic, 8K, commercial photography style"

Prompt 2 (Instagram Feed):
"Aerial view of sparkling clean swimming pool, tropical garden background, golden hour lighting, luxury villa setting, professional real estate photography, vivid colors"

Prompt 3 (TikTok Thumbnail):
"Split-screen dramatic transformation: dirty vs clean AC unit, bold text overlay space, high contrast, eye-catching colors, social media thumbnail style"

Prompt 4 (Ad Banner):
"Happy Indonesian family sitting on freshly cleaned sofa, bright modern home interior, warm lighting, lifestyle photography, copy space on right side, 16:9 aspect ratio"

Tip: Tambahkan "--ar 1:1" untuk Instagram, "--ar 9:16" untuk Stories/Reels, "--ar 16:9" untuk banner.`
  } else if (isAds) {
    text = `🎯 **Rekomendasi Meta Ads**

**Target Audience:**
• Usia: 28-50 tahun
• Gender: Semua
• Lokasi: Jakarta Selatan, Jakarta Pusat, Depok, Tangerang
• Minat: Home improvement, Property, Family & parenting, Cleaning services
• Perilaku: Engaged shoppers, Recent home buyers

**Placements:** Feed, Stories, Reels
**Budget harian:** Rp100.000
**Est. reach/hari:** ~200-350 orang
**Est. CPM:** Rp450-750

**Copy Iklan 1 (Promosi):**
"AC Bocor? AC Bau? 🤢
Tim kami siap datang HARI INI!
✅ Pembersihan AC dari Rp85rb/unit
✅ Garansi 7 hari
✅ Free survey
📍 Jakarta & sekitarnya
👇 Klik WA langsung!"

**Copy Iklan 2 (Testimonial):**
""Sofa kami seperti baru lagi!" — Ibu Dian, Jakarta Selatan
Cuci sofa mulai dari Rp350rb/set
✅ Noda hilang 99%
✅ Bahan aman & ramah anak
📲 Hubungi kami sekarang!"

**Waktu Posting Terbaik:**
🕐 09:00–11:00 | 🕐 13:00–15:00 | 🕐 19:00–21:00

Hashtag: #serviceacjakarta #jasabersih #homecare #cleaningserviceid #tipsrumah`
  } else {
    text = `📝 **Caption Instagram**

✨ AC BERSIH = UDARA SEGAR ✨

Siapa yang suka tidur dengan AC nyaman tanpa bau aneh? 🙋‍♀️

Tahukah kamu? AC yang jarang dibersihkan bisa jadi sarang bakteri dan debu yang menyebabkan alergi! 😷

Nggak usah khawatir, tim Satu Alur siap bantu:
✅ Pembersihan AC split & central
✅ Penggantian filter
✅ Pengecekan freon
✅ Garansi 7 hari

📍 Jakarta, Depok, Tangerang, Bekasi
💰 Mulai dari Rp85rb/unit

Yuk booking sekarang! Link di bio 👆

#serviceac #jasabersih #cleaningservice #tipsrumah #jakarta #depok #tangerang #homecare #acbersih #rumahsehat`
  }

  for (let i = 0; i < text.length; i += 4) {
    await new Promise(r => setTimeout(r, 18))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 4) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: text.length / 4, total_tokens: 30 + text.length / 4 },
  }
}

async function* mockStreamPertumbuhan(userMsg) {
  const lower = userMsg.toLowerCase()
  let text = ''

  if (lower.includes('hotel horizon') || lower.includes('penawaran')) {
    text = `✅ **Tindakan: Kirim Penawaran ke Hotel Horizon**

Saya telah menyiapkan draft penawaran:

• **Layanan:** Daily cleaning kamar + lobby + common area
• **Frekuensi:** 6 hari/minggu
• **Tim:** 4 orang (2 cleaning, 1 supervisor, 1 backup)
• **Harga:** Rp 54.000.000/bulan (all-in)
• **Nilai tambah:** Free disinfection monthly + laporan foto harian

**Probabilitas deal: 78%** → **Expected close dalam 3-5 hari**

Langkah selanjutnya:
1. Kirim email proposal (sudah saya draft)
2. Follow-up WhatsApp dalam 24 jam
3. Offer site visit gratis untuk survey

Apakah Anda ingin saya kirim sekarang?`
  } else if (lower.includes('maju jaya') || lower.includes('paket tahunan')) {
    text = `💰 **Tindakan: Upsell Paket Tahunan PT Maju Jaya**

Berdasarkan analisis riwayat:
• Rata-rata order: Rp 350rb/bulan
• Total 12 bulan: Rp 4.200.000
• **Paket tahunan: Rp 3.360.000 (hemat 20%)**
• **Bonus:** 2× free deep cleaning (Rp 700rb value)

**Pitch rekomendasi:**
"Pak Budi, dengan paket tahunan Anda hemat Rp 840rb + dapat 2× deep cleaning gratis. Saya lock harga ini sampai akhir bulan."

**Prediksi keberhasilan: 82%**

Ingin saya generate draft WhatsApp/Email?`
  } else if (lower.includes('klinik') || lower.includes('retention')) {
    text = `⚠️ **Tindakan: Retention Klinik Sehat Sentosa**

Skenario churn terdeteksi:
• Gap order: 45 hari (normal: 30 hari)
• Last contact: 12 September
• Competitor probability: 55%

**Rekomendasi win-back sequence:**

**Hari 1 (hari ini):** Telepon langsung ke manager operasional
→ Tanyakan kebutuhan terbaru, offer audit kebersihan GRATIS

**Hari 2:** Kirim voucher Rp 50rb untuk order berikutnya

**Hari 5:** Follow-up email dengan portfolio hasil kerja terbaru

**Win-back probability: 62%** → Jika tidak merespons dalam 7 hari, flag sebagai "lost customer"

Mulai dengan telepon sekarang?`
  } else if (lower.includes('bsd') || lower.includes('partnership')) {
    text = `🤝 **Tindakan: Partnership BSD AC Service**

Analisis partnership:
• Overflow demand: 12 request/minggu (kapasitas penuh)
• Partner track record: 4.8⭐, 200+ job
• Margin bersih: 18%
• Estimasi: 5 job/minggu pertama

**Draft MOU:**
• Periode: 3 bulan trial
• Revenue share: 82% Anda, 18% partner
• SLA: Response < 2 jam, selesai < 24 jam
• Branding: Satu Alur tetap sebagai front-facing brand

**Expected value: Rp 12 juta/bulan**

Saya bisa generate draft MOU dan kontak BSD AC. Mulai?`
  } else {
    text = `🤖 **Asisten Pertumbuhan**

Saya membantu Anda menemukan dan mengeksekusi peluang bisnis. Berikut yang bisa saya lakukan:

• 📊 **Analisis peluang** — Scan data untuk hot lead, upsell, churn risk
• 🎯 **Rekomendasi tindakan** — Suggest next step dengan probabilitas keberhasilan
• 📞 **Generate draft komunikasi** — Email, WhatsApp, proposal untuk customer
• 📈 **Tracking prediksi** — Monitor progress dan update probability real-time

**6 peluang aktif terdeteksi dengan total potensi Rp 106.3 juta/bulan.**

Apa yang ingin Anda tindaklanjuti?`
  }

  for (let i = 0; i < text.length; i += 3) {
    await new Promise(r => setTimeout(r, 20))
    yield {
      choices: [{
        delta: { content: text.slice(i, i + 3) },
        finish_reason: null,
      }],
    }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 25, completion_tokens: text.length / 3, total_tokens: 25 + text.length / 3 },
  }
}

function parseRequest(text) {
  // The request JSON comes first; a template/context block may follow after a blank line.
  const body = String(text).replace(/^Permintaan jasa:\s*/, '')
  const cut = body.indexOf('\n\n')
  try { return JSON.parse(cut === -1 ? body : body.slice(0, cut)) } catch { return { description: text } }
}

/* "Isi otomatis dengan AI" on the request form: a plausible service + needs from the hint. */
const AUTOFILL_SERVICES = [
  [/\bac\b|freon|pendingin/i, 'Servis AC'],
  [/laundry|cuci (?:selimut|linen|sprei|baju)|linen|selimut/i, 'Laundry B2B'],
  [/website|web\b|toko online|landing/i, 'Pengembangan website'],
  [/chatbot|agentic|asisten ai|\bai\b/i, 'Pengembangan agentic AI'],
  [/desain|logo|feed|konten/i, 'Desain grafis'],
  [/hama|rayap|kecoa|tikus/i, 'Pest control'],
  [/listrik|korslet|instalasi/i, 'Instalasi listrik'],
  [/bersih|cleaning|sapu|pel/i, 'Cleaning service'],
]
function mockAutofill(userMsg) {
  const hint = (/Petunjuk dari pemilik usaha:\n([\s\S]*)$/.exec(userMsg)?.[1] || userMsg).trim()
  const known = (/Layanan yang sudah ada:\s*(.+)/.exec(userMsg)?.[1] || '').split(';').map((x) => x.trim()).filter(Boolean)
  const loc = /Lokasi:\s*(.+)/.exec(userMsg)?.[1]?.trim()
  const found = AUTOFILL_SERVICES.find(([re]) => re.test(hint))?.[1]
  const service = known.find((k) => found && k.toLowerCase().includes(found.split(' ')[0].toLowerCase())) || found || known[0] || 'Layanan umum'
  const qty = /(\d+)\s*(unit|kg|m2|m²|halaman|titik|ruang|lantai)/i.exec(hint)
  const parts = [
    `Pelanggan membutuhkan ${service.toLowerCase()}${loc ? ` di ${loc}` : ''}.`,
    qty ? `Jumlah: ${qty[1]} ${qty[2]}.` : 'Jumlah unit/luas: perlu dikonfirmasi.',
    `Keterangan dari pelanggan: ${hint.replace(/\s+/g, ' ').slice(0, 280)}.`,
    'Waktu pelaksanaan yang diinginkan: perlu dikonfirmasi.',
    'Perlu ditanyakan: akses lokasi, kondisi saat ini, dan anggaran.',
  ]
  return JSON.stringify({ service_type: service, description: parts.join(' ') }, null, 2)
}

function parseReport(text) {
  try { return JSON.parse(String(text).replace(/^Data laporan:\s*/, '')) } catch { return {} }
}

/* ------------------------------------------------------------------------
 * Generic agent responder. Any request whose system prompt starts with the
 * marker `[agent:<key>]` gets a plausible Indonesian answer built from the
 * numbers in the context it was sent — clearly labelled as a local simulation.
 * ---------------------------------------------------------------------- */

async function* streamText(text, { step = 6, delay = 22 } = {}) {
  for (let i = 0; i < text.length; i += step) {
    await new Promise(r => setTimeout(r, delay))
    yield { choices: [{ delta: { content: text.slice(i, i + step) }, finish_reason: null }] }
  }
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: Math.ceil(text.length / 4), total_tokens: 120 + Math.ceil(text.length / 4) },
  }
}

const SIM_NOTE = '_Jawaban contoh: disusun otomatis dari angka di konteks Anda, bukan dari model AI. Akun demo memakai data dan AI contoh._'

/** Reads "Label: value" lines from the context the app sent. */
function contextReader(ctx) {
  const grab = (label) => {
    const m = ctx.match(new RegExp(`^${label}[^:\\n]*:\\s*(.+)$`, 'm'))
    return m ? m[1].trim() : null
  }
  const money = (label) => grab(label)?.match(/Rp\s?[\d.]+/)?.[0] || null
  const numericLines = ctx.split('\n').map(l => l.replace(/^[-\s]+/, '').trim())
    .filter(l => /Rp\s?[\d.]+|\d+(?:,\d+)?%/.test(l) && !l.startsWith('['))
  return { grab, money, numericLines }
}

function advisorMockAnswer(agent, question, ctx) {
  const { grab, money, numericLines } = contextReader(ctx)
  const noData = /Status data: belum ada data/.test(ctx)
  const rev30 = money('Pendapatan 30 hari terakhir')
  const profit30 = grab('Laba 30 hari terakhir')
  const avgJob = money('Rata-rata nilai pekerjaan')
  const mom = grab('Pertumbuhan bulan ke bulan')
  const topCost = grab('Biaya terbesar')
  const topService = grab('Layanan teratas')
  const topCustomer = grab('Pelanggan teratas')
  const pending = grab('Pekerjaan tertunda')
  const conversion = grab('Konversi')
  const target = grab('Target pertumbuhan')
  const nextMonth = grab('Bulan depan saja')
  const m12 = ctx.match(/^- Bulan ke-12: (.+)$/m)?.[1]
  const repeat = grab('Pelanggan berulang')
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 140)

  const out = []
  if (noData) {
    out.push(`Belum ada data permintaan maupun jurnal di akun ini, jadi saya menjawab "${q}" dengan saran umum dulu.`)
    out.push('### Mulai dari dasar')
    out.push('1. Catat setiap permintaan pelanggan di tahap **01 Permintaan**, sekecil apa pun.')
    out.push('2. Kirim penawaran tertulis untuk setiap permintaan dalam 24 jam.')
    out.push('3. Bukukan pendapatan dan biaya tiap pekerjaan agar margin terlihat.')
    out.push('Untuk usaha perorangan atau UKM, target pertumbuhan yang sehat adalah **1–2% per bulan**. Setelah satu bulan data terkumpul, saya bisa menghitung target yang spesifik untuk Anda.')
  } else {
    const facts = []
    if (rev30) facts.push(`pendapatan 30 hari terakhir **${rev30}**`)
    if (profit30) facts.push(`laba ${profit30.replace(/(Rp[\d.]+)/, '**$1**')}`)
    if (avgJob) facts.push(`rata-rata nilai pekerjaan **${avgJob}**`)
    out.push(`Untuk pertanyaan "${q}", saya berangkat dari angka Anda: ${facts.length ? facts.join(', ') : numericLines.slice(0, 2).join('; ')}.`)

    if (agent === 'keuangan') {
      out.push('### Yang terlihat di angka')
      if (topCost) out.push(`- Komponen biaya terbesar: **${topCost}**. Ini kandidat pertama untuk dihemat.`)
      if (mom) out.push(`- Pertumbuhan bulan ke bulan: ${mom}.`)
      out.push('- Periksa apakah harga per pekerjaan sudah menutup biaya tenaga, bahan, dan transport dengan margin minimal 30%.')
      out.push('### Rekomendasi')
      out.push('1. Negosiasikan harga bahan untuk pembelian bulanan, bukan per pekerjaan.')
      out.push('2. Gabungkan pekerjaan di area yang sama pada hari yang sama untuk menekan transport.')
      out.push('3. Naikkan harga 5–10% untuk layanan dengan permintaan tertinggi.')
    } else if (agent === 'pertumbuhan') {
      out.push('### Target dan kebutuhan')
      if (target) out.push(`- ${target}`)
      if (nextMonth) out.push(`- ${nextMonth}`)
      if (m12) out.push(`- Bulan ke-12: ${m12}`)
      if (mom) out.push(`- Pertumbuhan aktual Anda: ${mom}.`)
      out.push('- Patokan: UKM sehat tumbuh **1–2% per bulan**; enterprise menargetkan **5–10%**.')
      out.push('### Cara mencapainya')
      out.push(`1. Tawarkan ulang layanan ke pelanggan lama${repeat ? ` (saat ini ${repeat})` : ''}.`)
      out.push(`2. Dorong layanan teratas${topService ? `: ${topService.split(';')[0]}` : ''}.`)
      out.push('3. Pastikan kapasitas tim cukup sebelum menambah promosi.')
    } else if (agent === 'pemasaran') {
      out.push('### Peluang pemasaran')
      if (topService) out.push(`- Layanan dengan pendapatan terbesar: ${topService.split(';')[0]}. Jadikan pesan utama promosi.`)
      if (repeat) out.push(`- Pelanggan berulang: ${repeat}. Paket langganan bisa menaikkan angka ini.`)
      if (topCustomer) out.push(`- Pelanggan teratas: ${topCustomer.split(';')[0]}. Minta testimoni dan referral.`)
      out.push('### Rekomendasi')
      out.push('1. Kirim pesan WhatsApp pengingat perawatan ke pelanggan yang selesai 2–3 bulan lalu.')
      out.push('2. Minta ulasan Google Maps setiap pekerjaan selesai.')
      out.push('3. Buat promo musiman dengan kuota terbatas agar kapasitas tetap terjaga.')
    } else if (agent === 'operasional') {
      out.push('### Kondisi alur kerja')
      if (pending) out.push(`- ${pending}.`)
      if (conversion) out.push(`- ${conversion}.`)
      out.push('### Rekomendasi')
      out.push('1. Tetapkan batas waktu: penawaran dikirim maksimal 24 jam setelah permintaan masuk.')
      out.push('2. Jadwalkan pekerjaan per wilayah agar teknisi tidak bolak-balik.')
      out.push('3. Bukukan penyelesaian di hari yang sama supaya laporan selalu akurat.')
    } else {
      out.push('### Gambaran singkat')
      for (const line of numericLines.slice(0, 4)) out.push(`- ${line}`)
      out.push('### Prioritas')
      out.push(`1. Selesaikan pekerjaan tertunda${pending ? ` (${pending.split(',')[0]})` : ''}.`)
      out.push('2. Jaga margin dengan meninjau biaya terbesar setiap bulan.')
      out.push('3. Tetapkan target pertumbuhan 1–2% per bulan dan pantau di halaman ini.')
    }
  }
  out.push('### Langkah minggu ini')
  out.push('- Pilih satu rekomendasi di atas, tetapkan angkanya, dan cek hasilnya di Laporan minggu depan.')
  out.push(SIM_NOTE)
  return out.join('\n\n').replace(/\n\n(?=- |\d+\. )/g, '\n')
}

function socialMockAnswer(question, ctx) {
  const q = String(question || '').toLowerCase()
  const { grab, numericLines } = contextReader(ctx)
  const service = grab('Layanan') || grab('Layanan teratas')?.split(/\s+Rp/)[0] || 'servis AC'
  const out = []
  if (/ide|brainstorm|konten apa/.test(q)) {
    out.push(`### Ide konten untuk ${service}`)
    out.push('1. **Sebelum dan sesudah**: video 15 detik proses pengerjaan, tutup dengan hasil akhir.')
    out.push('2. **Tips perawatan**: carousel "5 tanda perangkat Anda perlu diservis".')
    out.push('3. **Di balik layar**: kenalkan teknisi dan standar kerja tim.')
    out.push('4. **Testimoni pelanggan**: kutipan singkat dan foto hasil kerja (dengan izin).')
    out.push('5. **Promo musiman**: kuota terbatas minggu ini, ajak pesan lewat WhatsApp.')
  } else if (/hashtag|tagar/.test(q)) {
    out.push('### Hashtag yang disarankan')
    out.push('#jasaprofesional #servisac #perawatanrumah #jasabersih #layananlokal #pesanviawa')
  } else if (/iklan|ads|meta/.test(q)) {
    out.push('### Rekomendasi iklan')
    out.push('- **Target**: pemilik rumah dan kantor kecil, usia 25–55, radius 10 km dari area layanan.')
    out.push('- **Anggaran awal**: Rp50.000 per hari selama 7 hari, lalu evaluasi biaya per chat WhatsApp.')
    out.push('- **Pesan utama**: jadwal cepat, harga transparan, garansi kerja.')
  } else {
    out.push(`### Caption untuk ${service}`)
    out.push(`Rumah nyaman dimulai dari perawatan yang tepat. Tim kami menangani ${service} dengan rapi, tepat waktu, dan bergaransi.`)
    out.push('Jadwal minggu ini masih tersedia. Kirim pesan WhatsApp untuk cek harga tanpa biaya survei.')
    out.push('#jasaprofesional #perawatanrumah #layananlokal')
  }
  if (numericLines.length) out.push(`Angka dari konteks Anda: ${numericLines.slice(0, 2).join('; ')}.`)
  out.push(SIM_NOTE)
  return out.join('\n\n').replace(/\n\n(?=- |\d+\. )/g, '\n')
}

/* json_schema requests: return valid JSON with the schema's keys filled in. */
function sampleString(key, i = 0) {
  const k = String(key).toLowerCase()
  const pick = (arr) => arr[i % arr.length]
  if (/hashtag|tag/.test(k)) return pick(['#jasaprofesional', '#servisac', '#perawatanrumah', '#jasabersih', '#layananlokal'])
  if (/platform/.test(k)) return pick(['instagram', 'tiktok', 'facebook'])
  if (/caption|body|isi|konten|content|text|copy|naskah/.test(k)) return pick(['Rumah nyaman dimulai dari perawatan yang tepat. Jadwal minggu ini masih tersedia, pesan lewat WhatsApp.', 'Tim kami datang tepat waktu, bekerja rapi, dan memberi garansi. Cek harga tanpa biaya survei.', 'Perawatan rutin membuat perangkat awet dan tagihan listrik lebih hemat. Tanyakan paket langganan kami.'])
  if (/title|judul|name|nama|hook|headline/.test(k)) return pick(['Sebelum dan sesudah perawatan', 'Lima tanda perlu servis', 'Kenalan dengan tim lapangan', 'Promo kuota terbatas'])
  if (/cta|ajakan/.test(k)) return 'Pesan lewat WhatsApp hari ini'
  if (/time|jam|waktu/.test(k)) return pick(['09:00', '12:30', '19:00'])
  if (/date|tanggal/.test(k)) return new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10)
  if (/agent|route|kategori|category|type|jenis|format/.test(k)) return pick(['umum', 'reels', 'carousel'])
  if (/reason|alasan|why|insight|catatan|notes|summary|ringkas/.test(k)) return 'Simulasi lokal: nilai contoh yang dibuat dari skema, bukan dari model AI.'
  if (/prompt/.test(k)) return 'Foto produk jasa di rumah modern, cahaya alami, gaya fotografi komersial, ruang kosong untuk teks'
  return `Contoh ${k.replace(/_/g, ' ')} (simulasi lokal)`
}

function sampleNumber(key, schema, i = 0) {
  const k = String(key).toLowerCase()
  let n = /price|harga|budget|anggaran|biaya|amount|nilai/.test(k) ? 150000 + i * 50000
    : /rate|persen|pct|percent|score|skor/.test(k) ? 4 + i
      : /count|jumlah|total|reach|jangkauan/.test(k) ? 120 + i * 40
        : 1 + i
  if (typeof schema.minimum === 'number') n = Math.max(n, schema.minimum)
  if (typeof schema.maximum === 'number') n = Math.min(n, schema.maximum)
  return schema.type === 'integer' ? Math.round(n) : n
}

function sampleFromSchema(schema = {}, key = 'nilai', depth = 0, i = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return null
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[i % schema.enum.length]
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type
    || (schema.properties ? 'object' : schema.items ? 'array' : 'string')
  if (type === 'object') {
    const props = schema.properties || {}
    const keys = [...new Set([...(schema.required || []), ...Object.keys(props)])]
    return Object.fromEntries(keys.map(k => [k, sampleFromSchema(props[k] || { type: 'string' }, k, depth + 1, i)]))
  }
  if (type === 'array') {
    const min = Number.isInteger(schema.minItems) ? schema.minItems : 3
    const max = Number.isInteger(schema.maxItems) ? schema.maxItems : Math.max(min, 5)
    const n = Math.max(1, Math.min(Math.max(min, 3), max))
    return Array.from({ length: n }, (_, j) => sampleFromSchema(schema.items || { type: 'string' }, key, depth + 1, j))
  }
  if (type === 'integer' || type === 'number') return sampleNumber(key, { ...schema, type }, i)
  if (type === 'boolean') return true
  return sampleString(key, i)
}

function schemaJson(responseFormat) {
  const rf = responseFormat || {}
  const schema = rf.json_schema?.schema || rf.json_schema || { type: 'object', properties: { hasil: { type: 'string' } } }
  return JSON.stringify(sampleFromSchema(schema, 'hasil'), null, 2)
}

const lastUserText = (messages) => [...messages].reverse().find(m => m.role === 'user')?.content || ''

/* --- Ruang optimasi: five teams + lead, grounded in the injected numbers --- */

function briefFacts(ctx) {
  const grab = (label) => (ctx.match(new RegExp(`${label}:\\s*([^\\n]+)`))?.[1] || '').trim()
  const money = (label) => {
    const raw = grab(label)
    const n = raw.match(/Rp\s?([\d.]+)/)?.[1]
    return n ? `Rp${n}` : (raw || '—')
  }
  return {
    scope: (/Cakupan:\s*([^\n]+)/.exec(ctx)?.[1] || 'pendapatan').trim(),
    revenue: money('Pendapatan tercatat') !== '—' ? money('Pendapatan tercatat') : money('Pendapatan'),
    avgJob: money('Rata-rata nilai pekerjaan') !== '—' ? money('Rata-rata nilai pekerjaan') : money('Rata-rata pekerjaan'),
    loss: money('Kerugian tercatat'),
    remaining: money('Sisa kerugian'),
    active: grab('Item VAS aktif') || '—',
    catalog: money('Potensi katalog') !== '—' ? money('Potensi katalog') : money('Potensi margin katalog'),
    opps: grab('Peluang terdeteksi') || '—',
    open: grab('Temuan terbuka') || '—',
    freed: grab('Sudah terhenti') || '—',
    biggest: grab('Sumber terbesar') || '—',    problem: (/Masalah yang ingin dipecahkan:\s*([^\n]+)/.exec(ctx)?.[1] || '').trim(),
    target: (/Target tambahan pendapatan:\s*([^\n]+)/.exec(ctx)?.[1] || '').trim(),
  }
}

function teamMockAnswer(team, ctx) {
  const f = briefFacts(ctx)
  const vas = /VAS/i.test(f.scope)
  const head = f.problem ? `Brief Anda: "${f.problem.slice(0, 110)}".` : 'Brief ini saya baca dari angka yang tersedia.'

  const bodies = {
    kreatif: [
      `${head} Tawaran Anda perlu satu nama yang bisa diucapkan pelanggan di telepon.`,
      vas
        ? '1. Beri nama paket dari hasilnya, bukan dari prosesnya: "AC Dingin Sepanjang Tahun", bukan "Perawatan Berkala". Paket ini menempel pada pekerjaan yang sudah ada, jadi tidak perlu kunjungan baru.'
        : '1. Beri nama program dari hasil yang dirasakan: "Nol Kerja Ulang", bukan "Perbaikan SOP". Tim lapangan lebih patuh pada janji yang bisa dijelaskan ke pelanggan.',
      vas
        ? `2. Isi paket: tiga kunjungan ringan plus satu pemeriksaan darurat, dijual sebagai satu harga bulanan. Dengan rata-rata pekerjaan ${f.avgJob}, harga bulanan sepertiga dari nilai itu terasa ringan.`
        : `2. Bungkus setiap temuan menjadi satu kartu kerja: sumber, kerugian per bulan, dan satu tindakan. Dengan sisa ${f.remaining} per bulan, satu kartu per minggu cukup untuk menutup sebagian besar kebocoran.`,
      '3. Hapus satu hal: daftar harga bertingkat yang membuat pelanggan bertanya. Satu paket, satu harga, satu alasan.',
      '**Risiko** Nama yang terlalu pintar justru menambah penjelasan; uji dulu pada lima pelanggan lama.',
    ],
    pemasaran: [
      `${head} Permintaan tambahan paling murah datang dari pelanggan yang sudah membayar Anda bulan ini.`,
      vas
        ? `1. Tawarkan pada momen terbaik: 10 menit sebelum pekerjaan selesai, saat pelanggan melihat hasilnya. Tingkat pasang di momen ini biasanya dua kali lipat dibanding pesan sehari kemudian.`
        : `1. Jadikan penghematan sebagai pesan ke pelanggan, bukan rahasia internal: "kami tidak menaikkan harga karena pemborosan kami turun". Ini alasan retensi yang jujur.`,
      vas
        ? `2. Dari ${f.opps} peluang yang terdeteksi, hubungi yang pelanggannya berulang lebih dulu lewat WhatsApp. Satu pesan, satu tawaran, tanpa lampiran.`
        : `2. Minta setiap pelanggan menilai kebersihan dan ketepatan waktu setelah pekerjaan. Ulasan yang menyebut "tidak ada kunjungan ulang" adalah bukti yang menjual.`,
      vas
        ? `3. Anggarkan biaya per pesan mendekati nol: WhatsApp tanpa iklan. Bila target ${f.target || 'belum ditetapkan'} ingin dikejar, tambahan berbayar baru masuk setelah 20 percakapan pertama terbukti.`
        : `3. Kanal termurah adalah jadwal: kirim pengingat servis ke pelanggan yang belum kembali, karena biaya akuisisinya nol.`,
      '**Risiko** Menawarkan tambahan ke pelanggan yang baru komplain akan terasa memeras; saring daftar dulu.',
    ],
    keuangan: [
      `${head} Saya hitung dari angka yang ada: pendapatan ${f.revenue}, rata-rata pekerjaan ${f.avgJob}.`,
      vas
        ? `1. Harga minimum sehat adalah biaya langsung ditambah 60%. Item dengan margin di bawah 25% sebaiknya dinaikkan atau dihentikan, karena menambah volume hanya menambah kerja.`
        : `1. Sisa kerugian ${f.remaining} per bulan sama dengan pendapatan yang harus dicari lewat pekerjaan baru. Menutup kebocoran selalu lebih murah daripada menambah pesanan.`,
      vas
        ? `2. Untuk mencapai ${f.target || 'target yang Anda tulis'}, Anda perlu sekitar ${f.catalog !== '—' ? f.catalog : 'margin katalog'} margin tambahan per bulan, yaitu beberapa item terpasang pada pekerjaan yang sudah dijadwalkan.`
        : `2. Bila separuh sisa kebocoran ditutup, laba naik tanpa satu pun pelanggan baru. Itu setara dengan menambah pendapatan sebesar angka yang sama pada margin tipikal usaha jasa.`,
      vas
        ? '3. Jangan beri diskon untuk mendorong pemasangan; beri bonus jangka waktu. Diskon memotong margin, bonus hanya menambah biaya satu kali.'
        : '3. Setiap temuan harus punya angka kerugian yang bisa dipertanggungjawabkan. Temuan tanpa angka tidak masuk perhitungan target.',
      '**Risiko** Angka kerugian yang terlalu optimistis membuat target 100% terlihat mustahil; pakai perkiraan bawah.',
    ],
    operasional: [
      `${head} Saya lihat kapasitas, bukan hanya uang.`,
      vas
        ? `1. Tambahan ini menempel pada kunjungan yang sudah ada, jadi tidak menambah perjalanan. Perkiraan tambahan waktu 20–30 menit per pekerjaan; dengan dua teknisi, itu masih di dalam jam kerja normal.`
        : `1. Tiga kebocoran terbesar biasanya berasal dari penyiapan bahan dan urutan rute. Keduanya bisa diperbaiki tanpa menambah orang: stok harian per tim dan pengurutan per zona.`,
      vas
        ? '2. Ubah SOP penutupan pekerjaan: sebelum pamit, teknisi menawarkan satu item dan mencatat jawabannya. Tanpa langkah ini, katalog tidak akan pernah terpasang.'
        : '2. Wajibkan checklist digital dengan foto sebelum menutup pekerjaan. Ini menutup kebocoran kerja ulang hampir seluruhnya, karena masalah ketahuan di lokasi.',
      vas
        ? '3. Batasi katalog pada lima item teratas. Terlalu banyak pilihan membuat teknisi ragu dan pelanggan menunda.'
        : `3. Untuk sumber terbesar (${f.biggest}), tetapkan satu ukuran mingguan: menit menunggu per pekerjaan. Angka tunggal lebih mudah dijaga daripada daftar panjang.`,
      '**Risiko** Bila tim sedang penuh, tambahan ini akan dikerjakan tergesa-gesa dan memicu kerja ulang; mulai dari separuh kapasitas.',
    ],
    riset: [
      `${head} Saya pisahkan yang diketahui dari yang diasumsikan.`,
      `1. Fakta: pendapatan tercatat ${f.revenue}, rata-rata pekerjaan ${f.avgJob}${vas ? `, item aktif ${f.active}` : `, kerugian tercatat ${f.loss}, sudah terhenti ${f.freed}`}. Selebihnya masih asumsi, termasuk tingkat pasang dan biaya tambahan.`,
      vas
        ? '2. Ukur dulu satu hal minggu ini: dari 20 penawaran terakhir, berapa yang pelanggannya bertanya tentang layanan tambahan. Angka itu lebih berguna daripada proyeksi pasar.'
        : `2. Ukur dulu satu hal minggu ini: waktu tunggu bahan per pekerjaan selama lima hari. Bila angkanya di bawah perkiraan, sumber terbesar (${f.biggest}) bukan prioritas.`,
      `3. Angka paling rapuh adalah perkiraan kerugian bulanan, karena diisi dari ingatan. Satu minggu pencatatan nyata bisa mengubah urutan prioritas sepenuhnya.`,
      '**Risiko** Bila pengukuran minggu pertama tidak dilakukan, seluruh rencana ini hanya dugaan yang dirapikan.',
    ],
  }

  return (bodies[team] || bodies.kreatif).join('\n')
}

function leadMockAnswer(ctx) {
  const f = briefFacts(ctx)
  const vas = /VAS/i.test(f.scope)
  const target = f.target && f.target !== 'belum ditentukan' ? f.target : (vas ? 'margin katalog tambahan' : f.remaining)
  return [
    '**Keputusan**',
    vas
      ? `Fokus pada satu paket tambahan yang menempel di pekerjaan yang sudah dijadwalkan, bukan menambah jenis layanan baru. Dengan rata-rata pekerjaan ${f.avgJob}, satu item bermargin sehat sudah cukup untuk menggerakkan target ${target}.`
      : `Fokus pada ${['Tidak ada', '—'].includes(f.biggest) ? 'penyiapan bahan dan urutan rute' : f.biggest} lebih dulu, karena di situ kebocoran terbesar dan perbaikannya tidak butuh biaya. Target ${target} dicapai dengan menutup kebocoran, bukan mencari pelanggan baru.`,
    '',
    '**Rencana 3 langkah**',
    vas
      ? `1. **Tim Kreatif** menyelesaikan nama dan isi satu paket, disetujui **Tim Keuangan** pada batas margin 60%. Tenggat 3 hari. Dampak: satu tawaran yang bisa diucapkan teknisi tanpa membaca brosur.`
      : `1. **Tim Operasional** memasang checklist penutupan pekerjaan dengan foto. Tenggat 5 hari. Dampak: menutup kebocoran kerja ulang yang tercatat ${f.remaining ? 'sebagian besar dari ' + f.remaining : 'paling besar'}.`,
    vas
      ? `2. **Tim Marketing** menguji tawaran itu pada 20 pelanggan berulang lewat WhatsApp. Tenggat 7 hari. Dampak: angka tingkat pasang nyata menggantikan asumsi.`
      : `2. **Tim Operasional** mengurutkan jadwal per zona selama seminggu penuh. Tenggat 7 hari. Dampak: biaya perjalanan turun tanpa menambah jam kerja.`,
    vas
      ? `3. **Tim Keuangan** meninjau margin setelah 20 percobaan dan menghentikan item yang tidak terpasang. Tenggat 14 hari. Dampak: katalog bersih, potensi ${f.catalog} per bulan menjadi realistis.`
      : `3. **Tim Keuangan** menetapkan satu angka mingguan yang dipantau: sisa kerugian per bulan. Tenggat 14 hari. Dampak: target 100% punya pengukur, bukan hanya niat.`,
    '',
    '**Yang saya tolak**',
    vas
      ? '- Menambah diskon untuk mendorong pemasangan: memotong margin pada item yang justru baru diuji.'
      : '- Menambah teknisi sebelum kebocoran waktu ditutup: kapasitas baru akan menyerap pemborosan yang sama.',
    '',
    '**Ukuran keberhasilan**',
    vas
      ? `Persentase penawaran yang memuat minimal satu item tambahan, dipantau mingguan. Naik dari basis sekarang menuju 30% dalam sebulan.`
      : `Rupiah sisa kerugian per bulan, dipantau mingguan. Turun konsisten setiap minggu menuju nol.`,
  ].join('\n')
}

// Waguri (src/waguri/skills.js buildMessages): answers from the BAHAN block only. A whole
// knowledge base (## sections) is narrowed to the section sharing most words with the question.
export function waguriMockAnswer(userText) {
  const text = String(userText || '')
  const bahan = (/BAHAN:\n([\s\S]*?)\n\nPERTANYAAN:/.exec(text)?.[1] || '').trim()
  const question = (/PERTANYAAN:\n([\s\S]*)$/.exec(text)?.[1] || '').toLowerCase()
  let answer = bahan
  if (bahan.includes('## ')) {
    const words = question.split(/[^a-z0-9]+/).filter((w) => w.length > 3)
    const sections = bahan.split(/\n(?=## )/).map((s) => s.replace(/^## [^\n]*\n/, '').trim())
    const score = (s) => words.filter((w) => s.toLowerCase().includes(w)).length
    answer = sections.slice().sort((a, b) => score(b) - score(a))[0] || ''
  }
  if (!answer) answer = 'Maaf, saya belum punya informasi untuk pertanyaan itu. Coba tanyakan dengan kata lain.'
  return `${answer}\n\n(Jawaban simulasi, tanpa model AI.)`
}

// The canned answer for a prompt (matched on its system/user text).
export function simulateAnswer({ messages, response_format }) {
  const userMsg = [...messages].reverse().find(m => m.role === 'user')?.content || ''
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
  if (system.includes('[agent:request-autofill]')) return streamText(mockAutofill(userMsg), { step: 5, delay: 18 })
  if (system.includes('agen penawaran') || userMsg.includes('Permintaan jasa')) return mockStreamOffer(parseRequest(userMsg), userMsg)
  if (response_format?.type === 'json_schema' || response_format?.type === 'json_object') {
    return streamText(schemaJson(response_format), { step: 10, delay: 14 })
  }
  const agent = system.match(/\[agent:([\w-]+)\]/)?.[1]
  if (agent === 'social') return streamText(socialMockAnswer(lastUserText(messages), system))
  if (agent === 'waguri') return streamText(waguriMockAnswer(lastUserText(messages)), { step: 8, delay: 10 })
  if (agent?.startsWith('tim-')) return streamText(teamMockAnswer(agent.slice(4), system))
  if (agent === 'pimpinan-optimasi') return streamText(leadMockAnswer(system))
  if (agent) return streamText(advisorMockAnswer(agent, lastUserText(messages), system))
  // Untagged prompts from Media Sosial, AI Superpowers and Pertumbuhan (src/ai/superpowers.js)
  if (system.includes('analis laporan') || userMsg.includes('Data laporan')) return mockStreamExplain(parseReport(userMsg))
  if (system.includes('pertumbuhan') || system.includes('business development')) return mockStreamPertumbuhan(lastUserText(messages))
  if (system.includes('social media') || system.includes('media sosial') || ['caption', 'brainstorm', 'hashtag', 'iklan'].some((w) => userMsg.includes(w))) return mockStreamSocial(lastUserText(messages))
  if (system.includes('analis bisnis')) return mockStreamAnalyst(lastUserText(messages))
  if (system.includes('Asisten AI') || system.includes('asisten AI')) return mockStreamGeneral(lastUserText(messages))
  return mockStreamExplain(parseReport(userMsg))
}

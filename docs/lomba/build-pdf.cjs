#!/usr/bin/env node
/**
 * Builds docs/lomba/Satu-Alur-Submission.pdf: a hand-laid A4 document in the
 * "Tumbuh" design system. Text source of truth: submission.md (keep both in step).
 *
 *   node docs/lomba/build-pdf.cjs [--html-only]
 *
 * Writes docs/lomba/pdf/index.html (styles in pdf/pdf.css), then prints it with
 * Playwright's Chromium. Fonts come from Google Fonts; the build waits for them.
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const OUT_HTML = path.join(DIR, 'pdf', 'index.html')
const PDF = path.join(DIR, 'Satu-Alur-Submission.pdf')
const DEMO_HOST = 'satu-alur.apipedia.workers.dev'
const VIDEO_URL = 'youtu.be/seXJmshTh0U'

/* -------------------------------------------------------------- Icons */
// Reuse the app's icon set so the document speaks the product's visual language.
const iconSrc = fs.readFileSync(path.join(DIR, '..', '..', 'src', 'ui', 'icons.js'), 'utf8')
const ICONS = {}
for (const m of iconSrc.matchAll(/^ {2}([a-zA-Z]+): '(.*)',$/gm)) ICONS[m[1]] = m[2]
const icon = (name, cls = '', style = '') =>
  `<span class="ico ${cls}"${style ? ` style="${style}"` : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg></span>`

const logo = (size = 34) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect width="32" height="32" rx="9" fill="#2B7560"/>
  <path d="M7.5 23.5h5.5v-5h5.5v-5h4" stroke="#F6F1E7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="23.5" cy="9.5" r="3" fill="#E7A13A"/></svg>`

const qr = fs.readFileSync(path.join(DIR, 'pdf', 'qr-demo.svg'), 'utf8').replace('<svg ', '<svg width="100%" height="100%" ')

/* -------------------------------------------------------------- Pieces */
const TOTAL = 16
let pageNo = 0
const page = (body, { cls = '', folio = true } = {}) => {
  pageNo += 1
  const n = String(pageNo).padStart(2, '0')
  const foot = folio
    ? `<div class="folio"><span><b>Satu Alur</b> · Dokumen submisi lomba 2026</span><span>${n} / ${TOTAL}</span></div>`
    : ''
  return `<section class="page ${cls}">${body}${foot}</section>`
}
const head = (num, kicker, title, lead = '') => `<header class="head">
  <span class="kicker"><span class="num">${num}</span>${kicker}</span>
  <h2>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`
const shot = (file, url, caption, demo = true) => `<figure class="shot">
  <div class="browser"><div class="bar"><i></i><i></i><i></i><span>${DEMO_HOST}${url}</span></div>
  <img src="../img/${file}" alt=""></div>
  <figcaption>${demo ? '<span class="tag ghost">Data demo fiktif</span>' : ''}<span>${caption}</span></figcaption></figure>`
const card = (ic, title, text, { cls = '', icls = '' } = {}) =>
  `<div class="card ${cls}">${icon(ic, icls)}<h4>${title}</h4><p class="muted">${text}</p></div>`
const side = (ic, title, text, icls = '', cls = '') =>
  `<div class="card ${cls}">${icon(ic, icls)}<div><h4>${title}</h4><p class="muted">${text}</p></div></div>`
const ticks = (items) => `<ul class="ticks">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`

/* -------------------------------------------------------------- Diagrams */
const flowSvg = () => {
  const stages = [
    ['01', 'Permintaan', 'Kebutuhan pelanggan'],
    ['02', 'Penawaran', 'Lingkup & harga'],
    ['03', 'Penugasan', 'Petugas & jadwal'],
    ['04', 'Penyelesaian', 'Tutup pekerjaan'],
    ['05', 'Pembukuan', 'Jurnal & saldo'],
    ['06', 'Laporan', 'Periode & pembanding'],
  ]
  const W = 660, step = W / 6, cy = 70
  let s = `<svg viewBox="0 0 ${W} 210" xmlns="http://www.w3.org/2000/svg" font-family="Plus Jakarta Sans, sans-serif">`
  s += `<line x1="${step / 2}" y1="${cy}" x2="${W - step / 2}" y2="${cy}" stroke="#8DB8A6" stroke-width="1.4"/>`
  stages.forEach(([n, name, sub], i) => {
    const x = step / 2 + i * step
    const ai = i === 1 || i === 5
    s += `<circle cx="${x}" cy="${cy}" r="22" fill="${ai ? '#16392E' : '#FFFCF6'}" stroke="${ai ? '#16392E' : '#2B7560'}" stroke-width="1.4"/>`
    s += `<text x="${x}" y="${cy + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${ai ? '#E7A13A' : '#1F4D3F'}">${n}</text>`
    s += `<text x="${x}" y="${cy + 44}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#16392E">${name}</text>`
    s += `<text x="${x}" y="${cy + 60}" text-anchor="middle" font-size="10" fill="#5C6B63">${sub}</text>`
    if (ai) {
      s += `<rect x="${x - 46}" y="${cy - 60}" width="92" height="22" rx="11" fill="#F7E3C2"/>`
      s += `<text x="${x}" y="${cy - 45}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#8A5A12">${i === 1 ? 'Agen penawaran' : 'Agen laporan'}</text>`
      s += `<line x1="${x}" y1="${cy - 38}" x2="${x}" y2="${cy - 22}" stroke="#E7A13A" stroke-width="1.4"/>`
    }
  })
  s += `<rect x="${step * 1.5 - 56}" y="${cy + 72}" width="112" height="20" rx="10" fill="#DCEAE2"/>`
  s += `<text x="${step * 1.5}" y="${cy + 85.5}" text-anchor="middle" font-size="9" font-weight="700" fill="#1F4D3F">Validasi aturan domain</text>`
  s += `<path d="M ${step * 5.5} ${cy + 66} v 32" stroke="#8DB8A6" stroke-width="1.2" stroke-dasharray="3 3"/>`
  s += `<rect x="${step * 3}" y="${cy + 100}" width="${step * 3 - 6}" height="34" rx="17" fill="#16392E"/>`
  s += `<text x="${step * 4.5 - 3}" y="${cy + 121}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#DCE9E2">Data alur → Radar · Prospek · Pendapatan · Penasihat</text>`
  s += '</svg>'
  return s
}

const archSvg = () => {
  const box = (x, y, w, h, title, sub, dark = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${dark ? '#16392E' : '#FFFCF6'}" stroke="${dark ? '#16392E' : 'rgba(27,36,32,.14)'}"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2 - 3}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${dark ? '#fff' : '#16392E'}">${title}</text>` +
    `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" font-size="9.5" fill="${dark ? '#8DB8A6' : '#5C6B63'}">${sub}</text>`
  const arrow = (x1, y1, x2, y2, label = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2B7560" stroke-width="1.4" marker-end="url(#ah)"/>` +
    (label ? `<text x="${(x1 + x2) / 2 + 8}" y="${(y1 + y2) / 2 + 3}" font-size="9" fill="#5C6B63">${label}</text>` : '')
  return `<svg viewBox="0 0 660 310" xmlns="http://www.w3.org/2000/svg" font-family="Plus Jakarta Sans, sans-serif">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#2B7560"/></marker></defs>
  ${box(200, 6, 260, 54, 'Browser (SPA)', 'Vite + JavaScript · desktop & HP')}
  ${arrow(330, 62, 330, 104, 'HTTPS, satu origin')}
  ${box(150, 108, 360, 66, 'Cloudflare Worker', 'auth · db · llm · leads · mcp · office', true)}
  ${arrow(215, 176, 90, 234)}
  ${arrow(290, 176, 255, 234)}
  ${arrow(370, 176, 420, 234)}
  ${arrow(445, 176, 580, 234)}
  ${box(10, 238, 150, 60, 'Cloudflare D1', 'SQLite · per pemilik data')}
  ${box(180, 238, 150, 60, 'Workers AI', 'Llama 3.3 70B · streaming')}
  ${box(345, 238, 150, 60, 'Peta & lokasi', 'OSM · Nominatim · Places')}
  ${box(510, 238, 140, 60, 'Sistem pelanggan', 'Konektor ERP · WAPilot')}
  </svg>`
}

/* -------------------------------------------------------------- Pages */
const pages = []

// 1 — Cover
pages.push(page(`
  <div class="brandline">${logo(34)}<span>Satu<span class="thin">Alur</span></span></div>
  <h1>Bisnis jasa Anda, <em>tumbuh</em> dalam satu alur.</h1>
  <p class="lead">Sistem kerja berbasis AI untuk usaha jasa di Indonesia: dari permintaan pelanggan sampai laporan keuangan, lalu mesin pendapatan dan pertumbuhan dari data Anda sendiri.</p>
  <div class="steps-line">
    <span>Permintaan</span><span class="on">Penawaran AI</span><span>Penugasan</span><span>Penyelesaian</span><span>Pembukuan</span><span class="on">Laporan AI</span>
  </div>
  <div class="badge-line"><span class="tag">Dokumen submisi lomba · November 2026</span></div>
  <dl class="cover-foot">
    <div><dt>Tim</dt><dd>Syahdan · Zulfikar · Margareta Lola</dd></div>
    <div><dt>Demo langsung</dt><dd>${DEMO_HOST}</dd></div>
    <div><dt>Platform</dt><dd>Cloudflare Workers · D1 · Workers AI</dd></div>
  </dl>`, { cls: 'cover', folio: false }))

// 2 — Ringkasan eksekutif
pages.push(page(`
  ${head('01', 'Ringkasan eksekutif', 'Satu aplikasi, <em>enam tahap</em>, AI di tempat yang tepat.', 'Satu Alur menjalankan seluruh kerja usaha jasa dalam satu alur. Setelah alurnya rapi, dua mesin ikut bekerja: mesin pendapatan (layanan tambahan, tanpa limbah) dan mesin pertumbuhan (radar peluang, pencari prospek, media sosial, penasihat AI).')}
  <div class="grid g3">
    ${card('alert', 'Masalah', 'Kerja tercecer di chat, catatan, dan spreadsheet. Penawaran lambat dan tidak konsisten, laba baru terlihat di akhir bulan, dan peluang dari pelanggan lama hilang tanpa disadari.')}
    ${card('sparkles', 'Solusi', 'Enam tahap dari permintaan sampai laporan. AI bekerja di tahap yang butuh penalaran: menyusun penawaran, menjelaskan laporan, membaca peluang, menilai prospek, menulis konten, memberi saran.')}
    ${card('shield', 'Pembeda', 'AI sebagai tangan yang membantu, bukan kotak hitam. Penawaran AI selalu diperiksa aturan domain, setiap peluang menunjukkan buktinya, dan data prospek hanya dari sumber yang sah.')}
  </div>
  <div class="fill"></div>
  <div class="pull">“Pemilik usaha baru percaya pada harga dari AI setelah aturan bisnis memeriksanya dan <em>buktinya terlihat</em>.”</div>
  <div class="fill"></div>
  <div class="facts">
    <div><b>6</b><span>tahap kerja dalam satu alur, dari permintaan sampai laporan</span></div>
    <div><b>9</b><span>akun demo dari tiga skala: perorangan, UKM, enterprise</span></div>
    <div><b>15<em>+</em></b><span>agen AI: penawaran, laporan, peluang, prospek, konten, penasihat, tim optimasi</span></div>
    <div><b>400<em>+</em></b><span>unit test, ditambah suite e2e Playwright</span></div>
  </div>
  <p class="small muted" style="margin-top:3mm">Semua angka di tangkapan layar berasal dari data demo fiktif. Kami belum mengklaim pelanggan, pendapatan, atau metrik penggunaan.</p>`))

// 3 — Masalah & target pasar
const seg = (ic, label, title, ex, need) => `<div class="card">${icon(ic)}<div><span class="tag green">${label}</span></div>
  <h3 style="margin-top:2.6mm">${title}</h3>
  <p class="muted" style="margin-top:2mm">${ex}</p>
  <div class="rule" style="margin:4mm 0 3mm"></div>
  <h4>Kebutuhan utama</h4><p class="muted">${need}</p></div>`
pages.push(page(`
  ${head('02', 'Masalah & target pasar', 'Usaha jasa yang hidup dari <em>permintaan</em> dan kunjungan.', 'Servis AC, cleaning, pest control, laundry, sampai facility management. Ukurannya berbeda, polanya sama: permintaan datang, harga harus cepat, pekerjaan harus tercatat.')}
  <div class="grid g3">
    ${seg('user', 'Perorangan', 'Sole trader', 'Servis AC Bekasi, home cleaning Makassar, listrik Medan.', 'Penawaran cepat, catatan rapi, tahu laba per pekerjaan.')}
    ${seg('store', 'UKM', 'Tim kecil', 'Pest control Surabaya, laundry Bandung, pengecatan Balikpapan.', 'Penugasan tim, pembukuan per pekerjaan, dan pertumbuhan.')}
    ${seg('building', 'Enterprise', 'Multi-lokasi', 'Layanan ritel mal, facility management kantor, housekeeping rumah sakit.', 'Integrasi sistem lama, laporan, dan kontrol biaya.')}
  </div>
  <p class="small muted" style="margin-top:2.4mm">Contoh di atas adalah akun demo fiktif.</p>
  <div class="fill"></div>
  <h3 style="margin-bottom:4mm">Lima masalah yang kami pecahkan</h3>
  <table class="t">
    <tr><th style="width:44mm">Masalah</th><th>Yang terjadi hari ini</th></tr>
    <tr><td>Kerja tercecer</td><td>Permintaan lewat chat, penawaran ditulis manual, pembukuan di spreadsheet. Tidak ada satu sumber kebenaran.</td></tr>
    <tr><td>Penawaran lambat</td><td>Harga dan ruang lingkup bergantung pada ingatan pemilik, sehingga tidak konsisten antar pelanggan.</td></tr>
    <tr><td>Laba tak terlihat</td><td>Biaya per pekerjaan jarang dicatat; margin baru diketahui di akhir bulan, kalau diketahui.</td></tr>
    <tr><td>Pendapatan bocor</td><td>Layanan tambahan tidak ditawarkan, sementara waktu menganggur, perjalanan, bahan, dan pekerjaan ulang menggerus laba.</td></tr>
    <tr><td>Tumbuh menebak</td><td>Pelanggan yang seharusnya servis ulang terlupa; pelanggan baru dicari tanpa data.</td></tr>
  </table>`))

// 4 — Peta solusi
const modRow = (ic, area, items) => `<div class="card" style="display:grid;grid-template-columns:9mm 40mm 1fr;gap:5mm;align-items:center;padding:4mm 5mm">
  ${icon(ic, '', 'margin:0')}<h4>${area}</h4><p class="muted">${items}</p></div>`
pages.push(page(`
  ${head('03', 'Solusi & cakupan', 'Dua lapis: <em>aplikasi</em> harian dan teknologi pendukung.', 'Aplikasi Office dipakai pemilik usaha setiap hari. Di bawahnya, teknologi pendukung menghubungkan AI, sistem lama pelanggan, dan kanal layanan.')}
  <span class="kicker" style="margin-bottom:3mm">Aplikasi Office</span>
  <div class="stack">
    ${modRow('inbox', 'Operasional', 'Listen permintaan, buat penawaran dengan AI, monitoring proses, pembukuan, dan laporan dengan penjelasan AI.')}
    ${modRow('megaphone', 'Marketing', 'Konten per platform, kalender unggah, bank ide, rencana iklan Meta, dan kolaborasi influencer.')}
    ${modRow('radar', 'Business Analyst', 'Radar Peluang dari transaksi sendiri, dan Pencari Prospek di peta dengan data yang sah.')}
    ${modRow('trendingUp', 'Expansion & Growth', 'Layanan tambahan (VAS) dan Tanpa limbah (zero waste), plus ruang optimasi lima tim AI.')}
    ${modRow('bot', 'Executive', 'Penasihat AI (lima penasihat dengan snapshot bisnis) dan AI Superpowers.')}
  </div>
  <div class="fill"></div>
  <span class="kicker" style="margin-bottom:3mm">Teknologi pendukung</span>
  <div class="grid g3">
    ${card('sparkles', 'Multi-agentic AI', 'Agen khusus di setiap proses, bukan satu chatbot umum.', { cls: 'dark' })}
    ${card('database', 'Konektor ERP & migrasi', 'REST/JSON, CSV, webhook ber-HMAC; migrasi bertahap dengan dry run dan rollback.', { cls: 'dark' })}
    ${card('message', 'Customer service (WAPilot)', 'Pengaturan konektor WhatsApp tersedia; pengiriman otomatis dalam pengembangan.', { cls: 'dark' })}
  </div>`))

// 5 — Operasional
pages.push(page(`
  ${head('04', 'Aplikasi Office · Operasional', 'Permintaan sampai laporan, <em>tanpa pindah aplikasi</em>.', 'Setiap tahap punya wizard pendek. Dua tahap memakai agen AI, dan hasil AI selalu bisa diedit sebelum disimpan.')}
  <div class="flow">${flowSvg()}</div>
  <div class="fill"></div>
  <div style="width:76%;margin:0 auto">${shot('offer.jpg', '/#/app · Penawaran', 'Penawaran: wizard tiga langkah, daftar penawaran, dan tombol Setujui.')}</div>
  <div class="grid g3 rows" style="margin-top:6mm">
    ${side('sparkles', 'Agen penawaran', 'Menyusun lingkup, harga, ketentuan; aturan domain memvalidasi.', 'accent', 'row')}
    ${side('fileText', 'Agen laporan', 'Menjelaskan angka periode dan memberi rekomendasi.', 'accent', 'row')}
    ${side('checkCircle', 'Aturan bisnis', 'Selesai sekali per penugasan; pendapatan tak bisa ganda.', '', 'row')}
  </div>`))

// 6 — Monitoring & Marketing
pages.push(page(`
  ${head('05', 'Monitoring & marketing', 'Lihat <em>laba</em> hari ini, rencanakan konten besok.')}
  <div class="grid g-5-7" style="align-items:center">
    <div>
      <h3>Ringkasan</h3>
      <p class="muted" style="margin-top:2mm">Laba sebelum pajak, pendapatan, biaya, tingkat penyelesaian, grafik pendapatan vs biaya, dan konversi per tahap. Dihitung langsung dari data alur.</p>
    </div>
    ${shot('dashboard.jpg', '/#/app · Ringkasan', 'Ringkasan keuangan dan konversi per tahap.')}
  </div>
  <div class="fill"></div>
  <div class="grid g-7-5" style="align-items:center">
    ${shot('social-media.jpg', '/#/app · Media Sosial', 'Konten per platform, jadwal, ide, iklan, kolaborasi.')}
    <div>
      <h3>Media Sosial</h3>
      <div style="margin-top:3mm">${ticks([
        'Konten untuk Instagram, TikTok, Facebook, Threads, LinkedIn, WhatsApp, dan X, dengan batas karakter dan hashtag masing-masing.',
        'Kalender unggah, bank ide, rencana iklan Meta, kolaborasi influencer.',
        'Publikasi ke Meta dan Threads lewat aplikasi resmi, aktif setelah kredensial diisi.',
        'Agen konten menulis draf; semua bisa diedit.',
      ])}</div>
    </div>
  </div>
  <div class="fill"></div>`))

// 7 — Business Analyst
pages.push(page(`
  ${head('06', 'Aplikasi Office · Business Analyst', 'Peluang dari data sendiri, <em>prospek</em> dari peta.')}
  <div class="grid g2">
    <div>
      ${shot('radar.jpg', '/#/app · Radar peluang', 'Setiap peluang punya skor dan faktor yang bisa diperiksa.')}
      <h3 style="margin-top:6mm">Radar Peluang</h3>
      <p class="muted" style="margin-top:2mm">Membaca transaksi pengguna sendiri: layanan rutin yang jatuh tempo, pelanggan yang mulai menghilang, kandidat paket berkala, penawaran tertahan, dan musim ramai. Agen analis peluang memberi rekomendasi tindakan.</p>
    </div>
    <div>
      ${shot('leads.jpg', '/#/app · Pencari prospek', 'Titik, radius, dan kriteria di peta OpenStreetMap.', false)}
      <h3 style="margin-top:6mm">Pencari Prospek</h3>
      <p class="muted" style="margin-top:2mm">Mencari usaha di sekitar titik dan radius pilihan. Agen penilai prospek menilai kecocokan dengan layanan pengguna dan membantu menyusun draf penawaran.</p>
    </div>
  </div>
  <div class="fill"></div>
  <div class="card tint" style="display:flex;gap:5mm;align-items:center">
    ${icon('shield', '', 'margin:0;background:#fff;flex-shrink:0')}
    <p><b>Legal sejak hari pertama.</b> Data prospek hanya dari OpenStreetMap, dan Google Places API resmi bila kuncinya diisi. Tanpa scraping Google Maps, dan tidak ada pesan yang dikirim otomatis ke prospek.</p>
  </div>`))

// 8 — Expansion & Executive
pages.push(page(`
  ${head('07', 'Expansion, growth & executive', 'Naikkan yang masuk, <em>tutup</em> yang bocor.')}
  <div class="grid g-7-5" style="align-items:start">
    ${shot('vas.jpg', '/#/app · Layanan tambahan', 'Potensi pendapatan beserta dasar perhitungannya.')}
    <div class="stretch">
      ${side('plus', 'Layanan tambahan (VAS)', 'Potensi pendapatan yang tersirat di pekerjaan, lengkap dengan nilai Rupiah dan katalog bermargin.')}
      ${side('refresh', 'Tanpa limbah', 'Kebocoran dalam Rupiah di lima aliran: menganggur, perjalanan, bahan, pekerjaan ulang, air & kimia.')}
    </div>
  </div>
  <div class="card" style="margin-top:5mm;display:flex;gap:5mm;align-items:center">
    ${icon('users', 'accent', 'margin:0;flex-shrink:0')}
    <p><b>Ruang optimasi lima tim.</b> Kreatif, Marketing, Keuangan, Operasional, dan Riset & Data bekerja paralel atas satu brief; Pimpinan Optimasi menyatukannya menjadi satu rencana.</p>
  </div>
  <div class="fill"></div>
  <div class="grid g-5-7" style="align-items:start">
    <div class="stretch">
      ${side('bot', 'Penasihat AI', 'Lima penasihat: bisnis, keuangan, pertumbuhan, pemasaran, operasional. Pertanyaan diarahkan otomatis; jawaban memakai snapshot bisnis pengguna.', '', 'dark')}
      ${side('wand', 'AI Superpowers', 'Asisten dengan memori, pemanggilan tool, dan percobaan ulang otomatis.', '', 'dark')}
    </div>
    ${shot('advisor.jpg', '/#/app · Penasihat AI', 'Snapshot bisnis pengguna sebagai konteks.')}
  </div>`))

// 9 — Kantor & teknologi pendukung
pages.push(page(`
  ${head('08', 'Kantor Satu Alur & integrasi', 'Panel staf untuk <em>menjalankan</em> bisnis platform.', 'Kantor Satu Alur adalah panel super-admin, terpisah dari akun pengguna dan hanya bisa dibuka lewat login staf.')}
  <div class="grid g2">
    ${card('fileText', 'Konten situs', 'CMS landing page, halaman Tentang kami, dan dokumen legal.')}
    ${card('wallet', 'Bisnis', 'Paket langganan Free / Lite / Pro dan pengaturan payment gateway (Midtrans, Xendit).')}
    ${card('users', 'Pelanggan', 'Pelanggan & mitra, pengguna, pesan Contact Us, dan tiket pengaduan CS.')}
    ${card('handshake', 'Agensi influencer', 'Profil influencer dengan rate card, permintaan kolaborasi atau iklan, kampanye dan deliverable.')}
  </div>
  <div class="fill"></div>
  <h3 style="margin-bottom:4mm">Teknologi pendukung</h3>
  <table class="t">
    <tr><th style="width:42mm">Komponen</th><th style="width:34mm">Status</th><th>Keterangan</th></tr>
    <tr><td>Multi-agentic AI</td><td><span class="tag green">Aktif</span></td><td>Agen penawaran, laporan, analis peluang, penilai prospek, konten, lima penasihat, lima tim optimasi dan pimpinannya.</td></tr>
    <tr><td>Konektor ERP</td><td><span class="tag green">Aktif · Enterprise</span></td><td>REST/JSON, CSV/JSON, webhook ber-HMAC; pemetaan kolom (Rupiah, tanggal, telepon Indonesia); migrasi bertahap dengan dry run dan rollback. Panduan untuk Odoo, SAP B1, NetSuite, Accurate, Mekari.</td></tr>
    <tr><td>WhatsApp CS</td><td><span class="tag">Dikembangkan</span></td><td>Pengaturan konektor WAPilot tersedia; pengiriman otomatis dari server sedang dibangun.</td></tr>
  </table>
  <p class="small muted" style="margin-top:4mm">Catatan istilah: “MCP” di proyek ini adalah nama internal modul konektor ERP (rute /api/mcp), bukan implementasi standar Model Context Protocol.</p>`))

// 10 — Arsitektur
pages.push(page(`
  ${head('09', 'Arsitektur & teknologi', 'Satu Worker, <em>dekat</em> dengan pengguna Indonesia.', 'Aset dan API dilayani dari satu Cloudflare Worker. Data di D1, AI di Workers AI, peta dari sumber terbuka.')}
  <div class="flow">${archSvg()}</div>
  <div class="fill"></div>
  <div class="grid g2">
    <div class="card">${icon('lock')}<h4>Keamanan & privasi</h4>${ticks([
      'Login OTP email; token sesi disimpan sebagai hash.',
      'Whitelist tabel dan kolom di endpoint data.',
      'Setiap query dibatasi ke pemilik data.',
      'Kredensial ERP dienkripsi, tidak pernah dikirim ke browser.',
      'Teks AI disaring sebelum ditampilkan (aman dari XSS).',
    ])}</div>
    <div class="card">${icon('zap', 'accent')}<h4>Biaya sebagai fitur</h4>${ticks([
      'Paket gratis D1: 100 ribu baris tulis per hari, jadi setiap operasi dihitung.',
      'Indeks yang tidak dipakai dihapus; keyset paging untuk daftar panjang.',
      'Seed data demo versi ringan.',
      'Mode JSON berskema + parser toleran untuk output AI.',
      'Riwayat chat penasihat disimpan di perangkat.',
    ])}</div>
  </div>
  <p class="small muted" style="margin-top:4mm">Frontend Vite + JavaScript modul dengan desain sistem “Tumbuh”; Three.js untuk landing dan login. Mutu dijaga 400+ unit test dan e2e Playwright.</p>`))

// 11 — Model bisnis
const plan = (name, amt, unit, desc, items, pro = false) => `<div class="card price ${pro ? 'pro' : ''}">
  <div style="display:flex;justify-content:space-between;align-items:center;min-height:5mm"><h4>${name}</h4>${pro ? '<span class="tag">Rekomendasi</span>' : ''}</div>
  <div class="amt">${amt}<small>${unit}</small></div><p class="muted">${desc}</p>${ticks(items)}</div>`
pages.push(page(`
  ${head('10', 'Model bisnis', 'Gratis untuk mencoba, <em>bayar</em> saat terasa dampaknya.', 'Harga di bawah adalah rencana. Kuota per fitur dan voucher sudah diimplementasikan di branch terpisah dan menunggu review.')}
  <div class="grid g3" style="align-items:stretch">
    ${plan('Free', 'Rp0', '', 'Seluruh alur kerja dengan kuota percobaan AI.', ['Enam tahap alur kerja', 'Kuota AI percobaan per fitur', 'Akses semua menu'])}
    ${plan('Lite', 'Rp99rb', '/ bulan', 'Untuk tim kecil yang mulai rutin memakai AI.', ['Kuota AI lebih besar', 'Radar & prospek lebih sering', 'Penasihat AI harian'])}
    ${plan('Pro', 'Rp249rb', '/ bulan', 'Untuk usaha yang tumbuh dengan data.', ['Kuota AI terbesar', 'Fitur pertumbuhan penuh', 'Prioritas dukungan'], true)}
  </div>
  <div class="card tint" style="margin-top:5mm;display:flex;justify-content:space-between;align-items:center">
    <div><h4>Enterprise</h4><p class="muted">Konektor ERP, migrasi data, dan dukungan khusus.</p></div><span class="tag green">Hubungi kami</span>
  </div>
  <div class="fill"></div>
  <div class="grid g3">
    ${card('wallet', 'Saldo AI terpisah', 'Paket tidak termasuk saldo AI. Setelah kuota bulanan habis, pemakaian AI memotong saldo.')}
    ${card('receipt', 'Voucher tiga jenis', 'Voucher paket (misal Pro 30 hari), saldo AI (misal Rp50.000), atau gabungan. Penukaran tercatat sebagai data calon pelanggan.')}
    ${card('handshake', 'Pendapatan kedua', 'Agensi pemasaran digital: iklan Meta dan agregator influencer, dikelola dari Kantor Satu Alur.')}
  </div>`))

// 12 — GTM & roadmap
const node = (when, title, items, now = false) => `<div class="node ${now ? 'now' : ''}"><span class="kicker">${when}</span><h3 style="margin:1.6mm 0 3mm">${title}</h3>${ticks(items)}</div>`
pages.push(page(`
  ${head('11', 'Go-to-market & roadmap', 'Mulai dari <em>jaringan</em> sendiri, tumbuh lewat komunitas.')}
  <div class="grid g2">
    ${card('flag', 'Soft launch', 'Rencana tampil di panggung komunitas Garuda Spark, Surabaya (sedang dijajaki).')}
    ${card('users', 'Pelanggan awal', 'Pendekatan langsung ke jaringan pemilik usaha jasa, termasuk pengguna ERP, dengan imbal balik testimoni dan logo pelanggan.')}
    ${card('compass', 'Identitas', 'Domain produk sedang dipilih: singkat, mudah diingat, TLD.')}
    ${card('handshake', 'Kemitraan', 'Penjajakan kolaborasi dengan penyedia software akuntansi lokal setelah produk stabil. Belum ada kesepakatan.')}
  </div>
  <div class="fill"></div>
  <h3 style="margin-bottom:6mm">Roadmap</h3>
  <div class="timeline">
    ${node('Sekarang', 'Rilis lomba', ['Alur enam tahap', 'Mesin pendapatan & pertumbuhan', 'Kantor Satu Alur', 'Konektor ERP'], true)}
    ${node('Berikutnya', 'Siap dijual', ['Kuota per fitur & voucher', 'Pembayaran online paket & saldo AI', 'Onboarding & tur fitur', 'Email OTP produksi'])}
    ${node('Lanjutan', 'Skala', ['Notifikasi WhatsApp otomatis', 'Sinkronisasi ERP dua arah', 'Aplikasi petugas lapangan', 'Indikator ekonomi BPS untuk radar'])}
  </div>
  <div class="fill"></div>`))

// 13 — WorkBuddy
pages.push(page(`
  ${head('12', 'Product sharing', 'Di mana <em>WorkBuddy</em> memberi nilai tambah.')}
  <div class="pull" style="margin-bottom:8mm">Satu Alur lahir di WorkBuddy: WorkBuddy untuk kecepatan eksplorasi, infrastruktur terkelola untuk produksi.</div>
  <div class="bi">
    <div class="col"><div class="lang">Bahasa Indonesia</div>
      <p>Prototipe pertama dibangun langsung di WorkBuddy dengan <b>WorkBuddy Cloud SDK</b> untuk autentikasi dan database, serta <b>AI connect</b> untuk LLM tanpa mengelola kunci API. Dalam satu sesi kerja, alur enam tahap dengan penawaran AI sudah bisa diklik.</p>
      <ol class="nums" style="margin-top:4mm">
        <li><b>Ide ke prototipe dalam hitungan jam.</b> Tanpa server, database, atau kunci AI sebelum menguji ide di depan calon pengguna.</li>
        <li><b>AI connect tanpa kunci.</b> Bereksperimen dengan prompt sejak hari pertama, lalu fokus pada aturan domain yang memvalidasi output AI.</li>
        <li><b>Kontrak data yang jelas.</b> Antarmuka query builder SDK kami pertahankan saat pindah ke Cloudflare; mock, backend HTTP, dan setiap tahap memakai antarmuka yang sama.</li>
      </ol>
      <p style="margin-top:4mm">Saat produk membesar, runtime pindah ke Cloudflare Workers + D1 + Workers AI untuk domain sendiri, kontrol biaya, dan migrasi skema. WorkBuddy AI connect tetap kami pakai untuk demo lomba.</p>
    </div>
    <div class="col"><div class="lang">English</div>
      <p>We built the first prototype inside WorkBuddy, using the <b>WorkBuddy Cloud SDK</b> for auth and data and <b>AI connect</b> for keyless LLM access. Within one working session we had a clickable six-stage flow with a working AI quotation step.</p>
      <ol class="nums" style="margin-top:4mm">
        <li><b>Idea to clickable prototype in hours.</b> No servers, databases or API keys before putting the idea in front of real service-business owners.</li>
        <li><b>Keyless AI from day one.</b> We iterated on prompts immediately and spent our energy on the domain rules that validate AI output.</li>
        <li><b>A clean data contract.</b> The SDK's query-builder interface became the pattern we kept on Cloudflare; mock, HTTP backend and every stage share it.</li>
      </ol>
      <p style="margin-top:4mm">As the product grew we moved the runtime to Cloudflare Workers + D1 + Workers AI for our own domain, cost control and schema migrations. WorkBuddy AI connect remains our engine for the competition demo.</p>
    </div>
  </div>
  <div class="fill"></div>
  <div class="journey">
    <div><span class="kicker">01 · Eksplorasi</span><h4>Prototipe di WorkBuddy</h4><p class="muted">Cloud SDK + AI connect. Alur enam tahap bisa diklik dalam satu sesi.</p></div>
    <div><span class="kicker">02 · Produksi</span><h4>Port ke Cloudflare</h4><p class="muted">Worker + D1 + Workers AI, antarmuka data yang sama, biaya terkendali.</p></div>
    <div><span class="kicker">03 · Lomba</span><h4>Demo dengan AI connect</h4><p>WorkBuddy tetap menjadi mesin AI untuk demo kompetisi.</p></div>
  </div>`))

// 14 — Key insight
const insights = [
  ['AI harus bisa diperiksa, bukan sekadar pintar.', 'Pemilik UKM percaya harga AI setelah aturan domain memvalidasinya dan buktinya terlihat.', 'AI must be checkable, not just clever.', 'Owners trust an AI price only when domain rules validated it and the evidence is visible.'],
  ['Output terstruktur mengalahkan prompt panjang.', 'Mode JSON berskema, parser toleran, dan normalisasi menyelesaikan JSON AI yang rusak.', 'Structured output beats longer prompts.', 'Schema-constrained JSON, a tolerant parser and normalisation fixed malformed AI JSON.'],
  ['Biaya adalah fitur.', 'Seed demo pernah menghabiskan kuota tulis D1; kini setiap operasi dihitung biayanya.', 'Cost is a feature.', 'One demo seed exhausted D1’s free write quota; now every operation has a write budget.'],
  ['Legal sejak hari pertama.', 'OpenStreetMap dan API resmi, bukan scraping: sedikit lebih lambat, aman untuk dijual.', 'Legal from day one.', 'OpenStreetMap and official APIs, never scraping: slightly slower, safe to sell.'],
  ['Sederhanakan layar.', 'Halaman panjang menjadi wizard, ada paginasi, dan penjelasan pindah ke tooltip.', 'Simplify the screen.', 'Long pages became wizards, lists got pagination, explanations moved into tooltips.'],
  ['Manusia + agen AI.', 'Tiga peran jelas dan agen coding paralel mengirim cakupan ini dalam sekitar seminggu, karena setiap perubahan diuji otomatis.', 'Humans plus AI agents.', 'Three clear roles plus parallel coding agents shipped this scope in about a week, because every change was tested.'],
]
pages.push(page(`
  ${head('13', 'Key insight & learning', 'Enam pelajaran yang <em>mengubah</em> cara kami membangun.')}
  <div class="stack fill" style="display:flex;flex-direction:column;justify-content:space-between">
    ${insights.map(([t, d, te, de], i) => `<div class="card" style="display:grid;grid-template-columns:11mm 1fr 1fr;gap:5mm;padding:4.6mm 5mm;margin:0">
      <span style="font-family:var(--serif);font-size:22pt;line-height:1;color:var(--accent)">${String(i + 1).padStart(2, '0')}</span>
      <div><h4>${t}</h4><p class="muted">${d}</p></div>
      <div style="box-shadow:inset 0.6pt 0 0 var(--line);padding-left:5mm"><h4>${te}</h4><p class="muted">${de}</p></div></div>`).join('')}
  </div>`))

// 15 — Tim & demo
const person = (init, name, role, text) => `<div class="card person"><div class="avatar">${init}</div><h3>${name}</h3><div class="role">${role}</div><p class="muted" style="margin-top:2.4mm">${text}</p></div>`
pages.push(page(`
  ${head('14', 'Tim & akses demo', 'Tiga orang, <em>peran</em> yang jelas.')}
  <div class="grid g3">
    ${person('S', 'Syahdan', 'CTO · Engineering', 'Port ke Cloudflare Workers + D1 + Workers AI, desain sistem “Tumbuh”, alur enam tahap, radar peluang, pencari prospek, penasihat AI, optimasi biaya D1, deploy.')}
    ${person('Z', 'Zulfikar', 'Produk & fitur', 'Media sosial dan publikasi Meta/Threads, Kantor Satu Alur, agensi influencer, VAS dan Tanpa limbah, konektor ERP, materi pemasaran.')}
    ${person('M', 'Margareta Lola', 'QA & audit', 'Lebih dari 190 test case UAT, audit ekonomi data demo, pengujian dan laporan bug lintas fitur.')}
  </div>
  <div class="fill"></div>
  <div class="card dark" style="display:grid;grid-template-columns:1fr 44mm;gap:8mm;align-items:center;padding:7mm">
    <div>
      <span class="kicker" style="color:var(--accent)">Coba sekarang</span>
      <h3 style="font-size:19pt;margin:2mm 0 4mm">${DEMO_HOST}</h3>
      <ol class="nums">
        <li>Buka situs, klik <b>Masuk</b>, lalu pilih <b>Akun demo</b>.</li>
        <li>Pilih skala usaha (Sole Trader, UKM, Enterprise) dan salah satu dari 9 akun.</li>
        <li>Atau masuk dengan email apa pun; pada mode demo kode OTP tampil di layar.</li>
      </ol>
      <p class="small" style="margin-top:3mm">Video demo (2:48): <b>${VIDEO_URL}</b></p>
      <p class="small muted" style="margin-top:3mm">Semua data akun demo adalah data fiktif.</p>
    </div>
    <div style="background:var(--paper);border-radius:4mm;padding:4mm;width:44mm;height:44mm">${qr}</div>
  </div>
  <div class="fill"></div>
  <h4 style="margin-bottom:2.4mm">Menguji di lokal</h4>
  <div class="code">git clone https://github.com/maszulfikarsuweleh/satu-alur.git
cd satu-alur && npm install
npm run dev     <span class="c"># http://localhost:5173 · data contoh di browser, AI disimulasikan</span>
npm test        <span class="c"># unit test + e2e Playwright</span></div>`))

// 16 — Back cover
pages.push(page(`
  <div class="brandline">${logo(40)}<span>Satu<span class="thin">Alur</span></span></div>
  <h2 style="margin-top:12mm">Terima kasih.<br><em>Tumbuh</em> bersama kami.</h2>
  <p class="lead" style="color:#C9DBD2">${DEMO_HOST}</p>
  <p class="small" style="margin-top:20mm;color:var(--brand-300)">Syahdan · Zulfikar · Margareta Lola — November 2026</p>`, { cls: 'back', folio: false }))

if (pageNo !== TOTAL) throw new Error(`TOTAL is ${TOTAL} but ${pageNo} pages were built`)

const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Satu Alur — Dokumen submisi lomba</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="pdf.css"></head><body>
${pages.join('\n')}
</body></html>`
fs.writeFileSync(OUT_HTML, html)
console.log('HTML:', path.relative(process.cwd(), OUT_HTML))

if (process.argv.includes('--html-only')) process.exit(0)

;(async () => {
  const { chromium } = require('playwright')
  const browser = await chromium.launch()
  const pg = await browser.newPage()
  await pg.goto('file://' + OUT_HTML, { waitUntil: 'networkidle' })
  await pg.evaluate(() => document.fonts.ready)
  const fonts = await pg.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))
  if (!fonts.some((f) => /Instrument Serif/.test(f))) console.warn('Warning: Instrument Serif did not load')
  // Report pages whose content overflows the A4 box (anything past the folio).
  const over = await pg.evaluate(() => [...document.querySelectorAll('.page')].map((p, i) => {
    const r = p.getBoundingClientRect()
    const bottom = Math.max(...[...p.children].filter((c) => !c.classList.contains('folio')).map((c) => c.getBoundingClientRect().bottom))
    return { page: i + 1, spare: Math.round(r.bottom - bottom) }
  }).filter((x) => x.spare < 90))
  if (over.length) console.warn('Tight pages (px left before the bottom):', JSON.stringify(over))
  await pg.pdf({ path: PDF, printBackground: true, preferCSSPageSize: true })
  await browser.close()
  console.log('PDF:', path.relative(process.cwd(), PDF), `${(fs.statSync(PDF).size / 1e6).toFixed(2)} MB`)
})().catch((e) => { console.error(e); process.exit(1) })

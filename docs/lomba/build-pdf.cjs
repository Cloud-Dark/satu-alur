#!/usr/bin/env node
/**
 * Builds docs/lomba/Satu-Alur-Submission.pdf from submission.md.
 *
 *   node docs/lomba/build-pdf.cjs [--html-only]
 *
 * Needs pandoc (Markdown -> HTML) and Playwright's Chromium (HTML -> PDF).
 * Styling follows the "Tumbuh" design tokens in src/styles/tokens.css.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const SRC = path.join(DIR, 'submission.md')
const HTML = path.join(DIR, 'submission.print.html')
const PDF = path.join(DIR, 'Satu-Alur-Submission.pdf')

// Drop the Markdown title block: the cover page replaces it.
const md = fs.readFileSync(SRC, 'utf8')
  .replace(/^# .*\n/, '')
  .replace(/^(> .*\n)+/m, '')
const body = execFileSync('pandoc', ['--from=gfm', '--to=html5', '--wrap=none'], { input: md }).toString()
  // Images become numbered figures with their alt text as caption.
  .replace(/<p><img src="([^"]+)" alt="([^"]*)" \/><\/p>/g, '<figure><img src="$1" alt="$2"><figcaption>$2</figcaption></figure>')
  // Start the big chapters on a fresh page; the rest flows.
  .replace(/<h2 id="(7-product|8-key)/g, '<h2 class="break" id="$1')

const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Satu Alur — Submission</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f7f4ee; --surface: #ffffff; --text: #17251f; --muted: #5a6b63; --line: #e4ddd0;
    --brand: #134235; --brand-500: #2b7560; --brand-300: #8fbfab; --brand-50: #edf5f0; --accent: #e7a13a;
  }
  @page { size: A4; margin: 18mm 16mm 20mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 10pt/1.6 'Plus Jakarta Sans', system-ui, sans-serif; }

  .cover {
    height: 297mm; width: 210mm; position: relative; overflow: hidden; page-break-after: always;
    background: radial-gradient(120% 80% at 85% 0%, #1f5a48 0%, var(--brand) 55%, #0d2f26 100%); color: #f7f4ee;
    padding: 26mm 20mm;
  }
  .cover .mark { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 15pt; letter-spacing: -0.02em; }
  .cover .mark span { font-weight: 500; color: var(--brand-300); }
  .cover h1 { font: 400 44pt/1.02 'Instrument Serif', serif; margin: 22mm 0 6mm; letter-spacing: -0.01em; }
  .cover h1 em { color: var(--accent); }
  .cover .lead { font-size: 12.5pt; max-width: 135mm; color: #dbe7e1; line-height: 1.55; }
  .cover .shot { position: absolute; left: 20mm; right: -40mm; bottom: 26mm; height: 118mm; border-radius: 10px; overflow: hidden;
    box-shadow: 0 30px 60px -20px rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.15); }
  .cover .shot img { display: block; width: 100%; }
  .cover .meta { position: absolute; left: 20mm; right: 20mm; bottom: 14mm; display: flex; justify-content: space-between; font-size: 9pt; color: #b9cfc6; }
  .cover .pill { display: inline-block; margin-top: 8mm; padding: 5px 12px; border-radius: 999px; background: rgba(231,161,58,.16); color: var(--accent); font-size: 9pt; font-weight: 600; }

  main { padding: 0; }
  h2 { font: 400 22pt/1.15 'Instrument Serif', serif; color: var(--brand); margin: 0 0 4mm; padding-top: 2mm; border-top: 2px solid var(--brand); page-break-after: avoid; }
  h2 { margin-top: 8mm; }
  h2.break { page-break-before: always; margin-top: 0; }
  h3 { font-size: 12.5pt; font-weight: 700; color: var(--brand); margin: 6mm 0 2mm; page-break-after: avoid; }
  h4 { font-size: 10.5pt; font-weight: 700; margin: 5mm 0 1.5mm; color: var(--text); page-break-after: avoid; }
  h4::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 7px; vertical-align: 1px; }
  p { margin: 0 0 2.6mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 5mm; }
  li { margin: 0 0 1.2mm; }
  strong { color: var(--brand); font-weight: 700; }
  a { color: var(--brand-500); text-decoration: none; }
  hr { display: none; }
  blockquote { margin: 0 0 4mm; padding: 3mm 4mm; background: var(--brand-50); border-left: 3px solid var(--brand-500); border-radius: 0 6px 6px 0; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 8.8pt; background: var(--surface); border-radius: 8px; overflow: hidden; page-break-inside: auto; }
  thead th { background: var(--brand); color: #f7f4ee; text-align: left; font-weight: 600; padding: 2.2mm 3mm; }
  td { padding: 2mm 3mm; border-top: 1px solid var(--line); vertical-align: top; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #fbf9f5; }
  pre { background: #10261f; color: #e3efe9; padding: 3.5mm 4mm; border-radius: 8px; font: 8.4pt/1.5 ui-monospace, 'SFMono-Regular', Menlo, monospace; white-space: pre-wrap; page-break-inside: avoid; }
  code { font: 8.6pt ui-monospace, Menlo, monospace; background: var(--brand-50); padding: 0 3px; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  figure { margin: 3mm 0 5mm; page-break-inside: avoid; }
  figure img { width: 100%; max-height: 105mm; object-fit: cover; object-position: top; border-radius: 8px; border: 1px solid var(--line); box-shadow: 0 6px 18px -10px rgba(19,66,53,.35); }
  figcaption { font-size: 8pt; color: var(--muted); margin-top: 1.5mm; }
  .intro { font-size: 10.5pt; }
</style>
</head>
<body>
  <section class="cover">
    <div class="mark">
      <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#f7f4ee"/><path d="M7.5 23.5h5.5v-5h5.5v-5h4" stroke="#134235" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23.5" cy="9.5" r="3" fill="#e7a13a"/></svg>
      Satu<span>Alur</span>
    </div>
    <h1>Bisnis jasa Anda,<br><em>tumbuh</em> dalam satu alur.</h1>
    <p class="lead">Sistem kerja berbasis AI untuk bisnis jasa di Indonesia: dari permintaan sampai laporan, lalu mesin pendapatan dan pertumbuhan dari data Anda sendiri.</p>
    <span class="pill">Dokumen submission lomba · 2026</span>
    <div class="shot"><img src="img/00-landing.jpg" alt=""></div>
    <div class="meta"><span>Syahdan · Zulfikar · Margareta Lola</span><span>satu-alur.apipedia.workers.dev · ${today}</span></div>
  </section>
  <main>${body}</main>
</body>
</html>`

fs.writeFileSync(HTML, html)
if (process.argv.includes('--html-only')) { console.log(HTML); process.exit(0) }

;(async () => {
  const { chromium } = require('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('file://' + HTML, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({
    path: PDF, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font:8px 'Plus Jakarta Sans',sans-serif;color:#5a6b63;padding:0 16mm;display:flex;justify-content:space-between">
      <span>Satu Alur · Dokumen submission</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  })
  await browser.close()
  console.log(PDF)
})().catch((e) => { console.error(e); process.exit(1) })

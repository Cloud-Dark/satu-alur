/**
 * Turns <out>/raw.webm + scenes.json (from record.cjs) into the demo MP4s:
 *   Satu-Alur-Demo.mp4      full walkthrough (~2:45) with title and end cards
 *   Satu-Alur-Demo-60s.mp4  60-second cut (storyboard scenes 1, 4, 7, 8, 10, 11, 13, 16)
 *
 *   node docs/lomba/video/build.cjs docs/lomba/video/out
 *
 * Loading and AI waits recorded as "fast" spans are sped up and labelled
 * "dipercepat ×N"; the rest plays at one global rate chosen to land near
 * TARGET seconds. Needs ffmpeg with libx264 + drawtext, and Playwright for the cards.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { chromium } = require('playwright')

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'))
const LANG = process.env.VIDEO_LANG === 'en' ? 'en' : 'id'
const COPY = {
  id: {
    sped: 'dipercepat', note: 'Data demo fiktif · AI pada rekaman ini disimulasikan',
    title: 'Bisnis jasa Anda,<br><em>tumbuh</em> dalam satu alur.',
    sub: 'Dari permintaan pelanggan sampai laporan, lalu mesin pendapatan dan pertumbuhan.',
    end: 'Coba sekarang.',
  },
  en: {
    sped: 'sped up', note: 'Fictional demo data · AI is simulated in this recording',
    title: 'Your service business,<br><em>growing</em> in one flow.',
    sub: 'From customer request to report, then the revenue and growth engines.',
    end: 'Try it now.',
  },
}[LANG]
const TARGET = 165 // seconds of scene footage in the full cut (cards come on top)
const MAX_RATE = 1.45
const CUT_SCENES = { 1: 'head', 4: 'tail', 7: 'tail', 8: 'head', 10: 'tail', 11: 'tail', 13: 'tail', 16: 'head' }
const CUT_LEN = 6.9
/* Windows: ffmpeg filter args and concat lists want forward slashes; no-op elsewhere. */
const slash = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p)
/* drawtext font: VIDEO_FONT, else Inter (Linux), else a Windows bold sans. */
const FONT_FILE = [process.env.VIDEO_FONT, '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',
  'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf'].find((f) => f && fs.existsSync(f))
if (!FONT_FILE) throw new Error('No drawtext font found; set VIDEO_FONT to a .ttf/.otf path')
/* Escape the drive colon for both filtergraph and option parsing (C\\:/...). No-op for the Linux path. */
const FONT = slash(FONT_FILE).replace(/:/g, '\\\\:')
/* One ffmpeg concat-list line; single quotes escaped as '\'' (no-op for normal paths). */
const listLine = (p) => `file '${slash(p).replace(/'/g, "'\\''")}'`
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30']

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

const { scenes, fastSpans } = JSON.parse(fs.readFileSync(path.join(OUT, 'scenes.json'), 'utf8'))
const raw = path.join(OUT, 'raw.webm')
const tmp = path.join(OUT, 'tmp')
fs.rmSync(tmp, { recursive: true, force: true })
fs.mkdirSync(tmp, { recursive: true })

/* Scene 2 (demo login) builds a year of demo data in the browser; play it fast too. */
const s2 = scenes.find((s) => s.n === 2)
const spans = [...fastSpans]
if (s2) {
  const inner = spans.filter((f) => f.from >= s2.start && f.to <= s2.end).sort((a, b) => a.from - b.from)
  const firstFast = inner[0]?.from ?? s2.end
  if (firstFast - s2.start > 6) spans.push({ from: s2.start + 3, to: firstFast, speed: 4 })
}
spans.sort((a, b) => a.from - b.from)

/** Splits a scene into [from, to, speed] pieces. */
function pieces(sc) {
  const out = []
  let t = sc.start
  for (const f of spans) {
    if (f.to <= sc.start || f.from >= sc.end) continue
    const a = Math.max(f.from, sc.start)
    const b = Math.min(f.to, sc.end)
    if (a > t + 0.05) out.push([t, a, 1])
    if (b - a > 0.05) out.push([a, b, f.speed])
    t = Math.max(t, b)
  }
  if (sc.end > t + 0.05) out.push([t, sc.end, 1])
  return out
}

const slowTotal = scenes.flatMap(pieces).reduce((s, [a, b, sp]) => s + (sp === 1 ? b - a : 0), 0)
const fastTotal = scenes.flatMap(pieces).reduce((s, [a, b, sp]) => s + (sp === 1 ? 0 : (b - a) / sp), 0)
const RATE = Math.min(MAX_RATE, Math.max(1, slowTotal / Math.max(1, TARGET - fastTotal)))
console.log(`global rate ×${RATE.toFixed(2)} (normal ${slowTotal.toFixed(1)} s, fast ${fastTotal.toFixed(1)} s)`)

/* Per-scene clips. */
const sceneClips = {}
for (const sc of scenes) {
  const parts = pieces(sc).map(([a, b, sp], i) => {
    const f = path.join(tmp, `s${sc.n}-${i}.mp4`)
    const r = sp === 1 ? RATE : sp * RATE
    const vf = [`setpts=(PTS-STARTPTS)/${r.toFixed(4)}`, 'fps=30']
    if (sp >= 2) {
      vf.push(`drawbox=x=iw-262:y=22:w=236:h=44:color=0x173f33@0.85:t=fill`,
        `drawtext=fontfile=${FONT}:text='${COPY.sped} ×${sp}':fontcolor=0xf6f0e2:fontsize=22:x=w-246:y=33`)
    }
    ff(['-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', raw, '-an', '-vf', vf.join(','), ...ENC, f])
    return f
  })
  const list = path.join(tmp, `s${sc.n}.txt`)
  fs.writeFileSync(list, parts.map(listLine).join('\n'))
  const clip = path.join(tmp, `scene${sc.n}.mp4`)
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', clip])
  sceneClips[sc.n] = clip
}

/* Title and end cards rendered as HTML. */
async function cards() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const shell = (body) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:radial-gradient(1200px 700px at 20% 10%,#25594a,#173f33 60%,#11322a);color:#f6f0e2;font-family:"Plus Jakarta Sans",Inter,sans-serif}
.w{text-align:center;max-width:1500px}.logo{display:inline-flex;align-items:center;gap:18px;font-weight:700;font-size:44px;letter-spacing:-.03em;margin-bottom:56px}
.logo b{font-weight:500;color:#9fd1b9;margin-left:6px}h1{font-family:"Instrument Serif",serif;font-weight:400;font-size:112px;line-height:1.02;margin:0;letter-spacing:-.02em}
h1 em{color:#e7a13a}p{font-size:34px;color:#cfe3d8;margin:40px 0 0}.u{display:inline-block;margin-top:46px;padding:16px 30px;border-radius:999px;background:#f6f0e2;color:#173f33;font-weight:700;font-size:36px}
.t{margin-top:40px;font-size:30px;color:#cfe3d8}.n{position:fixed;bottom:40px;left:0;right:0;text-align:center;font-size:20px;color:#9fbfb1}</style></head>
<body><div class="w">${body}</div><div class="n">${COPY.note}</div></body></html>`
  const mark = `<svg width="64" height="64" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#f6f0e2"/><path d="M7.5 23.5h5.5v-5h5.5v-5h4" stroke="#173f33" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23.5" cy="9.5" r="3" fill="#e7a13a"/></svg>`
  await page.setContent(shell(`<div class="logo">${mark}<span>Satu<b>Alur</b></span></div><h1>${COPY.title}</h1><p>${COPY.sub}</p>`), { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(tmp, 'title.png') })
  await page.setContent(shell(`<div class="logo">${mark}<span>Satu<b>Alur</b></span></div><h1>${COPY.end}</h1><div class="u">satu-alur.apipedia.workers.dev</div><div class="t">Syahdan · Zulfikar · Margareta Lola</div>`), { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(tmp, 'end.png') })
  await browser.close()
}

function card(png, seconds, out) {
  ff(['-loop', '1', '-t', String(seconds), '-i', png, '-vf', `fade=t=in:st=0:d=0.5,fade=t=out:st=${seconds - 0.5}:d=0.5,fps=30`, ...ENC, out])
}

/** Concatenates clips (re-encoded for clean joins) and adds a silent AAC track. */
function join(clips, out) {
  const list = path.join(tmp, `${path.basename(out)}.txt`)
  fs.writeFileSync(list, clips.map(listLine).join('\n'))
  const silent = path.join(tmp, `${path.basename(out)}.v.mp4`)
  ff(['-f', 'concat', '-safe', '0', '-i', list, ...ENC, silent])
  ff(['-i', silent, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out])
}

;(async () => {
  await cards()
  const title = path.join(tmp, 'title.mp4')
  const end = path.join(tmp, 'end.mp4')
  card(path.join(tmp, 'title.png'), 3, title)
  card(path.join(tmp, 'end.png'), 4, end)

  const full = path.join(OUT, 'Satu-Alur-Demo.mp4')
  join([title, ...scenes.map((s) => sceneClips[s.n]), end], full)

  const shortClips = []
  for (const [n, where] of Object.entries(CUT_SCENES)) {
    const src = sceneClips[n]
    if (!src) continue
    const d = dur(src)
    const len = Math.min(CUT_LEN, d)
    const ss = where === 'head' ? 0 : Math.max(0, d - len)
    const f = path.join(tmp, `cut${n}.mp4`)
    ff(['-ss', ss.toFixed(3), '-i', src, '-t', len.toFixed(3), '-an', ...ENC, f])
    shortClips.push(f)
  }
  const shortTitle = path.join(tmp, 'title-short.mp4')
  const shortEnd = path.join(tmp, 'end-short.mp4')
  card(path.join(tmp, 'title.png'), 2.5, shortTitle)
  card(path.join(tmp, 'end.png'), 3, shortEnd)
  const short = path.join(OUT, 'Satu-Alur-Demo-60s.mp4')
  join([shortTitle, ...shortClips, shortEnd], short)

  console.log(`full ${dur(full).toFixed(1)} s, 60s cut ${dur(short).toFixed(1)} s`)
})().catch((e) => { console.error(e); process.exit(1) })

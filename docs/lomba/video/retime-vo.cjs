/**
 * Re-times vo.json to a fresh build: reads the clip durations build.cjs left
 * in <out>/tmp and moves every voice-over slot onto its scene in the final MP4.
 *
 *   node docs/lomba/video/retime-vo.cjs docs/lomba/video/out
 *
 * Full cut: title card, scene1..scene16, end card. A line keeps its text; its
 * slot starts LEAD after its clip starts and runs until GAP before the next
 * line (the last line runs into the end card). Same for the 60-second cut.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'))
const tmp = path.join(OUT, 'tmp')
const LANG = process.env.VIDEO_LANG || 'id'
const VO = path.join(__dirname, LANG === 'id' ? 'vo.json' : `vo.${LANG}.json`)
const LEAD = 0.4
const GAP = 0.2

const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())
const r1 = (x) => Math.round(x * 10) / 10

const vo = JSON.parse(fs.readFileSync(VO, 'utf8'))

function retime(lines, clips) {
  // clips: [{ id, len }] in playback order; a line's id ("s4", "c4", "title") names its clip
  let t = 0
  const at = {}
  for (const c of clips) { at[c.id] = { start: t, end: t + c.len }; t += c.len }
  for (const ln of lines) {
    const slot = at[ln.id]
    if (!slot) { console.warn(`no clip for VO line ${ln.id}; left as is`); continue }
    ln.start = r1(slot.start + (ln.id === 'title' ? 0.5 : LEAD))
  }
  // A line may run on until just before the next line starts; the last one runs into the end card.
  lines.forEach((ln, i) => {
    const next = lines[i + 1]
    ln.end = r1(next ? next.start - GAP : t - 0.6)
  })
  return t
}

const full = [{ id: 'title', len: dur(path.join(tmp, 'title.mp4')) }]
for (let n = 1; n <= 16; n++) {
  const f = path.join(tmp, `scene${n}.mp4`)
  if (fs.existsSync(f)) full.push({ id: `s${n}`, len: dur(f) })
}
full.push({ id: 'end', len: dur(path.join(tmp, 'end.mp4')) })
const fullTotal = retime(vo.full, full)

const short = [{ id: 'title', len: dur(path.join(tmp, 'title-short.mp4')) }]
for (const n of [1, 4, 7, 8, 10, 11, 13, 16]) {
  const f = path.join(tmp, `cut${n}.mp4`)
  if (fs.existsSync(f)) short.push({ id: `c${n}`, len: dur(f) })
}
short.push({ id: 'end', len: dur(path.join(tmp, 'end-short.mp4')) })
const shortTotal = retime(vo.short, short)

// Keep vo.json's one-line-per-entry layout so diffs stay readable.
const line = (o) => `    ${JSON.stringify(o).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/,"/g, ', "').replace(/":/g, '": ')}`
const body = Object.entries(vo).map(([k, v]) => Array.isArray(v)
  ? `  ${JSON.stringify(k)}: [\n${v.map(line).join(',\n')}\n  ]`
  : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')
fs.writeFileSync(VO, `{\n${body}\n}\n`)
console.log(`vo.json re-timed: full ${fullTotal.toFixed(1)} s, short ${shortTotal.toFixed(1)} s`)
for (const ln of vo.full) console.log(`  ${ln.id.padStart(5)} ${ln.start.toFixed(1).padStart(6)}–${ln.end.toFixed(1)}`)

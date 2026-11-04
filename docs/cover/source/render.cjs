// Render ulang cover dari HTML ke PNG (3x) dan PDF A4.
// Pakai: node docs/cover/source/render.cjs   (butuh paket playwright + Chromium)
const path = require('path')
const { chromium } = require('playwright')

const OUT = path.join(__dirname, '..')
const COVERS = [
  { name: 'cover-portrait', width: 794, height: 1123, landscape: false },
  { name: 'cover-landscape', width: 1123, height: 794, landscape: true },
]

;(async () => {
  const browser = await chromium.launch()
  for (const c of COVERS) {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 3 })
    await page.goto('file://' + path.join(__dirname, c.name + '.html'), { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: path.join(OUT, c.name + '.png') })
    await page.pdf({ path: path.join(OUT, c.name + '.pdf'), format: 'A4', landscape: c.landscape, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
    await page.close()
  }
  await browser.close()
})()

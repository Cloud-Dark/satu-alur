#!/usr/bin/env node
/**
 * E2E runner: starts the Vite dev server in mock mode, runs every spec in
 * tests/e2e/*.spec.cjs sequentially, prints PASS/FAIL per check and exits
 * non-zero on any failure. Uses the preinstalled Playwright (`require('playwright')`).
 *
 *   npm run test:e2e                      # all specs
 *   node tests/e2e/run.cjs login flow     # only specs whose name contains "login" or "flow"
 *   E2E_BASE_URL=http://localhost:5173 node tests/e2e/run.cjs   # reuse a running mock dev server
 *   E2E_SHOTS=/tmp/shots node tests/e2e/run.cjs                  # save screenshots
 *   E2E_ROOT=/path/to/checkout node tests/e2e/run.cjs            # serve another checkout (e.g. a clean `git archive HEAD`)
 *
 * The specs assume mock mode (VITE_USE_MOCK=true): never point E2E_BASE_URL at
 * production, the flow spec writes data (and D1 free-tier writes are limited).
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { makeContext } = require('./lib.cjs')

const ROOT = process.env.E2E_ROOT ? path.resolve(process.env.E2E_ROOT) : path.resolve(__dirname, '..', '..')
const PORT = Number(process.env.E2E_PORT) || 5199
const filters = process.argv.slice(2)

let chromium
try {
  ({ chromium } = require('playwright'))
} catch {
  console.error('Playwright tidak ditemukan. E2E memakai Playwright yang sudah terpasang di mesin (require("playwright")).')
  process.exit(2)
}

function waitForServer(url, ms = 60000) {
  const until = Date.now() + ms
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve() })
      req.on('error', () => (Date.now() > until ? reject(new Error(`server not up: ${url}`)) : setTimeout(tick, 300)))
      req.setTimeout(2000, () => req.destroy())
    }
    tick()
  })
}

async function main() {
  let server = null
  let base = process.env.E2E_BASE_URL
  if (!base) {
    base = `http://localhost:${PORT}`
    const config = path.join(__dirname, 'vite.e2e.config.mjs') // project config + HMR off
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--config', config], {
      cwd: ROOT,
      env: { ...process.env, VITE_USE_MOCK: 'true', BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let log = ''
    server.stdout.on('data', (d) => { log += d })
    server.stderr.on('data', (d) => { log += d })
    server.on('exit', (code) => { if (code) console.error(`vite exited with ${code}\n${log}`) })
    try {
      await waitForServer(base)
    } catch (e) {
      console.error(String(e), '\n', log)
      stop(server)
      process.exit(2)
    }
    console.log(`vite (mock) on ${base}${process.env.E2E_ROOT ? ` serving ${ROOT}` : ''}`)
    const onSignal = () => { stop(server); process.exit(130) }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  }

  const shotDir = process.env.E2E_SHOTS || ''
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true })

  const specs = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.spec.cjs'))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .filter((f) => !filters.length || filters.some((x) => f.includes(x)))

  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] })
  const results = []
  const started = Date.now()
  for (const file of specs) {
    const spec = file.replace(/\.spec\.cjs$/, '')
    console.log(`\n▶ ${spec}`)
    const t = makeContext({ browser, base, spec, results, shotDir })
    const t0 = Date.now()
    try {
      await require(path.join(__dirname, file))(t)
    } catch (e) {
      t.check(false, `spec finished without exception`, (e && e.stack) || e)
    } finally {
      await t.closeAll()
    }
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
  await browser.close()
  if (server) stop(server)

  const fails = results.filter((r) => !r.ok)
  const todos = results.filter((r) => r.todo)
  const bugs = results.filter((r) => r.bug && !r.fixed)
  const passes = results.length - todos.length - bugs.length - fails.length
  console.log(`\n${passes} PASS, ${fails.length} FAIL, ${bugs.length} KNOWN-BUG, ${todos.length} TODO in ${specs.length} specs (${((Date.now() - started) / 1000).toFixed(0)} s)`)
  if (fails.length) {
    console.log('\nFailures:')
    for (const f of fails) console.log(`  [${f.spec}] ${f.label}${f.detail !== undefined ? ` — ${String(f.detail).split('\n')[0].slice(0, 200)}` : ''}`)
  }
  if (bugs.length) {
    console.log('\nKnown bugs (reported, not counted as failures):')
    for (const b of bugs) console.log(`  [${b.spec}] ${b.bug}: ${b.label}`)
  }
  process.exit(fails.length ? 1 : 0)
}

const ORDER = ['landing', 'login-live', 'login-demo', 'dashboard', 'flow', 'combobox', 'social', 'advisor', 'radar', 'leads', 'settings']
function order(f) { const i = ORDER.findIndex((k) => f.startsWith(k)); return i < 0 ? 99 : i }

function stop(child) {
  try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* */ } }
}

main().catch((e) => { console.error(e); process.exit(1) })

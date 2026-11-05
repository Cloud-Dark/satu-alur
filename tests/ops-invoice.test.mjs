// Penugasan progress, assign picker, demo petugas seed, and invoices (rules + Worker on SQLite).
import './helpers/setup.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const P = await import('../src/domain/progress.js')
const I = await import('../src/invoice/rules.js')
const { demoWorkerRows, demoWorkersSql, DEMO_KS, demoOwnerId } = await import('../src/demo/demo-workers.js')
const { invoiceHtml } = await import('../src/invoice/print.js')

/* ------------------------------------------------------------ progress */

test('progress: effective value, completion wins, unknown falls back', () => {
  assert.equal(P.progressOf({ progress: 'dikerjakan' }), 'dikerjakan')
  assert.equal(P.progressOf({ progress: 'dikerjakan' }, true), 'selesai')
  assert.equal(P.progressOf({ status: 'done' }), 'selesai')
  assert.equal(P.progressOf({}), 'belum')
  assert.equal(P.progressOf({ progress: 'aneh' }), 'belum')
  // a stored 'selesai' without a completion is not trusted: the completion is the source of truth
  assert.equal(P.progressOf({ progress: 'selesai', status: 'assigned' }), 'belum')
})

test('progress: transitions — Selesai goes through Penyelesaian, finished is final', () => {
  assert.deepEqual(P.planProgress('belum', 'dikerjakan'), { ok: true })
  assert.deepEqual(P.planProgress('dikerjakan', 'ditunda'), { ok: true })
  assert.deepEqual(P.planProgress('ditunda', 'selesai'), { ok: true, complete: true })
  assert.equal(P.planProgress('selesai', 'belum').ok, false)
  assert.equal(P.planProgress('belum', 'belum').ok, false)
  assert.equal(P.planProgress('belum', 'x').ok, false)
})

test('progress: chip shows Lewat jadwal only for work not started; counts', () => {
  const past = '2020-01-01T00:00:00Z'
  assert.equal(P.progressChip({ scheduled_at: past }).label, 'Lewat jadwal')
  assert.equal(P.progressChip({ scheduled_at: past, progress: 'dikerjakan' }).label, 'Sedang dikerjakan')
  assert.equal(P.progressChip({ scheduled_at: past, progress: 'ditunda' }).tone, 'warn')
  assert.equal(P.progressChip({ scheduled_at: '2999-01-01T00:00:00Z' }).label, 'Belum dikerjakan')
  const counts = P.progressCounts([{ id: 1 }, { id: 2, progress: 'dikerjakan' }, { id: 3, progress: 'ditunda' }, { id: 4 }], new Set(['4']))
  assert.deepEqual(counts, { belum: 1, dikerjakan: 1, ditunda: 1, selesai: 1 })
})

test('assign picker: only approved offers that are not assigned yet', async () => {
  const { assignableOffers } = await import('../src/stages/assign.js')
  const offers = [{ id: 1, status: 'approved' }, { id: 2, status: 'approved' }, { id: 3, status: 'rejected' }, { id: 4, status: 'draft' }]
  const flow = { offers, assignmentsOf: (id) => (id === 2 ? [{ id: 9 }] : []) }
  assert.deepEqual(assignableOffers(flow).map((o) => o.id), [1])
})

/* ------------------------------------------------------------ invoices */

test('invoice: line amounts, discount cap, PPN on the discounted base, rounding', () => {
  assert.equal(I.lineAmount({ qty: '2,5', unit_price: 10001 }), 25003)
  const items = [{ qty: 2, unit_price: 150000 }, { qty: 1, unit_price: 99999 }]
  assert.deepEqual(I.computeTotals(items, { discount: 0, tax_rate: 0 }), { subtotal: 399999, discount: 0, base: 399999, tax_rate: 0, tax_amount: 0, total: 399999 })
  const t = I.computeTotals(items, { discount: 49999, tax_rate: 11 })
  assert.equal(t.base, 350000)
  assert.equal(t.tax_amount, 38500)
  assert.equal(t.total, 388500)
  assert.equal(I.computeTotals(items, { discount: 10e6 }).discount, 399999, 'discount never exceeds the subtotal')
  assert.equal(I.computeTotals([{ qty: 1, unit_price: 3 }], { tax_rate: 11 }).tax_amount, 0) // 0.33 → 0
})

test('invoice: validation messages', () => {
  const ok = { customer_name: 'PT A', issue_date: '2026-11-04', due_date: '2026-11-18' }
  assert.deepEqual(I.invoiceProblems(ok, [{ description: 'Servis', qty: 1, unit_price: 100000 }]), [])
  assert.ok(I.invoiceProblems({ ...ok, customer_name: '' }, [{ description: 'x', qty: 1, unit_price: 1 }]).some((m) => /nama pelanggan/.test(m)))
  assert.ok(I.invoiceProblems({ ...ok, due_date: '2026-11-01' }, [{ description: 'x', qty: 1, unit_price: 1 }]).some((m) => /Jatuh tempo/.test(m)))
  assert.ok(I.invoiceProblems(ok, []).some((m) => /minimal satu/.test(m)))
  assert.ok(I.invoiceProblems(ok, [{ description: '', qty: 0, unit_price: -1 }]).length >= 3)
})

test('invoice: numbering and status transitions', () => {
  assert.equal(I.formatNumber(2026, 7), 'INV-2026-0007')
  assert.equal(I.nextSeqFrom(['INV-2026-0001', 'INV-2026-0009', 'INV-2025-0050', 'x'], 2026), 10)
  assert.equal(I.nextSeqFrom([], 2027), 1)
  assert.ok(I.canTransition('draft', 'terkirim') && I.canTransition('terkirim', 'lunas') && I.canTransition('batal', 'draft'))
  assert.ok(!I.canTransition('lunas', 'draft') && !I.canTransition('lunas', 'batal') && !I.canTransition('batal', 'lunas'))
  assert.ok(I.isEditable('draft') && I.isEditable('terkirim') && !I.isEditable('lunas'))
  assert.equal(I.addDays('2026-12-25', 14), '2027-01-08')
})

test('invoice: mark-paid links existing revenue or posts revenue without PPN', () => {
  const inv = { completion_id: 5, total: 111000, tax_amount: 11000 }
  assert.deepEqual(I.revenuePlan(inv, [{ id: 3, completion_id: 5, category: 'biaya_bahan' }]), { action: 'post', amount: 100000 })
  assert.deepEqual(I.revenuePlan(inv, [{ id: 4, completion_id: '5', category: 'pendapatan' }]), { action: 'link', ledgerId: 4 })
})

test('invoice: printable document escapes input and shows totals', () => {
  const html = invoiceHtml({ number: 'INV-2026-0001', customer_name: '<b>A&B</b>', issue_date: '2026-11-04', subtotal: 100000, discount: 0, tax_amount: 11000, tax_rate: 11, total: 111000, status: 'draft' },
    [{ description: 'Servis <script>', qty: 1, unit_price: 100000 }], { businessName: 'Usaha', demo: true })
  assert.ok(html.includes('&lt;b&gt;A&amp;B&lt;/b&gt;') && !html.includes('<script>'))
  assert.ok(html.includes('INV-2026-0001') && html.includes('PPN 11%') && html.includes('Rp 111.000') && /data fiktif/.test(html))
})

/* ------------------------------------------------------------ demo petugas */

test('demo petugas: every demo account has active petugas with fake phones and known skills', () => {
  assert.deepEqual(DEMO_KS, [1, 2, 3, 4, 5, 6, 7, 8, 9])
  const ids = new Set()
  for (const k of DEMO_KS) {
    const { workers, skills } = demoWorkerRows(k)
    assert.ok(workers.filter((w) => w.status === 'active').length >= 3, `account ${k} has active petugas`)
    const keys = new Set(skills.map((s) => s.key))
    for (const w of workers) {
      assert.equal(w.owner_id, demoOwnerId(k))
      assert.match(w.phone, /^0812-0000-\d{4}$/)
      assert.match(w.address, /\(contoh\)/)
      assert.ok(w.skills.every((s) => keys.has(s)), `${w.name} skills are in the account's list`)
      assert.ok(Number.isFinite(w.lat) && Number.isFinite(w.lng))
      assert.ok(!ids.has(w.id)); ids.add(w.id)
      assert.ok(w.id > k * 1_000_000 && w.id < (k + 1) * 1_000_000)
    }
  }
  assert.ok(demoWorkerRows(1).workers.some((w) => w.name === 'Budi Santoso'))
  const { sql, rows } = demoWorkersSql()
  assert.ok(rows > 50 && rows < 120, `small seed (${rows} rows)`)
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/)
  assert.match(sql, /INSERT OR IGNORE INTO worker_skills/)
})

/* ------------------------------------------------------------ Worker (SQLite) */

async function sqliteEnv(t) {
  const { DatabaseSync } = await import('node:sqlite').catch(() => ({}))
  if (!DatabaseSync) { t.skip('SQLite integration requires Node 22.13+'); return null }
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(await readFile(new URL(name, dir), 'utf8'))
  const reads = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)
  const prepare = (sql) => ({
    args: [],
    bind(...args) { this.args = args; return this },
    async first() { return sqlite.prepare(sql).get(...this.args) ?? null },
    async all() { return { results: sqlite.prepare(sql).all(...this.args) } },
    async run() {
      if (reads(sql)) return { results: sqlite.prepare(sql).all(...this.args), meta: {} }
      const r = sqlite.prepare(sql).run(...this.args)
      return { results: [], meta: { changes: Number(r.changes) } }
    },
  })
  const env = { DB: { prepare, async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out } }, DEMO_OTP: 'false' }
  for (const uid of ['alice', 'bob']) {
    sqlite.prepare('INSERT INTO users(id, email, name, created_at) VALUES (?, ?, ?, ?)').run(uid, `${uid}@example.com`, uid, '2026-11-01T00:00:00Z')
    sqlite.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(createHash('sha256').update(uid.repeat(8)).digest('hex'), uid, '2099-01-01T00:00:00Z')
  }
  return { env, sqlite }
}

function caller(worker, env) {
  return async (uid, method, path, body, expected = 200) => {
    const res = await worker.fetch(new Request(`https://satu-alur.apipedia.workers.dev${path}`, {
      method, headers: { authorization: `Bearer ${uid.repeat(8)}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env)
    const text = await res.text()
    assert.equal(res.status, expected, text)
    try { return JSON.parse(text) } catch { return text }
  }
}

test('worker: invoice numbers are per business and per year, without gaps', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  assert.equal((await call('alice', 'POST', '/api/invoices/next-number', { year: 2026 })).data.number, 'INV-2026-0001')
  assert.equal((await call('alice', 'POST', '/api/invoices/next-number', { year: 2026 })).data.number, 'INV-2026-0002')
  assert.equal((await call('bob', 'POST', '/api/invoices/next-number', { year: 2026 })).data.number, 'INV-2026-0001')
  assert.equal((await call('alice', 'POST', '/api/invoices/next-number', { year: 2027 })).data.number, 'INV-2027-0001')
})

test('worker: progress values, invoice rows, mark-paid revenue posted once, progress log', async (t) => {
  const ctx = await sqliteEnv(t)
  if (!ctx) return
  const { default: worker } = await import('../worker/index.js')
  const call = caller(worker, ctx.env)
  const db = (uid, body, expected) => call(uid, 'POST', '/api/db', body, expected)
  const req = (await db('alice', { table: 'requests', action: 'insert', values: { customer_name: 'PT A', service_type: 'Servis AC', status: 'new', email: 'halo@pta.id', website: 'pta.id · IG @pta' } })).data[0]
  assert.deepEqual([req.email, req.website], ['halo@pta.id', 'pta.id · IG @pta'], 'requests store email + website (migration 0021)')
  const off = (await db('alice', { table: 'offers', action: 'insert', values: { request_id: req.id, validated_price: 500000, validated_scope: 'Servis', status: 'approved' } })).data[0]
  const asg = (await db('alice', { table: 'assignments', action: 'insert', values: { offer_id: off.id, worker_name: 'Budi', scheduled_at: '2026-11-05T02:00:00Z', status: 'assigned' } })).data[0]
  assert.equal(asg.progress, 'belum', 'default progress')
  await db('alice', { table: 'assignments', action: 'update', changes: { progress: 'dikerjakan', progress_note: 'Mulai' }, filters: [{ col: 'id', op: 'eq', val: asg.id }] })
  await db('alice', { table: 'assignments', action: 'update', changes: { progress: 'kacau' }, filters: [{ col: 'id', op: 'eq', val: asg.id }] }, 400)
  await db('alice', { table: 'assignment_progress_log', action: 'insert', values: { assignment_id: asg.id, progress: 'dikerjakan', note: 'Mulai' } })
  await db('bob', { table: 'assignment_progress_log', action: 'insert', values: { assignment_id: asg.id, progress: 'ditunda' } }, 400) // not bob's assignment
  const comp = (await db('alice', { table: 'completions', action: 'insert', values: { assignment_id: asg.id, status: 'done', completed_at: '2026-11-05T05:00:00Z' } })).data[0]
  await db('alice', { table: 'completions', action: 'insert', values: { assignment_id: asg.id, status: 'done' } }, 409) // one completion per assignment

  const base = { completion_id: comp.id, request_id: req.id, number: 'INV-2026-0001', customer_name: 'PT A', issue_date: '2026-11-05', subtotal: 500000, tax_rate: 11, tax_amount: 55000, total: 555000, status: 'draft' }
  await db('alice', { table: 'invoices', action: 'insert', values: { ...base, tax_rate: 10 } }, 400)
  await db('alice', { table: 'invoices', action: 'insert', values: { ...base, status: 'dibayar' } }, 400)
  await db('alice', { table: 'invoices', action: 'insert', values: { ...base, number: 'NOTA-1' } }, 400)
  const inv = (await db('alice', { table: 'invoices', action: 'insert', values: base })).data[0]
  await db('alice', { table: 'invoices', action: 'insert', values: base }, 400) // duplicate number per business
  await db('alice', { table: 'invoice_items', action: 'insert', values: { invoice_id: inv.id, description: 'Servis', qty: 0, unit_price: 1 } }, 400)
  await db('alice', { table: 'invoice_items', action: 'insert', values: { invoice_id: inv.id, description: 'Servis AC', qty: 1, unit_price: 500000, amount: 500000 } })
  await db('bob', { table: 'invoice_items', action: 'insert', values: { invoice_id: inv.id, description: 'x', qty: 1, unit_price: 1 } }, 400) // bob can't attach to alice's invoice
  assert.equal((await db('bob', { table: 'invoices', action: 'select', columns: '*' })).data.length, 0, 'invoices are owner-scoped')

  // mark paid: revenue excluding PPN, once
  const plan = I.revenuePlan({ ...inv }, [])
  assert.deepEqual(plan, { action: 'post', amount: 500000 })
  const led = (await db('alice', { table: 'ledger_entries', action: 'insert', values: { completion_id: comp.id, amount: plan.amount, category: 'pendapatan', status: 'posted' } })).data[0]
  await db('alice', { table: 'ledger_entries', action: 'insert', values: { completion_id: comp.id, amount: 1, category: 'pendapatan', status: 'posted' } }, 409)
  const paid = (await db('alice', { table: 'invoices', action: 'update', changes: { status: 'lunas', paid_at: '2026-11-06T00:00:00Z', ledger_entry_id: led.id }, filters: [{ col: 'id', op: 'eq', val: inv.id }] })).data[0]
  assert.equal(paid.status, 'lunas')
  assert.ok(paid.updated_at, 'updated_at stamped by the Worker')
  const ledger = (await db('alice', { table: 'ledger_entries', action: 'select', columns: '*' })).data
  assert.deepEqual(I.revenuePlan(paid, ledger), { action: 'link', ledgerId: led.id }, 'a second "lunas" only links')
})

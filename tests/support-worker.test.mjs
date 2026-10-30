// Support handlers against a scripted fake D1: the guarded writes and how a lost race is answered.
// The real SQL (changes() inside one batch) is proven on wrangler; see the Task 4 report.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleSupportReply, handleAdminSupportReply, handleSupportCreate } from '../worker/customers.js'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// tickets: what successive `SELECT … FROM support_tickets t WHERE t.id = ?` reads return; changes: the batch's first statement.
function fakeEnv({ tickets = [], changes = 1 }) {
  const reads = [...tickets]
  const log = { batches: [] }
  const stmt = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this },
    async first() { return /FROM support_tickets t/.test(sql) ? reads.shift() ?? null : null },
    async all() { return { results: [] } },
  })
  const env = { DB: { prepare: stmt, async batch(s) { log.batches.push(s); return [{ meta: { changes, last_row_id: 7 } }, { meta: {} }] } } }
  return { env, log }
}
const deps = (user, body) => ({
  authenticate: async () => ({ user }), readJson: async () => body, ok: (x) => x, HttpError, DEMO_EMAILS: new Set(),
})
const owner = { id: 'ua', email: 'a@usaha.id', name: 'A' }
const staff = { id: 'us', email: 'budi@staff.satualur.internal', name: 'budi', is_staff: 1 }
const t = (status) => ({ id: 1, owner_id: 'ua', status })
const rejects = (p, status, message) => assert.rejects(p, (e) => e.status === status && e.message === message)

test('customer reply: UPDATE guarded by owner and the status read; message only when it applied', async () => {
  const { env, log } = fakeEnv({ tickets: [t('resolved'), t('open')] })
  await handleSupportReply({}, env, deps(owner, { body: 'halo' }), { id: '1' })
  const [upd, ins] = log.batches[0]
  assert.match(upd.sql, /WHERE id = \? AND owner_id = \? AND status = \?$/)
  assert.deepEqual(upd.args.slice(0, 1).concat(upd.args.slice(3)), ['open', 1, 'ua', 'resolved'])
  assert.match(ins.sql, /SELECT \?, \?, \?, \?, \? WHERE changes\(\) = 1$/)
})

test('customer reply that lost the race: closed now → 400, any other change → 409', async () => {
  await rejects(handleSupportReply({}, fakeEnv({ tickets: [t('resolved'), t('closed')], changes: 0 }).env, deps(owner, { body: 'x' }), { id: '1' }),
    400, 'Tiket sudah ditutup.')
  await rejects(handleSupportReply({}, fakeEnv({ tickets: [t('open'), t('in_progress')], changes: 0 }).env, deps(owner, { body: 'x' }), { id: '1' }),
    409, 'Tiket baru saja diperbarui. Muat ulang lalu coba lagi.')
})

test('staff reply: guarded by the status read (no owner filter); lost race → 409', async () => {
  const { env, log } = fakeEnv({ tickets: [t('open'), t('in_progress')] })
  await handleAdminSupportReply({}, env, deps(staff, { body: 'cek' }), { id: '1' })
  const [upd] = log.batches[0]
  assert.match(upd.sql, /WHERE id = \? AND status = \?$/)
  assert.deepEqual(upd.args.slice(-2), [1, 'open'])
  await rejects(handleAdminSupportReply({}, fakeEnv({ tickets: [t('open')], changes: 0 }).env, deps(staff, { body: 'cek' }), { id: '1' }),
    409, 'Tiket baru saja diperbarui. Muat ulang lalu coba lagi.')
})

test('create: the cap lives in the INSERT; no row inserted → 400', async () => {
  const { env, log } = fakeEnv({ tickets: [t('open')] })
  await handleSupportCreate({}, env, deps(owner, { category: 'akun', subject: 's', body: 'b' }))
  const [ins, msg] = log.batches[0]
  assert.match(ins.sql, /status != 'closed'\) < \?$/)
  assert.deepEqual(ins.args.slice(-2), ['ua', 20])
  assert.match(msg.sql, /WHERE changes\(\) = 1$/)
  await rejects(handleSupportCreate({}, fakeEnv({ changes: 0 }).env, deps(owner, { category: 'akun', subject: 's', body: 'b' })),
    400, 'Terlalu banyak tiket terbuka.')
})

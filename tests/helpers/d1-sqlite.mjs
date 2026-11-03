/**
 * A small D1 stand-in on node:sqlite (Node 22+): prepare/bind/first/all/run/batch over an
 * in-memory database with every migration applied, so Worker handlers run their real SQL.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export async function makeD1() {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind(...a) { return statement(sql, a.map(norm)) },
    async first() { return db.prepare(sql).get(...args) ?? null },
    async all() { return { results: db.prepare(sql).all(...args) } },
    async run() {
      if (/\bRETURNING\b/i.test(sql)) return { results: db.prepare(sql).all(...args), meta: {} }
      const r = db.prepare(sql).run(...args)
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    },
  })
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      db.exec('BEGIN')
      try {
        const out = []
        for (const s of stmts) out.push(await s.run())
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

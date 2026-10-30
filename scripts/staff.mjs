#!/usr/bin/env node
/**
 * Satu Alur: kelola akun staf Kantor Satu Alur (login di /super-admin-login).
 * Satu-satunya cara membuat/mengubah akun staf; tidak ada halaman web untuk ini.
 *
 *   npm run staff -- add <username>       buat akun (password diminta 2x, tidak tampil)
 *   npm run staff -- reset <username>     ganti password, buka kunci, cabut sesi staf yang aktif
 *   npm run staff -- disable <username>   nonaktifkan dan cabut sesi staf yang aktif
 *   npm run staff -- enable <username>    aktifkan kembali
 *   npm run staff -- list                 daftar akun
 *
 * Default memakai D1 lokal. Tambahkan --remote untuk database produksi. Opsi lain diteruskan
 * ke `wrangler d1 execute` (mis. --config x.toml --persist-to dir).
 * STAFF_PASSWORD=... melewati prompt (untuk otomasi/tes; hindari di shell interaktif).
 */
import { spawnSync } from 'node:child_process'
import { hashPassword, validateUsername, validatePassword } from '../src/staff/password.js'

const DB = 'satu-alur-db'
const [cmd, username, ...rest] = process.argv.slice(2)
const passthrough = cmd === 'list' ? [username, ...rest].filter(Boolean) : rest
const target = passthrough.includes('--remote') ? [] : ['--local']

function die(msg) { console.error(`✗ ${msg}`); process.exit(1) }

function d1(sql, { json = false } = {}) {
  const args = ['wrangler', 'd1', 'execute', DB, ...target, ...passthrough, '--command', sql, ...(json ? ['--json'] : [])]
  const r = spawnSync('npx', args, { encoding: 'utf8', stdio: json ? ['inherit', 'pipe', 'inherit'] : 'inherit' })
  if (r.status !== 0) die('Perintah wrangler gagal.')
  return json ? JSON.parse(r.stdout)[0]?.results ?? [] : null
}

function ask(prompt) {
  if (!process.stdin.isTTY) die('Butuh terminal interaktif untuk memasukkan password (atau set STAFF_PASSWORD).')
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    let value = ''
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData)
          process.stdout.write('\n'); return resolve(value)
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130) }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    process.stdin.on('data', onData)
  })
}

async function newPassword() {
  const fromEnv = process.env.STAFF_PASSWORD
  const pw = fromEnv ?? await ask('Password baru: ')
  const err = validatePassword(pw)
  if (err) die(err)
  if (fromEnv === undefined && (await ask('Ulangi password: ')) !== pw) die('Password tidak sama.')
  return hashPassword(pw)
}

// Sessions of this staff member (see worker/staff.js: user email = <username>@staff.satualur.internal).
const revokeSessions = (u) => `DELETE FROM sessions WHERE is_staff = 1 AND user_id IN (SELECT id FROM users WHERE email = '${u}@staff.satualur.internal');`

async function main() {
  if (cmd !== 'list') {
    const err = validateUsername(username)
    if (err) die(err)
  }
  // username is validated against /^[a-z0-9._-]{3,32}$/ and hashes are base64 + '$', so quoting below is safe.
  switch (cmd) {
    case 'add': {
      if (d1(`SELECT 1 FROM staff_accounts WHERE username = '${username}'`, { json: true }).length) die(`Akun "${username}" sudah ada. Pakai reset.`)
      d1(`INSERT INTO staff_accounts (username, password_hash) VALUES ('${username}', '${await newPassword()}');`)
      console.log(`✓ Akun staf "${username}" dibuat. Login di /super-admin-login.`)
      break
    }
    case 'reset': {
      if (!d1(`SELECT 1 FROM staff_accounts WHERE username = '${username}'`, { json: true }).length) die(`Akun "${username}" tidak ada.`)
      d1(`UPDATE staff_accounts SET password_hash = '${await newPassword()}', failed_attempts = 0, locked_until = NULL WHERE username = '${username}'; ${revokeSessions(username)}`)
      console.log(`✓ Password "${username}" diganti; sesi lamanya dicabut.`)
      break
    }
    case 'disable':
      d1(`UPDATE staff_accounts SET active = 0 WHERE username = '${username}'; ${revokeSessions(username)}`)
      console.log(`✓ "${username}" dinonaktifkan; sesinya dicabut.`)
      break
    case 'enable':
      d1(`UPDATE staff_accounts SET active = 1, failed_attempts = 0, locked_until = NULL WHERE username = '${username}';`)
      console.log(`✓ "${username}" aktif kembali.`)
      break
    case 'list': {
      const rows = d1('SELECT username, active, locked_until, last_login_at, created_at FROM staff_accounts ORDER BY username', { json: true })
      if (!rows.length) console.log('Belum ada akun staf.')
      else console.table(rows.map((r) => ({ username: r.username, aktif: r.active ? 'ya' : 'tidak', terkunci_sampai: r.locked_until || '-', login_terakhir: r.last_login_at || '-' })))
      break
    }
    default:
      die('Perintah: add | reset | disable | enable | list  (lihat komentar di scripts/staff.mjs)')
  }
}

main()

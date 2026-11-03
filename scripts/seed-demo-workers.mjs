#!/usr/bin/env node
// Writes seeds/demo-workers.sql: petugas + keahlian contoh untuk 9 akun demo (DATA FIKTIF).
// Usage: node scripts/seed-demo-workers.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { demoWorkersSql } from '../src/demo/demo-workers.js'

const { sql, rows } = demoWorkersSql()
const head = [
  '-- =====================================================================',
  '-- Satu Alur: PETUGAS CONTOH untuk 9 akun demo (DATA FIKTIF).',
  '-- Dibuat oleh scripts/seed-demo-workers.mjs dari src/demo/demo-workers.js.',
  `-- ${rows} baris. Aman dijalankan ulang: petugas di-upsert per id, keahlian hanya ditambah bila belum ada.`,
  '-- Butuh migrasi 0003_workers dan 0017_worker_skills.',
  '-- =====================================================================',
  '',
].join('\n')
const out = fileURLToPath(new URL('../seeds/demo-workers.sql', import.meta.url))
writeFileSync(out, `${head}${sql}\n`)
console.log(`seeds/demo-workers.sql: ${rows} baris`)

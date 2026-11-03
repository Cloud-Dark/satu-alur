-- Keahlian petugas per bisnis (Penugasan › Tim). workers.skills tetap berisi
-- array kunci keahlian; tabel ini memberi nama tampilan yang bisa diubah.
-- Daftar bawaan dibuat saat bisnis pertama kali membuka daftarnya (lazy),
-- jadi migrasi ini tidak menulis baris apa pun.
CREATE TABLE IF NOT EXISTS worker_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_id, key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_skills_owner_name ON worker_skills(owner_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  skills TEXT,            -- JSON array of skill keys, e.g. ["ac","cleaning"]
  lat REAL,               -- diisi oleh geocode(); boleh NULL
  lng REAL,
  zone TEXT,              -- diisi oleh geocode(); boleh NULL
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'inactive'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workers_owner_id ON workers(owner_id);

-- Satu penugasan, banyak petugas.
CREATE TABLE IF NOT EXISTS assignment_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (assignment_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_workers_owner_id ON assignment_workers(owner_id);
CREATE INDEX IF NOT EXISTS idx_assignment_workers_assignment_id ON assignment_workers(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_workers_worker_id ON assignment_workers(worker_id);

ALTER TABLE requests ADD COLUMN requested_at TEXT;   -- jadwal yang diminta klien (ISO)

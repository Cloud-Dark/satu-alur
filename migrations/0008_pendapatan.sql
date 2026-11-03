-- Pendapatan: Layanan Tambahan (VAS) catalog + Tanpa Limbah findings.
--
-- Both tables are user-scoped (owner_id) and reachable only through /api/db,
-- which always filters by the authenticated owner. The CHECK constraints mirror
-- src/pendapatan/rules.js: the form, the Worker and the schema agree, so a row
-- the UI accepts can never be rejected by the database for a different reason.

CREATE TABLE IF NOT EXISTS vas_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'lain'
    CHECK (category IN ('perawatan', 'perlindungan', 'peningkatan', 'kecepatan', 'paket', 'lain')),
  -- Whole Rupiah. Upper bound catches typos (Rp1 miliar per add-on is already absurd).
  price INTEGER NOT NULL CHECK (price > 0 AND price <= 1000000000),
  cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0 AND cost <= 1000000000),
  -- Service type this add-on is offered with; NULL = every service.
  attach_to TEXT,
  -- Whole percent 0..100 (25 = one in four jobs takes it).
  attach_rate INTEGER NOT NULL DEFAULT 25 CHECK (attach_rate >= 0 AND attach_rate <= 100),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One index: every query is "my rows, newest first".
CREATE INDEX IF NOT EXISTS idx_vas_items_owner ON vas_items(owner_id, created_at);

CREATE TABLE IF NOT EXISTS waste_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT 'waktu'
    CHECK (stream IN ('waktu', 'perjalanan', 'bahan', 'pengerjaan_ulang', 'air_kimia')),
  title TEXT NOT NULL,
  detail TEXT,
  -- Rupiah lost per month when the finding was recorded.
  monthly_loss INTEGER NOT NULL CHECK (monthly_loss > 0 AND monthly_loss <= 1000000000),
  -- Rupiah per month already eliminated; never more than the recorded loss,
  -- which is what keeps "100% bebas limbah" meaningful.
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved >= 0),
  action TEXT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'progress', 'done')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (saved <= monthly_loss),
  CHECK (status != 'done' OR saved = monthly_loss)
);
CREATE INDEX IF NOT EXISTS idx_waste_entries_owner ON waste_entries(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_waste_entries_stream ON waste_entries(owner_id, stream);

-- Which add-on a revenue posting came from, so "Porsi VAS" is measured, not guessed.
-- NULL = plain service revenue. Existing rows stay NULL.
ALTER TABLE ledger_entries ADD COLUMN vas_item_id INTEGER;

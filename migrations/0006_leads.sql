-- Pencari prospek (B2B lead finder): leads the user explicitly saved from a
-- search. Search results themselves are never stored (only on "Simpan prospek").
-- One index only (owner_id): every extra index costs a row write on D1 free tier.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'osm', -- osm | google | demo
  source_id TEXT,                     -- e.g. node/123456 (OSM) or a Places id
  name TEXT NOT NULL,
  category TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  lat REAL,
  lon REAL,
  distance_km REAL,
  score INTEGER,
  est_value INTEGER,                  -- expected value (Rp) = avg job value x conversion
  status TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'dihubungi', 'penawaran', 'ditolak')),
  notes TEXT,
  meta_json TEXT,                     -- relevance, reason, suggested service, potential, request/offer ids
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_owner_id ON leads(owner_id);

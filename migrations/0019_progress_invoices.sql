-- Progres penugasan + invoice.
-- Tidak ada backfill: progres efektif penugasan lama dihitung dari status/penyelesaian
-- (src/domain/progress.js), jadi migrasi ini hanya menulis skema.

-- Progres penugasan: belum | dikerjakan | ditunda | selesai.
ALTER TABLE assignments ADD COLUMN progress TEXT NOT NULL DEFAULT 'belum';
ALTER TABLE assignments ADD COLUMN progress_note TEXT;
ALTER TABLE assignments ADD COLUMN progress_updated_at TEXT;

-- Riwayat perubahan progres (satu baris per perubahan).
CREATE TABLE IF NOT EXISTS assignment_progress_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  progress TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_assignment_progress_log_owner ON assignment_progress_log(owner_id, assignment_id);

-- Invoice per pekerjaan selesai. Nilai uang dalam rupiah bulat.
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  completion_id INTEGER NOT NULL REFERENCES completions(id),
  request_id INTEGER REFERENCES requests(id),
  number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  customer_address TEXT,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  discount NUMERIC NOT NULL DEFAULT 0,
  tax_rate NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  payment_info TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | terkirim | lunas | batal
  sent_at TEXT,
  paid_at TEXT,
  ledger_entry_id INTEGER REFERENCES ledger_entries(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  UNIQUE (owner_id, number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_owner_invoice ON invoice_items(owner_id, invoice_id);

-- Nomor urut invoice per bisnis per tahun (INV-2026-0001), dinaikkan secara atomik di Worker.
CREATE TABLE IF NOT EXISTS invoice_seq (
  owner_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, year)
);

-- Pengaturan invoice per bisnis: instruksi pembayaran (rekening) dan tempo bawaan.
CREATE TABLE IF NOT EXISTS invoice_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL UNIQUE,
  payment_info TEXT,
  due_days INTEGER NOT NULL DEFAULT 14,
  updated_at TEXT
);

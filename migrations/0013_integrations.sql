-- Per-business integrations: each business connects its own WAPilot, WAConsole and Repliz accounts.
-- No backfill: every table starts empty. None of them is in the /api/db TABLES whitelist;
-- worker/integrations.js, worker/whatsapp.js and worker/repliz.js are the only readers and writers.

-- Credentials of one business for one provider. secret_enc = AES-GCM (TOKEN_KEY) of a JSON object with the
-- secret fields; it never leaves the Worker. hint = last 4 characters, the only part ever shown back.
-- meta_json holds the non-secret settings (base_url, device_id).
CREATE TABLE IF NOT EXISTS integration_credentials (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,            -- wapilot | waconsole | repliz (src/integrations/rules.js)
  secret_enc TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  meta_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT,                  -- last successful read-only check, NULL when it could not be checked
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, provider)
) WITHOUT ROWID;

-- Per-business settings, one row per business; more columns can be added later.
-- wa_provider NULL = the first WhatsApp provider the business has connected.
CREATE TABLE IF NOT EXISTS business_settings (
  owner_id TEXT PRIMARY KEY,
  wa_provider TEXT,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- One row per WhatsApp message (sent, simulated for demo accounts, or failed). The number is not stored:
-- phone_masked is for display. Write cost per message: this row + 1 usage_counters row (daily cap).
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  request_id INTEGER,
  provider TEXT NOT NULL,      -- wapilot | waconsole
  kind TEXT NOT NULL,          -- offer | followup | custom | test
  phone_masked TEXT NOT NULL,
  status TEXT NOT NULL,        -- sent | simulated | failed
  error TEXT,
  created_at TEXT NOT NULL
);

-- What Satu Alur posted through the business's Repliz workspace (history and status in Laporan tayang).
-- status mirrors Repliz: pending | process | success | error.
CREATE TABLE IF NOT EXISTS repliz_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  preview TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  post_id TEXT,
  error TEXT,
  scheduled_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, schedule_id)
);
CREATE INDEX IF NOT EXISTS idx_repliz_posts_owner ON repliz_posts(owner_id, scheduled_at);

-- Meta publishing (Facebook Page + linked Instagram) and Satu Alur office requests.

-- One connected Page per business. Never exposed through /api/db (not in TABLES).
-- page_token_enc = AES-GCM output of encryptToken (TOKEN_KEY secret).
CREATE TABLE IF NOT EXISTS social_accounts (
  owner_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  page_name TEXT,
  page_token_enc TEXT NOT NULL,
  ig_user_id TEXT,
  ig_username TEXT,
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE social_contents ADD COLUMN image_key TEXT;

-- Status: scheduled | publishing | posted | failed | cancelled
ALTER TABLE social_schedules ADD COLUMN content_id INTEGER;
ALTER TABLE social_schedules ADD COLUMN image_key TEXT;
ALTER TABLE social_schedules ADD COLUMN page_id TEXT;
ALTER TABLE social_schedules ADD COLUMN platform_post_id TEXT;
ALTER TABLE social_schedules ADD COLUMN permalink TEXT;
ALTER TABLE social_schedules ADD COLUMN error TEXT;
ALTER TABLE social_schedules ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_schedules ADD COLUMN published_at TEXT;
ALTER TABLE social_schedules ADD COLUMN claimed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_social_schedules_due ON social_schedules(status, scheduled_at);

-- Global influencer catalogue, written by the office (admins) only.
CREATE TABLE IF NOT EXISTS influencers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  photo_key TEXT,
  niche TEXT,
  city TEXT,
  ig_followers INTEGER,
  tiktok_followers INTEGER,
  bio TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS service_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('collab', 'ads')),
  influencer_id INTEGER,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_service_requests_owner_id ON service_requests(owner_id);

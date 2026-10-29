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

-- Pending multi-Page choice after the OAuth callback (10 min, one-shot). Never in TABLES.
-- blob = AES-GCM output of encryptToken over the Page list (Page tokens included).
CREATE TABLE IF NOT EXISTS social_oauth_picks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  blob TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

ALTER TABLE social_contents ADD COLUMN image_key TEXT;

-- 1 = created by POST /api/auth/staff-login; only these sessions can open Kantor Satu Alur.
ALTER TABLE sessions ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0;

-- Satu Alur staff (username + password). Managed only with `npm run staff` (scripts/staff.mjs). Never in TABLES.
-- password_hash: pbkdf2-sha256$<iterations>$<salt>$<hash> (src/staff/password.js).
CREATE TABLE IF NOT EXISTS staff_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One row per platform per publish/schedule. Kept apart from social_schedules,
-- which the "Media sosial" stage uses as free-form notes (the cron must never see those).
-- Status: scheduled | publishing | posted | failed | cancelled
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  content_id INTEGER,
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  image_key TEXT,
  page_id TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  platform_post_id TEXT,
  permalink TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_posts_owner_id ON social_posts(owner_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON social_posts(status, scheduled_at);

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
  -- Staff-only: never selected by the public catalogue route.
  handle_ig TEXT,
  handle_tiktok TEXT,
  handle_youtube TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  rates_json TEXT,
  internal_notes TEXT,
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

CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  price_idr INTEGER,
  period TEXT NOT NULL DEFAULT 'month',
  period_label TEXT NOT NULL DEFAULT '',
  recommended INTEGER NOT NULL DEFAULT 0,
  badge TEXT NOT NULL DEFAULT '',
  limits_json TEXT NOT NULL DEFAULT '[]',
  features_json TEXT NOT NULL DEFAULT '[]',
  cta_label TEXT NOT NULL DEFAULT '',
  cta_kind TEXT NOT NULL DEFAULT 'signup',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Single row (id = 1). Secrets are AES-GCM ciphertext (TOKEN_KEY); never in TABLES, never returned.
CREATE TABLE IF NOT EXISTS payment_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL DEFAULT 'none',
  mode TEXT NOT NULL DEFAULT 'sandbox',
  client_key TEXT NOT NULL DEFAULT '',
  server_key_enc TEXT,
  server_key_last4 TEXT NOT NULL DEFAULT '',
  webhook_token_enc TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- One row per business account (users.id): plan, status and staff notes. Staff-only; never in TABLES.
-- status: trial | active | past_due | cancelled. period_end: YYYY-MM-DD or NULL.
CREATE TABLE IF NOT EXISTS customer_accounts (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'trial',
  period_end TEXT,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Public Contact Us messages (POST /api/contact, no auth). Staff-only reads; never in TABLES.
-- ip_hash = SHA-256(IP + salt): used only to rate-limit, never returned to any client.
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'archived')),
  staff_note TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_ip ON contact_messages(ip_hash, created_at);
-- The global cap (200 per hour, all senders) counts by created_at alone.
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at);

-- Staff flags per user (Pengguna). suspended = 1 blocks every session and login (authenticate, OTP, demo).
-- Staff-only; never in TABLES. Staff users (@staff.satualur.internal) are never flagged.
CREATE TABLE IF NOT EXISTS user_flags (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Support tickets (Bantuan / Pengaduan CS). Customer routes always filter by owner_id; staff read all.
-- Never in TABLES. last_reply_by drives the staff badge (open/in_progress tickets waiting on staff).
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('teknis', 'tagihan', 'akun', 'lainnya')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_reply_by TEXT NOT NULL CHECK (last_reply_by IN ('customer', 'staff'))
);
CREATE INDEX IF NOT EXISTS idx_support_owner ON support_tickets(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status, updated_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('customer', 'staff')),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

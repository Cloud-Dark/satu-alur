-- Admin & system settings: platform settings editable by admins, per-business
-- email/AI integrations (secrets AES-GCM encrypted with TOKEN_KEY), an email
-- log, Google sign-in hand-off, and the user's last login time.
-- (0013 is reserved for the WhatsApp/social connector branch.)

-- Non-secret platform settings, one JSON value per key ('email', 'ai', 'login').
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Per-business integrations. email_mode: platform | smtp. ai_mode: builtin | openai | anthropic.
CREATE TABLE IF NOT EXISTS business_integrations (
  owner_id TEXT PRIMARY KEY,
  email_mode TEXT NOT NULL DEFAULT 'platform' CHECK (email_mode IN ('platform', 'smtp')),
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure TEXT CHECK (smtp_secure IS NULL OR smtp_secure IN ('tls', 'starttls')),
  smtp_user TEXT,
  smtp_pass_enc TEXT,
  smtp_from_name TEXT,
  smtp_from_email TEXT,
  ai_mode TEXT NOT NULL DEFAULT 'builtin' CHECK (ai_mode IN ('builtin', 'openai', 'anthropic')),
  ai_base_url TEXT,
  ai_model TEXT,
  ai_key_enc TEXT,
  updated_at TEXT NOT NULL
);

-- Every email the platform sends (OTP, offers, tests, reports). No index beyond the
-- primary key: the admin log reads the newest rows, and caps count a small window.
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

-- Google sign-in: one row per started login (state + PKCE verifier), then a
-- one-time hand-off code the SPA exchanges for a session. Both expire in minutes.
CREATE TABLE IF NOT EXISTS oauth_logins (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('state', 'handoff')),
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Admins chosen in Kantor › Sistem › Akses admin (email logins). ADMIN_EMAILS in the Worker env
-- stays an always-allowed bootstrap list, so nobody can lock the platform out.
CREATE TABLE IF NOT EXISTS admin_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);
INSERT OR IGNORE INTO admin_users (email, role, added_by, added_at)
VALUES ('apipedia22@gmail.com', 'admin', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Audit trail of admin actions (access changes, system settings, user tier changes).
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN last_login_at TEXT;

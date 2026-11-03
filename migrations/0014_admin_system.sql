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

ALTER TABLE users ADD COLUMN last_login_at TEXT;

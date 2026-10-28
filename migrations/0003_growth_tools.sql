-- Growth tools: social media workspace and the AI business adviser.
CREATE TABLE IF NOT EXISTS social_contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'content', -- content | brainstorm | ads | partnership
  platform TEXT,
  title TEXT,
  body TEXT NOT NULL,
  meta_json TEXT,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_contents_owner_id ON social_contents(owner_id);

CREATE TABLE IF NOT EXISTS social_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  post_type TEXT,
  content TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | posted | cancelled
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_social_schedules_owner_id ON social_schedules(owner_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  role TEXT NOT NULL, -- user | assistant
  content TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_owner_agent ON ai_messages(owner_id, agent);

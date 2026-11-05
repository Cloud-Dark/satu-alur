-- Akses AI (MCP): per-account access tokens for the remote MCP server at /mcp (worker/mcp-server.js).
--
-- Not to be confused with the mcp_* ERP connector tables of 0009_mcp.sql. These rows are never in the
-- /api/db whitelist; they are reachable only through /api/mcp-tokens (session auth, owner-scoped).
-- The token itself ("sa_mcp_" + 32 random bytes, base64url) is shown once at creation and only its
-- SHA-256 (hex) is stored. `prefix` is the first characters, kept for display ("sa_mcp_AbCd…").
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_owner ON mcp_tokens(owner_id, created_at);

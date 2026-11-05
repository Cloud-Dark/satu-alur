-- Akses AI (MCP) by login: OAuth 2.1 + PKCE for the remote MCP server (worker/oauth.js).
-- The Worker is both the authorization server (/oauth/*, /.well-known/*) and the resource server (/mcp).
--
-- Flow: a client (claude.ai, Claude Desktop, Claude Code) registers itself (oauth_clients, RFC 7591),
-- sends the owner to /oauth/authorize (parameters parked in oauth_requests, ~10 min), the owner signs
-- in and approves on #/izin-ai (oauth_grants = one connected app, oauth_codes = single-use code,
-- ~5 min), then the client exchanges the code at /oauth/token for an access token (a row in
-- mcp_tokens with kind 'oauth', 1 hour) and a rotating refresh token (oauth_refresh_tokens).
-- Only SHA-256 hashes of codes, request ids and tokens are stored. None of these tables is in the
-- /api/db whitelist.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL DEFAULT '',
  redirect_uris TEXT NOT NULL,                 -- JSON array of exact redirect URIs
  client_uri TEXT,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  secret_hash TEXT,                            -- only for client_secret_post / client_secret_basic
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_requests (
  id_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  state TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_expires ON oauth_requests(expires_at);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  client_name TEXT NOT NULL DEFAULT '',
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_owner ON oauth_grants(owner_id, revoked_at);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id INTEGER NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id INTEGER NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at TEXT                                 -- set on rotation; presenting it again revokes the grant
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_grant ON oauth_refresh_tokens(grant_id);

-- Access tokens live next to the manual tokens so /mcp has one lookup. Manual tokens keep
-- kind 'manual', no grant and no expiry; the Pengaturan list and the 10-token cap only count them.
ALTER TABLE mcp_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE mcp_tokens ADD COLUMN grant_id INTEGER REFERENCES oauth_grants(id) ON DELETE CASCADE;
ALTER TABLE mcp_tokens ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_grant ON mcp_tokens(grant_id);

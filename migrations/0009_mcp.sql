-- MCP (Model Context Protocol): connectors, mappings, sync logs, dead letter
-- queue, and migrations.
--
-- These tables are NOT in the /api/db whitelist. They are reachable only
-- through the dedicated /api/mcp/* endpoints in worker/mcp.js, because
-- connector rows hold credentials: a generic table endpoint would let a client
-- read or rewrite them. The CHECK constraints mirror src/mcp/rules.js so the
-- form, the Worker and the schema agree.

-- ---------------------------------------------------------------- Connectors

CREATE TABLE IF NOT EXISTS mcp_connectors (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rest', 'database', 'file', 'webhook')),
  -- Non-secret configuration (endpoint, auth type, driver, host, format...).
  config_json TEXT NOT NULL DEFAULT '{}',
  -- Secrets require AES-GCM with MCP_ENCRYPTION_KEY; no plaintext fallback.
  -- NULL means "no credentials stored" (file connectors).
  secrets_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'error')),
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_connectors_owner ON mcp_connectors(owner_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connectors_owner_name ON mcp_connectors(owner_id, name);

-- ------------------------------------------------------------------ Mappings

CREATE TABLE IF NOT EXISTS mcp_mappings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  fields_json TEXT NOT NULL DEFAULT '[]',
  filters_json TEXT,
  external_id_field TEXT,
  mode TEXT NOT NULL DEFAULT 'upsert' CHECK (mode IN ('insert', 'upsert')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (connector_id) REFERENCES mcp_connectors(id) ON DELETE CASCADE
);
-- One mapping per entity per connector: a second one would be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_mappings_unique ON mcp_mappings(connector_id, entity);
CREATE INDEX IF NOT EXISTS idx_mcp_mappings_owner ON mcp_mappings(owner_id, connector_id);

-- ---------------------------------------------------------------- Sync logs

CREATE TABLE IF NOT EXISTS mcp_sync_logs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled', 'webhook', 'migration')),
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  -- { processed, inserted, updated, skipped, failed } plus per-entity detail.
  stats_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (connector_id) REFERENCES mcp_connectors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mcp_sync_logs_owner ON mcp_sync_logs(owner_id, started_at);
CREATE INDEX IF NOT EXISTS idx_mcp_sync_logs_connector ON mcp_sync_logs(connector_id, started_at);

-- ------------------------------------------------------- Dead letter queue

CREATE TABLE IF NOT EXISTS mcp_sync_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  -- The raw source row, so an admin can fix the mapping and replay it.
  source_data TEXT,
  error_message TEXT NOT NULL,
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_sync_errors_open ON mcp_sync_errors(owner_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_sync_errors_sync ON mcp_sync_errors(sync_id);

-- ------------------------------------------------- External id references

-- Maps (connector, entity, external_id) to the local row, so a re-run updates
-- instead of duplicating. This is what makes sync idempotent without adding an
-- external_id column to every domain table.
CREATE TABLE IF NOT EXISTS mcp_external_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  external_id TEXT NOT NULL,
  local_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_external_refs_unique
  ON mcp_external_refs(connector_id, entity, external_id);
CREATE INDEX IF NOT EXISTS idx_mcp_external_refs_local
  ON mcp_external_refs(owner_id, entity, local_id);

-- -------------------------------------------------------------- Migrations

CREATE TABLE IF NOT EXISTS mcp_migrations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connector_id TEXT,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'parallel'
    CHECK (strategy IN ('parallel', 'phased', 'bigbang')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'completed', 'completed_with_errors', 'failed', 'rolled_back')),
  -- Array of phase objects: { key, name, entities, status, records..., errors }.
  phases_json TEXT NOT NULL DEFAULT '[]',
  -- { processed, inserted, updated, skipped, failed }.
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  ended_at TEXT,
  rolled_back_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_migrations_owner ON mcp_migrations(owner_id, created_at);

-- Record only rows inserted by each migration, including insert-only mappings.
-- WITHOUT ROWID keeps last_insert_rowid() on the domain row within a D1 batch.
CREATE TABLE mcp_migration_rows (
  migration_id TEXT NOT NULL REFERENCES mcp_migrations(id),
  owner_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  local_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (migration_id, entity, local_id)
) WITHOUT ROWID;

-- Serialize phase execution and rollback for the same migration.
ALTER TABLE mcp_migrations ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));

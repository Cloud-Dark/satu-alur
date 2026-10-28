-- Radar peluang: what the user did with a detected opportunity.
-- opp_key is deterministic per opportunity (see src/ai/radar-engine.js), so a
-- state survives reloads and a new purchase produces a new key (new card).
CREATE TABLE IF NOT EXISTS opportunity_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  opp_key TEXT NOT NULL,
  status TEXT NOT NULL, -- done | snoozed | dismissed
  until TEXT,           -- snoozed: ISO date the card comes back
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_opportunity_states_owner_id ON opportunity_states(owner_id);

-- AI quotas, AI credit and vouchers (src/quota/rules.js holds the numbers).
-- Write cost per AI call: 1 row (usage_counters, WITHOUT ROWID, primary key only). Paid from credit: +2
-- (ai_credits balance + ai_credit_entries). None of these tables is in the /api/db TABLES whitelist.

-- Machine-readable monthly quota per feature: { "offer": 10, "advisor": 5, "report": null (unlimited), ... }.
-- limits_json stays the display text on the pricing cards.
ALTER TABLE subscription_plans ADD COLUMN quota_json TEXT NOT NULL DEFAULT '{}';

-- period = 'YYYY-MM' in Jakarta time; a new month simply starts new rows.
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, feature, period)
) WITHOUT ROWID;

-- Current AI credit balance in rupiah (one row per user that ever had credit).
CREATE TABLE IF NOT EXISTS ai_credits (
  user_id TEXT PRIMARY KEY,
  balance_idr INTEGER NOT NULL DEFAULT 0 CHECK (balance_idr >= 0),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- Audit trail of credit changes: + voucher/staff grants, - spends (reason = feature key), + refunds.
-- No index: read only by staff for one user, and the table stays small.
CREATE TABLE IF NOT EXISTS ai_credit_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  amount_idr INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- type: plan | credit | bundle. expires_on: 'YYYY-MM-DD' (last valid day, Jakarta time) or NULL.
-- max_redemptions NULL = unlimited.
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  plan_id INTEGER REFERENCES subscription_plans(id),
  plan_days INTEGER,
  credit_idr INTEGER NOT NULL DEFAULT 0,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- One redemption per user per voucher (the primary key enforces it).
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (voucher_id, user_id)
) WITHOUT ROWID;

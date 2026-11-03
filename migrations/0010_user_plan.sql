-- Subscription tier per user.
--
-- Lives on user_flags because that table already holds the per-user attributes
-- the Worker reads during authenticate (suspended, is_staff via sessions). Enum
-- values are enforced in src/business/plan-access.js, following the same
-- convention as the rest of the domain enums (no CHECK constraint).
--
-- Default is 'sole': a new sign-up does not get the Enterprise feature set
-- without an explicit change. Demo accounts are aligned to their seeded scale
-- on demo login (worker/index.js), so the enterprise demo accounts keep access
-- to ERP integration.

ALTER TABLE user_flags ADD COLUMN plan TEXT NOT NULL DEFAULT 'sole';

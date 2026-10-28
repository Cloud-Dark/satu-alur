-- The Worker only filters by owner_id (and id); joins between stages happen in
-- the client. These foreign-key indexes were never used by a query but cost an
-- extra row write on every insert (D1 bills index writes as row writes).
DROP INDEX IF EXISTS idx_offers_request_id;
DROP INDEX IF EXISTS idx_assignments_offer_id;
DROP INDEX IF EXISTS idx_completions_assignment_id;
DROP INDEX IF EXISTS idx_ledger_entries_completion_id;

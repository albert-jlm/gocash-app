-- ===========================================================================
-- Schema and table privileges, stated in a migration for the first time.
--
-- The baseline was dumped with --no-privileges, and the live database got its
-- grants by hand. So a database built from these migrations alone had no
-- USAGE on the schema and no table grants beyond SELECT on the ledger tables:
-- every request from the app would have been "permission denied for schema
-- gocash". The test suite could not see it because it runs as a superuser.
--
-- The rule this sets:
--
--   service_role   everything. The Edge Functions use it, after resolving the
--                  operator from the verified JWT. (The ledger's append-only
--                  triggers still apply to it.)
--   authenticated  READ its own rows, through RLS. The only write is two
--                  columns of its own operators row. Every money-moving write
--                  goes through an Edge Function.
--   anon           nothing.
--
-- Not granting INSERT/UPDATE on transactions to the browser role is the
-- point: with it, a client could set status = 'confirmed' on a row directly,
-- or change the amount of a posted transaction, with no ledger entry.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

-- Start from nothing, so this file is the whole answer whatever was there.
REVOKE ALL ON ALL TABLES    IN SCHEMA gocash FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gocash FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA gocash FROM PUBLIC, anon;

GRANT USAGE ON SCHEMA gocash TO authenticated, service_role;

-- ----- service_role -----
GRANT ALL ON ALL TABLES    IN SCHEMA gocash TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA gocash TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA gocash GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA gocash GRANT ALL ON SEQUENCES TO service_role;

-- ----- authenticated: read -----
GRANT SELECT ON
  gocash.operators,
  gocash.transactions,
  gocash.accounts,
  gocash.ledger_entries,
  gocash.postings,
  gocash.fee_rules,
  gocash.account_balances,
  gocash.unbalanced_entries
TO authenticated;

-- ----- authenticated: the one write -----
-- Notification settings. Column-level, so subscription_tier, is_active,
-- user_id and email cannot be changed from the browser even though the RLS
-- policy lets an operator update their own row.
GRANT UPDATE (telegram_chat_id, settings) ON gocash.operators TO authenticated;

-- audit_logs, receipt_deletion_queue and operator_platforms get no browser
-- access at all: nothing in the app reads them.

COMMIT;

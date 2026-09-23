-- ===========================================================================
-- Close the anon RPC hole.  (Audit #5a, finding 1 — CRITICAL)
--
-- THE PROBLEM
-- Postgres grants EXECUTE to PUBLIC on every CREATE FUNCTION by default, and
-- `gocash` is listed in PGRST_DB_SCHEMAS. So every SECURITY DEFINER function
-- in this schema was callable over PostgREST with nothing but the anon key —
-- the key that ships in the public JS bundle. None of them check auth.uid();
-- all take p_operator_id as a caller-supplied parameter.
--
-- Verified live before this migration, with the anon key and no session:
--   POST /rest/v1/rpc/update_wallet_balance
--   -> 400 {"code":"P0001","message":"Wallet not found: __probe__ (operator 000...000)"}
-- The function body executed. Only a random UUID stopped it. With a real
-- operator_id and a guessable wallet name, an unauthenticated caller could
-- move any balance by any amount.
--
-- THE FIX
-- These functions are internal: they are called by the Edge Functions using
-- the service-role key. Nothing in src/ calls .rpc() (grepped, zero call
-- sites), so revoking from everyone except service_role loses no behaviour.
--
-- This is written as a loop over pg_proc rather than a hand-typed list of
-- signatures on purpose. A checklist only revokes what someone remembered;
-- this covers every function in the schema, including the two
-- delete_transaction_atomic overloads that are easy to miss, and it stays
-- correct if a signature changes.
--
-- !! APPLY AS supabase_admin, NOT postgres !!
--   docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < this_file
--
-- These functions are owned by supabase_admin and the offending grants were
-- made by supabase_admin. On this instance `postgres` is neither a superuser
-- nor a member of supabase_admin, so running this as postgres produces
-- "WARNING: no privileges could be revoked" for every function and changes
-- nothing. The assertion at the bottom turns that silent no-op into a hard
-- failure — which is exactly how this was caught. If you wire these
-- migrations into the Supabase CLI, check which role it connects as.
-- ===========================================================================

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'gocash'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    RAISE NOTICE 'revoked PUBLIC/anon/authenticated EXECUTE on %', fn.sig;
  END LOOP;
END;
$$;

-- Make the default apply to anything created here later, so the next function
-- someone adds does not silently reopen this.
ALTER DEFAULT PRIVILEGES IN SCHEMA gocash REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Assert the hole is closed. This migration fails rather than half-applying.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  leaked TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO leaked
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'gocash'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon/authenticated can still execute: %', leaked;
  END IF;
END;
$$;

-- Confirm the Edge Functions did not lose access along the way.
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'gocash'
    AND p.prokind = 'f'
    AND p.pronargs > 0                    -- trigger functions take no args
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on: % — Edge Functions would break', missing;
  END IF;
END;
$$;

-- ===========================================================================
-- Stop new functions in `gocash` from being world-executable.
--
-- WHY THE OBVIOUS FIX DOES NOT WORK
-- 20260923000001 revoked EXECUTE on the nine functions that existed and added
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA gocash REVOKE EXECUTE ON FUNCTIONS FROM
-- PUBLIC`, on the assumption that this protects functions added later.
--
-- It does not. Tested on this exact Postgres (15.8), three ways:
--
--   1. On a fresh schema, a lone REVOKE on default privileges persists no
--      pg_default_acl row at all, and new functions come out with
--      proacl = NULL — the stock default, which is EXECUTE TO PUBLIC.
--
--   2. Where a row does exist, a newly created function still comes out with a
--      leading `=X/supabase_admin` ACL entry. That empty grantee IS PUBLIC.
--      ALTER DEFAULT PRIVILEGES cannot remove Postgres's built-in PUBLIC
--      EXECUTE on functions.
--
--   3. Reproducing the live default ACL exactly
--      (`authenticated=X | service_role=X`, no PUBLIC entry) and then creating
--      a function still yields anon = true, authenticated = true.
--
-- And since PUBLIC contains both anon and authenticated, tuning those two
-- entries in the default ACL changes nothing on its own. The check in the
-- previous version of this migration inspected pg_default_acl and therefore
-- PASSED while protecting nothing — an assertion that tests the mechanism
-- instead of the outcome.
--
-- WHAT ACTUALLY WORKS
-- An event trigger that revokes the grant immediately after each CREATE
-- FUNCTION. This is enforcement rather than a default, so it cannot be
-- forgotten, and it is what makes the leftover default-ACL entries meaningful:
-- once PUBLIC is gone, `service_role=X` in the default ACL is what keeps the
-- Edge Functions working.
--
-- CONSEQUENCE FOR EVERY FUTURE MIGRATION
-- A function that must be callable by a non-service role has to say so
-- explicitly, AFTER its CREATE (the trigger fires at ddl_command_end, so a
-- following GRANT wins):
--
--     CREATE FUNCTION gocash.is_my_operator(uuid) ... ;
--     GRANT EXECUTE ON FUNCTION gocash.is_my_operator(uuid) TO authenticated;
--
-- That is the intended friction. The original hole existed because the grant
-- was a default nobody chose.
--
-- !! APPLY AS supabase_admin, NOT postgres !!  (event triggers need superuser)
--   docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < this_file
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The enforcement
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gocash_revoke_public_execute()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT object_identity
    FROM pg_event_trigger_ddl_commands()
    -- PROCEDUREs are callable through PostgREST too, and were missed by the
    -- first version of this guard: a CREATE PROCEDURE in gocash came out
    -- anon-executable. CREATE OR REPLACE and ALTER FUNCTION are covered
    -- (both carry the CREATE FUNCTION tag or leave the ACL intact).
    WHERE command_tag IN ('CREATE FUNCTION', 'CREATE PROCEDURE')
      AND schema_name = 'gocash'
  LOOP
    -- service_role is deliberately NOT revoked: it is granted by the schema's
    -- default ACL and the Edge Functions connect with that key.
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC', r.object_identity);
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM anon', r.object_identity);
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM authenticated', r.object_identity);
    RAISE NOTICE 'gocash: auto-revoked PUBLIC/anon/authenticated EXECUTE on %',
      r.object_identity;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS gocash_lock_new_functions;
CREATE EVENT TRIGGER gocash_lock_new_functions
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE')
  EXECUTE FUNCTION public.gocash_revoke_public_execute();

-- ---------------------------------------------------------------------------
-- 2. Tidy the default ACL.
-- Only meaningful once PUBLIC is stripped by the trigger above — at that point
-- these entries decide who really gets EXECUTE.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA gocash
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assert the OUTCOME, not the mechanism.
--
-- Creates a throwaway function, checks who can execute it, and drops it. This
-- is the check the previous version should have had: it fails if the guard is
-- ever removed or stops working, and it cannot pass vacuously.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  anon_can  BOOLEAN;
  auth_can  BOOLEAN;
BEGIN
  EXECUTE 'CREATE FUNCTION gocash.__acl_selftest() RETURNS int LANGUAGE sql AS ''SELECT 1''';

  anon_can := has_function_privilege('anon', 'gocash.__acl_selftest()', 'EXECUTE');
  auth_can := has_function_privilege('authenticated', 'gocash.__acl_selftest()', 'EXECUTE');

  EXECUTE 'DROP FUNCTION gocash.__acl_selftest()';

  IF anon_can OR auth_can THEN
    RAISE EXCEPTION
      'guard is not working: a newly created gocash function is executable by anon=% authenticated=%',
      anon_can, auth_can;
  END IF;

  RAISE NOTICE 'verified: new gocash functions are not executable by anon or authenticated';
END;
$$;

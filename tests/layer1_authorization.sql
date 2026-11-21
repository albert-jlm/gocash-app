-- ===========================================================================
-- LAYER 1 — authorization regression.
--
-- THE DEFECT CLASS THIS GUARDS
-- Audit #5a, finding 1 (CRITICAL). Every SECURITY DEFINER function in `gocash`
-- carried Postgres's built-in EXECUTE-to-PUBLIC grant, `gocash` is listed in
-- PGRST_DB_SCHEMAS, and not one of those functions consulted auth.uid(). An
-- unauthenticated caller holding only the anon key — the key that ships in the
-- public JS bundle — could POST to /rest/v1/rpc/update_wallet_balance and move
-- any operator's balance by any amount. Verified live end to end.
--
-- WHY THESE ASSERTIONS ARE SHAPED THE WAY THEY ARE
-- Audit #5a did not happen because the fix was hard. It happened because
-- nobody enumerated the objects. A checklist of "revoke on these six
-- functions" would have missed the two delete_transaction_atomic overloads,
-- would have missed CREATE PROCEDURE entirely, and would have gone stale the
-- moment someone added a seventh function.
--
-- So every assertion below is a query over the catalog that must return ZERO
-- ROWS, quantified over ALL routines / ALL tables / ALL views in the schema.
-- Anything added later is in scope automatically, and the failure output names
-- the specific object.
--
-- And one assertion is not a catalog query at all. The check that shipped in
-- the first version of 20260923000002 inspected pg_default_acl and PASSED
-- WHILE PROTECTING NOTHING — it tested the mechanism instead of the outcome.
-- Test 1.6 therefore creates a throwaway function and a throwaway procedure,
-- asks who can actually execute them, and drops them. It cannot pass
-- vacuously, and it is the only test here that survives a redesign of how the
-- lockdown is implemented.
-- ===========================================================================

-- Incidental NOTICEs (the event trigger announcing each auto-revoke, DROP ...
-- IF EXISTS on a fresh database) would bury the assertion output. Real
-- problems are WARNING or above and still come through.
SET client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- The allowlist.
--
-- DERIVED, NOT COPIED. It is not "whatever happens to be granted today" —
-- that would make test 1.2 a tautology. Each row states a routine, the client
-- role it may be reached by, and why that is safe. Test 1.3 then asserts the
-- list has no stale rows, so it cannot quietly outlive the code, and test 1.5
-- asserts the structural property that makes an entry defensible in the first
-- place: a client-callable SECURITY DEFINER routine MUST establish caller
-- identity from auth.uid() rather than trusting a p_operator_id argument.
--
-- Test 1.5 is the generic rule. The allowlist is the record of who has been
-- through it. A new function added tomorrow fails 1.2 (not on the list) and,
-- if someone adds it to the list without an ownership check, fails 1.5.
--
-- `anon` appears nowhere on purpose: nothing in gocash is callable without a
-- session. The three entries are the total client-facing RPC surface of the
-- rebuilt schema.
-- ---------------------------------------------------------------------------
CREATE TABLE harness.execute_allowlist (
  routine       TEXT NOT NULL,   -- regprocedure text, e.g. 'gocash.f(uuid)'
  client_role   TEXT NOT NULL,
  justification TEXT NOT NULL,
  PRIMARY KEY (routine, client_role)
);

INSERT INTO harness.execute_allowlist (routine, client_role, justification) VALUES
  ('gocash.is_my_operator(uuid)', 'authenticated',
   'SECURITY INVOKER. Answers "is this id mine?" about an id the caller already '
   'holds and leaks nothing about anyone else. Every RLS policy on the ledger '
   'tables calls it, and policies run as the querying role, so authenticated '
   'MUST have EXECUTE or every SELECT on accounts/entries/postings fails.'),

  ('gocash.is_operator_owner(uuid)', 'authenticated',
   'SECURITY DEFINER. Answers "do I own this id?" for auth.uid() only. Called '
   'by the operator_members policy and the fee_rules owner trigger.'),

  ('gocash.my_membership()', 'authenticated',
   'SECURITY DEFINER, no arguments. Returns the caller''s own operator id and '
   'role (owner or staff) for auth.uid(), and nothing about anyone else. The '
   'app and the Edge Functions use it to find whose books a login records in.'),

  ('gocash.set_fee_rule(uuid,text,text,integer,bigint,text)', 'authenticated',
   'SECURITY DEFINER, but unlike the six functions in Audit #5a it checks the '
   'caller: gocash.is_my_operator(p_operator_id) OR the role claim in the '
   'SIGNED JWT equals service_role. Definer rights are needed because the '
   'effective-dating rewrite (close the old period, open a new one) must not '
   'be reachable as a raw UPDATE, which is why fee_rules has no write policy.'),

  ('gocash.fee_rule_at(uuid,text,text,timestamp with time zone)', 'authenticated',
   'SECURITY INVOKER and read-only. Runs under the caller''s own RLS, so it can '
   'only ever return rows fee_rules_select_own would already have returned. '
   'Pricing an amendment at the historical rate is a client-side need.');

-- ---------------------------------------------------------------------------
-- 1.1 — nothing in gocash is reachable by an anonymous caller.
--
-- Audit #5a's exact finding: the exposure was `anon`, not `authenticated`.
-- PUBLIC is checked through anon deliberately — anon is a member of PUBLIC, so
-- a stray `GRANT ... TO PUBLIC` shows up here too.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.1 anon can execute nothing in gocash',
  'Audit #5a: every SECURITY DEFINER function in gocash was EXECUTE-to-PUBLIC '
  'and gocash is in PGRST_DB_SCHEMAS, so the anon key in the public JS bundle '
  'could call update_wallet_balance directly and move any balance.',
  $q$
  SELECT format('%s is executable by anon', p.oid::regprocedure) AS violation
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'gocash'
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  $q$);

-- ---------------------------------------------------------------------------
-- 1.2 — no routine is reachable by a signed-in caller unless it is allowlisted.
--
-- Covers functions AND procedures (prokind 'f' and 'p'). The first version of
-- the event-trigger guard filtered on CREATE FUNCTION only, so a CREATE
-- PROCEDURE in gocash came out anon-executable; quantifying over pg_proc
-- rather than over a list of names is what makes that unrepeatable.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.2 no un-allowlisted routine is client-callable',
  'A checklist only revokes what someone remembered. Audit #5a was missed on '
  'two delete_transaction_atomic overloads and on procedures. This quantifies '
  'over every routine in the schema, so anything added later is in scope.',
  $q$
  SELECT format('%s is executable by %s but is not on the allowlist',
                p.oid::regprocedure, r.rolname) AS violation
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (SELECT rolname FROM pg_roles
              WHERE rolname IN ('anon', 'authenticated')) r
  WHERE n.nspname = 'gocash'
    AND p.prokind IN ('f', 'p')
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM harness.execute_allowlist a
      WHERE a.routine = p.oid::regprocedure::text
        AND a.client_role = r.rolname
    )
  $q$);

-- ---------------------------------------------------------------------------
-- 1.3 — the allowlist has no stale entries.
--
-- The other direction. Without this the list rots into a comforting piece of
-- fiction: a routine gets renamed or its grant dropped, the list still names
-- it, and nobody notices the list no longer describes anything.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.3 the allowlist describes reality',
  'An allowlist that outlives the code it describes is worse than none: it '
  'makes 1.2 look reviewed when it is not.',
  $q$
  SELECT format('allowlist names %s for %s, but %s', a.routine, a.client_role,
                CASE WHEN to_regprocedure(a.routine) IS NULL
                     THEN 'no such routine exists'
                     ELSE 'that role has no EXECUTE on it' END) AS violation
  FROM harness.execute_allowlist a
  WHERE to_regprocedure(a.routine) IS NULL
     OR NOT has_function_privilege(a.client_role, to_regprocedure(a.routine), 'EXECUTE')
  $q$);

-- ---------------------------------------------------------------------------
-- 1.4 — nothing in gocash is granted to PUBLIC.
--
-- Read straight off the ACL rather than through has_function_privilege, so a
-- grant to PUBLIC is caught even in the hypothetical where anon and
-- authenticated were both somehow excluded from it. `=X/owner` — an ACL entry
-- with an EMPTY grantee — is PUBLIC, and that empty grantee is exactly what
-- made the live proacl look innocuous.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.4 no routine is granted to PUBLIC',
  'Postgres grants EXECUTE to PUBLIC on every CREATE FUNCTION by default. That '
  'default, which nobody chose, WAS the vulnerability.',
  $q$
  SELECT format('%s has a PUBLIC grant in its ACL (%s)',
                p.oid::regprocedure, acl::text) AS violation
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(COALESCE(p.proacl, '{}'::aclitem[])) AS acl
  WHERE n.nspname = 'gocash'
    AND split_part(acl::text, '=', 1) = ''   -- empty grantee == PUBLIC
  $q$);

-- ---------------------------------------------------------------------------
-- 1.5 — a client-callable SECURITY DEFINER routine must establish caller
--       identity itself.
--
-- The generic form of Audit #5a. Every one of the six exposed functions took
-- p_operator_id as a caller-supplied parameter and none referenced auth.uid().
-- Revoking the grants closed that instance; this closes the class. A definer-
-- rights routine handed to a client bypasses RLS by construction, so the only
-- thing standing between tenants is a check in its own body.
--
-- Note what is NOT accepted as such a check: pg_has_role(current_user, ...)
-- and session_user tests. Inside SECURITY DEFINER, current_user is the
-- function's owner (supabase_admin) and PostgREST connects as `authenticator`,
-- which is itself a member of service_role — the first version of
-- set_fee_rule's guard was unconditionally true for exactly that reason, and a
-- review proved tenant A could rewrite tenant B's pricing through it. Only
-- auth.uid() (or is_my_operator, which wraps it) and the signed
-- request.jwt.claims are caller identity that cannot be forged from inside.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.5 client-callable SECURITY DEFINER routines check auth.uid()',
  'Audit #5a: six SECURITY DEFINER functions took p_operator_id on trust and '
  'never consulted auth.uid(). Definer rights bypass RLS, so a body with no '
  'ownership check is a cross-tenant write primitive.',
  $q$
  SELECT format('%s is SECURITY DEFINER, callable by %s, and its body never '
                'references auth.uid(), is_my_operator or request.jwt.claims',
                p.oid::regprocedure, r.rolname) AS violation
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (SELECT rolname FROM pg_roles
              WHERE rolname IN ('anon', 'authenticated')) r
  WHERE n.nspname = 'gocash'
    AND p.prosecdef
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    AND p.prosrc !~* '(auth\.uid|is_my_operator|request\.jwt\.claims)'
  $q$);

-- ---------------------------------------------------------------------------
-- 1.6 — THE OUTCOME TEST.
--
-- Create a throwaway function and a throwaway procedure in gocash, ask who can
-- actually execute them, drop them.
--
-- This is the assertion the project did not have. The check in the first
-- version of 20260923000002 read pg_default_acl and passed while protecting
-- nothing, because ALTER DEFAULT PRIVILEGES cannot strip Postgres's built-in
-- PUBLIC EXECUTE on functions — the default ACL looked correct and new
-- functions still came out world-callable. Everything above reads the catalog;
-- if the lockdown is ever reimplemented, or removed and replaced with a
-- convention, only this test notices.
--
-- The procedure half is not padding: the event trigger originally matched
-- CREATE FUNCTION only, and a CREATE PROCEDURE in gocash came out
-- anon-executable through PostgREST.
-- ---------------------------------------------------------------------------
DO $outcome$
DECLARE
  v_fn_anon  BOOLEAN;
  v_fn_auth  BOOLEAN;
  v_pr_anon  BOOLEAN;
  v_pr_auth  BOOLEAN;
BEGIN
  EXECUTE $c$CREATE FUNCTION gocash.__harness_acl_probe() RETURNS int
             LANGUAGE sql AS 'SELECT 1'$c$;
  EXECUTE $c$CREATE PROCEDURE gocash.__harness_acl_probe_proc()
             LANGUAGE plpgsql AS 'BEGIN END'$c$;

  v_fn_anon := has_function_privilege('anon',          'gocash.__harness_acl_probe()',      'EXECUTE');
  v_fn_auth := has_function_privilege('authenticated', 'gocash.__harness_acl_probe()',      'EXECUTE');
  v_pr_anon := has_function_privilege('anon',          'gocash.__harness_acl_probe_proc()', 'EXECUTE');
  v_pr_auth := has_function_privilege('authenticated', 'gocash.__harness_acl_probe_proc()', 'EXECUTE');

  EXECUTE 'DROP FUNCTION gocash.__harness_acl_probe()';
  EXECUTE 'DROP PROCEDURE gocash.__harness_acl_probe_proc()';

  PERFORM harness.record('layer1',
    '1.6a a newly created FUNCTION is not client-callable',
    'Outcome, not mechanism. The pg_default_acl assertion this replaces passed '
    'while protecting nothing: ALTER DEFAULT PRIVILEGES cannot remove the '
    'built-in PUBLIC EXECUTE, so new functions still came out world-callable.',
    NOT v_fn_anon AND NOT v_fn_auth,
    format('anon=%s authenticated=%s — a function created just now is '
           'executable by a client role, so the lockdown is not working',
           v_fn_anon, v_fn_auth));

  PERFORM harness.record('layer1',
    '1.6b a newly created PROCEDURE is not client-callable',
    'The first version of the guard matched CREATE FUNCTION only, so a CREATE '
    'PROCEDURE in gocash came out anon-executable through PostgREST.',
    NOT v_pr_anon AND NOT v_pr_auth,
    format('anon=%s authenticated=%s — a procedure created just now is '
           'executable by a client role', v_pr_anon, v_pr_auth));
END;
$outcome$;

-- ---------------------------------------------------------------------------
-- 1.7 — every table in gocash has RLS enabled.
--
-- gocash is exposed through PostgREST, so a table without RLS is readable and
-- writable by every signed-in user across every tenant, with no policy ever
-- consulted. Quantified over pg_class so a table added tomorrow is covered.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.7 every gocash table has RLS enabled',
  'gocash is in PGRST_DB_SCHEMAS. A table with RLS off is a cross-tenant read '
  'and write for every signed-in user, and no policy is consulted.',
  $q$
  SELECT format('gocash.%s does not have row level security enabled', c.relname) AS violation
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity
  $q$);

-- ---------------------------------------------------------------------------
-- 1.8 — a client role may hold DELETE only where a DELETE policy exists.
--
-- Audit #5 finding 6, which #5a confirmed live. Deleting a platform removed
-- nothing: RLS was on, DELETE was granted, and no DELETE policy existed, so
-- PostgREST returned 200 with zero rows affected. The UI reported "removed",
-- optimistically dropped the row, and the platform came back on refresh. A
-- silent no-op is worse than an error, because nothing anywhere records that
-- the delete did not happen.
--
-- Stated as "grant without policy", not "policy for every table". Tables that
-- are deliberately never deleted from (the ledger is append-only) correctly
-- have neither, and must not be nagged into growing a DELETE policy.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.8 no DELETE grant without a DELETE policy',
  'Audit #5 finding 6: DELETE was granted on wallets and transactions with no '
  'DELETE policy, so deletes silently affected zero rows and the UI reported '
  'success. The grant and the policy must travel together.',
  $q$
  SELECT format('%s has DELETE granted to %s but no policy permits DELETE',
                c.relname, r.rolname) AS violation
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (SELECT rolname FROM pg_roles
              WHERE rolname IN ('anon', 'authenticated')) r
  WHERE n.nspname = 'gocash'
    AND c.relkind = 'r'
    AND has_table_privilege(r.rolname, c.oid, 'DELETE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = c.oid
        AND p.polcmd IN ('d', '*')            -- DELETE, or ALL
        AND p.polpermissive                    -- a RESTRICTIVE policy grants nothing
    )
  $q$);

-- ---------------------------------------------------------------------------
-- 1.9 — no view in gocash is missing security_invoker.
--
-- A view runs as its OWNER by default, so it reads straight past the RLS on
-- its base tables. gocash.account_balances would hand every operator's
-- balances to any caller who can SELECT it — the same shape of hole as the
-- functions in Audit #5a, one object type over, and easier to miss because
-- the base tables all look correctly protected.
--
-- Matches on the option being present and true rather than merely present:
-- `security_invoker=false` is a plausible thing to end up with after a
-- CREATE OR REPLACE VIEW that drops the WITH clause.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.9 every gocash view is security_invoker',
  'A view runs as its owner by default and reads past the RLS on its base '
  'tables. account_balances would expose every tenant''s balances to any '
  'caller with SELECT on the view.',
  $q$
  SELECT format('gocash.%s is a %s and does not set security_invoker=true (reloptions: %s)',
                c.relname,
                CASE c.relkind WHEN 'v' THEN 'view' ELSE 'materialized view' END,
                COALESCE(array_to_string(c.reloptions, ', '), 'none')) AS violation
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND c.relkind IN ('v', 'm')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(c.reloptions, '{}'::text[])) AS o
      WHERE lower(o) IN ('security_invoker=true', 'security_invoker=on')
    )
  $q$);

-- ===========================================================================
-- KNOWN GAPS — assertions that currently reproduce a real defect.
--
-- These do not fail the run, because the fix belongs to files this harness
-- does not own. They are reported in their own section on every run, and the
-- harness FAILS if one of them ever stops reproducing, which is the signal to
-- promote it to a hard assertion above. See harness.expect_no_rows_known_gap.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.5b — a tenant cannot rewrite a row into another tenant's books.
--
-- This replaces a "known gap" that asserted every UPDATE policy carries an
-- explicit WITH CHECK, on the strength of Audit #5 finding 15. That finding is
-- WRONG, and the gap entry reproduced it.
--
-- PostgreSQL uses the USING expression as the WITH CHECK when WITH CHECK is
-- omitted for UPDATE. The five policies in question are therefore already safe.
-- Verified directly on this Postgres (15.8) against a policy of exactly that
-- shape:
--
--   as tenant A: UPDATE t SET owner = <tenant B> WHERE id = 1;
--     -> ERROR: new row violates row-level security policy for table "t"
--   as tenant A: UPDATE t SET note = 'edited'   WHERE id = 1;
--     -> UPDATE 1
--
-- The old entry was doubly wrong. It inspected pg_policy.polwithcheck IS NULL
-- — a check of the MECHANISM, not the outcome, which is the exact mistake this
-- harness exists to prevent. And its inverted polarity meant that adding an
-- explicit WITH CHECK for legibility would FAIL the build, demanding the
-- non-bug be "promoted".
--
-- So this is now a hard assertion of the behaviour that actually matters: no
-- permissive UPDATE policy may allow a row to leave its operator. A policy
-- whose USING does not constrain operator ownership fails here whether or not
-- it spells WITH CHECK out.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer1', '1.5b UPDATE policies constrain row ownership',
  'A permissive UPDATE policy whose USING (or WITH CHECK) does not reference '
  'auth.uid() would let a signed-in user rewrite a row into another tenant. '
  'Postgres reuses USING as the WITH CHECK when the latter is omitted, so the '
  'presence of the clause is irrelevant — only the predicate matters.',
  $q$
  SELECT format('policy %s on gocash.%s is FOR UPDATE but neither its USING nor its '
                'WITH CHECK references operator ownership, so a row could be handed '
                'to another tenant', p.polname, c.relname) AS violation
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND p.polcmd = 'w'              -- UPDATE
    AND p.polpermissive
    -- Match 'uid()', not 'auth.uid()'. pg_get_expr omits the schema when auth
    -- is on the search_path, which it is in the test scratch database but not
    -- on the live instance — so matching the qualified name flagged all five
    -- policies as violations against a schema that is actually fine.
    -- position(), not LIKE, because the harness passes this query through
    -- format() and a '%' would be consumed.
    AND position('uid()' IN
          COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
          || COALESCE(pg_get_expr(p.polqual,   p.polrelid), '')) = 0
  $q$);

-- ---------------------------------------------------------------------------
-- 1.10–1.14 — table privileges (20260925000003).
--
-- Everything above inspects the catalog. These act as the browser role and
-- try the thing, because a grant that looks right in the catalog and a
-- request that is actually refused are not the same claim — and because the
-- suite otherwise runs as a superuser, which is how a database with no grants
-- at all passed every assertion.
--
-- SET LOCAL ROLE is undone when the harness rolls the block back.
-- ---------------------------------------------------------------------------
SELECT harness.expect_ok('layer1', '1.10 the browser role can read the tables the app reads',
  'Without USAGE on the schema and SELECT on these, every screen in the app '
  'fails with "permission denied for schema gocash".',
  ARRAY[
    $s$SET LOCAL ROLE authenticated$s$,
    $s$SELECT count(*) FROM gocash.operators$s$,
    $s$SELECT count(*) FROM gocash.transactions$s$,
    $s$SELECT count(*) FROM gocash.account_balances$s$,
    $s$SELECT count(*) FROM gocash.fee_rules$s$
  ]);

SELECT harness.expect_error('layer1', '1.11 the browser role cannot insert a transaction',
  'A client that can insert transactions can write one straight to confirmed '
  'with no ledger entry behind it.',
  ARRAY[
    $s$SET LOCAL ROLE authenticated$s$,
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES (gen_random_uuid(), 'Cash In', 'GCash', 100, 'confirmed', 'manual')$s$
  ],
  'permission denied');

SELECT harness.expect_error('layer1', '1.12 the browser role cannot update a transaction',
  'A client that can update transactions can change the amount of a posted '
  'transaction, or set a draft to confirmed, without touching the ledger.',
  ARRAY[
    $s$SET LOCAL ROLE authenticated$s$,
    $s$UPDATE gocash.transactions SET status = 'confirmed'$s$
  ],
  'permission denied');

SELECT harness.expect_error('layer1', '1.13 the browser role cannot change its plan or ownership',
  'The operators UPDATE policy allows an operator to update their own row. '
  'Only the column grant stops that reaching subscription_tier or user_id.',
  ARRAY[
    $s$SET LOCAL ROLE authenticated$s$,
    $s$UPDATE gocash.operators SET subscription_tier = 'premium'$s$
  ],
  'permission denied');

SELECT harness.expect_error('layer1', '1.14 anon cannot read anything in gocash',
  'The anon key ships in the app. It must open nothing.',
  ARRAY[
    $s$SET LOCAL ROLE anon$s$,
    $s$SELECT count(*) FROM gocash.operators$s$
  ],
  'permission denied');

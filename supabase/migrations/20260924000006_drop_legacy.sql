-- ===========================================================================
-- Remove the delta-multiplier model.
--
-- Everything dropped here has a replacement that is already in place and
-- already verified:
--
--   wallets                   -> gocash.accounts + gocash.account_balances
--   update_wallet_balance     -> a balanced entry in gocash.postings
--   confirm_transaction_atomic-> kind='transaction' entry
--   delete_transaction_atomic -> kind='reversal' entry (both overloads)
--   delete_platform_atomic    -> soft deactivate (accounts.is_active = false)
--   transaction_rules         -> gocash.fee_rules (pricing) and
--                                _core/postings.ts (direction)
--
-- THE GUARD IS THE POINT OF THIS FILE.
--
-- `wallets.balance` is the only copy of where the money is. It was mutated in
-- place and never derived, and there is no journal to rebuild it from. Dropping
-- it while the ledger disagreed by one centavo would destroy the only correct
-- record, irreversibly, for every operator at once.
--
-- So this migration re-runs the comparison 20260924000003 made, at the moment
-- of the drop rather than at the moment of the backfill. The two are not the
-- same check: anything could have written a posting in between — a deploy, a
-- manual fix, a half-migrated Edge Function — and the backfill's verification
-- cannot see the future. If they disagree now, this file refuses to run and
-- nothing is lost.
--
-- !! APPLY AS supabase_admin !!
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE GUARD.
--
-- to_regclass rather than a bare reference so a re-run, with wallets already
-- gone, is a no-op instead of an error. The guard is skipped in that case
-- because there is nothing left to destroy — not because the check is optional.
-- ---------------------------------------------------------------------------

DO $guard$
DECLARE
  v_bad     TEXT;
  v_wallets BIGINT;
BEGIN
  IF to_regclass('gocash.wallets') IS NULL THEN
    RAISE NOTICE 'gocash.wallets is already gone; balance guard skipped';
  ELSE
    -- 1a. Every wallet still maps to an account.
    EXECUTE $q$
      SELECT string_agg(format('operator %s wallet %L has no account', w.operator_id, w.wallet_name), '; ')
      FROM gocash.wallets w
      LEFT JOIN gocash.accounts a
        ON a.operator_id = w.operator_id AND a.name = w.wallet_name
      WHERE a.id IS NULL
    $q$ INTO v_bad;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        'REFUSING TO DROP gocash.wallets: the backfill did not map every wallet — %', v_bad;
    END IF;

    -- 1b. Every balance is reproduced exactly by the derived balance.
    EXECUTE $q$
      SELECT string_agg(
               format('operator %s %L: wallet %s but ledger %s',
                      w.operator_id, w.wallet_name,
                      COALESCE(w.balance, 0),
                      COALESCE(b.balance_minor, 0)::NUMERIC / 100),
               E'\n  ' ORDER BY w.operator_id, w.wallet_name)
      FROM gocash.wallets w
      JOIN gocash.accounts a
        ON a.operator_id = w.operator_id AND a.name = w.wallet_name
      LEFT JOIN gocash.account_balances b ON b.account_id = a.id
      WHERE COALESCE(b.balance_minor, 0) <> round(COALESCE(w.balance, 0) * 100)::BIGINT
    $q$ INTO v_bad;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        E'REFUSING TO DROP gocash.wallets: the ledger does not reproduce the stored balances. wallets is the ONLY copy of these numbers — fix the ledger first, this migration destroys nothing until it agrees.\n  %',
        v_bad;
    END IF;

    EXECUTE 'SELECT count(*) FROM gocash.wallets' INTO v_wallets;
    RAISE NOTICE 'guard passed: % wallet balance(s) are reproduced exactly by the ledger',
      v_wallets;
  END IF;

  -- 1c. The books are clean. An out-of-balance entry means a derived balance
  -- that agrees with wallets today by coincidence and will not tomorrow.
  SELECT string_agg(
           format('entry %s (operator %s, kind %s) out by %s',
                  entry_id, operator_id, kind,
                  COALESCE(out_of_balance_by_minor::TEXT, 'NULL — no postings at all')),
           E'\n  ')
    INTO v_bad
  FROM gocash.unbalanced_entries;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      E'REFUSING TO DROP: gocash.unbalanced_entries is not empty, so the derived balances cannot be trusted:\n  %',
      v_bad;
  END IF;
END;
$guard$;

-- ---------------------------------------------------------------------------
-- 2. The functions.
--
-- Driven off the catalog rather than a hand-typed list, for the same reason
-- 20260923000001 is: a checklist only covers what someone remembered, and
-- delete_transaction_atomic has TWO overloads — a 6-argument one that simply
-- forwards to an 8-argument one. Audit #5a found that exact pair missed by a
-- previous sweep. confirm_transaction_atomic's live signature (18 arguments)
-- also differs from the repo's (16), so naming it in full would be a
-- migration that applies in one environment and fails in the other.
-- ---------------------------------------------------------------------------

DO $drop_fns$
DECLARE
  v_fn      RECORD;
  v_dropped INT := 0;
BEGIN
  FOR v_fn IN
    -- ::text here, not at RAISE time: once the function is dropped a bare
    -- regprocedure no longer resolves to a name and the notice prints a raw
    -- oid instead of the signature it just destroyed.
    SELECT p.oid::regprocedure::TEXT AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'gocash'
      AND p.proname IN ('update_wallet_balance',
                        'confirm_transaction_atomic',
                        'delete_transaction_atomic',
                        -- Added after review: not on the original list, but its
                        -- body writes gocash.wallets and gocash.transaction_rules,
                        -- both dropped below. Left in place it would survive this
                        -- migration still granted to service_role and fail at
                        -- runtime against tables that no longer exist. It has no
                        -- call sites in src/, supabase/functions/ or the deployed
                        -- edge runtime, and platform removal is now a soft
                        -- deactivate (is_active = false) because an append-only
                        -- ledger must never lose a platform that has postings.
                        'delete_platform_atomic')
  LOOP
    EXECUTE format('DROP FUNCTION %s', v_fn.sig);
    RAISE NOTICE 'dropped %', v_fn.sig;
    v_dropped := v_dropped + 1;
  END LOOP;
  RAISE NOTICE 'dropped % legacy function(s)', v_dropped;
END;
$drop_fns$;

-- ---------------------------------------------------------------------------
-- 3. The tables.
--
-- No CASCADE. If something still depends on either of these, that dependency
-- is news and this migration should stop rather than quietly take it with it.
-- Their RLS policies and indexes go with the table, which is intended: the
-- wallets policies are the ones Audit #5 finding 6 was about (UPDATE and
-- INSERT granted, DELETE neither granted nor policied, so deleting a platform
-- silently affected zero rows and the UI reported success).
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS gocash.wallets;
DROP TABLE IF EXISTS gocash.transaction_rules;

-- ---------------------------------------------------------------------------
-- 4. Derivable and unused columns on transactions.
--
--   starting_cash, wallet_balance  balance snapshots. Never written (Audit #5
--                                  finding 22) and now derivable: the balance
--                                  at any instant is the sum of the postings
--                                  up to it, which is the point of a ledger.
--   time_24hr, full_date, year,    denormalised pieces of transaction_date,
--   month, day                     stored as TEXT. Nothing reads them, and
--                                  they are a second source of truth for a
--                                  value that already shifts by the UTC offset
--                                  on the way through the form (Audit #5
--                                  finding 11).
-- ---------------------------------------------------------------------------

ALTER TABLE gocash.transactions
  DROP COLUMN IF EXISTS starting_cash,
  DROP COLUMN IF EXISTS wallet_balance,
  DROP COLUMN IF EXISTS time_24hr,
  DROP COLUMN IF EXISTS full_date,
  DROP COLUMN IF EXISTS year,
  DROP COLUMN IF EXISTS month,
  DROP COLUMN IF EXISTS day;

-- ---------------------------------------------------------------------------
-- 5. The status machine.
--
--   uploaded -> processing -> awaiting_confirm -> confirmed
--                                              -> voided
--   (any)    -> failed
--
-- 'edited' is removed. It was in the live CHECK and the dashboard queried for
-- it, but nothing ever set it (Audit #5 finding 25): confirm always wrote
-- 'confirmed' and recorded the change in was_edited/edit_history instead. It
-- is not merely unused, it is now WRONG — amending a confirmed transaction
-- posts a reversal entry plus a new entry, and the transaction stays
-- 'confirmed'. A separate status would suggest the amendment is a state the
-- row is in rather than two entries in the ledger.
--
-- 'voided' is added for the other half of that story: a transaction reversed
-- and not re-posted.
-- ---------------------------------------------------------------------------

DO $status_guard$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(format('%s row(s) with status %L', n, status), '; ')
    INTO v_bad
  FROM (SELECT status, count(*) AS n FROM gocash.transactions
        WHERE status IS NOT NULL
          AND status NOT IN ('uploaded', 'processing', 'awaiting_confirm',
                             'confirmed', 'voided', 'failed')
        GROUP BY status) t;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'cannot tighten the status CHECK: % — decide what these become before dropping their status from the constraint',
      v_bad;
  END IF;
END;
$status_guard$;

ALTER TABLE gocash.transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE gocash.transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('uploaded', 'processing', 'awaiting_confirm',
                    'confirmed', 'voided', 'failed'));

-- ---------------------------------------------------------------------------
-- 6. audit_logs: the policy that matched nothing.
--
--   USING (operator_id = auth.uid())
--
-- compares an OPERATOR id to a USER id. They are different uuids from
-- different tables — gocash.operators.id vs gocash.operators.user_id — so the
-- predicate is false for every row that has ever existed. 0 of the 26 live
-- audit rows are readable by the operator they belong to, and the failure is
-- silent: an empty result set is indistinguishable from "nothing was logged",
-- which is exactly what a missing audit trail looks like.
--
-- gocash.is_my_operator() is the same join every other policy in this schema
-- uses, and it is SECURITY INVOKER, so it cannot widen what the caller could
-- otherwise see.
--
-- NOTE for whoever picks up the audit trail: on the live instance
-- `authenticated` holds arwdDxt on gocash.audit_logs — INSERT, UPDATE and
-- DELETE included, with no policy for any of them. That is a separate defect
-- from this one and is deliberately not changed here.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_select_own ON gocash.audit_logs;
CREATE POLICY audit_select_own ON gocash.audit_logs
  FOR SELECT USING (gocash.is_my_operator(operator_id));

COMMIT;

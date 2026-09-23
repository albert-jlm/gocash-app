-- ===========================================================================
-- Backfill: turn the stored balances into a ledger.
--
-- `gocash.wallets.balance` is the ONLY copy of where the money is. It was
-- mutated in place with `balance = balance + delta` and never derived from
-- anything, so there is nothing to reconstruct it from: no journal, no history,
-- no audit trigger on that table (Audit #5 finding 14, still open after #5a).
-- The number itself is therefore the opening balance, and this migration
-- carries it forward as one entry per operator rather than pretending we can
-- replay how it got there.
--
-- WHY THE VERIFICATION AT THE BOTTOM IS NOT A COMMENT
-- 20260924000006 drops `wallets`. If the derived balances disagreed with the
-- stored ones by even one centavo, that DROP would destroy the only correct
-- copy of every operator's money. So this file refuses to commit unless the
-- two agree exactly, and 20260924000006 refuses to run unless they still do.
-- A migration that half-applies here is recoverable; one that half-applies
-- there is not.
--
-- SCALE
-- 2 operators, 8 wallets, 1 transaction. Written as a readable loop rather
-- than a clever CTE because at this size the only thing worth optimising for
-- is being able to check it by eye.
--
-- !! APPLY AS supabase_admin !!
--   docker exec -i supabase-db psql -U supabase_admin -d <db> -v ON_ERROR_STOP=1 < this_file
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight.
--
-- Two shapes of pre-existing data would otherwise fail deep inside the loop
-- below with a constraint name for a message. Both are cheap to state and the
-- error is what someone actually needs to read.
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_bad TEXT;
BEGIN
  -- gocash.accounts has a partial unique index allowing exactly one 'cash'
  -- account per operator, because a second drawer is not a drawer. wallets has
  -- no such constraint, so this has to be checked rather than assumed.
  SELECT string_agg(format('operator %s has %s wallets of type ''cash''', operator_id, n), '; ')
    INTO v_bad
  FROM (SELECT operator_id, count(*) AS n FROM gocash.wallets
        WHERE wallet_type = 'cash' GROUP BY operator_id HAVING count(*) > 1) t;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'cannot backfill: % — exactly one cash account per operator is allowed', v_bad;
  END IF;

  -- The revenue and equity accounts created below are named 'Fee Revenue' and
  -- 'Owner Equity'. accounts is UNIQUE (operator_id, name), so an existing
  -- wallet under either name would collide and the wallet would silently lose
  -- its balance to an account of the wrong kind.
  SELECT string_agg(format('operator %s has a wallet named %L', operator_id, wallet_name), '; ')
    INTO v_bad
  FROM gocash.wallets WHERE wallet_name IN ('Fee Revenue', 'Owner Equity');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'cannot backfill: % — rename it first; those names are reserved '
                    'for the revenue and equity accounts', v_bad;
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Every wallet becomes an account.
--
-- wallet_type 'cash' -> kind 'cash', everything else -> 'platform'. wallets
-- CHECKs wallet_type IN ('platform','cash'), so the ELSE is not a guess; it is
-- written this way so a third wallet_type added later lands somewhere valid
-- instead of inserting NULL into a NOT NULL column.
--
-- is_active is preserved: a deactivated wallet must not come back as an active
-- account in the platform picker.
--
-- created_at is carried over so the account is as old as the wallet it
-- replaces. ON CONFLICT DO NOTHING makes a re-run a no-op rather than an error.
-- ---------------------------------------------------------------------------

INSERT INTO gocash.accounts (operator_id, kind, name, is_active, created_at, updated_at)
SELECT w.operator_id,
       CASE WHEN w.wallet_type = 'cash' THEN 'cash' ELSE 'platform' END,
       w.wallet_name,
       w.is_active,
       COALESCE(w.created_at, NOW()),
       COALESCE(w.updated_at, NOW())
FROM gocash.wallets w
ON CONFLICT ON CONSTRAINT accounts_unique_name_per_operator DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Every operator gets a revenue and an equity account.
--
-- These have no wallet to come from, and without them the very first entry
-- after this migration has nowhere to put its fee: a Cash In posts
-- Cash +510 / GCash -500 / Revenue -10, and the third leg is what makes it sum
-- to zero. The old model had no revenue account either, which is why the fee
-- was smuggled into the cash leg through delta_cash_mult and why four of six
-- types never balanced.
--
-- Equity is needed immediately, by this very migration: it is the balancing
-- leg of the opening entry in step 4.
--
-- The bare ON CONFLICT DO NOTHING (no target) covers both the name constraint
-- and the accounts_singleton_kinds index, so an operator who somehow already
-- has a revenue account under another name is left alone rather than failing.
-- ---------------------------------------------------------------------------

INSERT INTO gocash.accounts (operator_id, kind, name)
SELECT o.id, 'revenue', 'Fee Revenue' FROM gocash.operators o
ON CONFLICT DO NOTHING;

INSERT INTO gocash.accounts (operator_id, kind, name)
SELECT o.id, 'equity', 'Owner Equity' FROM gocash.operators o
ON CONFLICT DO NOTHING;

-- A cash account is not optional either. Both live operators have a cash
-- wallet so this inserts nothing today, but supabase/functions/_core/postings.ts
-- posts a cash leg on ALL SIX transaction types — an operator without one
-- could not record a single transaction, and the failure would surface as a
-- NULL account_id at confirm time rather than here.
INSERT INTO gocash.accounts (operator_id, kind, name)
SELECT o.id, 'cash', 'Cash'
FROM gocash.operators o
WHERE NOT EXISTS (
  SELECT 1 FROM gocash.accounts a WHERE a.operator_id = o.id AND a.kind = 'cash'
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Sanity: every wallet found an account.
--
-- Step 1's ON CONFLICT DO NOTHING is silent by design, so a collision that
-- step 0 did not anticipate would leave a wallet unmapped and its balance
-- unposted. Cheaper to assert than to discover after the DROP.
-- ---------------------------------------------------------------------------

DO $mapped$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(format('operator %s wallet %L', w.operator_id, w.wallet_name), '; ')
    INTO v_bad
  FROM gocash.wallets w
  LEFT JOIN gocash.accounts a
    ON a.operator_id = w.operator_id AND a.name = w.wallet_name
  WHERE a.id IS NULL;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'these wallets did not map to an account: %', v_bad;
  END IF;
END;
$mapped$;

-- ---------------------------------------------------------------------------
-- 4. One opening entry per operator.
--
-- Legs: one per wallet with a non-zero balance, plus equity for the remainder.
--
-- ZERO BALANCES ARE SKIPPED, NOT POSTED AS ZERO. gocash.postings CHECKs
-- amount_minor <> 0, so a zero leg is rejected outright — and rightly: a leg
-- recording that nothing happened would pad a one-sided entry into looking
-- like double entry.
--
-- THE ZERO-BALANCE OPERATOR. Two distinct cases, and they need different
-- handling:
--   * every balance zero -> NO legs at all. An entry is written only if there
--     is something to carry forward; otherwise we would produce an empty entry,
--     which commits silently (no trigger can fire on ledger_entries alone) and
--     shows up forever in gocash.unbalanced_entries.
--   * balances that happen to cancel (e.g. Cash +100, GCash -100) -> the legs
--     are posted and the equity leg is SKIPPED, because it would be zero.
--     Two legs, summing to zero, already a valid entry.
-- Operator 0f89c637 today is Cash 20,000 and three zero platform wallets: one
-- cash leg, one equity leg, and no zero rows.
--
-- Balances are converted to centavos with round(balance * 100). balance is
-- NUMERIC(15,2) so the multiplication is exact; round() is there so a value
-- that somehow carries more than two decimals cannot truncate a centavo away
-- and quietly unbalance the entry.
--
-- Re-running is a no-op: an operator that already has an 'opening' entry is
-- skipped, and the idempotency_key gives a second, database-enforced layer.
-- ---------------------------------------------------------------------------

DO $backfill$
DECLARE
  v_op      RECORD;
  v_entry   UUID;
  v_total   BIGINT;
  v_legs    INT;
  v_written INT := 0;
BEGIN
  FOR v_op IN SELECT id, name FROM gocash.operators ORDER BY created_at, id LOOP

    IF EXISTS (SELECT 1 FROM gocash.ledger_entries e
               WHERE e.operator_id = v_op.id AND e.kind = 'opening') THEN
      RAISE NOTICE 'operator % (%) already has an opening entry; skipped', v_op.id, v_op.name;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(round(COALESCE(w.balance, 0) * 100))::BIGINT, 0),
           COUNT(*) FILTER (WHERE round(COALESCE(w.balance, 0) * 100) <> 0)
      INTO v_total, v_legs
    FROM gocash.wallets w
    WHERE w.operator_id = v_op.id;

    IF v_legs = 0 THEN
      RAISE NOTICE 'operator % (%) has nothing to carry forward; no opening entry written',
        v_op.id, v_op.name;
      CONTINUE;
    END IF;

    INSERT INTO gocash.ledger_entries
      (operator_id, kind, memo, idempotency_key, created_by)
    VALUES
      (v_op.id, 'opening',
       'Opening balances carried forward from gocash.wallets at the ledger rebuild',
       'backfill-opening-' || v_op.id::TEXT,
       'migration:20260924000003')
    RETURNING id INTO v_entry;

    INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
    SELECT v_entry, a.id, v_op.id, round(COALESCE(w.balance, 0) * 100)::BIGINT
    FROM gocash.wallets w
    JOIN gocash.accounts a
      ON a.operator_id = w.operator_id AND a.name = w.wallet_name
    WHERE w.operator_id = v_op.id
      AND round(COALESCE(w.balance, 0) * 100) <> 0;

    -- The owner's stake. Negative because equity is credit-natured: the
    -- account_balances view flips it back so the operator reads +20,000.00.
    IF v_total <> 0 THEN
      INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
      SELECT v_entry, a.id, v_op.id, -v_total
      FROM gocash.accounts a
      WHERE a.operator_id = v_op.id AND a.kind = 'equity';
    END IF;

    v_written := v_written + 1;
    RAISE NOTICE 'operator % (%): opening entry % with % wallet leg(s), equity %',
      v_op.id, v_op.name, v_entry, v_legs, (-v_total)::NUMERIC / 100;
  END LOOP;

  RAISE NOTICE 'backfill wrote % opening entr(ies)', v_written;
END;
$backfill$;

-- ---------------------------------------------------------------------------
-- 5. VERIFICATION — these raise, they do not warn.
--
-- postings_must_balance is DEFERRABLE INITIALLY DEFERRED, so without this it
-- would not run until COMMIT — after the checks below had already read the
-- postings and declared them fine. Forcing it here means an unbalanced entry
-- fails on this line, with the trigger's own message, rather than on a COMMIT
-- that the verification appeared to have blessed.
-- ---------------------------------------------------------------------------

SET CONSTRAINTS ALL IMMEDIATE;

-- 5a. Every wallet balance is reproduced exactly by the derived balance.
--
-- This is the assertion the whole rebuild rests on. gocash.account_balances is
-- a SUM over postings, computed independently of the number it is being
-- compared against, so agreement here means the ledger genuinely reproduces
-- the stored balances rather than having copied them into a second field.
DO $verify_balances$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
           format('operator %s %L: wallet %s but ledger %s',
                  w.operator_id, w.wallet_name,
                  COALESCE(w.balance, 0),
                  COALESCE(b.balance_minor, 0)::NUMERIC / 100),
           E'\n  ' ORDER BY w.operator_id, w.wallet_name)
    INTO v_bad
  FROM gocash.wallets w
  JOIN gocash.accounts a
    ON a.operator_id = w.operator_id AND a.name = w.wallet_name
  LEFT JOIN gocash.account_balances b ON b.account_id = a.id
  WHERE COALESCE(b.balance_minor, 0) <> round(COALESCE(w.balance, 0) * 100)::BIGINT;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION E'backfill does not reproduce the stored balances:\n  %', v_bad;
  END IF;

  RAISE NOTICE 'verified: all % wallet balance(s) are reproduced by the ledger',
    (SELECT count(*) FROM gocash.wallets);
END;
$verify_balances$;

-- 5b. The books are clean.
--
-- gocash.unbalanced_entries is documented as "any row here is a bug". Its LEFT
-- JOIN also catches an entry with NO postings, which nothing else can: no
-- trigger exists on ledger_entries that could fire on one.
DO $verify_books$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
           format('entry %s (operator %s, kind %s) out by %s',
                  entry_id, operator_id, kind,
                  COALESCE(out_of_balance_by_minor::TEXT, 'NULL — it has no postings at all')),
           E'\n  ')
    INTO v_bad
  FROM gocash.unbalanced_entries;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION E'gocash.unbalanced_entries is not empty:\n  %', v_bad;
  END IF;

  RAISE NOTICE 'verified: gocash.unbalanced_entries is empty';
END;
$verify_books$;

-- 5c. Every operator has the three accounts that make an entry expressible.
--
-- Not a data-integrity check but a completeness one: without all three, the
-- first Cash In or Profit Remittance after this migration fails at confirm
-- time, in an Edge Function, in front of an operator.
DO $verify_kinds$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(format('operator %s is missing a %s account', o.id, k.kind), '; ')
    INTO v_bad
  FROM gocash.operators o
  CROSS JOIN (VALUES ('cash'), ('revenue'), ('equity')) AS k(kind)
  WHERE NOT EXISTS (
    SELECT 1 FROM gocash.accounts a WHERE a.operator_id = o.id AND a.kind = k.kind
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'backfill left an operator without a full chart of accounts: %', v_bad;
  END IF;
END;
$verify_kinds$;

COMMIT;

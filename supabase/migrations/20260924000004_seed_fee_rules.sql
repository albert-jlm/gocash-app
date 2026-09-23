-- ===========================================================================
-- Seed gocash.fee_rules from the live gocash.transaction_rules.
--
-- Only the PRICING half of transaction_rules moves here. The three delta_*
-- multipliers are deliberately left behind: direction now lives in code
-- (supabase/functions/_core/postings.ts), which is the whole point of the
-- rebuild. Making direction editable is why four of six transaction types
-- destroyed money on every use.
--
-- ---------------------------------------------------------------------------
-- UNIT CONVERSION — THE ONE THING THAT MUST NOT BE GOT WRONG
--
--   transaction_rules.profit_rate     NUMERIC(10,6)   PERCENT   2.000000 = 2%
--   transaction_rules.profit_minimum  NUMERIC(15,2)   PESOS     5.00     = PHP 5
--
--   fee_rules.rate_bps                INTEGER         BASIS POINTS  200 = 2%
--   fee_rules.minimum_minor           BIGINT          CENTAVOS      500 = PHP 5
--
-- Both are x100. There is no adapter anywhere that does this, so a plain
-- `rate_bps = profit_rate` would price a 2% fee at 0.02% and a PHP 5 floor at
-- PHP 0.05 — a 100x undercharge on every transaction, silently, forever. The
-- assertion in step 3 exists solely to catch that: no seeded rule may land in
-- the 0 < rate_bps < 10 or 0 < minimum_minor < 100 bands, which is exactly
-- where a naive copy lands and nowhere a real price would.
--
-- Confirmed pricing is ceil(max(amount x 2%, PHP 5)), so a correctly converted
-- 2.000000 / 5.00 row must come out as rate_bps 200 / minimum_minor 500. It
-- does; that is the arithmetic this file is checked against.
--
-- ---------------------------------------------------------------------------
-- HOW NULLs MAP: rate_bps 0, minimum_minor 0. DECIDED, NOT OVERLOOKED.
--
-- Both live columns are NULLABLE and several rows have NULL for both — every
-- rule for operator 0f89c637, plus Cash Out / Telco Load / Bills Payment /
-- Bank Transfer / Profit Remittance ('all') for operator 793e377b. Live
-- `calculateProfit` returns 0 for those, so today they earn nothing. Audit #5a
-- finding 9 flags this as possibly a seeding gap rather than an intention.
--
-- A migration is the wrong place to settle that question. Mapping NULL to the
-- confirmed 200/500 would start charging customers a fee that has never been
-- charged, on transactions the operator has already quoted, without anyone
-- deciding to. Mapping it to 0/0 preserves today's behaviour exactly and
-- leaves the decision where it belongs: gocash.set_fee_rule() opens a new
-- effective period whenever the operator sets a real price, and history stays
-- intact either way. The NOTICE in step 3 lists every zero-priced rule so the
-- question is visible rather than buried.
--
-- The same reasoning covers a (type) combination with no transaction_rules row
-- at all: step 2 writes a 0/0 'all' rule so every operator has all six types
-- on the books, because "no rule" and "a rule that earns nothing" behave
-- identically today and only the second one is greppable.
--
-- ---------------------------------------------------------------------------
-- WHY effective_from IS BACKDATED AND NOT NOW()
--
-- Amending a confirmed transaction reverses its entry and reposts it at the
-- rate that applied ON THE DAY — gocash.fee_rule_at(..., p_at). With
-- effective_from = NOW(), fee_rule_at() returns NO ROW for any timestamp
-- before this migration, so amending ANY pre-existing transaction would
-- reprice it at a zero fee and the reversal would not reproduce the original.
-- The one confirmed transaction live is dated 2026-02-22.
--
-- The constant below predates the product itself, so no receipt can fall in
-- front of it — including one dated wrongly by OCR, which is a real failure
-- mode here. It is a concrete timestamp rather than '-infinity' so that
-- anything rendering the rule's start date gets a value it can parse.
-- Step 3 asserts it really is earlier than the oldest transaction on file.
--
-- !! APPLY AS supabase_admin !!
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Convert every active pricing rule.
--
-- rounding is not carried over because transaction_rules has no such column:
-- live rounding is a hardcoded Math.ceil in calculateProfit for Cash In and
-- Cash Out only. That behaviour is reproduced here as data.
--
-- platform is COALESCEd because transaction_rules.platform is nullable with a
-- DEFAULT of 'all'; fee_rules.platform is NOT NULL and CHECKs non-blank.
--
-- is_active IS NOT FALSE, not `= true`: the column is nullable, and a NULL
-- there has always behaved as active.
--
-- The NOT EXISTS makes this replayable. It also means a price already set
-- through set_fee_rule() before this migration lands is never overwritten by
-- the stale transaction_rules value.
-- ---------------------------------------------------------------------------

INSERT INTO gocash.fee_rules (
  operator_id, transaction_type, platform,
  rate_bps, minimum_minor, rounding, effective_from
)
SELECT
  r.operator_id,
  r.transaction_type,
  COALESCE(NULLIF(btrim(r.platform), ''), 'all'),
  -- PERCENT -> BASIS POINTS.
  COALESCE(round(r.profit_rate * 100), 0)::INTEGER,
  -- PESOS -> CENTAVOS.
  COALESCE(round(r.profit_minimum * 100), 0)::BIGINT,
  CASE WHEN r.transaction_type IN ('Cash In', 'Cash Out')
       THEN 'ceil_unit'          -- quoted in whole pesos across the counter
       ELSE 'nearest_minor'
  END,
  TIMESTAMPTZ '2020-01-01 00:00:00+00'
FROM gocash.transaction_rules r
WHERE r.is_active IS NOT FALSE
  AND r.transaction_type IN ('Cash In', 'Cash Out', 'Telco Load',
                             'Bills Payment', 'Bank Transfer', 'Profit Remittance')
  AND NOT EXISTS (
    SELECT 1 FROM gocash.fee_rules f
    WHERE f.operator_id      = r.operator_id
      AND f.transaction_type = r.transaction_type
      AND f.platform         = COALESCE(NULLIF(btrim(r.platform), ''), 'all')
  );

-- ---------------------------------------------------------------------------
-- 2. Every operator ends up with all six types.
--
-- A fallback 'all' rule for any type the operator has no row for. 0/0, for the
-- reason in the header: "no rule" earns nothing today, and this must not
-- change what anyone is charged.
-- ---------------------------------------------------------------------------

INSERT INTO gocash.fee_rules (
  operator_id, transaction_type, platform,
  rate_bps, minimum_minor, rounding, effective_from
)
SELECT
  o.id, t.transaction_type, 'all',
  0, 0,
  CASE WHEN t.transaction_type IN ('Cash In', 'Cash Out')
       THEN 'ceil_unit' ELSE 'nearest_minor' END,
  TIMESTAMPTZ '2020-01-01 00:00:00+00'
FROM gocash.operators o
CROSS JOIN (VALUES
  ('Cash In'), ('Cash Out'), ('Telco Load'),
  ('Bills Payment'), ('Bank Transfer'), ('Profit Remittance')
) AS t(transaction_type)
WHERE NOT EXISTS (
  SELECT 1 FROM gocash.fee_rules f
  WHERE f.operator_id      = o.id
    AND f.transaction_type = t.transaction_type
    AND f.platform         = 'all'
);

-- ---------------------------------------------------------------------------
-- 3. VERIFICATION — these raise, they do not warn.
-- ---------------------------------------------------------------------------

-- 3a. The 100x check. See the header.
DO $verify_units$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
           format('operator %s %s/%s: rate_bps=%s minimum_minor=%s',
                  operator_id, transaction_type, platform, rate_bps, minimum_minor),
           E'\n  ')
    INTO v_bad
  FROM gocash.fee_rules
  WHERE (rate_bps      > 0 AND rate_bps      < 10)     -- under 0.10%
     OR (minimum_minor > 0 AND minimum_minor < 100);   -- under PHP 1.00

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      E'fee_rules look like a raw copy of transaction_rules rather than a converted one — profit_rate is a PERCENT and profit_minimum is PESOS, so both need x100:\n  %',
      v_bad;
  END IF;
END;
$verify_units$;

-- 3b. The confirmed 2% / PHP 5 pricing survived the conversion.
--
-- Named explicitly rather than left to 3a's band check: 3a proves nothing was
-- divided by 100, this proves the rows that were supposed to come out at
-- 200/500 actually did.
DO $verify_confirmed$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
           format('operator %s %s/%s: source %s%% / PHP %s became %s bps / %s centavos',
                  r.operator_id, r.transaction_type, r.platform,
                  r.profit_rate, r.profit_minimum, f.rate_bps, f.minimum_minor),
           E'\n  ')
    INTO v_bad
  FROM gocash.transaction_rules r
  JOIN gocash.fee_rules f
    ON f.operator_id      = r.operator_id
   AND f.transaction_type = r.transaction_type
   AND f.platform         = COALESCE(NULLIF(btrim(r.platform), ''), 'all')
  WHERE r.is_active IS NOT FALSE
    AND (f.rate_bps      <> COALESCE(round(r.profit_rate    * 100), 0)
      OR f.minimum_minor <> COALESCE(round(r.profit_minimum * 100), 0));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION E'a seeded fee rule does not match its source row:\n  %', v_bad;
  END IF;
END;
$verify_confirmed$;

-- 3c. The backdating actually works: for every transaction on file, the rule
--     that priced it is resolvable AT ITS OWN DATE.
--
-- This is the assertion that would have caught effective_from = NOW(). It
-- calls gocash.fee_rule_at() — the same function an amend path calls — rather
-- than re-deriving the comparison, so it tests the behaviour and not a
-- restatement of it. Platform 'all' is used because that is the fallback
-- gocash resolves to when no platform-specific rule exists, and the one live
-- transaction carries platform 'Unknown'.
DO $verify_backdate$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
           format('transaction %s (%s, %s) dated %s has no fee rule in force at that time',
                  t.id, t.transaction_type, t.platform,
                  COALESCE(t.transaction_date, t.created_at)),
           E'\n  ')
    INTO v_bad
  FROM gocash.transactions t
  WHERE t.transaction_type IN ('Cash In', 'Cash Out', 'Telco Load',
                               'Bills Payment', 'Bank Transfer', 'Profit Remittance')
    AND (gocash.fee_rule_at(t.operator_id, t.transaction_type, 'all',
                            COALESCE(t.transaction_date, t.created_at))).id IS NULL;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      E'effective_from is not backdated far enough — amending these would reprice them at a zero fee:\n  %',
      v_bad;
  END IF;
END;
$verify_backdate$;

-- 3d. Report what is priced at zero, so the open question from Audit #5a
--     finding 9 is visible in the migration output instead of only in a
--     comment nobody reads.
DO $report_zero$
DECLARE
  v_zero TEXT;
  v_n    INT;
BEGIN
  SELECT count(*), string_agg(format('%s/%s', transaction_type, platform), ', '
                              ORDER BY operator_id, transaction_type, platform)
    INTO v_n, v_zero
  FROM gocash.fee_rules
  WHERE rate_bps = 0 AND minimum_minor = 0;

  IF v_n > 0 THEN
    RAISE NOTICE 'seeded % fee rule(s) that earn NOTHING (source profit_rate and '
                 'profit_minimum were NULL, or there was no rule at all): %',
                 v_n, v_zero;
    RAISE NOTICE 'this preserves current behaviour. If any of these should charge '
                 'the confirmed 2%% / PHP 5, set it with '
                 'gocash.set_fee_rule(operator, type, platform, 200, 500) — that '
                 'opens a new effective period and leaves history intact.';
  END IF;

  RAISE NOTICE 'fee_rules now holds % rule(s) across % operator(s)',
    (SELECT count(*) FROM gocash.fee_rules),
    (SELECT count(DISTINCT operator_id) FROM gocash.fee_rules);
END;
$report_zero$;

COMMIT;

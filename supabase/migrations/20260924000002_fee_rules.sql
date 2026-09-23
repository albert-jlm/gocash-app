-- ===========================================================================
-- fee_rules — the part of the model that IS operator-configurable.
--
-- Replaces `transaction_rules`. That table mixed two things with very
-- different natures: the three delta_* multipliers (which direction money
-- moves — a fact about the transaction) and profit_rate/profit_minimum (what
-- the operator charges — a genuine preference). Making direction editable is
-- why four of six types have been destroying money. Direction now lives in
-- code (supabase/functions/_core/postings.ts); only pricing is data.
--
-- WHY EFFECTIVE DATING
-- Postings are reversible-and-repostable. Amending a confirmed transaction
-- reverses its entry and posts a new one — and it must reprice using the rate
-- that applied ON THE DAY, not today's. Without effective_from/to, raising a
-- fee would silently rewrite the earnings on every historical transaction
-- anyone ever amends. The exclusion constraint makes overlapping periods
-- impossible rather than merely discouraged.
--
-- Confirmed pricing: ceil(max(amount x 2%, PHP 5)) -> rate_bps 200,
-- minimum_minor 500, rounding 'ceil_unit'.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

-- Needed for an exclusion constraint that mixes equality on uuid/text with
-- range overlap. Supabase keeps extensions in their own schema.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE gocash.fee_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,

  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
                     'Cash In', 'Cash Out', 'Telco Load',
                     'Bills Payment', 'Bank Transfer', 'Profit Remittance')),
  -- A platform code, or 'all' as the fallback. An exact match wins over 'all'
  -- (see resolveFeeRule in _core/fees.ts) so a generic rule can never silently
  -- override platform-specific pricing.
  platform         TEXT NOT NULL DEFAULT 'all' CHECK (btrim(platform) <> ''),

  -- Basis points, so the rate is an exact integer: 200 = 2.00%. The old
  -- NUMERIC(6,4) percentage invited the same float drift as the money columns.
  rate_bps         INTEGER NOT NULL DEFAULT 0
                     CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  -- Floor, in centavos. 500 = PHP 5.00.
  minimum_minor    BIGINT NOT NULL DEFAULT 0 CHECK (minimum_minor >= 0),

  -- Cash In and Cash Out round up to a whole peso: operators quote whole pesos
  -- across the counter. Other types keep centavo precision.
  rounding         TEXT NOT NULL DEFAULT 'ceil_unit'
                     CHECK (rounding IN ('ceil_unit', 'nearest_minor')),

  effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to     TIMESTAMPTZ,          -- NULL = still in force

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fee_rules_period_sane
    CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- One price per (operator, type, platform) at any instant. Attempting to
  -- overlap raises rather than leaving two rules and letting row order decide,
  -- which is how the old `transaction_rules` produced ambiguous pricing.
  CONSTRAINT fee_rules_no_overlap EXCLUDE USING gist (
    operator_id      WITH =,
    transaction_type WITH =,
    platform         WITH =,
    tstzrange(effective_from, effective_to) WITH &&
  )
);

CREATE INDEX fee_rules_lookup_idx
  ON gocash.fee_rules (operator_id, transaction_type, platform)
  WHERE effective_to IS NULL;

CREATE TRIGGER fee_rules_touch_updated_at
  BEFORE UPDATE ON gocash.fee_rules
  FOR EACH ROW EXECUTE FUNCTION gocash.update_updated_at();

-- ---------------------------------------------------------------------------
-- Changing a price.
--
-- Not a plain UPDATE: a price change closes the current period and opens a new
-- one, so history stays intact. Exposed as a function because doing it in two
-- client statements would leave a window where the constraint is violated or
-- no rule is in force.
--
-- SECURITY DEFINER, and unlike every pre-existing function in this schema it
-- actually checks the caller. Audit #5a existed because six functions took
-- p_operator_id on trust.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION gocash.set_fee_rule(
  p_operator_id      UUID,
  p_transaction_type TEXT,
  p_platform         TEXT,
  p_rate_bps         INTEGER,
  p_minimum_minor    BIGINT,
  p_rounding         TEXT DEFAULT 'ceil_unit'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, extensions, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_id  UUID;
BEGIN
  IF NOT (
    gocash.is_my_operator(p_operator_id)
    OR pg_has_role(current_user, 'service_role', 'MEMBER')
  ) THEN
    RAISE EXCEPTION 'not permitted for operator %', p_operator_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Close the period currently in force, if any.
  UPDATE gocash.fee_rules
     SET effective_to = v_now, updated_at = v_now
   WHERE operator_id = p_operator_id
     AND transaction_type = p_transaction_type
     AND platform = p_platform
     AND effective_to IS NULL
     AND effective_from < v_now;   -- a rule starting exactly now is replaced below

  -- A rule created in this same instant would collide with the new row, so
  -- remove it rather than leaving the caller with a constraint violation.
  DELETE FROM gocash.fee_rules
   WHERE operator_id = p_operator_id
     AND transaction_type = p_transaction_type
     AND platform = p_platform
     AND effective_from >= v_now;

  INSERT INTO gocash.fee_rules (
    operator_id, transaction_type, platform,
    rate_bps, minimum_minor, rounding, effective_from
  ) VALUES (
    p_operator_id, p_transaction_type, p_platform,
    p_rate_bps, p_minimum_minor, p_rounding, v_now
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- The event trigger from 20260923000002 revokes EXECUTE on every new function
-- in this schema, so access is stated explicitly. This is the intended
-- friction: the original hole existed because the grant was a default nobody
-- chose.
GRANT EXECUTE ON FUNCTION
  gocash.set_fee_rule(UUID, TEXT, TEXT, INTEGER, BIGINT, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Readable by the owning operator; all writes go through set_fee_rule() so the
-- effective-dating invariant cannot be sidestepped by a direct UPDATE. Note
-- that a SELECT-only policy set means the missing-WITH-CHECK problem from
-- Audit #5 finding 15 cannot recur here.
-- ---------------------------------------------------------------------------

ALTER TABLE gocash.fee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY fee_rules_select_own ON gocash.fee_rules
  FOR SELECT USING (gocash.is_my_operator(operator_id));

GRANT SELECT ON gocash.fee_rules TO authenticated;

-- ---------------------------------------------------------------------------
-- The rule in force at a given instant. This is what an amend path must call:
-- passing the original transaction's date reprices it at the historical rate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION gocash.fee_rule_at(
  p_operator_id      UUID,
  p_transaction_type TEXT,
  p_platform         TEXT,
  p_at               TIMESTAMPTZ DEFAULT NOW()
)
RETURNS gocash.fee_rules
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = gocash, public
AS $$
  SELECT * FROM gocash.fee_rules r
  WHERE r.operator_id = p_operator_id
    AND r.transaction_type = p_transaction_type
    AND r.platform = p_platform
    AND r.effective_from <= p_at
    AND (r.effective_to IS NULL OR r.effective_to > p_at)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION
  gocash.fee_rule_at(UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;

COMMIT;

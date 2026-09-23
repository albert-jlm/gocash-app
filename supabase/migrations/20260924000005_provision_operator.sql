-- ===========================================================================
-- gocash.provision_operator() — signup, in one transaction.
--
-- WHAT IT REPLACES
-- `initialize_operator_defaults`, an AFTER INSERT trigger on gocash.operators.
-- A trigger cannot take arguments, so every new operator got the same three
-- hardcoded wallets (GCash, MariBank, Cash — no Maya, though both live
-- operators have one) and the same six hardcoded delta multipliers. There was
-- no way to say which platforms this operator actually uses or what they are
-- starting with, which is precisely what a signup form collects. The onboarding
-- screen worked around it by writing its own rules afterwards — and seeded them
-- INVERTED relative to production (Audit #5a, new finding 6), so every operator
-- onboarded with that code got backwards rules. Both halves of that problem
-- disappear when provisioning is one parameterised call instead of a trigger
-- plus a client-side fixup.
--
-- It also could not produce an opening entry at all: a trigger on operators
-- runs before anyone has said what the opening balances are, so balances were
-- typed straight into wallets.balance with no counterparty. Here the opening
-- balances are an argument, and they are posted as a balanced entry against
-- equity like any other.
--
-- ---------------------------------------------------------------------------
-- THE CALLER CHECK READS THE SIGNED JWT CLAIM. THIS IS NOT INTERCHANGEABLE
-- WITH A ROLE TEST.
--
-- A prior version of this exact pattern guarded with
--   pg_has_role(current_user, 'service_role', 'MEMBER')
-- which is unconditionally TRUE inside a SECURITY DEFINER function: current_user
-- is the function's OWNER (supabase_admin), and pg_has_role returns true for a
-- superuser against any role. session_user is no better — PostgREST connects as
-- `authenticator`, itself a member of service_role. The full account is in the
-- comment block in 20260924000002_fee_rules.sql; a review proved tenant A could
-- rewrite tenant B's pricing through that guard.
--
-- current_setting('request.jwt.claims', true)::jsonb ->> 'role' is the only
-- caller identity that cannot be forged from inside the function, because it
-- comes from the token PostgREST verified.
--
-- And unlike gocash.set_fee_rule, there is no is_my_operator() alternative
-- here: at signup the caller has no operator row yet, and p_user_id is
-- caller-supplied. Trusting p_user_id from a client would be Audit #5a's exact
-- defect — an account-takeover primitive rather than a cross-tenant write.
-- So: service_role only, and the GRANT at the bottom names service_role only.
--
-- ---------------------------------------------------------------------------
-- p_opening IS IN CENTAVOS. { "Cash": 2000000, "GCash": 150000 }
--
-- Integer centavos, matching gocash.postings.amount_minor and the integer
-- representation supabase/functions/_core works in, so nothing converts at the
-- boundary and there is no second notion of what "the amount" is. A non-integer
-- value is REJECTED rather than rounded: a caller passing pesos is the 100x
-- error this rebuild keeps running into, and 5000.50 is the shape that catches
-- it. Whole-peso values cannot be distinguished, which is why the unit is
-- stated in the argument's own error messages and here.
--
-- !! APPLY AS supabase_admin !!
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION gocash.provision_operator(
  p_user_id   UUID,
  p_name      TEXT,
  p_email     TEXT,
  p_platforms TEXT[]  DEFAULT ARRAY['GCash', 'MariBank', 'Maya'],
  p_opening   JSONB   DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, extensions, public
AS $$
DECLARE
  -- Same constant as 20260924000004: earlier than the product exists, so no
  -- receipt — including one misdated by OCR — can fall in front of the first
  -- rule and be repriced at zero on amendment.
  c_rule_epoch CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '2020-01-01 00:00:00+00';

  v_operator_id UUID;
  v_entry_id    UUID;
  v_platform    TEXT;
  v_platforms   TEXT[];
  v_key         TEXT;
  v_value       JSONB;
  v_minor       NUMERIC;
  v_account_id  UUID;
  v_total       BIGINT := 0;
  v_legs        INT    := 0;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Who is calling.
  --
  -- NULLIF because PostgREST sets request.jwt.claims to the empty string on an
  -- unauthenticated request, and ''::jsonb raises an invalid-input error rather
  -- than returning NULL — the guard would fail closed, but with a message about
  -- JSON syntax instead of about permission.
  -- -------------------------------------------------------------------------
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       ''
     ) <> 'service_role'
  THEN
    RAISE EXCEPTION 'provision_operator may only be called with the service role'
      USING ERRCODE = 'insufficient_privilege',
            HINT    = 'Signup runs in an Edge Function using the service-role key. '
                      'p_user_id is caller-supplied, so a client-reachable version '
                      'of this would let anyone provision an operator onto anyone '
                      'else''s auth user.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. Arguments.
  -- -------------------------------------------------------------------------
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'p_name is required';
  END IF;
  IF COALESCE(btrim(p_email), '') = '' THEN
    RAISE EXCEPTION 'p_email is required';
  END IF;
  IF p_opening IS NOT NULL AND jsonb_typeof(p_opening) <> 'object' THEN
    RAISE EXCEPTION 'p_opening must be a JSON object of account name -> opening balance '
                    'in CENTAVOS, e.g. {"Cash": 2000000}; got %', jsonb_typeof(p_opening);
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Already provisioned?
  --
  -- Returns the existing operator rather than raising. Signup is a network call
  -- that can succeed and lose its response, and the client then retries — the
  -- same failure mode ledger_entries.idempotency_key exists for. Everything
  -- below happens in one transaction, so there is no half-provisioned state to
  -- resume: the operator either exists complete or does not exist.
  -- -------------------------------------------------------------------------
  SELECT o.id INTO v_operator_id
  FROM gocash.operators o WHERE o.user_id = p_user_id
  ORDER BY o.created_at LIMIT 1;

  IF v_operator_id IS NOT NULL THEN
    RAISE NOTICE 'user % already has operator %; provision_operator is a no-op',
      p_user_id, v_operator_id;
    RETURN v_operator_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. The operator.
  -- -------------------------------------------------------------------------
  INSERT INTO gocash.operators (user_id, email, name)
  VALUES (p_user_id, btrim(p_email), btrim(p_name))
  RETURNING id INTO v_operator_id;

  -- -------------------------------------------------------------------------
  -- 5. The chart of accounts.
  --
  -- cash + revenue + equity are not optional and are not configurable. Every
  -- one of the six transaction types in _core/postings.ts posts a cash leg;
  -- five of them post a revenue leg; Profit Remittance posts to equity, and so
  -- does the opening entry below. An operator missing any of the three cannot
  -- record the transaction that needs it, and the failure would surface at
  -- confirm time in front of them rather than here.
  -- -------------------------------------------------------------------------
  INSERT INTO gocash.accounts (operator_id, kind, name) VALUES
    (v_operator_id, 'cash',    'Cash'),
    (v_operator_id, 'revenue', 'Fee Revenue'),
    (v_operator_id, 'equity',  'Owner Equity');

  -- Trimmed, de-duplicated, blanks dropped. A signup form posting
  -- ["GCash", "", "gcash "] must not become three accounts or one blank one.
  SELECT array_agg(DISTINCT btrim(p) ORDER BY btrim(p))
    INTO v_platforms
  FROM unnest(COALESCE(p_platforms, ARRAY[]::TEXT[])) AS p
  WHERE btrim(p) <> '';

  FOREACH v_platform IN ARRAY COALESCE(v_platforms, ARRAY[]::TEXT[]) LOOP
    -- accounts is UNIQUE (operator_id, name), so a platform under one of the
    -- three reserved names would collide with the row just written and abort
    -- the whole signup with a constraint name for a message.
    IF v_platform IN ('Cash', 'Fee Revenue', 'Owner Equity') THEN
      RAISE EXCEPTION 'platform name "%" is reserved for the cash, revenue or equity account and '
                      'cannot be used as a platform name', v_platform;
    END IF;

    INSERT INTO gocash.accounts (operator_id, kind, name)
    VALUES (v_operator_id, 'platform', v_platform);

    -- operator_platforms is what the capture and settings screens read; the
    -- account is what the ledger posts to. Both are needed, and writing them
    -- together here is the point of provisioning being one call.
    INSERT INTO gocash.operator_platforms (operator_id, name, is_builtin)
    VALUES (v_operator_id, v_platform, v_platform IN ('GCash', 'MariBank', 'Maya'));
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 6. Default pricing: the confirmed ceil(max(amount x 2%, PHP 5)).
  --
  -- rate_bps 200 = 2.00%, minimum_minor 500 = PHP 5.00. Cash In and Cash Out
  -- round up to a whole peso because they are quoted across the counter; the
  -- other four keep centavo precision.
  --
  -- Unlike the backfill in 20260924000004 — which maps NULL pricing to zero so
  -- it does not start charging existing customers a fee they were never
  -- charged — a brand new operator has no history to preserve, so they get the
  -- real default.
  --
  -- effective_from is the epoch, not NOW(): a new operator may well upload a
  -- receipt dated before they signed up, and gocash.fee_rule_at() returns
  -- nothing for a date before the earliest rule, which would price it at zero.
  -- -------------------------------------------------------------------------
  INSERT INTO gocash.fee_rules (
    operator_id, transaction_type, platform,
    rate_bps, minimum_minor, rounding, effective_from
  )
  SELECT v_operator_id, t.transaction_type, 'all', 200, 500,
         CASE WHEN t.transaction_type IN ('Cash In', 'Cash Out')
              THEN 'ceil_unit' ELSE 'nearest_minor' END,
         c_rule_epoch
  FROM (VALUES
    ('Cash In'), ('Cash Out'), ('Telco Load'),
    ('Bills Payment'), ('Bank Transfer'), ('Profit Remittance')
  ) AS t(transaction_type);

  -- -------------------------------------------------------------------------
  -- 7. The opening entry.
  --
  -- Same shape and the same two edge cases as the backfill in
  -- 20260924000003: zero legs are skipped (postings CHECKs amount_minor <> 0),
  -- and if nothing is being carried forward NO ENTRY IS WRITTEN AT ALL. An
  -- empty entry commits silently — no trigger exists on ledger_entries that
  -- could fire on one — and then sits in gocash.unbalanced_entries forever.
  -- A signup with no opening balances is the normal case, not an error.
  -- -------------------------------------------------------------------------
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(COALESCE(p_opening, '{}'::jsonb)) LOOP
    IF jsonb_typeof(v_value) <> 'number' THEN
      RAISE EXCEPTION 'opening balance for "%" must be a number of CENTAVOS, got %',
        v_key, jsonb_typeof(v_value);
    END IF;

    v_minor := (v_value #>> '{}')::NUMERIC;

    -- A fractional value means the caller is sending pesos. Rounding it would
    -- book 1/100th of the intended balance without anyone noticing.
    IF v_minor <> trunc(v_minor) THEN
      RAISE EXCEPTION 'opening balance for "%" is %, which is not a whole number of '
                      'CENTAVOS — p_opening is in centavos, not pesos '
                      '(PHP 20,000.00 is 2000000)', v_key, v_minor;
    END IF;

    SELECT a.id INTO v_account_id
    FROM gocash.accounts a
    WHERE a.operator_id = v_operator_id AND a.name = v_key;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'opening balance names account "%", which was not created for this '
                      'operator; p_platforms was %', v_key, COALESCE(v_platforms, '{}');
    END IF;

    -- Opening balances describe what the operator HAS. Equity is the balancing
    -- leg computed below, and revenue starts at zero by definition — a signup
    -- cannot have earned fees yet. Accepting either would let the caller
    -- silently change what the equity leg means.
    IF v_key IN ('Fee Revenue', 'Owner Equity') THEN
      RAISE EXCEPTION 'an opening balance cannot be given for "%"; equity is derived '
                      'from the accounts that hold money', v_key;
    END IF;

    IF v_minor <> 0 THEN
      IF v_entry_id IS NULL THEN
        INSERT INTO gocash.ledger_entries
          (operator_id, kind, memo, idempotency_key, created_by)
        VALUES
          (v_operator_id, 'opening', 'Opening balances at signup',
           'provision-opening-' || v_operator_id::TEXT, 'provision_operator')
        RETURNING id INTO v_entry_id;
      END IF;

      INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
      VALUES (v_entry_id, v_account_id, v_operator_id, v_minor::BIGINT);

      v_total := v_total + v_minor::BIGINT;
      v_legs  := v_legs + 1;
    END IF;
  END LOOP;

  -- The owner's stake. Skipped when the opening balances happen to cancel out,
  -- because a zero leg is rejected and two legs already summing to zero are a
  -- complete entry.
  IF v_entry_id IS NOT NULL AND v_total <> 0 THEN
    INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
    SELECT v_entry_id, a.id, v_operator_id, -v_total
    FROM gocash.accounts a
    WHERE a.operator_id = v_operator_id AND a.kind = 'equity';
  END IF;

  RAISE NOTICE 'provisioned operator % for user %: % platform account(s), 6 fee rules, '
               '% opening leg(s)',
    v_operator_id, p_user_id, COALESCE(array_length(v_platforms, 1), 0), v_legs;

  RETURN v_operator_id;
END;
$$;

-- The event trigger from 20260923000002 revokes EXECUTE on every new function
-- in gocash, so this grant has to be stated. service_role ONLY — see the
-- caller-check note in the header: p_user_id is caller-supplied, so a grant to
-- `authenticated` would let any signed-in user attach an operator to any auth
-- user, and a grant to `anon` would do it with no session at all.
GRANT EXECUTE ON FUNCTION
  gocash.provision_operator(UUID, TEXT, TEXT, TEXT[], JSONB)
  TO service_role;

COMMENT ON FUNCTION gocash.provision_operator(UUID, TEXT, TEXT, TEXT[], JSONB) IS
  'Signup in one transaction: operator, chart of accounts, platform accounts, '
  'operator_platforms, default fee_rules and the opening entry. p_opening is '
  'account name -> opening balance in CENTAVOS. service_role only; the caller '
  'is identified from the signed request.jwt.claims, never from current_user.';

-- ---------------------------------------------------------------------------
-- Retire the trigger.
--
-- Dropped AFTER provision_operator exists so the schema is never in a state
-- where neither path can create an operator's defaults. The trigger also
-- writes gocash.wallets and gocash.transaction_rules, both of which
-- 20260924000006 drops — leaving it would make every INSERT on operators fail
-- outright one migration later.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS init_operator_defaults ON gocash.operators;
DROP FUNCTION IF EXISTS gocash.initialize_operator_defaults();

COMMIT;

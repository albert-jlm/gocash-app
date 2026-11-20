-- ===========================================================================
-- Adding and retiring wallets after signup.
--
-- provision_operator creates the platform accounts an operator starts with.
-- Nothing could add one afterwards: Settings → Platforms wrote to
-- gocash.accounts from the browser, which has (correctly) only SELECT there.
--
-- A new wallet needs no fee rules of its own. The seeded rules are per
-- transaction type with platform 'all', and fee_rule_at falls back to those.
-- Its starting balance is posted from Settings → Wallets as a count against
-- zero, the same way any balance is corrected.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

/**
 * Create a platform account, or bring a retired one of the same name back.
 * Returns the account id. Names are compared case-insensitively so "gcash"
 * cannot be added beside "GCash".
 */
CREATE OR REPLACE FUNCTION gocash.add_platform(
  p_operator_id UUID,
  p_name        TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_name    TEXT := btrim(COALESCE(p_name, ''));
  v_id      UUID;
  v_kind    TEXT;
  v_active  BOOLEAN;
  v_stored  TEXT;
BEGIN
  IF NOT (
    gocash.is_my_operator(p_operator_id)
    OR COALESCE(
         NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'not permitted for operator %', p_operator_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_name = '' OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'a wallet name must be 1 to 40 characters'
      USING ERRCODE = 'GC010';
  END IF;

  IF lower(v_name) IN ('cash', 'fee revenue', 'owner equity', 'unknown', 'all') THEN
    RAISE EXCEPTION 'the name "%" is reserved', v_name
      USING ERRCODE = 'GC010';
  END IF;

  SELECT id, kind, is_active, name INTO v_id, v_kind, v_active, v_stored
  FROM gocash.accounts
  WHERE operator_id = p_operator_id AND lower(name) = lower(v_name);

  IF v_id IS NOT NULL THEN
    IF v_kind <> 'platform' THEN
      RAISE EXCEPTION 'the name "%" is reserved', v_name USING ERRCODE = 'GC010';
    END IF;
    IF v_active THEN
      RAISE EXCEPTION 'a wallet named "%" already exists', v_stored
        USING ERRCODE = 'GC011';
    END IF;
    -- Retired earlier. Its history is still attached to it, so it comes back
    -- as the same account rather than a second one with the same name.
    UPDATE gocash.accounts SET is_active = TRUE WHERE id = v_id;
    UPDATE gocash.operator_platforms SET is_active = TRUE
    WHERE operator_id = p_operator_id AND name = v_stored;
    RETURN v_id;
  END IF;

  INSERT INTO gocash.accounts (operator_id, kind, name)
  VALUES (p_operator_id, 'platform', v_name)
  RETURNING id INTO v_id;

  INSERT INTO gocash.operator_platforms (operator_id, name, is_builtin)
  VALUES (p_operator_id, v_name, FALSE);

  RETURN v_id;
END;
$$;

/**
 * Retire a wallet: it stops being offered for new transactions. Its history
 * stays. Refused while it still holds a balance, because a hidden wallet with
 * money in it is money the books can no longer explain on screen.
 */
CREATE OR REPLACE FUNCTION gocash.retire_platform(
  p_operator_id UUID,
  p_account_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_name    TEXT;
  v_kind    TEXT;
  v_balance BIGINT;
BEGIN
  IF NOT (
    gocash.is_my_operator(p_operator_id)
    OR COALESCE(
         NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'not permitted for operator %', p_operator_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name, kind INTO v_name, v_kind
  FROM gocash.accounts
  WHERE id = p_account_id AND operator_id = p_operator_id
  FOR UPDATE;

  IF NOT FOUND OR v_kind <> 'platform' THEN
    RAISE EXCEPTION 'wallet not found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_balance
  FROM gocash.postings WHERE account_id = p_account_id;

  IF v_balance <> 0 THEN
    RAISE EXCEPTION '"%" still holds a balance of % centavos', v_name, v_balance
      USING ERRCODE = 'GC012';
  END IF;

  UPDATE gocash.accounts SET is_active = FALSE WHERE id = p_account_id;
  UPDATE gocash.operator_platforms SET is_active = FALSE
  WHERE operator_id = p_operator_id AND name = v_name;
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.add_platform(UUID, TEXT)    TO service_role;
GRANT EXECUTE ON FUNCTION gocash.retire_platform(UUID, UUID) TO service_role;

COMMIT;

-- ===========================================================================
-- The shop's own numbers and accounts.
--
-- A receipt shows which way money moved, not why. When the other side of a
-- receipt is the shop itself (its own Maya number, its own MariBank account)
-- the movement is a Wallet Transfer, not a customer transaction. This table is
-- how the reader knows: each row says "this number, or this account number,
-- is my <wallet>".
--
-- It also replaces the two phone numbers hardcoded in the receipt code as an
-- "operator blacklist": a number listed here is never taken for a customer's.
--
-- Every identifier belongs to one of the operator's wallets. An account the
-- shop does not track as a wallet has no row here; money sent to it has left
-- the books this app keeps.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

CREATE TABLE gocash.operator_identifiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL,
  -- 'mobile': a PH mobile number, stored as 09XXXXXXXXX.
  -- 'account': a bank or wallet account number, stored as digits only.
  kind        TEXT NOT NULL CHECK (kind IN ('mobile', 'account')),
  value       TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT operator_identifiers_value_shape CHECK (
    (kind = 'mobile'  AND value ~ '^09[0-9]{9}$')
    OR (kind = 'account' AND value ~ '^[0-9]{4,24}$')
  ),
  -- One meaning per number: it cannot be both "my GCash" and "my Maya".
  CONSTRAINT operator_identifiers_unique UNIQUE (operator_id, kind, value),
  -- The wallet must be this operator's.
  CONSTRAINT operator_identifiers_account_fk
    FOREIGN KEY (account_id, operator_id)
    REFERENCES gocash.accounts (id, operator_id) ON DELETE CASCADE
);

CREATE INDEX operator_identifiers_operator_idx ON gocash.operator_identifiers (operator_id);

ALTER TABLE gocash.operator_identifiers ENABLE ROW LEVEL SECURITY;

-- Owner only, to read as well as to change: these are the owner's personal
-- numbers, and staff do not need them to record transactions.
CREATE POLICY operator_identifiers_select_owner ON gocash.operator_identifiers
  FOR SELECT USING (gocash.is_operator_owner(operator_id));

GRANT SELECT ON gocash.operator_identifiers TO authenticated;
GRANT ALL    ON gocash.operator_identifiers TO service_role;

/**
 * Register one of the shop's own numbers or accounts against a wallet.
 * p_value is cleaned here: spaces and punctuation go, +63/63 becomes 0.
 *
 * Raises:
 *   GC030  not a usable mobile or account number
 *   GC031  the wallet is not an active wallet of this operator
 *   GC032  that number is already registered
 */
CREATE OR REPLACE FUNCTION gocash.add_identifier(
  p_operator_id UUID,
  p_account_id  UUID,
  p_kind        TEXT,
  p_value       TEXT,
  p_label       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_value TEXT := regexp_replace(COALESCE(p_value, ''), '[^0-9+]', '', 'g');
  v_id    UUID;
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_kind = 'mobile' THEN
    v_value := regexp_replace(v_value, '^\+?63', '0');
    IF v_value !~ '^09[0-9]{9}$' THEN
      RAISE EXCEPTION 'not a mobile number' USING ERRCODE = 'GC030';
    END IF;
  ELSIF p_kind = 'account' THEN
    v_value := regexp_replace(v_value, '[^0-9]', '', 'g');
    IF v_value !~ '^[0-9]{4,24}$' THEN
      RAISE EXCEPTION 'not an account number' USING ERRCODE = 'GC030';
    END IF;
  ELSE
    RAISE EXCEPTION 'kind must be mobile or account' USING ERRCODE = 'GC030';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM gocash.accounts
    WHERE id = p_account_id AND operator_id = p_operator_id
      AND kind = 'platform' AND is_active
  ) THEN
    RAISE EXCEPTION 'not one of your wallets' USING ERRCODE = 'GC031';
  END IF;

  IF EXISTS (
    SELECT 1 FROM gocash.operator_identifiers
    WHERE operator_id = p_operator_id AND kind = p_kind AND value = v_value
  ) THEN
    RAISE EXCEPTION 'already registered' USING ERRCODE = 'GC032';
  END IF;

  INSERT INTO gocash.operator_identifiers (operator_id, account_id, kind, value, label)
  VALUES (p_operator_id, p_account_id, p_kind, v_value,
          NULLIF(btrim(COALESCE(p_label, '')), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.add_identifier(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;


DROP FUNCTION IF EXISTS gocash.update_wallet_balance(UUID, TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION gocash.update_wallet_balance(
  p_operator_id    UUID,
  p_wallet_name    TEXT,
  p_delta          NUMERIC,
  p_transaction_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
BEGIN
  UPDATE gocash.wallets
  SET
    balance             = balance + p_delta,
    last_transaction_id = COALESCE(p_transaction_id, last_transaction_id),
    updated_at          = NOW()
  WHERE operator_id = p_operator_id
    AND wallet_name  = p_wallet_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found: % (operator %)', p_wallet_name, p_operator_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.update_wallet_balance(UUID, TEXT, NUMERIC, UUID) TO authenticated;

DROP FUNCTION IF EXISTS gocash.confirm_transaction_atomic(
  UUID,
  UUID,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  TEXT,
  NUMERIC,
  TEXT,
  TEXT,
  NUMERIC,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  BOOLEAN,
  JSONB
);

CREATE OR REPLACE FUNCTION gocash.confirm_transaction_atomic(
  p_transaction_id   UUID,
  p_operator_id      UUID,
  p_user_id          TEXT,
  p_platform_wallet  TEXT,
  p_platform_delta   NUMERIC,
  p_cash_delta       NUMERIC,
  p_status           TEXT,
  p_net_profit       NUMERIC,
  p_platform         TEXT,
  p_transaction_type TEXT,
  p_amount           NUMERIC,
  p_account_number   TEXT,
  p_reference_number TEXT,
  p_transaction_date TIMESTAMPTZ,
  p_was_edited       BOOLEAN,
  p_edit_history     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_confirmed_at TIMESTAMPTZ := NOW();
BEGIN
  UPDATE gocash.wallets
  SET
    balance             = balance + p_platform_delta,
    last_transaction_id = p_transaction_id,
    updated_at          = v_confirmed_at
  WHERE operator_id = p_operator_id
    AND wallet_name  = p_platform_wallet;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Platform wallet not found: % (operator %)', p_platform_wallet, p_operator_id;
  END IF;

  IF p_cash_delta <> 0 THEN
    UPDATE gocash.wallets
    SET
      balance             = balance + p_cash_delta,
      last_transaction_id = p_transaction_id,
      updated_at          = v_confirmed_at
    WHERE operator_id = p_operator_id
      AND wallet_name  = 'Cash';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cash wallet not found (operator %)', p_operator_id;
    END IF;
  END IF;

  UPDATE gocash.transactions
  SET
    status           = p_status,
    confirmed_at     = v_confirmed_at,
    confirmed_by     = p_user_id,
    net_profit       = p_net_profit,
    platform         = p_platform,
    transaction_type = p_transaction_type,
    amount           = p_amount,
    account_number   = p_account_number,
    reference_number = p_reference_number,
    transaction_date = p_transaction_date,
    was_edited       = p_was_edited,
    edit_history     = p_edit_history,
    updated_at       = v_confirmed_at
  WHERE id          = p_transaction_id
    AND operator_id = p_operator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or operator mismatch: %', p_transaction_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'confirmed_at', v_confirmed_at);
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.confirm_transaction_atomic(
  UUID,
  UUID,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  TEXT,
  NUMERIC,
  TEXT,
  TEXT,
  NUMERIC,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  BOOLEAN,
  JSONB
) TO authenticated;

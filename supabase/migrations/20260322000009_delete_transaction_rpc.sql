
CREATE OR REPLACE FUNCTION gocash.delete_transaction_atomic(
  p_transaction_id  UUID,
  p_operator_id     UUID,
  p_user_id         TEXT,
  p_platform_wallet TEXT,
  p_platform_delta  NUMERIC,
  p_cash_delta      NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_platform_wallet IS NOT NULL AND p_platform_delta <> 0 THEN
    UPDATE gocash.wallets
    SET balance    = balance + p_platform_delta,
        updated_at = v_now
    WHERE operator_id = p_operator_id
      AND wallet_name = p_platform_wallet
      AND is_active   = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform wallet not found: % (operator %)', p_platform_wallet, p_operator_id;
    END IF;
  END IF;

  IF p_cash_delta <> 0 THEN
    UPDATE gocash.wallets
    SET balance    = balance + p_cash_delta,
        updated_at = v_now
    WHERE operator_id = p_operator_id
      AND wallet_name = 'Cash'
      AND is_active   = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cash wallet not found (operator %)', p_operator_id;
    END IF;
  END IF;

  DELETE FROM gocash.transactions
  WHERE id          = p_transaction_id
    AND operator_id = p_operator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or operator mismatch: %', p_transaction_id;
  END IF;

  INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
  VALUES (
    p_operator_id,
    'transaction',
    p_transaction_id::text,
    'delete',
    jsonb_build_object('deleted_by', p_user_id, 'deleted_at', v_now)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.delete_transaction_atomic(
  UUID,
  UUID,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC
) TO authenticated;

CREATE TABLE IF NOT EXISTS gocash.receipt_deletion_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket       TEXT NOT NULL,
  path         TEXT NOT NULL,
  delete_after TIMESTAMPTZ NOT NULL,
  attempted_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT receipt_deletion_queue_bucket_not_blank CHECK (btrim(bucket) <> ''),
  CONSTRAINT receipt_deletion_queue_path_not_blank CHECK (btrim(path) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS receipt_deletion_queue_bucket_path_key
  ON gocash.receipt_deletion_queue (bucket, path);

CREATE INDEX IF NOT EXISTS receipt_deletion_queue_due_idx
  ON gocash.receipt_deletion_queue (delete_after)
  WHERE deleted_at IS NULL;

ALTER TABLE gocash.receipt_deletion_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION gocash.delete_transaction_atomic(
  p_transaction_id  UUID,
  p_operator_id     UUID,
  p_user_id         TEXT,
  p_platform_wallet TEXT,
  p_platform_delta  NUMERIC,
  p_cash_delta      NUMERIC,
  p_receipt_bucket  TEXT,
  p_receipt_path    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_audit_entity_id_type TEXT;
BEGIN
  IF p_platform_wallet IS NOT NULL AND p_platform_delta <> 0 THEN
    UPDATE gocash.wallets
    SET balance = balance + p_platform_delta,
        updated_at = v_now
    WHERE operator_id = p_operator_id
      AND wallet_name = p_platform_wallet
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform wallet not found: % (operator %)', p_platform_wallet, p_operator_id;
    END IF;
  END IF;

  IF p_cash_delta <> 0 THEN
    UPDATE gocash.wallets
    SET balance = balance + p_cash_delta,
        updated_at = v_now
    WHERE operator_id = p_operator_id
      AND wallet_name = 'Cash'
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cash wallet not found (operator %)', p_operator_id;
    END IF;
  END IF;

  IF p_receipt_bucket IS NOT NULL AND btrim(COALESCE(p_receipt_bucket, '')) <> ''
     AND p_receipt_path IS NOT NULL AND btrim(COALESCE(p_receipt_path, '')) <> '' THEN
    INSERT INTO gocash.receipt_deletion_queue (bucket, path, delete_after, attempted_at, deleted_at, last_error, updated_at)
    VALUES (
      p_receipt_bucket,
      p_receipt_path,
      v_now + INTERVAL '30 days',
      NULL,
      NULL,
      NULL,
      v_now
    )
    ON CONFLICT (bucket, path)
    DO UPDATE SET
      delete_after = EXCLUDED.delete_after,
      attempted_at = NULL,
      deleted_at = NULL,
      last_error = NULL,
      updated_at = v_now;
  END IF;

  -- Clear last_transaction_id references so the FK doesn't block deletion
  UPDATE gocash.wallets
  SET last_transaction_id = NULL,
      updated_at = v_now
  WHERE operator_id = p_operator_id
    AND last_transaction_id = p_transaction_id;

  DELETE FROM gocash.transactions
  WHERE id = p_transaction_id
    AND operator_id = p_operator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or operator mismatch: %', p_transaction_id;
  END IF;

  SELECT a.atttypid::regtype::text
  INTO v_audit_entity_id_type
  FROM pg_attribute AS a
  JOIN pg_class AS c
    ON c.oid = a.attrelid
  JOIN pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND c.relname = 'audit_logs'
    AND a.attname = 'entity_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_audit_entity_id_type = 'uuid' THEN
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'transaction',
      p_transaction_id,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'receipt_queued', p_receipt_path IS NOT NULL AND btrim(COALESCE(p_receipt_path, '')) <> ''
      )
    );
  ELSE
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'transaction',
      p_transaction_id::text,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'receipt_queued', p_receipt_path IS NOT NULL AND btrim(COALESCE(p_receipt_path, '')) <> ''
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.delete_transaction_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION gocash.delete_platform_atomic(
  p_operator_id UUID,
  p_platform_name TEXT,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_platform_id UUID;
  v_platform_name TEXT;
  v_wallet_balance NUMERIC := 0;
  v_transaction_count INTEGER := 0;
  v_rule_count INTEGER := 0;
  v_wallet_deleted_count INTEGER := 0;
  v_rules_deleted_count INTEGER := 0;
  v_platform_deleted_count INTEGER := 0;
  v_audit_entity_id_type TEXT;
BEGIN
  IF btrim(COALESCE(p_platform_name, '')) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_platform',
      'message', 'Platform name is required'
    );
  END IF;

  IF lower(btrim(p_platform_name)) = 'cash' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'cash_protected',
      'message', 'Cash is a permanent register and cannot be deleted'
    );
  END IF;

  SELECT id, name
  INTO v_platform_id, v_platform_name
  FROM gocash.operator_platforms
  WHERE operator_id = p_operator_id
    AND lower(name) = lower(btrim(p_platform_name))
  LIMIT 1;

  IF v_platform_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'not_found',
      'message', 'Platform not found'
    );
  END IF;

  SELECT COALESCE((
    SELECT balance
    FROM gocash.wallets
    WHERE operator_id = p_operator_id
      AND wallet_type = 'platform'
      AND lower(wallet_name) = lower(v_platform_name)
    LIMIT 1
  ), 0)
  INTO v_wallet_balance;

  SELECT COUNT(*)
  INTO v_transaction_count
  FROM gocash.transactions
  WHERE operator_id = p_operator_id
    AND platform = v_platform_name;

  SELECT COUNT(*)
  INTO v_rule_count
  FROM gocash.transaction_rules
  WHERE operator_id = p_operator_id
    AND platform = v_platform_name;

  IF COALESCE(v_wallet_balance, 0) <> 0 OR v_transaction_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'dependencies_exist',
      'message', 'Platform still has dependencies',
      'platform', v_platform_name,
      'wallet_balance', COALESCE(v_wallet_balance, 0),
      'transaction_count', v_transaction_count,
      'rule_count', v_rule_count
    );
  END IF;

  DELETE FROM gocash.transaction_rules
  WHERE operator_id = p_operator_id
    AND platform = v_platform_name;
  GET DIAGNOSTICS v_rules_deleted_count = ROW_COUNT;

  DELETE FROM gocash.wallets
  WHERE operator_id = p_operator_id
    AND wallet_type = 'platform'
    AND lower(wallet_name) = lower(v_platform_name);
  GET DIAGNOSTICS v_wallet_deleted_count = ROW_COUNT;

  DELETE FROM gocash.operator_platforms
  WHERE id = v_platform_id;
  GET DIAGNOSTICS v_platform_deleted_count = ROW_COUNT;

  SELECT a.atttypid::regtype::text
  INTO v_audit_entity_id_type
  FROM pg_attribute AS a
  JOIN pg_class AS c
    ON c.oid = a.attrelid
  JOIN pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND c.relname = 'audit_logs'
    AND a.attname = 'entity_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_audit_entity_id_type = 'uuid' THEN
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'platform',
      v_platform_id,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'platform_name', v_platform_name,
        'deleted_rule_count', v_rules_deleted_count,
        'deleted_wallet_count', v_wallet_deleted_count
      )
    );
  ELSE
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'platform',
      v_platform_id::text,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'platform_name', v_platform_name,
        'deleted_rule_count', v_rules_deleted_count,
        'deleted_wallet_count', v_wallet_deleted_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'platform', v_platform_name,
    'deleted_platform_count', v_platform_deleted_count,
    'deleted_wallet_count', v_wallet_deleted_count,
    'deleted_rule_count', v_rules_deleted_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.delete_platform_atomic(UUID, TEXT, TEXT) TO authenticated;

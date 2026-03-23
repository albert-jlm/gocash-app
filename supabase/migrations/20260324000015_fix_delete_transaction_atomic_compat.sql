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

ALTER TABLE IF EXISTS gocash.receipt_deletion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS gocash.receipt_deletion_queue NO FORCE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION gocash.delete_transaction_atomic(
  p_transaction_id  UUID,
  p_operator_id     UUID,
  p_user_id         TEXT,
  p_platform_wallet TEXT,
  p_platform_delta  NUMERIC,
  p_cash_delta      NUMERIC
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
  SELECT gocash.delete_transaction_atomic(
    p_transaction_id,
    p_operator_id,
    p_user_id,
    p_platform_wallet,
    p_platform_delta,
    p_cash_delta,
    NULL,
    NULL
  );
$$;

GRANT EXECUTE ON FUNCTION gocash.delete_transaction_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION gocash.delete_transaction_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;

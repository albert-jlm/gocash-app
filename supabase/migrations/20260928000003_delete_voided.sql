BEGIN;

ALTER TABLE gocash.transactions DROP CONSTRAINT transactions_status_check;
ALTER TABLE gocash.transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('uploaded', 'processing', 'awaiting_confirm', 'confirmed', 'voided', 'failed', 'deleted'));

CREATE OR REPLACE FUNCTION gocash.delete_voided_transaction(
  p_operator_id    UUID,
  p_transaction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_status TEXT;
  v_image  TEXT;
  v_posted BOOLEAN;
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status, image_url INTO v_status, v_image
  FROM gocash.transactions
  WHERE id = p_transaction_id AND operator_id = p_operator_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'voided' THEN
    RAISE EXCEPTION 'only a voided transaction can be deleted' USING ERRCODE = 'GC040';
  END IF;

  SELECT EXISTS (SELECT 1 FROM gocash.ledger_entries WHERE transaction_id = p_transaction_id)
  INTO v_posted;

  IF v_posted THEN
    UPDATE gocash.transactions
    SET status = 'deleted',
        account_number = NULL,
        reference_number = NULL,
        image_url = NULL,
        ai_raw_text = NULL,
        edit_history = NULL,
        processing_errors = NULL,
        idempotency_key = NULL
    WHERE id = p_transaction_id;
  ELSE
    DELETE FROM gocash.transactions WHERE id = p_transaction_id;
  END IF;

  RETURN jsonb_build_object('outcome', CASE WHEN v_posted THEN 'hidden' ELSE 'removed' END, 'image_url', v_image);
END;
$$;

REVOKE ALL ON FUNCTION gocash.delete_voided_transaction(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gocash.delete_voided_transaction(UUID, UUID) TO service_role;

COMMIT;

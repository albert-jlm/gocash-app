-- ===========================================================================
-- gocash.confirm_transaction — post the entry AND mark the draft confirmed,
-- in one database transaction.
--
-- Before this, confirm-transaction did three separate things from the Edge
-- Function: read the status, call post_entry, update the status. Two holes
-- followed from that (2026-11-18 evaluation, finding 1):
--
--   A. Two confirms for the same draft with DIFFERENT idempotency keys (two
--      devices, or a reload that mints a new key) both passed the status read
--      and both posted. The books balanced with the money counted twice.
--   B. The entry posted, the status update failed, and the draft stayed at
--      'awaiting_confirm' with an entry behind it. A reload then posted again.
--
-- Here the transactions row is locked first, so concurrent confirms queue up
-- and the second one sees 'confirmed'. The post and the status change commit
-- or roll back together, so state B cannot exist.
--
-- The unique index is the backstop for anything that reaches post_entry by
-- another route: one kind='transaction' entry per transaction. There is no
-- amend path today (a correction is void + a new transaction). If one is
-- built that reposts under the same transaction_id, this index has to become
-- "one UN-REVERSED entry", which a plain index cannot express.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_per_transaction
  ON gocash.ledger_entries (transaction_id)
  WHERE kind = 'transaction' AND transaction_id IS NOT NULL;

/**
 * p_fields carries the final, operator-approved values for the row:
 *   platform, transaction_type, amount, net_profit        (required)
 *   account_number, reference_number, transaction_date    (nullable)
 *   was_edited (boolean), edit_record (object, optional — appended to
 *   edit_history when present)
 *
 * Returns { "entry_id": uuid, "replayed": boolean }.
 *
 * replayed = true means this exact confirmation (same transaction, same key)
 * already succeeded and nothing was written this time. The caller should
 * report success: the usual cause is a lost response.
 *
 * Raises with a distinguishable SQLSTATE:
 *   GC001  the transaction is not awaiting confirmation
 *   GC002  the idempotency key was already used for a different entry
 *   GC003  the transaction already has a ledger entry
 */
CREATE OR REPLACE FUNCTION gocash.confirm_transaction(
  p_operator_id     UUID,
  p_transaction_id  UUID,
  p_legs            JSONB,
  p_fields          JSONB,
  p_idempotency_key TEXT,
  p_created_by      TEXT,
  p_memo            TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_status       TEXT;
  v_key_entry    UUID;
  v_key_tx       UUID;
  v_key_kind     TEXT;
  v_entry_id     UUID;
BEGIN
  -- Same caller check as post_entry: the signed JWT claim, never current_user.
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

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'confirm_transaction requires an idempotency key';
  END IF;

  IF p_fields IS NULL
     OR p_fields ->> 'platform' IS NULL
     OR p_fields ->> 'transaction_type' IS NULL
     OR p_fields ->> 'amount' IS NULL
     OR p_fields ->> 'net_profit' IS NULL THEN
    RAISE EXCEPTION
      'confirm_transaction needs platform, transaction_type, amount and net_profit in p_fields';
  END IF;

  -- The lock. Everything after this line is serialised per transaction.
  SELECT status INTO v_status
  FROM gocash.transactions
  WHERE id = p_transaction_id AND operator_id = p_operator_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction % not found for operator %',
      p_transaction_id, p_operator_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id, transaction_id, kind
    INTO v_key_entry, v_key_tx, v_key_kind
  FROM gocash.ledger_entries
  WHERE operator_id = p_operator_id AND idempotency_key = p_idempotency_key;

  -- A true replay: this transaction, this key, already posted.
  IF v_status = 'confirmed'
     AND v_key_entry IS NOT NULL
     AND v_key_tx = p_transaction_id
     AND v_key_kind = 'transaction' THEN
    RETURN jsonb_build_object('entry_id', v_key_entry, 'replayed', true);
  END IF;

  IF v_status <> 'awaiting_confirm' THEN
    RAISE EXCEPTION 'transaction % is %, not awaiting_confirm',
      p_transaction_id, v_status
      USING ERRCODE = 'GC001';
  END IF;

  -- The key exists but belongs to something else. post_entry would hand back
  -- that other entry's id and this transaction would be marked confirmed with
  -- nothing posted for it.
  IF v_key_entry IS NOT NULL THEN
    RAISE EXCEPTION 'idempotency key already used for another entry'
      USING ERRCODE = 'GC002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM gocash.ledger_entries
    WHERE transaction_id = p_transaction_id AND kind = 'transaction'
  ) THEN
    RAISE EXCEPTION 'transaction % already has a ledger entry', p_transaction_id
      USING ERRCODE = 'GC003';
  END IF;

  v_entry_id := gocash.post_entry(
    p_operator_id, 'transaction', p_legs, p_transaction_id,
    p_memo, p_idempotency_key, p_created_by, NULL
  );

  UPDATE gocash.transactions SET
    platform         = p_fields ->> 'platform',
    transaction_type = p_fields ->> 'transaction_type',
    amount           = (p_fields ->> 'amount')::NUMERIC,
    net_profit       = (p_fields ->> 'net_profit')::NUMERIC,
    account_number   = p_fields ->> 'account_number',
    reference_number = p_fields ->> 'reference_number',
    transaction_date = (p_fields ->> 'transaction_date')::TIMESTAMPTZ,
    status           = 'confirmed',
    confirmed_at     = NOW(),
    confirmed_by     = p_created_by,
    was_edited       = COALESCE((p_fields ->> 'was_edited')::BOOLEAN, FALSE),
    edit_history     = COALESCE(edit_history, '[]'::jsonb)
                       || CASE WHEN jsonb_typeof(p_fields -> 'edit_record') = 'object'
                               THEN jsonb_build_array(p_fields -> 'edit_record')
                               ELSE '[]'::jsonb END
  WHERE id = p_transaction_id AND operator_id = p_operator_id;

  RETURN jsonb_build_object('entry_id', v_entry_id, 'replayed', false);
END;
$$;

-- service_role only, like post_entry: the Edge Function calls this, the
-- browser never does.
GRANT EXECUTE ON FUNCTION
  gocash.confirm_transaction(UUID, UUID, JSONB, JSONB, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;

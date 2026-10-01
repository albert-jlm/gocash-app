-- ===========================================================================
-- Prerequisites for typing a transaction instead of photographing one.
--
-- Until now there was exactly one way to record a transaction: upload a
-- screenshot and let GPT-4o read it. `_process_transaction.ts` rejects any
-- request without `image_base64`, so OCR was not the fast path, it was the ONLY
-- path. This migration adds the two columns a second door needs.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. entry_source — how this row got here.
--
-- Two doors into one ledger, and without this column there is no way afterwards
-- to ask the only question that settles whether OCR earns its cost: are the
-- typed rows or the read rows the ones that get corrected, voided, or found
-- wrong at the next drawer count? That question cannot be answered
-- retroactively, which is why the column goes in before the second door opens.
--
-- The DEFAULT exists only to label rows that predate this column — every one of
-- which came through the OCR path, so 'ocr' is the true value, not a guess. It
-- is dropped immediately afterwards: a row whose origin is unknown should fail
-- to insert, not quietly claim to have been read from an image.
-- ---------------------------------------------------------------------------

ALTER TABLE gocash.transactions
  ADD COLUMN IF NOT EXISTS entry_source TEXT NOT NULL DEFAULT 'ocr';

ALTER TABLE gocash.transactions
  DROP CONSTRAINT IF EXISTS transactions_entry_source_check;

ALTER TABLE gocash.transactions
  ADD CONSTRAINT transactions_entry_source_check
  CHECK (entry_source IN ('ocr', 'manual', 'import'));

ALTER TABLE gocash.transactions
  ALTER COLUMN entry_source DROP DEFAULT;

COMMENT ON COLUMN gocash.transactions.entry_source IS
  'How the row was created: ocr (receipt image), manual (typed), import (statement parse). No default — state it explicitly.';

-- ---------------------------------------------------------------------------
-- 2. idempotency_key — so a double-tapped Save cannot leave two drafts.
--
-- gocash.post_entry is already idempotent, so a duplicate CONFIRM is harmless:
-- the second call returns the first entry and no money moves twice. A duplicate
-- DRAFT is a different failure. Two rows at 'awaiting_confirm' describing one
-- real transaction, and the operator — who has no way to tell them apart —
-- confirms both. Each gets its own key at that point, so the ledger accepts
-- both, and the drawer is short by one transaction with nothing in the books
-- looking wrong.
--
-- The existing `transactions_unique_reference_per_operator` index does not
-- cover this: UNIQUE treats NULLs as distinct, and a typed transaction often
-- has no reference number at all.
--
-- Partial index, not a column constraint: OCR rows pass NULL and must stay
-- unconstrained, because a screenshot upload is already deduplicated by its
-- reference number and has no client-generated key.
-- ---------------------------------------------------------------------------

ALTER TABLE gocash.transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE gocash.transactions
  DROP CONSTRAINT IF EXISTS transactions_idempotency_key_length;

ALTER TABLE gocash.transactions
  ADD CONSTRAINT transactions_idempotency_key_length
  CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 255);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique_idempotency_per_operator
  ON gocash.transactions (operator_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN gocash.transactions.idempotency_key IS
  'Client-generated, stable across retries of one user action. Deduplicates DRAFT creation; the ledger write is deduplicated separately by gocash.ledger_entries.idempotency_key.';

-- ---------------------------------------------------------------------------
-- 3. Assert both landed, and that the dedup actually dedups.
-- An index that exists but does not bite is the failure mode this project has
-- already hit twice (see 20260923000002).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_op  UUID;
  v_ok  BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_op FROM gocash.operators LIMIT 1;
  IF v_op IS NULL THEN
    RAISE NOTICE 'no operator to test against; skipping behavioural check';
    RETURN;
  END IF;

  INSERT INTO gocash.transactions
    (operator_id, transaction_type, platform, amount, status, entry_source, idempotency_key)
  VALUES (v_op, 'Cash In', 'GCash', 1, 'awaiting_confirm', 'manual', '__selftest__');

  BEGIN
    INSERT INTO gocash.transactions
      (operator_id, transaction_type, platform, amount, status, entry_source, idempotency_key)
    VALUES (v_op, 'Cash In', 'GCash', 1, 'awaiting_confirm', 'manual', '__selftest__');
  EXCEPTION WHEN unique_violation THEN
    v_ok := TRUE;
  END;

  DELETE FROM gocash.transactions WHERE idempotency_key = '__selftest__';

  IF NOT v_ok THEN
    RAISE EXCEPTION
      'duplicate draft was accepted: transactions_unique_idempotency_per_operator is not enforcing';
  END IF;

  RAISE NOTICE 'verified: a repeated draft idempotency_key is rejected';
END;
$$;

COMMIT;

-- ===========================================================================
-- gocash.void_transaction — reverse the entry AND mark the transaction voided,
-- in one database transaction. The counterpart of gocash.confirm_transaction.
--
-- void-transaction did this from the Edge Function as separate calls, with
-- the same holes confirm had (2026-11-18 evaluation):
--
--   - The reversal posted, the status update failed, and the retry was told
--     "already reversed". The transaction stayed 'confirmed' for good with a
--     net-zero ledger behind it.
--   - Voiding a draft set the status with no guard, so a confirm racing it
--     could leave a voided transaction with a live entry.
--   - A reused idempotency key made post_entry return some other entry; no
--     reversal was posted and the transaction was marked voided anyway.
--
-- Also here: the reference-number index stops counting voided transactions.
-- It covered them, so "void it and enter it again correctly" was impossible
-- for any transaction that had a reference number.
--
-- And post_entry is redefined so that two postings can share one database
-- transaction; see the note above it.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

-- Two things enforced this: a table constraint and a partial index, both
-- captured from the hand-built schema. The constraint cannot carry a WHERE
-- clause, so it goes; the index is rebuilt to skip voided rows.
ALTER TABLE gocash.transactions
  DROP CONSTRAINT IF EXISTS unique_reference_per_operator;
DROP INDEX IF EXISTS gocash.transactions_unique_reference_per_operator;
CREATE UNIQUE INDEX transactions_unique_reference_per_operator
  ON gocash.transactions (operator_id, reference_number)
  WHERE reference_number IS NOT NULL AND status <> 'voided';

-- ---------------------------------------------------------------------------
-- post_entry, redefined with one change: it no longer leaves the balance
-- check IMMEDIATE for the rest of the caller's transaction.
--
-- It ended with `SET CONSTRAINTS ALL IMMEDIATE`, which lasts until COMMIT. Any
-- second post_entry in the same transaction then failed on its first leg. No
-- caller did that until now; an amend (reverse and repost) would have, and so
-- does any test that confirms and voids in one transaction.
--
-- Everything else is identical to 20260924000007. The GRANT is repeated
-- because the event trigger from 20260923000002 revokes EXECUTE whenever a
-- function in this schema is created or replaced.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gocash.post_entry(
  p_operator_id     UUID,
  p_kind            TEXT,
  p_legs            JSONB,
  p_transaction_id  UUID    DEFAULT NULL,
  p_memo            TEXT    DEFAULT NULL,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_created_by      TEXT    DEFAULT NULL,
  p_reverses        UUID    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_entry_id   UUID;
  v_leg        JSONB;
  v_account_id UUID;
  v_kind       TEXT;
  v_platform   TEXT;
  v_amount     BIGINT;
  v_count      INT := 0;
  v_existing   UUID;
BEGIN
  -- Caller identity comes from the signed JWT claim, never from current_user.
  -- Inside a SECURITY DEFINER function current_user is the OWNER, and
  -- pg_has_role() against it returns true for a superuser regardless of who
  -- actually called — a guard written that way in an earlier migration was
  -- unconditionally true and let one tenant rewrite another's pricing.
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

  IF jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) < 2 THEN
    RAISE EXCEPTION 'post_entry needs an array of at least 2 legs, got %',
      COALESCE(jsonb_typeof(p_legs), 'null');
  END IF;

  -- Replay protection. The unique index would raise anyway, but returning the
  -- original id turns a retry into a no-op rather than an error the client has
  -- to interpret — which is the point of an idempotency key: it must also
  -- cover the case where the first call SUCCEEDED and the response was lost.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM gocash.ledger_entries
    WHERE operator_id = p_operator_id AND idempotency_key = p_idempotency_key;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  INSERT INTO gocash.ledger_entries (
    operator_id, kind, transaction_id, memo,
    idempotency_key, created_by, reverses_entry_id
  ) VALUES (
    p_operator_id, p_kind, p_transaction_id, p_memo,
    p_idempotency_key, p_created_by, p_reverses
  )
  RETURNING id INTO v_entry_id;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs)
  LOOP
    v_kind     := v_leg ->> 'kind';
    v_platform := v_leg ->> 'platform';
    v_amount   := (v_leg ->> 'amount_minor')::BIGINT;

    IF v_amount IS NULL THEN
      RAISE EXCEPTION 'leg % has no amount_minor', v_leg;
    END IF;

    -- A zero leg is meaningless and the posting CHECK rejects it. Skipping
    -- rather than raising lets a caller pass a fee leg unconditionally and
    -- have a zero fee simply not appear, which is what _core/postings.ts does.
    CONTINUE WHEN v_amount = 0;

    IF v_kind = 'platform' THEN
      IF v_platform IS NULL THEN
        RAISE EXCEPTION 'a platform leg must name its platform: %', v_leg;
      END IF;
      SELECT id INTO v_account_id FROM gocash.accounts
      WHERE operator_id = p_operator_id AND kind = 'platform' AND name = v_platform;

      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'operator % has no platform account named %',
          p_operator_id, v_platform;
      END IF;
    ELSE
      SELECT id INTO v_account_id FROM gocash.accounts
      WHERE operator_id = p_operator_id AND kind = v_kind;

      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'operator % has no % account', p_operator_id, v_kind;
      END IF;
    END IF;

    INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
    VALUES (v_entry_id, v_account_id, p_operator_id, v_amount);

    v_count := v_count + 1;
  END LOOP;

  IF v_count < 2 THEN
    RAISE EXCEPTION
      'entry % ended with % non-zero leg(s); an entry needs at least 2',
      v_entry_id, v_count;
  END IF;

  -- Force the deferred zero-sum trigger to fire NOW rather than at COMMIT, so
  -- a caller that wraps this in a larger transaction still gets the failure
  -- attributed to this call. Then put it back to DEFERRED: left IMMEDIATE, a
  -- second post_entry in the same transaction fails on its first leg, because
  -- one leg alone does not balance.
  SET CONSTRAINTS gocash.postings_must_balance IMMEDIATE;
  SET CONSTRAINTS gocash.postings_must_balance DEFERRED;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  gocash.post_entry(UUID, TEXT, JSONB, UUID, TEXT, TEXT, TEXT, UUID)
  TO service_role;

/**
 * Returns { "entry_id": uuid|null, "reversed_entry_id": uuid|null,
 *           "replayed": boolean }.
 *
 * entry_id is the reversal, or null when a draft was voided (nothing had been
 * posted, so there was nothing to reverse).
 *
 * replayed = true means the transaction was already voided and nothing was
 * written. Voiding is asking for a state, and the state holds; the caller
 * reports success.
 *
 * Raises:
 *   GC001  the transaction is in a state that cannot be voided
 *   GC002  the idempotency key was already used for a different entry
 *   GC004  the transaction is confirmed but has no ledger entry
 */
CREATE OR REPLACE FUNCTION gocash.void_transaction(
  p_operator_id     UUID,
  p_transaction_id  UUID,
  p_idempotency_key TEXT,
  p_created_by      TEXT,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_status    TEXT;
  v_entry     UUID;
  v_reversal  UUID;
  v_legs      JSONB;
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

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'void_transaction requires an idempotency key';
  END IF;

  -- The same lock confirm_transaction takes, so a void and a confirm on one
  -- transaction cannot interleave.
  SELECT status INTO v_status
  FROM gocash.transactions
  WHERE id = p_transaction_id AND operator_id = p_operator_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction % not found for operator %',
      p_transaction_id, p_operator_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_entry
  FROM gocash.ledger_entries
  WHERE transaction_id = p_transaction_id AND kind = 'transaction';

  IF v_entry IS NOT NULL THEN
    SELECT id INTO v_reversal
    FROM gocash.ledger_entries
    WHERE reverses_entry_id = v_entry;
  END IF;

  IF v_status = 'voided' THEN
    RETURN jsonb_build_object(
      'entry_id', v_reversal, 'reversed_entry_id', v_entry, 'replayed', true);
  END IF;

  -- A draft: nothing in the ledger, nothing to reverse.
  IF v_status = 'awaiting_confirm' AND v_entry IS NULL THEN
    UPDATE gocash.transactions SET status = 'voided'
    WHERE id = p_transaction_id AND operator_id = p_operator_id;
    RETURN jsonb_build_object(
      'entry_id', NULL, 'reversed_entry_id', NULL, 'replayed', false);
  END IF;

  IF v_status NOT IN ('confirmed', 'awaiting_confirm') THEN
    RAISE EXCEPTION 'cannot void a transaction that is %', v_status
      USING ERRCODE = 'GC001';
  END IF;

  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'transaction % is confirmed but has no ledger entry',
      p_transaction_id
      USING ERRCODE = 'GC004';
  END IF;

  -- The entry exists and is not yet reversed: reverse it. (If it IS already
  -- reversed, an earlier void posted the reversal and failed before changing
  -- the status. Finishing that void is all that is left to do.)
  IF v_reversal IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM gocash.ledger_entries
      WHERE operator_id = p_operator_id AND idempotency_key = p_idempotency_key
    ) THEN
      RAISE EXCEPTION 'idempotency key already used for another entry'
        USING ERRCODE = 'GC002';
    END IF;

    -- Every leg of the ORIGINAL POSTINGS, negated. Not recomputed from the
    -- transaction row: if a fee rule has changed since, a recomputed reversal
    -- would not cancel what was actually posted.
    SELECT jsonb_agg(
             CASE WHEN a.kind = 'platform'
                  THEN jsonb_build_object('kind', 'platform', 'platform', a.name,
                                          'amount_minor', -p.amount_minor)
                  ELSE jsonb_build_object('kind', a.kind,
                                          'amount_minor', -p.amount_minor)
             END)
      INTO v_legs
    FROM gocash.postings p
    JOIN gocash.accounts a ON a.id = p.account_id
    WHERE p.entry_id = v_entry;

    v_reversal := gocash.post_entry(
      p_operator_id, 'reversal', v_legs, p_transaction_id,
      CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL
           THEN 'Voided' ELSE 'Voided: ' || btrim(p_reason) END,
      p_idempotency_key, p_created_by, v_entry
    );
  END IF;

  UPDATE gocash.transactions SET status = 'voided'
  WHERE id = p_transaction_id AND operator_id = p_operator_id;

  RETURN jsonb_build_object(
    'entry_id', v_reversal, 'reversed_entry_id', v_entry, 'replayed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION
  gocash.void_transaction(UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;

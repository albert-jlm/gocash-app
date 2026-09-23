-- ===========================================================================
-- gocash.post_entry — the one way to write the ledger.
--
-- Every caller that moves money goes through this: confirm, void, amend,
-- reconcile, provision. It exists because writing an entry is inherently
-- multi-statement — one ledger_entries row plus N postings — and the zero-sum
-- constraint is DEFERRABLE INITIALLY DEFERRED, so the books are legitimately
-- unbalanced partway through. Doing that from an Edge Function as separate
-- PostgREST calls would mean separate transactions, and a crash between them
-- leaves a kind='transaction' entry that looks confirmed and moved nothing.
-- A review found exactly that hole and it is why unbalanced_entries uses a
-- LEFT JOIN.
--
-- Legs are given by ACCOUNT KIND, not by id or name. The old RPCs hardcoded
-- `wallet_name = 'Cash'`, which is a tenant blocker the moment an operator
-- renames their drawer, and a source of silent no-ops when the name does not
-- match. Here the caller says "the cash account" and this function resolves it.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

/**
 * p_legs is a JSON array of objects:
 *   { "kind": "cash"|"revenue"|"equity",            "amount_minor": <bigint> }
 *   { "kind": "platform", "platform": "GCash",      "amount_minor": <bigint> }
 *
 * Returns the new entry id. Raises if the legs do not balance, if any named
 * account does not exist for this operator, or if the idempotency key has been
 * used before.
 */
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
  -- attributed to this call.
  SET CONSTRAINTS ALL IMMEDIATE;

  RETURN v_entry_id;
END;
$$;

-- The event trigger from 20260923000002 revokes EXECUTE on every new function
-- in this schema. service_role only: the Edge Functions call this, the browser
-- never does. p_operator_id is caller-supplied, and the ownership check above
-- is defence in depth rather than the primary control.
GRANT EXECUTE ON FUNCTION
  gocash.post_entry(UUID, TEXT, JSONB, UUID, TEXT, TEXT, TEXT, UUID)
  TO service_role;

COMMIT;

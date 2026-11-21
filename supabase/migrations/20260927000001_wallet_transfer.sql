-- ===========================================================================
-- Wallet Transfer: the shop moving its own float.
--
-- A wallet runs low and is topped up from another; the drawer is full and
-- some is deposited. A screenshot of that looks exactly like a customer
-- transaction, and recorded as one it books a fee nobody paid, twice if both
-- wallets' screenshots are captured. This type has two accounts, no customer
-- and no earnings.
--
--   source       -(amount + platform fee)
--   destination  +amount
--   expense      +platform fee          ("Transfer Costs")
--
-- The platform's own charge for the move is a cost in its own account. It
-- does not reduce revenue: earnings stay what customers paid. (Operator's
-- decision, 2026-11-21.)
--
-- transactions.platform is the source, as for every other type. The new
-- transfer_to is the destination. Either may be 'Cash'.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

-- ----- a fifth kind of account ---------------------------------------------
ALTER TABLE gocash.accounts DROP CONSTRAINT accounts_kind_check;
ALTER TABLE gocash.accounts ADD CONSTRAINT accounts_kind_check
  CHECK (kind IN ('platform', 'cash', 'revenue', 'equity', 'expense'));

INSERT INTO gocash.accounts (operator_id, kind, name)
SELECT o.id, 'expense', 'Transfer Costs'
FROM gocash.operators o
WHERE NOT EXISTS (
  SELECT 1 FROM gocash.accounts a WHERE a.operator_id = o.id AND a.kind = 'expense');

-- ----- the transaction row --------------------------------------------------
ALTER TABLE gocash.transactions
  ADD COLUMN IF NOT EXISTS transfer_to  TEXT,
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE gocash.transactions DROP CONSTRAINT transactions_transaction_type_check;
ALTER TABLE gocash.transactions ADD CONSTRAINT transactions_transaction_type_check
  CHECK (transaction_type IN ('Cash In', 'Cash Out', 'Telco Load', 'Bills Payment',
                              'Bank Transfer', 'Profit Remittance', 'Wallet Transfer',
                              'Unknown'));

ALTER TABLE gocash.transactions ADD CONSTRAINT transactions_platform_fee_nonnegative
  CHECK (platform_fee >= 0);

-- A destination and a platform fee belong to a transfer and to nothing else.
-- A draft may still be missing its destination; a confirmed transfer may not.
ALTER TABLE gocash.transactions ADD CONSTRAINT transactions_transfer_shape
  CHECK (
    (transaction_type = 'Wallet Transfer'
       AND (status <> 'confirmed' OR transfer_to IS NOT NULL)
       AND (transfer_to IS NULL OR lower(transfer_to) <> lower(platform)))
    OR
    (transaction_type <> 'Wallet Transfer' AND transfer_to IS NULL AND platform_fee = 0)
  );

-- ---------------------------------------------------------------------------
-- post_entry, redefined with one change: an 'expense' leg finds or creates the
-- operator's Transfer Costs account. Everything else is as in 20260925000002.
-- The GRANT is repeated because replacing a function in this schema revokes
-- EXECUTE (event trigger, 20260923000002).
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

      -- The expense account is created the first time it is needed. Operators
      -- provisioned before this migration get theirs below; one provisioned
      -- later has none until their first transfer with a platform fee.
      IF v_account_id IS NULL AND v_kind = 'expense' THEN
        INSERT INTO gocash.accounts (operator_id, kind, name)
        VALUES (p_operator_id, 'expense', 'Transfer Costs')
        RETURNING id INTO v_account_id;
      END IF;

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

-- ---------------------------------------------------------------------------
-- confirm_transaction, redefined with one change: it also stores transfer_to
-- and platform_fee from p_fields. Everything else is as in 20260925000001.
-- ---------------------------------------------------------------------------
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
    -- Wallet Transfer only; NULL and 0 for every other type.
    transfer_to      = NULLIF(btrim(COALESCE(p_fields ->> 'transfer_to', '')), ''),
    platform_fee     = COALESCE((p_fields ->> 'platform_fee')::NUMERIC, 0),
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

GRANT EXECUTE ON FUNCTION
  gocash.confirm_transaction(UUID, UUID, JSONB, JSONB, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;

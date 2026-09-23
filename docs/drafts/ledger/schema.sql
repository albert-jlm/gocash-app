-- ===========================================================================
-- DRAFT — double-entry ledger for GoCash.  NOT A MIGRATION. Do not apply yet.
--
-- Read this alongside postings.ts. That file decides WHAT rows to write;
-- this file makes it impossible to write the wrong ones.
--
-- The whole design is one sentence:
--
--     Every ledger entry is a group of signed rows that must add up to zero,
--     and balances are the sum of those rows rather than a number you edit.
--
-- Two consequences fall out of that:
--   * The four transaction types that currently lose money cannot be written.
--   * A balance can always be recomputed, so a bad rule is repairable.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. accounts — what `wallets` becomes, plus two new kinds
-- ---------------------------------------------------------------------------
--
--   platform   GCash / MariBank / Maya   money sitting in an e-wallet
--   cash       the drawer                physical pesos
--   revenue    fees you have earned      NEW
--   equity     the owner's stake         NEW  (opening balances, remittances,
--                                             and drawer-count differences)
--
-- The two new kinds are what let an entry balance. Today a fee has nowhere to
-- go, so it gets folded into the cash leg via delta_cash_mult; and a profit
-- remittance has no destination at all, which is why the two live rules for it
-- disagree with each other.
-- ---------------------------------------------------------------------------

CREATE TABLE gocash.accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('platform', 'cash', 'revenue', 'equity')),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT accounts_unique_name_per_operator UNIQUE (operator_id, name)
);

-- An operator may have many platform accounts but exactly one drawer, one
-- revenue account and one equity account.
CREATE UNIQUE INDEX accounts_singleton_kinds
  ON gocash.accounts (operator_id, kind)
  WHERE kind IN ('cash', 'revenue', 'equity');

CREATE INDEX accounts_operator_idx ON gocash.accounts (operator_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. ledger_entries — one journal entry: "this happened, here is why"
-- ---------------------------------------------------------------------------
--
-- A transaction can produce SEVERAL entries over its life:
--
--   confirmed        -> entry 1  kind='transaction'
--   operator edits   -> entry 2  kind='reversal'  reverses_entry_id = entry 1
--                       entry 3  kind='transaction'
--
-- All three stay forever. That is the audit trail, and it replaces the live
-- 18-argument confirm_transaction_atomic with its p_previous_platform_wallet /
-- p_next_platform_wallet pairs — that function is a hand-rolled reversal engine.
-- ---------------------------------------------------------------------------

CREATE TABLE gocash.ledger_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,

  -- NULL for entries that are not tied to a captured receipt:
  -- opening balances, nightly reconciliations, manual adjustments.
  transaction_id    UUID REFERENCES gocash.transactions(id) ON DELETE RESTRICT,

  kind              TEXT NOT NULL
                    CHECK (kind IN ('opening', 'transaction', 'reversal', 'reconciliation')),
  reverses_entry_id UUID REFERENCES gocash.ledger_entries(id) ON DELETE RESTRICT,

  memo              TEXT,

  -- Kills the double-confirm class of bug outright. The client sends a key it
  -- generated; a retry, a double-tap or a flaky connection replays the SAME key
  -- and the second insert is rejected by the unique index below. This is
  -- strictly better than the status guard the live function is missing, because
  -- it works even when the first request succeeded but the response was lost.
  idempotency_key   TEXT,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- kind='reversal' if and only if it points at the entry it reverses.
  CONSTRAINT ledger_entries_reversal_shape
    CHECK ((kind = 'reversal') = (reverses_entry_id IS NOT NULL))
);

CREATE UNIQUE INDEX ledger_entries_idempotency
  ON gocash.ledger_entries (operator_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- An entry can be reversed at most once.
CREATE UNIQUE INDEX ledger_entries_one_reversal
  ON gocash.ledger_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE INDEX ledger_entries_operator_date_idx
  ON gocash.ledger_entries (operator_id, created_at DESC);
CREATE INDEX ledger_entries_transaction_idx
  ON gocash.ledger_entries (transaction_id) WHERE transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. postings — the signed rows. This is the ledger.
-- ---------------------------------------------------------------------------
--
-- A 500 peso cash in with a 10 peso fee is three rows in this table:
--
--   entry_id  account    amount
--   --------  --------   -------
--   abc...    Cash       +510.00
--   abc...    GCash      -500.00
--   abc...    Revenue     -10.00
--                        -------
--                           0.00   <- enforced below
-- ---------------------------------------------------------------------------

CREATE TABLE gocash.postings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   UUID NOT NULL REFERENCES gocash.ledger_entries(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES gocash.accounts(id) ON DELETE RESTRICT,

  -- Signed. Positive means the account went up.
  -- A zero-value posting is meaningless, so it is rejected.
  amount     NUMERIC(14,2) NOT NULL CHECK (amount <> 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX postings_account_idx ON gocash.postings (account_id);
CREATE INDEX postings_entry_idx   ON gocash.postings (entry_id);

-- ---------------------------------------------------------------------------
-- 4. THE INVARIANT
-- ---------------------------------------------------------------------------
--
-- DEFERRABLE INITIALLY DEFERRED means the check runs at COMMIT, not on each
-- INSERT — so you can write the legs one at a time inside a transaction and
-- they only have to balance once you are done.
--
-- Try to write the live Bills Payment rule and this is what happens:
--
--   INSERT ... (GCash, -1850.00);
--   INSERT ... (Cash,     15.00);
--   COMMIT;
--   ERROR:  ledger entry <id> does not balance: sum = -1835.00
--
-- That error is the entire argument for this redesign. It is the check that
-- does not exist today, which is why four of six transaction types have been
-- quietly destroying money.
-- ---------------------------------------------------------------------------

CREATE FUNCTION gocash.assert_entry_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = gocash, public
AS $$
DECLARE
  v_sum   NUMERIC(14,2);
  v_count INT;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
    INTO v_sum, v_count
  FROM gocash.postings
  WHERE entry_id = NEW.entry_id;

  IF v_count < 2 THEN
    RAISE EXCEPTION
      'ledger entry % has % posting(s); an entry needs at least 2',
      NEW.entry_id, v_count;
  END IF;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION
      'ledger entry % does not balance: sum = %',
      NEW.entry_id, v_sum;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER postings_must_balance
  AFTER INSERT ON gocash.postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION gocash.assert_entry_balances();

-- ---------------------------------------------------------------------------
-- 5. APPEND-ONLY
-- ---------------------------------------------------------------------------
--
-- A ledger you can edit is not a ledger. Corrections are new entries.
-- This is what makes "why is my GCash balance 8,240?" answerable.
-- ---------------------------------------------------------------------------

CREATE FUNCTION gocash.reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RAISE EXCEPTION
    'gocash.% is append-only — post a reversal entry instead of editing',
    TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER postings_immutable
  BEFORE UPDATE OR DELETE ON gocash.postings
  FOR EACH ROW EXECUTE FUNCTION gocash.reject_mutation();

CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON gocash.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION gocash.reject_mutation();

-- ---------------------------------------------------------------------------
-- 6. Balances — derived, never stored
-- ---------------------------------------------------------------------------
--
-- `balance`         raw signed sum. Revenue and equity are negative as they grow.
-- `natural_balance` what a human wants to read: fees earned shows as +250.00,
--                   capital in the business shows as +23,000.00.
--
-- security_invoker = true (PG 15+) makes the view respect the caller's RLS
-- instead of running as the view owner. Without it this view would be a
-- read-anything hole exactly like the SECURITY DEFINER functions in Audit #5a.
-- ---------------------------------------------------------------------------

CREATE VIEW gocash.account_balances
WITH (security_invoker = true) AS
SELECT
  a.id                                        AS account_id,
  a.operator_id,
  a.name,
  a.kind,
  COALESCE(SUM(p.amount), 0)::NUMERIC(14,2)   AS balance,
  CASE WHEN a.kind IN ('revenue', 'equity')
       THEN COALESCE(-SUM(p.amount), 0)
       ELSE COALESCE( SUM(p.amount), 0)
  END::NUMERIC(14,2)                          AS natural_balance,
  COUNT(p.id)                                 AS posting_count,
  MAX(p.created_at)                           AS last_posted_at
FROM gocash.accounts a
LEFT JOIN gocash.postings p ON p.account_id = a.id
GROUP BY a.id, a.operator_id, a.name, a.kind;

COMMENT ON VIEW gocash.account_balances IS
  'Derived balances. If this is ever too slow, cache it in a table refreshed by '
  'a trigger on postings — but keep this view as the source of truth so the '
  'cache can always be rebuilt. At current volume (1 transaction) it is free.';

-- A whole-books check. Should always return zero rows.
CREATE VIEW gocash.unbalanced_entries
WITH (security_invoker = true) AS
SELECT e.id AS entry_id, e.operator_id, e.kind, e.created_at,
       SUM(p.amount)::NUMERIC(14,2) AS out_of_balance_by
FROM gocash.ledger_entries e
JOIN gocash.postings p ON p.entry_id = e.id
GROUP BY e.id, e.operator_id, e.kind, e.created_at
HAVING SUM(p.amount) <> 0;

COMMENT ON VIEW gocash.unbalanced_entries IS
  'Health check. Any row here is a bug. Worth putting on the dashboard.';

-- ---------------------------------------------------------------------------
-- 7. RLS — read-only for clients, writes via service role only
-- ---------------------------------------------------------------------------
--
-- Deliberately NO insert/update/delete policies. The ledger is written by the
-- Edge Function using the service-role key, never by the browser. That is the
-- opposite of the current posture, where the client updates wallets.balance
-- directly with no audit trail at all.
--
-- Note every policy below is a SELECT, so the missing-WITH-CHECK problem from
-- Audit #5 finding 15 cannot recur here: there is nothing to write.
-- ---------------------------------------------------------------------------

CREATE FUNCTION gocash.is_my_operator(p_operator_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER               -- deliberately NOT definer
SET search_path = gocash, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM gocash.operators o
    WHERE o.id = p_operator_id
      AND o.user_id = auth.uid()
  );
$$;

ALTER TABLE gocash.accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.postings       ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_own ON gocash.accounts
  FOR SELECT USING (gocash.is_my_operator(operator_id));

CREATE POLICY ledger_entries_select_own ON gocash.ledger_entries
  FOR SELECT USING (gocash.is_my_operator(operator_id));

CREATE POLICY postings_select_own ON gocash.postings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM gocash.ledger_entries e
      WHERE e.id = postings.entry_id
        AND gocash.is_my_operator(e.operator_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Grants — the Audit #5a lesson applied
-- ---------------------------------------------------------------------------
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. That default
-- is exactly how all six live SECURITY DEFINER functions ended up callable with
-- the anon key. Revoke first, then grant the minimum.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION gocash.assert_entry_balances()      FROM PUBLIC;
REVOKE ALL ON FUNCTION gocash.reject_mutation()            FROM PUBLIC;
REVOKE ALL ON FUNCTION gocash.is_my_operator(UUID)         FROM PUBLIC;

-- Needed by the policies above, which run as the querying role.
-- Safe: it only answers "is this id mine?" about an id you already hold.
GRANT EXECUTE ON FUNCTION gocash.is_my_operator(UUID) TO authenticated;

GRANT SELECT ON gocash.accounts, gocash.ledger_entries, gocash.postings,
                gocash.account_balances, gocash.unbalanced_entries
  TO authenticated;

COMMIT;


-- ===========================================================================
-- BACKFILL — run once, in its own transaction, after the tables above exist.
-- Current scale: 2 operators, 8 wallets, 1 transaction. This is as cheap as
-- this migration will ever be.
-- ===========================================================================
--
-- BEGIN;
--
-- -- a. every existing wallet becomes an account
-- INSERT INTO gocash.accounts (operator_id, kind, name, is_active)
-- SELECT w.operator_id,
--        CASE WHEN w.wallet_type = 'cash' THEN 'cash' ELSE 'platform' END,
--        w.wallet_name,
--        COALESCE(w.is_active, TRUE)
-- FROM gocash.wallets w;
--
-- -- b. every operator gets the two new accounts
-- INSERT INTO gocash.accounts (operator_id, kind, name)
-- SELECT o.id, 'revenue', 'Fee Revenue' FROM gocash.operators o
-- UNION ALL
-- SELECT o.id, 'equity',  'Owner Equity' FROM gocash.operators o;
--
-- -- c. one opening entry per operator carrying today's balances forward
-- WITH e AS (
--   INSERT INTO gocash.ledger_entries (operator_id, kind, memo, created_by)
--   SELECT o.id, 'opening', 'Migrated from wallets.balance', 'migration'
--   FROM gocash.operators o
--   RETURNING id, operator_id
-- )
-- INSERT INTO gocash.postings (entry_id, account_id, amount)
-- -- one leg per wallet with a non-zero balance ...
-- SELECT e.id, a.id, w.balance
-- FROM e
-- JOIN gocash.wallets  w ON w.operator_id = e.operator_id
-- JOIN gocash.accounts a ON a.operator_id = e.operator_id AND a.name = w.wallet_name
-- WHERE w.balance <> 0
-- UNION ALL
-- -- ... and the balancing equity leg
-- SELECT e.id, a.id, -COALESCE(SUM(w.balance), 0)
-- FROM e
-- JOIN gocash.wallets  w ON w.operator_id = e.operator_id
-- JOIN gocash.accounts a ON a.operator_id = e.operator_id AND a.kind = 'equity'
-- GROUP BY e.id, a.id
-- HAVING COALESCE(SUM(w.balance), 0) <> 0;
--
-- -- d. prove it worked before you commit
-- --    both of these must return zero rows:
-- --      SELECT * FROM gocash.unbalanced_entries;
-- --      SELECT w.wallet_name, w.balance, b.balance
-- --      FROM gocash.wallets w
-- --      JOIN gocash.accounts  a ON a.operator_id = w.operator_id AND a.name = w.wallet_name
-- --      JOIN gocash.account_balances b ON b.account_id = a.id
-- --      WHERE w.balance <> b.balance;
-- --
-- -- COMMIT;   -- or ROLLBACK if either check returns anything

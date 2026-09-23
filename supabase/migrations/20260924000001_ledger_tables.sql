-- ===========================================================================
-- The ledger: accounts, entries, postings.
--
-- Replaces the delta-multiplier model, in which `transaction_rules` carried
-- three NUMERIC(6,4) columns whose values were only ever -1, 0 or +1, and
-- `wallets.balance` was mutated in place with `balance = balance + delta`.
--
-- That model had no invariant. On a PHP 100 transaction the two deltas should
-- have summed to the fee earned; live, four of six types did not:
--
--   Cash In            +5   ok
--   Cash Out           +5   ok
--   Telco Load        -95   the customer's cash was never booked
--   Bills Payment     -95   same
--   Bank Transfer    -100   principal lost AND the fee never booked
--   Profit Remittance   0   recorded as a cash-in
--
-- Nothing detected it because nothing asserted it, and because balances were
-- mutated rather than derived, the damage was not repairable either.
--
-- Here an entry that does not balance cannot be written, and a balance is the
-- sum of its postings, so a bad rule can be fixed and replayed.
--
-- Apply as supabase_admin (see 20260923000002 — the event trigger revokes
-- EXECUTE on new functions, so grants below are explicit and deliberate).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Ownership helper, used by every policy below.
--
-- SECURITY INVOKER on purpose. It is not an escalation: it answers "is this id
-- mine?" about an id the caller already holds, and leaks nothing about anyone
-- else. Every SECURITY DEFINER function in this schema took p_operator_id on
-- trust, which is what Audit #5a was about.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION gocash.is_my_operator(p_operator_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = gocash, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM gocash.operators o
    WHERE o.id = p_operator_id AND o.user_id = auth.uid()
  );
$$;

-- Required by the RLS policies, which run as the querying role.
GRANT EXECUTE ON FUNCTION gocash.is_my_operator(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- accounts — what `wallets` becomes, plus two kinds that make entries balance.
--
--   platform  GCash / MariBank / Maya   money in an e-wallet
--   cash      the drawer                physical pesos
--   revenue   fees earned               NEW
--   equity    the owner's stake         NEW (opening balances, remittances,
--                                       and drawer-count differences)
--
-- Without the last two a fee has nowhere to go — the old model smuggled it
-- into the cash leg via delta_cash_mult — and a profit remittance has no
-- destination at all, which is why its two live rules contradict each other.
-- ---------------------------------------------------------------------------

CREATE TABLE gocash.accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('platform', 'cash', 'revenue', 'equity')),
  name        TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Every account in an entry must agree on this. A mixed-currency entry that
  -- sums to zero would be a catastrophic silent bug; one column prevents it.
  currency    CHAR(3) NOT NULL DEFAULT 'PHP',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT accounts_unique_name_per_operator UNIQUE (operator_id, name)
);

-- Many platform accounts, but exactly one drawer / revenue / equity account.
CREATE UNIQUE INDEX accounts_singleton_kinds
  ON gocash.accounts (operator_id, kind)
  WHERE kind IN ('cash', 'revenue', 'equity');

CREATE INDEX accounts_operator_idx ON gocash.accounts (operator_id) WHERE is_active;

CREATE TRIGGER accounts_touch_updated_at
  BEFORE UPDATE ON gocash.accounts
  FOR EACH ROW EXECUTE FUNCTION gocash.update_updated_at();

-- ---------------------------------------------------------------------------
-- ledger_entries — one journal entry: "this happened, here is why".
--
-- A transaction produces several entries over its life:
--
--   confirmed      -> kind='transaction'
--   operator edits -> kind='reversal' (reverses_entry_id = the original)
--                     kind='transaction' (the corrected figures)
--
-- All of them are kept. That is the audit trail, and it is what replaces the
-- live 18-argument confirm_transaction_atomic with its
-- p_previous_platform_wallet / p_next_platform_wallet pairs — a hand-rolled
-- reversal engine built because reversing was otherwise impossible.
-- ---------------------------------------------------------------------------

CREATE TABLE gocash.ledger_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,

  -- NULL for entries not tied to a captured receipt: opening balances,
  -- nightly reconciliations, manual adjustments.
  transaction_id    UUID REFERENCES gocash.transactions(id) ON DELETE RESTRICT,

  kind              TEXT NOT NULL
                    CHECK (kind IN ('opening', 'transaction', 'reversal', 'reconciliation')),
  reverses_entry_id UUID REFERENCES gocash.ledger_entries(id) ON DELETE RESTRICT,

  currency          CHAR(3) NOT NULL DEFAULT 'PHP',
  memo              TEXT,

  -- Kills the double-confirm class outright. The client generates a key; a
  -- retry, a double tap or a lost response replays the SAME key and the second
  -- insert is rejected below. Stronger than a status guard, because it also
  -- covers the case where the first request succeeded but the reply was lost.
  idempotency_key   TEXT,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- kind='reversal' if and only if it names the entry it reverses.
  CONSTRAINT ledger_entries_reversal_shape
    CHECK ((kind = 'reversal') = (reverses_entry_id IS NOT NULL))
);

CREATE UNIQUE INDEX ledger_entries_idempotency
  ON gocash.ledger_entries (operator_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- An entry may be reversed at most once.
CREATE UNIQUE INDEX ledger_entries_one_reversal
  ON gocash.ledger_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE INDEX ledger_entries_operator_date_idx
  ON gocash.ledger_entries (operator_id, created_at DESC);
CREATE INDEX ledger_entries_transaction_idx
  ON gocash.ledger_entries (transaction_id) WHERE transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- postings — the signed rows. This is the ledger.
--
-- amount_minor is BIGINT CENTAVOS, not NUMERIC(14,2). The TypeScript core
-- works in integer centavos so its zero-sum check needs no epsilon; storing
-- the same representation means there is no conversion at the boundary and no
-- second notion of what "the amount" is. The peso value is exposed by the
-- balances view for reading.
--
-- A PHP 500 cash in with a PHP 10 fee is three rows:
--
--   entry_id  account    amount_minor
--   --------  --------   ------------
--   abc...    Cash             +51000
--   abc...    GCash            -50000
--   abc...    Revenue           -1000
--                        ------------
--                                   0   <- enforced below
-- ---------------------------------------------------------------------------

CREATE TABLE gocash.postings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     UUID NOT NULL REFERENCES gocash.ledger_entries(id) ON DELETE RESTRICT,
  account_id   UUID NOT NULL REFERENCES gocash.accounts(id) ON DELETE RESTRICT,
  -- Signed. Positive means the account went up. Zero is meaningless.
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX postings_account_idx ON gocash.postings (account_id);
CREATE INDEX postings_entry_idx   ON gocash.postings (entry_id);

-- ---------------------------------------------------------------------------
-- THE INVARIANT
--
-- DEFERRABLE INITIALLY DEFERRED runs the check at COMMIT, so the legs can be
-- inserted one at a time and only have to balance once the entry is complete.
--
-- Writing the live Bills Payment rule now looks like this:
--
--   INSERT ... (GCash, -185000);
--   INSERT ... (Cash,     1500);
--   COMMIT;
--   ERROR:  ledger entry ... does not balance: sum = -183500 centavos
--
-- That error is the entire point of the redesign.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION gocash.assert_entry_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = gocash, public
AS $$
DECLARE
  v_sum        BIGINT;
  v_count      INT;
  v_currencies INT;
  v_entry_ccy  CHAR(3);
BEGIN
  SELECT COALESCE(SUM(p.amount_minor), 0), COUNT(*), COUNT(DISTINCT a.currency)
    INTO v_sum, v_count, v_currencies
  FROM gocash.postings p
  JOIN gocash.accounts a ON a.id = p.account_id
  WHERE p.entry_id = NEW.entry_id;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'ledger entry % has % posting(s); an entry needs at least 2',
      NEW.entry_id, v_count;
  END IF;

  IF v_currencies > 1 THEN
    RAISE EXCEPTION 'ledger entry % mixes % currencies', NEW.entry_id, v_currencies;
  END IF;

  SELECT e.currency INTO v_entry_ccy
  FROM gocash.ledger_entries e WHERE e.id = NEW.entry_id;

  IF EXISTS (
    SELECT 1 FROM gocash.postings p
    JOIN gocash.accounts a ON a.id = p.account_id
    WHERE p.entry_id = NEW.entry_id AND a.currency <> v_entry_ccy
  ) THEN
    RAISE EXCEPTION 'ledger entry % is %, but posts to an account in another currency',
      NEW.entry_id, v_entry_ccy;
  END IF;

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger entry % does not balance: sum = % centavos',
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
-- APPEND-ONLY
--
-- A ledger you can edit is not a ledger. Corrections are new entries. This is
-- what makes "why is my GCash balance 5,550?" answerable, and it is the direct
-- replacement for Settings > Wallets overwriting a number with no trace.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION gocash.reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RAISE EXCEPTION 'gocash.% is append-only — post a reversal entry instead of editing',
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
-- Balances — derived, never stored.
--
-- security_invoker = true (PG 15+) makes the view respect the caller's RLS
-- instead of running as its owner. Without it this view would be a
-- read-anything hole of exactly the kind Audit #5a found in the functions.
-- ---------------------------------------------------------------------------

CREATE VIEW gocash.account_balances
WITH (security_invoker = true) AS
SELECT
  a.id                                        AS account_id,
  a.operator_id,
  a.name,
  a.kind,
  a.currency,
  COALESCE(SUM(p.amount_minor), 0)            AS balance_minor,
  (COALESCE(SUM(p.amount_minor), 0) / 100.0)::NUMERIC(14,2) AS balance,
  -- What a human wants to read: revenue and equity are credit-natured and go
  -- negative as they grow, so flip them. Fees earned show as +250.00.
  CASE WHEN a.kind IN ('revenue', 'equity')
       THEN (COALESCE(-SUM(p.amount_minor), 0) / 100.0)
       ELSE (COALESCE( SUM(p.amount_minor), 0) / 100.0)
  END::NUMERIC(14,2)                          AS natural_balance,
  COUNT(p.id)                                 AS posting_count,
  MAX(p.created_at)                           AS last_posted_at
FROM gocash.accounts a
LEFT JOIN gocash.postings p ON p.account_id = a.id
GROUP BY a.id, a.operator_id, a.name, a.kind, a.currency;

COMMENT ON VIEW gocash.account_balances IS
  'Derived balances. If this ever becomes slow, cache it in a table refreshed '
  'by a trigger on postings, but keep this view as the source of truth so the '
  'cache can always be rebuilt.';

-- Whole-books health check. Must always return zero rows.
CREATE VIEW gocash.unbalanced_entries
WITH (security_invoker = true) AS
SELECT e.id AS entry_id, e.operator_id, e.kind, e.created_at,
       SUM(p.amount_minor) AS out_of_balance_by_minor
FROM gocash.ledger_entries e
JOIN gocash.postings p ON p.entry_id = e.id
GROUP BY e.id, e.operator_id, e.kind, e.created_at
HAVING SUM(p.amount_minor) <> 0;

COMMENT ON VIEW gocash.unbalanced_entries IS
  'Any row here is a bug. Worth surfacing on the dashboard.';

-- ---------------------------------------------------------------------------
-- RLS — read-only for clients; all writes go through the service role.
--
-- Deliberately NO insert/update/delete policies. The ledger is written by the
-- Edge Functions, never by the browser. That is the opposite of the current
-- posture, where the client UPDATEs wallets.balance directly.
--
-- Note every policy here is a SELECT, so the missing-WITH-CHECK problem from
-- Audit #5 cannot recur on these tables: there is nothing to write.
-- ---------------------------------------------------------------------------

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
      WHERE e.id = postings.entry_id AND gocash.is_my_operator(e.operator_id)
    )
  );

GRANT SELECT ON gocash.accounts, gocash.ledger_entries, gocash.postings,
                gocash.account_balances, gocash.unbalanced_entries
  TO authenticated;

COMMIT;

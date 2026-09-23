-- ===========================================================================
-- LAYER 2 — ledger invariants.
--
-- WHAT THESE ARE
-- Regression tests, not hypotheticals. Every invariant below was demonstrated
-- as a real hole before the guard that now closes it was written:
--
--   * Four of six live transaction types destroyed money on every use, because
--     `transaction_rules` carried free-floating delta multipliers and nothing
--     ever asserted that the two sides summed to the fee. Bank Transfer lost
--     the entire principal AND never booked the fee. Nothing detected it
--     because nothing asserted it — and because balances were mutated in
--     place rather than derived, the damage was not repairable either.
--   * A review confirmed a posting could reference another tenant's account
--     and commit. Because RLS filters postings by the ENTRY's operator, the
--     victim read a balance of 0 while the stored sum was not 0: the derived
--     balance silently depended on who was asking.
--   * A review confirmed a 2-leg entry could be committed and then have a
--     self-balancing pair appended by a LATER transaction, leaving 4 legs. The
--     balance trigger re-aggregates the whole entry, so the append passed it.
--     Append-only protected the rows but not the entry.
--   * A single amount past 2^53 made account_balances fail with "numeric field
--     overflow" for EVERYONE, not just the bad row — the whole query, every
--     tenant.
--   * An entry with no postings at all commits silently: no trigger exists on
--     ledger_entries that could fire, so the only thing that can catch it is
--     gocash.unbalanced_entries, whose LEFT JOIN exists precisely for this.
--
-- This file is the demo walkthrough in docs/drafts/ledger/demo.sql turned into
-- assertions. That file predates the current schema (postings gained an
-- operator_id column and two composite FKs, and amounts are BIGINT centavos
-- rather than NUMERIC pesos), and more importantly it PRINTS results for a
-- human to read rather than checking them — its "expect an error" scenarios
-- pass whether or not the error arrives.
--
-- Money is in centavos throughout, matching gocash.postings.amount_minor and
-- the integer-centavo representation used by supabase/functions/_core.
-- ===========================================================================

-- Incidental NOTICEs (the event trigger announcing each auto-revoke, DROP ...
-- IF EXISTS on a fresh database) would bury the assertion output. Real
-- problems are WARNING or above and still come through.
SET client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- FIXTURE
--
-- Two operators, because half the invariants here are about tenant isolation
-- and a single-tenant fixture cannot express them.
--
-- Maria opens with 8,000 in GCash and 12,000 in the drawer; the 20,000 she put
-- into the business is Owner Equity, which is what makes the opening entry
-- balance. The old model had nowhere to put it, which is why its opening
-- balances were simply typed into wallets.balance.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email) VALUES
  ('f0000000-0000-0000-0000-00000000000a', 'maria@example.test'),
  ('f0000000-0000-0000-0000-00000000000b', 'nena@example.test');

INSERT INTO gocash.operators (id, user_id, email, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a',
   'maria@example.test', 'Maria'),
  ('22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000b',
   'nena@example.test',  'Nena');

INSERT INTO gocash.accounts (id, operator_id, kind, name) VALUES
  ('aaaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'platform', 'GCash'),
  ('aaaa0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'cash',     'Cash'),
  ('aaaa0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'revenue',  'Fee Revenue'),
  ('aaaa0000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'equity',   'Owner Equity'),
  -- Nena's books. Only ever referenced by the cross-tenant test.
  ('bbbb0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'platform', 'GCash'),
  ('bbbb0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'cash',     'Cash');

INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo, created_by) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'opening', 'Opening balances at go-live', 'harness');

-- One statement, so all three legs share a transaction and the deferred
-- balance check sees a complete entry at COMMIT. This entry is also the
-- "committed by an earlier transaction" target for the sealing test (2.8):
-- psql runs in autocommit, so this statement's transaction ends here.
INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',   800000),   -- GCash        +8,000.00
  ('e0000000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',  1200000),   -- Cash        +12,000.00
  ('e0000000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', -2000000);   -- Owner Equity  (credit)

-- A fee rule to overlap against in 2.12. Inserted directly rather than through
-- gocash.set_fee_rule because the target here is the exclusion constraint, and
-- set_fee_rule deliberately closes the open period first — it would resolve
-- the overlap instead of provoking it.
INSERT INTO gocash.fee_rules
  (operator_id, transaction_type, platform, rate_bps, minimum_minor, rounding,
   effective_from, effective_to)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Cash In', 'GCash', 200, 500, 'ceil_unit',
   '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');


-- ---------------------------------------------------------------------------
-- 2.1 — an unbalanced entry is rejected at COMMIT.
--
-- THE defect. The live Bills Payment rule recorded GCash -1,850 and Cash +15
-- (the fee only); 1,835 pesos vanished and it committed silently, every time,
-- for every operator. Bank Transfer was worse: -100 on a PHP 100 transaction,
-- principal lost and fee never booked.
--
-- The check is a DEFERRABLE INITIALLY DEFERRED constraint trigger, so it runs
-- at COMMIT rather than per row — legs have to be insertable one at a time.
-- The harness forces that check with SET CONSTRAINTS ALL IMMEDIATE, which runs
-- the same pending trigger events COMMIT would have run.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.1 an unbalanced entry is rejected at COMMIT',
  'Four of six live transaction types did not balance. Bills Payment booked '
  'GCash -1850 against Cash +15 and lost 1,835 pesos silently, on every use.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
       VALUES ('e0000000-0000-0000-0000-0000000000f1',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'Meralco 1850 using the CURRENT live rule')$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f1',
               'aaaa0000-0000-0000-0000-000000000001',
               '11111111-1111-1111-1111-111111111111', -185000)$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f1',
               'aaaa0000-0000-0000-0000-000000000003',
               '11111111-1111-1111-1111-111111111111', 1500)$s$
  ],
  'does not balance');

-- ---------------------------------------------------------------------------
-- 2.2 — an entry with a single posting is rejected.
--
-- Separate from 2.1 because a lone posting trivially "balances" against
-- nothing if you only check the sum — and a one-legged entry is the exact
-- shape the old update_wallet_balance(p_wallet_name, p_delta) produced: move
-- one number, record no counterparty.
-- ---------------------------------------------------------------------------
-- The amount is a perfectly legal 510.00 on purpose. postings also CHECKs
-- amount_minor <> 0, and a zero-amount leg would be rejected by THAT before
-- the arity guard was ever reached — the test would pass while asserting
-- something else entirely. (It did, on the first run of this file: the harness
-- reported "rejected, but by the WRONG guard", which is the whole reason
-- expect_error matches on the message rather than settling for any error.)
-- 2.2b covers the zero-amount CHECK separately.
SELECT harness.expect_error('layer2', '2.2 a single-posting entry is rejected',
  'A one-legged entry is what update_wallet_balance did: move one balance, '
  'record no counterparty, leave nothing to reconcile against.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
       VALUES ('e0000000-0000-0000-0000-0000000000f2',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'one-legged')$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f2',
               'aaaa0000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111', 51000)$s$
  ],
  'needs at least 2');

-- A zero-amount leg is not a posting, it is noise: it satisfies the arity
-- check and the sum check while recording that nothing happened, and it would
-- pad an entry into looking double-entry when it is not.
SELECT harness.expect_error('layer2', '2.2b a zero-amount posting is rejected',
  'A zero leg would let a one-legged entry satisfy both the arity check and '
  'the balance check while moving money on one side only.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
       VALUES ('e0000000-0000-0000-0000-0000000000f3',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'padded with a zero leg')$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f3',
               'aaaa0000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111', 0)$s$
  ],
  'postings_amount_minor_check');

-- ---------------------------------------------------------------------------
-- 2.3 – 2.6 — the ledger is append-only.
--
-- Settings > Wallets currently lets the browser UPDATE wallets.balance
-- directly, with no audit_logs trigger on that table (Audit #5 finding 14,
-- still open after #5a). A number changes and nothing anywhere records that it
-- did, or who did it, or what it was before. Corrections here are new entries;
-- "why is my GCash balance 5,550?" stays answerable.
--
-- All four are asserted because the immutability triggers are per-table and
-- per-operation: postings_immutable and ledger_entries_immutable each cover
-- UPDATE OR DELETE, and dropping one operation from one trigger is a one-word
-- edit that nothing else would notice.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.3 UPDATE on postings is rejected',
  'A ledger you can edit is not a ledger. This replaces Settings > Wallets '
  'overwriting a balance with no trace.',
  ARRAY[
    $s$UPDATE gocash.postings SET amount_minor = 99999999
       WHERE entry_id = 'e0000000-0000-0000-0000-000000000001'$s$
  ],
  'append-only');

SELECT harness.expect_error('layer2', '2.4 DELETE on postings is rejected',
  'Deleting a leg would leave the entry unbalanced with no record that it ever '
  'was balanced.',
  ARRAY[
    $s$DELETE FROM gocash.postings
       WHERE entry_id = 'e0000000-0000-0000-0000-000000000001'$s$
  ],
  'append-only');

SELECT harness.expect_error('layer2', '2.5 UPDATE on ledger_entries is rejected',
  'Rewriting an entry''s memo, kind or idempotency_key after the fact would '
  'let a confirmed transaction be re-described, or re-confirmed.',
  ARRAY[
    $s$UPDATE gocash.ledger_entries SET memo = 'rewritten'
       WHERE id = 'e0000000-0000-0000-0000-000000000001'$s$
  ],
  'append-only');

SELECT harness.expect_error('layer2', '2.6 DELETE on ledger_entries is rejected',
  'Deleting the entry is the cleanest way to make money disappear without a '
  'trace, which is exactly why it must not be possible.',
  ARRAY[
    $s$DELETE FROM gocash.ledger_entries
       WHERE id = 'e0000000-0000-0000-0000-000000000001'$s$
  ],
  'append-only');

-- ---------------------------------------------------------------------------
-- 2.7 — a posting may not reference another operator's account.
--
-- A review confirmed this committed before the composite FKs were added. The
-- consequence was worse than a stray row: RLS filters postings by the ENTRY's
-- operator, so the victim's SELECT on account_balances never saw the foreign
-- leg and reported a balance of 0 while the stored sum was not 0. The derived
-- balance depended on who was asking.
--
-- postings.operator_id is denormalised from the parent entry for no other
-- reason than to make these two FKs expressible.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.7 a posting cannot reference another operator''s account',
  'Before the composite FKs, an entry could post into another tenant''s '
  'account and commit. RLS hid the foreign leg from the victim, so their '
  'balance read 0 while the stored sum was not 0.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
       VALUES ('e0000000-0000-0000-0000-0000000000f4',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'posting into Nena''s GCash')$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f4',
               'aaaa0000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111', 50000)$s$,
    -- Maria's entry, Maria's operator_id, but Nena's account.
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f4',
               'bbbb0000-0000-0000-0000-000000000001',
               '11111111-1111-1111-1111-111111111111', -50000)$s$
  ],
  'postings_account_fk');

-- ---------------------------------------------------------------------------
-- 2.8 — an entry committed by an earlier transaction is sealed.
--
-- The subtle one, and the reason it needs its own guard: the balance check is
-- AFTER INSERT and re-aggregates the WHOLE entry, so a self-balancing PAIR
-- appended later passes it. A review confirmed a 2-leg entry could be
-- committed and then grown to 4 legs by a later transaction. Append-only
-- protected the rows; nothing protected the entry.
--
-- The legs below sum to zero on purpose. An unbalanced append would be caught
-- by 2.1's guard and would prove nothing about sealing.
--
-- This is the one assertion that genuinely requires two top-level
-- transactions: the seal compares each existing leg's created_at against
-- transaction_timestamp(), so it cannot fire within a single transaction. The
-- fixture's opening entry was committed by its own statement above, which is
-- what makes this a real second transaction and not a simulation.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.8 appending to an entry from an earlier transaction is rejected',
  'The balance trigger re-aggregates the whole entry, so a self-balancing pair '
  'appended by a later transaction passed it. A 2-leg entry was grown to 4.',
  ARRAY[
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-000000000001',
               'aaaa0000-0000-0000-0000-000000000001',
               '11111111-1111-1111-1111-111111111111', 900000)$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-000000000001',
               'aaaa0000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111', -900000)$s$
  ],
  'sealed');

-- ---------------------------------------------------------------------------
-- 2.9 — an amount past 2^53 is rejected.
--
-- Not a theoretical bound. Without the CHECK, one row holding a value past
-- 2^53 made gocash.account_balances fail with "numeric field overflow" for
-- EVERY operator — not one bad row, the entire query, for everyone. A single
-- fat-fingered or hostile insert took the balance screen down system-wide.
--
-- 2^53 also happens to be where IEEE-754 doubles stop counting integers
-- exactly, which is where a JSON round-trip through the Edge Functions would
-- start silently altering the number.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.9 an amount_minor past 2^53 is rejected',
  'One row past 2^53 made account_balances raise "numeric field overflow" for '
  'every operator at once. It is also where JSON integers stop being exact.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
       VALUES ('e0000000-0000-0000-0000-0000000000f5',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'absurd amount')$s$,
    -- 2^53 + 1
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-0000000000f5',
               'aaaa0000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111', 9007199254740993)$s$
  ],
  'postings_amount_minor_check');

-- ---------------------------------------------------------------------------
-- 2.10 — an entry with zero postings shows up in gocash.unbalanced_entries.
--
-- No trigger can fire on ledger_entries alone, so this commits silently: the
-- transaction looks confirmed and has moved nothing. Detection, not rejection,
-- is the only option, and it is why unbalanced_entries uses a LEFT JOIN — with
-- an inner join such an entry could never appear there at all.
--
-- Run as a probe so the bad row is rolled back. Leaving it committed would
-- poison 2.14, and ledger_entries is append-only so it could not be cleaned up
-- afterwards.
-- ---------------------------------------------------------------------------
SELECT harness.probe('layer2', '2.10 a zero-posting entry surfaces in unbalanced_entries',
  'An entry with no postings commits silently — no trigger exists on '
  'ledger_entries that could fire. The LEFT JOIN in unbalanced_entries is the '
  'only thing that can ever surface it.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
       VALUES ('e0000000-0000-0000-0000-0000000000f6',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'confirmed, moved nothing')$s$
  ],
  $s$SELECT EXISTS (SELECT 1 FROM gocash.unbalanced_entries
                    WHERE entry_id = 'e0000000-0000-0000-0000-0000000000f6')$s$,
  $s$SELECT 'entry_id e...f6 was NOT reported by gocash.unbalanced_entries; '
           || 'an entry that moved nothing would look confirmed'$s$);

-- ---------------------------------------------------------------------------
-- 2.11 — a replayed idempotency_key is rejected.
--
-- Audit #5 finding 3 / #5a item 4: confirm_transaction_atomic has no status
-- guard, so a double tap or a retry on a slow network applied the wallet
-- deltas twice. A status guard would not have been enough either — it cannot
-- catch the case where the first request SUCCEEDED but its response was lost,
-- which is precisely when clients retry. The key is generated before the
-- request, so a replay carries the same one.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.11 a replayed idempotency_key is rejected',
  'Double-confirm applied the wallet deltas twice (Audit #5 finding 3, '
  'confirmed live). A status guard misses the retry-after-lost-response case; '
  'a client-generated key does not.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries (operator_id, kind, memo, idempotency_key)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'transaction', 'Cash in 500', 'confirm-tx-aaa-001')$s$,
    $s$INSERT INTO gocash.ledger_entries (operator_id, kind, memo, idempotency_key)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'transaction', 'Cash in 500 REPLAYED', 'confirm-tx-aaa-001')$s$
  ],
  'ledger_entries_idempotency');

-- ---------------------------------------------------------------------------
-- 2.12 — overlapping fee_rules periods are rejected.
--
-- The old transaction_rules allowed two active rows for the same (operator,
-- type, platform) and let row order decide which one applied. Pricing was
-- therefore ambiguous and could change under a plan change or a VACUUM.
--
-- It matters more now than it did: amending a confirmed transaction reverses
-- its entry and reposts it at the rate that applied ON THE DAY. With
-- overlapping periods, gocash.fee_rule_at()'s LIMIT 1 would pick arbitrarily
-- and the reposted amount would not reproduce the original.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.12 overlapping fee_rules periods are rejected',
  'transaction_rules let two rules be active at once and let row order decide '
  'the price. fee_rule_at()''s LIMIT 1 would inherit that ambiguity, and '
  'repricing an amendment would not reproduce the original.',
  ARRAY[
    -- The fixture rule runs 2026-01-01 .. 2026-06-01. This one starts inside it.
    $s$INSERT INTO gocash.fee_rules
         (operator_id, transaction_type, platform, rate_bps, minimum_minor,
          rounding, effective_from, effective_to)
       VALUES ('11111111-1111-1111-1111-111111111111', 'Cash In', 'GCash',
               300, 500, 'ceil_unit',
               '2026-03-01T00:00:00Z', '2026-09-01T00:00:00Z')$s$
  ],
  'fee_rules_no_overlap');

-- ---------------------------------------------------------------------------
-- 2.13 — a valid entry commits.
--
-- Maria's customer hands over 510 in cash and receives 500 of e-money; the 10
-- is the fee. Three legs, summing to zero: Cash +510, GCash -500, Revenue -10.
-- Under the old model the fee had nowhere to go and was smuggled into the cash
-- leg via delta_cash_mult, which is why the sums never came out.
--
-- The legs are three separate statements on purpose. Each one leaves the entry
-- out of balance on its own, so if the balance check were per-row rather than
-- DEFERRABLE INITIALLY DEFERRED this test would fail — which makes it the
-- positive half of 2.1 rather than a smoke test.
--
-- p_persist := true. These rows stay, and 2.14 checks the arithmetic.
-- ---------------------------------------------------------------------------
SELECT harness.expect_ok('layer2', '2.13 a valid entry commits',
  'The guards must not be so strict that correct bookkeeping is impossible, '
  'and the legs must be insertable one at a time — the balance check is '
  'deferred to COMMIT precisely so an entry can be built up leg by leg.',
  ARRAY[
    $s$INSERT INTO gocash.ledger_entries
         (id, operator_id, kind, memo, idempotency_key, created_by)
       VALUES ('e0000000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111',
               'transaction', 'Cash in 500 for 09171234567',
               'confirm-tx-bbb-002', 'maria')$s$,
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-000000000002',
               'aaaa0000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111', 51000)$s$,   -- Cash    +510.00
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-000000000002',
               'aaaa0000-0000-0000-0000-000000000001',
               '11111111-1111-1111-1111-111111111111', -50000)$s$,  -- GCash   -500.00
    $s$INSERT INTO gocash.postings (entry_id, account_id, operator_id, amount_minor)
       VALUES ('e0000000-0000-0000-0000-000000000002',
               'aaaa0000-0000-0000-0000-000000000003',
               '11111111-1111-1111-1111-111111111111', -1000)$s$    -- Revenue  -10.00
  ],
  TRUE);

-- ---------------------------------------------------------------------------
-- 2.14 — account_balances reports the right numbers.
--
-- Opening 8,000 GCash / 12,000 cash / 20,000 equity, then a 500 cash in with a
-- 10 fee:
--
--     GCash         8,000 - 500      =  7,500.00
--     Cash         12,000 + 510      = 12,510.00
--     Fee Revenue   fees earned      =     10.00   (natural_balance)
--     Owner Equity  the stake        = 20,000.00   (natural_balance)
--
-- natural_balance for revenue and equity is the sign-flipped sum: both are
-- credit-natured and grow negative, and an operator asked "what did I earn
-- today?" wants +10, not -10. Asserted in minor units as well as the display
-- value so a rounding change in the view cannot pass unnoticed.
--
-- This is the assertion the old model could not have had at all: balances were
-- mutated in place, so there was no independent source to check them against.
-- ---------------------------------------------------------------------------
SELECT harness.expect_true('layer2', '2.14 account_balances reports the right numbers',
  'Balances are derived from postings, never stored, so they can be checked '
  'against the entries that produced them — and a bad rule can be fixed and '
  'replayed rather than leaving unrepairable damage.',
  $s$
  SELECT COALESCE(bool_and(ok), FALSE) FROM (
    SELECT (b.balance_minor, b.balance, b.natural_balance) = (e.minor, e.bal, e.nat) AS ok
    FROM (VALUES
      ('GCash',         750000::bigint,  7500.00::numeric,  7500.00::numeric),
      ('Cash',         1251000::bigint, 12510.00::numeric, 12510.00::numeric),
      ('Fee Revenue',    -1000::bigint,   -10.00::numeric,     10.00::numeric),
      ('Owner Equity', -2000000::bigint,-20000.00::numeric, 20000.00::numeric)
    ) AS e(name, minor, bal, nat)
    JOIN gocash.account_balances b
      ON b.name = e.name
     AND b.operator_id = '11111111-1111-1111-1111-111111111111'
  ) t
  $s$,
  $s$
  SELECT string_agg(format('%s balance_minor=%s balance=%s natural=%s',
                           b.name, b.balance_minor, b.balance, b.natural_balance),
                    '; ' ORDER BY b.name)
  FROM gocash.account_balances b
  WHERE b.operator_id = '11111111-1111-1111-1111-111111111111'
    AND b.posting_count > 0
  $s$);

-- ---------------------------------------------------------------------------
-- 2.15 — the books are clean after the run.
--
-- gocash.unbalanced_entries is documented as "any row here is a bug". Every
-- assertion above that wrote a bad entry rolled itself back, so this is a real
-- check and not a tautology — if any of them leaked, or if a guard let
-- something through that the view can still see, this is what catches it.
--
-- Scoped to nothing: it covers BOTH operators and every entry in the database,
-- including the fixture.
-- ---------------------------------------------------------------------------
SELECT harness.expect_no_rows('layer2', '2.15 gocash.unbalanced_entries is empty after a clean run',
  'The whole-books health check. Any row here is a bug, and it is the one '
  'assertion that would catch a hole none of the others anticipated.',
  $q$
  SELECT format('entry %s (operator %s, kind %s) is out of balance by %s centavos',
                entry_id, operator_id, kind,
                COALESCE(out_of_balance_by_minor::text, 'NULL — it has no postings at all')) AS violation
  FROM gocash.unbalanced_entries
  $q$);

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

-- ---------------------------------------------------------------------------
-- 2.16 — a repeated DRAFT idempotency_key is rejected.
--
-- Distinct from 2.11, which covers the LEDGER key. post_entry being idempotent
-- makes a duplicate confirm harmless, and that is exactly why a duplicate
-- DRAFT is the dangerous one: two rows at 'awaiting_confirm' describing one
-- real transaction, which the operator cannot tell apart and confirms both of.
-- Each confirm then carries its OWN ledger key, so the ledger accepts both
-- entries, the books balance, every invariant above passes — and the drawer is
-- short by one transaction with nothing anywhere looking wrong.
--
-- `transactions_unique_reference_per_operator` does not cover this: UNIQUE
-- treats NULLs as distinct and a typed transaction often has no reference.
--
-- 20260924000008 carries its own version of this check, but it skips when the
-- database has no operator — which is every fresh scratch build. This is the
-- one that actually runs.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.16 a repeated draft idempotency_key is rejected',
  'Without this a double-tapped Save leaves two indistinguishable drafts, the '
  'operator confirms both, and the ledger records one real transaction twice '
  'while remaining perfectly balanced.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source, idempotency_key)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 100, 'awaiting_confirm', 'manual', 'dup-draft-key')$s$,
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source, idempotency_key)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 100, 'awaiting_confirm', 'manual', 'dup-draft-key')$s$
  ],
  'transactions_unique_idempotency_per_operator');

-- ---------------------------------------------------------------------------
-- 2.17 — two operators may use the same draft key.
--
-- The guard above is per-operator. If it were global, one tenant's key would
-- collide with another's and the second operator's entry would be rejected for
-- a reason they could neither see nor act on. Asserted because the obvious
-- "simplification" of dropping operator_id from that index would still pass
-- 2.16 and break every tenant but the first.
-- ---------------------------------------------------------------------------
SELECT harness.expect_ok('layer2', '2.17 the draft key is scoped per operator',
  'A global uniqueness constraint on a client-generated key would make one '
  'tenant able to lock another out of recording a transaction.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source, idempotency_key)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 100, 'awaiting_confirm', 'manual', 'shared-key')$s$,
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source, idempotency_key)
       VALUES ('22222222-2222-2222-2222-222222222222',
               'Cash In', 'GCash', 100, 'awaiting_confirm', 'manual', 'shared-key')$s$
  ]);

-- ---------------------------------------------------------------------------
-- 2.18 — entry_source has no default.
--
-- The column exists to answer one question later: are the TYPED rows or the
-- READ rows the ones that turn out wrong? A default would answer it falsely
-- for every caller that forgot, and the whole point is that the answer cannot
-- be reconstructed after the fact. 20260924000008 sets 'ocr' only long enough
-- to label the pre-existing rows and then drops it.
-- ---------------------------------------------------------------------------
SELECT harness.expect_error('layer2', '2.18 entry_source must be stated explicitly',
  'A default on entry_source would silently label typed rows as OCR-read, '
  'destroying the only measurement that can justify or retire the OCR path.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 100, 'awaiting_confirm')$s$
  ],
  'entry_source');

-- ---------------------------------------------------------------------------
-- 2.19–2.23 — gocash.confirm_transaction (20260925000001).
--
-- The first assertions in this file that go through a posting FUNCTION rather
-- than raw inserts. The Edge Function used to read the status, post, then
-- update the status as three separate calls; two confirms with different keys
-- both posted, and a failed status update left a draft that could be posted
-- again. Every invariant above still passed, because both entries balanced.
--
-- Each probe sets the service_role claim first: post_entry and
-- confirm_transaction read caller identity from request.jwt.claims.
-- ---------------------------------------------------------------------------
SELECT harness.probe('layer2', '2.19 confirm posts one entry and marks the draft confirmed',
  'The post and the status change must land together. If they can separate, a '
  'draft with an entry behind it can be confirmed a second time.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('c0000000-0000-0000-0000-000000000001',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'Unknown', 0, 'awaiting_confirm', 'ocr')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000001',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,
           "net_profit":10,"reference_number":"REF-219","was_edited":true,
           "edit_record":{"changes":{"platform":"GCash"}}}'::jsonb,
         'confirm-219', 'harness')$s$
  ],
  $q$
  SELECT t.status = 'confirmed'
     AND t.platform = 'GCash' AND t.amount = 500 AND t.net_profit = 10
     AND t.reference_number = 'REF-219' AND t.was_edited
     AND t.confirmed_at IS NOT NULL
     AND jsonb_array_length(t.edit_history) = 1
     AND (SELECT count(*) FROM gocash.ledger_entries e
          WHERE e.transaction_id = t.id AND e.kind = 'transaction') = 1
     AND (SELECT sum(p.amount_minor) FILTER (WHERE p.amount_minor > 0)
          FROM gocash.postings p JOIN gocash.ledger_entries e ON e.id = p.entry_id
          WHERE e.transaction_id = t.id) = 51000
  FROM gocash.transactions t
  WHERE t.id = 'c0000000-0000-0000-0000-000000000001'
  $q$);

SELECT harness.expect_error('layer2', '2.20 a second confirm with a different key is rejected',
  'Two devices, or a reload that mints a new key, must not post the same '
  'transaction twice. The idempotency key alone cannot stop this.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('c0000000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'manual')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000002',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,"net_profit":10}'::jsonb,
         'confirm-220-a', 'harness')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000002',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,"net_profit":10}'::jsonb,
         'confirm-220-b', 'harness')$s$
  ],
  'not awaiting_confirm');

SELECT harness.probe('layer2', '2.21 replaying the same confirm returns the original entry',
  'A lost response must be retryable. The retry reports the first entry and '
  'writes nothing, so the operator is not told a saved transaction failed.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('c0000000-0000-0000-0000-000000000003',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'manual')$s$,
    $s$CREATE TEMP TABLE harness_221 ON COMMIT DROP AS
       SELECT 1 AS attempt, gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000003',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,"net_profit":10}'::jsonb,
         'confirm-221', 'harness') AS r$s$,
    $s$INSERT INTO harness_221
       SELECT 2, gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000003',
         '[{"kind":"cash","amount_minor":99900},
           {"kind":"platform","platform":"GCash","amount_minor":-99900}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":999,"net_profit":0}'::jsonb,
         'confirm-221', 'harness')$s$
  ],
  $q$
  SELECT (SELECT r ->> 'entry_id' FROM harness_221 WHERE attempt = 1)
       = (SELECT r ->> 'entry_id' FROM harness_221 WHERE attempt = 2)
     AND (SELECT (r ->> 'replayed')::boolean FROM harness_221 WHERE attempt = 2)
     AND NOT (SELECT (r ->> 'replayed')::boolean FROM harness_221 WHERE attempt = 1)
     AND (SELECT count(*) FROM gocash.ledger_entries
          WHERE transaction_id = 'c0000000-0000-0000-0000-000000000003') = 1
     AND (SELECT amount FROM gocash.transactions
          WHERE id = 'c0000000-0000-0000-0000-000000000003') = 500
  $q$);

SELECT harness.expect_error('layer2', '2.22 a key already used by another entry cannot confirm a draft',
  'post_entry returns the existing entry for a known key. Without this guard '
  'a draft confirmed with a reused key is marked confirmed with nothing posted.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('c0000000-0000-0000-0000-000000000004',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'manual'),
              ('c0000000-0000-0000-0000-000000000005',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 700, 'awaiting_confirm', 'manual')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000004',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,"net_profit":10}'::jsonb,
         'confirm-222', 'harness')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'c0000000-0000-0000-0000-000000000005',
         '[{"kind":"cash","amount_minor":71400},
           {"kind":"platform","platform":"GCash","amount_minor":-70000},
           {"kind":"revenue","amount_minor":-1400}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":700,"net_profit":14}'::jsonb,
         'confirm-222', 'harness')$s$
  ],
  'already used for another entry');

SELECT harness.expect_error('layer2', '2.23 one transaction cannot carry two transaction entries',
  'The backstop under confirm_transaction: anything that reaches the ledger '
  'by another route still cannot post the same transaction twice.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('c0000000-0000-0000-0000-000000000006',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'manual')$s$,
    $s$INSERT INTO gocash.ledger_entries (operator_id, kind, transaction_id)
       VALUES ('11111111-1111-1111-1111-111111111111', 'transaction',
               'c0000000-0000-0000-0000-000000000006')$s$,
    $s$INSERT INTO gocash.ledger_entries (operator_id, kind, transaction_id)
       VALUES ('11111111-1111-1111-1111-111111111111', 'transaction',
               'c0000000-0000-0000-0000-000000000006')$s$
  ],
  'ledger_entries_one_per_transaction');

-- ---------------------------------------------------------------------------
-- 2.24–2.27 — gocash.void_transaction (20260925000002).
--
-- A void is a reversal entry plus a status change, and like confirm the two
-- must land together. These also cover the two things a void is for: putting
-- the books back exactly, and letting the transaction be entered again.
-- ---------------------------------------------------------------------------
SELECT harness.probe('layer2', '2.24 voiding a confirmed transaction returns every balance',
  'A reversal that does not exactly cancel the original leaves the books off '
  'by the difference, with both entries individually balanced.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$CREATE TEMP TABLE harness_224 ON COMMIT DROP AS
       SELECT account_id, balance_minor FROM gocash.account_balances
       WHERE operator_id = '11111111-1111-1111-1111-111111111111'$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source, reference_number)
       VALUES ('d0000000-0000-0000-0000-000000000001',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'manual', 'REF-224')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000001',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,
           "net_profit":10,"reference_number":"REF-224"}'::jsonb,
         'confirm-224', 'harness')$s$,
    $s$SELECT gocash.void_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000001',
         'void-224', 'harness', 'wrong amount')$s$
  ],
  $q$
  SELECT (SELECT status FROM gocash.transactions
          WHERE id = 'd0000000-0000-0000-0000-000000000001') = 'voided'
     AND (SELECT count(*) FROM gocash.ledger_entries
          WHERE transaction_id = 'd0000000-0000-0000-0000-000000000001') = 2
     AND (SELECT memo FROM gocash.ledger_entries
          WHERE transaction_id = 'd0000000-0000-0000-0000-000000000001'
            AND kind = 'reversal') = 'Voided: wrong amount'
     AND NOT EXISTS (
           SELECT 1 FROM gocash.account_balances b
           JOIN harness_224 h USING (account_id)
           WHERE b.balance_minor <> h.balance_minor)
  $q$);

SELECT harness.probe('layer2', '2.25 voiding twice posts one reversal',
  'A double-tapped void, or a retry after a lost response, must not reverse '
  'the entry a second time.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('d0000000-0000-0000-0000-000000000002',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'manual')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000002',
         '[{"kind":"cash","amount_minor":51000},
           {"kind":"platform","platform":"GCash","amount_minor":-50000},
           {"kind":"revenue","amount_minor":-1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Cash In","amount":500,"net_profit":10}'::jsonb,
         'confirm-225', 'harness')$s$,
    $s$CREATE TEMP TABLE harness_225 ON COMMIT DROP AS
       SELECT 1 AS attempt, gocash.void_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000002', 'void-225-a', 'harness') AS r$s$,
    $s$INSERT INTO harness_225
       SELECT 2, gocash.void_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000002', 'void-225-b', 'harness')$s$
  ],
  $q$
  SELECT (SELECT count(*) FROM gocash.ledger_entries
          WHERE transaction_id = 'd0000000-0000-0000-0000-000000000002'
            AND kind = 'reversal') = 1
     AND (SELECT (r ->> 'replayed')::boolean FROM harness_225 WHERE attempt = 2)
     AND (SELECT r ->> 'entry_id' FROM harness_225 WHERE attempt = 1)
       = (SELECT r ->> 'entry_id' FROM harness_225 WHERE attempt = 2)
  $q$);

SELECT harness.probe('layer2', '2.26 voiding a draft posts nothing and blocks a later confirm',
  'A discarded draft has nothing to reverse. Once voided it must not be '
  'confirmable, or a discarded misread comes back as a posted transaction.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('d0000000-0000-0000-0000-000000000003',
               '11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'awaiting_confirm', 'ocr')$s$,
    $s$SELECT gocash.void_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000003', 'void-226', 'harness')$s$,
    $s$DO $do$
       BEGIN
         PERFORM gocash.confirm_transaction(
           '11111111-1111-1111-1111-111111111111',
           'd0000000-0000-0000-0000-000000000003',
           '[{"kind":"cash","amount_minor":51000},
             {"kind":"platform","platform":"GCash","amount_minor":-50000},
             {"kind":"revenue","amount_minor":-1000}]'::jsonb,
           '{"platform":"GCash","transaction_type":"Cash In","amount":500,"net_profit":10}'::jsonb,
           'confirm-226', 'harness');
         RAISE EXCEPTION 'a voided draft was confirmed';
       EXCEPTION WHEN SQLSTATE 'GC001' THEN
         NULL;  -- refused, as it must be
       END
       $do$$s$
  ],
  $q$
  SELECT (SELECT status FROM gocash.transactions
          WHERE id = 'd0000000-0000-0000-0000-000000000003') = 'voided'
     AND (SELECT count(*) FROM gocash.ledger_entries
          WHERE transaction_id = 'd0000000-0000-0000-0000-000000000003') = 0
  $q$);

SELECT harness.expect_ok('layer2', '2.27 a voided transaction frees its reference number',
  'The correction for a wrong transaction is to void it and enter it again. '
  'If the voided row still holds the reference, the re-entry is refused as a '
  'duplicate and the operator has to leave the reference off.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source, reference_number)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 500, 'voided', 'manual', 'REF-227')$s$,
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source, reference_number)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 550, 'awaiting_confirm', 'manual', 'REF-227')$s$
  ]);

-- ---------------------------------------------------------------------------
-- 2.28–2.30 — adding and retiring wallets (20260925000004).
-- ---------------------------------------------------------------------------
SELECT harness.probe('layer2', '2.28 a wallet added later can be transacted on',
  'A new wallet has no fee rules of its own; the type-wide rules must cover '
  'it, and post_entry must be able to find its account by name.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$SELECT gocash.add_platform('11111111-1111-1111-1111-111111111111', '  ShopeePay ')$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('d0000000-0000-0000-0000-000000000028',
               '11111111-1111-1111-1111-111111111111',
               'Cash Out', 'ShopeePay', 1000, 'awaiting_confirm', 'manual')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000028',
         '[{"kind":"platform","platform":"ShopeePay","amount_minor":100000},
           {"kind":"cash","amount_minor":-98000},
           {"kind":"revenue","amount_minor":-2000}]'::jsonb,
         '{"platform":"ShopeePay","transaction_type":"Cash Out","amount":1000,"net_profit":20}'::jsonb,
         'confirm-228', 'harness')$s$
  ],
  $q$
  SELECT (SELECT balance_minor FROM gocash.account_balances
          WHERE operator_id = '11111111-1111-1111-1111-111111111111'
            AND name = 'ShopeePay') = 100000
     AND (SELECT count(*) FROM gocash.operator_platforms
          WHERE operator_id = '11111111-1111-1111-1111-111111111111'
            AND name = 'ShopeePay' AND NOT is_builtin) = 1
  $q$);

SELECT harness.expect_error('layer2', '2.29 a wallet cannot be added twice under another spelling',
  'Two accounts called "GCash" and "gcash" would split one wallet''s balance '
  'across two rows, and neither would match the app.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$SELECT gocash.add_platform('11111111-1111-1111-1111-111111111111', 'gcash')$s$
  ],
  'already exists');

SELECT harness.expect_error('layer2', '2.30 a wallet holding money cannot be retired',
  'A retired wallet is hidden from the app. Retiring one with a balance hides '
  'that money while it still counts in the books.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$SELECT gocash.retire_platform('11111111-1111-1111-1111-111111111111',
                                    'aaaa0000-0000-0000-0000-000000000001')$s$
  ],
  'still holds a balance');

-- ---------------------------------------------------------------------------
-- 2.31–2.36 — staff logins (20260926000001).
--
-- These impersonate real users: the role is the browser role and the `sub`
-- claim is the login. Maria (…0a) owns operator 1111. Tess (…0c) is added as
-- her staff. Olga (…0d) has a login and belongs to nothing.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('f0000000-0000-0000-0000-00000000000c', 'tess@example.test'),
  ('f0000000-0000-0000-0000-00000000000d', 'olga@example.test');

INSERT INTO gocash.operator_members (operator_id, user_id, email) VALUES
  ('11111111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-00000000000c', 'tess@example.test');

SELECT harness.expect_ok('layer2', '2.31 staff see the shop''s books and are reported as staff',
  'A staff login that cannot read the operator, its balances or its '
  'transactions is sent to onboarding and given separate books.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims',
         '{"role":"authenticated","sub":"f0000000-0000-0000-0000-00000000000c"}', true)$s$,
    $s$SET LOCAL ROLE authenticated$s$,
    $s$DO $do$
       BEGIN
         IF (SELECT count(*) FROM gocash.operators) <> 1 THEN
           RAISE EXCEPTION 'staff should see exactly their shop, saw % operators',
             (SELECT count(*) FROM gocash.operators);
         END IF;
         IF (SELECT count(*) FROM gocash.account_balances) < 4 THEN
           RAISE EXCEPTION 'staff cannot see the shop''s balances';
         END IF;
         IF (SELECT role FROM gocash.my_membership()) IS DISTINCT FROM 'staff' THEN
           RAISE EXCEPTION 'my_membership did not report staff';
         END IF;
         IF gocash.is_operator_owner('11111111-1111-1111-1111-111111111111') THEN
           RAISE EXCEPTION 'staff were reported as the owner';
         END IF;
       END
       $do$$s$
  ]);

SELECT harness.expect_ok('layer2', '2.32 the owner is reported as owner',
  'The owner is operators.user_id, not a member row. Everything owner-only '
  'depends on this answer.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims',
         '{"role":"authenticated","sub":"f0000000-0000-0000-0000-00000000000a"}', true)$s$,
    $s$SET LOCAL ROLE authenticated$s$,
    $s$DO $do$
       BEGIN
         IF (SELECT role FROM gocash.my_membership()) IS DISTINCT FROM 'owner'
            OR NOT gocash.is_operator_owner('11111111-1111-1111-1111-111111111111') THEN
           RAISE EXCEPTION 'the owner was not recognised';
         END IF;
         IF (SELECT count(*) FROM gocash.operators) <> 1 THEN
           RAISE EXCEPTION 'the owner saw % operators', (SELECT count(*) FROM gocash.operators);
         END IF;
       END
       $do$$s$
  ]);

SELECT harness.expect_ok('layer2', '2.33 a login that belongs to nothing sees nothing',
  'Adding members must not widen what an unrelated login can read.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims',
         '{"role":"authenticated","sub":"f0000000-0000-0000-0000-00000000000d"}', true)$s$,
    $s$SET LOCAL ROLE authenticated$s$,
    $s$DO $do$
       BEGIN
         IF (SELECT count(*) FROM gocash.operators) <> 0
            OR (SELECT count(*) FROM gocash.account_balances) <> 0
            OR (SELECT count(*) FROM gocash.transactions) <> 0
            OR (SELECT count(*) FROM gocash.operator_members) <> 0
            OR (SELECT count(*) FROM gocash.my_membership()) <> 0 THEN
           RAISE EXCEPTION 'an outsider could read another shop''s data';
         END IF;
       END
       $do$$s$
  ]);

SELECT harness.expect_error('layer2', '2.34 staff cannot change fees',
  'set_fee_rule is callable from the browser and its own check passes for any '
  'member. The trigger is the only thing keeping pricing with the owner.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims',
         '{"role":"authenticated","sub":"f0000000-0000-0000-0000-00000000000c"}', true)$s$,
    $s$SET LOCAL ROLE authenticated$s$,
    $s$SELECT gocash.set_fee_rule('11111111-1111-1111-1111-111111111111',
                                 'Cash In', 'GCash', 0, 0, 'ceil_unit')$s$
  ],
  'only the owner can change fees');

SELECT harness.expect_error('layer2', '2.35 a login with its own books cannot be added as staff',
  'One login, one set of books. Otherwise a screenshot from that person has '
  'two places it could belong.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$SELECT gocash.add_staff('11111111-1111-1111-1111-111111111111',
                              'f0000000-0000-0000-0000-00000000000b',
                              'nena@example.test', NULL)$s$
  ],
  'already has its own books');

SELECT harness.expect_error('layer2', '2.36 staff cannot add staff',
  'add_staff is for the server, after it has checked the caller is the owner.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims',
         '{"role":"authenticated","sub":"f0000000-0000-0000-0000-00000000000c"}', true)$s$,
    $s$SET LOCAL ROLE authenticated$s$,
    $s$SELECT gocash.add_staff('11111111-1111-1111-1111-111111111111',
                              'f0000000-0000-0000-0000-00000000000d',
                              'olga@example.test', NULL)$s$
  ],
  'permission denied');

-- ---------------------------------------------------------------------------
-- 2.37–2.40 — Wallet Transfer (20260927000001).
-- ---------------------------------------------------------------------------
SELECT harness.probe('layer2', '2.37 a transfer with a platform fee moves float and books the fee as a cost',
  'Moving the shop''s own money must change two wallets and nothing else. The '
  'platform''s charge is a cost; it must not touch revenue, and the expense '
  'account must exist even for an operator who never had one.',
  ARRAY[
    $s$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)$s$,
    $s$SELECT gocash.add_platform('11111111-1111-1111-1111-111111111111', 'Maya')$s$,
    $s$DELETE FROM gocash.accounts
       WHERE operator_id = '11111111-1111-1111-1111-111111111111' AND kind = 'expense'$s$,
    $s$CREATE TEMP TABLE harness_237 ON COMMIT DROP AS
       SELECT name, balance_minor FROM gocash.account_balances
       WHERE operator_id = '11111111-1111-1111-1111-111111111111'$s$,
    $s$INSERT INTO gocash.transactions
         (id, operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('d0000000-0000-0000-0000-000000000037',
               '11111111-1111-1111-1111-111111111111',
               'Wallet Transfer', 'GCash', 1000, 'awaiting_confirm', 'manual')$s$,
    $s$SELECT gocash.confirm_transaction(
         '11111111-1111-1111-1111-111111111111',
         'd0000000-0000-0000-0000-000000000037',
         '[{"kind":"platform","platform":"GCash","amount_minor":-101000},
           {"kind":"platform","platform":"Maya","amount_minor":100000},
           {"kind":"expense","amount_minor":1000}]'::jsonb,
         '{"platform":"GCash","transaction_type":"Wallet Transfer","amount":1000,
           "net_profit":0,"transfer_to":"Maya","platform_fee":10}'::jsonb,
         'confirm-237', 'harness')$s$
  ],
  $q$
  SELECT (SELECT b.balance_minor - h.balance_minor FROM gocash.account_balances b
            JOIN harness_237 h USING (name)
           WHERE b.operator_id = '11111111-1111-1111-1111-111111111111' AND b.name = 'GCash') = -101000
     AND (SELECT balance_minor FROM gocash.account_balances
           WHERE operator_id = '11111111-1111-1111-1111-111111111111' AND name = 'Maya') = 100000
     AND (SELECT balance_minor FROM gocash.account_balances
           WHERE operator_id = '11111111-1111-1111-1111-111111111111' AND kind = 'expense') = 1000
     AND (SELECT b.balance_minor - h.balance_minor FROM gocash.account_balances b
            JOIN harness_237 h USING (name)
           WHERE b.operator_id = '11111111-1111-1111-1111-111111111111' AND b.kind = 'revenue') = 0
     AND (SELECT (transfer_to, platform_fee, net_profit) = ('Maya', 10.00, 0.00)
            FROM gocash.transactions WHERE id = 'd0000000-0000-0000-0000-000000000037')
  $q$);

SELECT harness.expect_error('layer2', '2.38 a transfer cannot be confirmed without a destination',
  'A confirmed transfer with nowhere to go has posted money out of a wallet '
  'and into nothing the screen can name.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, amount, status, entry_source)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Wallet Transfer', 'GCash', 1000, 'confirmed', 'manual')$s$
  ],
  'transactions_transfer_shape');

SELECT harness.expect_error('layer2', '2.39 a transfer cannot go from a wallet to itself',
  'Source and destination the same is not a transfer; it is a typing mistake '
  'that would otherwise post a fee-only loss.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, transfer_to, amount, status, entry_source)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Wallet Transfer', 'GCash', 'gcash', 1000, 'awaiting_confirm', 'manual')$s$
  ],
  'transactions_transfer_shape');

SELECT harness.expect_error('layer2', '2.40 only a transfer carries a destination or a platform fee',
  'A customer transaction with a platform fee on it would have a cost the '
  'ledger entry for that type has no leg for.',
  ARRAY[
    $s$INSERT INTO gocash.transactions
         (operator_id, transaction_type, platform, platform_fee, amount, status, entry_source)
       VALUES ('11111111-1111-1111-1111-111111111111',
               'Cash In', 'GCash', 15, 1000, 'awaiting_confirm', 'manual')$s$
  ],
  'transactions_transfer_shape');

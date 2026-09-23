-- ===========================================================================
-- DRAFT — an executable walkthrough of the ledger.
--
-- Every scenario below is a real thing your operator does. Run it against a
-- scratch database that already has schema.sql applied and read the output.
-- ===========================================================================

\set QUIET on
\pset border 2

-- ---------------------------------------------------------------------------
-- SETUP — one operator, opening balances of 8,000 GCash / 12,000 cash
-- ---------------------------------------------------------------------------

INSERT INTO gocash.operators (id, user_id, name)
VALUES ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'Maria')
ON CONFLICT DO NOTHING;

INSERT INTO gocash.accounts (id, operator_id, kind, name) VALUES
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','platform','GCash'),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','platform','MariBank'),
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','cash','Cash'),
  ('a0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','revenue','Fee Revenue'),
  ('a0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','equity','Owner Equity');

INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo, created_by)
VALUES ('e0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'opening','Opening balances at go-live','migration');

INSERT INTO gocash.postings (entry_id, account_id, amount) VALUES
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',  8000.00),
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003', 12000.00),
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005',-20000.00);

\echo ''
\echo '=== 1. OPENING BALANCES ==================================================='
\echo 'Maria starts with 8,000 in GCash and 12,000 in the drawer.'
\echo 'The 20,000 she put into the business is recorded as Owner Equity.'
\echo ''
SELECT name, kind, balance, natural_balance FROM gocash.account_balances
WHERE operator_id='11111111-1111-1111-1111-111111111111' AND posting_count > 0
ORDER BY kind, name;

-- ---------------------------------------------------------------------------
-- SCENARIO 2 — a normal cash in
-- ---------------------------------------------------------------------------

INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo, idempotency_key, created_by)
VALUES ('e0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
        'transaction','Cash in 500 for 09171234567','confirm-tx-aaa-001','maria');

INSERT INTO gocash.postings (entry_id, account_id, amount) VALUES
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003',  510.00), -- Cash
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001', -500.00), -- GCash
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000004',  -10.00); -- Revenue

\echo ''
\echo '=== 2. CASH IN 500, FEE 10 ================================================'
\echo 'Customer handed over 510 cash and received 500 of e-money.'
\echo 'Cash 12,000 -> 12,510   GCash 8,000 -> 7,500   Earned 10.'
\echo ''
SELECT name, kind, balance, natural_balance FROM gocash.account_balances
WHERE operator_id='11111111-1111-1111-1111-111111111111' AND posting_count > 0
ORDER BY kind, name;

-- ---------------------------------------------------------------------------
-- SCENARIO 3 — try to write the rule that is live TODAY
-- EXPECTED OUTPUT: an error. That error is the whole point of this redesign.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 3. THE LIVE BILLS PAYMENT RULE (expect an error) ======================'
\echo 'Live rule records GCash -1850 and Cash +15 (the fee only).'
\echo '1,835 pesos are unaccounted for. Today this commits silently.'
\echo ''
BEGIN;
INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo)
VALUES ('e0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
        'transaction','Meralco 1850 - using the CURRENT live rule');
INSERT INTO gocash.postings (entry_id, account_id, amount) VALUES
  ('e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001',-1850.00),
  ('e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004',   15.00);
COMMIT;
--   ERROR: ledger entry ... does not balance: sum = -1835.00
ROLLBACK;

-- ---------------------------------------------------------------------------
-- SCENARIO 4 — the same bill, posted correctly
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 4. THE SAME BILL, POSTED CORRECTLY ==================================='
BEGIN;
INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo, idempotency_key)
VALUES ('e0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
        'transaction','Meralco 1850, fee 15','confirm-tx-bbb-002');
INSERT INTO gocash.postings (entry_id, account_id, amount) VALUES
  ('e0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000003', 1865.00),
  ('e0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001',-1850.00),
  ('e0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000004',  -15.00);
COMMIT;
SELECT name, kind, balance, natural_balance FROM gocash.account_balances
WHERE posting_count > 0 ORDER BY kind, name;

-- ---------------------------------------------------------------------------
-- SCENARIO 5 — the ledger is append-only
-- EXPECTED OUTPUT: two errors.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 5. EDITING A POSTING (expect errors) ================================='
\echo 'Settings > Wallets currently overwrites a balance with no trace.'
\echo 'Here that is simply not a thing you can do.'
\echo ''
UPDATE gocash.postings SET amount = 99999 WHERE entry_id='e0000000-0000-0000-0000-000000000002';
DELETE FROM gocash.postings WHERE entry_id='e0000000-0000-0000-0000-000000000002';
--   ERROR: gocash.postings is append-only - post a reversal entry instead of editing

-- ---------------------------------------------------------------------------
-- SCENARIO 6 — double-confirm
-- EXPECTED OUTPUT: a unique-violation. The live code cannot detect this case.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 6. DOUBLE-CONFIRM, SAME IDEMPOTENCY KEY (expect an error) ============'
INSERT INTO gocash.ledger_entries (operator_id, kind, memo, idempotency_key)
VALUES ('11111111-1111-1111-1111-111111111111','transaction','Cash in 500 REPLAYED','confirm-tx-aaa-001');
--   ERROR: duplicate key value violates unique constraint "ledger_entries_idempotency"

-- ---------------------------------------------------------------------------
-- SCENARIO 7 — the operator edits a confirmed transaction
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 7. THAT 500 CASH IN WAS REALLY 600 =================================='
\echo 'Reverse the old entry, post the new one. All three stay in the ledger.'
\echo ''
BEGIN;
INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo, reverses_entry_id)
VALUES ('e0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
        'reversal','Correcting: amount was 600 not 500','e0000000-0000-0000-0000-000000000002');
INSERT INTO gocash.postings (entry_id, account_id, amount) VALUES
  ('e0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000003',-510.00),
  ('e0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001', 500.00),
  ('e0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000004',  10.00);

INSERT INTO gocash.ledger_entries (id, operator_id, kind, memo, idempotency_key)
VALUES ('e0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111',
        'transaction','Cash in 600, fee 12 (corrected)','confirm-tx-aaa-001-v2');
INSERT INTO gocash.postings (entry_id, account_id, amount) VALUES
  ('e0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000003', 612.00),
  ('e0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001',-600.00),
  ('e0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000004', -12.00);
COMMIT;

SELECT name, kind, balance, natural_balance FROM gocash.account_balances
WHERE posting_count > 0 ORDER BY kind, name;

-- ---------------------------------------------------------------------------
-- SCENARIO 8 — "why is my GCash balance what it is?"
-- Unanswerable today. Here it is one query.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 8. FULL HISTORY OF THE GCASH ACCOUNT ================================'
SELECT e.created_at::date AS on_date, e.kind, e.memo, p.amount,
       SUM(p.amount) OVER (ORDER BY e.created_at, p.id) AS running_balance
FROM gocash.postings p
JOIN gocash.ledger_entries e ON e.id = p.entry_id
WHERE p.account_id = 'a0000000-0000-0000-0000-000000000001'
ORDER BY e.created_at, p.id;

-- ---------------------------------------------------------------------------
-- SCENARIO 9 — health check. Must always return zero.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== 9. HEALTH CHECK (must be 0) ========================================='
SELECT count(*) AS unbalanced_entries FROM gocash.unbalanced_entries;

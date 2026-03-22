-- Migration: Row-Level Security policies
-- All tables require explicit RLS. No public access without a policy.
-- Pattern: operators own their data via operators.user_id = auth.uid()

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------
ALTER TABLE gocash.operators         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.wallets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.transaction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- operators
-- ---------------------------------------------------------------------------
CREATE POLICY operators_select_own ON gocash.operators
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY operators_insert_own ON gocash.operators
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY operators_update_own ON gocash.operators
  FOR UPDATE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- wallets  (join through operators to resolve ownership)
-- ---------------------------------------------------------------------------
CREATE POLICY wallets_select_own ON gocash.wallets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = wallets.operator_id
        AND operators.user_id = auth.uid()
    )
  );

CREATE POLICY wallets_insert_own ON gocash.wallets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = wallets.operator_id
        AND operators.user_id = auth.uid()
    )
  );

CREATE POLICY wallets_update_own ON gocash.wallets
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = wallets.operator_id
        AND operators.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
CREATE POLICY transactions_select_own ON gocash.transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = transactions.operator_id
        AND operators.user_id = auth.uid()
    )
  );

CREATE POLICY transactions_insert_own ON gocash.transactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = transactions.operator_id
        AND operators.user_id = auth.uid()
    )
  );

CREATE POLICY transactions_update_own ON gocash.transactions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = transactions.operator_id
        AND operators.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- transaction_rules
-- ---------------------------------------------------------------------------
CREATE POLICY rules_select_own ON gocash.transaction_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = transaction_rules.operator_id
        AND operators.user_id = auth.uid()
    )
  );

CREATE POLICY rules_insert_own ON gocash.transaction_rules
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = transaction_rules.operator_id
        AND operators.user_id = auth.uid()
    )
  );

CREATE POLICY rules_update_own ON gocash.transaction_rules
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = transaction_rules.operator_id
        AND operators.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- audit_logs  (insert-only via service role; operators can read their own)
-- ---------------------------------------------------------------------------
CREATE POLICY audit_select_own ON gocash.audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM gocash.operators
      WHERE operators.id = audit_logs.operator_id
        AND operators.user_id = auth.uid()
    )
  );
-- INSERTs to audit_logs are service-role only (no client INSERT policy)

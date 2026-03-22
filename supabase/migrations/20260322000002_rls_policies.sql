
ALTER TABLE gocash.operators         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.wallets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.transaction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gocash.audit_logs        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'operators'
      AND policyname = 'operators_select_own'
  ) THEN
    CREATE POLICY operators_select_own ON gocash.operators
      FOR SELECT USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'operators'
      AND policyname = 'operators_insert_own'
  ) THEN
    CREATE POLICY operators_insert_own ON gocash.operators
      FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'operators'
      AND policyname = 'operators_update_own'
  ) THEN
    CREATE POLICY operators_update_own ON gocash.operators
      FOR UPDATE USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'wallets'
      AND policyname = 'wallets_select_own'
  ) THEN
    CREATE POLICY wallets_select_own ON gocash.wallets
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = wallets.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'wallets'
      AND policyname = 'wallets_insert_own'
  ) THEN
    CREATE POLICY wallets_insert_own ON gocash.wallets
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = wallets.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'wallets'
      AND policyname = 'wallets_update_own'
  ) THEN
    CREATE POLICY wallets_update_own ON gocash.wallets
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = wallets.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'transactions'
      AND policyname = 'transactions_select_own'
  ) THEN
    CREATE POLICY transactions_select_own ON gocash.transactions
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = transactions.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'transactions'
      AND policyname = 'transactions_insert_own'
  ) THEN
    CREATE POLICY transactions_insert_own ON gocash.transactions
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = transactions.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'transactions'
      AND policyname = 'transactions_update_own'
  ) THEN
    CREATE POLICY transactions_update_own ON gocash.transactions
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = transactions.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'transaction_rules'
      AND policyname = 'rules_select_own'
  ) THEN
    CREATE POLICY rules_select_own ON gocash.transaction_rules
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = transaction_rules.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'transaction_rules'
      AND policyname = 'rules_insert_own'
  ) THEN
    CREATE POLICY rules_insert_own ON gocash.transaction_rules
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = transaction_rules.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'transaction_rules'
      AND policyname = 'rules_update_own'
  ) THEN
    CREATE POLICY rules_update_own ON gocash.transaction_rules
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = transaction_rules.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'audit_logs'
      AND policyname = 'audit_select_own'
  ) THEN
    CREATE POLICY audit_select_own ON gocash.audit_logs
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = audit_logs.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;
END $$;

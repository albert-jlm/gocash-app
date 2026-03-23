ALTER TABLE IF EXISTS gocash.receipt_deletion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS gocash.receipt_deletion_queue FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'receipt_deletion_queue'
      AND policyname = 'receipt_deletion_queue_no_access'
  ) THEN
    CREATE POLICY receipt_deletion_queue_no_access
      ON gocash.receipt_deletion_queue
      AS RESTRICTIVE
      FOR ALL
      TO public
      USING (FALSE)
      WITH CHECK (FALSE);
  END IF;
END $$;

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'gocash'
      AND p.proname IN ('update_updated_at', 'initialize_operator_defaults')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = gocash, public',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  END LOOP;
END $$;

DO $$
DECLARE
  target_table RECORD;
BEGIN
  FOR target_table IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('test', 'Test')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target_table.schemaname,
      target_table.tablename
    );

    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      target_table.schemaname,
      target_table.tablename
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = target_table.schemaname
        AND tablename = target_table.tablename
        AND policyname = 'test_table_no_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY test_table_no_access ON %I.%I AS RESTRICTIVE FOR ALL TO public USING (FALSE) WITH CHECK (FALSE)',
        target_table.schemaname,
        target_table.tablename
      );
    END IF;
  END LOOP;
END $$;

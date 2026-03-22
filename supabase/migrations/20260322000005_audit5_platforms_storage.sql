
CREATE TABLE IF NOT EXISTS gocash.operator_platforms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT operator_platforms_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS operator_platforms_unique_name_ci
  ON gocash.operator_platforms (operator_id, lower(name));

CREATE INDEX IF NOT EXISTS operator_platforms_operator_active_idx
  ON gocash.operator_platforms (operator_id, is_active, name);

ALTER TABLE gocash.operator_platforms ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'operator_platforms'
      AND policyname = 'operator_platforms_select_own'
  ) THEN
    CREATE POLICY operator_platforms_select_own ON gocash.operator_platforms
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = operator_platforms.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'operator_platforms'
      AND policyname = 'operator_platforms_insert_own'
  ) THEN
    CREATE POLICY operator_platforms_insert_own ON gocash.operator_platforms
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = operator_platforms.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'gocash'
      AND tablename = 'operator_platforms'
      AND policyname = 'operator_platforms_update_own'
  ) THEN
    CREATE POLICY operator_platforms_update_own ON gocash.operator_platforms
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.id = operator_platforms.operator_id
            AND operators.user_id = auth.uid()
        )
      );
  END IF;
END $$;

ALTER TABLE gocash.wallets
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'zinc',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE gocash.wallets
SET color = CASE wallet_name
  WHEN 'GCash' THEN 'blue'
  WHEN 'MariBank' THEN 'purple'
  WHEN 'Maya' THEN 'cyan'
  WHEN 'Cash' THEN 'emerald'
  ELSE 'zinc'
END
WHERE color IS NULL OR color = '';

UPDATE gocash.wallets
SET is_active = TRUE
WHERE is_active IS NULL;

WITH discovered_platforms AS (
  SELECT DISTINCT operator_id, wallet_name AS name
  FROM gocash.wallets
  WHERE wallet_type = 'platform'

  UNION

  SELECT DISTINCT operator_id, platform AS name
  FROM gocash.transaction_rules
  WHERE platform <> 'all'

  UNION

  SELECT DISTINCT operator_id, platform AS name
  FROM gocash.transactions
  WHERE platform <> 'Unknown'
),
builtins AS (
  SELECT operators.id AS operator_id, builtin.name
  FROM gocash.operators AS operators
  CROSS JOIN (
    VALUES ('GCash'), ('MariBank'), ('Maya')
  ) AS builtin(name)
),
all_platforms AS (
  SELECT operator_id, name FROM discovered_platforms
  UNION
  SELECT operator_id, name FROM builtins
)
INSERT INTO gocash.operator_platforms (operator_id, name, is_builtin, is_active)
SELECT
  platforms.operator_id,
  platforms.name,
  platforms.name IN ('GCash', 'MariBank', 'Maya'),
  TRUE
FROM all_platforms AS platforms
WHERE NOT EXISTS (
  SELECT 1
  FROM gocash.operator_platforms AS existing
  WHERE existing.operator_id = platforms.operator_id
    AND lower(existing.name) = lower(platforms.name)
);

INSERT INTO gocash.wallets (operator_id, wallet_type, wallet_name, balance, color, is_active)
SELECT
  operators.id,
  wallet_def.wallet_type,
  wallet_def.wallet_name,
  0,
  wallet_def.color,
  TRUE
FROM gocash.operators AS operators
CROSS JOIN (
  VALUES
    ('platform', 'GCash', 'blue'),
    ('platform', 'MariBank', 'purple'),
    ('platform', 'Maya', 'cyan'),
    ('cash', 'Cash', 'emerald')
) AS wallet_def(wallet_type, wallet_name, color)
ON CONFLICT ON CONSTRAINT unique_wallet_per_operator DO NOTHING;

ALTER TABLE gocash.transactions
  DROP CONSTRAINT IF EXISTS transactions_platform_check;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_unique_reference_per_operator
  ON gocash.transactions (operator_id, reference_number)
  WHERE reference_number IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'transaction-images',
  'transaction-images',
  FALSE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'transaction_images_select_own'
  ) THEN
    CREATE POLICY transaction_images_select_own ON storage.objects
      FOR SELECT USING (
        bucket_id = 'transaction-images'
        AND EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.user_id = auth.uid()
            AND operators.id::text = (storage.foldername(name))[1]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'transaction_images_insert_own'
  ) THEN
    CREATE POLICY transaction_images_insert_own ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'transaction-images'
        AND EXISTS (
          SELECT 1 FROM gocash.operators
          WHERE operators.user_id = auth.uid()
            AND operators.id::text = (storage.foldername(name))[1]
        )
      );
  END IF;
END $$;

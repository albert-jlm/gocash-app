
CREATE SCHEMA IF NOT EXISTS gocash;

CREATE TABLE IF NOT EXISTS gocash.operators (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email             TEXT NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  phone             TEXT,
  telegram_chat_id  TEXT,
  settings          JSONB NOT NULL DEFAULT '{}',
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'basic', 'premium')),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_operator_per_user UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS gocash.wallets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  wallet_type         TEXT NOT NULL CHECK (wallet_type IN ('platform', 'cash')),
  wallet_name         TEXT NOT NULL,
  balance             NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_transaction_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_wallet_per_operator UNIQUE (operator_id, wallet_name)
);

CREATE TABLE IF NOT EXISTS gocash.transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  transaction_type  TEXT NOT NULL
    CONSTRAINT transactions_transaction_type_check
    CHECK (transaction_type IN (
      'Cash In','Cash Out','Telco Load',
      'Bills Payment','Bank Transfer','Profit Remittance','Unknown'
    )),
  platform          TEXT NOT NULL
    CONSTRAINT transactions_platform_check
    CHECK (platform IN ('GCash','MariBank','Maya','Unknown')),
  account_number    TEXT,
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_profit        NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference_number  TEXT,
  transaction_date  TIMESTAMPTZ,
  time_24hr         TEXT,
  full_date         TEXT,
  year              TEXT,
  month             TEXT,
  day               TEXT,
  image_url         TEXT,
  ai_raw_text       TEXT,
  status            TEXT NOT NULL DEFAULT 'uploaded'
    CONSTRAINT transactions_status_check
    CHECK (status IN ('uploaded','processing','awaiting_confirm','confirmed','edited','failed')),
  was_edited        BOOLEAN NOT NULL DEFAULT FALSE,
  edit_history      JSONB NOT NULL DEFAULT '[]',
  processing_errors TEXT[],
  starting_cash     NUMERIC(14,2),
  wallet_balance    NUMERIC(14,2),
  confirmed_at      TIMESTAMPTZ,
  confirmed_by      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gocash.transaction_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  transaction_type      TEXT NOT NULL,
  platform              TEXT NOT NULL,
  delta_platform_mult   NUMERIC(6,4) NOT NULL DEFAULT 0,
  delta_cash_amount_mult NUMERIC(6,4) NOT NULL DEFAULT 0,
  delta_cash_mult       NUMERIC(6,4) NOT NULL DEFAULT 0,
  profit_rate           NUMERIC(6,4),
  profit_minimum        NUMERIC(14,2),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gocash.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID REFERENCES gocash.operators(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  changes     JSONB,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ===========================================================================
-- BASELINE — the gocash schema as it ACTUALLY existed in production.
--
-- Generated 2026-09-23 by:
--   docker exec supabase-db pg_dump -U postgres -d postgres \
--     --schema=gocash --schema-only --no-owner --no-privileges
--
-- WHY THIS EXISTS
-- The four migrations previously in this directory described a system that
-- never existed. Production was built by hand: 7 tables / 9 functions /
-- 6 triggers / 21 indexes, versus 5 / 2 / 0 / 0 from those files. The real
-- migration history was never recorded and cannot be reconstructed, so this
-- is a squashed snapshot of reality rather than an invented sequence.
-- See AUDITS.md entries #5 and #5a.
--
-- Captured: 7 tables, 9 functions, 21 indexes, 6 triggers,
--           7 RLS enablements, 18 policies.
--
-- NOTE ON PRIVILEGES
-- Dumped with --no-privileges, so the GRANTs are NOT reproduced here. That is
-- deliberate: the live grants are the vulnerability from Audit #5a. Postgres
-- still grants EXECUTE to PUBLIC on every CREATE FUNCTION by default, so a
-- replay of this file alone reproduces the hole. The very next migration,
-- 20260923000001_revoke_public_execute.sql, is what closes it and must always
-- run with this one.
-- ===========================================================================

--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: gocash; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA gocash;


--
-- Name: confirm_transaction_atomic(uuid, uuid, text, text, numeric, text, numeric, numeric, text, numeric, text, text, numeric, text, text, timestamp with time zone, boolean, jsonb); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.confirm_transaction_atomic(p_transaction_id uuid, p_operator_id uuid, p_user_id text, p_previous_platform_wallet text, p_previous_platform_delta numeric, p_next_platform_wallet text, p_next_platform_delta numeric, p_cash_delta numeric, p_status text, p_net_profit numeric, p_platform text, p_transaction_type text, p_amount numeric, p_account_number text, p_reference_number text, p_transaction_date timestamp with time zone, p_was_edited boolean, p_edit_history jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'gocash', 'public'
    AS $$
DECLARE
  v_confirmed_at TIMESTAMPTZ := NOW();
BEGIN
  IF p_previous_platform_wallet IS NOT NULL AND p_previous_platform_delta <> 0 THEN
    UPDATE gocash.wallets
    SET
      balance             = balance + p_previous_platform_delta,
      last_transaction_id = p_transaction_id,
      updated_at          = v_confirmed_at
    WHERE operator_id = p_operator_id
      AND wallet_name  = p_previous_platform_wallet
      AND is_active    = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Previous platform wallet not found: % (operator %)', p_previous_platform_wallet, p_operator_id;
    END IF;
  END IF;

  IF p_next_platform_wallet IS NOT NULL AND p_next_platform_delta <> 0 THEN
    UPDATE gocash.wallets
    SET
      balance             = balance + p_next_platform_delta,
      last_transaction_id = p_transaction_id,
      updated_at          = v_confirmed_at
    WHERE operator_id = p_operator_id
      AND wallet_name  = p_next_platform_wallet
      AND is_active    = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Next platform wallet not found: % (operator %)', p_next_platform_wallet, p_operator_id;
    END IF;
  END IF;

  IF p_cash_delta <> 0 THEN
    UPDATE gocash.wallets
    SET
      balance             = balance + p_cash_delta,
      last_transaction_id = p_transaction_id,
      updated_at          = v_confirmed_at
    WHERE operator_id = p_operator_id
      AND wallet_name  = 'Cash'
      AND is_active    = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cash wallet not found (operator %)', p_operator_id;
    END IF;
  END IF;

  UPDATE gocash.transactions
  SET
    status           = p_status,
    confirmed_at     = COALESCE(confirmed_at, v_confirmed_at),
    confirmed_by     = p_user_id,
    net_profit       = p_net_profit,
    platform         = p_platform,
    transaction_type = p_transaction_type,
    amount           = p_amount,
    account_number   = p_account_number,
    reference_number = p_reference_number,
    transaction_date = p_transaction_date,
    was_edited       = p_was_edited,
    edit_history     = p_edit_history,
    updated_at       = v_confirmed_at
  WHERE id          = p_transaction_id
    AND operator_id = p_operator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or operator mismatch: %', p_transaction_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'confirmed_at', v_confirmed_at);
END;
$$;


--
-- Name: delete_platform_atomic(uuid, text, text); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.delete_platform_atomic(p_operator_id uuid, p_platform_name text, p_user_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'gocash', 'public'
    AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_platform_id UUID;
  v_platform_name TEXT;
  v_wallet_balance NUMERIC := 0;
  v_transaction_count INTEGER := 0;
  v_rule_count INTEGER := 0;
  v_wallet_deleted_count INTEGER := 0;
  v_rules_deleted_count INTEGER := 0;
  v_platform_deleted_count INTEGER := 0;
  v_audit_entity_id_type TEXT;
BEGIN
  IF btrim(COALESCE(p_platform_name, '')) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_platform',
      'message', 'Platform name is required'
    );
  END IF;

  IF lower(btrim(p_platform_name)) = 'cash' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'cash_protected',
      'message', 'Cash is a permanent register and cannot be deleted'
    );
  END IF;

  SELECT id, name
  INTO v_platform_id, v_platform_name
  FROM gocash.operator_platforms
  WHERE operator_id = p_operator_id
    AND lower(name) = lower(btrim(p_platform_name))
  LIMIT 1;

  IF v_platform_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'not_found',
      'message', 'Platform not found'
    );
  END IF;

  SELECT COALESCE((
    SELECT balance
    FROM gocash.wallets
    WHERE operator_id = p_operator_id
      AND wallet_type = 'platform'
      AND lower(wallet_name) = lower(v_platform_name)
    LIMIT 1
  ), 0)
  INTO v_wallet_balance;

  SELECT COUNT(*)
  INTO v_transaction_count
  FROM gocash.transactions
  WHERE operator_id = p_operator_id
    AND platform = v_platform_name;

  SELECT COUNT(*)
  INTO v_rule_count
  FROM gocash.transaction_rules
  WHERE operator_id = p_operator_id
    AND platform = v_platform_name;

  IF COALESCE(v_wallet_balance, 0) <> 0 OR v_transaction_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'dependencies_exist',
      'message', 'Platform still has dependencies',
      'platform', v_platform_name,
      'wallet_balance', COALESCE(v_wallet_balance, 0),
      'transaction_count', v_transaction_count,
      'rule_count', v_rule_count
    );
  END IF;

  DELETE FROM gocash.transaction_rules
  WHERE operator_id = p_operator_id
    AND platform = v_platform_name;
  GET DIAGNOSTICS v_rules_deleted_count = ROW_COUNT;

  DELETE FROM gocash.wallets
  WHERE operator_id = p_operator_id
    AND wallet_type = 'platform'
    AND lower(wallet_name) = lower(v_platform_name);
  GET DIAGNOSTICS v_wallet_deleted_count = ROW_COUNT;

  DELETE FROM gocash.operator_platforms
  WHERE id = v_platform_id;
  GET DIAGNOSTICS v_platform_deleted_count = ROW_COUNT;

  SELECT a.atttypid::regtype::text
  INTO v_audit_entity_id_type
  FROM pg_attribute AS a
  JOIN pg_class AS c
    ON c.oid = a.attrelid
  JOIN pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND c.relname = 'audit_logs'
    AND a.attname = 'entity_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_audit_entity_id_type = 'uuid' THEN
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'platform',
      v_platform_id,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'platform_name', v_platform_name,
        'deleted_rule_count', v_rules_deleted_count,
        'deleted_wallet_count', v_wallet_deleted_count
      )
    );
  ELSE
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'platform',
      v_platform_id::text,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'platform_name', v_platform_name,
        'deleted_rule_count', v_rules_deleted_count,
        'deleted_wallet_count', v_wallet_deleted_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'platform', v_platform_name,
    'deleted_platform_count', v_platform_deleted_count,
    'deleted_wallet_count', v_wallet_deleted_count,
    'deleted_rule_count', v_rules_deleted_count
  );
END;
$$;


--
-- Name: delete_transaction_atomic(uuid, uuid, text, text, numeric, numeric); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.delete_transaction_atomic(p_transaction_id uuid, p_operator_id uuid, p_user_id text, p_platform_wallet text, p_platform_delta numeric, p_cash_delta numeric) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'gocash', 'public'
    AS $$
  SELECT gocash.delete_transaction_atomic(
    p_transaction_id,
    p_operator_id,
    p_user_id,
    p_platform_wallet,
    p_platform_delta,
    p_cash_delta,
    NULL,
    NULL
  );
$$;


--
-- Name: delete_transaction_atomic(uuid, uuid, text, text, numeric, numeric, text, text); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.delete_transaction_atomic(p_transaction_id uuid, p_operator_id uuid, p_user_id text, p_platform_wallet text, p_platform_delta numeric, p_cash_delta numeric, p_receipt_bucket text, p_receipt_path text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'gocash', 'public'
    AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_audit_entity_id_type TEXT;
BEGIN
  IF p_platform_wallet IS NOT NULL AND p_platform_delta <> 0 THEN
    UPDATE gocash.wallets
    SET balance = balance + p_platform_delta,
        updated_at = v_now
    WHERE operator_id = p_operator_id
      AND wallet_name = p_platform_wallet
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform wallet not found: % (operator %)', p_platform_wallet, p_operator_id;
    END IF;
  END IF;

  IF p_cash_delta <> 0 THEN
    UPDATE gocash.wallets
    SET balance = balance + p_cash_delta,
        updated_at = v_now
    WHERE operator_id = p_operator_id
      AND wallet_name = 'Cash'
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cash wallet not found (operator %)', p_operator_id;
    END IF;
  END IF;

  IF p_receipt_bucket IS NOT NULL AND btrim(COALESCE(p_receipt_bucket, '')) <> ''
     AND p_receipt_path IS NOT NULL AND btrim(COALESCE(p_receipt_path, '')) <> '' THEN
    INSERT INTO gocash.receipt_deletion_queue (bucket, path, delete_after, attempted_at, deleted_at, last_error, updated_at)
    VALUES (
      p_receipt_bucket,
      p_receipt_path,
      v_now + INTERVAL '30 days',
      NULL,
      NULL,
      NULL,
      v_now
    )
    ON CONFLICT (bucket, path)
    DO UPDATE SET
      delete_after = EXCLUDED.delete_after,
      attempted_at = NULL,
      deleted_at = NULL,
      last_error = NULL,
      updated_at = v_now;
  END IF;

  UPDATE gocash.wallets
  SET last_transaction_id = NULL,
      updated_at = v_now
  WHERE operator_id = p_operator_id
    AND last_transaction_id = p_transaction_id;

  DELETE FROM gocash.transactions
  WHERE id = p_transaction_id
    AND operator_id = p_operator_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found or operator mismatch: %', p_transaction_id;
  END IF;

  SELECT a.atttypid::regtype::text
  INTO v_audit_entity_id_type
  FROM pg_attribute AS a
  JOIN pg_class AS c
    ON c.oid = a.attrelid
  JOIN pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'gocash'
    AND c.relname = 'audit_logs'
    AND a.attname = 'entity_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_audit_entity_id_type = 'uuid' THEN
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'transaction',
      p_transaction_id,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'receipt_queued', p_receipt_path IS NOT NULL AND btrim(COALESCE(p_receipt_path, '')) <> ''
      )
    );
  ELSE
    INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    VALUES (
      p_operator_id,
      'transaction',
      p_transaction_id::text,
      'delete',
      jsonb_build_object(
        'deleted_by', p_user_id,
        'deleted_at', v_now,
        'receipt_queued', p_receipt_path IS NOT NULL AND btrim(COALESCE(p_receipt_path, '')) <> ''
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: initialize_operator_defaults(); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.initialize_operator_defaults() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'gocash', 'public'
    AS $$
BEGIN
    INSERT INTO gocash.wallets (operator_id, wallet_type, wallet_name, balance) VALUES
        (NEW.id, 'platform', 'GCash', 0),
        (NEW.id, 'platform', 'MariBank', 0),
        (NEW.id, 'cash', 'Cash', 0);

    INSERT INTO gocash.transaction_rules (
        operator_id, transaction_type, platform,
        delta_platform_mult, delta_cash_amount_mult, delta_cash_mult
    ) VALUES
        (NEW.id, 'Cash In',           'all',  1,  -1, 1),
        (NEW.id, 'Cash Out',          'all', -1,   1, 1),
        (NEW.id, 'Telco Load',        'all', -1,   0, 1),
        (NEW.id, 'Bills Payment',     'all', -1,   0, 1),
        (NEW.id, 'Bank Transfer',     'all', -1,   0, 0),
        (NEW.id, 'Profit Remittance', 'all', -1,   1, 0);

    RETURN NEW;
END;
$$;


--
-- Name: log_transaction_changes(); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.log_transaction_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'gocash'
    AS $$ BEGIN IF TG_OP = 'INSERT' THEN INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, changes) VALUES (NEW.operator_id, 'transaction', NEW.id, 'create', to_jsonb(NEW)); ELSIF TG_OP = 'UPDATE' THEN INSERT INTO gocash.audit_logs (operator_id, entity_type, entity_id, action, changes) VALUES (NEW.operator_id, 'transaction', NEW.id, 'update', jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))); END IF; RETURN NEW; END; $$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'gocash', 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_wallet_balance(uuid, text, numeric, uuid); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.update_wallet_balance(p_operator_id uuid, p_wallet_name text, p_delta numeric, p_transaction_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'gocash', 'public'
    AS $$
BEGIN
  UPDATE gocash.wallets
  SET
    balance             = balance + p_delta,
    last_transaction_id = COALESCE(p_transaction_id, last_transaction_id),
    updated_at          = NOW()
  WHERE operator_id = p_operator_id
    AND wallet_name  = p_wallet_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found: % (operator %)', p_wallet_name, p_operator_id;
  END IF;
END;
$$;


--
-- Name: upsert_operator(uuid, text, text, text); Type: FUNCTION; Schema: gocash; Owner: -
--

CREATE FUNCTION gocash.upsert_operator(p_user_id uuid, p_email text, p_name text, p_phone text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'gocash', 'public'
    AS $$
DECLARE
  v_operator_id UUID;
BEGIN
  -- 1. Existing operator for this auth user
  SELECT id INTO v_operator_id
    FROM gocash.operators
   WHERE user_id = p_user_id;

  IF v_operator_id IS NOT NULL THEN
    RETURN v_operator_id;
  END IF;

  -- 2. Orphaned operator whose email matches (e.g. auth user was deleted & re-created)
  SELECT id INTO v_operator_id
    FROM gocash.operators
   WHERE email = p_email
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_operator_id IS NOT NULL THEN
    UPDATE gocash.operators
       SET user_id   = p_user_id,
           name      = COALESCE(NULLIF(p_name, ''), name),
           phone     = COALESCE(p_phone, phone),
           is_active = TRUE,
           updated_at = NOW()
     WHERE id = v_operator_id;

    RETURN v_operator_id;
  END IF;

  -- 3. Brand-new operator
  INSERT INTO gocash.operators (user_id, email, name, phone, subscription_tier, is_active, settings)
  VALUES (p_user_id, p_email, p_name, p_phone, 'free', TRUE, '{}')
  RETURNING id INTO v_operator_id;

  RETURN v_operator_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.audit_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    operator_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    changes jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: operator_platforms; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.operator_platforms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operator_id uuid NOT NULL,
    name text NOT NULL,
    is_builtin boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operator_platforms_name_not_blank CHECK ((btrim(name) <> ''::text))
);


--
-- Name: operators; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.operators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    phone text,
    telegram_chat_id text,
    settings jsonb DEFAULT '{"currency": "PHP", "timezone": "Asia/Manila", "notifications": {"push": true, "email": false, "telegram": false}}'::jsonb,
    subscription_tier text DEFAULT 'free'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    CONSTRAINT operators_subscription_tier_check CHECK ((subscription_tier = ANY (ARRAY['free'::text, 'basic'::text, 'premium'::text])))
);


--
-- Name: receipt_deletion_queue; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.receipt_deletion_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket text NOT NULL,
    path text NOT NULL,
    delete_after timestamp with time zone NOT NULL,
    attempted_at timestamp with time zone,
    deleted_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT receipt_deletion_queue_bucket_not_blank CHECK ((btrim(bucket) <> ''::text)),
    CONSTRAINT receipt_deletion_queue_path_not_blank CHECK ((btrim(path) <> ''::text))
);


--
-- Name: transaction_rules; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.transaction_rules (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    operator_id uuid NOT NULL,
    transaction_type text NOT NULL,
    platform text DEFAULT 'all'::text,
    delta_platform_mult numeric(10,6) DEFAULT 0,
    delta_cash_amount_mult numeric(10,6) DEFAULT 0,
    delta_cash_mult numeric(10,6) DEFAULT 0,
    profit_rate numeric(10,6),
    profit_minimum numeric(15,2),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: transactions; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    operator_id uuid NOT NULL,
    transaction_type text NOT NULL,
    platform text DEFAULT 'Unknown'::text NOT NULL,
    account_number text,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    net_profit numeric(15,2) DEFAULT 0,
    reference_number text,
    transaction_date timestamp with time zone,
    time_24hr text,
    full_date text,
    year text,
    month text,
    day text,
    image_url text,
    status text DEFAULT 'uploaded'::text,
    was_edited boolean DEFAULT false,
    edit_history jsonb DEFAULT '[]'::jsonb,
    processing_errors text[],
    starting_cash numeric(15,2),
    wallet_balance numeric(15,2),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    confirmed_by text,
    ai_raw_text text,
    CONSTRAINT transactions_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'awaiting_confirm'::text, 'confirmed'::text, 'edited'::text, 'failed'::text]))),
    CONSTRAINT transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['Cash In'::text, 'Cash Out'::text, 'Telco Load'::text, 'Bills Payment'::text, 'Bank Transfer'::text, 'Profit Remittance'::text, 'Unknown'::text])))
);


--
-- Name: wallets; Type: TABLE; Schema: gocash; Owner: -
--

CREATE TABLE gocash.wallets (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    operator_id uuid NOT NULL,
    wallet_type text NOT NULL,
    wallet_name text NOT NULL,
    balance numeric(15,2) DEFAULT 0,
    last_transaction_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    color text DEFAULT 'zinc'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT wallets_wallet_type_check CHECK ((wallet_type = ANY (ARRAY['platform'::text, 'cash'::text])))
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: operator_platforms operator_platforms_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.operator_platforms
    ADD CONSTRAINT operator_platforms_pkey PRIMARY KEY (id);


--
-- Name: operators operators_email_key; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.operators
    ADD CONSTRAINT operators_email_key UNIQUE (email);


--
-- Name: operators operators_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.operators
    ADD CONSTRAINT operators_pkey PRIMARY KEY (id);


--
-- Name: receipt_deletion_queue receipt_deletion_queue_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.receipt_deletion_queue
    ADD CONSTRAINT receipt_deletion_queue_pkey PRIMARY KEY (id);


--
-- Name: transaction_rules transaction_rules_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.transaction_rules
    ADD CONSTRAINT transaction_rules_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: transactions unique_reference_per_operator; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.transactions
    ADD CONSTRAINT unique_reference_per_operator UNIQUE (operator_id, reference_number);


--
-- Name: transaction_rules unique_rule_per_operator; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.transaction_rules
    ADD CONSTRAINT unique_rule_per_operator UNIQUE (operator_id, transaction_type, platform);


--
-- Name: wallets unique_wallet_per_operator; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.wallets
    ADD CONSTRAINT unique_wallet_per_operator UNIQUE (operator_id, wallet_name);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: idx_gocash_audit_created; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_audit_created ON gocash.audit_logs USING btree (created_at DESC);


--
-- Name: idx_gocash_audit_entity; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_audit_entity ON gocash.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_gocash_audit_operator; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_audit_operator ON gocash.audit_logs USING btree (operator_id);


--
-- Name: idx_gocash_operators_email; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_operators_email ON gocash.operators USING btree (email);


--
-- Name: idx_gocash_operators_telegram; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_operators_telegram ON gocash.operators USING btree (telegram_chat_id) WHERE (telegram_chat_id IS NOT NULL);


--
-- Name: idx_gocash_rules_operator_type; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_rules_operator_type ON gocash.transaction_rules USING btree (operator_id, transaction_type);


--
-- Name: idx_gocash_tx_date; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_date ON gocash.transactions USING btree (transaction_date DESC);


--
-- Name: idx_gocash_tx_operator; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_operator ON gocash.transactions USING btree (operator_id);


--
-- Name: idx_gocash_tx_operator_date; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_operator_date ON gocash.transactions USING btree (operator_id, transaction_date DESC);


--
-- Name: idx_gocash_tx_pending; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_pending ON gocash.transactions USING btree (operator_id, created_at DESC) WHERE (status = 'awaiting_confirm'::text);


--
-- Name: idx_gocash_tx_platform; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_platform ON gocash.transactions USING btree (platform);


--
-- Name: idx_gocash_tx_reference; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_reference ON gocash.transactions USING btree (reference_number) WHERE (reference_number IS NOT NULL);


--
-- Name: idx_gocash_tx_status; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_status ON gocash.transactions USING btree (status);


--
-- Name: idx_gocash_tx_type; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_tx_type ON gocash.transactions USING btree (transaction_type);


--
-- Name: idx_gocash_wallets_operator; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX idx_gocash_wallets_operator ON gocash.wallets USING btree (operator_id);


--
-- Name: operator_platforms_operator_active_idx; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX operator_platforms_operator_active_idx ON gocash.operator_platforms USING btree (operator_id, is_active, name);


--
-- Name: operator_platforms_unique_name_ci; Type: INDEX; Schema: gocash; Owner: -
--

CREATE UNIQUE INDEX operator_platforms_unique_name_ci ON gocash.operator_platforms USING btree (operator_id, lower(name));


--
-- Name: operators_user_id_idx; Type: INDEX; Schema: gocash; Owner: -
--

CREATE UNIQUE INDEX operators_user_id_idx ON gocash.operators USING btree (user_id);


--
-- Name: receipt_deletion_queue_bucket_path_key; Type: INDEX; Schema: gocash; Owner: -
--

CREATE UNIQUE INDEX receipt_deletion_queue_bucket_path_key ON gocash.receipt_deletion_queue USING btree (bucket, path);


--
-- Name: receipt_deletion_queue_due_idx; Type: INDEX; Schema: gocash; Owner: -
--

CREATE INDEX receipt_deletion_queue_due_idx ON gocash.receipt_deletion_queue USING btree (delete_after) WHERE (deleted_at IS NULL);


--
-- Name: transactions_unique_reference_per_operator; Type: INDEX; Schema: gocash; Owner: -
--

CREATE UNIQUE INDEX transactions_unique_reference_per_operator ON gocash.transactions USING btree (operator_id, reference_number) WHERE (reference_number IS NOT NULL);


--
-- Name: transactions audit_transactions; Type: TRIGGER; Schema: gocash; Owner: -
--

CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE ON gocash.transactions FOR EACH ROW EXECUTE FUNCTION gocash.log_transaction_changes();


--
-- Name: operators init_operator_defaults; Type: TRIGGER; Schema: gocash; Owner: -
--

CREATE TRIGGER init_operator_defaults AFTER INSERT ON gocash.operators FOR EACH ROW EXECUTE FUNCTION gocash.initialize_operator_defaults();


--
-- Name: operators update_operators_timestamp; Type: TRIGGER; Schema: gocash; Owner: -
--

CREATE TRIGGER update_operators_timestamp BEFORE UPDATE ON gocash.operators FOR EACH ROW EXECUTE FUNCTION gocash.update_updated_at();


--
-- Name: transaction_rules update_rules_timestamp; Type: TRIGGER; Schema: gocash; Owner: -
--

CREATE TRIGGER update_rules_timestamp BEFORE UPDATE ON gocash.transaction_rules FOR EACH ROW EXECUTE FUNCTION gocash.update_updated_at();


--
-- Name: transactions update_transactions_timestamp; Type: TRIGGER; Schema: gocash; Owner: -
--

CREATE TRIGGER update_transactions_timestamp BEFORE UPDATE ON gocash.transactions FOR EACH ROW EXECUTE FUNCTION gocash.update_updated_at();


--
-- Name: wallets update_wallets_timestamp; Type: TRIGGER; Schema: gocash; Owner: -
--

CREATE TRIGGER update_wallets_timestamp BEFORE UPDATE ON gocash.wallets FOR EACH ROW EXECUTE FUNCTION gocash.update_updated_at();


--
-- Name: audit_logs audit_logs_operator_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.audit_logs
    ADD CONSTRAINT audit_logs_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES gocash.operators(id) ON DELETE SET NULL;


--
-- Name: operator_platforms operator_platforms_operator_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.operator_platforms
    ADD CONSTRAINT operator_platforms_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES gocash.operators(id) ON DELETE CASCADE;


--
-- Name: operators operators_user_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.operators
    ADD CONSTRAINT operators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: transaction_rules transaction_rules_operator_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.transaction_rules
    ADD CONSTRAINT transaction_rules_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES gocash.operators(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_operator_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.transactions
    ADD CONSTRAINT transactions_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES gocash.operators(id) ON DELETE CASCADE;


--
-- Name: wallets wallets_last_transaction_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.wallets
    ADD CONSTRAINT wallets_last_transaction_id_fkey FOREIGN KEY (last_transaction_id) REFERENCES gocash.transactions(id);


--
-- Name: wallets wallets_operator_id_fkey; Type: FK CONSTRAINT; Schema: gocash; Owner: -
--

ALTER TABLE ONLY gocash.wallets
    ADD CONSTRAINT wallets_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES gocash.operators(id) ON DELETE CASCADE;


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_select_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY audit_select_own ON gocash.audit_logs FOR SELECT USING ((operator_id = auth.uid()));


--
-- Name: operator_platforms; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.operator_platforms ENABLE ROW LEVEL SECURITY;

--
-- Name: operator_platforms operator_platforms_insert_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY operator_platforms_insert_own ON gocash.operator_platforms FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = operator_platforms.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: operator_platforms operator_platforms_select_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY operator_platforms_select_own ON gocash.operator_platforms FOR SELECT USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = operator_platforms.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: operator_platforms operator_platforms_update_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY operator_platforms_update_own ON gocash.operator_platforms FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = operator_platforms.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: operators; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.operators ENABLE ROW LEVEL SECURITY;

--
-- Name: operators operators_insert_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY operators_insert_own ON gocash.operators FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: operators operators_select_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY operators_select_own ON gocash.operators FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: operators operators_update_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY operators_update_own ON gocash.operators FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: receipt_deletion_queue; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.receipt_deletion_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: receipt_deletion_queue receipt_deletion_queue_no_access; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY receipt_deletion_queue_no_access ON gocash.receipt_deletion_queue AS RESTRICTIVE USING (false) WITH CHECK (false);


--
-- Name: transaction_rules rules_delete_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY rules_delete_own ON gocash.transaction_rules FOR DELETE USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transaction_rules.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: transaction_rules rules_insert_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY rules_insert_own ON gocash.transaction_rules FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transaction_rules.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: transaction_rules rules_select_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY rules_select_own ON gocash.transaction_rules FOR SELECT USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transaction_rules.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: transaction_rules rules_update_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY rules_update_own ON gocash.transaction_rules FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transaction_rules.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: transaction_rules; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.transaction_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_insert_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY transactions_insert_own ON gocash.transactions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transactions.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: transactions transactions_select_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY transactions_select_own ON gocash.transactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transactions.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: transactions transactions_update_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY transactions_update_own ON gocash.transactions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = transactions.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: wallets; Type: ROW SECURITY; Schema: gocash; Owner: -
--

ALTER TABLE gocash.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets wallets_insert_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY wallets_insert_own ON gocash.wallets FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = wallets.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: wallets wallets_select_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY wallets_select_own ON gocash.wallets FOR SELECT USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = wallets.operator_id) AND (operators.user_id = auth.uid())))));


--
-- Name: wallets wallets_update_own; Type: POLICY; Schema: gocash; Owner: -
--

CREATE POLICY wallets_update_own ON gocash.wallets FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM gocash.operators
  WHERE ((operators.id = wallets.operator_id) AND (operators.user_id = auth.uid())))));


--
-- PostgreSQL database dump complete
--


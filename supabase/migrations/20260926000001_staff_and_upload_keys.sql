-- ===========================================================================
-- Staff logins, and upload keys for sharing screenshots from a phone.
--
-- STAFF
-- One login owned one set of books: operators.user_id. A second person at the
-- same counter had to share the owner's email, or would have been given their
-- own separate books. operator_members lets more logins record into ONE
-- operator's books.
--
-- Two roles, and the owner is not a row: the owner is operators.user_id, as
-- before. A member row is always 'staff'.
--
--   owner  everything
--   staff  record transactions (type, capture, confirm), see balances and
--          history. Not: void, reconcile a count, change fees or wallets,
--          manage staff. Those change what the books say after the fact, and
--          the person they would be checking is the one doing the recording.
--
-- The role is enforced on the server (Edge Functions and the trigger below),
-- not by hiding buttons.
--
-- UPLOAD KEYS
-- An Apple Shortcut cannot hold a login session: sessions expire hourly and a
-- Shortcut cannot refresh one. A key it can hold forever must be worth little,
-- so an upload key can do exactly one thing: create a DRAFT from an image.
-- Drafts move no money until someone confirms them in the app. Only a SHA-256
-- of the key is stored; the key itself is shown once.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
CREATE TABLE gocash.operator_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  -- One set of books per login. Without this a person in two shops would have
  -- no way to say which one a screenshot belongs to.
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID
);

CREATE INDEX operator_members_operator_idx ON gocash.operator_members (operator_id);

ALTER TABLE gocash.operator_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Ownership helpers.
--
-- is_my_operator becomes SECURITY DEFINER. It has to read operators and
-- operator_members to answer, and both tables' own policies call it; as an
-- invoker function that is a policy evaluating itself. It still only answers
-- about the caller (auth.uid()) and an id the caller already holds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gocash.is_my_operator(p_operator_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gocash, public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM gocash.operators o
           WHERE o.id = p_operator_id AND o.user_id = auth.uid())
      OR EXISTS (
           SELECT 1 FROM gocash.operator_members m
           WHERE m.operator_id = p_operator_id AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION gocash.is_operator_owner(p_operator_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gocash, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM gocash.operators o
    WHERE o.id = p_operator_id AND o.user_id = auth.uid());
$$;

/**
 * The caller's books and role: zero or one row. Zero means "not set up":
 * a login that owns nothing and belongs to nothing.
 */
CREATE OR REPLACE FUNCTION gocash.my_membership()
RETURNS TABLE (operator_id UUID, role TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gocash, public
AS $$
  SELECT o.id, 'owner'::TEXT FROM gocash.operators o WHERE o.user_id = auth.uid()
  UNION ALL
  SELECT m.operator_id, m.role FROM gocash.operator_members m WHERE m.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION gocash.is_my_operator(UUID)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION gocash.is_operator_owner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION gocash.my_membership()         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION gocash.is_my_operator(UUID)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION gocash.is_operator_owner(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION gocash.my_membership()         TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies that named the owner directly now go through is_my_operator, so
-- staff can read the shop's operator row and its transactions.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS operators_select_own ON gocash.operators;
CREATE POLICY operators_select_own ON gocash.operators
  FOR SELECT USING (gocash.is_my_operator(id));

DROP POLICY IF EXISTS transactions_select_own ON gocash.transactions;
CREATE POLICY transactions_select_own ON gocash.transactions
  FOR SELECT USING (gocash.is_my_operator(operator_id));

-- Only the owner sees who else has access.
CREATE POLICY operator_members_select_owner ON gocash.operator_members
  FOR SELECT USING (gocash.is_operator_owner(operator_id) OR user_id = auth.uid());

GRANT SELECT ON gocash.operator_members TO authenticated;
GRANT ALL    ON gocash.operator_members TO service_role;

-- ---------------------------------------------------------------------------
-- Fee rules are the owner's. set_fee_rule is callable from the browser and
-- checks is_my_operator, which staff now pass; this is what stops them.
-- The service role (seeding, provisioning) is not a browser caller and passes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gocash.fee_rules_owner_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) = 'authenticated'
     AND NOT gocash.is_operator_owner(NEW.operator_id) THEN
    RAISE EXCEPTION 'only the owner can change fees'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fee_rules_owner_only
  BEFORE INSERT OR UPDATE ON gocash.fee_rules
  FOR EACH ROW EXECUTE FUNCTION gocash.fee_rules_owner_only();

-- ---------------------------------------------------------------------------
-- Adding and removing staff. Service role only: the Edge Function has already
-- checked that the caller is the owner, and it is what creates the login.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gocash.add_staff(
  p_operator_id UUID,
  p_user_id     UUID,
  p_email       TEXT,
  p_created_by  UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM gocash.operators WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'this login already has its own books' USING ERRCODE = 'GC020';
  END IF;

  IF EXISTS (SELECT 1 FROM gocash.operator_members WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'this login already has access to a shop' USING ERRCODE = 'GC021';
  END IF;

  INSERT INTO gocash.operator_members (operator_id, user_id, email, created_by)
  VALUES (p_operator_id, p_user_id, lower(btrim(p_email)), p_created_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.add_staff(UUID, UUID, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Upload keys
-- ---------------------------------------------------------------------------
CREATE TABLE gocash.upload_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES gocash.operators(id) ON DELETE CASCADE,
  -- Whose phone it is. Drafts it creates are attributed to this login, and
  -- removing the person removes their keys.
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL CHECK (btrim(label) <> ''),
  -- SHA-256 of the key, hex. The key is random and long, so a plain hash is
  -- enough: there is nothing to guess.
  key_hash     TEXT NOT NULL UNIQUE,
  -- The first characters, so a key can be recognised in a list.
  key_prefix   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX upload_keys_operator_idx ON gocash.upload_keys (operator_id);

-- No browser access at all: keys are created, listed and revoked through an
-- Edge Function, and the hash never leaves the server.
ALTER TABLE gocash.upload_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL ON gocash.upload_keys TO service_role;

COMMIT;

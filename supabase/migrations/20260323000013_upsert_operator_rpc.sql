-- RPC function to handle operator creation/recovery during onboarding.
-- Handles three cases:
--   1. Existing operator with matching user_id → returns existing id
--   2. Orphaned operator (user_id NULL) with matching email → re-links to current user
--   3. No matching operator → creates a new one
--
-- Uses SECURITY DEFINER to bypass RLS (orphaned rows have NULL user_id and
-- are invisible to the client's RLS policies).

CREATE OR REPLACE FUNCTION gocash.upsert_operator(
  p_user_id UUID,
  p_email   TEXT,
  p_name    TEXT,
  p_phone   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
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

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION gocash.upsert_operator(UUID, TEXT, TEXT, TEXT) TO authenticated;

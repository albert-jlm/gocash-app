-- ===========================================================================
-- Adding staff by email address, and removing them.
--
-- The Edge Function knows an email, not a user id, and PostgREST exposes only
-- the gocash schema, so the lookup in auth.users has to happen here.
--
-- Apply as supabase_admin.
-- ===========================================================================

BEGIN;

/**
 * Give the login with this email access to the operator's books as staff.
 * The login must already exist (the Edge Function creates it first).
 *
 * Raises:
 *   GC020  that login already owns its own books
 *   GC021  that login already has access to a shop (this one or another)
 *   GC022  no login exists for that email
 */
CREATE OR REPLACE FUNCTION gocash.add_staff_by_email(
  p_operator_id UUID,
  p_email       TEXT,
  p_created_by  UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_email   TEXT := lower(btrim(COALESCE(p_email, '')));
  v_user_id UUID;
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no login exists for %', v_email USING ERRCODE = 'GC022';
  END IF;

  RETURN gocash.add_staff(p_operator_id, v_user_id, v_email, p_created_by);
END;
$$;

/**
 * Take a staff member's access away. Returns their user id so the caller can
 * delete the login itself; NULL if there was no such member of this operator.
 * Their upload keys go with them.
 */
CREATE OR REPLACE FUNCTION gocash.remove_staff(
  p_operator_id UUID,
  p_member_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM gocash.operator_members
  WHERE id = p_member_id AND operator_id = p_operator_id
  RETURNING user_id INTO v_user_id;

  IF v_user_id IS NOT NULL THEN
    UPDATE gocash.upload_keys SET revoked_at = NOW()
    WHERE user_id = v_user_id AND operator_id = p_operator_id AND revoked_at IS NULL;
  END IF;

  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION gocash.add_staff_by_email(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION gocash.remove_staff(UUID, UUID)             TO service_role;

COMMIT;

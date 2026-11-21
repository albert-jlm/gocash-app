BEGIN;

ALTER TABLE gocash.operator_members DROP CONSTRAINT operator_members_role_check;
ALTER TABLE gocash.operator_members
  ADD CONSTRAINT operator_members_role_check CHECK (role IN ('staff', 'owner'));

CREATE OR REPLACE FUNCTION gocash.is_operator_owner(p_operator_id UUID)
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
           WHERE m.operator_id = p_operator_id AND m.user_id = auth.uid() AND m.role = 'owner');
$$;

REVOKE ALL ON FUNCTION gocash.is_operator_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION gocash.is_operator_owner(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS operators_update_own ON gocash.operators;
CREATE POLICY operators_update_own ON gocash.operators
  FOR UPDATE USING (gocash.is_operator_owner(id)) WITH CHECK (gocash.is_operator_owner(id));

CREATE OR REPLACE FUNCTION gocash.set_member_role(
  p_operator_id UUID,
  p_member_id   UUID,
  p_role        TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gocash, public
AS $$
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_role NOT IN ('staff', 'owner') THEN
    RAISE EXCEPTION 'role must be staff or owner' USING ERRCODE = 'GC023';
  END IF;

  UPDATE gocash.operator_members SET role = p_role
  WHERE id = p_member_id AND operator_id = p_operator_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION gocash.set_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gocash.set_member_role(UUID, UUID, TEXT) TO service_role;

COMMIT;

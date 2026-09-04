CREATE OR REPLACE FUNCTION list_tenant_members(p_tenant_id UUID)
RETURNS TABLE (user_id UUID, email TEXT, display_name TEXT, role TEXT, joined_at TIMESTAMPTZ)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT usr.id, usr.email, usr.display_name, membership.role, membership.created_at
  FROM memberships AS membership
  JOIN users AS usr ON usr.id = membership.user_id
  WHERE membership.tenant_id = p_tenant_id
    AND p_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  ORDER BY membership.created_at
$$;

REVOKE ALL ON FUNCTION list_tenant_members(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_tenant_members(UUID) TO kaspi_app;


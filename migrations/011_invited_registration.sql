CREATE OR REPLACE FUNCTION register_invited_dashboard_account(
  p_email TEXT,
  p_display_name TEXT,
  p_password_hash TEXT,
  p_token_hash TEXT
)
RETURNS TABLE (user_id UUID, tenant_id UUID, tenant_name TEXT, tenant_slug TEXT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invitation tenant_invitations%ROWTYPE;
  created_user_id UUID;
BEGIN
  SELECT * INTO invitation
  FROM tenant_invitations
  WHERE token_hash = p_token_hash
    AND lower(email) = lower(p_email)
    AND accepted_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF invitation.id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO users (email, display_name, password_hash)
  VALUES (lower(p_email), p_display_name, p_password_hash)
  RETURNING id INTO created_user_id;

  INSERT INTO memberships (tenant_id, user_id, role)
  VALUES (invitation.tenant_id, created_user_id, invitation.role);

  UPDATE tenant_invitations SET accepted_at = now() WHERE id = invitation.id;

  RETURN QUERY
    SELECT created_user_id, tenant.id, tenant.name, tenant.slug, invitation.role
    FROM tenants AS tenant WHERE tenant.id = invitation.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION register_invited_dashboard_account(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_invited_dashboard_account(TEXT, TEXT, TEXT, TEXT) TO kaspi_app;

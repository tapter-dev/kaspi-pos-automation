CREATE OR REPLACE FUNCTION authenticate_api_key(p_key_hash TEXT)
RETURNS TABLE (api_key_id UUID, authenticated_tenant_id UUID, scopes TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    UPDATE api_keys AS key SET last_used_at = now()
    FROM tenants AS tenant
    WHERE key.key_hash = p_key_hash
      AND tenant.id = key.tenant_id
      AND key.revoked_at IS NULL
      AND (key.expires_at IS NULL OR key.expires_at > now())
      AND tenant.status = 'active'
    RETURNING key.id, key.tenant_id, key.scopes;
END;
$$;

CREATE OR REPLACE FUNCTION authenticate_dashboard_session(p_token_hash TEXT)
RETURNS TABLE (
  session_id UUID,
  user_id UUID,
  tenant_id UUID,
  email TEXT,
  display_name TEXT,
  tenant_name TEXT,
  tenant_slug TEXT,
  role TEXT,
  is_platform_admin BOOLEAN,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT session.id, usr.id, tenant.id, usr.email, usr.display_name,
           tenant.name, tenant.slug, membership.role, usr.is_platform_admin,
           session.expires_at
    FROM dashboard_sessions AS session
    JOIN users AS usr ON usr.id = session.user_id
    JOIN tenants AS tenant ON tenant.id = session.tenant_id
    JOIN memberships AS membership
      ON membership.user_id = session.user_id AND membership.tenant_id = session.tenant_id
    WHERE session.token_hash = p_token_hash
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
      AND usr.status = 'active'
      AND tenant.status = 'active'
    LIMIT 1;

  UPDATE dashboard_sessions AS session SET last_seen_at = now()
  WHERE session.token_hash = p_token_hash
    AND session.last_seen_at < now() - interval '5 minutes';
END;
$$;

REVOKE ALL ON FUNCTION authenticate_api_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION authenticate_dashboard_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate_api_key(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION authenticate_dashboard_session(TEXT) TO kaspi_app;

ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE dashboard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_sessions_active_idx ON dashboard_sessions (token_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'operator', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dashboard_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dashboard_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_invitations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_sessions, tenant_invitations TO kaspi_app;

CREATE OR REPLACE FUNCTION register_dashboard_account(
  p_email TEXT,
  p_display_name TEXT,
  p_password_hash TEXT,
  p_tenant_slug TEXT,
  p_tenant_name TEXT
)
RETURNS TABLE (user_id UUID, tenant_id UUID, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created_user_id UUID;
  created_tenant_id UUID;
BEGIN
  INSERT INTO users (email, display_name, password_hash)
  VALUES (lower(p_email), p_display_name, p_password_hash)
  RETURNING id INTO created_user_id;

  INSERT INTO tenants (slug, name)
  VALUES (p_tenant_slug, p_tenant_name)
  RETURNING id INTO created_tenant_id;

  INSERT INTO memberships (tenant_id, user_id, role)
  VALUES (created_tenant_id, created_user_id, 'owner');

  RETURN QUERY SELECT created_user_id, created_tenant_id, 'owner'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION find_dashboard_login(p_email TEXT)
RETURNS TABLE (
  user_id UUID,
  password_hash TEXT,
  display_name TEXT,
  tenant_id UUID,
  tenant_name TEXT,
  role TEXT,
  is_platform_admin BOOLEAN
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT usr.id, usr.password_hash, usr.display_name, tenant.id, tenant.name,
         membership.role, usr.is_platform_admin
  FROM users AS usr
  JOIN memberships AS membership ON membership.user_id = usr.id
  JOIN tenants AS tenant ON tenant.id = membership.tenant_id
  WHERE usr.email = lower(p_email)
    AND usr.status = 'active'
    AND tenant.status = 'active'
  ORDER BY membership.created_at
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION create_dashboard_session(
  p_user_id UUID,
  p_tenant_id UUID,
  p_token_hash TEXT,
  p_ip_address INET,
  p_user_agent TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO dashboard_sessions
    (user_id, tenant_id, token_hash, ip_address, user_agent, expires_at)
  SELECT p_user_id, p_tenant_id, p_token_hash, p_ip_address, left(p_user_agent, 1000), p_expires_at
  WHERE EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = p_user_id AND tenant_id = p_tenant_id
  )
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
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION revoke_dashboard_session(p_token_hash TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE dashboard_sessions SET revoked_at = now()
  WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION register_dashboard_account(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_dashboard_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_dashboard_session(UUID, UUID, TEXT, INET, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION authenticate_dashboard_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_dashboard_session(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION register_dashboard_account(TEXT, TEXT, TEXT, TEXT, TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION find_dashboard_login(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION create_dashboard_session(UUID, UUID, TEXT, INET, TEXT, TIMESTAMPTZ) TO kaspi_app;
GRANT EXECUTE ON FUNCTION authenticate_dashboard_session(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION revoke_dashboard_session(TEXT) TO kaspi_app;


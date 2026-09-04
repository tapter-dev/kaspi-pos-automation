CREATE TABLE external_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  email TEXT CHECK (email IS NULL OR email=lower(email)),
  role TEXT NOT NULL CHECK (role IN ('developer', 'operator', 'viewer')),
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

ALTER TABLE external_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON external_access_grants
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON external_access_grants TO kaspi_app;

CREATE OR REPLACE FUNCTION accept_external_access_grant(input_code_hash TEXT, input_user_id UUID)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, granted_role TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE grant_row external_access_grants%ROWTYPE;
DECLARE user_email TEXT;
BEGIN
  SELECT * INTO grant_row FROM external_access_grants
  WHERE code_hash=input_code_hash AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT email INTO user_email FROM users WHERE id=input_user_id AND status='active';
  IF user_email IS NULL OR (grant_row.email IS NOT NULL AND grant_row.email <> user_email) THEN RETURN; END IF;
  INSERT INTO memberships (tenant_id, user_id, role) VALUES (grant_row.tenant_id, input_user_id, grant_row.role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role=EXCLUDED.role;
  UPDATE external_access_grants SET accepted_by=input_user_id, accepted_at=now() WHERE id=grant_row.id;
  RETURN QUERY SELECT grant_row.tenant_id, tenant.name, grant_row.role
  FROM tenants AS tenant WHERE tenant.id=grant_row.tenant_id;
END $$;

REVOKE ALL ON FUNCTION accept_external_access_grant(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_external_access_grant(TEXT, UUID) TO kaspi_app;

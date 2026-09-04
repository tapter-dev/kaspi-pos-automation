ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Remove broad grants inherited from the foundation migration. The runtime
-- role gets only the tables needed by application repositories.
REVOKE ALL ON schema_migrations, users FROM kaspi_app;

CREATE OR REPLACE FUNCTION authenticate_api_key(p_key_hash TEXT)
RETURNS TABLE (api_key_id UUID, authenticated_tenant_id UUID, scopes TEXT[])
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT key.id, key.tenant_id, key.scopes
  FROM api_keys AS key
  JOIN tenants AS tenant ON tenant.id = key.tenant_id
  WHERE key.key_hash = p_key_hash
    AND key.revoked_at IS NULL
    AND (key.expires_at IS NULL OR key.expires_at > now())
    AND tenant.status = 'active'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION authenticate_api_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate_api_key(TEXT) TO kaspi_app;


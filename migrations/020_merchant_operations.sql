ALTER TABLE api_keys
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test')),
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE api_keys
SET environment = CASE WHEN key_prefix LIKE 'kpa_test_%' THEN 'test' ELSE 'live' END;

CREATE UNIQUE INDEX api_keys_one_default_per_tenant_idx
  ON api_keys (tenant_id)
  WHERE is_default = true AND enabled = true AND revoked_at IS NULL;

ALTER TABLE webhook_endpoints
  ADD COLUMN api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX webhook_endpoints_api_key_idx
  ON webhook_endpoints (api_key_id)
  WHERE api_key_id IS NOT NULL;

ALTER TABLE payment_orders
  ADD COLUMN internal_comment TEXT CHECK (internal_comment IS NULL OR length(internal_comment) <= 255),
  ADD COLUMN created_by_api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  ADD COLUMN created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX payment_orders_creator_key_idx
  ON payment_orders (tenant_id, created_by_api_key_id, created_at DESC)
  WHERE created_by_api_key_id IS NOT NULL;

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
    AND key.enabled = true
    AND key.revoked_at IS NULL
    AND (key.expires_at IS NULL OR key.expires_at > now())
    AND tenant.status = 'active'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION authenticate_api_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate_api_key(TEXT) TO kaspi_app;

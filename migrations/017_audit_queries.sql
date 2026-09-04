CREATE OR REPLACE FUNCTION list_tenant_audit_logs(p_tenant_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  id UUID,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  ip_address INET,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  actor TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT audit.id, audit.action, audit.resource_type, audit.resource_id,
         audit.ip_address, audit.metadata, audit.created_at,
         COALESCE(users.display_name, keys.name, 'System') AS actor
  FROM audit_logs AS audit
  LEFT JOIN users ON users.id = audit.actor_user_id
  LEFT JOIN api_keys AS keys ON keys.id = audit.actor_api_key_id
  WHERE audit.tenant_id = p_tenant_id
    AND p_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  ORDER BY audit.created_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 500)
$$;

REVOKE ALL ON FUNCTION list_tenant_audit_logs(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_tenant_audit_logs(UUID, INTEGER) TO kaspi_app;

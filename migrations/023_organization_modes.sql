ALTER TABLE tenants
  ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'live' CHECK (work_mode IN ('live', 'test')),
  ADD COLUMN media_consent BOOLEAN NOT NULL DEFAULT false;

DROP FUNCTION authenticate_api_key(TEXT);

CREATE FUNCTION authenticate_api_key(p_key_hash TEXT)
RETURNS TABLE (api_key_id UUID, authenticated_tenant_id UUID, scopes TEXT[], api_key_environment TEXT)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT key.id, key.tenant_id, key.scopes, key.environment
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

CREATE OR REPLACE FUNCTION list_due_recurring_work()
RETURNS TABLE (tenant_id UUID, schedule_id UUID)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT schedule.tenant_id, schedule.id
  FROM recurring_schedules AS schedule
  JOIN tenants AS tenant ON tenant.id = schedule.tenant_id
  LEFT JOIN kaspi_connections AS connection ON connection.tenant_id = schedule.tenant_id
  WHERE schedule.status = 'active'
    AND schedule.next_payment_at IS NOT NULL
    AND schedule.next_payment_at <= now()
    AND (tenant.work_mode = 'test' OR connection.state = 'active')
  ORDER BY schedule.next_payment_at
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION list_due_recurring_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_due_recurring_work() TO kaspi_app;

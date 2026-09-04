CREATE OR REPLACE FUNCTION platform_admin_tenants(p_session_hash TEXT)
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, status TEXT, created_at TIMESTAMPTZ,
  member_count BIGINT, payment_count BIGINT, payment_volume_minor NUMERIC,
  kaspi_state TEXT, failed_webhooks BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant.id, tenant.slug, tenant.name, tenant.status, tenant.created_at,
    (SELECT COUNT(*) FROM memberships WHERE tenant_id = tenant.id),
    (SELECT COUNT(*) FROM payment_orders WHERE tenant_id = tenant.id),
    (SELECT COALESCE(SUM(amount_minor), 0) FROM payment_orders
      WHERE tenant_id = tenant.id AND status IN ('paid','partially_refunded','refunded')),
    (SELECT state FROM kaspi_connections WHERE tenant_id = tenant.id),
    (SELECT COUNT(*) FROM webhook_deliveries
      WHERE tenant_id = tenant.id AND status IN ('failed','dead'))
  FROM tenants AS tenant
  WHERE EXISTS (
    SELECT 1 FROM dashboard_sessions AS session
    JOIN users AS usr ON usr.id = session.user_id
    WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
      AND session.expires_at > now() AND usr.is_platform_admin = true
  )
  ORDER BY tenant.created_at DESC
$$;

REVOKE ALL ON FUNCTION platform_admin_tenants(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_tenants(TEXT) TO kaspi_app;

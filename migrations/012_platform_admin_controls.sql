CREATE OR REPLACE FUNCTION platform_admin_set_tenant_status(
  p_session_hash TEXT,
  p_tenant_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed INTEGER;
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dashboard_sessions AS session
    JOIN users AS usr ON usr.id = session.user_id
    WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
      AND session.expires_at > now() AND usr.is_platform_admin = true
  ) THEN
    RETURN false;
  END IF;
  UPDATE tenants SET status = p_status, updated_at = now() WHERE id = p_tenant_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF p_status = 'suspended' THEN
    UPDATE dashboard_sessions SET revoked_at = now()
    WHERE tenant_id = p_tenant_id AND revoked_at IS NULL;
  END IF;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION platform_admin_set_tenant_status(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_set_tenant_status(TEXT, UUID, TEXT) TO kaspi_app;

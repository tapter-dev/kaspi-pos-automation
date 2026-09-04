CREATE OR REPLACE FUNCTION save_dashboard_mfa_pending(p_session_hash TEXT, p_encrypted_secret BYTEA)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE matched_user UUID;
DECLARE changed INTEGER;
BEGIN
  SELECT user_id INTO matched_user FROM dashboard_sessions
  WHERE token_hash = p_session_hash AND revoked_at IS NULL AND expires_at > now();
  IF matched_user IS NULL THEN RETURN false; END IF;
  INSERT INTO dashboard_mfa_credentials (user_id, encrypted_secret, enabled)
  VALUES (matched_user, p_encrypted_secret, false)
  ON CONFLICT (user_id) DO UPDATE SET encrypted_secret = EXCLUDED.encrypted_secret,
    enabled_at = NULL, updated_at = now()
  WHERE dashboard_mfa_credentials.enabled = false;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION save_dashboard_mfa_pending(TEXT, BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_dashboard_mfa_pending(TEXT, BYTEA) TO kaspi_app;

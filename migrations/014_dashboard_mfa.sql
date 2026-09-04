CREATE TABLE dashboard_mfa_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION dashboard_mfa_for_login(p_user_id UUID)
RETURNS TABLE (encrypted_secret BYTEA, enabled BOOLEAN)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT credential.encrypted_secret, credential.enabled
  FROM dashboard_mfa_credentials AS credential WHERE credential.user_id = p_user_id
$$;

CREATE OR REPLACE FUNCTION dashboard_mfa_status(p_session_hash TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT credential.enabled FROM dashboard_sessions AS session
    LEFT JOIN dashboard_mfa_credentials AS credential ON credential.user_id = session.user_id
    WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
      AND session.expires_at > now()
  ), false)
$$;

CREATE OR REPLACE FUNCTION save_dashboard_mfa_pending(p_session_hash TEXT, p_encrypted_secret BYTEA)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE matched_user UUID;
BEGIN
  SELECT user_id INTO matched_user FROM dashboard_sessions
  WHERE token_hash = p_session_hash AND revoked_at IS NULL AND expires_at > now();
  IF matched_user IS NULL THEN RETURN false; END IF;
  INSERT INTO dashboard_mfa_credentials (user_id, encrypted_secret, enabled)
  VALUES (matched_user, p_encrypted_secret, false)
  ON CONFLICT (user_id) DO UPDATE SET encrypted_secret = EXCLUDED.encrypted_secret,
    enabled = false, enabled_at = NULL, updated_at = now();
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION enable_dashboard_mfa(p_session_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE dashboard_mfa_credentials AS credential
  SET enabled = true, enabled_at = now(), updated_at = now()
  FROM dashboard_sessions AS session
  WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
    AND session.expires_at > now() AND credential.user_id = session.user_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION disable_dashboard_mfa(p_session_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed INTEGER;
BEGIN
  DELETE FROM dashboard_mfa_credentials AS credential USING dashboard_sessions AS session
  WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
    AND session.expires_at > now() AND credential.user_id = session.user_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON TABLE dashboard_mfa_credentials FROM PUBLIC, kaspi_app;
REVOKE ALL ON FUNCTION dashboard_mfa_for_login(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_mfa_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_dashboard_mfa_pending(TEXT, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION enable_dashboard_mfa(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION disable_dashboard_mfa(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dashboard_mfa_for_login(UUID) TO kaspi_app;
GRANT EXECUTE ON FUNCTION dashboard_mfa_status(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION save_dashboard_mfa_pending(TEXT, BYTEA) TO kaspi_app;
GRANT EXECUTE ON FUNCTION enable_dashboard_mfa(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION disable_dashboard_mfa(TEXT) TO kaspi_app;

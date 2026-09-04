CREATE OR REPLACE FUNCTION dashboard_email_is_verified(p_session_hash TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT usr.email_verified_at IS NOT NULL
    FROM dashboard_sessions AS session
    JOIN users AS usr ON usr.id = session.user_id
    WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
      AND session.expires_at > now()
  ), false)
$$;

REVOKE ALL ON FUNCTION dashboard_email_is_verified(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dashboard_email_is_verified(TEXT) TO kaspi_app;

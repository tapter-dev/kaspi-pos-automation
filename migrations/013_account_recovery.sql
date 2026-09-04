ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION issue_email_verification_token(
  p_user_id UUID, p_token_hash TEXT, p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (email TEXT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM email_verification_tokens
  WHERE user_id = p_user_id AND used_at IS NULL;
  INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
  SELECT id, p_token_hash, p_expires_at FROM users
  WHERE id = p_user_id AND status = 'active' AND email_verified_at IS NULL;
  RETURN QUERY SELECT usr.email, usr.display_name FROM users AS usr
  WHERE usr.id = p_user_id AND usr.status = 'active' AND usr.email_verified_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_email_verification(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE matched_user UUID;
BEGIN
  UPDATE email_verification_tokens SET used_at = now()
  WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING user_id INTO matched_user;
  IF matched_user IS NULL THEN RETURN false; END IF;
  UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
  WHERE id = matched_user;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION issue_password_reset_token(
  p_email TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (user_id UUID, email TEXT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE matched_user users%ROWTYPE;
BEGIN
  SELECT * INTO matched_user FROM users
  WHERE users.email = lower(p_email) AND status = 'active' LIMIT 1;
  IF matched_user.id IS NULL THEN RETURN; END IF;
  DELETE FROM password_reset_tokens WHERE password_reset_tokens.user_id = matched_user.id AND used_at IS NULL;
  INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
  VALUES (matched_user.id, p_token_hash, p_expires_at);
  RETURN QUERY SELECT matched_user.id, matched_user.email, matched_user.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION complete_password_reset(p_token_hash TEXT, p_password_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE matched_user UUID;
BEGIN
  UPDATE password_reset_tokens SET used_at = now()
  WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING user_id INTO matched_user;
  IF matched_user IS NULL THEN RETURN false; END IF;
  UPDATE users SET password_hash = p_password_hash, updated_at = now() WHERE id = matched_user;
  UPDATE dashboard_sessions SET revoked_at = now()
  WHERE user_id = matched_user AND revoked_at IS NULL;
  RETURN true;
END;
$$;

REVOKE ALL ON TABLE email_verification_tokens, password_reset_tokens FROM PUBLIC, kaspi_app;
REVOKE ALL ON FUNCTION issue_email_verification_token(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_email_verification(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_password_reset_token(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_password_reset(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_email_verification_token(UUID, TEXT, TIMESTAMPTZ) TO kaspi_app;
GRANT EXECUTE ON FUNCTION confirm_email_verification(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION issue_password_reset_token(TEXT, TEXT, TIMESTAMPTZ) TO kaspi_app;
GRANT EXECUTE ON FUNCTION complete_password_reset(TEXT, TEXT) TO kaspi_app;

CREATE OR REPLACE FUNCTION list_dashboard_tenants(p_session_hash TEXT)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, tenant_slug TEXT, role TEXT)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tenant.id, tenant.name, tenant.slug, membership.role
  FROM dashboard_sessions AS session
  JOIN memberships AS membership ON membership.user_id = session.user_id
  JOIN tenants AS tenant ON tenant.id = membership.tenant_id
  WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
    AND session.expires_at > now() AND tenant.status = 'active'
  ORDER BY membership.created_at
$$;

CREATE OR REPLACE FUNCTION switch_dashboard_tenant(p_session_hash TEXT, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE dashboard_sessions AS session SET tenant_id = p_tenant_id, last_seen_at = now()
  WHERE session.token_hash = p_session_hash AND session.revoked_at IS NULL
    AND session.expires_at > now()
    AND EXISTS (SELECT 1 FROM memberships WHERE user_id = session.user_id AND tenant_id = p_tenant_id);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION accept_tenant_invitation(p_invitation_hash TEXT, p_user_id UUID)
RETURNS TABLE (tenant_id UUID, role TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE invitation tenant_invitations%ROWTYPE;
BEGIN
  SELECT invite.* INTO invitation FROM tenant_invitations AS invite
  JOIN users AS usr ON usr.id = p_user_id AND usr.email = invite.email
  WHERE invite.token_hash = p_invitation_hash AND invite.accepted_at IS NULL
    AND invite.expires_at > now() FOR UPDATE;
  IF invitation.id IS NULL THEN RETURN; END IF;
  INSERT INTO memberships (tenant_id, user_id, role)
  VALUES (invitation.tenant_id, p_user_id, invitation.role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  UPDATE tenant_invitations SET accepted_at = now() WHERE id = invitation.id;
  RETURN QUERY SELECT invitation.tenant_id, invitation.role;
END;
$$;

REVOKE ALL ON FUNCTION list_dashboard_tenants(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION switch_dashboard_tenant(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_tenant_invitation(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_dashboard_tenants(TEXT) TO kaspi_app;
GRANT EXECUTE ON FUNCTION switch_dashboard_tenant(TEXT, UUID) TO kaspi_app;
GRANT EXECUTE ON FUNCTION accept_tenant_invitation(TEXT, UUID) TO kaspi_app;


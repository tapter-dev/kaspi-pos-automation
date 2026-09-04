import { withTenant } from './database/client.js';

const actorFromRequest = (req) => ({
  userId: req.auth?.user_id || null,
  apiKeyId: req.auth?.apiKeyId || null,
});

export const recordAudit = async (
  req,
  action,
  {
    tenantId = req.auth?.tenant_id || req.auth?.tenantId,
    actorUserId,
    actorApiKeyId,
    resourceType = null,
    resourceId = null,
    metadata = {},
  } = {},
) => {
  if (!tenantId) throw new Error('A tenant is required for an audit event.');
  const actor = actorFromRequest(req);
  await withTenant(tenantId, (db) =>
    db.query(
      `INSERT INTO audit_logs
        (tenant_id, actor_user_id, actor_api_key_id, action, resource_type,
         resource_id, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        actorUserId ?? actor.userId,
        actorApiKeyId ?? actor.apiKeyId,
        action,
        resourceType,
        resourceId ? String(resourceId) : null,
        req.ip || null,
        (req.headers['user-agent'] || '').slice(0, 1000),
        { ...metadata, requestId: req.requestId },
      ],
    ),
  );
};

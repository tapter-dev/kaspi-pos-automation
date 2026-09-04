import { Router } from 'express';
import { createDashboardAuth } from '../middleware/dashboardAuth.js';
import { DASHBOARD_COOKIE, hashSessionToken } from '../security/dashboardSessions.js';
import { getPool } from '../database/client.js';
import { z } from 'zod';
import { getPaymentStatusQueue, getWebhookDeliveryQueue } from '../queue/client.js';
import { recordAudit } from '../audit.js';

const router = Router();
router.use(createDashboardAuth());
router.use((req, res, next) => {
  if (!req.auth.is_platform_admin) return res.status(403).json({ error: 'Platform administrator access required.' });
  next();
});

router.get('/tenants', async (req, res, next) => {
  try {
    const tokenHash = hashSessionToken(req.cookies[DASHBOARD_COOKIE]);
    const result = await getPool().query('SELECT * FROM platform_admin_tenants($1)', [tokenHash]);
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/tenants/:id/status', async (req, res, next) => {
  const parsed = z.object({ status: z.enum(['active', 'suspended']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Status must be active or suspended.' });
  try {
    const tokenHash = hashSessionToken(req.cookies[DASHBOARD_COOKIE]);
    const result = await getPool().query('SELECT platform_admin_set_tenant_status($1, $2, $3) AS changed', [
      tokenHash,
      req.params.id,
      parsed.data.status,
    ]);
    if (!result.rows[0].changed) return res.status(404).json({ error: 'Customer workspace not found.' });
    await recordAudit(req, `platform.tenant_${parsed.data.status}`, {
      tenantId: req.params.id,
      actorUserId: req.auth.user_id,
      resourceType: 'tenant',
      resourceId: req.params.id,
    });
    res.json({ data: { id: req.params.id, status: parsed.data.status } });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Customer workspace not found.' });
    next(err);
  }
});

router.get('/queues', async (_req, res, next) => {
  try {
    const [payments, webhooks] = await Promise.all([
      getPaymentStatusQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
      getWebhookDeliveryQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
    ]);
    res.json({ data: { payments, webhooks } });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { createApiKeyAuth } from '../middleware/apiKeyAuth.js';
import { withTenant } from '../database/client.js';
import paymentRoutes from './v1Payments.js';
import subscriptionRoutes from './subscriptions.js';

const router = Router();

router.use(createApiKeyAuth());

router.get('/account', async (req, res, next) => {
  try {
    const account = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query('SELECT id, slug, name, status, timezone, created_at FROM tenants WHERE id = $1', [
        req.auth.tenantId,
      ]);
      return result.rows[0];
    });
    res.json({ data: account });
  } catch (err) {
    next(err);
  }
});

router.use('/payments', paymentRoutes);
router.use('/subscriptions', subscriptionRoutes);

export default router;

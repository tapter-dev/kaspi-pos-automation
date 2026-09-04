import { Router } from 'express';
import { createDashboardAuth } from '../middleware/dashboardAuth.js';
import subscriptionRoutes from './subscriptions.js';

const router = Router();
router.use(createDashboardAuth());
router.use((req, _res, next) => {
  req.auth = {
    ...req.auth,
    tenantId: req.auth.tenant_id,
    userId: req.auth.user_id,
    scopes: req.auth.role === 'viewer' ? ['payments:read'] : ['payments:read', 'payments:write'],
  };
  next();
});
router.use(subscriptionRoutes);

export default router;

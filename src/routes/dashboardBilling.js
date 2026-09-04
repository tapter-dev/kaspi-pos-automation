import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { withTenant } from '../database/client.js';
import { recordAudit } from '../audit.js';

const router = Router();
router.use(createDashboardAuth());

const loadBilling = (tenantId) => withTenant(tenantId, async (db) => {
  await db.query(
    `INSERT INTO tenant_plan_subscriptions (tenant_id, plan_code)
     SELECT $1, 'beta' WHERE NOT EXISTS (
       SELECT 1 FROM tenant_plan_subscriptions WHERE tenant_id=$1 AND status IN ('active', 'past_due')
     )`,
    [tenantId],
  );
  const plans = await db.query('SELECT code, name, description, price_minor, currency, limits, features FROM plan_catalog WHERE active=true ORDER BY sort_order');
  const subscription = await db.query(
      `SELECT subscription.*, plan.name, plan.description, plan.price_minor, plan.currency, plan.limits, plan.features
       FROM tenant_plan_subscriptions AS subscription
       JOIN plan_catalog AS plan ON plan.code=subscription.plan_code
       WHERE subscription.tenant_id=$1 AND subscription.status IN ('active', 'past_due') LIMIT 1`,
      [tenantId],
    );
  const usage = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM payment_orders WHERE tenant_id=$1 AND created_at >= date_trunc('month', now())) AS payments,
         (SELECT COUNT(*)::int FROM memberships WHERE tenant_id=$1) AS team_members,
         (SELECT COUNT(*)::int FROM api_keys WHERE tenant_id=$1 AND revoked_at IS NULL AND enabled=true) AS api_keys`,
      [tenantId],
    );
  const transactions = await db.query('SELECT * FROM billing_transactions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tenantId]);
  const requests = await db.query(
      `SELECT request.id, request.requested_plan_code, request.status, request.created_at, plan.name, plan.price_minor
       FROM plan_change_requests AS request JOIN plan_catalog AS plan ON plan.code=request.requested_plan_code
       WHERE request.tenant_id=$1 ORDER BY request.created_at DESC LIMIT 20`,
      [tenantId],
    );
  return {
    plans: plans.rows,
    subscription: subscription.rows[0],
    usage: usage.rows[0],
    transactions: transactions.rows,
    requests: requests.rows,
  };
});

router.get('/', async (req, res, next) => {
  try {
    res.json({ data: await loadBilling(req.auth.tenant_id) });
  } catch (err) {
    next(err);
  }
});

router.post('/plan-requests', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = z.object({ planCode: z.string().regex(/^[a-z0-9-]+$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a valid plan.' });
  try {
    const request = await withTenant(req.auth.tenant_id, async (db) => {
      const plan = await db.query('SELECT code FROM plan_catalog WHERE code=$1 AND active=true', [parsed.data.planCode]);
      if (!plan.rows[0]) return null;
      const current = await db.query(
        `SELECT plan_code FROM tenant_plan_subscriptions
         WHERE tenant_id=$1 AND status IN ('active', 'past_due') LIMIT 1`,
        [req.auth.tenant_id],
      );
      if (current.rows[0]?.plan_code === parsed.data.planCode) return { current: true };
      const existing = await db.query(
        `SELECT id, requested_plan_code, status, created_at FROM plan_change_requests
         WHERE tenant_id=$1 AND requested_plan_code=$2 AND status='pending' LIMIT 1`,
        [req.auth.tenant_id, parsed.data.planCode],
      );
      if (existing.rows[0]) return existing.rows[0];
      const result = await db.query(
        `INSERT INTO plan_change_requests (tenant_id, requested_plan_code, requested_by)
         VALUES ($1, $2, $3) RETURNING id, requested_plan_code, status, created_at`,
        [req.auth.tenant_id, parsed.data.planCode, req.auth.user_id],
      );
      return result.rows[0];
    });
    if (!request) return res.status(404).json({ error: 'Plan not found.' });
    if (request.current) return res.status(409).json({ error: 'This is already your current plan.' });
    await recordAudit(req, 'plan.change_requested', {
      resourceType: 'plan_change_request',
      resourceId: request.id,
      metadata: { planCode: request.requested_plan_code },
    });
    res.status(201).json({ data: request });
  } catch (err) {
    next(err);
  }
});

router.delete('/plan-requests/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const result = await withTenant(req.auth.tenant_id, (db) => db.query(
      `UPDATE plan_change_requests SET status='cancelled', updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='pending' RETURNING id`,
      [req.auth.tenant_id, req.params.id],
    ));
    if (!result.rows[0]) return res.status(404).json({ error: 'Pending plan request not found.' });
    await recordAudit(req, 'plan.change_request_cancelled', {
      resourceType: 'plan_change_request',
      resourceId: req.params.id,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const createReferralCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase().padEnd(8, 'K');

router.get('/partner', async (req, res, next) => {
  try {
    const data = await withTenant(req.auth.tenant_id, async (db) => {
      let program = (await db.query('SELECT * FROM partner_programs WHERE tenant_id=$1', [req.auth.tenant_id])).rows[0];
      for (let attempt = 0; !program && attempt < 5; attempt += 1) {
        try {
          program = (await db.query(
            `INSERT INTO partner_programs (tenant_id, referral_code) VALUES ($1, $2)
             RETURNING tenant_id, referral_code, status, commission_percent, created_at`,
            [req.auth.tenant_id, createReferralCode()],
          )).rows[0];
        } catch (err) {
          if (err.code !== '23505') throw err;
        }
      }
      if (!program) throw new Error('Could not allocate a partner code.');
      const summary = await db.query(
          `SELECT COUNT(*)::int AS registrations,
                  COUNT(*) FILTER (WHERE status IN ('qualified','rewarded'))::int AS qualified,
                  COALESCE(SUM(reward_minor) FILTER (WHERE status='rewarded'),0)::bigint AS rewards_minor
           FROM partner_referrals WHERE tenant_id=$1`,
          [req.auth.tenant_id],
        );
      const referrals = await db.query(
          `SELECT referral.id, referral.status, referral.reward_minor, referral.created_at,
                  tenant.name AS referred_tenant_name
           FROM partner_referrals AS referral JOIN tenants AS tenant ON tenant.id=referral.referred_tenant_id
           WHERE referral.tenant_id=$1 ORDER BY referral.created_at DESC LIMIT 100`,
          [req.auth.tenant_id],
        );
      return { program, summary: summary.rows[0], referrals: referrals.rows };
    });
    const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.json({ data: { ...data, referralUrl: `${origin}/dashboard?ref=${data.program.referral_code}` } });
  } catch (err) {
    next(err);
  }
});

export default router;

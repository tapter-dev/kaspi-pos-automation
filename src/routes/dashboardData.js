import { Router } from 'express';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { withTenant } from '../database/client.js';
import { z } from 'zod';
import { recordAudit } from '../audit.js';

const router = Router();
router.use(createDashboardAuth());

const paymentFields = `id, method, amount_minor, currency, external_order_id, description,
  internal_comment, customer_phone, status, provider_status, qr_token, qr_original_token, receipt_url,
  expires_at, paid_at, created_at, updated_at`;

const paymentStatuses = new Set([
  'created', 'pending', 'requires_customer_action', 'paid', 'failed', 'expired', 'cancelled',
  'partially_refunded', 'refunded', 'unknown',
]);

const paymentQuery = (query, { exportAll = false } = {}) => {
  const status = typeof query.status === 'string' && paymentStatuses.has(query.status) ? query.status : null;
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  const dateField = query.dateField === 'paidAt' ? 'paid_at' : 'created_at';
  const dateFrom = typeof query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom)
    ? `${query.dateFrom}T00:00:00+06:00`
    : null;
  const dateTo = typeof query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)
    ? `${query.dateTo}T23:59:59.999+06:00`
    : null;
  const page = Math.max(Number(query.page) || 1, 1);
  const perPage = exportAll ? 5000 : Math.min(Math.max(Number(query.perPage) || 25, 1), 100);
  return { status, search, dateField, dateFrom, dateTo, page, perPage };
};

const csvCell = (value) => {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
};

router.get('/overview', async (req, res, next) => {
  const period = ['today', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'today';
  const periodStart = {
    today: "date_trunc('day', now())",
    week: "now() - interval '7 days'",
    month: "date_trunc('month', now())",
    year: "date_trunc('year', now())",
  }[period];
  try {
    const data = await withTenant(req.auth.tenant_id, async (db) => {
      const stats = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE created_at >= ${periodStart})::int AS payments_today,
           COALESCE(SUM(amount_minor) FILTER (WHERE status IN ('paid', 'partially_refunded', 'refunded') AND created_at >= ${periodStart}), 0)::bigint AS volume_today_minor,
           COUNT(*) FILTER (WHERE status = 'paid' AND created_at >= ${periodStart})::int AS paid_count,
           COUNT(*) FILTER (WHERE status IN ('created', 'pending', 'requires_customer_action') AND created_at >= ${periodStart})::int AS pending_count,
           COUNT(*) FILTER (WHERE status IN ('failed', 'expired', 'cancelled', 'unknown') AND created_at >= ${periodStart})::int AS problem_count
         FROM payment_orders WHERE tenant_id = $1`,
        [req.auth.tenant_id],
      );
      const connection = await db.query(
        'SELECT state, organization_name, last_verified_at, last_error FROM kaspi_connections WHERE tenant_id = $1',
        [req.auth.tenant_id],
      );
      const webhooks = await db.query(
        "SELECT COUNT(*) FILTER (WHERE status IN ('failed', 'dead'))::int AS failed FROM webhook_deliveries WHERE tenant_id = $1",
        [req.auth.tenant_id],
      );
      const tenant = await db.query('SELECT work_mode FROM tenants WHERE id=$1', [req.auth.tenant_id]);
      return { period, stats: stats.rows[0], connection: connection.rows[0] || null, failedWebhooks: webhooks.rows[0].failed, workMode: tenant.rows[0].work_mode };
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/organization', async (req, res, next) => {
  try {
    const data = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT tenant.id, tenant.slug, tenant.name, tenant.status, tenant.timezone, tenant.work_mode,
                tenant.media_consent, tenant.created_at, connection.organization_name AS kaspi_name,
                connection.organization_id AS kaspi_id, connection.last_verified_at
         FROM tenants AS tenant
         LEFT JOIN kaspi_connections AS connection ON connection.tenant_id=tenant.id
         WHERE tenant.id=$1`,
        [req.auth.tenant_id],
      );
      return result.rows[0];
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.patch('/organization', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    workMode: z.enum(['live', 'test']).optional(),
    mediaConsent: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid organization settings.' });
  try {
    const data = await withTenant(req.auth.tenant_id, async (db) => {
      const current = await db.query('SELECT * FROM tenants WHERE id=$1', [req.auth.tenant_id]);
      const value = current.rows[0];
      const result = await db.query(
        `UPDATE tenants SET name=$2, work_mode=$3, media_consent=$4, updated_at=now()
         WHERE id=$1 RETURNING id, slug, name, status, timezone, work_mode, media_consent, updated_at`,
        [req.auth.tenant_id, parsed.data.name ?? value.name, parsed.data.workMode ?? value.work_mode,
          parsed.data.mediaConsent ?? value.media_consent],
      );
      return result.rows[0];
    });
    await recordAudit(req, 'organization.updated', {
      resourceType: 'tenant', resourceId: req.auth.tenant_id,
      metadata: { workMode: data.work_mode, mediaConsent: data.media_consent },
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/payments', async (req, res, next) => {
  const filters = paymentQuery(req.query);
  try {
    const result = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT ${paymentFields}, COUNT(*) OVER()::int AS total_count FROM payment_orders
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR status = $2)
           AND ($3::text = '' OR external_order_id ILIKE '%' || $3 || '%'
             OR description ILIKE '%' || $3 || '%' OR internal_comment ILIKE '%' || $3 || '%'
             OR customer_phone ILIKE '%' || $3 || '%')
           AND ($4::timestamptz IS NULL OR ${filters.dateField} >= $4)
           AND ($5::timestamptz IS NULL OR ${filters.dateField} <= $5)
         ORDER BY created_at DESC LIMIT $6 OFFSET $7`,
        [
          req.auth.tenant_id,
          filters.status,
          filters.search,
          filters.dateFrom,
          filters.dateTo,
          filters.perPage,
          (filters.page - 1) * filters.perPage,
        ],
      );
      return result;
    });
    res.json({
      data: result.rows.map((row) => ({ ...row, amount: Number(row.amount_minor) / 100, amount_minor: undefined, total_count: undefined })),
      meta: { page: filters.page, perPage: filters.perPage, total: result.rows[0]?.total_count || 0 },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/payments/export', async (req, res, next) => {
  const filters = paymentQuery(req.query, { exportAll: true });
  try {
    const rows = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT ${paymentFields} FROM payment_orders
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR status = $2)
           AND ($3::text = '' OR external_order_id ILIKE '%' || $3 || '%'
             OR description ILIKE '%' || $3 || '%' OR internal_comment ILIKE '%' || $3 || '%'
             OR customer_phone ILIKE '%' || $3 || '%')
           AND ($4::timestamptz IS NULL OR ${filters.dateField} >= $4)
           AND ($5::timestamptz IS NULL OR ${filters.dateField} <= $5)
         ORDER BY created_at DESC LIMIT $6`,
        [req.auth.tenant_id, filters.status, filters.search, filters.dateFrom, filters.dateTo, filters.perPage],
      );
      return result.rows;
    });
    const header = ['id', 'external_order_id', 'method', 'amount', 'currency', 'status', 'customer_phone', 'description', 'internal_comment', 'created_at', 'paid_at'];
    const body = rows.map((row) => [
      row.id,
      row.external_order_id,
      row.method,
      Number(row.amount_minor) / 100,
      row.currency,
      row.status,
      row.customer_phone,
      row.description,
      row.internal_comment,
      row.created_at?.toISOString?.() || row.created_at,
      row.paid_at?.toISOString?.() || row.paid_at,
    ].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\ufeff${header.join(',')}\n${body.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
});

router.get('/refunds', async (req, res, next) => {
  const status = typeof req.query.status === 'string' && ['pending', 'succeeded', 'failed', 'unknown'].includes(req.query.status)
    ? req.query.status : null;
  const dateFrom = typeof req.query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateFrom)
    ? `${req.query.dateFrom}T00:00:00+06:00` : null;
  const dateTo = typeof req.query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateTo)
    ? `${req.query.dateTo}T23:59:59.999+06:00` : null;
  try {
    const data = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT refund.id, refund.payment_id, refund.amount_minor, refund.status,
                refund.provider_refund_id, refund.provider_response, refund.created_at, refund.updated_at,
                payment.external_order_id, payment.customer_phone, payment.currency
         FROM refunds AS refund
         JOIN payment_orders AS payment ON payment.id = refund.payment_id
         WHERE refund.tenant_id = $1 AND ($2::text IS NULL OR refund.status=$2)
           AND ($3::timestamptz IS NULL OR refund.created_at >= $3)
           AND ($4::timestamptz IS NULL OR refund.created_at <= $4)
         ORDER BY refund.created_at DESC LIMIT 100`,
        [req.auth.tenant_id, status, dateFrom, dateTo],
      );
      const summary = await db.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_minor),0)::bigint AS total_minor,
                COALESCE(AVG(amount_minor),0)::numeric AS average_minor
         FROM refunds WHERE tenant_id=$1
           AND ($2::text IS NULL OR status=$2)
           AND ($3::timestamptz IS NULL OR created_at >= $3)
           AND ($4::timestamptz IS NULL OR created_at <= $4)`,
        [req.auth.tenant_id, status, dateFrom, dateTo],
      );
      return { rows: result.rows, summary: summary.rows[0] };
    });
    res.json({ data: data.rows, summary: data.summary });
  } catch (err) {
    next(err);
  }
});

router.get('/audit', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const entries = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        'SELECT * FROM list_tenant_audit_logs($1, 100)',
        [req.auth.tenant_id],
      );
      return result.rows;
    });
    res.json({ data: entries });
  } catch (err) {
    next(err);
  }
});

export default router;

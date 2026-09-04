import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { withTenant } from '../database/client.js';
import { encryptJson } from '../crypto.js';
import { validateWebhookUrl } from '../webhooks/urlSafety.js';
import { enqueueWebhookDelivery } from '../queue/client.js';
import { recordAudit } from '../audit.js';

const router = Router();
router.use(createDashboardAuth());

const eventNames = [
  'payment.created',
  'payment.paid',
  'payment.failed',
  'payment.expired',
  'payment.cancelled',
  'payment.unknown',
  'payment.refunded',
  'payment.partially_refunded',
];

const endpointSchema = z.object({
  url: z.string().url().max(2000),
  description: z.string().trim().max(200).optional(),
  events: z.array(z.enum(eventNames)).min(1),
});

router.get('/', async (req, res, next) => {
  try {
    const endpoints = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT id, api_key_id, url, description, events, enabled, failure_count, created_at, updated_at
         FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [req.auth.tenant_id],
      );
      return result.rows;
    });
    res.json({ data: endpoints });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  const parsed = endpointSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Invalid webhook endpoint.', details: parsed.error.issues });
  try {
    await validateWebhookUrl(parsed.data.url);
    const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`;
    const endpoint = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `INSERT INTO webhook_endpoints
          (tenant_id, url, description, encrypted_secret, key_version, events)
         VALUES ($1, $2, $3, $4, 'local-v1', $5)
         RETURNING id, url, description, events, enabled, created_at`,
        [
          req.auth.tenant_id,
          parsed.data.url,
          parsed.data.description || null,
          encryptJson({ secret }),
          parsed.data.events,
        ],
      );
      return result.rows[0];
    });
    await recordAudit(req, 'webhook_endpoint.created', {
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      metadata: { url: endpoint.url, events: endpoint.events },
    });
    res.status(201).json({ data: { ...endpoint, secret } });
  } catch (err) {
    if (/Webhook URL/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  const parsed = z
    .object({
      url: z.string().url().max(2000).optional(),
      description: z.string().trim().max(200).nullable().optional(),
      events: z.array(z.enum(eventNames)).min(1).optional(),
      enabled: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid webhook update.' });
  try {
    if (parsed.data.url) await validateWebhookUrl(parsed.data.url);
    const endpoint = await withTenant(req.auth.tenant_id, async (db) => {
      const current = await db.query('SELECT * FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2', [
        req.auth.tenant_id,
        req.params.id,
      ]);
      if (!current.rows[0]) return null;
      const value = current.rows[0];
      const result = await db.query(
        `UPDATE webhook_endpoints SET url = $3, description = $4, events = $5, enabled = $6,
           failure_count = CASE WHEN $7 THEN 0 ELSE failure_count END, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, url, description, events, enabled, failure_count, created_at, updated_at`,
        [
          req.auth.tenant_id,
          req.params.id,
          parsed.data.url || value.url,
          parsed.data.description !== undefined ? parsed.data.description : value.description,
          parsed.data.events || value.events,
          parsed.data.enabled ?? value.enabled,
          parsed.data.enabled === true,
        ],
      );
      return result.rows[0];
    });
    if (!endpoint) return res.status(404).json({ error: 'Webhook endpoint not found.' });
    await recordAudit(req, 'webhook_endpoint.updated', {
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
      metadata: { enabled: endpoint.enabled, events: endpoint.events },
    });
    res.json({ data: endpoint });
  } catch (err) {
    if (/Webhook URL/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/rotate-secret', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`;
    const endpoint = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `UPDATE webhook_endpoints SET encrypted_secret = $3, key_version = 'local-v1', updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING id, url, updated_at`,
        [req.auth.tenant_id, req.params.id, encryptJson({ secret })],
      );
      return result.rows[0];
    });
    if (!endpoint) return res.status(404).json({ error: 'Webhook endpoint not found.' });
    await recordAudit(req, 'webhook_endpoint.secret_rotated', {
      resourceType: 'webhook_endpoint',
      resourceId: endpoint.id,
    });
    res.json({ data: { ...endpoint, secret } });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/test', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const delivery = await withTenant(req.auth.tenant_id, async (db) => {
      const endpoint = await db.query(
        'SELECT id FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2 AND enabled = true',
        [req.auth.tenant_id, req.params.id],
      );
      if (!endpoint.rows[0]) return null;
      const event = await db.query(
        `INSERT INTO payment_events (tenant_id, payment_id, type, data)
         VALUES ($1, NULL, 'webhook.test', $2) RETURNING id`,
        [req.auth.tenant_id, { test: true, message: 'Kaspi Automation webhook test' }],
      );
      const result = await db.query(
        `INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event_id, next_attempt_at)
         VALUES ($1, $2, $3, now()) RETURNING id`,
        [req.auth.tenant_id, endpoint.rows[0].id, event.rows[0].id],
      );
      return result.rows[0];
    });
    if (!delivery) return res.status(404).json({ error: 'Enabled webhook endpoint not found.' });
    await enqueueWebhookDelivery(req.auth.tenant_id, delivery.id);
    await recordAudit(req, 'webhook_endpoint.test_sent', {
      resourceType: 'webhook_endpoint',
      resourceId: req.params.id,
      metadata: { deliveryId: delivery.id },
    });
    res.status(202).json({ data: { deliveryId: delivery.id, status: 'pending' } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const result = await withTenant(req.auth.tenant_id, (db) =>
      db.query('DELETE FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2', [req.auth.tenant_id, req.params.id]),
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Webhook endpoint not found.' });
    await recordAudit(req, 'webhook_endpoint.deleted', {
      resourceType: 'webhook_endpoint',
      resourceId: req.params.id,
    });
    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Disable endpoints that have delivery history.' });
    next(err);
  }
});

router.get('/deliveries/list', async (req, res, next) => {
  const status = typeof req.query.status === 'string'
    && ['pending', 'delivering', 'succeeded', 'failed', 'dead'].includes(req.query.status)
    ? req.query.status
    : null;
  const apiKeyId = z.string().uuid().safeParse(req.query.apiKeyId).success ? req.query.apiKeyId : null;
  const dateFrom = typeof req.query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateFrom)
    ? `${req.query.dateFrom}T00:00:00+06:00`
    : null;
  const dateTo = typeof req.query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateTo)
    ? `${req.query.dateTo}T23:59:59.999+06:00`
    : null;
  try {
    const deliveries = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT delivery.id, delivery.status, delivery.attempt_count, delivery.response_status,
                delivery.response_duration_ms, delivery.last_error, delivery.created_at,
                delivery.delivered_at, endpoint.url, endpoint.api_key_id,
                api_key.name AS api_key_name, event.type, event.id AS event_id
         FROM webhook_deliveries AS delivery
         JOIN webhook_endpoints AS endpoint ON endpoint.id = delivery.endpoint_id
         LEFT JOIN api_keys AS api_key ON api_key.id = endpoint.api_key_id
         JOIN payment_events AS event ON event.id = delivery.event_id
         WHERE delivery.tenant_id = $1
           AND ($2::text IS NULL OR delivery.status = $2)
           AND ($3::uuid IS NULL OR endpoint.api_key_id = $3)
           AND ($4::timestamptz IS NULL OR delivery.created_at >= $4)
           AND ($5::timestamptz IS NULL OR delivery.created_at <= $5)
         ORDER BY delivery.created_at DESC LIMIT 100`,
        [req.auth.tenant_id, status, apiKeyId, dateFrom, dateTo],
      );
      return result.rows;
    });
    res.json({ data: deliveries });
  } catch (err) {
    next(err);
  }
});

router.post('/deliveries/:id/replay', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const delivery = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = now(), last_error = NULL,
           attempt_started_at = NULL
         WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [req.auth.tenant_id, req.params.id],
      );
      return result.rows[0];
    });
    if (!delivery) return res.status(404).json({ error: 'Webhook delivery not found.' });
    await enqueueWebhookDelivery(req.auth.tenant_id, delivery.id);
    await recordAudit(req, 'webhook_delivery.replayed', {
      resourceType: 'webhook_delivery',
      resourceId: delivery.id,
    });
    res.status(202).json({ data: { id: delivery.id, status: 'pending' } });
  } catch (err) {
    next(err);
  }
});

export default router;

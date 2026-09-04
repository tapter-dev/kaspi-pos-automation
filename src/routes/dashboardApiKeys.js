import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { withTenant } from '../database/client.js';
import { generateApiKey } from '../security/apiKeys.js';
import { recordAudit } from '../audit.js';
import { encryptJson } from '../crypto.js';
import { validateWebhookUrl } from '../webhooks/urlSafety.js';

const router = Router();
router.use(createDashboardAuth());

const allPaymentEvents = [
  'payment.created',
  'payment.paid',
  'payment.failed',
  'payment.expired',
  'payment.cancelled',
  'payment.unknown',
  'payment.refunded',
  'payment.partially_refunded',
];

const keyFields = `key.id, key.name, key.key_prefix, key.environment, key.scopes, key.enabled,
  key.is_default, key.last_used_at, key.expires_at, key.revoked_at, key.created_at, key.updated_at,
  endpoint.id AS webhook_id, endpoint.url AS webhook_url, endpoint.enabled AS webhook_enabled,
  endpoint.failure_count AS webhook_failure_count,
  COUNT(payment.id)::int AS invoice_count`;

router.get('/', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const keys = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT ${keyFields}
         FROM api_keys AS key
         LEFT JOIN webhook_endpoints AS endpoint ON endpoint.api_key_id = key.id
         LEFT JOIN payment_orders AS payment ON payment.created_by_api_key_id = key.id
         WHERE key.tenant_id = $1
         GROUP BY key.id, endpoint.id
         ORDER BY key.created_at DESC`,
        [req.auth.tenant_id],
      );
      return result.rows;
    });
    res.json({ data: keys });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      environment: z.enum(['live', 'test']).default('live'),
      scopes: z.array(z.enum(['payments:read', 'payments:write'])).min(1),
      expiresAt: z.string().datetime().optional(),
      webhookUrl: z.string().url().max(2000).optional(),
      isDefault: z.boolean().default(false),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid API key request.', details: parsed.error.issues });
  try {
    if (parsed.data.webhookUrl) await validateWebhookUrl(parsed.data.webhookUrl);
    const generated = generateApiKey(parsed.data.environment);
    const webhookSecret = parsed.data.webhookUrl
      ? `whsec_${crypto.randomBytes(32).toString('base64url')}`
      : null;
    const key = await withTenant(req.auth.tenant_id, async (db) => {
      const existingDefault = await db.query(
        'SELECT 1 FROM api_keys WHERE tenant_id = $1 AND is_default = true AND enabled = true AND revoked_at IS NULL LIMIT 1',
        [req.auth.tenant_id],
      );
      const makeDefault = parsed.data.isDefault || existingDefault.rowCount === 0;
      if (makeDefault) {
        await db.query('UPDATE api_keys SET is_default = false, updated_at = now() WHERE tenant_id = $1', [
          req.auth.tenant_id,
        ]);
      }
      const result = await db.query(
        `INSERT INTO api_keys
          (tenant_id, name, key_prefix, key_hash, environment, scopes, expires_at, created_by, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, key_prefix, environment, scopes, enabled, is_default, expires_at, created_at`,
        [
          req.auth.tenant_id,
          parsed.data.name,
          generated.prefix,
          generated.hash,
          parsed.data.environment,
          parsed.data.scopes,
          parsed.data.expiresAt || null,
          req.auth.user_id,
          makeDefault,
        ],
      );
      let webhook = null;
      if (parsed.data.webhookUrl) {
        const webhookResult = await db.query(
          `INSERT INTO webhook_endpoints
            (tenant_id, api_key_id, url, description, encrypted_secret, key_version, events)
           VALUES ($1, $2, $3, $4, $5, 'local-v1', $6)
           RETURNING id, url, enabled, created_at`,
          [
            req.auth.tenant_id,
            result.rows[0].id,
            parsed.data.webhookUrl,
            parsed.data.name,
            encryptJson({ secret: webhookSecret }),
            allPaymentEvents,
          ],
        );
        webhook = webhookResult.rows[0];
      }
      return { ...result.rows[0], webhook };
    });
    await recordAudit(req, 'api_key.created', {
      resourceType: 'api_key',
      resourceId: key.id,
      metadata: { name: key.name, keyPrefix: key.key_prefix, scopes: key.scopes },
    });
    res.status(201).json({
      data: { ...key, apiKey: generated.apiKey, webhookSecret },
    });
  } catch (err) {
    if (/Webhook URL/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      scopes: z.array(z.enum(['payments:read', 'payments:write'])).min(1).optional(),
      enabled: z.boolean().optional(),
      isDefault: z.boolean().optional(),
      webhookUrl: z.string().url().max(2000).nullable().optional(),
      webhookEnabled: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid API integration update.' });
  try {
    if (parsed.data.webhookUrl) await validateWebhookUrl(parsed.data.webhookUrl);
    const key = await withTenant(req.auth.tenant_id, async (db) => {
      const current = await db.query(
        `SELECT key.*, endpoint.id AS webhook_id, endpoint.url AS webhook_url,
                endpoint.enabled AS webhook_enabled
         FROM api_keys AS key
         LEFT JOIN webhook_endpoints AS endpoint ON endpoint.api_key_id = key.id
         WHERE key.tenant_id = $1 AND key.id = $2`,
        [req.auth.tenant_id, req.params.id],
      );
      if (!current.rows[0]) return null;
      const value = current.rows[0];
      const nextEnabled = parsed.data.enabled ?? value.enabled;
      const nextDefault = nextEnabled && (parsed.data.isDefault ?? value.is_default);
      if (nextDefault) {
        await db.query(
          'UPDATE api_keys SET is_default = false, updated_at = now() WHERE tenant_id = $1 AND id <> $2',
          [req.auth.tenant_id, req.params.id],
        );
      }
      const updated = await db.query(
        `UPDATE api_keys SET name = $3, scopes = $4, enabled = $5, is_default = $6,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, key_prefix, environment, scopes, enabled, is_default,
                   last_used_at, expires_at, revoked_at, created_at, updated_at`,
        [
          req.auth.tenant_id,
          req.params.id,
          parsed.data.name ?? value.name,
          parsed.data.scopes ?? value.scopes,
          nextEnabled,
          nextDefault,
        ],
      );
      let webhook = value.webhook_id
        ? { id: value.webhook_id, url: value.webhook_url, enabled: value.webhook_enabled }
        : null;
      if (parsed.data.webhookUrl === null && value.webhook_id) {
        await db.query('UPDATE webhook_endpoints SET enabled = false, updated_at = now() WHERE id = $1', [
          value.webhook_id,
        ]);
        webhook = null;
      } else if (value.webhook_id && (parsed.data.webhookUrl || parsed.data.webhookEnabled !== undefined)) {
        const changed = await db.query(
          `UPDATE webhook_endpoints SET url = $2, description = $3, enabled = $4,
             failure_count = CASE WHEN $4 THEN 0 ELSE failure_count END, updated_at = now()
           WHERE id = $1 RETURNING id, url, enabled`,
          [
            value.webhook_id,
            parsed.data.webhookUrl || value.webhook_url,
            parsed.data.name ?? value.name,
            parsed.data.webhookEnabled ?? value.webhook_enabled,
          ],
        );
        webhook = changed.rows[0];
      }
      return { ...updated.rows[0], webhook };
    });
    if (!key) return res.status(404).json({ error: 'API key not found.' });
    await recordAudit(req, 'api_key.updated', {
      resourceType: 'api_key',
      resourceId: key.id,
      metadata: { enabled: key.enabled, isDefault: key.is_default },
    });
    res.json({ data: key });
  } catch (err) {
    if (/Webhook URL/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/rotate', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const rotated = await withTenant(req.auth.tenant_id, async (db) => {
      const current = await db.query(
        'SELECT environment FROM api_keys WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL',
        [req.auth.tenant_id, req.params.id],
      );
      if (!current.rows[0]) return null;
      const generated = generateApiKey(current.rows[0].environment);
      const result = await db.query(
        `UPDATE api_keys SET key_prefix = $3, key_hash = $4, last_used_at = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, key_prefix, environment, scopes, enabled, is_default, updated_at`,
        [req.auth.tenant_id, req.params.id, generated.prefix, generated.hash],
      );
      return { ...result.rows[0], apiKey: generated.apiKey };
    });
    if (!rotated) return res.status(404).json({ error: 'Active API key not found.' });
    await recordAudit(req, 'api_key.rotated', { resourceType: 'api_key', resourceId: rotated.id });
    res.json({ data: rotated });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('owner', 'admin', 'developer'), async (req, res, next) => {
  try {
    const result = await withTenant(req.auth.tenant_id, async (db) => {
      const revoked = await db.query(
        `UPDATE api_keys SET revoked_at = now(), enabled = false, is_default = false, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING id`,
        [req.auth.tenant_id, req.params.id],
      );
      if (revoked.rows[0]) {
        await db.query('UPDATE webhook_endpoints SET enabled = false, updated_at = now() WHERE api_key_id = $1', [
          revoked.rows[0].id,
        ]);
      }
      return revoked;
    });
    if (!result.rowCount) return res.status(404).json({ error: 'API key not found.' });
    await recordAudit(req, 'api_key.revoked', { resourceType: 'api_key', resourceId: req.params.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

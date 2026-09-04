import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../database/client.js';
import { requireScope } from '../middleware/scopes.js';
import { getKaspiConnection } from '../kaspi/connectionStore.js';
import { cancelInvoicePayment, createInvoicePayment, createKaspiRefund, createQrPayment } from '../kaspi/provider.js';
import { createPaymentEvent } from '../webhooks/events.js';
import { enqueuePaymentStatus } from '../queue/client.js';
import { recordAudit } from '../audit.js';
import QRCode from 'qrcode';
import { toMinorUnits } from '../payments/money.js';
import { canonicalJson } from '../security/canonicalJson.js';

const router = Router();

const paymentSchema = z
  .object({
    method: z.enum(['qr', 'invoice']),
    amount: z.number().positive().max(999_999_999),
    currency: z.literal('KZT').default('KZT'),
    externalOrderId: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(500).optional(),
    internalComment: z.string().trim().max(255).optional(),
    customerPhone: z
      .string()
      .regex(/^7?\d{10}$/)
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'invoice' && !value.customerPhone) {
      ctx.addIssue({ code: 'custom', path: ['customerPhone'], message: 'customerPhone is required for invoices' });
    }
    if (toMinorUnits(value.amount) === null) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'amount supports at most two decimal places' });
    }
  });

const serializePayment = (row) => ({
  id: row.id,
  method: row.method,
  amount: Number(row.amount_minor) / 100,
  currency: row.currency,
  externalOrderId: row.external_order_id,
  description: row.description,
  internalComment: row.internal_comment,
  customerPhone: row.customer_phone,
  status: row.status,
  providerStatus: row.provider_status,
  qrToken: row.qr_token,
  qrOriginalToken: row.qr_original_token,
  receiptUrl: row.receipt_url,
  metadata: row.metadata,
  isSandbox: row.metadata?.isSandbox === true,
  expiresAt: row.expires_at,
  paidAt: row.paid_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.post('/', requireScope('payments:write'), async (req, res, next) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment request.', details: parsed.error.issues });
  const idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return res.status(400).json({ error: 'Idempotency-Key header must contain 8-200 characters.' });
  }

  const tenantId = req.auth.tenantId;
  const input = parsed.data;
  const requestHash = crypto.createHash('sha256').update(canonicalJson(input)).digest('hex');

  try {
    const replay = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2',
        [tenantId, idempotencyKey],
      );
      return result.rows[0];
    });
    if (replay) {
      if (replay.request_hash !== requestHash) {
        return res.status(409).json({ error: 'Idempotency key was already used for a different request.' });
      }
      if (!replay.response_body) return res.status(409).json({ error: 'The original request is still being processed.' });
      return res.status(replay.response_status).json(replay.response_body);
    }
    const account = await withTenant(tenantId, async (db) => {
      const result = await db.query('SELECT work_mode FROM tenants WHERE id=$1', [tenantId]);
      return result.rows[0];
    });
    const isSandbox = account.work_mode === 'test' || req.auth.keyEnvironment === 'test';
    const connection = isSandbox ? null : await getKaspiConnection(tenantId, { includeCredentials: true });
    if (!isSandbox && (!connection || connection.state !== 'active')) {
      return res.status(409).json({ error: 'An active Kaspi connection is required.' });
    }

    const reservation = await withTenant(tenantId, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${idempotencyKey}`]);
      const existing = await db.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2',
        [tenantId, idempotencyKey],
      );
      if (existing.rows[0]) return { existing: existing.rows[0] };

      const created = await db.query(
        `INSERT INTO payment_orders
          (tenant_id, method, amount_minor, currency, external_order_id, description, internal_comment,
           customer_phone, metadata, created_by_api_key_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          tenantId,
          input.method,
          toMinorUnits(input.amount),
          input.currency,
          input.externalOrderId || null,
          input.description || null,
          input.internalComment || null,
          input.customerPhone || null,
          { ...input.metadata, isSandbox },
          req.auth.apiKeyId || null,
          req.auth.userId || req.auth.user_id || null,
        ],
      );
      await db.query(
        `INSERT INTO idempotency_keys
          (tenant_id, key, method, path, request_hash, expires_at)
         VALUES ($1, $2, 'POST', '/api/v1/payments', $3, now() + interval '24 hours')`,
        [tenantId, idempotencyKey, requestHash],
      );
      return { payment: created.rows[0] };
    });

    if (reservation.existing) {
      if (reservation.existing.request_hash !== requestHash) {
        return res.status(409).json({ error: 'Idempotency key was already used for a different request.' });
      }
      if (!reservation.existing.response_body) {
        return res.status(409).json({ error: 'The original request is still being processed.' });
      }
      return res.status(reservation.existing.response_status).json(reservation.existing.response_body);
    }

    const payment = reservation.payment;
    let providerResponse;
    try {
      providerResponse = isSandbox
        ? {
            StatusCode: 0,
            Data: {
              QrOperationId: `sandbox-${payment.id}`,
              Status: 'SandboxPending',
              QrToken: input.method === 'qr' ? `https://qr.kaspi.kz/sandbox/${payment.id}` : null,
              ExpireDate: input.method === 'qr' ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
            },
          }
        : input.method === 'qr'
          ? await createQrPayment(connection.credentials, input)
          : await createInvoicePayment(connection.credentials, {
              amount: input.amount,
              phoneNumber: input.customerPhone,
              description: input.description,
            });
    } catch (providerError) {
      const failure = { error: 'Kaspi payment creation failed.', paymentId: payment.id };
      await withTenant(tenantId, async (db) => {
        await db.query("UPDATE payment_orders SET status = 'failed', updated_at = now() WHERE id = $1", [payment.id]);
        await db.query(
          'UPDATE idempotency_keys SET response_status = 502, response_body = $3 WHERE tenant_id = $1 AND key = $2',
          [tenantId, idempotencyKey, failure],
        );
      });
      await createPaymentEvent(tenantId, payment.id, 'payment.failed', { reason: providerError.message });
      await recordAudit(req, 'payment.create_failed', {
        tenantId,
        resourceType: 'payment',
        resourceId: payment.id,
        metadata: { method: input.method, externalOrderId: input.externalOrderId || null },
      });
      return res.status(502).json(failure);
    }

    const data = providerResponse.Data || {};
    const operationId = data.QrOperationId || data.Id;
    if (!operationId) {
      const failure = { error: providerResponse.Message || 'Kaspi rejected the payment.', paymentId: payment.id };
      await withTenant(tenantId, async (db) => {
        await db.query(
          "UPDATE payment_orders SET status = 'failed', provider_status = $2, updated_at = now() WHERE id = $1",
          [payment.id, data.Status || null],
        );
        await db.query(
          'UPDATE idempotency_keys SET response_status = 502, response_body = $3 WHERE tenant_id = $1 AND key = $2',
          [tenantId, idempotencyKey, failure],
        );
      });
      await createPaymentEvent(tenantId, payment.id, 'payment.failed', { providerStatus: data.Status || null });
      await recordAudit(req, 'payment.create_failed', {
        tenantId,
        resourceType: 'payment',
        resourceId: payment.id,
        metadata: { method: input.method, providerStatus: data.Status || null },
      });
      return res.status(502).json(failure);
    }

    const qrCodeDataUrl = data.QrToken ? await QRCode.toDataURL(data.QrToken, { margin: 1, width: 320 }) : null;
    const updated = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        `UPDATE payment_orders SET
          status = $2, provider_operation_id = $3, provider_status = $4,
          qr_token = $5, qr_original_token = $6, receipt_url = $7,
          expires_at = $8, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          payment.id,
          input.method === 'qr' ? 'requires_customer_action' : 'pending',
          String(operationId),
          data.Status || null,
          data.QrToken ? data.QrToken.replace('https://qr.kaspi.kz/', 'https://pay.kaspi.kz/pay/') : null,
          data.QrToken || null,
          data.ReceiptUrl || null,
          data.ExpireDate || null,
        ],
      );
      const responseBody = { data: { ...serializePayment(result.rows[0]), qrCodeDataUrl } };
      await db.query(
        'UPDATE idempotency_keys SET response_status = 201, response_body = $3 WHERE tenant_id = $1 AND key = $2',
        [tenantId, idempotencyKey, responseBody],
      );
      return responseBody;
    });

    await createPaymentEvent(tenantId, payment.id, 'payment.created', {
      providerStatus: data.Status,
      providerOperationId: String(operationId),
    });
    if (!isSandbox) await Promise.allSettled([enqueuePaymentStatus(tenantId, payment.id)]);
    await recordAudit(req, 'payment.created', {
      tenantId,
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { method: input.method, amountMinor: toMinorUnits(input.amount) },
    });

    res.status(201).json(updated);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'externalOrderId is already in use.' });
    next(err);
  }
});

router.get('/', requireScope('payments:read'), async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const statuses = (Array.isArray(req.query.status) ? req.query.status : [req.query.status])
    .filter((value) => typeof value === 'string')
    .filter((value) =>
      ['created', 'pending', 'requires_customer_action', 'paid', 'failed', 'expired', 'cancelled', 'partially_refunded', 'refunded', 'unknown'].includes(value),
    );
  const dateField = req.query.dateField === 'paidAt' ? 'paid_at' : 'created_at';
  const dateFrom = typeof req.query.dateFrom === 'string' && !Number.isNaN(Date.parse(req.query.dateFrom)) ? req.query.dateFrom : null;
  const dateTo = typeof req.query.dateTo === 'string' && !Number.isNaN(Date.parse(req.query.dateTo)) ? req.query.dateTo : null;
  const sortColumns = { createdAt: 'created_at', paidAt: 'paid_at', amount: 'amount_minor', status: 'status' };
  const sortBy = sortColumns[req.query.sortBy] || 'created_at';
  const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  try {
    const result = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query(
        `SELECT payment.*, COUNT(*) OVER()::int AS total_count
         FROM payment_orders AS payment
         WHERE tenant_id = $1
           AND ($2::text = '' OR external_order_id ILIKE '%' || $2 || '%'
             OR description ILIKE '%' || $2 || '%' OR internal_comment ILIKE '%' || $2 || '%'
             OR customer_phone ILIKE '%' || $2 || '%')
           AND (cardinality($3::text[]) = 0 OR status = ANY($3::text[]))
           AND ($4::timestamptz IS NULL OR ${dateField} >= $4)
           AND ($5::timestamptz IS NULL OR ${dateField} <= $5)
         ORDER BY ${sortBy} ${sortOrder} NULLS LAST LIMIT $6 OFFSET $7`,
        [req.auth.tenantId, search, statuses, dateFrom, dateTo, limit, (page - 1) * limit],
      );
      return result;
    });
    res.json({
      data: result.rows.map(serializePayment),
      meta: { page, perPage: limit, total: result.rows[0]?.total_count || 0 },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireScope('payments:read'), async (req, res, next) => {
  try {
    const payment = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query('SELECT * FROM payment_orders WHERE tenant_id = $1 AND id = $2', [
        req.auth.tenantId,
        req.params.id,
      ]);
      return result.rows[0];
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    res.json({ data: serializePayment(payment) });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Payment not found.' });
    next(err);
  }
});

router.patch('/:id', requireScope('payments:write'), async (req, res, next) => {
  const parsed = z.object({ internalComment: z.string().trim().max(255).nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'internalComment must contain at most 255 characters.' });
  try {
    const payment = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query(
        `UPDATE payment_orders SET internal_comment = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [req.auth.tenantId, req.params.id, parsed.data.internalComment || null],
      );
      return result.rows[0];
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    await recordAudit(req, 'payment.note_updated', {
      tenantId: req.auth.tenantId,
      resourceType: 'payment',
      resourceId: payment.id,
    });
    res.json({ data: serializePayment(payment) });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Payment not found.' });
    next(err);
  }
});

router.post('/:id/simulate-status', requireScope('payments:write'), async (req, res, next) => {
  const parsed = z.object({
    status: z.enum(['paid', 'failed', 'expired', 'cancelled']),
    errorMessage: z.string().trim().max(255).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid sandbox status.' });
  try {
    const payment = await withTenant(req.auth.tenantId, async (db) => {
      const tenant = await db.query('SELECT work_mode FROM tenants WHERE id=$1', [req.auth.tenantId]);
      if (tenant.rows[0].work_mode !== 'test' && req.auth.keyEnvironment !== 'test') return { notSandbox: true };
      const result = await db.query(
        `UPDATE payment_orders SET status=$3, provider_status=$3,
           paid_at=CASE WHEN $3='paid' THEN COALESCE(paid_at,now()) ELSE paid_at END,
           metadata=CASE WHEN $4::text IS NULL THEN metadata ELSE metadata || jsonb_build_object('sandboxError',$4::text) END,
           updated_at=now()
         WHERE tenant_id=$1 AND id=$2 AND metadata->>'isSandbox'='true'
           AND status IN ('created','pending','requires_customer_action','unknown')
         RETURNING *`,
        [req.auth.tenantId, req.params.id, parsed.data.status, parsed.data.errorMessage || null],
      );
      return { payment: result.rows[0] };
    });
    if (payment.notSandbox) return res.status(403).json({ error: 'Status simulation is available only in test mode.' });
    if (!payment.payment) return res.status(409).json({ error: 'Only a non-terminal sandbox payment can be simulated.' });
    await createPaymentEvent(req.auth.tenantId, payment.payment.id, `payment.${parsed.data.status}`, {
      simulated: true,
      ...(parsed.data.errorMessage && { errorMessage: parsed.data.errorMessage }),
    });
    res.json({ data: serializePayment(payment.payment) });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Payment not found.' });
    next(err);
  }
});

router.post('/:id/cancel', requireScope('payments:write'), async (req, res, next) => {
  try {
    const payment = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query('SELECT * FROM payment_orders WHERE tenant_id = $1 AND id = $2', [
        req.auth.tenantId,
        req.params.id,
      ]);
      return result.rows[0];
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    if (payment.method !== 'invoice' || !['created', 'pending'].includes(payment.status)) {
      return res.status(409).json({ error: 'Only pending invoices can be cancelled.' });
    }
    const connection = await getKaspiConnection(req.auth.tenantId, { includeCredentials: true });
    if (!connection || connection.state !== 'active') {
      return res.status(409).json({ error: 'An active Kaspi connection is required.' });
    }
    const cancellation = await cancelInvoicePayment(connection.credentials, payment.provider_operation_id);
    if (cancellation.StatusCode !== 0) {
      return res.status(502).json({ error: cancellation.Message || 'Kaspi rejected the cancellation.' });
    }
    const updated = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query(
        "UPDATE payment_orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *",
        [payment.id],
      );
      return result.rows[0];
    });
    await createPaymentEvent(req.auth.tenantId, payment.id, 'payment.cancelled');
    await recordAudit(req, 'payment.cancelled', {
      resourceType: 'payment',
      resourceId: payment.id,
    });
    res.json({ data: serializePayment(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/refunds', requireScope('payments:write'), async (req, res, next) => {
  const parsed = z.object({ amount: z.number().positive().max(999_999_999) }).safeParse(req.body);
  if (!parsed.success || toMinorUnits(parsed.data.amount) === null) {
    return res.status(400).json({ error: 'Refund amount must be positive with at most two decimal places.' });
  }
  const idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return res.status(400).json({ error: 'Idempotency-Key header must contain 8-200 characters.' });
  }

  const tenantId = req.auth.tenantId;
  const amountMinor = toMinorUnits(parsed.data.amount);
  const requestHash = crypto.createHash('sha256').update(`${req.params.id}:${amountMinor}`).digest('hex');
  try {
    const replay = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2',
        [tenantId, idempotencyKey],
      );
      return result.rows[0];
    });
    if (replay) {
      if (replay.request_hash !== requestHash) {
        return res.status(409).json({ error: 'Idempotency key was already used for a different request.' });
      }
      if (!replay.response_body) return res.status(409).json({ error: 'Refund is still processing.' });
      return res.status(replay.response_status).json(replay.response_body);
    }
    const connection = await getKaspiConnection(tenantId, { includeCredentials: true });
    if (!connection || connection.state !== 'active') {
      return res.status(409).json({ error: 'An active Kaspi connection is required.' });
    }
    const reservation = await withTenant(tenantId, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${idempotencyKey}`]);
      const existing = await db.query(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2',
        [tenantId, idempotencyKey],
      );
      if (existing.rows[0]) return { existing: existing.rows[0], requestHash };

      const payment = await db.query(
        'SELECT * FROM payment_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [tenantId, req.params.id],
      );
      if (!payment.rows[0]) return { notFound: true };
      if (!['paid', 'partially_refunded'].includes(payment.rows[0].status)) return { invalidStatus: true };
      const reserved = await db.query(
        `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total FROM refunds
         WHERE payment_id = $1 AND status IN ('pending', 'succeeded')`,
        [payment.rows[0].id],
      );
      if (amountMinor > Number(payment.rows[0].amount_minor) - Number(reserved.rows[0].total)) {
        return { exceeds: true };
      }
      const refund = await db.query(
        `INSERT INTO refunds (tenant_id, payment_id, amount_minor)
         VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, payment.rows[0].id, amountMinor],
      );
      await db.query(
        `INSERT INTO idempotency_keys (tenant_id, key, method, path, request_hash, expires_at)
         VALUES ($1, $2, 'POST', $3, $4, now() + interval '24 hours')`,
        [tenantId, idempotencyKey, `/api/v1/payments/${req.params.id}/refunds`, requestHash],
      );
      return { payment: payment.rows[0], refund: refund.rows[0], requestHash };
    });
    if (reservation.notFound) return res.status(404).json({ error: 'Payment not found.' });
    if (reservation.invalidStatus) return res.status(409).json({ error: 'Only paid payments can be refunded.' });
    if (reservation.exceeds) return res.status(409).json({ error: 'Refund exceeds the remaining refundable amount.' });
    if (reservation.existing) {
      if (reservation.existing.request_hash !== reservation.requestHash) {
        return res.status(409).json({ error: 'Idempotency key was already used for a different request.' });
      }
      if (!reservation.existing.response_body) return res.status(409).json({ error: 'Refund is still processing.' });
      return res.status(reservation.existing.response_status).json(reservation.existing.response_body);
    }

    let provider;
    try {
      provider = await createKaspiRefund(
        connection.credentials,
        reservation.payment.provider_operation_id,
        parsed.data.amount,
      );
    } catch (providerError) {
      const failure = { error: 'Kaspi refund failed.', refundId: reservation.refund.id };
      await withTenant(tenantId, async (db) => {
        await db.query(
          `UPDATE refunds SET status = 'failed', provider_response = $2, updated_at = now() WHERE id = $1`,
          [reservation.refund.id, { error: providerError.message }],
        );
        await db.query(
          'UPDATE idempotency_keys SET response_status = 502, response_body = $3 WHERE tenant_id = $1 AND key = $2',
          [tenantId, idempotencyKey, failure],
        );
      });
      await recordAudit(req, 'refund.failed', {
        tenantId,
        resourceType: 'refund',
        resourceId: reservation.refund.id,
        metadata: { paymentId: reservation.payment.id, amountMinor },
      });
      return res.status(502).json(failure);
    }
    const succeeded = provider.StatusCode === 0;
    const responseBody = succeeded
      ? {
          data: {
            id: reservation.refund.id,
            paymentId: reservation.payment.id,
            amount: parsed.data.amount,
            currency: reservation.payment.currency,
            status: 'succeeded',
            createdAt: reservation.refund.created_at,
          },
        }
      : { error: provider.Message || 'Kaspi rejected the refund.', refundId: reservation.refund.id };
    await withTenant(tenantId, async (db) => {
      await db.query(
        `UPDATE refunds SET status = $2, provider_refund_id = $3, provider_response = $4, updated_at = now()
         WHERE id = $1`,
        [
          reservation.refund.id,
          succeeded ? 'succeeded' : 'failed',
          provider.Data?.Id ? String(provider.Data.Id) : null,
          provider,
        ],
      );
      if (succeeded) {
        const totals = await db.query(
          `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total FROM refunds
           WHERE payment_id = $1 AND status = 'succeeded'`,
          [reservation.payment.id],
        );
        const status =
          Number(totals.rows[0].total) >= Number(reservation.payment.amount_minor) ? 'refunded' : 'partially_refunded';
        await db.query('UPDATE payment_orders SET status = $2, updated_at = now() WHERE id = $1', [
          reservation.payment.id,
          status,
        ]);
      }
      await db.query(
        'UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE tenant_id = $1 AND key = $2',
        [tenantId, idempotencyKey, succeeded ? 201 : 502, responseBody],
      );
    });
    if (succeeded) {
      const type =
        amountMinor === Number(reservation.payment.amount_minor) ? 'payment.refunded' : 'payment.partially_refunded';
      await createPaymentEvent(tenantId, reservation.payment.id, type, {
        refundId: reservation.refund.id,
        amount: parsed.data.amount,
      });
    }
    await recordAudit(req, succeeded ? 'refund.succeeded' : 'refund.failed', {
      tenantId,
      resourceType: 'refund',
      resourceId: reservation.refund.id,
      metadata: { paymentId: reservation.payment.id, amountMinor },
    });
    res.status(succeeded ? 201 : 502).json(responseBody);
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Payment not found.' });
    next(err);
  }
});

export default router;

import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import { withTenant } from '../database/client.js';
import { decryptJson } from '../crypto.js';
import {
  createTimestampedWebhookSignature,
  isRetryableWebhookStatus,
  isSuccessfulWebhookStatus,
} from '../webhookDelivery.js';
import { validateWebhookUrl } from '../webhooks/urlSafety.js';

const fetchWithTimeout = async (url, options, timeout = 10_000, fetchImplementation = fetch) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImplementation(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
};

const readResponseBody = async (response, limit = 4096) => {
  if (!response.body) return '';
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    const remaining = limit - length;
    if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
    length += buffer.length;
    if (length >= limit) {
      response.body.destroy?.();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
};

export const processWebhookDelivery = async (
  job,
  { validateUrl = validateWebhookUrl, fetchImplementation = fetch } = {},
) => {
  const { tenantId, deliveryId } = job.data;
  const delivery = await withTenant(tenantId, async (db) => {
    const result = await db.query(
      `WITH claimed AS (
         UPDATE webhook_deliveries SET status = 'delivering', attempt_count = attempt_count + 1,
           attempt_started_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'failed')
           AND EXISTS (
             SELECT 1 FROM webhook_endpoints AS candidate
             WHERE candidate.id = webhook_deliveries.endpoint_id AND candidate.enabled = true
           )
         RETURNING *
       )
       SELECT claimed.id, endpoint.id AS endpoint_id, endpoint.url, endpoint.encrypted_secret,
              event.id AS event_id, event.type, event.created_at, event.data,
              payment.id AS payment_id, payment.external_order_id, payment.amount_minor,
              payment.currency, payment.status
       FROM claimed
       JOIN webhook_endpoints AS endpoint ON endpoint.id = claimed.endpoint_id
       JOIN payment_events AS event ON event.id = claimed.event_id
       LEFT JOIN payment_orders AS payment ON payment.id = event.payment_id
       WHERE endpoint.enabled = true`,
      [tenantId, deliveryId],
    );
    return result.rows[0];
  });
  if (!delivery) return;

  let endpoint;
  let secret;
  try {
    endpoint = await validateUrl(delivery.url);
    secret = decryptJson(delivery.encrypted_secret).secret;
  } catch (err) {
    await withTenant(tenantId, async (db) => {
      await db.query(
        `UPDATE webhook_deliveries SET status = 'failed', last_error = $2,
           next_attempt_at = now() + interval '1 minute', attempt_started_at = NULL
         WHERE id = $1`,
        [deliveryId, err.message],
      );
      await db.query(
        `UPDATE webhook_endpoints SET failure_count = failure_count + 1,
           enabled = CASE WHEN failure_count + 1 >= 10 THEN false ELSE enabled END,
           updated_at = now() WHERE id = $1`,
        [delivery.endpoint_id],
      );
    });
    throw err;
  }
  const agent = endpoint.resolvedAddress
    ? new (endpoint.protocol === 'https:' ? https.Agent : http.Agent)({
        lookup: (_hostname, _options, callback) =>
          callback(null, endpoint.resolvedAddress, endpoint.resolvedFamily),
      })
    : undefined;
  const payload = {
    id: delivery.event_id,
    type: delivery.type,
    createdAt: delivery.created_at,
    data: {
      paymentId: delivery.payment_id,
      externalOrderId: delivery.external_order_id,
      amount: Number(delivery.amount_minor) / 100,
      currency: delivery.currency,
      status: delivery.status,
      ...delivery.data,
    },
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const started = Date.now();

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Kaspi-Automation-Webhooks/1.0',
          'X-Webhook-Id': delivery.event_id,
          'X-Webhook-Delivery': delivery.id,
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature': createTimestampedWebhookSignature(timestamp, body, secret),
        },
        agent,
        body,
      },
      10_000,
      fetchImplementation,
    );
    const responseBody = await readResponseBody(response);
    if (isSuccessfulWebhookStatus(response.status)) {
      await withTenant(tenantId, (db) =>
        Promise.all([
          db.query(
            `UPDATE webhook_deliveries SET status = 'succeeded', response_status = $2,
               response_body = $3, response_duration_ms = $4, delivered_at = now(), last_error = NULL,
               attempt_started_at = NULL
             WHERE id = $1`,
            [deliveryId, response.status, responseBody, Date.now() - started],
          ),
          db.query('UPDATE webhook_endpoints SET failure_count = 0, updated_at = now() WHERE id = $1', [
            delivery.endpoint_id,
          ]),
        ]),
      );
      return;
    }

    const retryable = isRetryableWebhookStatus(response.status);
    await withTenant(tenantId, (db) =>
      Promise.all([
        db.query(
          `UPDATE webhook_deliveries SET status = $2, response_status = $3,
             response_body = $4, response_duration_ms = $5, last_error = $6,
             next_attempt_at = CASE WHEN $2 = 'failed' THEN now() + interval '1 minute' ELSE NULL END,
             attempt_started_at = NULL
           WHERE id = $1`,
          [
            deliveryId,
            retryable ? 'failed' : 'dead',
            response.status,
            responseBody,
            Date.now() - started,
            `HTTP ${response.status}`,
          ],
        ),
        db.query(
          `UPDATE webhook_endpoints SET failure_count = failure_count + 1,
             enabled = CASE WHEN failure_count + 1 >= 10 THEN false ELSE enabled END,
             updated_at = now() WHERE id = $1`,
          [delivery.endpoint_id],
        ),
      ]),
    );
    if (retryable) {
      const error = new Error(`Webhook returned retryable HTTP ${response.status}`);
      error.deliveryRecorded = true;
      throw error;
    }
  } catch (err) {
    await withTenant(tenantId, async (db) => {
      await db.query(
        `UPDATE webhook_deliveries SET status = 'failed', last_error = $2,
           response_duration_ms = $3, next_attempt_at = now() + interval '1 minute',
           attempt_started_at = NULL
         WHERE id = $1 AND status <> 'dead'`,
        [deliveryId, err.message, Date.now() - started],
      );
      if (!err.deliveryRecorded) {
        await db.query(
          `UPDATE webhook_endpoints SET failure_count = failure_count + 1,
             enabled = CASE WHEN failure_count + 1 >= 10 THEN false ELSE enabled END,
             updated_at = now() WHERE id = $1`,
          [delivery.endpoint_id],
        );
      }
    });
    throw err;
  }
};

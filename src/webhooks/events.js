import { withTenant } from '../database/client.js';
import { enqueueWebhookDelivery } from '../queue/client.js';

export const createPaymentEvent = async (tenantId, paymentId, type, data = {}) => {
  const deliveries = await withTenant(tenantId, async (db) => {
    const event = await db.query(
      'INSERT INTO payment_events (tenant_id, payment_id, type, data) VALUES ($1, $2, $3, $4) RETURNING id',
      [tenantId, paymentId, type, data],
    );
    const endpoints = await db.query(
      `SELECT DISTINCT endpoint.id
       FROM webhook_endpoints AS endpoint
       LEFT JOIN api_keys AS key ON key.id = endpoint.api_key_id
       LEFT JOIN payment_orders AS payment ON payment.id = $3
       WHERE endpoint.tenant_id = $1 AND endpoint.enabled = true AND $2 = ANY(endpoint.events)
         AND (
           endpoint.api_key_id IS NULL
           OR endpoint.api_key_id = payment.created_by_api_key_id
           OR (key.is_default = true AND key.enabled = true AND key.revoked_at IS NULL)
         )`,
      [tenantId, type, paymentId],
    );
    const created = [];
    for (const endpoint of endpoints.rows) {
      const delivery = await db.query(
        `INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event_id, next_attempt_at)
         VALUES ($1, $2, $3, now()) ON CONFLICT (endpoint_id, event_id) DO NOTHING RETURNING id`,
        [tenantId, endpoint.id, event.rows[0].id],
      );
      if (delivery.rows[0]) created.push(delivery.rows[0].id);
    }
    return created;
  });
  await Promise.allSettled(deliveries.map((id) => enqueueWebhookDelivery(tenantId, id)));
};

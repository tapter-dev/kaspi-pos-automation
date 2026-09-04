import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_MIGRATION_URL);

describe('durable workers', { skip: !enabled }, async () => {
  const { createPool, withTenant, closePool } = await import('../src/database/client.js');
  const { encryptJson, encryptSecret } = await import('../src/crypto.js');
  const { processPaymentStatus } = await import('../src/workers/paymentStatus.js');
  const { processWebhookDelivery } = await import('../src/workers/webhookDelivery.js');
  const { createTimestampedWebhookSignature } = await import('../src/webhookDelivery.js');
  const admin = createPool(process.env.DATABASE_MIGRATION_URL);
  const suffix = crypto.randomUUID().slice(0, 8);
  const secret = 'whsec_worker-integration-secret';
  let tenantId;
  let paymentId;
  let endpointId;
  let deliveryId;
  let receiver;
  let received;

  before(async () => {
    tenantId = (
      await admin.query('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id', [
        `worker-${suffix}`,
        'Worker Integration',
      ])
    ).rows[0].id;
    await withTenant(tenantId, async (db) => {
      await db.query(
        `INSERT INTO kaspi_connections (tenant_id, state, encrypted_credentials, key_version)
         VALUES ($1, 'active', $2, 'local-v1')`,
        [
          tenantId,
          encryptJson({ tokenSN: 'WORKER-TEST', vtokenSecret: encryptSecret(Buffer.alloc(32, 9)), profileId: '1' }),
        ],
      );
      paymentId = (
        await db.query(
          `INSERT INTO payment_orders
             (tenant_id, method, amount_minor, status, provider_operation_id, external_order_id)
           VALUES ($1, 'qr', 4250, 'pending', '12345', $2) RETURNING id`,
          [tenantId, `WORKER-${suffix}`],
        )
      ).rows[0].id;
    });
  });

  after(async () => {
    if (receiver) await new Promise((resolve) => receiver.close(resolve));
    if (tenantId) {
      await admin.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantId]);
      await admin.query('DELETE FROM webhook_deliveries WHERE tenant_id = $1', [tenantId]);
      await admin.query('DELETE FROM webhook_endpoints WHERE tenant_id = $1', [tenantId]);
      await admin.query('DELETE FROM payment_events WHERE tenant_id = $1', [tenantId]);
      await admin.query('DELETE FROM payment_orders WHERE tenant_id = $1', [tenantId]);
      await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
    await admin.end();
    await closePool();
  });

  it('moves a payment to paid exactly once and records its event', async () => {
    await processPaymentStatus(
      { data: { tenantId, paymentId } },
      { getStatus: async () => ({ Data: { Status: 'Paid', StatusDesc: 'Paid in test' } }) },
    );
    await processPaymentStatus(
      { data: { tenantId, paymentId } },
      { getStatus: async () => assert.fail('A final payment must not be polled again.') },
    );
    const state = await withTenant(tenantId, async (db) => {
      const payment = await db.query('SELECT status, paid_at FROM payment_orders WHERE id = $1', [paymentId]);
      const events = await db.query("SELECT count(*)::int AS count FROM payment_events WHERE payment_id = $1 AND type = 'payment.paid'", [
        paymentId,
      ]);
      return { payment: payment.rows[0], count: events.rows[0].count };
    });
    assert.equal(state.payment.status, 'paid');
    assert.ok(state.payment.paid_at);
    assert.equal(state.count, 1);
  });

  it('delivers a signed webhook and persists the acknowledgement', async () => {
    receiver = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        received = { headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
        response.statusCode = 204;
        response.end();
      });
    });
    await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${receiver.address().port}/events`;
    await withTenant(tenantId, async (db) => {
      endpointId = (
        await db.query(
          `INSERT INTO webhook_endpoints (tenant_id, url, encrypted_secret, key_version, events)
           VALUES ($1, $2, $3, 'local-v1', ARRAY['payment.paid']) RETURNING id`,
          [tenantId, url, encryptJson({ secret })],
        )
      ).rows[0].id;
      const eventId = (
        await db.query(
          `INSERT INTO payment_events (tenant_id, payment_id, type, data)
           VALUES ($1, $2, 'payment.paid', '{"source":"worker-test"}') RETURNING id`,
          [tenantId, paymentId],
        )
      ).rows[0].id;
      deliveryId = (
        await db.query(
          `INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event_id, next_attempt_at)
           VALUES ($1, $2, $3, now()) RETURNING id`,
          [tenantId, endpointId, eventId],
        )
      ).rows[0].id;
    });

    await processWebhookDelivery(
      { data: { tenantId, deliveryId } },
      { validateUrl: async (candidate) => candidate },
    );
    assert.ok(received);
    assert.equal(
      received.headers['x-webhook-signature'],
      createTimestampedWebhookSignature(received.headers['x-webhook-timestamp'], received.body, secret),
    );
    assert.equal(JSON.parse(received.body).type, 'payment.paid');
    const delivery = await withTenant(tenantId, async (db) => {
      const result = await db.query('SELECT status, response_status, attempt_count FROM webhook_deliveries WHERE id = $1', [
        deliveryId,
      ]);
      return result.rows[0];
    });
    assert.equal(delivery.status, 'succeeded');
    assert.equal(delivery.response_status, 204);
    assert.equal(delivery.attempt_count, 1);
  });

  it('marks unresolved payments unknown when Kaspi displaces the session', async () => {
    const displacedPaymentId = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        `INSERT INTO payment_orders (tenant_id, method, amount_minor, status, provider_operation_id)
         VALUES ($1, 'qr', 1000, 'pending', 'displaced-operation') RETURNING id`,
        [tenantId],
      );
      return result.rows[0].id;
    });
    await processPaymentStatus(
      { data: { tenantId, paymentId: displacedPaymentId } },
      { getStatus: async () => ({ StatusCode: -101001 }) },
    );
    const state = await withTenant(tenantId, async (db) => {
      const payment = await db.query('SELECT status FROM payment_orders WHERE id = $1', [displacedPaymentId]);
      const connection = await db.query('SELECT state FROM kaspi_connections WHERE tenant_id = $1', [tenantId]);
      return { payment: payment.rows[0].status, connection: connection.rows[0].state };
    });
    assert.deepEqual(state, { payment: 'unknown', connection: 'displaced' });
  });
});

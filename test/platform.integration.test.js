import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_MIGRATION_URL);

describe('multi-tenant platform flow', { skip: !enabled }, () => {
  it('registers a dashboard tenant, stores Kaspi credentials, creates a payment, and authenticates an API key', async () => {
    const fakeKaspi = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          StatusCode: 0,
          Data: {
            QrOperationId: 987654,
            Status: 'QrTokenCreated',
            QrToken: 'https://qr.kaspi.kz/test-token',
            Amount: 1250,
            ExpireDate: new Date(Date.now() + 180_000).toISOString(),
          },
        }),
      );
    });
    await new Promise((resolve) => fakeKaspi.listen(0, '127.0.0.1', resolve));
    process.env.KASPI_QRPAY_URL = `http://127.0.0.1:${fakeKaspi.address().port}`;
    process.env.API_KEY_PEPPER ||= 'b'.repeat(32);
    process.env.DASHBOARD_SESSION_SECRET ||= 'c'.repeat(32);
    process.env.TOKEN_SECRET_KEY ||= 'a'.repeat(64);

    const [{ createApp }, { encryptSecret }, { createPool, withTenant }, { closePool }, { closeQueues }] = await Promise.all([
      import('../src/app.js'),
      import('../src/crypto.js'),
      import('../src/database/client.js'),
      import('../src/database/client.js'),
      import('../src/queue/client.js'),
    ]);
    const appServer = http.createServer(createApp());
    await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${appServer.address().port}`;
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `owner-${suffix}@example.test`;
    const slug = `business-${suffix}`;
    let tenantId;
    let userId;

    try {
      const root = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(root.status, 302);
      assert.equal(root.headers.get('location'), '/dashboard');
      const legacy = await fetch(`${base}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenSN: 'should-not-be-accepted' }),
      });
      assert.equal(legacy.status, 404);

      const register = await fetch(`${base}/api/dashboard/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName: 'Test Owner',
          password: 'correct horse battery staple',
          tenantName: 'Integration Business',
          tenantSlug: slug,
        }),
      });
      assert.equal(register.status, 201);
      const registered = await register.json();
      tenantId = registered.data.tenantId;
      userId = registered.data.userId;
      const cookie = register.headers.get('set-cookie').split(';')[0];

      const liveMode = await fetch(`${base}/api/dashboard/data/organization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ workMode: 'live' }),
      });
      assert.equal(liveMode.status, 200);

      const connection = await fetch(`${base}/api/dashboard/kaspi/connection`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          tokenSN: 'TEST-TOKEN-SN',
          vtokenSecret: encryptSecret(Buffer.alloc(32, 7)),
          profileId: '42',
          organizationId: '84',
          orgName: 'Integration Business',
        }),
      });
      assert.equal(connection.status, 200);

      const paymentBody = { method: 'qr', amount: 1250, currency: 'KZT', externalOrderId: `ORDER-${suffix}` };
      const payment = await fetch(`${base}/api/dashboard/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': `idem-${suffix}` },
        body: JSON.stringify(paymentBody),
      });
      assert.equal(payment.status, 201);
      const createdPayment = await payment.json();
      assert.equal(createdPayment.data.status, 'requires_customer_action');
      assert.equal(createdPayment.data.qrOriginalToken, 'https://qr.kaspi.kz/test-token');

      const replay = await fetch(`${base}/api/dashboard/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': `idem-${suffix}` },
        body: JSON.stringify(paymentBody),
      });
      assert.equal(replay.status, 201);
      assert.equal((await replay.json()).data.id, createdPayment.data.id);

      const invoice = await fetch(`${base}/api/dashboard/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': `invoice-${suffix}` },
        body: JSON.stringify({
          method: 'invoice',
          amount: 500,
          currency: 'KZT',
          externalOrderId: `INVOICE-${suffix}`,
          customerPhone: '77001234567',
        }),
      });
      assert.equal(invoice.status, 201);
      const createdInvoice = await invoice.json();
      assert.equal(createdInvoice.data.status, 'pending');
      const cancellation = await fetch(`${base}/api/dashboard/payments/${createdInvoice.data.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}',
      });
      assert.equal(cancellation.status, 200);
      assert.equal((await cancellation.json()).data.status, 'cancelled');

      await withTenant(tenantId, (db) =>
        db.query("UPDATE payment_orders SET status = 'paid', paid_at = now() WHERE id = $1", [createdPayment.data.id]),
      );
      const refundHeaders = {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'Idempotency-Key': `refund-${suffix}`,
      };
      const refund = await fetch(`${base}/api/dashboard/payments/${createdPayment.data.id}/refunds`, {
        method: 'POST',
        headers: refundHeaders,
        body: JSON.stringify({ amount: 250 }),
      });
      assert.equal(refund.status, 201);
      assert.equal((await refund.json()).data.status, 'succeeded');
      const refundReplay = await fetch(`${base}/api/dashboard/payments/${createdPayment.data.id}/refunds`, {
        method: 'POST',
        headers: refundHeaders,
        body: JSON.stringify({ amount: 250 }),
      });
      assert.equal(refundReplay.status, 201);
      const excessiveRefund = await fetch(`${base}/api/dashboard/payments/${createdPayment.data.id}/refunds`, {
        method: 'POST',
        headers: { ...refundHeaders, 'Idempotency-Key': `refund-excess-${suffix}` },
        body: JSON.stringify({ amount: 2000 }),
      });
      assert.equal(excessiveRefund.status, 409);
      const concurrentRefunds = await Promise.all(
        ['a', 'b'].map((label) =>
          fetch(`${base}/api/dashboard/payments/${createdPayment.data.id}/refunds`, {
            method: 'POST',
            headers: { ...refundHeaders, 'Idempotency-Key': `refund-concurrent-${label}-${suffix}` },
            body: JSON.stringify({ amount: 1000 }),
          }),
        ),
      );
      assert.deepEqual(
        concurrentRefunds.map((response) => response.status).sort(),
        [201, 409],
      );
      const refundHistory = await fetch(`${base}/api/dashboard/data/refunds`, { headers: { Cookie: cookie } });
      assert.equal(refundHistory.status, 200);
      const refundRows = (await refundHistory.json()).data;
      assert.ok(refundRows.some((row) => row.payment_id === createdPayment.data.id && Number(row.amount_minor) === 25_000));

      await withTenant(tenantId, (db) =>
        db.query("UPDATE kaspi_connections SET state = 'disabled' WHERE tenant_id = $1", [tenantId]),
      );
      const testMode = await fetch(`${base}/api/dashboard/data/organization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ workMode: 'test' }),
      });
      assert.equal(testMode.status, 200);
      assert.equal((await testMode.json()).data.work_mode, 'test');

      const sandboxPayment = await fetch(`${base}/api/dashboard/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': `sandbox-${suffix}` },
        body: JSON.stringify({ method: 'qr', amount: 700, externalOrderId: `SANDBOX-${suffix}` }),
      });
      assert.equal(sandboxPayment.status, 201);
      const sandboxData = (await sandboxPayment.json()).data;
      assert.equal(sandboxData.isSandbox, true);
      const simulated = await fetch(`${base}/api/dashboard/payments/${sandboxData.id}/simulate-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ status: 'paid' }),
      });
      assert.equal(simulated.status, 200);
      assert.equal((await simulated.json()).data.status, 'paid');

      const printable = await fetch(`${base}/api/dashboard/printable-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ amount: 900, description: 'Printed order', singleUse: true }),
      });
      assert.equal(printable.status, 201);
      const printableData = (await printable.json()).data;
      const publicRequest = await fetch(`${base}/api/public/payment-requests/${printableData.shortCode}`);
      assert.equal(publicRequest.status, 200);
      assert.equal((await publicRequest.json()).data.amount, 900);
      const publicPayment = await fetch(`${base}/api/public/payment-requests/${printableData.shortCode}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(publicPayment.status, 201);
      assert.match((await publicPayment.json()).data.paymentUrl, /\/sandbox\//);

      const recurring = await fetch(`${base}/api/dashboard/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          customerName: 'Monthly customer',
          customerPhone: '77001234567',
          amount: 1100,
          billingPeriod: 'monthly',
          billingDay: 5,
          billingTime: '09:00',
          firstPaymentAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      });
      assert.equal(recurring.status, 201);
      assert.equal((await recurring.json()).data.status, 'active');

      const disconnectedPaymentReplay = await fetch(`${base}/api/dashboard/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': `idem-${suffix}` },
        body: JSON.stringify(paymentBody),
      });
      assert.equal(disconnectedPaymentReplay.status, 201);
      assert.equal((await disconnectedPaymentReplay.json()).data.id, createdPayment.data.id);
      const disconnectedRefundReplay = await fetch(`${base}/api/dashboard/payments/${createdPayment.data.id}/refunds`, {
        method: 'POST',
        headers: refundHeaders,
        body: JSON.stringify({ amount: 250 }),
      });
      assert.equal(disconnectedRefundReplay.status, 201);

      const keyResponse = await fetch(`${base}/api/dashboard/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'Integration key', environment: 'test', scopes: ['payments:read'] }),
      });
      assert.equal(keyResponse.status, 201);
      const createdKey = (await keyResponse.json()).data;
      const apiKey = createdKey.apiKey;
      assert.equal(createdKey.is_default, true);
      const account = await fetch(`${base}/api/v1/account`, { headers: { Authorization: `Bearer ${apiKey}` } });
      assert.equal(account.status, 200);
      assert.equal((await account.json()).data.id, tenantId);
      const forbiddenWrite = await fetch(`${base}/api/v1/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `forbidden-${suffix}`,
        },
        body: JSON.stringify({ method: 'qr', amount: 100 }),
      });
      assert.equal(forbiddenWrite.status, 403);

      const rotateKey = await fetch(`${base}/api/dashboard/api-keys/${createdKey.id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}',
      });
      assert.equal(rotateKey.status, 200);
      const rotatedApiKey = (await rotateKey.json()).data.apiKey;
      const oldKeyAfterRotation = await fetch(`${base}/api/v1/account`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      assert.equal(oldKeyAfterRotation.status, 401);
      const newKeyAfterRotation = await fetch(`${base}/api/v1/account`, {
        headers: { Authorization: `Bearer ${rotatedApiKey}` },
      });
      assert.equal(newKeyAfterRotation.status, 200);

      const billing = await fetch(`${base}/api/dashboard/billing`, { headers: { Cookie: cookie } });
      assert.equal(billing.status, 200);
      const billingData = (await billing.json()).data;
      assert.equal(billingData.subscription.plan_code, 'beta');
      assert.ok(billingData.plans.some((plan) => plan.code === 'growth'));
      const planRequest = await fetch(`${base}/api/dashboard/billing/plan-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ planCode: 'growth' }),
      });
      assert.equal(planRequest.status, 201);

      const partner = await fetch(`${base}/api/dashboard/billing/partner`, { headers: { Cookie: cookie } });
      assert.equal(partner.status, 200);
      assert.match((await partner.json()).data.referralUrl, /\?ref=[A-Z0-9]{8}$/);

      const accessGrant = await fetch(`${base}/api/dashboard/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ label: 'Integration accountant', role: 'viewer', expiresInDays: 1 }),
      });
      assert.equal(accessGrant.status, 201);
      assert.match((await accessGrant.json()).data.code, /^KPA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      const accessList = await fetch(`${base}/api/dashboard/access`, { headers: { Cookie: cookie } });
      assert.equal(accessList.status, 200);
      assert.equal((await accessList.json()).data[0].label, 'Integration accountant');

      const team = await fetch(`${base}/api/dashboard/team`, { headers: { Cookie: cookie } });
      assert.equal(team.status, 200);
      assert.equal((await team.json()).data[0].role, 'owner');
    } finally {
      await new Promise((resolve) => appServer.close(resolve));
      await new Promise((resolve) => fakeKaspi.close(resolve));
      await closeQueues();
      await closePool();
      if (tenantId && userId) {
        const admin = createPool(process.env.DATABASE_MIGRATION_URL);
        await admin.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantId]);
        await admin.query('DELETE FROM refunds WHERE tenant_id = $1', [tenantId]);
        await admin.query('DELETE FROM payment_orders WHERE tenant_id = $1', [tenantId]);
        await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        await admin.query('DELETE FROM users WHERE id = $1', [userId]);
        await admin.end();
      }
    }
  });
});

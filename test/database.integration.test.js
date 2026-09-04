import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_MIGRATION_URL);

describe('database tenant isolation', { skip: !enabled }, async () => {
  const { createPool, withTenant, closePool } = await import('../src/database/client.js');
  const admin = createPool(process.env.DATABASE_MIGRATION_URL);
  const suffix = crypto.randomUUID().slice(0, 8);
  let tenantA;
  let tenantB;

  after(async () => {
    if (tenantA && tenantB) {
      await admin.query('DELETE FROM payment_orders WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    }
    await admin.end();
    await closePool();
  });

  it('hides one tenant records from another tenant', async () => {
    tenantA = (
      await admin.query('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id', [`test-a-${suffix}`, 'A'])
    ).rows[0].id;
    tenantB = (
      await admin.query('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id', [`test-b-${suffix}`, 'B'])
    ).rows[0].id;
    await withTenant(tenantA, (db) =>
      db.query("INSERT INTO payment_orders (tenant_id, method, amount_minor) VALUES ($1, 'qr', 10000)", [tenantA]),
    );
    const visibleA = await withTenant(tenantA, (db) => db.query('SELECT count(*)::int AS count FROM payment_orders'));
    const visibleB = await withTenant(tenantB, (db) => db.query('SELECT count(*)::int AS count FROM payment_orders'));
    assert.equal(visibleA.rows[0].count, 1);
    assert.equal(visibleB.rows[0].count, 0);
  });
});

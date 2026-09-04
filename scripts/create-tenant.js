import { createPool } from '../src/database/client.js';
import { generateApiKey } from '../src/security/apiKeys.js';

const [, , slug, ...nameParts] = process.argv;
const name = nameParts.join(' ').trim();

if (!slug || !name) {
  console.error('Usage: npm run tenant:create -- <slug> <business name>');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
  console.error('Slug must contain 2-63 lowercase letters, digits, or hyphens.');
  process.exit(1);
}
if (!process.env.API_KEY_PEPPER || process.env.API_KEY_PEPPER.length < 32) {
  console.error('API_KEY_PEPPER must contain at least 32 characters when creating API keys.');
  process.exit(1);
}

if (!process.env.DATABASE_MIGRATION_URL) {
  console.error('DATABASE_MIGRATION_URL is required for tenant provisioning.');
  process.exit(1);
}
const pool = createPool(process.env.DATABASE_MIGRATION_URL);
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const tenant = await client.query('INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id, slug, name', [
    slug,
    name,
  ]);
  const generated = generateApiKey('live');
  await client.query(
    `INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes)
     VALUES ($1, 'Initial API key', $2, $3, $4)`,
    [tenant.rows[0].id, generated.prefix, generated.hash, ['payments:read', 'payments:write']],
  );
  await client.query('COMMIT');

  console.log(`Created tenant ${tenant.rows[0].name} (${tenant.rows[0].id})`);
  console.log('Store this API key now; it will not be shown again:');
  console.log(generated.apiKey);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Tenant creation failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

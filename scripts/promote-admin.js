import { createPool } from '../src/database/client.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run admin:promote -- <email>');
  process.exit(1);
}

if (!process.env.DATABASE_MIGRATION_URL) {
  console.error('DATABASE_MIGRATION_URL is required for platform administration.');
  process.exit(1);
}
const pool = createPool(process.env.DATABASE_MIGRATION_URL);
try {
  const result = await pool.query(
    'UPDATE users SET is_platform_admin = true, updated_at = now() WHERE email = $1 RETURNING id, email',
    [email],
  );
  if (!result.rowCount) throw new Error('User not found. Register the dashboard account first.');
  console.log(`Promoted ${result.rows[0].email} to platform administrator.`);
} catch (err) {
  console.error('Admin promotion failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

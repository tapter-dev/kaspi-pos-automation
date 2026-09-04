import pg from 'pg';

const { Pool } = pg;

let pool;

export const createPool = (connectionString = process.env.DATABASE_URL) => {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for database-backed features.');
  }

  const createdPool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  createdPool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err));
  return createdPool;
};

export const getPool = () => {
  if (!pool) pool = createPool();
  return pool;
};

export const withTransaction = async (callback) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const withTenant = async (tenantId, callback) =>
  withTransaction(async (client) => {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return callback(client);
  });

export const closePool = async () => {
  if (!pool) return;
  await pool.end();
  pool = undefined;
};

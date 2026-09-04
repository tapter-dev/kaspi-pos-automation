import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool } from '../src/database/client.js';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(scriptsDir, '..', 'migrations');

const configureRuntimeRole = async (client) => {
  const password = process.env.DATABASE_RUNTIME_PASSWORD;
  if (!password) return;
  if (password.length < 24) throw new Error('DATABASE_RUNTIME_PASSWORD must contain at least 24 characters.');

  await client.query(`
    DO $role$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kaspi_app') THEN
        CREATE ROLE kaspi_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
    END
    $role$
  `);
  const escaped = await client.query('SELECT quote_literal($1) AS value', [password]);
  await client.query(`ALTER ROLE kaspi_app PASSWORD ${escaped.rows[0].value}`);
};

const migrate = async () => {
  if (!process.env.DATABASE_MIGRATION_URL) {
    throw new Error('DATABASE_MIGRATION_URL is required; migrations must not run with the runtime role.');
  }
  const pool = createPool(process.env.DATABASE_MIGRATION_URL);
  const client = await pool.connect();

  try {
    await configureRuntimeRole(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    for (const name of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (applied.rowCount > 0) continue;

      const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
};

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
});

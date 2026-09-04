import { decryptJson, decryptSecret, encryptJson } from '../crypto.js';
import { withTenant } from '../database/client.js';

export const validateKaspiCredentials = (credentials) => {
  if (!credentials?.tokenSN || !credentials?.vtokenSecret) {
    throw new Error('Kaspi tokenSN and vtokenSecret are required.');
  }
  decryptSecret(credentials.vtokenSecret);
  return credentials;
};

export const saveKaspiConnection = async (tenantId, credentials, metadata = {}) => {
  validateKaspiCredentials(credentials);
  return withTenant(tenantId, async (db) => {
    const result = await db.query(
      `INSERT INTO kaspi_connections
        (tenant_id, state, encrypted_credentials, key_version, profile_id, organization_id,
         organization_name, cashier_phone_masked, last_verified_at, metadata)
       VALUES ($1, 'active', $2, 'local-v1', $3, $4, $5, $6, now(), $7)
       ON CONFLICT (tenant_id) DO UPDATE SET
         state = 'active', encrypted_credentials = EXCLUDED.encrypted_credentials,
         key_version = EXCLUDED.key_version, profile_id = EXCLUDED.profile_id,
         organization_id = EXCLUDED.organization_id,
         organization_name = EXCLUDED.organization_name,
         cashier_phone_masked = EXCLUDED.cashier_phone_masked,
         last_verified_at = now(), last_error = NULL, metadata = EXCLUDED.metadata,
         updated_at = now()
       RETURNING id, state, profile_id, organization_id, organization_name,
                 cashier_phone_masked, last_verified_at, created_at, updated_at`,
      [
        tenantId,
        encryptJson(credentials),
        credentials.profileId || null,
        credentials.organizationId || null,
        credentials.orgName || null,
        metadata.phoneMasked || null,
        metadata,
      ],
    );
    return result.rows[0];
  });
};

export const getKaspiConnection = async (tenantId, { includeCredentials = false } = {}) =>
  withTenant(tenantId, async (db) => {
    const result = await db.query(
      `SELECT id, state, encrypted_credentials, profile_id, organization_id,
              organization_name, cashier_phone_masked, last_verified_at, last_error,
              created_at, updated_at
       FROM kaspi_connections WHERE tenant_id = $1`,
      [tenantId],
    );
    const connection = result.rows[0] || null;
    if (connection && includeCredentials) {
      connection.credentials = decryptJson(connection.encrypted_credentials);
    }
    if (connection) delete connection.encrypted_credentials;
    return connection;
  });

export const disableKaspiConnection = async (tenantId) =>
  withTenant(tenantId, async (db) => {
    await db.query(
      `UPDATE kaspi_connections
       SET state = 'disabled', encrypted_credentials = NULL, updated_at = now()
       WHERE tenant_id = $1`,
      [tenantId],
    );
  });

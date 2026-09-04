import { getPool } from '../database/client.js';
import { hashApiKey } from '../security/apiKeys.js';

const extractBearerToken = (authorization) => {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization || '');
  return match?.[1] || null;
};

export const createApiKeyAuth =
  ({ pool, pepper = process.env.API_KEY_PEPPER || '' } = {}) =>
  async (req, res, next) => {
    const apiKey = extractBearerToken(req.headers.authorization);
    if (!apiKey?.startsWith('kpa_')) {
      return res.status(401).json({ error: 'A valid Bearer API key is required.' });
    }

    try {
      const database = pool || getPool();
      const result = await database.query(
        'SELECT api_key_id, authenticated_tenant_id, scopes, api_key_environment FROM authenticate_api_key($1)',
        [hashApiKey(apiKey, pepper)],
      );
      const authenticated = result.rows[0];
      if (!authenticated) return res.status(401).json({ error: 'Invalid or expired API key.' });

      req.auth = {
        type: 'api_key',
        apiKeyId: authenticated.api_key_id,
        keyEnvironment: authenticated.api_key_environment,
        tenantId: authenticated.authenticated_tenant_id,
        scopes: authenticated.scopes || [],
      };
      next();
    } catch (err) {
      next(err);
    }
  };

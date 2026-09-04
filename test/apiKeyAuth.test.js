import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiKeyAuth } from '../src/middleware/apiKeyAuth.js';
import { hashApiKey } from '../src/security/apiKeys.js';

const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

describe('API key authentication middleware', () => {
  it('rejects requests without a bearer key', async () => {
    const middleware = createApiKeyAuth({ pool: { query: async () => assert.fail('should not query') } });
    const res = response();
    await middleware({ headers: {} }, res, () => assert.fail('should not continue'));
    assert.equal(res.statusCode, 401);
  });

  it('attaches tenant identity returned by the database function', async () => {
    const rawKey = 'kpa_test_0123456789_example';
    const pool = {
      query: async (_sql, params) => {
        assert.equal(params[0], hashApiKey(rawKey, 'pepper'));
        return {
          rows: [{ api_key_id: 'key-id', authenticated_tenant_id: 'tenant-id', scopes: ['payments:read'], api_key_environment: 'test' }],
        };
      },
    };
    const middleware = createApiKeyAuth({ pool, pepper: 'pepper' });
    const req = { headers: { authorization: `Bearer ${rawKey}` } };
    let continued = false;
    await middleware(req, response(), () => {
      continued = true;
    });
    assert.equal(continued, true);
    assert.deepEqual(req.auth, {
      type: 'api_key',
      apiKeyId: 'key-id',
      keyEnvironment: 'test',
      tenantId: 'tenant-id',
      scopes: ['payments:read'],
    });
  });
});

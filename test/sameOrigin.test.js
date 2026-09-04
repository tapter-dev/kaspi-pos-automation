import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireSameOrigin } from '../src/middleware/sameOrigin.js';

const call = (headers, method = 'POST') => {
  let response;
  let continued = false;
  const req = { headers, method, protocol: 'https', get: () => 'app.example.test' };
  const res = {
    status(code) {
      response = { code };
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };
  requireSameOrigin(req, res, () => {
    continued = true;
  });
  return { response, continued };
};

describe('dashboard same-origin protection', () => {
  it('rejects cross-site browser mutations without an Origin header', () => {
    assert.equal(call({ 'sec-fetch-site': 'cross-site' }).response.code, 403);
  });

  it('accepts the configured origin and same-origin non-browser requests', () => {
    assert.equal(call({ origin: 'https://app.example.test' }).continued, true);
    assert.equal(call({}).continued, true);
  });
});

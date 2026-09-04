import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateApiKey, hashApiKey, verifyApiKeyHash } from '../src/security/apiKeys.js';

describe('API keys', () => {
  it('generates a key that is only recoverable at creation time', () => {
    const generated = generateApiKey('test', 'pepper');
    assert.match(generated.apiKey, /^kpa_test_[0-9a-f]{10}_[A-Za-z0-9_-]{43}$/);
    assert.ok(generated.apiKey.startsWith(`${generated.prefix}_`));
    assert.equal(generated.hash, hashApiKey(generated.apiKey, 'pepper'));
  });

  it('verifies a matching hash with a timing-safe comparison', () => {
    const generated = generateApiKey('live', 'pepper');
    assert.equal(verifyApiKeyHash(generated.apiKey, generated.hash, 'pepper'), true);
    assert.equal(verifyApiKeyHash(`${generated.apiKey}x`, generated.hash, 'pepper'), false);
  });

  it('rejects unknown environments', () => {
    assert.throws(() => generateApiKey('staging'), /live or test/);
  });
});

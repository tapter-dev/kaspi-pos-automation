import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTotp, createTotpUri, generateTotpSecret, verifyTotp } from '../src/security/totp.js';

describe('dashboard TOTP', () => {
  it('matches the RFC 6238 SHA-1 vector at 59 seconds', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(createTotp(secret, 59_000), '287082');
    assert.equal(verifyTotp(secret, '287082', 59_000), true);
    assert.equal(verifyTotp(secret, '000000', 59_000), false);
  });

  it('generates authenticator-compatible enrollment material', () => {
    const secret = generateTotpSecret();
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.match(createTotpUri({ secret, account: 'owner@example.test' }), /^otpauth:\/\/totp\//);
  });
});

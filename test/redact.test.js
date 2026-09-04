import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactForLog } from '../src/redact.js';

describe('log redaction', () => {
  it('redacts sensitive fields recursively without mutating the input', () => {
    const source = {
      headers: { Authorization: 'Bearer abc', 'X-Token-SN': 'token' },
      body: { otp: '1234', amount: 1000 },
    };
    const redacted = redactForLog(source);

    assert.deepEqual(redacted, {
      headers: { Authorization: '[REDACTED]', 'X-Token-SN': '[REDACTED]' },
      body: { otp: '[REDACTED]', amount: 1000 },
    });
    assert.equal(source.body.otp, '1234');
  });

  it('handles circular structures safely', () => {
    const source = { value: 'ok' };
    source.self = source;
    assert.deepEqual(redactForLog(source), { value: 'ok', self: '[Circular]' });
  });
});

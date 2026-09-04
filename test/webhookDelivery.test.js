import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimestampedWebhookSignature,
  createWebhookSignature,
  isRetryableWebhookStatus,
  isSuccessfulWebhookStatus,
} from '../src/webhookDelivery.js';

describe('webhook delivery helpers', () => {
  it('creates a deterministic HMAC signature', () => {
    assert.equal(
      createWebhookSignature('{"event":"payment.success"}', 'secret'),
      'sha256=085c2aeab688a891af58dbdd4498530c33675a1e8952cb44e03af1d9a1f39eba',
    );
  });

  it('binds timestamp and body in the production signature', () => {
    assert.notEqual(
      createTimestampedWebhookSignature('100', '{"ok":true}', 'secret'),
      createTimestampedWebhookSignature('101', '{"ok":true}', 'secret'),
    );
  });

  it('only treats 2xx responses as successful', () => {
    assert.equal(isSuccessfulWebhookStatus(200), true);
    assert.equal(isSuccessfulWebhookStatus(204), true);
    assert.equal(isSuccessfulWebhookStatus(302), false);
    assert.equal(isSuccessfulWebhookStatus(400), false);
    assert.equal(isSuccessfulWebhookStatus(500), false);
  });

  it('retries transient HTTP statuses', () => {
    assert.equal(isRetryableWebhookStatus(408), true);
    assert.equal(isRetryableWebhookStatus(429), true);
    assert.equal(isRetryableWebhookStatus(503), true);
    assert.equal(isRetryableWebhookStatus(400), false);
    assert.equal(isRetryableWebhookStatus(404), false);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFinalPaymentStatus, normalizePaymentStatus } from '../src/payments/status.js';

describe('payment status normalization', () => {
  it('maps provider final states', () => {
    assert.equal(normalizePaymentStatus('Processed'), 'paid');
    assert.equal(normalizePaymentStatus('QrTokenDiscarded'), 'expired');
    assert.equal(normalizePaymentStatus('CancelledByUser'), 'cancelled');
    assert.equal(normalizePaymentStatus('Rejected'), 'failed');
  });

  it('preserves pending state for unknown intermediate statuses', () => {
    assert.equal(normalizePaymentStatus('QrTokenScanned', 'pending'), 'pending');
    assert.equal(isFinalPaymentStatus('paid'), true);
    assert.equal(isFinalPaymentStatus('pending'), false);
  });

  it('stops polling after partial and full refunds', () => {
    assert.equal(isFinalPaymentStatus('partially_refunded'), true);
    assert.equal(isFinalPaymentStatus('refunded'), true);
  });
});

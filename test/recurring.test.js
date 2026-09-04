import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextRecurringAt } from '../src/payments/recurring.js';

describe('recurring schedule dates', () => {
  it('advances daily billing in Almaty local time', () => {
    const next = nextRecurringAt(new Date('2026-09-05T03:00:00.000Z'), 'daily', null, '09:00');
    assert.equal(next.toISOString(), '2026-09-06T03:00:00.000Z');
  });

  it('clamps monthly billing days to the target month', () => {
    const next = nextRecurringAt(new Date('2027-01-28T03:00:00.000Z'), 'monthly', 28, '09:00');
    assert.equal(next.toISOString(), '2027-02-28T03:00:00.000Z');
  });

  it('advances quarterly and yearly periods', () => {
    assert.equal(
      nextRecurringAt(new Date('2026-09-05T03:00:00.000Z'), 'quarterly', 5, '09:00').toISOString(),
      '2026-12-05T03:00:00.000Z',
    );
    assert.equal(
      nextRecurringAt(new Date('2026-09-05T03:00:00.000Z'), 'yearly', 5, '09:00').toISOString(),
      '2027-09-05T03:00:00.000Z',
    );
  });
});

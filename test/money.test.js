import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toMinorUnits } from '../src/payments/money.js';

describe('money conversion', () => {
  it('accepts ordinary decimal amounts despite binary floating-point representation', () => {
    assert.equal(toMinorUnits(0.29), 29);
    assert.equal(toMinorUnits(1250.5), 125050);
  });

  it('rejects fractional tiyn amounts', () => {
    assert.equal(toMinorUnits(1.005), null);
    assert.equal(toMinorUnits(Number.NaN), null);
  });
});

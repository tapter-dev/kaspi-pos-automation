import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../src/security/canonicalJson.js';

describe('canonical JSON', () => {
  it('produces the same value regardless of object key order', () => {
    assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

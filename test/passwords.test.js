import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/security/passwords.js';

describe('dashboard passwords', () => {
  it('hashes and verifies a password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    assert.match(encoded, /^scrypt\$/);
    assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
    assert.equal(await verifyPassword('incorrect password', encoded), false);
  });

  it('rejects short passwords', async () => {
    await assert.rejects(() => hashPassword('short'), /at least 12/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptySession, applyOrgContext } from '../src/session.js';

describe('Account Routes - Unit Tests', () => {
  describe('createEmptySession', () => {
    it('should include account-related fields', () => {
      const session = createEmptySession();
      assert.ok(Object.prototype.hasOwnProperty.call(session, 'organizationId'));
      assert.ok(Object.prototype.hasOwnProperty.call(session, 'organizationIdn'));
      assert.ok(Object.prototype.hasOwnProperty.call(session, 'organizationKbe'));
    });
  });

  describe('applyOrgContext', () => {
    it('should populate organization account fields from Current data', () => {
      const session = createEmptySession();
      const data = {
        Current: {
          OrganizationId: 'ORG123',
          OrganizationIdn: '123456789',
          OrganizationKbe: 'KBE001',
        },
      };
      applyOrgContext(session, data);
      assert.equal(session.organizationId, 'ORG123');
      assert.equal(session.organizationIdn, '123456789');
      assert.equal(session.organizationKbe, 'KBE001');
    });
  });
});

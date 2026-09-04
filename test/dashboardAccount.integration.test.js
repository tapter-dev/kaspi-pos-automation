import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_MIGRATION_URL);

describe('dashboard account lifecycle', { skip: !enabled }, () => {
  it('onboards an invited teammate and resets an owner password', async () => {
    process.env.API_KEY_PEPPER ||= 'b'.repeat(32);
    process.env.DASHBOARD_SESSION_SECRET ||= 'c'.repeat(32);
    process.env.TOKEN_SECRET_KEY ||= 'a'.repeat(64);
    const [{ createApp }, { createPool, closePool }, { createTotp }] = await Promise.all([
      import('../src/app.js'),
      import('../src/database/client.js'),
      import('../src/security/totp.js'),
    ]);
    const server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const suffix = crypto.randomUUID().slice(0, 8);
    const ownerEmail = `account-owner-${suffix}@example.test`;
    const teammateEmail = `account-team-${suffix}@example.test`;
    const originalPassword = 'original password long enough';
    const replacementPassword = 'replacement password long enough';
    let tenantId;
    const userIds = [];

    const request = async (path, { cookie, body, method = 'POST' } = {}) =>
      fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
        ...(body && { body: JSON.stringify(body) }),
      });

    try {
      const registration = await request('/api/dashboard/auth/register', {
        body: {
          email: ownerEmail,
          displayName: 'Account Owner',
          password: originalPassword,
          tenantName: 'Account Test',
          tenantSlug: `account-${suffix}`,
        },
      });
      assert.equal(registration.status, 201);
      const owner = await registration.json();
      tenantId = owner.data.tenantId;
      userIds.push(owner.data.userId);
      const ownerCookie = registration.headers.get('set-cookie').split(';')[0];

      const unverifiedStatus = await request('/api/dashboard/auth/mfa', { cookie: ownerCookie, method: 'GET' });
      assert.equal((await unverifiedStatus.json()).data.emailVerified, false);
      const verificationResponse = await request('/api/dashboard/auth/verification/send', {
        cookie: ownerCookie,
        body: {},
      });
      assert.equal(verificationResponse.status, 202);
      const verificationUrl = (await verificationResponse.json()).developmentVerificationUrl;
      assert.ok(verificationUrl);
      const verificationToken = new URL(verificationUrl).searchParams.get('verify');
      const verification = await request('/api/dashboard/auth/verification/confirm', {
        body: { token: verificationToken },
      });
      assert.equal(verification.status, 200);
      const verifiedStatus = await request('/api/dashboard/auth/mfa', { cookie: ownerCookie, method: 'GET' });
      assert.equal((await verifiedStatus.json()).data.emailVerified, true);

      const invitationResponse = await request('/api/dashboard/team/invitations', {
        cookie: ownerCookie,
        body: { email: teammateEmail, role: 'developer' },
      });
      assert.equal(invitationResponse.status, 201);
      const invitation = (await invitationResponse.json()).data;
      assert.ok(invitation.invitationToken);

      const teammateRegistration = await request('/api/dashboard/auth/register', {
        body: {
          email: teammateEmail,
          displayName: 'Invited Developer',
          password: 'teammate password long enough',
          invitationToken: invitation.invitationToken,
        },
      });
      assert.equal(teammateRegistration.status, 201);
      const teammate = await teammateRegistration.json();
      userIds.push(teammate.data.userId);
      assert.equal(teammate.data.tenantId, tenantId);
      assert.equal(teammate.data.role, 'developer');
      const teammateCookie = teammateRegistration.headers.get('set-cookie').split(';')[0];

      const mfaSetup = await request('/api/dashboard/auth/mfa/setup', { cookie: teammateCookie, body: {} });
      assert.equal(mfaSetup.status, 200);
      const mfaSecret = (await mfaSetup.json()).data.secret;
      const mfaEnable = await request('/api/dashboard/auth/mfa/enable', {
        cookie: teammateCookie,
        body: { code: createTotp(mfaSecret) },
      });
      assert.equal(mfaEnable.status, 200);
      const duplicateMfaSetup = await request('/api/dashboard/auth/mfa/setup', {
        cookie: teammateCookie,
        body: {},
      });
      assert.equal(duplicateMfaSetup.status, 409);
      const loginWithoutMfa = await request('/api/dashboard/auth/login', {
        body: { email: teammateEmail, password: 'teammate password long enough' },
      });
      assert.equal(loginWithoutMfa.status, 401);
      assert.equal((await loginWithoutMfa.json()).code, 'MFA_REQUIRED');
      const loginWithMfa = await request('/api/dashboard/auth/login', {
        body: { email: teammateEmail, password: 'teammate password long enough', totpCode: createTotp(mfaSecret) },
      });
      assert.equal(loginWithMfa.status, 200);

      const teamResponse = await request('/api/dashboard/team', { cookie: ownerCookie, method: 'GET' });
      assert.equal(teamResponse.status, 200);
      assert.equal((await teamResponse.json()).data.length, 2);

      const resetRequest = await request('/api/dashboard/auth/request-password-reset', {
        body: { email: ownerEmail },
      });
      assert.equal(resetRequest.status, 202);
      const resetUrl = (await resetRequest.json()).developmentResetUrl;
      assert.ok(resetUrl);
      const resetToken = new URL(resetUrl).searchParams.get('reset');
      const reset = await request('/api/dashboard/auth/reset-password', {
        body: { token: resetToken, password: replacementPassword },
      });
      assert.equal(reset.status, 200);

      const oldSession = await request('/api/dashboard/auth/me', { cookie: ownerCookie, method: 'GET' });
      assert.equal(oldSession.status, 401);
      const oldLogin = await request('/api/dashboard/auth/login', {
        body: { email: ownerEmail, password: originalPassword },
      });
      assert.equal(oldLogin.status, 401);
      const newLogin = await request('/api/dashboard/auth/login', {
        body: { email: ownerEmail, password: replacementPassword },
      });
      assert.equal(newLogin.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await closePool();
      if (tenantId) {
        const admin = createPool(process.env.DATABASE_MIGRATION_URL);
        await admin.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantId]);
        await admin.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
        await admin.end();
      }
    }
  });
});

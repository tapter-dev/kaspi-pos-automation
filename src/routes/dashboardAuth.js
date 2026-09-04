import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../database/client.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import {
  DASHBOARD_COOKIE,
  clearSessionCookieOptions,
  createSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from '../security/dashboardSessions.js';
import { createDashboardAuth } from '../middleware/dashboardAuth.js';
import { recordAudit } from '../audit.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../email.js';
import QRCode from 'qrcode';
import { decryptJson, encryptJson } from '../crypto.js';
import { createTotpUri, generateTotpSecret, verifyTotp } from '../security/totp.js';

const router = Router();
const dashboardAuth = createDashboardAuth();

const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    displayName: z.string().trim().min(1).max(200),
    password: z.string().min(12).max(200),
    tenantName: z.string().trim().min(1).max(200).optional(),
    tenantSlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
      .optional(),
    invitationToken: z.string().min(20).max(200).optional(),
    referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.invitationToken && (!value.tenantName || !value.tenantSlug)) {
      ctx.addIssue({ code: 'custom', message: 'Business name and slug are required.' });
    }
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

const setSession = async (req, res, userId, tenantId) => {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await getPool().query('SELECT create_dashboard_session($1, $2, $3, $4, $5, $6)', [
    userId,
    tenantId,
    hashSessionToken(token),
    req.ip,
    req.headers['user-agent'] || '',
    expiresAt,
  ]);
  res.cookie(DASHBOARD_COOKIE, token, sessionCookieOptions());
};

const appOrigin = (req) => process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;

const issueVerification = async (req, userId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const result = await getPool().query('SELECT * FROM issue_email_verification_token($1, $2, $3)', [
    userId,
    hashSessionToken(token),
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  ]);
  if (!result.rows[0]) return { sent: false, alreadyVerified: true };
  const verificationUrl = `${appOrigin(req)}/dashboard?verify=${encodeURIComponent(token)}`;
  const delivery = await sendVerificationEmail({
    to: result.rows[0].email,
    displayName: result.rows[0].display_name,
    verificationUrl,
  });
  return { ...delivery, verificationUrl };
};

router.post('/register', async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Invalid registration data.', details: parsed.error.issues });
  if (process.env.ALLOW_SIGNUPS === 'false' && !parsed.data.invitationToken) {
    return res.status(403).json({ error: 'Registration is disabled.' });
  }

  try {
    const input = parsed.data;
    const passwordHash = await hashPassword(input.password);
    const result = input.invitationToken
      ? await getPool().query('SELECT * FROM register_invited_dashboard_account($1, $2, $3, $4)', [
          input.email,
          input.displayName,
          passwordHash,
          hashSessionToken(input.invitationToken),
        ])
      : await getPool().query('SELECT * FROM register_dashboard_account($1, $2, $3, $4, $5)', [
          input.email,
          input.displayName,
          passwordHash,
          input.tenantSlug,
          input.tenantName,
        ]);
    const account = result.rows[0];
    if (!account) return res.status(400).json({ error: 'Invitation is invalid, expired, or for another email.' });
    if (!input.invitationToken && input.referralCode) {
      await getPool().query('SELECT register_partner_referral($1, $2)', [input.referralCode, account.tenant_id]);
    }
    await setSession(req, res, account.user_id, account.tenant_id);
    await recordAudit(req, input.invitationToken ? 'account.invitation_registered' : 'account.registered', {
      tenantId: account.tenant_id,
      actorUserId: account.user_id,
      resourceType: 'user',
      resourceId: account.user_id,
    });
    try {
      await issueVerification(req, account.user_id);
    } catch (emailError) {
      console.error(`[${req.requestId}] Verification email failed:`, emailError.message);
    }
    res.status(201).json({
      data: {
        userId: account.user_id,
        tenantId: account.tenant_id,
        email: input.email,
        displayName: input.displayName,
        tenantName: account.tenant_name || input.tenantName,
        tenantSlug: account.tenant_slug || input.tenantSlug,
        role: account.role,
      },
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email or business slug is already registered.' });
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password.' });

  try {
    const result = await getPool().query('SELECT * FROM find_dashboard_login($1)', [parsed.data.email]);
    const account = result.rows[0];
    if (!account || !(await verifyPassword(parsed.data.password, account.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const mfa = await getPool().query('SELECT * FROM dashboard_mfa_for_login($1)', [account.user_id]);
    if (
      mfa.rows[0]?.enabled &&
      (!parsed.data.totpCode || !verifyTotp(decryptJson(mfa.rows[0].encrypted_secret).secret, parsed.data.totpCode))
    ) {
      return res.status(401).json({ error: 'Authenticator code required.', code: 'MFA_REQUIRED' });
    }
    await setSession(req, res, account.user_id, account.tenant_id);
    await recordAudit(req, 'account.logged_in', {
      tenantId: account.tenant_id,
      actorUserId: account.user_id,
      resourceType: 'dashboard_session',
    });
    res.json({
      data: {
        userId: account.user_id,
        tenantId: account.tenant_id,
        email: parsed.data.email,
        displayName: account.display_name,
        tenantName: account.tenant_name,
        role: account.role,
        isPlatformAdmin: account.is_platform_admin,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/request-password-reset', async (req, res, next) => {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(320) }).safeParse(req.body);
  if (!parsed.success) return res.status(202).json({ success: true });
  try {
    const token = crypto.randomBytes(32).toString('base64url');
    const result = await getPool().query('SELECT * FROM issue_password_reset_token($1, $2, $3)', [
      parsed.data.email,
      hashSessionToken(token),
      new Date(Date.now() + 30 * 60 * 1000),
    ]);
    let developmentResetUrl;
    if (result.rows[0]) {
      const resetUrl = `${appOrigin(req)}/dashboard?reset=${encodeURIComponent(token)}`;
      try {
        const delivery = await sendPasswordResetEmail({
          to: result.rows[0].email,
          displayName: result.rows[0].display_name,
          resetUrl,
        });
        if (!delivery.sent && process.env.NODE_ENV !== 'production') developmentResetUrl = resetUrl;
      } catch (emailError) {
        console.error(`[${req.requestId}] Password reset email failed:`, emailError.message);
      }
    }
    res.status(202).json({ success: true, ...(developmentResetUrl && { developmentResetUrl }) });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  const parsed = z
    .object({ token: z.string().min(20).max(200), password: z.string().min(12).max(200) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A valid reset token and password are required.' });
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const result = await getPool().query('SELECT complete_password_reset($1, $2) AS reset', [
      hashSessionToken(parsed.data.token),
      passwordHash,
    ]);
    if (!result.rows[0].reset) return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/verification/send', dashboardAuth, async (req, res, next) => {
  try {
    const delivery = await issueVerification(req, req.auth.user_id);
    res.status(202).json({
      success: true,
      emailSent: delivery.sent,
      ...(process.env.NODE_ENV !== 'production' && !delivery.sent && { developmentVerificationUrl: delivery.verificationUrl }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/verification/confirm', async (req, res, next) => {
  const parsed = z.object({ token: z.string().min(20).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A valid verification token is required.' });
  try {
    const result = await getPool().query('SELECT confirm_email_verification($1) AS verified', [
      hashSessionToken(parsed.data.token),
    ]);
    if (!result.rows[0].verified) return res.status(400).json({ error: 'Verification link is invalid or expired.' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/mfa', dashboardAuth, async (req, res, next) => {
  try {
    const tokenHash = hashSessionToken(req.cookies[DASHBOARD_COOKIE]);
    const result = await getPool().query(
      'SELECT dashboard_mfa_status($1) AS enabled, dashboard_email_is_verified($1) AS email_verified',
      [tokenHash],
    );
    res.json({ data: { enabled: result.rows[0].enabled, emailVerified: result.rows[0].email_verified } });
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/setup', dashboardAuth, async (req, res, next) => {
  try {
    const secret = generateTotpSecret();
    const tokenHash = hashSessionToken(req.cookies[DASHBOARD_COOKIE]);
    const saved = await getPool().query('SELECT save_dashboard_mfa_pending($1, $2) AS saved', [
      tokenHash,
      encryptJson({ secret }),
    ]);
    if (!saved.rows[0].saved) {
      return res.status(409).json({ error: 'MFA is already enabled. Disable it before enrolling a new device.' });
    }
    const uri = createTotpUri({ secret, account: req.auth.email });
    const qrCode = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
    res.json({ data: { secret, uri, qrCode } });
  } catch (err) {
    next(err);
  }
});

router.post('/mfa/enable', dashboardAuth, async (req, res, next) => {
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A six-digit authenticator code is required.' });
  try {
    const credentials = await getPool().query('SELECT * FROM dashboard_mfa_for_login($1)', [req.auth.user_id]);
    if (!credentials.rows[0] || !verifyTotp(decryptJson(credentials.rows[0].encrypted_secret).secret, parsed.data.code)) {
      return res.status(400).json({ error: 'Authenticator code is invalid.' });
    }
    const tokenHash = hashSessionToken(req.cookies[DASHBOARD_COOKIE]);
    await getPool().query('SELECT enable_dashboard_mfa($1)', [tokenHash]);
    await recordAudit(req, 'account.mfa_enabled', { resourceType: 'user', resourceId: req.auth.user_id });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/mfa', dashboardAuth, async (req, res, next) => {
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A six-digit authenticator code is required.' });
  try {
    const credentials = await getPool().query('SELECT * FROM dashboard_mfa_for_login($1)', [req.auth.user_id]);
    if (!credentials.rows[0]?.enabled || !verifyTotp(decryptJson(credentials.rows[0].encrypted_secret).secret, parsed.data.code)) {
      return res.status(400).json({ error: 'Authenticator code is invalid.' });
    }
    const tokenHash = hashSessionToken(req.cookies[DASHBOARD_COOKIE]);
    await getPool().query('SELECT disable_dashboard_mfa($1)', [tokenHash]);
    await recordAudit(req, 'account.mfa_disabled', { resourceType: 'user', resourceId: req.auth.user_id });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  const token = req.cookies?.[DASHBOARD_COOKIE];
  try {
    if (token) await getPool().query('SELECT revoke_dashboard_session($1)', [hashSessionToken(token)]);
    res.clearCookie(DASHBOARD_COOKIE, clearSessionCookieOptions());
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', dashboardAuth, (req, res) => {
  const auth = req.auth;
  res.json({
    data: {
      userId: auth.user_id,
      tenantId: auth.tenant_id,
      email: auth.email,
      displayName: auth.display_name,
      tenantName: auth.tenant_name,
      tenantSlug: auth.tenant_slug,
      role: auth.role,
      isPlatformAdmin: auth.is_platform_admin,
    },
  });
});

router.get('/tenants', dashboardAuth, async (req, res, next) => {
  try {
    const token = req.cookies[DASHBOARD_COOKIE];
    const result = await getPool().query('SELECT * FROM list_dashboard_tenants($1)', [hashSessionToken(token)]);
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/switch-tenant', dashboardAuth, async (req, res, next) => {
  const parsed = z.object({ tenantId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid tenantId is required.' });
  try {
    const token = req.cookies[DASHBOARD_COOKIE];
    const result = await getPool().query('SELECT switch_dashboard_tenant($1, $2) AS switched', [
      hashSessionToken(token),
      parsed.data.tenantId,
    ]);
    if (!result.rows[0].switched) return res.status(403).json({ error: 'You are not a member of that business.' });
    await recordAudit(req, 'account.tenant_switched', {
      tenantId: parsed.data.tenantId,
      actorUserId: req.auth.user_id,
      resourceType: 'tenant',
      resourceId: parsed.data.tenantId,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/accept-invitation', dashboardAuth, async (req, res, next) => {
  const parsed = z.object({ token: z.string().min(20).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid invitation token is required.' });
  try {
    const result = await getPool().query('SELECT * FROM accept_tenant_invitation($1, $2)', [
      hashSessionToken(parsed.data.token),
      req.auth.user_id,
    ]);
    if (!result.rows[0])
      return res.status(400).json({ error: 'Invitation is invalid, expired, or for another email.' });
    await recordAudit(req, 'team.invitation_accepted', {
      tenantId: result.rows[0].tenant_id,
      resourceType: 'tenant',
      resourceId: result.rows[0].tenant_id,
    });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;

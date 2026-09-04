import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { withTenant } from '../database/client.js';
import { hashSessionToken } from '../security/dashboardSessions.js';
import { recordAudit } from '../audit.js';
import { sendInvitationEmail } from '../email.js';

const router = Router();
router.use(createDashboardAuth());

router.get('/', async (req, res, next) => {
  try {
    const members = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query('SELECT * FROM list_tenant_members($1)', [req.auth.tenant_id]);
      return result.rows;
    });
    res.json({ data: members });
  } catch (err) {
    next(err);
  }
});

router.post('/invitations', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email().max(320),
      role: z.enum(['admin', 'developer', 'operator', 'viewer']),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid invitation.' });
  try {
    const token = crypto.randomBytes(32).toString('base64url');
    const invitation = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `INSERT INTO tenant_invitations
          (tenant_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')
         RETURNING id, email, role, expires_at, created_at`,
        [req.auth.tenant_id, parsed.data.email, parsed.data.role, hashSessionToken(token), req.auth.user_id],
      );
      return result.rows[0];
    });
    await recordAudit(req, 'team.invitation_created', {
      resourceType: 'tenant_invitation',
      resourceId: invitation.id,
      metadata: { email: invitation.email, role: invitation.role },
    });
    const appOrigin = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    const invitationUrl = `${appOrigin}/dashboard?invite=${encodeURIComponent(token)}`;
    let emailDelivery = { sent: false, reason: 'smtp_not_configured' };
    try {
      emailDelivery = await sendInvitationEmail({
        to: invitation.email,
        tenantName: req.auth.tenant_name,
        inviterName: req.auth.display_name,
        invitationUrl,
      });
    } catch (emailError) {
      console.error(`[${req.requestId}] Invitation email failed:`, emailError.message);
      emailDelivery = { sent: false, reason: 'delivery_failed' };
    }
    res.status(201).json({ data: { ...invitation, invitationToken: token, invitationUrl, emailSent: emailDelivery.sent } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:userId', requireRole('owner'), async (req, res, next) => {
  const parsed = z.object({ role: z.enum(['admin', 'developer', 'operator', 'viewer']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid member role.' });
  try {
    const result = await withTenant(req.auth.tenant_id, (db) =>
      db.query(`UPDATE memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner'`, [
        req.auth.tenant_id,
        req.params.userId,
        parsed.data.role,
      ]),
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Member not found or owner role cannot be changed.' });
    await recordAudit(req, 'team.member_role_changed', {
      resourceType: 'user',
      resourceId: req.params.userId,
      metadata: { role: parsed.data.role },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:userId', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const result = await withTenant(req.auth.tenant_id, (db) =>
      db.query(
        `DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2
         AND role <> 'owner' AND user_id <> $3`,
        [req.auth.tenant_id, req.params.userId, req.auth.user_id],
      ),
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Member not found or cannot be removed.' });
    await recordAudit(req, 'team.member_removed', { resourceType: 'user', resourceId: req.params.userId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

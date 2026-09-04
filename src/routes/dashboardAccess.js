import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { getPool, withTenant } from '../database/client.js';
import { recordAudit } from '../audit.js';

const router = Router();
router.use(createDashboardAuth());

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from(crypto.randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join('');
const displayCode = (value) => `KPA-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
const hashCode = (value) => crypto.createHash('sha256').update(value.replace(/[^A-Z0-9]/gi, '').toUpperCase()).digest('hex');

router.get('/', async (req, res, next) => {
  try {
    const grants = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT access_grant.id, access_grant.label, access_grant.email, access_grant.role, access_grant.code_prefix, access_grant.accepted_at,
                access_grant.expires_at, access_grant.revoked_at, access_grant.created_at
         FROM external_access_grants AS access_grant
         WHERE access_grant.tenant_id=$1 ORDER BY access_grant.created_at DESC LIMIT 100`,
        [req.auth.tenant_id],
      );
      return result.rows;
    });
    res.json({ data: grants });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = z.object({
    label: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(320).optional().or(z.literal('')),
    role: z.enum(['developer', 'operator', 'viewer']),
    expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid access grant.' });
  try {
    const raw = randomCode();
    const code = displayCode(raw);
    const grant = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `INSERT INTO external_access_grants
          (tenant_id, label, email, role, code_hash, code_prefix, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)
         RETURNING id, label, email, role, code_prefix, expires_at, created_at`,
        [req.auth.tenant_id, parsed.data.label, parsed.data.email || null, parsed.data.role, hashCode(code), code.slice(0, 8), req.auth.user_id, parsed.data.expiresInDays],
      );
      return result.rows[0];
    });
    await recordAudit(req, 'external_access.created', {
      resourceType: 'external_access_grant',
      resourceId: grant.id,
      metadata: { role: grant.role, email: grant.email, expiresAt: grant.expires_at },
    });
    res.status(201).json({ data: { ...grant, code } });
  } catch (err) {
    next(err);
  }
});

router.post('/accept', async (req, res, next) => {
  const parsed = z.object({ code: z.string().trim().min(12).max(30) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid access code.' });
  try {
    const result = await getPool().query('SELECT * FROM accept_external_access_grant($1, $2)', [
      hashCode(parsed.data.code),
      req.auth.user_id,
    ]);
    const accepted = result.rows[0];
    if (!accepted) return res.status(400).json({ error: 'Access code is invalid, expired, already used, or intended for another email.' });
    await recordAudit(req, 'external_access.accepted', {
      tenantId: accepted.tenant_id,
      actorUserId: req.auth.user_id,
      resourceType: 'tenant',
      resourceId: accepted.tenant_id,
      metadata: { role: accepted.granted_role },
    });
    res.json({ data: accepted });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const grant = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `UPDATE external_access_grants SET revoked_at=now()
         WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL
         RETURNING id, accepted_by, role`,
        [req.auth.tenant_id, req.params.id],
      );
      const value = result.rows[0];
      if (value?.accepted_by) {
        await db.query(
          `DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role=$3`,
          [req.auth.tenant_id, value.accepted_by, value.role],
        );
      }
      return value;
    });
    if (!grant) return res.status(404).json({ error: 'Active access grant not found.' });
    await recordAudit(req, 'external_access.revoked', {
      resourceType: 'external_access_grant',
      resourceId: grant.id,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

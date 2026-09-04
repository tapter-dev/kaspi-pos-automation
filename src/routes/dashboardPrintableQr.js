import crypto from 'crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { withTenant } from '../database/client.js';
import { toMinorUnits } from '../payments/money.js';
import { recordAudit } from '../audit.js';

const router = Router();
router.use(createDashboardAuth());

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode = () => Array.from(crypto.randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join('');
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const printPath = (code) => `/pay?code=${encodeURIComponent(code)}`;
const publicOrigin = (req) => process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;

const serialize = async (row, origin) => ({
  id: row.id,
  amount: Number(row.amount_minor) / 100,
  currency: row.currency,
  description: row.description,
  externalOrderId: row.external_order_id,
  singleUse: row.single_use,
  status: row.status,
  shortCode: row.short_code,
  scanCount: row.scan_count,
  printPath: printPath(row.short_code),
  printUrl: new URL(printPath(row.short_code), origin).toString(),
  qrCodeDataUrl: await QRCode.toDataURL(new URL(printPath(row.short_code), origin).toString(), { width: 420, margin: 3 }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await withTenant(req.auth.tenant_id, async (db) => {
      const result = await db.query(
        `SELECT * FROM printable_payment_requests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [req.auth.tenant_id],
      );
      return result.rows;
    });
    res.json({ data: await Promise.all(rows.map((row) => serialize(row, publicOrigin(req)))) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('owner', 'admin', 'operator'), async (req, res, next) => {
  const parsed = z.object({
    amount: z.number().positive().max(999_999_999),
    description: z.string().trim().max(100).optional(),
    externalOrderId: z.string().trim().max(200).optional(),
    singleUse: z.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success || toMinorUnits(parsed.data.amount) === null) {
    return res.status(400).json({ error: 'Invalid printable payment request.', details: parsed.error?.issues });
  }
  try {
    const token = crypto.randomBytes(32).toString('base64url');
    let row;
    for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
      try {
        row = await withTenant(req.auth.tenant_id, async (db) => {
          const result = await db.query(
            `INSERT INTO printable_payment_requests
              (tenant_id, public_token_hash, short_code, amount_minor, description, external_order_id, single_use, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [req.auth.tenant_id, tokenHash(token), shortCode(), toMinorUnits(parsed.data.amount),
              parsed.data.description || null, parsed.data.externalOrderId || null,
              parsed.data.singleUse, req.auth.user_id],
          );
          return result.rows[0];
        });
      } catch (err) {
        if (err.code !== '23505' || attempt === 4) throw err;
      }
    }
    await recordAudit(req, 'printable_request.created', { resourceType: 'printable_request', resourceId: row.id });
    const data = await serialize(row, publicOrigin(req));
    res.status(201).json({ data: { ...data, privatePrintPath: `/pay/${token}` } });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/enable', requireRole('owner', 'admin', 'operator'), async (req, res, next) => {
  try {
    const result = await withTenant(req.auth.tenant_id, (db) => db.query(
      `UPDATE printable_payment_requests SET status='active', disabled_at=NULL, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='disabled' RETURNING *`,
      [req.auth.tenant_id, req.params.id],
    ));
    if (!result.rows[0]) return res.status(409).json({ error: 'Only a disabled request can be enabled.' });
    res.json({ data: await serialize(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('owner', 'admin', 'operator'), async (req, res, next) => {
  try {
    const result = await withTenant(req.auth.tenant_id, (db) => db.query(
      `UPDATE printable_payment_requests SET status='disabled', disabled_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='active' RETURNING id`,
      [req.auth.tenant_id, req.params.id],
    ));
    if (!result.rows[0]) return res.status(409).json({ error: 'Only an active request can be disabled.' });
    await recordAudit(req, 'printable_request.disabled', { resourceType: 'printable_request', resourceId: req.params.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

import crypto from 'crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { getPool, withTenant } from '../database/client.js';
import { getKaspiConnection } from '../kaspi/connectionStore.js';
import { createQrPayment } from '../kaspi/provider.js';
import { createPaymentEvent } from '../webhooks/events.js';
import { enqueuePaymentStatus } from '../queue/client.js';

const router = Router();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

const resolveRequest = async (reference) => {
  const isCode = /^[A-Z2-9]{8}$/i.test(reference);
  const result = await getPool().query('SELECT * FROM resolve_printable_payment_request($1,$2)', [
    isCode ? null : hash(reference),
    isCode ? reference.toUpperCase() : null,
  ]);
  return result.rows[0];
};

const publicData = (request) => ({
  merchant: request.tenant_name,
  amount: Number(request.amount_minor) / 100,
  currency: request.currency,
  description: request.description,
  singleUse: request.single_use,
  status: request.status,
  shortCode: request.short_code,
});

router.get('/:reference', async (req, res, next) => {
  try {
    const request = await resolveRequest(req.params.reference);
    if (!request) return res.status(404).json({ error: 'Payment request not found.' });
    res.json({ data: publicData(request) });
  } catch (err) {
    next(err);
  }
});

router.post('/:reference/start', async (req, res, next) => {
  try {
    const request = await resolveRequest(req.params.reference);
    if (!request) return res.status(404).json({ error: 'Payment request not found.' });
    if (request.status !== 'active') return res.status(410).json({ error: 'This payment request is no longer active.' });

    const reserved = await withTenant(request.tenant_id, async (db) => {
      const tenant = await db.query('SELECT work_mode FROM tenants WHERE id=$1', [request.tenant_id]);
      const isSandbox = tenant.rows[0].work_mode === 'test';
      const current = await db.query(
        `SELECT printable.*, payment.status AS payment_status, payment.qr_original_token,
                payment.expires_at, payment.amount_minor AS payment_amount_minor
         FROM printable_payment_requests AS printable
         LEFT JOIN payment_orders AS payment ON payment.id=printable.last_payment_id
         WHERE printable.tenant_id=$1 AND printable.id=$2 FOR UPDATE OF printable`,
        [request.tenant_id, request.id],
      );
      const row = current.rows[0];
      if (!row || row.status !== 'active') return { unavailable: true };
      if (row.single_use && row.payment_status === 'paid') {
        await db.query("UPDATE printable_payment_requests SET status='paid', updated_at=now() WHERE id=$1", [row.id]);
        return { unavailable: true };
      }
      if (['pending', 'requires_customer_action'].includes(row.payment_status)
        && row.qr_original_token && (!row.expires_at || new Date(row.expires_at) > new Date())) {
        return { existing: row, isSandbox };
      }
      if (row.payment_status === 'created') return { busy: true };
      const scanNumber = row.scan_count + 1;
      const orderPrefix = row.external_order_id || `print:${row.id}`;
      const payment = await db.query(
        `INSERT INTO payment_orders
          (tenant_id, method, amount_minor, currency, external_order_id, description, metadata, printable_request_id)
         VALUES ($1,'qr',$2,'KZT',$3,$4,$5,$6) RETURNING *`,
        [request.tenant_id, row.amount_minor, `${orderPrefix}:${scanNumber}`.slice(0, 240), row.description,
          { printableRequest: true, shortCode: row.short_code, isSandbox }, row.id],
      );
      await db.query(
        'UPDATE printable_payment_requests SET scan_count=$2, last_payment_id=$3, updated_at=now() WHERE id=$1',
        [row.id, scanNumber, payment.rows[0].id],
      );
      return { payment: payment.rows[0], printable: row, isSandbox };
    });
    if (reserved.unavailable) return res.status(410).json({ error: 'This payment request is no longer active.' });
    if (reserved.busy) return res.status(409).json({ error: 'A payment QR is already being prepared. Try again shortly.' });
    if (reserved.existing) {
      return res.json({
        data: {
          ...publicData(request),
          paymentId: request.last_payment_id,
          paymentUrl: reserved.existing.qr_original_token,
          qrCodeDataUrl: await QRCode.toDataURL(reserved.existing.qr_original_token, { width: 360, margin: 2 }),
          expiresAt: reserved.existing.expires_at,
        },
      });
    }

    const connection = reserved.isSandbox ? null : await getKaspiConnection(request.tenant_id, { includeCredentials: true });
    if (!reserved.isSandbox && (!connection || connection.state !== 'active')) {
      await withTenant(request.tenant_id, async (db) => {
        await db.query("UPDATE payment_orders SET status='failed', updated_at=now() WHERE id=$1", [reserved.payment.id]);
      });
      return res.status(503).json({ error: 'The merchant payment connection is temporarily unavailable.' });
    }
    let provider;
    try {
      provider = reserved.isSandbox
        ? {
            StatusCode: 0,
            Data: {
              QrOperationId: `sandbox-${reserved.payment.id}`,
              Status: 'SandboxPending',
              QrToken: `https://qr.kaspi.kz/sandbox/${reserved.payment.id}`,
              ExpireDate: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            },
          }
        : await createQrPayment(connection.credentials, { amount: Number(request.amount_minor) / 100 });
    } catch {
      await withTenant(request.tenant_id, (db) => db.query(
        "UPDATE payment_orders SET status='failed', updated_at=now() WHERE id=$1",
        [reserved.payment.id],
      ));
      return res.status(502).json({ error: 'Kaspi could not prepare the payment QR. Please try again.' });
    }
    const data = provider.Data || {};
    const operationId = data.QrOperationId || data.Id;
    if (!operationId || !data.QrToken) {
      await withTenant(request.tenant_id, (db) => db.query(
        "UPDATE payment_orders SET status='failed', provider_status=$2, updated_at=now() WHERE id=$1",
        [reserved.payment.id, data.Status || null],
      ));
      return res.status(502).json({ error: provider.Message || 'Kaspi rejected the payment request.' });
    }
    await withTenant(request.tenant_id, (db) => db.query(
      `UPDATE payment_orders SET status='requires_customer_action', provider_operation_id=$2,
         provider_status=$3, qr_token=$4, qr_original_token=$5, expires_at=$6, updated_at=now()
       WHERE id=$1`,
      [reserved.payment.id, String(operationId), data.Status || null,
        data.QrToken.replace('https://qr.kaspi.kz/', 'https://pay.kaspi.kz/pay/'), data.QrToken,
        data.ExpireDate || null],
    ));
    await createPaymentEvent(request.tenant_id, reserved.payment.id, 'payment.created', {
      printableRequestId: request.id,
      providerStatus: data.Status || null,
    });
    if (!reserved.isSandbox) await enqueuePaymentStatus(request.tenant_id, reserved.payment.id);
    res.status(201).json({
      data: {
        ...publicData(request),
        paymentId: reserved.payment.id,
        paymentUrl: data.QrToken,
        qrCodeDataUrl: await QRCode.toDataURL(data.QrToken, { width: 360, margin: 2 }),
        expiresAt: data.ExpireDate || null,
      },
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A payment QR is already being prepared.' });
    next(err);
  }
});

export default router;

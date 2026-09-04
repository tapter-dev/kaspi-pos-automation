import { withTenant } from '../database/client.js';
import { getKaspiConnection } from '../kaspi/connectionStore.js';
import { getPaymentStatus, KaspiProviderError } from '../kaspi/provider.js';
import { enqueuePaymentStatus } from '../queue/client.js';
import { isFinalPaymentStatus, normalizePaymentStatus } from '../payments/status.js';
import { createPaymentEvent } from '../webhooks/events.js';

export const processPaymentStatus = async (
  job,
  { getStatus = getPaymentStatus, enqueueStatus = enqueuePaymentStatus } = {},
) => {
  const { tenantId, paymentId } = job.data;
  const payment = await withTenant(tenantId, async (db) => {
    const result = await db.query(
      `SELECT id, method, status, provider_operation_id, expires_at, recurring_run_id,
              printable_request_id
       FROM payment_orders WHERE tenant_id = $1 AND id = $2`,
      [tenantId, paymentId],
    );
    return result.rows[0];
  });
  if (!payment || isFinalPaymentStatus(payment.status)) return;

  if (payment.expires_at && new Date(payment.expires_at) <= new Date()) {
    const changed = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        "UPDATE payment_orders SET status = 'expired', updated_at = now() WHERE id = $1 AND status = $2 RETURNING id",
        [paymentId, payment.status],
      );
      if (result.rowCount && payment.recurring_run_id) {
        await db.query("UPDATE recurring_runs SET status='expired', updated_at=now() WHERE id=$1", [payment.recurring_run_id]);
      }
      return result;
    });
    if (changed.rowCount) {
      await createPaymentEvent(tenantId, paymentId, 'payment.expired', { reason: 'local_expiry' });
    }
    return;
  }

  const connection = await getKaspiConnection(tenantId, { includeCredentials: true });
  if (!connection || connection.state !== 'active') return;
  let response;
  try {
    response = await getStatus(connection.credentials, payment.method, payment.provider_operation_id);
  } catch (err) {
    if (err instanceof KaspiProviderError && [401, 403].includes(err.providerStatus)) {
      const changed = await withTenant(tenantId, async (db) => {
        await db.query(
          `UPDATE kaspi_connections SET state = 'displaced', last_error = $2, updated_at = now()
           WHERE tenant_id = $1`,
          [tenantId, `Kaspi session rejected with HTTP ${err.providerStatus}`],
        );
        return db.query(
          `UPDATE payment_orders SET status = 'unknown', updated_at = now()
           WHERE id = $1 AND status = $2`,
          [paymentId, payment.status],
        );
      });
      if (changed.rowCount) {
        await createPaymentEvent(tenantId, paymentId, 'payment.unknown', { reason: 'kaspi_session_rejected' });
      }
      return;
    }
    throw err;
  }
  if (response.StatusCode === -101001) {
    const changed = await withTenant(tenantId, async (db) => {
      await db.query(
        `UPDATE kaspi_connections SET state = 'displaced', last_error = $2, updated_at = now()
         WHERE tenant_id = $1`,
        [tenantId, 'Kaspi session was displaced by another login.'],
      );
      return db.query(
        `UPDATE payment_orders SET status = 'unknown', updated_at = now()
         WHERE id = $1 AND status = $2`,
        [paymentId, payment.status],
      );
    });
    if (changed.rowCount) {
      await createPaymentEvent(tenantId, paymentId, 'payment.unknown', { reason: 'kaspi_session_displaced' });
    }
    return;
  }
  const providerStatus = response.Data?.Status;
  const normalized = normalizePaymentStatus(providerStatus, payment.status);

  if (providerStatus && normalized !== payment.status) {
    const changed = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        `UPDATE payment_orders SET status = $2, provider_status = $3,
           paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
           updated_at = now() WHERE id = $1 AND status = $4 RETURNING id`,
        [paymentId, normalized, providerStatus, payment.status],
      );
      if (result.rowCount && payment.recurring_run_id && ['paid', 'failed', 'expired', 'cancelled'].includes(normalized)) {
        const run = await db.query(
          `UPDATE recurring_runs SET status=$2, updated_at=now()
           WHERE id=$1 AND status<>$2 RETURNING schedule_id`,
          [payment.recurring_run_id, normalized],
        );
        if (normalized === 'paid' && run.rows[0]) {
          await db.query(
            'UPDATE recurring_schedules SET successful_cycles=successful_cycles+1, updated_at=now() WHERE id=$1',
            [run.rows[0].schedule_id],
          );
        }
      }
      if (result.rowCount && normalized === 'paid' && payment.printable_request_id) {
        await db.query(
          `UPDATE printable_payment_requests SET status='paid', updated_at=now()
           WHERE id=$1 AND single_use=true AND last_payment_id=$2`,
          [payment.printable_request_id, paymentId],
        );
      }
      return result;
    });
    if (changed.rowCount) {
      await createPaymentEvent(tenantId, paymentId, `payment.${normalized}`, {
        providerStatus,
        statusDescription: response.Data?.StatusDesc || null,
      });
    }
  }

  if (!isFinalPaymentStatus(normalized)) await enqueueStatus(tenantId, paymentId, 3000);
};

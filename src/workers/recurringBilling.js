import { withTenant } from '../database/client.js';
import { getKaspiConnection } from '../kaspi/connectionStore.js';
import { createInvoicePayment } from '../kaspi/provider.js';
import { nextRecurringAt } from '../payments/recurring.js';
import { createPaymentEvent } from '../webhooks/events.js';
import { enqueuePaymentStatus, enqueueRecurringBilling } from '../queue/client.js';

export const processRecurringBilling = async (job, { createInvoice = createInvoicePayment } = {}) => {
  const { tenantId, scheduleId } = job.data;
  const claimed = await withTenant(tenantId, async (db) => {
    const result = await db.query(
      `SELECT * FROM recurring_schedules
       WHERE tenant_id=$1 AND id=$2 AND status='active' AND next_payment_at <= now()
       FOR UPDATE`,
      [tenantId, scheduleId],
    );
    const schedule = result.rows[0];
    if (!schedule) return null;
    if (schedule.total_cycles && schedule.generated_cycles >= schedule.total_cycles) {
      await db.query("UPDATE recurring_schedules SET status='completed', next_payment_at=NULL, updated_at=now() WHERE id=$1", [schedule.id]);
      return null;
    }
    const run = await db.query(
      `INSERT INTO recurring_runs (tenant_id, schedule_id, scheduled_for)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`,
      [tenantId, schedule.id, schedule.next_payment_at],
    );
    if (!run.rows[0]) return null;
    const payment = await db.query(
      `INSERT INTO payment_orders
        (tenant_id, method, amount_minor, currency, external_order_id, description, customer_phone,
         metadata, recurring_schedule_id, recurring_run_id)
       VALUES ($1,'invoice',$2,'KZT',$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tenantId, schedule.amount_minor, `subscription:${schedule.id}:${new Date(schedule.next_payment_at).toISOString()}`,
        schedule.description, schedule.customer_phone, { recurring: true }, schedule.id, run.rows[0].id],
    );
    await db.query('UPDATE recurring_runs SET payment_id=$2 WHERE id=$1', [run.rows[0].id, payment.rows[0].id]);
    await db.query('UPDATE recurring_schedules SET next_payment_at=NULL, updated_at=now() WHERE id=$1', [schedule.id]);
    return { schedule, run: run.rows[0], payment: payment.rows[0] };
  });
  if (!claimed) return;

  const tenant = await withTenant(tenantId, async (db) => {
    const result = await db.query('SELECT work_mode FROM tenants WHERE id=$1', [tenantId]);
    return result.rows[0];
  });
  const isSandbox = tenant.work_mode === 'test';
  if (isSandbox) {
    await withTenant(tenantId, (db) => db.query(
      "UPDATE payment_orders SET metadata=metadata || '{\"isSandbox\":true}'::jsonb WHERE id=$1",
      [claimed.payment.id],
    ));
  }
  const connection = isSandbox ? null : await getKaspiConnection(tenantId, { includeCredentials: true });
  if (!isSandbox && (!connection || connection.state !== 'active')) {
    await withTenant(tenantId, async (db) => {
      await db.query("UPDATE recurring_runs SET status='failed', failure_reason='Kaspi connection is not active', updated_at=now() WHERE id=$1", [claimed.run.id]);
      await db.query("UPDATE payment_orders SET status='failed', updated_at=now() WHERE id=$1", [claimed.payment.id]);
      await db.query("UPDATE recurring_schedules SET status='paused', updated_at=now() WHERE id=$1", [scheduleId]);
    });
    return;
  }

  let provider;
  try {
    provider = isSandbox
      ? {
          StatusCode: 0,
          Data: {
            QrOperationId: `sandbox-${claimed.payment.id}`,
            Status: 'SandboxPending',
          },
        }
      : await createInvoice(connection.credentials, {
          amount: Number(claimed.schedule.amount_minor) / 100,
          phoneNumber: claimed.schedule.customer_phone,
          description: claimed.schedule.description,
        });
  } catch (err) {
    await withTenant(tenantId, async (db) => {
      await db.query("UPDATE recurring_runs SET status='failed', failure_reason=$2, updated_at=now() WHERE id=$1", [claimed.run.id, err.message]);
      await db.query("UPDATE payment_orders SET status='unknown', updated_at=now() WHERE id=$1", [claimed.payment.id]);
      await db.query("UPDATE recurring_schedules SET status='paused', updated_at=now() WHERE id=$1", [scheduleId]);
    });
    await createPaymentEvent(tenantId, claimed.payment.id, 'payment.unknown', { reason: 'recurring_creation_outcome_unknown' });
    return;
  }

  const data = provider.Data || {};
  const operationId = data.QrOperationId || data.Id;
  if (!operationId) {
    const retryAt = new Date(Date.now() + claimed.schedule.retry_interval_hours * 60 * 60 * 1000);
    await withTenant(tenantId, async (db) => {
      await db.query("UPDATE recurring_runs SET status='failed', failure_reason=$2, updated_at=now() WHERE id=$1", [claimed.run.id, provider.Message || 'Kaspi rejected the invoice']);
      await db.query("UPDATE payment_orders SET status='failed', provider_status=$2, updated_at=now() WHERE id=$1", [claimed.payment.id, data.Status || null]);
      await db.query('UPDATE recurring_schedules SET next_payment_at=$2, updated_at=now() WHERE id=$1', [scheduleId, retryAt]);
    });
    await createPaymentEvent(tenantId, claimed.payment.id, 'payment.failed', { reason: provider.Message || 'provider_rejected' });
    await enqueueRecurringBilling(tenantId, scheduleId, claimed.schedule.retry_interval_hours * 60 * 60 * 1000);
    return;
  }

  const nextAt = nextRecurringAt(
    new Date(claimed.schedule.next_payment_at),
    claimed.schedule.billing_period,
    claimed.schedule.billing_day,
    String(claimed.schedule.billing_time).slice(0, 5),
  );
  const updated = await withTenant(tenantId, async (db) => {
    const payment = await db.query(
      `UPDATE payment_orders SET status='pending', provider_operation_id=$2, provider_status=$3,
         qr_token=$4, qr_original_token=$5, receipt_url=$6, expires_at=$7, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [claimed.payment.id, String(operationId), data.Status || null,
        data.QrToken ? data.QrToken.replace('https://qr.kaspi.kz/', 'https://pay.kaspi.kz/pay/') : null,
        data.QrToken || null, data.ReceiptUrl || null, data.ExpireDate || null],
    );
    await db.query("UPDATE recurring_runs SET status='invoice_created', updated_at=now() WHERE id=$1", [claimed.run.id]);
    const schedule = await db.query(
      `UPDATE recurring_schedules SET generated_cycles=generated_cycles+1,
         status=CASE WHEN total_cycles IS NOT NULL AND generated_cycles+1 >= total_cycles THEN 'completed' ELSE status END,
         next_payment_at=CASE WHEN total_cycles IS NOT NULL AND generated_cycles+1 >= total_cycles THEN NULL ELSE $2 END,
         updated_at=now() WHERE id=$1 RETURNING status, next_payment_at`,
      [scheduleId, nextAt],
    );
    return { payment: payment.rows[0], schedule: schedule.rows[0] };
  });
  await createPaymentEvent(tenantId, claimed.payment.id, 'payment.created', {
    recurringScheduleId: scheduleId,
    providerStatus: data.Status || null,
  });
  if (!isSandbox) await enqueuePaymentStatus(tenantId, claimed.payment.id);
  if (updated.schedule.status === 'active' && updated.schedule.next_payment_at) {
    await enqueueRecurringBilling(tenantId, scheduleId, Math.max(new Date(updated.schedule.next_payment_at).getTime() - Date.now(), 0));
  }
};

import { Worker } from 'bullmq';
import { closePool, getPool, withTenant } from './src/database/client.js';
import {
  PAYMENT_STATUS_QUEUE,
  RECURRING_BILLING_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
  closeQueues,
  enqueuePaymentStatus,
  enqueueRecurringBilling,
  enqueueWebhookDelivery,
  redisConnection,
} from './src/queue/client.js';
import { processPaymentStatus } from './src/workers/paymentStatus.js';
import { processWebhookDelivery } from './src/workers/webhookDelivery.js';
import { processRecurringBilling } from './src/workers/recurringBilling.js';

const connection = redisConnection();
const paymentWorker = new Worker(PAYMENT_STATUS_QUEUE, processPaymentStatus, { connection, concurrency: 10 });
const webhookWorker = new Worker(WEBHOOK_DELIVERY_QUEUE, processWebhookDelivery, { connection, concurrency: 20 });
const recurringWorker = new Worker(RECURRING_BILLING_QUEUE, processRecurringBilling, { connection, concurrency: 5 });

paymentWorker.on('failed', (job, err) => console.error(`Payment job ${job?.id} failed:`, err.message));
webhookWorker.on('failed', async (job, err) => {
  console.error(`Webhook job ${job?.id} failed:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await withTenant(job.data.tenantId, (db) =>
      db.query("UPDATE webhook_deliveries SET status = 'dead' WHERE id = $1", [job.data.deliveryId]),
    );
  }
});
paymentWorker.on('error', (err) => console.error('Payment worker error:', err));
webhookWorker.on('error', (err) => console.error('Webhook worker error:', err));
recurringWorker.on('failed', (job, err) => console.error(`Recurring job ${job?.id} failed:`, err.message));
recurringWorker.on('error', (err) => console.error('Recurring worker error:', err));

console.log('Payment status and webhook workers started.');

const reconcile = async () => {
  const [payments, deliveries, schedules] = await Promise.all([
    getPool().query('SELECT * FROM list_pending_payment_work()'),
    getPool().query('SELECT * FROM list_pending_webhook_work()'),
    getPool().query('SELECT * FROM list_due_recurring_work()'),
  ]);
  await Promise.allSettled([
    ...payments.rows.map((row) => enqueuePaymentStatus(row.tenant_id, row.payment_id)),
    ...deliveries.rows.map((row) => enqueueWebhookDelivery(row.tenant_id, row.delivery_id)),
    ...schedules.rows.map((row) => enqueueRecurringBilling(row.tenant_id, row.schedule_id)),
  ]);
};

await reconcile();
const reconcileTimer = setInterval(
  () => reconcile().catch((err) => console.error('Queue reconciliation failed:', err)),
  30_000,
);

const shutdown = async () => {
  clearInterval(reconcileTimer);
  await Promise.all([paymentWorker.close(), webhookWorker.close(), recurringWorker.close(), closeQueues(), closePool()]);
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

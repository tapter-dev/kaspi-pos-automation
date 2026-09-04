import { Queue } from 'bullmq';

export const PAYMENT_STATUS_QUEUE = 'payment-status';
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const RECURRING_BILLING_QUEUE = 'recurring-billing';

let paymentStatusQueue;
let webhookDeliveryQueue;
let recurringBillingQueue;

export const redisConnection = () => {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    ...(url.protocol === 'rediss:' && { tls: {} }),
  };
};

export const getPaymentStatusQueue = () => {
  if (!paymentStatusQueue) paymentStatusQueue = new Queue(PAYMENT_STATUS_QUEUE, { connection: redisConnection() });
  return paymentStatusQueue;
};

export const getWebhookDeliveryQueue = () => {
  if (!webhookDeliveryQueue)
    webhookDeliveryQueue = new Queue(WEBHOOK_DELIVERY_QUEUE, { connection: redisConnection() });
  return webhookDeliveryQueue;
};

export const getRecurringBillingQueue = () => {
  if (!recurringBillingQueue)
    recurringBillingQueue = new Queue(RECURRING_BILLING_QUEUE, { connection: redisConnection() });
  return recurringBillingQueue;
};

export const enqueuePaymentStatus = async (tenantId, paymentId, delay = 3000) =>
  getPaymentStatusQueue().add(
    'check',
    { tenantId, paymentId },
    {
      jobId: `payment-${paymentId}-${Math.floor(Date.now() / 3000)}`,
      delay,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 5000,
    },
  );

export const enqueueWebhookDelivery = async (tenantId, deliveryId, delay = 0) =>
  getWebhookDeliveryQueue().add(
    'deliver',
    { tenantId, deliveryId },
    {
      jobId: `webhook-${deliveryId}`,
      delay,
      attempts: 6,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      // Delivery history is durable in PostgreSQL. Removing an exhausted queue
      // job also lets an operator replay the same delivery ID later.
      removeOnFail: true,
    },
  );

export const enqueueRecurringBilling = async (tenantId, scheduleId, delay = 0) =>
  getRecurringBillingQueue().add(
    'bill',
    { tenantId, scheduleId },
    {
      jobId: `recurring-${scheduleId}-${Math.floor((Date.now() + delay) / 60_000)}`,
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  );

export const closeQueues = async () => {
  await Promise.all([paymentStatusQueue?.close(), webhookDeliveryQueue?.close(), recurringBillingQueue?.close()]);
  paymentStatusQueue = undefined;
  webhookDeliveryQueue = undefined;
  recurringBillingQueue = undefined;
};

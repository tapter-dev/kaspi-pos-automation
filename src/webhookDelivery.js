import crypto from 'crypto';

export const createWebhookSignature = (body, secret) =>
  `sha256=${crypto
    .createHmac('sha256', secret || '')
    .update(body)
    .digest('hex')}`;

export const createTimestampedWebhookSignature = (timestamp, body, secret) =>
  createWebhookSignature(`${timestamp}.${body}`, secret);

export const isSuccessfulWebhookStatus = (status) => status >= 200 && status < 300;

export const isRetryableWebhookStatus = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

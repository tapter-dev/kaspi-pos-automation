import crypto from 'crypto';

export const verifyKaspiAutomationWebhook = ({ rawBody, timestamp, signature, secret, toleranceSeconds = 300 }) => {
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > toleranceSeconds) {
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const supplied = Buffer.from(signature || '', 'hex');
  const calculated = Buffer.from(expected, 'hex');
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
};

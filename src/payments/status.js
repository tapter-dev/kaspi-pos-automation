const SUCCESS = new Set(['Processed', 'Paid', 'RemotePaymentPaid']);
const EXPIRED = new Set(['Expired', 'QrTokenDiscarded', 'RemotePaymentExpired']);
const CANCELLED = new Set(['CancelledByUser', 'CancelledByExternalSource', 'RemotePaymentCanceled']);
const FAILED = new Set([
  'NotConfirmedByUser',
  'ProcessingFailed',
  'Rejected',
  'RemotePaymentRejected',
  'InsufficientFunds',
  'InsufficientFundsError',
  'Error',
]);

export const normalizePaymentStatus = (providerStatus, currentStatus = 'pending') => {
  if (!providerStatus) return currentStatus;
  if (SUCCESS.has(providerStatus)) return 'paid';
  if (EXPIRED.has(providerStatus)) return 'expired';
  if (CANCELLED.has(providerStatus)) return 'cancelled';
  if (FAILED.has(providerStatus)) return 'failed';
  return currentStatus === 'created' ? 'pending' : currentStatus;
};

export const isFinalPaymentStatus = (status) =>
  ['paid', 'failed', 'expired', 'cancelled', 'partially_refunded', 'refunded'].includes(status);
